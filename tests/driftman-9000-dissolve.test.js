// DRIFT-7 C15d: the Driftman 9000's dissolves between its visions against the flash meter. The pairs are read from the manifest's program
// (every ordered pair of different scenes, so Cortex is picked up the day it is added), each run through createCellComposer and a two-scene
// Scheduler with the program's real hold (sceneSeconds 60) and the shell's 2 s dissolve (DISSOLVE_SECONDS), exactly as the shell's runtime builds
// them. Scene A's clock starts at 0 (one frame is drawn then, so its t0 is 0), the meter watches from 4 s before the dissolve to 4 s after it,
// frame k at t = start + k * speed / 18 with speed 1 (judged at the meter's 1x and 4x views) and 4 (the shell's fastest, judged at 1x, which is its
// 18 fps view of frames that step 4/18 s). Truecolor at five sizes, and 256-colour output at three.
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCartridges, loadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { createCellComposer } from '../src/cells.js';
import { Scheduler } from '../src/compose.js';
import { createFlashMeter, failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { flashRig, frameAtSpeed } from './helpers-flash-controls.js';

const FPS = 18, FADE = 2, LEAD = 4, TAIL = 4;
const pc = (x) => (x * 100).toFixed(1);
const show = (rep) => `L1 ${pc(rep.l1.x1.worstFraction)}/${pc(rep.l1.x4.worstFraction)} L2 ${pc(rep.l2.x1.worstFraction)}/${pc(rep.l2.x4.worstFraction)} L3 ${pc(rep.l3.worstFraction)} R ${pc(rep.r.x1.worstFraction)}/${pc(rep.r.x4.worstFraction)} C ${pc(rep.c.worstFraction)}`;
const X1 = X1_RULE_IDS; // DRIFT-8 C4: with the colour rule C, which is judged at the playback speed
const failed = (rep) => failedRules(rep);

const cart = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.find((c) => c.id === 'driftman-9000');
assert.ok(cart, 'the 9000 is on the shelf');
const loaded = await loadScenes(cart);
assert.deepEqual(loaded.errors, []);
const byId = (id) => loaded.scenes.find((s) => s.id === id);
const PROGRAM = cart.manifest.programs.find((p) => p.id === cart.manifest.start) || cart.manifest.programs[0];
const ORDER = PROGRAM.scenes;
const HOLD = PROGRAM.sceneSeconds;
const PAIRS = [];
for (const a of ORDER) for (const b of ORDER) if (a !== b) PAIRS.push([a, b]);

function pairRun(idA, idB, cols, rows, { speed = 1, reduce256 = false, seed = 1, scenes = null } = {}) {
  const [sa, sb] = scenes || [byId(idA).scene, byId(idB).scene];
  const rig = flashRig([sa, sb], cols, rows, { seed, mode: reduce256 ? '256' : 'truecolor' }); // a 256 run gets a 256 composer (scenes see params.cmode)
  const cc = rig.cc;
  const sched = new Scheduler({ count: 2, durationSec: HOLD, fadeSec: FADE, start: 0, durations: [HOLD, HOLD] });
  const meter = createFlashMeter(cols, rows, FPS);
  const step = speed / FPS;
  cc.frame(sched.state(), 0); // A's t0 is 0
  const t0 = HOLD - LEAD, t1 = HOLD + FADE + TAIL;
  for (let t = 0; t < t0 - 1e-9; t += step) sched.advance(step);
  // now at (about) t0: step on, drawing
  let t = Math.ceil(t0 / step - 1e-9) * step;
  for (; t <= t1; t += step) {
    sched.advance(step);
    const f = frameAtSpeed(cc, sched.state(), t, speed); // the colour clock runs at min(speed, 1) of real time, as the runtime drives it (C3, C4)
    const s = rig.show(f);
    meter.push(s.frame, s.palette);
  }
  return meter.report();
}

test('9000 dissolves: the pairs are every ordered pair of different scenes in the manifest program (read, not typed), hold 60 s, dissolve 2 s', () => {
  assert.ok(ORDER.length >= 2);
  assert.deepEqual(ORDER, ['rosette', 'cortex', 'bloomfall']);
  assert.equal(PAIRS.length, ORDER.length * (ORDER.length - 1));
  assert.ok(PAIRS.some(([a, b]) => a === 'rosette' && b === 'bloomfall') && PAIRS.some(([a, b]) => a === 'bloomfall' && b === 'rosette'));
  for (const id of ['rosette', 'bloomfall']) assert.ok(PAIRS.some(([a, b]) => a === 'cortex' && b === id) && PAIRS.some(([a, b]) => a === id && b === 'cortex'), `cortex and ${id} dissolve both ways`);
  assert.equal(HOLD, 60);
  console.log(`DISSOLVE pairs (${PAIRS.length}): ${PAIRS.map(([a, b]) => `${a}>${b}`).join(', ')}`);
});

const SIZES = [[120, 40], [80, 24], [240, 67], [61, 21], [88, 39]];
test('9000 dissolves: every ordered pair, 5 sizes, shell speeds 1x (meter 1x and 4x views) and 4x (meter 1x view), truecolor: every rule passes', () => {
  const lines = [], bad = [];
  for (const [a, b] of PAIRS) {
    for (const [cols, rows] of SIZES) {
      for (const speed of [1, 4]) {
        const rep = pairRun(a, b, cols, rows, { speed });
        lines.push(`${a}>${b} ${cols}x${rows} ${speed}x ${show(rep)}`);
        const f = failed(rep).filter((id) => speed === 1 || X1.includes(id));
        if (f.length) bad.push(`${a}>${b} ${cols}x${rows} ${speed}x: ${f.join(',')} ${show(rep)}`);
      }
    }
  }
  console.log('DISSOLVE meter (truecolor)\n  ' + lines.join('\n  '));
  assert.deepEqual(bad, []);
});

test('9000 dissolves: every ordered pair on 256-colour output (nearest256) at 120x40, 80x24 and 61x21, shell speeds 1x and 4x: every rule passes', () => {
  const lines = [], bad = [];
  for (const [a, b] of PAIRS) {
    for (const [cols, rows] of [[120, 40], [80, 24], [61, 21]]) {
      for (const speed of [1, 4]) {
        const rep = pairRun(a, b, cols, rows, { speed, reduce256: true });
        lines.push(`${a}>${b} ${cols}x${rows} ${speed}x 256-colour ${show(rep)}`);
        const f = failed(rep).filter((id) => speed === 1 || X1.includes(id));
        if (f.length) bad.push(`${a}>${b} ${cols}x${rows} ${speed}x: ${f.join(',')} ${show(rep)}`);
      }
    }
  }
  console.log('DISSOLVE meter (256 colours)\n  ' + lines.join('\n  '));
  assert.deepEqual(bad, []);
});

test('9000 dissolves control: a dissolve between two planted scenes that swap every cell between black and white each frame fails the meter, and the same run on the real pair passes', () => {
  const flip = (o) => { const f = (t, w, h, p) => { const k = Math.round(t * FPS) % 2; for (let i = 0; i < w * h; i++) { p.glyphs[i] = 32; p.colours[i] = 255; const c = (i + k + o) % 2 ? 0xffffff : 0x000000; p.fg[i] = c; p.bg[i] = c; } }; f.id = 'flip' + o; f.kind = 'cells'; f.rgb = true; return f; };
  const bad = pairRun('x', 'y', 60, 20, { scenes: [flip(0), flip(1)] });
  assert.ok(!bad.pass && failed(bad).includes('l1.x1'), show(bad));
  const ok = pairRun('rosette', 'bloomfall', 60, 20, {});
  assert.ok(ok.pass, show(ok));
});
