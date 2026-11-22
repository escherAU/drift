// DRIFT-13 phase 2: a principled sample across the sweep, on the REAL app with the flash governor wired in (tests/governor-app.test.js has Desmond's cases one by one, the controls and the
// behaviour; this file is the breadth). Every case is the whole 170 s Classic high contrast cycle (five scenes and the four dissolves between them, every frame read through the flash meter
// at the app's own --fps), real `+` presses for the speed, judged by the five 1x rules (L1, L2, L3, R, C: X1_RULE_IDS) at their limits, never loosened.
//   sizes   40x10, 41x10, 42x10, 40x11, 41x11, 42x11, 40x12, 41x12, 42x12, 43x12, 45x12, 46x12 (the boards of 56 to 72 cells, where the field is 56 cells and one cell is 1.79 %), 50x16, 80x24,
//           120x40 and the shell's layout breakpoints 78x24 and 88x39
//   --fps   8, 9, 12, 18, 21, 24, 26, 27, 30      speeds   1x, 1.5x, 2x, 3x, 4x (SPEEDS: from 1x one `+` is 1.5x, two 2x, three 3x, four 4x)      colour   256 and truecolor      seeds 1 to 8
//   grid    every Desmond case and every 25.00 % edge (tests/helpers-governor-app.js DESMOND), and per size four cases rotated over rate, speed, colour and seed (ROTATION: 68 cases)
//   clocks  the q156 and jitter arms (the Desmond q156 cases and CLOCK_ROTATION, seven more), held by tests/helpers-clock-arms.js to 15 % of the frames the grid cases read (the last test)
// The sample is chosen by rotation, not by where anything failed: 9 of the 87 cases fail on the tree before the governor (all of them Desmond's, which tests/governor-app.test.js runs on that
// tree and prints), and none of the other 78 does; they are here to show the governor costs no rule anywhere in the sweep, on any size, rate, speed or clock, not to find new failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { X1_RULE_IDS, failedRules } from './helpers-flash.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';
import { cycle, DESMOND, ROTATION, CLOCK_ROTATION, SAMPLE, SWEEP_SIZES, SWEEP_FPS, SWEEP_SPEEDS } from './helpers-governor-app.js';

async function judged(o) {
  const r = await cycle(o);
  assert.equal(r.frames, Math.round(170 * o.fps), `${o.id}: the whole cycle was metered, every frame`);
  assert.equal(r.speedMax, o.speed, `${o.id}: the key presses reached ${o.speed}x`);
  assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], o.id);
  judgeX1(r.rep, o.id);
  return r;
}

test('DRIFT-13 sweep: the sample covers every size, rate, speed, colour mode and clock listed, every Desmond case and every 25.00 % edge', () => {
  const key = (o) => `${o.cols}x${o.rows}`;
  assert.deepEqual([...new Set(SAMPLE.map(key))].sort(), SWEEP_SIZES.map(([c, r]) => `${c}x${r}`).sort());
  assert.deepEqual([...new Set(SAMPLE.map((o) => o.fps))].sort((a, b) => a - b), [...SWEEP_FPS, 23, 25].sort((a, b) => a - b), 'the nine rates, and 23 and 25 of the 1.5x cases Desmond named');
  assert.deepEqual([...new Set(SAMPLE.map((o) => o.speed))].sort((a, b) => a - b), SWEEP_SPEEDS);
  assert.deepEqual([...new Set(SAMPLE.map((o) => o.mode))].sort(), ['256', 'truecolor']);
  assert.deepEqual([...new Set(SAMPLE.map((o) => o.clock))].sort(), ['grid', 'jitter', 'q156']);
  for (const s of new Set(SAMPLE.map((o) => o.seed))) assert.ok(s >= 1 && s <= 8);
  assert.equal(new Set(SAMPLE.map((o) => o.seed)).size, 8, 'all eight seeds');
  assert.equal(DESMOND.filter((d) => d.id.includes('25.00 edge')).length, 3, 'the three 25.00 % edges');
  for (const d of DESMOND) assert.ok(SAMPLE.includes(d), `Desmond's case is in the sample: ${d.id}`);
  assert.equal(new Set(SAMPLE.map((o) => o.id)).size, SAMPLE.length, 'no case twice');
  // every size meets at least four frame rates and four speeds, and every rate and speed is met at about the same number of sizes
  for (const [c, r] of SWEEP_SIZES) {
    const mine = ROTATION.filter((o) => o.cols === c && o.rows === r);
    assert.ok(new Set(mine.map((o) => o.fps)).size >= 4 && new Set(mine.map((o) => o.speed)).size >= 4, `${c}x${r}`);
  }
  for (const f of SWEEP_FPS) assert.ok(ROTATION.filter((o) => o.fps === f).length >= 5, `--fps ${f}`);
  for (const s of SWEEP_SPEEDS) assert.ok(ROTATION.filter((o) => o.speed === s).length >= 8, `${s}x`);
});

// the exact grid, one test per size
for (const [cols, rows] of SWEEP_SIZES) {
  test(`DRIFT-13 sweep: grid clock, ${cols}x${rows}: the whole cycle passes the five rules at every rate, speed, colour mode and seed of the sample`, async () => {
    const mine = SAMPLE.filter((o) => o.cols === cols && o.rows === rows && o.clock === 'grid');
    assert.ok(mine.length >= 4, `${mine.length} cases`);
    for (const o of mine) await judged(o);
  });
}

// the q156 and jitter clocks: Desmond's q156 cases and the rotation's, each counted by the arm-cost rule
for (const clock of ['q156', 'jitter']) {
  test(`DRIFT-13 sweep: ${clock} clock arm: the whole cycle passes the five rules (clock seed = app seed)`, async () => {
    const mine = SAMPLE.filter((o) => o.clock === clock);
    assert.ok(mine.length >= 3, `${mine.length} cases`);
    for (const o of mine) await clockArm(() => judged(o));
  });
}

test('DRIFT-13 sweep: the clock arms (q156, jitter) read at most 15 % of the frames the grid cases read', () => {
  assertArmCost('governor sweep');
  assert.ok(CLOCK_ROTATION.length === 7);
});
