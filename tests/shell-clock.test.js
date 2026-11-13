// DRIFT-8 C5: the shell's flows run on REAL time. Every flow of the console (library fade, slide, dip, locked message, shelf scrub, insert, boot, eject,
// error card, menu ramp, help ramp, program-switch dissolve, season ramp) is timed from the key that starts it to the frame that ends it, in a real
// createApp on a fake clock (node's mock timers, the loop and the renderer as shipped; nothing waits for wall time), and compared with the constant
// the source module exports (imported, never copied).
//
//   T1  the duration equals its constant to within one frame (1/fps): not earlier (a flow must never run faster than real time) and not later.
//       Repeated at ALL 8 speeds (SPEEDS in src/app.js; Classic and the running cartridge are both set with the + and - keys before the flow),
//       at --fps 1, 12, 18 and 30, and under every DRIFT_* environment setting that exists (see ENV below).
//   T2  the eject, as bytes on the terminal, is the same at 1x and at 4x.
//
// Below 4 fps the loop's stall guard (src/app.js: dt > 0.25 is cut to 0.25) means one frame adds 0.25 s of flow for 1/fps of real time, so at --fps 1 a
// flow takes 4x as long as its constant in real time. That is slower, never faster; it is judged in flow seconds (real seconds / 4) against the same
// bounds, and said plainly here rather than hidden: the fps 1 rows show it (see the finding in the ticket report).
//
// Two arms for each flow: it does not end early (flow time >= constant - 2 ms) and it does not run long (<= constant + one frame + 2 ms).
// What cannot be keyed: SCRUB_IN_SECONDS (the dissolve into the dim strip) is always followed within a frame or two by the wait for SCRUB_HOLD_SECONDS
// and then the dissolve out, so by render activity it cannot be told from the hold; only the dissolve OUT is timed (the tests/shell-shelf-scrub*.test.js
// files cover the dissolve in). The ramp and dissolve flows are timed with the scene held (p) so nothing else draws; the speed keys still reach them.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DISSOLVE_SECONDS, SPEEDS, parseOptions } from '../src/app.js';
import { allSceneIds } from '../src/scenes/index.js';
import {
  LIBRARY_FADE_SECONDS, SLIDE_SECONDS, DIP_SECONDS, MESSAGE_SECONDS, EJECT_SECONDS, ERROR_SECONDS,
} from '../src/shell/shell.js';
import { INSERT_END } from '../src/shell/insert.js';
import { bootPhases } from '../src/shell/boot.js';
import { plainBootSkin } from '../src/shell/driftman.js';
import { SCRUB_OUT_SECONDS } from '../src/shell/scrub.js';
import { MENU_RAMP_SECONDS, SEASON_SECONDS } from '../src/shell/runtime.js';
import { makeRig, runFlows, ejectBytes, sharedCarts, disposeShared, gameStep, realPerGame } from './helpers-shell-clock.js';

after(() => disposeShared());

// the flows: key in the result of runFlows, the constant, and how many render bursts each is expected to leave (null = not a burst flow)
async function flowTable() {
  const { found } = await sharedCarts();
  const cart = found.cartridges.find((c) => c.id === 'seasonal');
  const boot = bootPhases(cart.skin || plainBootSkin(cart.title)).end; // the boot ends at the end of ITS skin's timeline
  return [
    ['library fade', 'libFade', LIBRARY_FADE_SECONDS],
    ['slide', 'slide', SLIDE_SECONDS],
    ['dip', 'dip', DIP_SECONDS],
    ['locked message', 'message', MESSAGE_SECONDS],
    ['scrub dissolve out', 'scrubOut', SCRUB_OUT_SECONDS],
    ['insert', 'insert', INSERT_END],
    ['boot', 'boot', boot],
    ['menu ramp out', 'menuOut', MENU_RAMP_SECONDS],
    ['menu ramp in', 'menuIn', MENU_RAMP_SECONDS],
    ['help ramp in', 'helpIn', MENU_RAMP_SECONDS],
    ['help ramp out', 'helpOut', MENU_RAMP_SECONDS],
    ['program-switch dissolve', 'switch', DISSOLVE_SECONDS],
    ['season ramp', 'season', SEASON_SECONDS],
    ['eject', 'eject', EJECT_SECONDS],
    ['error card', 'error', ERROR_SECONDS],
  ];
}

// flow seconds from real ms; the two arms. `what` names the run in the message.
function judge(name, realMs, constant, fps, what) {
  const g = gameStep(fps);
  const flow = realMs / 1000 / realPerGame(fps);
  const say = `${what}: ${name} took ${realMs} ms real = ${flow.toFixed(4)} s of flow for a constant of ${constant} s (one frame = ${g.toFixed(4)} s)`;
  assert.ok(flow >= constant - 0.002, `ENDED EARLY (faster than real time) - ${say}`);
  assert.ok(flow <= constant + g + 0.002, `RAN LONG - ${say}`);
}

// the structure of what was seen, so a flow timed on the wrong thing cannot pass (each count is the number of render bursts after the key)
const BURSTS = { libFade: 1, slide: 1, dip: 2, message: 2, scrubOut: 2, menuOut: 1, menuIn: 1, helpIn: 1, helpOut: 1, switch: 1, season: 1 };
function structure(out, what) {
  for (const [key, n] of Object.entries(BURSTS)) {
    const raw = key === 'scrubOut' ? out.raw.scrub : key === 'message' ? out.raw.message : out.raw[key];
    assert.ok(raw, `${what}: ${key} was observed`);
    assert.equal(raw.length, n, `${what}: ${key} left ${raw.length} render bursts, expected ${n}: ${JSON.stringify(raw)}`);
  }
}

