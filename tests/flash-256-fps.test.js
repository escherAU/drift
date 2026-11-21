// DRIFT-8 r5: the Driftman 9000 on the REAL app at the frame rates a user can ask for (--fps 5 to 30, DRIFT_FPS), judged by the flash meter with every rule (L1, L2, L3, R and the
// four-axis colour rule C) at 1x and at real 4x (the `+` key pressed four times). Everything before r5 metered at 18 fps only (the default), and the finding was that the same
// scenes read differently when the app is asked for more: in 256 colours at --fps 30 and 4x, Rosette alone reads up to 29.6 % on rule C, Bloomfall alone up to 34.7 % (16 of 80
// dissolve windows over seeds 1-16, worst 29.2 %), and 24 fps passes only by a thin margin (worst 23.8 %). Truecolor at 30 fps passes (worst 7.2 %): it is the snapping of two
// close colours to neighbouring palette indexes that, sampled more often, flips more pixels per second and so counts more transitions.
//
// The house rule that closes it (README, Photosensitivity): a full-colour scene in 256-colour output is never painted faster than FULLCOLOUR_256_MAX_FPS (18, the rate everything is
// metered at) whatever --fps asks for. These arms drive createApp the way the shipped app runs: its own timer loop (autoLoop, setTimeout mocked, a fake clock moved 1 ms at a time, the app told --fps N), a fake
// terminal, the bytes read back by an independent terminal reader. The meter reads one screen per 1 / fps of that clock (a screen that was not repainted is read again, as a
// viewer sees it). tests/fps-cap.test.js pins the paint rate itself, the tick() path the tools use, and the mutation (the cap taken out must fail the 30 fps arm).
//
// What is covered: 256 colours at 30 and 24 fps (4x and 1x), 80x24 on many seeds, 120x40 (2.5 times the cells) and 61x21 (two thirds) on fewer, the menu jump at 4x at 30 fps,
// and truecolor at 30 fps as the arm the cap must NOT change (it passes today and keeps passing, and tests/fps-cap.test.js pins that truecolor still paints every tick).
// Every dissolve window is lead 4 s + dissolve + tail 4 s, so each window holds Rosette, Cortex or Bloomfall on its own for 4 s before and after the dissolve.
// Each arm prints its worst value per rule and the margin to the 25 % limit.
// DRIFT-9 item 2 and part 3 (a) (the end of the file): the floor of --fps is 8 (MIN_FPS, src/app.js), chosen by a sweep of every integer fps 5-30 on all three clocks (the exact grid, q156, jitter).
// At 8 fps, 256 colours, real 4x, 61x21 seeds 1-8 passes every rule on the exact grid, the q156 clock and the jitter clock, with L3 inside the meter's own limit (STEP_FRACTION, 30 %: the rule's
// stated limit, not an allowance on top of it); fps 7 at 61x21 seed 6 on the q156 clock FAILS L3 (the control). The floor was 5 before: fps 4 failed on the exact grid (30.5 %), and 5 failed on q156.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAppDissolves, runAppWindow, PLAN_4X, PLAN_1X } from './helpers-flash-app.js';
import { failedRules, X1_RULE_IDS, STEP_FRACTION } from './helpers-flash.js';
import { MIN_FPS } from '../src/app.js';

const pc = (x) => (100 * x).toFixed(1);
const LIMIT = 0.25;
const SEEDS_16 = Array.from({ length: 16 }, (_, i) => i + 1);
const SEEDS_24 = [2, 3, 5, 6, 14, 1];       // the seeds that read highest at 30 fps, plus 1
const SEEDS_120 = [2, 6, 14];                // 120x40 costs 2.5 times 80x24 per run
const SEEDS_61 = [2, 3, 5, 6];               // 61x21 costs two thirds
const SEEDS_1X = [2, 6];                     // a 1x run is 205 s of the clock
const SEEDS_TC = [1, 2, 6, 14];

const worstOf = (rep) => ({ l1: rep.l1.x1.worstFraction, l2: rep.l2.x1.worstFraction, l3: rep.l3.worstFraction, r: rep.r.x1.worstFraction, c: rep.c.worstFraction });
const showWorst = (w) => `L1 ${pc(w.l1)} L2 ${pc(w.l2)} L3 ${pc(w.l3)} R ${pc(w.r)} C ${pc(w.c)}`;

