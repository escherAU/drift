// DRIFT-9 S1: the clocks the flash arms run on (tests/helpers-clock.js) and the timer seam they need (src/app.js: o.timer = { set, clear }).
// Every flash arm before DRIFT-9 ran on a grid: a timer fired exactly when asked. This file pins the pieces, both arms of every pair:
//   seam         no `timer` option: the loop runs on the global setTimeout (mock timers drive it); an injected timer sees set(start), set(after every loop) and clear(quit), the
//                loop never touches the global one, and the 750 ms quit backstop stays on the global one
//   clocks       grid fires exactly when asked and keys land before the tick of their frame; q156 fires on multiples of 15.625 ms (with a control that a grid clock FAILS: at least
//                30 % of ticks must differ from the grid); jitter is late by 0..16 ms, never early, the same for a seed and different for another
//   equivalence  the fire times the app's loop gets THROUGH THE SEAM equal ticks(fps, seconds), q156 and jitter, at 18 and 30 fps (and the control that they are not the grid's)
//   grid = today the grid clock reproduces today's reports exactly: the app arm (against the tick driver; against the old mock-timer driver the only difference is the frame
//                index and time a worst value is READ at, see below) and a shell-direct arm; a q156 run of each differs (the comparison can fail)
//   meter sees   on every clock, a synthetic strobe fed through the SAME sampler (the 18 Hz viewer grid) fails the rules and a calm source passes; sample timestamps are k * 1000 / 18
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { fakeStdin, fakeStdout, stuckStdout, fakeProc, fakeStderr } from './helpers.js';
import { createClock, createRun, QUANTUM_MS, JITTER_MS, VIEWER_HZ, CLOCK_MODES } from './helpers-clock.js';
import { createFlashMeter, failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { runAppWindow } from './helpers-flash-app.js';
import { walkReport, heldPresses } from './helpers-shelf.js';

const tmps = [];
const tmpCfg = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-clock-pin-')); tmps.push(d); return path.join(d, 'config.json'); };
process.on('exit', () => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

// a classic app (no cartridge) on a fake terminal; `over` goes into createApp
function makeApp(over = {}) {
  const stdout = over.stdout || fakeStdout({ columns: 40, rows: 12 });
  const stdin = fakeStdin(), proc = fakeProc();
  let ms = 0;
  const app = createApp({ stdin, stdout, stderr: fakeStderr(), proc, env: { COLORTERM: 'truecolor' }, configPath: tmpCfg(), dirs: [], autoLoop: true, seed: 1, fps: 18, now: () => ms, ...over });
  return { app, stdout, stdin, proc, setNow: (v) => { ms = v; } };
}

// ---- the seam

test('seam, default: no timer option, the loop runs on the global setTimeout (mock timers drive it)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { app, stdout, setNow } = makeApp();
    app.start();
    const before = stdout.writes.length;
    setNow(1); mock.timers.tick(1); // the 1 ms start timer: the first loop runs and draws
    assert.ok(stdout.writes.length > before, 'the loop ran on the global timer and drew a frame');
    const w1 = stdout.writes.length;
    setNow(56); mock.timers.tick(60); // the next loop timer
    assert.ok(stdout.writes.length > w1, 'and it re-armed itself on the global timer');
    app.quit(0);
    const w2 = stdout.writes.length;
    mock.timers.tick(500);
    assert.equal(stdout.writes.length, w2, 'quit cleared the global timer: nothing draws after it');
  } finally { mock.timers.reset(); }
});

test('seam, injected: set(start), set(after each loop), clear(quit); the global setTimeout is not touched by the loop; the 750 ms backstop stays on the global timer', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const calls = [];
    let next = 0;
    const pending = new Map();
    const timer = {
      set(fn, ms) { const h = { id: ++next, unref() { return h; } }; pending.set(h, fn); calls.push(['set', ms, h]); return h; },
      clear(h) { pending.delete(h); calls.push(['clear', 0, h]); },
    };
    const stdout = stuckStdout({ columns: 40, rows: 12, stuck: false }); // sticks later, so the restore write never calls back and only the backstop can exit
    const { app, proc, setNow } = makeApp({ stdout, timer });
    app.start();
    assert.deepEqual(calls.map((c) => [c[0], c[1]]), [['set', 1]], 'start asked for the 1 ms timer on the injected timer');
    const writes0 = stdout.writes.length;
    for (let i = 1; i <= 4; i++) {
      const [h] = [...pending.keys()];
      const fn = pending.get(h); pending.delete(h);
      setNow(i * (1000 / 18)); fn();
    }
    assert.equal(calls.filter((c) => c[0] === 'set').length, 5, 'after each of 4 loops a new set');
    assert.ok(calls.slice(1).every((c) => c[0] === 'set' && c[1] >= 1), 'each re-arm asks for at least 1 ms');
    assert.ok(stdout.writes.length > writes0, 'the loop drew on its own schedule');
    mock.timers.tick(20000);
    assert.equal(pending.size, 1, 'the global timer never ran the loop (mock time moved 20 s and nothing else was set)');
    const last = calls[calls.length - 1][2];
    stdout.stick();
    app.quit(0);
    assert.deepEqual([calls[calls.length - 1][0], calls[calls.length - 1][2] === last], ['clear', true], 'quit cleared the pending loop timer through the seam');
    assert.deepEqual(proc.exits, [], 'the restore write is stuck, so nothing has exited yet');
    mock.timers.tick(749);
    assert.deepEqual(proc.exits, [], 'not before 750 ms');
    mock.timers.tick(2);
    assert.deepEqual(proc.exits, [0], 'the 750 ms backstop (on the global timer, not the seam) ran');
    assert.equal(calls.filter((c) => c[1] === 750).length, 0, 'the backstop never went through the injected timer');
  } finally { mock.timers.reset(); }
});