const FPS_LIST = [1, 12, 18, 30];

for (const fps of FPS_LIST) {
  for (let idx = 0; idx < SPEEDS.length; idx++) {
    test(`T1 shell flows run on real time at ${fps} fps, speed ${SPEEDS[idx]}x (index ${idx}): every flow equals its constant to within one frame`, async () => {
      const table = await flowTable();
      const rig = await makeRig({ fps });
      try {
        assert.equal(rig.fps, fps);
        const out = await runFlows(rig, idx);
        const what = `${fps} fps ${SPEEDS[idx]}x`;
        structure(out, what);
        assert.equal(out.classicSpeed, SPEEDS[idx], `${what}: the speed keys reached Classic`);
        for (const [name, key, constant] of table) {
          assert.equal(typeof out[key], 'number', `${what}: ${name} was timed`);
          judge(name, out[key], constant, fps, what);
        }
      } finally { rig.done(); }
    });
  }
}

// ---- the environment: every DRIFT_* setting that src reads (parseOptions in src/app.js and defaultConfigPath in src/config.js). They are applied the
// way bin/drift.js applies them (parseOptions(argv, env) spread into createApp, the config path from DRIFT_CONFIG) at the worst speed for a scaled
// clock (4x) and at the slowest (0.25x). DRIFT_TEST_* are harness hooks of main() only (a forced TTY, a size, a thrown error) and are not app settings.
const ENV = [
  ['DRIFT_FADE_SECONDS=0.5', { env: { DRIFT_FADE_SECONDS: '0.5' }, check: (o) => assert.equal(o.fadeSeconds, 0.5) }],
  ['DRIFT_FADE_SECONDS=600', { env: { DRIFT_FADE_SECONDS: '600' }, check: (o) => assert.equal(o.fadeSeconds, 600) }],
  ['DRIFT_SCENE_SECONDS=0.5', { env: { DRIFT_SCENE_SECONDS: '0.5' }, check: (o) => assert.equal(o.sceneSeconds, 0.5) }],
  ['DRIFT_SEED=424242', { env: { DRIFT_SEED: '424242' }, check: (o) => assert.equal(o.seed, 424242) }],
  ['DRIFT_FPS=12 (the frame rate itself)', { env: { DRIFT_FPS: '12' }, fps: 12, check: (o) => assert.equal(o.fps, 12) }],
  ['DRIFT_FPS=30 (the frame rate itself)', { env: { DRIFT_FPS: '30' }, fps: 30, check: (o) => assert.equal(o.fps, 30) }],
  ['DRIFT_SCENE=<a non-calm scene>', { env: { DRIFT_SCENE: allSceneIds()[allSceneIds().length - 1] }, check: (o) => assert.ok(o.startMode && o.startMode !== 'calm' || o.startScene > 0, `DRIFT_SCENE reached the options: ${JSON.stringify([o.startMode, o.startScene])}`) }],
  ['DRIFT_CONFIG=<a file with inverted high contrast>', { env: {}, config: { mode: 'contrast', invert: true }, check: () => {} }],
  ['all of them at once', { env: { DRIFT_FADE_SECONDS: '0.1', DRIFT_SCENE_SECONDS: '0.5', DRIFT_SEED: '-7', DRIFT_FPS: '24', DRIFT_SCENE: '3' }, fps: 24, check: (o) => assert.equal(o.fps, 24) }],
];
for (const [label, spec] of ENV) {
  for (const idx of [0, SPEEDS.length - 1]) {
    test(`T1 shell flows under ${label}, speed ${SPEEDS[idx]}x: every flow equals its constant to within one frame`, async () => {
      const table = await flowTable();
      const rig = await makeRig({ env: spec.env, config: spec.config });
      try {
        spec.check(parseOptions([], { ...spec.env }));
        const out = await runFlows(rig, idx);
        const what = `${label} ${SPEEDS[idx]}x`;
        structure(out, what);
        assert.equal(out.classicSpeed, SPEEDS[idx], `${what}: the speed keys reached Classic`);
        for (const [name, key, constant] of table) judge(name, out[key], constant, rig.fps, what);
      } finally { rig.done(); }
    });
  }
}

// ---- T2: the eject is the same bytes at 1x and at 4x
for (const fps of [12, 18, 30]) {
  test(`T2 eject frames are byte-identical at 1x and 4x (${fps} fps; Classic and the cartridge both at the speed)`, async () => {
    const run = async (idx, f = fps) => {
      const rig = await makeRig({ fps: f });
      try { return await ejectBytes(rig, idx); } finally { rig.done(); }
    };
    const one = await run(3), four = await run(7);
    assert.ok(one.length >= Math.floor(EJECT_SECONDS * fps / 2), `the eject (about ${Math.round(EJECT_SECONDS * fps)} frames; an unchanged frame is not written) wrote ${one.length} frames at 1x`);
    assert.ok(one.some((w) => w.length > 400), 'a real picture was written');
    assert.equal(four.length, one.length, `the same number of writes (${one.length} at 1x, ${four.length} at 4x)`);
    for (let i = 0; i < one.length; i++) assert.equal(four[i], one[i], `write ${i} of ${one.length} is the same bytes at 4x`);
    // the control: the comparison can tell two ejects apart (a different frame rate writes different frames)
    const other = await run(3, fps === 18 ? 30 : 18);
    assert.notDeepEqual(other, one, 'control: an eject at another frame rate is not the same bytes');
  });
}
