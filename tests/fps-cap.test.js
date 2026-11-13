// DRIFT-8 r5: the paint-rate cap for full-colour scenes in 256-colour output (src/app.js, FULLCOLOUR_256_MAX_FPS = 18). The flash arms that rely on it are in
// tests/flash-256-fps.test.js (the Driftman 9000 at 30 and 24 fps judged by the meter). This file pins the cap itself, both arms of each pair:
//   held:      256 colours + a full-colour scene on screen, asked for more than 18 fps (30, 24, 20) -> never more than 18 paints in any second, by the app's own loop (what ships) and by
//              tick() (what the tests and tools drive); time still runs at real speed (the dissolve takes its 2 real seconds, the scene clock is not slowed).
//   unchanged: truecolor at 30 fps (every tick painted, the loop at 30 a second), a palette cartridge (Night Drive) and Classic in 256 colours at 30 fps, and 256 colours at any
//              rate at or below the cap (18, 12, 7, 3), all of which paint exactly as before.
// Then the mutation: with the cap taken out of a copy of the tree (FULLCOLOUR_256_MAX_FPS = 30), the 30 fps 256-colour arm fails rule C.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp, FULLCOLOUR_256_MAX_FPS } from '../src/app.js';
import { createRenderer } from '../src/renderer.js';
import { INSTALL_DIR, discoverCartridges } from '../src/cartridge/loader.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';
import { runAppDissolves, PLAN_4X, PLAN_1X } from './helpers-flash-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const pc = (x) => (100 * x).toFixed(1);

// An app with a spy on the renderer: paints[] is the fake-clock time (s) of every render call.
function rig({ mode, fps, cartridge = 'driftman-9000', loop = false, create = createApp }) {
  const paints = [], fc = [], tags = []; // fc[i]: was paint i a full-colour frame; tags[i]: what the test was doing (r.tag.cur) when it was painted
  const tag = { cur: 'real' };
  const stdin = fakeStdin();
  const clock = { ms: 0 };
  const inner = createRenderer();
  const renderer = { ...inner, render: (a) => { paints.push(clock.ms / 1000); fc.push(a.fg !== undefined); tags.push(tag.cur); return inner.render(a); } };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-fps-cap-'));
  const proc = fakeProc();
  const stdout = fakeStdout({ columns: 80, rows: 24 });
  if (loop) mock.timers.enable({ apis: ['setTimeout'] });
  const app = create({
    stdin, stdout, stderr: fakeStderr(), proc, env: mode === 'truecolor' ? { COLORTERM: 'truecolor' } : {}, configPath: path.join(tmp, 'config.json'),
    dirs: [{ dir: INSTALL_DIR, trusted: true }], autoLoop: loop, now: () => clock.ms, fps, seed: 2, renderer,
    startScreen: cartridge ? { screen: 'cartridge', cartridge, skipBoot: false } : null,
  });
  app.start();
  const advanceMs = (ms) => { if (loop) for (let i = 0; i < ms; i++) { clock.ms++; mock.timers.tick(1); } else { clock.ms += ms; app.tick(ms / 1000); } };
  const cleanup = () => { try { proc.emit('exit'); } catch { /* ignore */ } if (loop) mock.timers.reset(); fs.rmSync(tmp, { recursive: true, force: true }); };
  return { app, paints, fc, tags, tag, stdin, clock, advanceMs, cleanup, stepMs: 1000 / fps };
}

// run until the cartridge's program is running (or, with no cartridge, for 0.5 s), stepping one frame of the requested rate at a time
async function toRunning(r, cartridge = true) {
  for (let i = 0; i < 4000; i++) {
    r.advanceMs(Math.round(r.stepMs));
    if (i % 4 === 0) await new Promise((res) => setImmediate(res));
    const sh = r.app.getState().shell;
    if (cartridge ? sh && sh.screen === 'running' : i > 10) return;
  }
  throw new Error('never reached running');
}

// paints per second over `seconds` of the fake clock after the point it is called; returns { perSecond: [..], max, total }
async function measure(r, seconds) {
  const from = r.clock.ms / 1000, n0 = r.paints.length;
  const end = r.clock.ms + seconds * 1000;
  let i = 0;
  while (r.clock.ms < end) { r.advanceMs(Math.round(r.stepMs)); if (++i % 8 === 0) await new Promise((res) => setImmediate(res)); }
  const mine = r.paints.slice(n0);
  const perSecond = Array.from({ length: seconds }, (_, s) => mine.filter((t) => t >= from + s && t < from + s + 1).length);
  // the busiest 1 s window anywhere (not just the aligned ones)
  let max = 0;
  for (let a = 0, b = 0; b < mine.length; b++) { while (mine[b] - mine[a] >= 1) a++; max = Math.max(max, b - a + 1); }
  return { perSecond, max, total: mine.length };
}