// ---- the clocks

test('clock grid: a timer fires exactly when asked, and a key lands before the tick of its frame', async () => {
  const c = createClock({ mode: 'grid' });
  const fired = [];
  for (const d of [1, 5, 55.5556, 250, 1000]) c.timer.set(() => fired.push(c.now()), d);
  c.advanceTo(2000);
  assert.deepEqual(fired, [1, 5, 55.5556, 250, 1000]);
  // keys: at a frame boundary the key comes before the tick, the tick before the sample
  const g = createClock({ mode: 'grid' });
  const order = [];
  const frame = 1000 / 18;
  let n = 0;
  const loop = () => { order.push(`tick@${g.now().toFixed(3)}`); if (++n < 4) g.timer.set(loop, frame); };
  g.timer.set(loop, frame);
  await g.runUntil(frame * 3 + 1, { keys: [{ at: frame * 2, fn: () => order.push('key') }], onSample: ({ k }) => { if (k >= 1 && k <= 3) order.push(`sample${k}`); } });
  assert.deepEqual(order, ['tick@55.556', 'sample1', 'key', 'tick@111.111', 'sample2', 'tick@166.667', 'sample3'], 'at a tie: the key, then the tick, then the sample');
});

// the share of the loop's ticks (18 fps, 20 s) that fall off the grid; the control below must be able to see it
const offGridShare = (mode, seed = 1) => {
  const grid = createClock({ mode: 'grid' }).ticks(18, 20), c = createClock({ mode, seed }).ticks(18, 20);
  const n = Math.min(grid.length, c.length);
  let off = 0;
  for (let i = 0; i < n; i++) if (Math.abs(grid[i] - c[i]) > 1e-6) off++;
  return off / n;
};

test('clock q156: every fire is a multiple of 15.625 ms and never early, and at least 30 % of ticks are off the grid (the control: a grid clock reads 0 and would fail it)', () => {
  const c = createClock({ mode: 'q156' });
  for (const d of [1, 2, 10, 15.625, 16, 54.555, 55.5556, 100, 1234.5]) {
    const at = c.now();
    c.timer.set(() => {}, d);
    const due = c.sets[c.sets.length - 1].due;
    assert.ok(due >= at + d - 1e-9, `${d}: not early (${due})`);
    assert.ok(Math.abs(due / QUANTUM_MS - Math.round(due / QUANTUM_MS)) < 1e-9, `${d}: ${due} is a multiple of ${QUANTUM_MS}`);
  }
  for (const t of createClock({ mode: 'q156' }).ticks(18, 20)) assert.ok(Math.abs(t / QUANTUM_MS - Math.round(t / QUANTUM_MS)) < 1e-9, `tick ${t} on the 15.625 ms tick`);
  assert.ok(offGridShare('q156') >= 0.3, `q156: ${(offGridShare('q156') * 100).toFixed(0)} % of ticks off the grid`);
  assert.equal(offGridShare('grid'), 0, 'the control: a grid clock has no ticks off the grid, so a grid clock fails the "at least 30 %" check');
  assert.ok(!(offGridShare('grid') >= 0.3));
});

