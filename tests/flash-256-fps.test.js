// DRIFT-8 r5: the Driftman 9000 on the REAL app at the frame rates a user can ask for (--fps 1 to 30, DRIFT_FPS), judged by the flash meter with every rule (L1, L2, L3, R and the
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
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAppDissolves, runAppWindow, PLAN_4X, PLAN_1X } from './helpers-flash-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';

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
async function arm({ cols, rows, mode, fps, speed, seeds }) {
  const bad = [], worst = { l1: 0, l2: 0, l3: 0, r: 0, c: 0 };
  let windows = 0;
  for (const seed of seeds) {
    const res = await runAppDissolves({ cols, rows, mode, fps, seed, seconds: speed === 4 ? 82 : 205, plan: speed === 4 ? PLAN_4X : PLAN_1X, speed, viaLoop: true });
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
  const tag = `${cols}x${rows} ${mode} ${fps} fps ${speed}x, ${seeds.length} seeds, ${windows} windows`;
  console.log(`FPS ARM ${tag}: worst ${showWorst(worst)} | margin to ${LIMIT * 100} % is ${pc(LIMIT - top)} points, ${bad.length} of ${windows} windows fail`);
  return { bad, worst, windows, tag };
}
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