// one arm: every seed, every dissolve window of the run, every X1 rule; prints the worst per rule and the margin to the limit
// DRIFT-9 item 4: `clock` ({ mode: 'q156' | 'jitter', seed }, tests/helpers-clock.js) puts the app's own loop on that clock instead of the mocked setTimeout; none is the old exact grid.
async function arm({ cols, rows, mode, fps, speed, seeds, clock = null }) {
  const bad = [], worst = { l1: 0, l2: 0, l3: 0, r: 0, c: 0 };
  let windows = 0;
  for (const seed of seeds) {
    const res = await runAppDissolves({ cols, rows, mode, fps, seed, seconds: speed === 4 ? 82 : 205, plan: speed === 4 ? PLAN_4X : PLAN_1X, speed, viaLoop: true, clock: clock && clock.mode, clockSeed: clock && clock.seed });
    const want = speed === 4 ? 4 : 3;
    assert.ok(res.dissolves.length >= want, `${cols}x${rows} ${mode} ${fps} fps ${speed}x seed ${seed}: expected at least ${want} dissolves, the app made ${res.dissolves.length}`);
    for (const d of res.dissolves) {
      windows++;
      const w = worstOf(d.report);
      for (const k of Object.keys(worst)) worst[k] = Math.max(worst[k], w[k]);
      const f = failedRules(d.report, { only: X1_RULE_IDS });
      if (f.length) bad.push(`seed ${seed} ${d.from}>${d.to}: ${f.join(',')} ${showWorst(w)}`);
    }
  }
  const top = Math.max(...Object.values(worst));
  const tag = `${cols}x${rows} ${mode} ${fps} fps ${speed}x${clock ? ` on the ${clock.mode} clock` : ''}, ${seeds.length} seeds, ${windows} windows`;
  console.log(`FPS ARM ${tag}: worst ${showWorst(worst)} | margin to ${LIMIT * 100} % is ${pc(LIMIT - top)} points, ${bad.length} of ${windows} windows fail`);
  return { bad, worst, windows, tag };
}
const armOn = (clock, o) => arm({ ...o, clock });
const judge = (r) => assert.deepEqual(r.bad, [], `${r.tag}: ${r.bad.length} of ${r.windows} windows fail: ${r.bad.join(' | ')}`);

// ---- 256 colours, real 4x, 80x24

test('256 colours at --fps 30, real 4x, 80x24, seeds 1-16: every dissolve window passes every rule (was 16 of 80 failing rule C, worst 29.2 %)', async () => {
  judge(await arm({ cols: 80, rows: 24, mode: '256', fps: 30, speed: 4, seeds: SEEDS_16 }));
});

test('256 colours at --fps 24, real 4x, 80x24, seeds 2 3 5 6 14 1: every dissolve window passes every rule (thin before: worst 23.8 %)', async () => {
  judge(await arm({ cols: 80, rows: 24, mode: '256', fps: 24, speed: 4, seeds: SEEDS_24 }));
});

// ---- 256 colours, real 4x, the other sizes

test('256 colours at --fps 30, real 4x, 120x40, seeds 2 6 14: every dissolve window passes every rule', async () => {
  judge(await arm({ cols: 120, rows: 40, mode: '256', fps: 30, speed: 4, seeds: SEEDS_120 }));
});

test('256 colours at --fps 30, real 4x, 61x21, seeds 2 3 5 6: every dissolve window passes every rule', async () => {
  judge(await arm({ cols: 61, rows: 21, mode: '256', fps: 30, speed: 4, seeds: SEEDS_61 }));
});

// ---- 256 colours, 1x

test('256 colours at --fps 30, 1x, 80x24, seeds 2 6: every dissolve window passes every rule', async () => {
  judge(await arm({ cols: 80, rows: 24, mode: '256', fps: 30, speed: 1, seeds: SEEDS_1X }));
});

test('256 colours at --fps 24, 1x, 80x24, seed 2: every dissolve window passes every rule', async () => {
  judge(await arm({ cols: 80, rows: 24, mode: '256', fps: 24, speed: 1, seeds: [2] }));
});