test('the cap is 18 frames a second, the rate every flash test meters at', () => {
  assert.equal(FULLCOLOUR_256_MAX_FPS, 18);
});

// ---- held: 256 colours + full colour on screen, asked for more than 18

for (const loop of [true, false]) {
  for (const fps of [30, 24, 20]) {
    test(`256 colours, full-colour scene, --fps ${fps}, ${loop ? "the app's own loop" : 'tick()'}: never more than ${FULLCOLOUR_256_MAX_FPS} paints in any second (and not starved)`, async () => {
      const r = rig({ mode: '256', fps, loop });
      try {
        await toRunning(r);
        const m = await measure(r, 8);
        console.log(`PAINTS 256 full-colour --fps ${fps} ${loop ? 'loop' : 'tick'}: per second ${m.perSecond.join(' ')}, busiest 1 s window ${m.max}`);
        assert.ok(m.max <= FULLCOLOUR_256_MAX_FPS + (loop ? 1 : 0), `busiest second ${m.max} paints`); // the loop's timer is whole milliseconds: one frame of jitter at a window edge
        assert.ok(m.total >= 8 * 8, `${m.total} paints in 8 s: the cap must thin, not starve`);
        if (loop) assert.ok(m.total >= 8 * 16, `${m.total} paints in 8 s: the loop should reach the cap`);
      } finally { r.cleanup(); }
    });
  }
}

// ---- unchanged

test('truecolor, full-colour scene, --fps 30: every tick is painted, and the loop paints 30 a second (the cap is for 256 colours only)', async () => {
  for (const loop of [false, true]) {
    const r = rig({ mode: 'truecolor', fps: 30, loop });
    try {
      await toRunning(r);
      const m = await measure(r, 4);
      console.log(`PAINTS truecolor full-colour --fps 30 ${loop ? 'loop' : 'tick'}: per second ${m.perSecond.join(' ')}`);
      assert.ok(m.perSecond.every((c) => c >= 29 && c <= 31), `${loop ? 'loop' : 'tick'}: ${m.perSecond.join(' ')}`);
    } finally { r.cleanup(); }
  }
});

test('a palette cartridge (Night Drive) in 256 colours at --fps 30 is painted at 30 a second, loop and tick()', async () => {
  for (const loop of [false, true]) {
    const r = rig({ mode: '256', fps: 30, cartridge: 'night-drive', loop });
    try {
      await toRunning(r);
      const m = await measure(r, 4);
      console.log(`PAINTS 256 palette cartridge --fps 30 ${loop ? 'loop' : 'tick'}: per second ${m.perSecond.join(' ')}`);
      assert.ok(m.perSecond.every((c) => c >= 29 && c <= 31), `${loop ? 'loop' : 'tick'}: ${m.perSecond.join(' ')}`);
    } finally { r.cleanup(); }
  }
});

test('Classic in 256 colours at --fps 30 is painted at 30 a second, loop and tick()', async () => {
  for (const loop of [false, true]) {
    const r = rig({ mode: '256', fps: 30, cartridge: null, loop });
    try {
      await toRunning(r, false);
      const m = await measure(r, 4);
      console.log(`PAINTS 256 Classic --fps 30 ${loop ? 'loop' : 'tick'}: per second ${m.perSecond.join(' ')}`);
      assert.ok(m.perSecond.every((c) => c >= 29 && c <= 31), `${loop ? 'loop' : 'tick'}: ${m.perSecond.join(' ')}`);
    } finally { r.cleanup(); }
  }
});

test('256 colours, full-colour scene, at or below the cap (--fps 18, 12, 7, 3): the loop paints at the rate asked for', async () => {
  for (const fps of [18, 12, 7, 3]) {
    const r = rig({ mode: '256', fps, loop: true });
    try {
      await toRunning(r);
      const secs = fps >= 12 ? 5 : 8;
      const m = await measure(r, secs);
      console.log(`PAINTS 256 full-colour --fps ${fps} loop: per second ${m.perSecond.join(' ')}`);
      assert.ok(Math.abs(m.total / secs - fps) <= 1, `--fps ${fps}: ${m.total / secs} paints a second`);
    } finally { r.cleanup(); }
  }
});