test('clock jitter: late by 0..16 ms and never early over many draws; the same for a seed, different for another; and the grid is not that', () => {
  const c = createClock({ mode: 'jitter', seed: 1 });
  for (let i = 0; i < 2000; i++) c.timer.set(() => {}, 1 + (i % 60));
  for (const s of c.sets) {
    assert.ok(s.due - s.at >= s.delay, `never early: asked ${s.delay}, fired after ${s.due - s.at}`);
    assert.ok(s.due - s.at < s.delay + JITTER_MS, `late by under ${JITTER_MS} ms: ${s.due - s.at - s.delay}`);
  }
  const late = c.sets.map((s) => s.due - s.at - s.delay);
  assert.ok(Math.max(...late) > 12 && Math.min(...late) < 4, 'the lateness really spreads over 0..16');
  const a = createClock({ mode: 'jitter', seed: 1 }).ticks(18, 10), b = createClock({ mode: 'jitter', seed: 1 }).ticks(18, 10), d = createClock({ mode: 'jitter', seed: 2 }).ticks(18, 10);
  assert.deepEqual(a, b, 'seed 1 twice: identical');
  assert.notDeepEqual(a, d, 'seed 1 against seed 2: different');
  assert.ok(offGridShare('jitter') > 0.9, 'a jitter clock is off the grid almost every tick');
  assert.throws(() => createClock({ mode: 'nope' }), /unknown clock mode/);
  assert.deepEqual(CLOCK_MODES, ['grid', 'q156', 'jitter']);
});

// ---- equivalence: the fire times the app's loop gets through the seam are ticks()

function loopFireTimes(mode, seed, fps, seconds) {
  const c = createClock({ mode, seed });
  const stdout = fakeStdout({ columns: 40, rows: 12 });
  const { app } = makeApp({ stdout, timer: c.timer, now: c.now, fps });
  app.start();
  c.advanceTo(seconds * 1000);
  const dues = c.sets.map((s) => s.due).filter((x) => x <= seconds * 1000 + 1e-6);
  app.quit(0);
  return dues;
}

for (const [mode, seed] of [['q156', 1], ['jitter', 1], ['jitter', 7], ['grid', 1]]) {
  for (const fps of [18, 30]) {
    test(`equivalence ${mode} seed ${seed} at ${fps} fps: the fire times the app's loop gets through the seam equal ticks() exactly`, () => {
      const through = loopFireTimes(mode, seed, fps, 6);
      const direct = createClock({ mode, seed }).ticks(fps, 6);
      assert.ok(through.length > 5 * fps && through.length === direct.length, `${through.length} through the seam, ${direct.length} from ticks()`);
      assert.deepEqual(through, direct);
      if (mode !== 'grid') {
        const grid = createClock({ mode: 'grid' }).ticks(fps, 6);
        assert.notDeepEqual(through, grid, 'the control: the seam really ran on the clock, not on a grid');
      }
    });
  }
}

// ---- grid = today

// the worst value a rule READ is the same on both drivers; WHERE it was read (a frame index and its time) is the one thing the old mock-timer driver can move: it steps 1 / 20 ms at a time and
// compares floats, so some loop ticks land 0.05 ms after a frame boundary and are read a frame later. Those two fields are masked for that comparison only.
const maskReads = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'frame' || k === 'timeS' ? undefined : v)));

test('grid = today, app arm: the grid clock through the seam gives the same report as the tick driver (exactly), in truecolor and 256 colours; against the old mock-timer driver every value is the same but the frame a worst value is read at', async () => {
  for (const mode of ['truecolor', '256']) {
    const o = { cols: 60, rows: 20, pickAt: 5, before: 4, after: 2, mode };
    const tick = await runAppWindow(o), grid = await runAppWindow({ ...o, clock: 'grid' });
    assert.equal(JSON.stringify(grid.report), JSON.stringify(tick.report), `${mode}: grid clock == tick driver, byte for byte`);
    assert.deepEqual(grid.ids, tick.ids);
    assert.equal(grid.frames, tick.frames);
    const mocked = await runAppWindow({ ...o, viaLoop: true });
    assert.equal(JSON.stringify(maskReads(grid.report)), JSON.stringify(maskReads(mocked.report)), `${mode}: grid clock == mock-timer driver, every value`);
  }
  const q = await runAppWindow({ cols: 60, rows: 20, pickAt: 5, before: 4, after: 2, clock: 'q156' });
  const g = await runAppWindow({ cols: 60, rows: 20, pickAt: 5, before: 4, after: 2, clock: 'grid' });
  assert.notEqual(JSON.stringify(q.report), JSON.stringify(g.report), 'the control: a q156 run reads differently, so the comparison can fail');
});

test('grid = today, shell-direct arm: the shelf walk on the grid clock gives the same report as the old loop (exactly) at two sizes and both arts; a q156 run differs', () => {
  for (const [cols, rows] of [[80, 24], [40, 10]]) {
    for (const art of ['dense', 'delza']) {
      const p = heldPresses();
      const old = walkReport(cols, rows, p, { art, seconds: 6 });
      const grid = walkReport(cols, rows, p, { art, seconds: 6, clock: 'grid' });
      assert.equal(JSON.stringify(grid.rep), JSON.stringify(old.rep), `${cols}x${rows} ${art}: grid clock == old loop`);
      assert.deepEqual(grid.log.map((l) => [l.t, l.dir, l.indexAfter]), old.log.map((l) => [l.t, l.dir, l.indexAfter]));
      const q = walkReport(cols, rows, p, { art, seconds: 6, clock: 'q156' });
      assert.notEqual(JSON.stringify(q.rep), JSON.stringify(old.rep), `${cols}x${rows} ${art}: the control, q156 reads differently`);
    }
  }
});