// ---- the menu jump at 4x (the program-switch dissolve; Cortex is on screen for the jump to Rosette) at 30 fps

const DOWN = '\x1b[B';
test('256 colours at --fps 30, the menu jump at 4x (bloomfall>cortex, rosette>bloomfall, cortex>rosette), seeds 2 6: every rule passes', async () => {
  const ENTRY = { rosette: 0, cortex: 1, bloomfall: 2 };
  const JUMPS = [{ from: 'bloomfall', to: 'cortex', at: 41 }, { from: 'rosette', to: 'bloomfall', at: 56 }, { from: 'cortex', to: 'rosette', at: 24 }];
  const bad = [], worst = { l1: 0, l2: 0, l3: 0, r: 0, c: 0 };
  for (const seed of [2, 6]) for (const { from, to, at } of JUMPS) {
    const pick = at + 0.8;
    const keys = [...PLAN_4X, { atRunning: at, key: '\r' }];
    for (let s = 0; s < ENTRY[to]; s++) keys.push({ atRunning: at + 0.4 + 0.1 * s, key: DOWN });
    keys.push({ atRunning: pick, key: '\r' });
    const res = await runAppWindow({ mode: '256', fps: 30, viaLoop: true, seed, keys, pickAt: pick, before: 6, after: 4 });
    const w = worstOf(res.report);
    for (const k of Object.keys(worst)) worst[k] = Math.max(worst[k], w[k]);
    const f = failedRules(res.report, { only: X1_RULE_IDS });
    if (f.length) bad.push(`seed ${seed} ${from}>${to}: ${f.join(',')} ${showWorst(w)}`);
  }
  const top = Math.max(...Object.values(worst));
  console.log(`FPS ARM 80x24 256 30 fps 4x menu jump, 6 windows: worst ${showWorst(worst)} | margin to 25 % is ${pc(LIMIT - top)} points, ${bad.length} fail`);
  assert.deepEqual(bad, []);
});

// ---- truecolor at 30 fps: the arm the cap must not change (passing before and after)

test('truecolor at --fps 30, real 4x, 80x24, seeds 1 2 6 14: every dissolve window passes every rule (worst 7.2 % on rule C before and after)', async () => {
  judge(await arm({ cols: 80, rows: 24, mode: 'truecolor', fps: 30, speed: 4, seeds: SEEDS_TC }));
});

test('truecolor at --fps 30, real 4x, 120x40, seed 2: every dissolve window passes every rule', async () => {
  judge(await arm({ cols: 120, rows: 40, mode: 'truecolor', fps: 30, speed: 4, seeds: [2] }));
});

test('truecolor at --fps 30, 1x, 80x24, seed 2: every dissolve window passes every rule', async () => {
  judge(await arm({ cols: 80, rows: 24, mode: 'truecolor', fps: 30, speed: 1, seeds: [2] }));
});

// ---- DRIFT-9 item 2 and part 3 (a): the floor of --fps is 8 (MIN_FPS). The floor arms run on the exact grid (this section) and on the q156 and jitter clocks (the clock section below).
// The L3 limit used here is the meter's own (STEP_FRACTION, 30 %): it is the rule's stated limit, not an allowance on top of it, and judge() holds every rule to its limit.
// Ingrid's findings, which is why the floor is not 5: fps 4 failed on the exact grid (L3 30.5 % at seed 6, 61x21, 4x), and fps 5 failed on the q156 clock (L3 31.73 % at seed 4, bloomfall>rosette).
// The sweep that chose 8 (every integer fps 5-30, three clocks, 4x and 1x, 61x21 seeds 1-8, 78x24 and 120x40 seeds 1-3): 5, 6 and 7 fail L3 on the q156 clock (31.73, 36.85 and 33.53 %);
// from 8 up every rate passes every rule on all three clocks (at 8: worst L3 15.34 %, worst other rule 11.07 %).
const L3_LIMIT = STEP_FRACTION;
const SEEDS_8 = [1, 2, 3, 4, 5, 6, 7, 8];