// ---- time still runs at real speed: the dissolve takes its 2 real seconds and the program holds 60 s whatever the paint rate

test('the cap thins painting, not time: at --fps 30 in 256 colours the switches come 62 s apart at 1x and 17 s apart at 4x, as at 18 fps', async () => {
  const x4 = await runAppDissolves({ mode: '256', fps: 30, viaLoop: true, seed: 2, seconds: 46, plan: PLAN_4X, speed: 4, count: 2 });
  assert.ok(x4.dissolves.length >= 2);
  assert.ok(Math.abs(x4.dissolves[1].sinceLast - 17) <= 0.1, `4x: ${x4.dissolves[1].sinceLast} s between switches, want 17 = 60 / 4 + 2`);
  const x1 = await runAppDissolves({ mode: '256', fps: 30, viaLoop: true, seed: 2, seconds: 150, plan: PLAN_1X, speed: 1, count: 2 });
  assert.ok(x1.dissolves.length >= 2);
  assert.ok(Math.abs(x1.dissolves[1].sinceLast - 62) <= 0.1, `1x: ${x1.dissolves[1].sinceLast} s between switches, want 62 = 60 + 2`);
});

// ---- held time is never dropped (DRIFT-8 r6): a step that does not advance time (tick(0), a negative dt) leaves the held time pending

// the paint times of a run of 10 ms ticks, with `extra` extra ticks (a list of dt) after each real one
async function paintsOf(extra, create = createApp) {
  const r = rig({ mode: '256', fps: 30, loop: false, create });
  try {
    await toRunning(r);
    const n0 = r.paints.length;
    for (let i = 0; i < 400; i++) {
      r.advanceMs(10);
      r.tag.cur = 'extra';
      for (const dt of extra) r.app.tick(dt);
      r.tag.cur = 'real';
      if (i % 20 === 0) await new Promise((res) => setImmediate(res));
    }
    // only the paints of the real (dt > 0) ticks: a tick(0) is an explicit redraw and may paint on its own, that is not what is pinned
    return r.paints.slice(n0).filter((_, i) => r.tags[n0 + i] === 'real');
  } finally { r.cleanup(); }
}

test('tick(0) and tick(-dt) between real ticks lose no held time: the paints of the real ticks land at the same moments as without them', async () => {
  const plain = await paintsOf([]);
  assert.ok(plain.length >= 4 * 16, `${plain.length} paints in 4 s without the extra ticks`);
  for (const extra of [[0], [-0.005], [0, -0.01, 0]]) {
    const withExtra = await paintsOf(extra);
    assert.deepEqual(withExtra, plain, `extra ticks ${JSON.stringify(extra)} moved the paints`);
  }
});

// ---- mutation: the cap taken out of a copy of the tree must fail the 30 fps arm

