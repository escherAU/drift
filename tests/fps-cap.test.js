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
import { fileURLToPath } from 'node:url';
import { createApp, FULLCOLOUR_256_MAX_FPS } from '../src/app.js';
import { createRenderer } from '../src/renderer.js';
import { INSTALL_DIR } from '../src/cartridge/loader.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';
import { runAppDissolves, PLAN_4X } from './helpers-flash-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const pc = (x) => (100 * x).toFixed(1);

// An app with a spy on the renderer: paints[] is the fake-clock time (s) of every render call.
function rig({ mode, fps, cartridge = 'driftman-9000', loop = false }) {
  const paints = [];
  const clock = { ms: 0 };
  const inner = createRenderer();
  const renderer = { ...inner, render: (a) => { paints.push(clock.ms / 1000); return inner.render(a); } };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-fps-cap-'));
  const proc = fakeProc();
  const stdout = fakeStdout({ columns: 80, rows: 24 });
  if (loop) mock.timers.enable({ apis: ['setTimeout'] });
  const app = createApp({
    stdin: fakeStdin(), stdout, stderr: fakeStderr(), proc, env: mode === 'truecolor' ? { COLORTERM: 'truecolor' } : {}, configPath: path.join(tmp, 'config.json'),
    dirs: [{ dir: INSTALL_DIR, trusted: true }], autoLoop: loop, now: () => clock.ms, fps, seed: 2, renderer,
    startScreen: cartridge ? { screen: 'cartridge', cartridge, skipBoot: false } : null,
  });
  app.start();
  const advanceMs = (ms) => { if (loop) for (let i = 0; i < ms; i++) { clock.ms++; mock.timers.tick(1); } else { clock.ms += ms; app.tick(ms / 1000); } };
  const cleanup = () => { try { proc.emit('exit'); } catch { /* ignore */ } if (loop) mock.timers.reset(); fs.rmSync(tmp, { recursive: true, force: true }); };
  return { app, paints, clock, advanceMs, cleanup, stepMs: 1000 / fps };
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
});

// ---- mutation: the cap taken out of a copy of the tree must fail the 30 fps arm

function mutant() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-fps-mutant-'));
  fs.cpSync(path.join(REPO, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(REPO, 'cartridges'), path.join(dir, 'cartridges'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(dir, 'package.json'));
  const f = path.join(dir, 'src', 'app.js');
  const src = fs.readFileSync(f, 'utf8');
  const find = /export const FULLCOLOUR_256_MAX_FPS = 18;/;
  assert.equal((src.match(find) || []).length, 1, 'the cap is where this test expects it (src/app.js)');
  fs.writeFileSync(f, src.replace(find, 'export const FULLCOLOUR_256_MAX_FPS = 1000;'));
  return dir;
}

test('mutation: with the cap taken out (FULLCOLOUR_256_MAX_FPS = 1000), --fps 30 in 256 colours at 4x fails rule C (seeds 2 and 6, 80x24); the real tree passes the same runs', async () => {
  const dir = mutant();
  try {
    const bad = [], good = [];
    let worstBad = 0, worstGood = 0;
    for (const seed of [2, 6]) {
      const base = { mode: '256', fps: 30, viaLoop: true, seed, seconds: 82, plan: PLAN_4X, speed: 4 };
      const m = await runAppDissolves({ ...base, root: dir });
      const g = await runAppDissolves(base);
      for (const d of m.dissolves) { worstBad = Math.max(worstBad, d.report.c.worstFraction); const f = failedRules(d.report, { only: X1_RULE_IDS }); if (f.length) bad.push(`seed ${seed} ${d.from}>${d.to} ${f.join(',')} C ${pc(d.report.c.worstFraction)}`); }
      for (const d of g.dissolves) { worstGood = Math.max(worstGood, d.report.c.worstFraction); const f = failedRules(d.report, { only: X1_RULE_IDS }); if (f.length) good.push(`seed ${seed} ${d.from}>${d.to} ${f.join(',')}`); }
    }
    console.log(`MUTANT (no cap) 30 fps 256 4x seeds 2 and 6: worst C ${pc(worstBad)} %, ${bad.length} windows fail: ${bad.join(' | ')}; REAL TREE worst C ${pc(worstGood)} %`);
    assert.ok(bad.length >= 1, 'the mutant fails at least one window');
    assert.ok(bad.every((b) => b.includes('c')), 'it is the colour rule that fails');
    assert.ok(worstBad > 0.25);
    assert.deepEqual(good, [], 'the real tree passes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