for (const [cols, rows, seeds] of [[61, 21, SEEDS_8], [78, 24, [1, 2, 3]], [120, 40, [1, 2, 3]]]) {
  test(`256 colours at the floor (MIN_FPS), real 4x, ${cols}x${rows}, seeds ${seeds.join(' ')}, exact grid: every dissolve window passes every rule, L3 within its own 30 % limit`, async () => {
    const r = await arm({ cols, rows, mode: '256', fps: MIN_FPS, speed: 4, seeds });
    judge(r);
    console.log(`FPS FLOOR grid ${cols}x${rows} 256 ${MIN_FPS} fps 4x seeds ${seeds.join(' ')}: max L3 ${pc(r.worst.l3)} % (limit ${pc(L3_LIMIT)} %, margin ${pc(L3_LIMIT - r.worst.l3)} points)`); // printed only after judge() passed
  });
}

// ---- DRIFT-9 item 4: the same arms on the q156 and the jitter clock (arm's `clock`: runAppDissolves puts the app's own loop on that clock through the timer seam, with --fps N told to the app, and the
// meter reads one screen per 1 / fps of clock time). One arm per clock on the case that read highest: 256 colours at --fps 30, real 4x, 80x24, seed 6 (the cap path: the app paints at most 18 a
// second whatever 30 asks for). The floor arms (--fps MIN_FPS = 8, real 4x, 61x21 seeds 1-8, plus 78x24 and 120x40 seeds 1-3) run on BOTH clocks, below, each rule at its own limit (L3 at the
// meter's 30 %). Every dissolve window passes the five 1x rules at their own limits. Controls on the clocks: the cap taken out of a copy of the tree
// (FULLCOLOUR_256_MAX_FPS = 1000) fails rule C at --fps 30 (seeds 2, 6 and 14: 14 is the seed that reads highest on the q156 clock, where 2 and 6 read just under the limit), and --fps 7 (MIN_FPS - 1) fails L3 on the q156 clock at 61x21 seed 6, so the arms can
// tell. The cost is by count of frames the meters read.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clockArm, assertArmCost } from './helpers-clock-arms.js';
import { meterStats } from './helpers-flash.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function capOut() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-fps-clock-mutant-'));
  fs.cpSync(path.join(REPO, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(REPO, 'cartridges'), path.join(dir, 'cartridges'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(dir, 'package.json'));
  const g = path.join(dir, 'src', 'app.js');
  const raw = fs.readFileSync(g, 'utf8');
  const crlf = raw.includes('\r\n');
  const src = raw.replace(/\r\n/g, '\n');
  const find = 'export const FULLCOLOUR_256_MAX_FPS = 18;';
  assert.equal(src.split(find).length, 2, 'the cap is where this test expects it (src/app.js)');
  const out = src.replace(find, 'export const FULLCOLOUR_256_MAX_FPS = 1000;');
  fs.writeFileSync(g, crlf ? out.replace(/\n/g, '\r\n') : out);
  return dir;
}
const CLOCKS = [{ mode: 'q156', seed: 1 }, { mode: 'jitter', seed: 3 }];
for (const clock of CLOCKS) {
  test(`256 colours at --fps 30 on the ${clock.mode} clock, real 4x, 80x24, seed 6: every dissolve window passes every rule`, async () => {
    const r = await clockArm(() => armOn(clock, { cols: 80, rows: 24, mode: '256', fps: 30, speed: 4, seeds: [6] }));
    judge(r);
  });
  test(`control on the ${clock.mode} clock: the cap taken out of a copy of the tree fails rule C at --fps 30 (seeds 2, 6 and 14, 80x24, 256, 4x)`, async () => {
    const kept = meterStats.frames; // not an arm, and not frames the file's other arms read: not counted
    const dir = capOut();
    try {
      const failing = [];
      let worstC = 0;
      for (const seed of [2, 6, 14]) {
        const m = await runAppDissolves({ cols: 80, rows: 24, mode: '256', fps: 30, seed, seconds: 82, plan: PLAN_4X, speed: 4, clock: clock.mode, clockSeed: clock.seed, root: dir });
        for (const d of m.dissolves) { worstC = Math.max(worstC, d.report.c.worstFraction); if (failedRules(d.report, { only: X1_RULE_IDS }).includes('c')) failing.push(`seed ${seed} ${d.from}>${d.to}`); }
      }
      assert.ok(failing.length >= 1, `${clock.mode}: the no-cap mutant failed no window on rule C (worst C ${pc(worstC)} %)`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); meterStats.frames = kept; }
  });
}
// The floor (MIN_FPS) on the clocks: 256 colours, real 4x, every dissolve window, every rule at its limit. q156 is the clock that failed below 8, so it gets the widest arm: 61x21 seeds 1-8 and
// 78x24 and 120x40 seeds 1-3 (the exact grid runs the same three above). Jitter runs 61x21 at seed 4, the seed that read highest on it at 8 fps in the sweep (the full sweep, every seed of every size
// on all three clocks, read worst L3 15.34 % and worst other rule 11.07 % at 8 fps over 4x and 1x). Cost: the clock arms are held to 15 % of the frames the file's other arms read by the last
// test below (the limit is not raised), which is why jitter is not run over all 14 seeds here (or at seed 6, which the 5 fps arm used before): a window of 8 fps frames is 80 frames, and the budget is by count, not by time.
const FLOOR_ARMS = [
  { clock: CLOCKS[0], cols: 61, rows: 21, seeds: SEEDS_8 }, { clock: CLOCKS[0], cols: 78, rows: 24, seeds: [1, 2, 3] }, { clock: CLOCKS[0], cols: 120, rows: 40, seeds: [1, 2, 3] },
  { clock: CLOCKS[1], cols: 61, rows: 21, seeds: [4] },
];
for (const { clock, cols, rows, seeds } of FLOOR_ARMS) {
  test(`256 colours at the floor (MIN_FPS) on the ${clock.mode} clock, real 4x, ${cols}x${rows}, seeds ${seeds.join(' ')}: every dissolve window passes every rule, L3 within its own 30 % limit`, async () => {
    const r = await clockArm(() => armOn(clock, { cols, rows, mode: '256', fps: MIN_FPS, speed: 4, seeds }));
    judge(r);
    console.log(`FPS FLOOR ${clock.mode} ${cols}x${rows} 256 ${MIN_FPS} fps 4x seeds ${seeds.join(' ')}: max L3 ${pc(r.worst.l3)} % (limit ${pc(L3_LIMIT)} %, margin ${pc(L3_LIMIT - r.worst.l3)} points)`); // printed only after judge() passed
  });
}
// Control, named: --fps MIN_FPS - 1 (7) on the q156 clock (clockSeed 1) at 61x21, 256 colours, real 4x, seed 6 FAILS L3 (bloomfall>rosette; the sweep read 33.53 %), so the floor arms can tell.
// It runs through the same arm helper as the floor arms (armOn), not counted in the cost (it is not an arm of the floor). On the jitter clock and the exact grid fps 7 passes: the clock is the point.
test(`control: --fps ${MIN_FPS - 1} (below the floor) on the q156 clock, real 4x, 61x21, 256 colours, seed 6 FAILS L3`, async () => {
  const kept = meterStats.frames;
  try {
    const r = await armOn(CLOCKS[0], { cols: 61, rows: 21, mode: '256', fps: MIN_FPS - 1, speed: 4, seeds: [6] });
    assert.ok(r.bad.length >= 1 && r.bad.some((b) => /\bl3\b/.test(b)), `q156 --fps ${MIN_FPS - 1} seed 6 should fail L3; windows failing: ${r.bad.join(' | ') || 'none'} (worst L3 ${pc(r.worst.l3)} %)`);
    assert.ok(r.worst.l3 > L3_LIMIT, `q156 --fps ${MIN_FPS - 1} seed 6: worst L3 ${pc(r.worst.l3)} % should be over ${pc(L3_LIMIT)} %`);
    console.log(`FPS FLOOR control q156 61x21 256 ${MIN_FPS - 1} fps 4x seed 6: worst L3 ${pc(r.worst.l3)} % is over the ${pc(L3_LIMIT)} % limit; failing: ${r.bad.join(' | ')}`); // printed after the asserts held
  } finally { meterStats.frames = kept; }
});
test('DRIFT-9 clock arms cost: fps arms on a clock read at most 15 % of the frames the other arms of this file read (by count)', () => { assertArmCost('flash-256 fps'); });