// ---- the meter sees, on every clock, through the same sampler

const COLS = 40, ROWS = 12;
// a shell-like source whose picture flips between full white and black on every tick (a strobe at the paint rate), or stays grey (calm)
function fakeShell(strobe) {
  let on = false;
  const f = { cols: COLS, rows: ROWS, glyphs: new Uint32Array(COLS * ROWS).fill(0x2588), fg: new Uint32Array(COLS * ROWS), bg: new Uint32Array(COLS * ROWS) };
  const paint = () => { const v = strobe ? (on ? 0xffffff : 0x000000) : 0x808080; f.fg.fill(v); f.bg.fill(v); };
  paint();
  return { tick() { on = !on; paint(); }, frame: () => f };
}
const runSource = (mode, strobe, seconds = 8) => {
  const run = createRun({ clock: mode, fps: 18 });
  const sh = run.sh(fakeShell(strobe));
  const meter = run.meter(createFlashMeter(COLS, ROWS, 18));
  for (const k of run.steps(seconds)) { meter.push(sh.frame()); sh.tick(1 / 18); }
  return { rep: meter.report(), run };
};

for (const mode of CLOCK_MODES) {
  test(`meter sees on the ${mode} clock: a strobe fed through the same sampler fails the rules, a calm source passes, and the sampler reads on the 18 Hz grid`, () => {
    const bad = runSource(mode, true), calm = runSource(mode, false);
    assert.deepEqual(failedRules(calm.rep, { only: X1_RULE_IDS }), [], `${mode}: a calm source passes`);
    const f = failedRules(bad.rep, { only: X1_RULE_IDS });
    assert.ok(f.includes('l1.x1') && f.includes('l3'), `${mode}: the strobe fails L1 and L3 (failed: ${f.join(',')})`);
    assert.ok(Math.abs(bad.run.sampled - 8 * VIEWER_HZ) <= 2, `${mode}: ${bad.run.sampled} samples for 8 s, one per 1/18 s`);
    assert.ok(bad.run.paints >= 8 * 17, 'and the shell painted about 18 times a second');
  });
}

test('the sampler reads on the 18 Hz viewer grid on every clock: sample k is at exactly k * 1000 / 18 ms, whatever the loop does', async () => {
  for (const mode of CLOCK_MODES) {
    const c = createClock({ mode, seed: 3 });
    const { app } = makeApp({ timer: c.timer, now: c.now });
    app.start();
    const seen = [];
    await c.runUntil(3000, { onSample: ({ k, t }) => seen.push([k, t, c.now()]) });
    app.quit(0);
    assert.ok(seen.length >= 54, `${mode}: ${seen.length} samples in 3 s`);
    seen.forEach(([k, t, now], i) => { assert.equal(k, i); assert.equal(t, (k * 1000) / 18); assert.ok(Math.abs(now - t) < 1e-6, 'the clock stands at the sample time (to a float ulp)'); });
  }
});

test('createRun: without a clock it is the identity, with one the loop tick is the clock\'s step (q156: a multiple of 15.625 ms) and the other ticks pass through', () => {
  const log = [];
  const sh = { tick: (dt) => log.push(dt), frame: () => ({}) };
  const id = createRun({ clock: null, fps: 18 });
  const ish = id.sh(sh);
  ish.tick(1 / 18); ish.tick(0.3);
  assert.deepEqual(log.splice(0), [1 / 18, 0.3]);
  const q = createRun({ clock: 'q156', fps: 18 });
  const qsh = q.sh(sh);
  for (let i = 0; i < 40; i++) qsh.tick(1 / 18);
  qsh.tick(0.3);
  const dts = log.splice(0);
  const loopDts = dts.slice(0, 40);
  assert.ok(loopDts.every((d) => Math.abs((d * 1000) / QUANTUM_MS - Math.round((d * 1000) / QUANTUM_MS)) < 1e-6), 'every loop step is a whole number of 15.625 ms ticks');
  assert.ok(loopDts.filter((d) => Math.abs(d - 1 / 18) > 1e-6).length >= 12, 'most steps differ from 1/18');
  assert.equal(dts[40], 0.3, 'a tick that is not the loop step passes through');
  assert.ok(Math.abs(q.t() - (loopDts.reduce((a, b) => a + b, 0) + 0.3)) < 1e-9, 'the wall time is the sum of the steps');
  assert.ok(Math.abs((loopDts.reduce((a, b) => a + b, 0) * 1000) / 40 - 1000 / 18) < 4, 'and the loop still averages 18 a second');
});