// a copy of the tree with one source replacement made in src/app.js (and `extra` ones, { file, find, replacement }, file relative to src/); returns { dir, create }
async function mutant(find, replacement, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-fps-mutant-'));
  fs.cpSync(path.join(REPO, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(REPO, 'cartridges'), path.join(dir, 'cartridges'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(dir, 'package.json'));
  for (const e of [{ file: 'app.js', find, replacement }, ...extra]) {
    const g = path.join(dir, 'src', e.file);
    const raw = fs.readFileSync(g, 'utf8');
    const crlf = raw.includes('\r\n');
    const src = raw.replace(/\r\n/g, '\n');
    assert.equal(src.split(e.find).length, 2, `the mutated line is where this test expects it (src/${e.file}): ${e.find}`);
    const out = src.replace(e.find, () => e.replacement);
    fs.writeFileSync(g, crlf ? out.replace(/\n/g, '\r\n') : out);
  }
  const f = path.join(dir, 'src', 'app.js');
  const mod = await import(pathToFileURL(f).href);
  return { dir, create: mod.createApp };
}
const CAP_OUT = ['export const FULLCOLOUR_256_MAX_FPS = 18;', 'export const FULLCOLOUR_256_MAX_FPS = 1000;'];
const RESET_RESTORED = ['dt = held;\n      held = 0;\n    } else dt = takeHeld(dt);', 'dt = held;\n    }\n    held = 0;'];
const FASTER_FOIL = { file: 'shell/foil.js', find: 'export const FOIL_STEPS_PER_SECOND = 6;', replacement: 'export const FOIL_STEPS_PER_SECOND = 30;' };
const NEVER_LIFTS = ['fullColourOn = a.fg !== undefined;', 'fullColourOn = fullColourOn || a.fg !== undefined;'];

test('mutation: the reset of the held time restored (held = 0 on every non-gated path) fails the tick(0) test; the real tree passes it', async () => {
  const m = await mutant(...RESET_RESTORED);
  try {
    const plain = await paintsOf([], m.create);
    const withZero = await paintsOf([0], m.create);
    console.log(`MUTANT (held reset restored): ${plain.length} paints in 4 s with plain ticks, ${withZero.length} with tick(0) after each`);
    assert.notDeepEqual(withZero, plain, 'with the reset restored, tick(0) moves the paints');
  } finally { fs.rmSync(m.dir, { recursive: true, force: true }); }
});

test('mutation: with the cap taken out of a copy of the tree (FULLCOLOUR_256_MAX_FPS = 1000), --fps 30 in 256 colours at 4x fails rule C (seeds 2 and 6, 80x24); the real tree passes the same runs', async () => {
  const { dir } = await mutant(...CAP_OUT);
  try {
    const bad = [], good = [];
    let worstBad = 0, worstGood = 0;
    for (const seed of [2, 6]) {
      const base = { mode: '256', fps: 30, viaLoop: true, seed, seconds: 82, plan: PLAN_4X, speed: 4 };
      const m = await runAppDissolves({ ...base, root: dir });
      const g = await runAppDissolves(base);
      for (const d of m.dissolves) { worstBad = Math.max(worstBad, d.report.c.worstFraction); const f = failedRules(d.report, { only: X1_RULE_IDS }); if (f.length) bad.push({ seed, from: d.from, to: d.to, ids: f }); }
      for (const d of g.dissolves) { worstGood = Math.max(worstGood, d.report.c.worstFraction); const f = failedRules(d.report, { only: X1_RULE_IDS }); if (f.length) good.push({ seed, from: d.from, to: d.to, ids: f }); }
    }
    console.log(`MUTANT (no cap) 30 fps 256 4x seeds 2 and 6: worst C ${pc(worstBad)} %, ${bad.length} windows fail: ${bad.map((b) => `seed ${b.seed} ${b.from}>${b.to} ${b.ids.join(',')}`).join(' | ')}; REAL TREE worst C ${pc(worstGood)} %`);
    assert.ok(bad.length >= 1, 'the mutant fails at least one window');
    // the rule that fails is rule C, named by its id (the failedRules ids list contains 'c' in every failing window), not a substring of some other label
    assert.ok(bad.every((b) => b.ids.includes('c')), `rule C (id 'c') is in every failing window's ids: ${JSON.stringify(bad.map((b) => b.ids))}`);
    assert.ok(worstBad > 0.25);
    assert.deepEqual(good, [], 'the real tree passes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the shelf (DRIFT-8 r6): the README says the cap holds for the shelf while the 9000's holo foil card is on screen, and lifts as soon as a frame without
// full-colour cells is shown. Both are pinned here, through the app's own loop and through tick().

const RIGHT = String.fromCharCode(27) + '[C';
const SHELF = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.map((c) => c.id).sort((a, b) => (a === 'classic' ? -1 : b === 'classic' ? 1 : 0));
const NINE = SHELF.indexOf('driftman-9000');

// Classic, then `l` opens the library (from Classic), then right arrows to the 9000's card; every key lets the shelf scrub
async function toShelfOnNine(r) {
  await toRunning(r, false);
  r.stdin.emit('data', 'l');
  r.advanceMs(1500);
  for (let k = 0; k < NINE; k++) { r.stdin.emit('data', RIGHT); r.advanceMs(700); await new Promise((res) => setImmediate(res)); }
  r.advanceMs(1500);
}
// the paints of the window [from, ...) split by whether they were full-colour frames
const windowOf = (r, n0) => ({ all: r.paints.slice(n0), fc: r.fc.slice(n0) });

// The shelf at rest paints at the foil's own pace (FOIL_STEPS_PER_SECOND = 6 steps a second; 8 to 10 paints a second measured), far under the cap, so on the real tree the cap
// does not bind on the shelf and the first arm is a ceiling, not a proof that the cap acts there. To show the cap does hold the shelf when something would paint faster, the same
// run is made on two copies of the tree whose foil steps 30 times a second: with the cap in place the shelf is held to 18 (and reaches it); with the cap taken out it paints faster.
const SHELF_ARMS = [
  { label: 'real tree', loops: [true, false], create: createApp },
  { label: 'MUTANT foil at 30 steps a second, cap in place', loops: [true, false], edits: [CAP_OUT[0], CAP_OUT[0]], binds: true },
  { label: 'MUTANT foil at 30 steps a second, cap taken out', loops: [true], edits: CAP_OUT, exceeds: true },
];
for (const arm of SHELF_ARMS) {
  for (const loop of arm.loops) {
    test(`shelf, 256 colours, --fps 30, ${loop ? "the app's own loop" : 'tick()'}, ${arm.label}: with the 9000's foil card on screen the shelf is painted at ${FULLCOLOUR_256_MAX_FPS} a second at most`, async () => {
      assert.ok(NINE > 0, `the 9000 is on the shelf: ${SHELF.join(', ')}`);
      const mut = arm.edits ? await mutant(arm.edits[0], arm.edits[1], [FASTER_FOIL]) : null;
      const r = rig({ mode: '256', fps: 30, cartridge: null, loop, create: arm.create || mut.create });
      try {
        await toShelfOnNine(r);
        const n0 = r.paints.length;
        const m = await measure(r, 6);
        const w = windowOf(r, n0);
        const fcShare = w.fc.filter(Boolean).length / Math.max(1, w.fc.length);
        console.log(`PAINTS shelf on the 9000 256 --fps 30 ${loop ? 'loop' : 'tick'} ${arm.label}: per second ${m.perSecond.join(' ')}, busiest 1 s window ${m.max}, full-colour frames ${(100 * fcShare).toFixed(0)} %`);
        assert.ok(fcShare >= 0.9, `the foil card is on screen: ${(100 * fcShare).toFixed(0)} % of the frames carry full-colour cells`);
        if (arm.exceeds) assert.ok(m.max > FULLCOLOUR_256_MAX_FPS + 4, `with the cap taken out and a faster shelf, it paints faster than ${FULLCOLOUR_256_MAX_FPS}: busiest second ${m.max}`);
        else {
          assert.ok(m.max <= FULLCOLOUR_256_MAX_FPS + (loop ? 1 : 0), `busiest second ${m.max} paints`);
          assert.ok(m.total >= 6 * (arm.binds ? (loop ? 16 : 13) : 5), `${m.total} paints in 6 s: ${arm.binds ? 'the cap should be what holds a faster shelf, at about 18' : 'the shelf must not be starved'}`);
        }
      } finally { r.cleanup(); if (mut) fs.rmSync(mut.dir, { recursive: true, force: true }); }
    });
  }
}

for (const create of [createApp, null]) {
  for (const loop of [true, false]) {
    const label = create ? 'real tree' : 'MUTANT cap never lifts';
    if (!create && !loop) continue;
    test(`shelf to Classic, 256 colours, --fps 30, ${loop ? "the app's own loop" : 'tick()'}, ${label}: once a frame without full-colour cells is shown the cap lifts and Classic paints at 30 a second`, async () => {
      const mut = create ? null : await mutant(...NEVER_LIFTS);
      const r = rig({ mode: '256', fps: 30, cartridge: null, loop, create: create || mut.create });
      try {
        await toShelfOnNine(r);
        const held = await measure(r, 3);
        assert.ok(held.max <= FULLCOLOUR_256_MAX_FPS + (loop ? 1 : 0), `on the shelf first: busiest second ${held.max}`);
        r.stdin.emit('data', 'l'); // back to Classic
        r.advanceMs(1500);
        const n0 = r.paints.length;
        const m = await measure(r, 4);
        const w = windowOf(r, n0);
        console.log(`PAINTS Classic after the foil shelf 256 --fps 30 ${loop ? 'loop' : 'tick'} ${label}: per second ${m.perSecond.join(' ')}, full-colour frames ${w.fc.filter(Boolean).length}`);
        assert.equal(w.fc.filter(Boolean).length, 0, 'the frames after leaving are palette frames');
        if (create) assert.ok(m.perSecond.every((c) => c >= 29 && c <= 31), `${loop ? 'loop' : 'tick'}: ${m.perSecond.join(' ')}`);
        else assert.ok(m.perSecond.some((c) => c < 29), `with the cap never lifting Classic stays throttled: ${m.perSecond.join(' ')}`);
      } finally { r.cleanup(); if (mut) fs.rmSync(mut.dir, { recursive: true, force: true }); }
    });
  }
}
