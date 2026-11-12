// DRIFT-7 C4b: the CPU half of the budget helper. A timing assertion can flake when test files run in parallel on a busy
// machine, so this is its own file. The authoritative run is
//     node --test --test-concurrency=1 tests/budget-cpu.test.js
// The ceiling (CPU_MEAN_CEILING_MS = 27) is never loosened: the fixture is a cheap scene with a wide margin, each
// measurement is the best of three means, and the over-budget control is a scene that costs more than the ceiling by design.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CPU_MEAN_CEILING_MS, CPU_RUN, measureCpu, checkCpu, measureRelativeCost, calibrationLoop } from './helpers-budget.js';
import { makeOrb, makeSlowScene, makeSlowStart } from './helpers-budget-fixtures.js';

test('CPU constants: 240x67, 18 warm-up frames, 180 measured, best of three', () => {
  assert.equal(CPU_MEAN_CEILING_MS, 27);
  assert.deepEqual(CPU_RUN, { cols: 240, rows: 67, warmup: 18, frames: 180, runs: 3 });
});

test('the orb scene plus the real renderer costs well under the CPU ceiling at 240x67', () => {
  const m = measureCpu(makeOrb());
  console.log(`orb 240x67 cpu: best mean ${m.meanMs.toFixed(2)} ms/frame over ${m.frames} frames (runs ${m.runsMs.map((x) => x.toFixed(2)).join(', ')} ms); ceiling ${CPU_MEAN_CEILING_MS}`);
  assert.equal(m.frames, 180);
  assert.equal(m.runsMs.length, 3);
  assert.equal(m.meanMs, Math.min(...m.runsMs));
  checkCpu(m);
  assert.ok(m.meanMs < CPU_MEAN_CEILING_MS / 2, `${m.meanMs} ms is not a wide margin under ${CPU_MEAN_CEILING_MS}`);
});

test('warm-up frames are not measured: a scene slow only for its first 4 calls has a small mean', () => {
  const m = measureCpu(makeSlowStart(40, 4), { warmup: 4, frames: 20, runs: 1 });
  assert.ok(m.meanMs < 5, `${m.meanMs} ms: the four 40 ms warm-up calls were counted`);
  assert.equal(m.frames, 20);
});

test('a scene that burns 30 ms a frame FAILS checkCpu (the control), and one at 5 ms passes', () => {
  const slow = measureCpu(makeSlowScene(30), { warmup: 2, frames: 12, runs: 1 });
  assert.ok(slow.meanMs >= 30, `${slow.meanMs}`);
  assert.throws(() => checkCpu(slow), /ms per frame/);
  const fast = measureCpu(makeSlowScene(5), { warmup: 2, frames: 12, runs: 1 });
  checkCpu(fast);
});

// DRIFT-7 stage E: measureRelativeCost (the load-proof timing of cheap calls) tracks the work in proportion, whatever the machine is doing.
test('measureRelativeCost: the calibration loop itself reads 1.0 and doing it three times reads clearly higher (a batch of well under a millisecond: longer batches are preempted in every repeat and read high)', () => {
  const one = measureRelativeCost(() => { calibrationLoop(); });
  const three = measureRelativeCost(() => { calibrationLoop(); calibrationLoop(); calibrationLoop(); });
  console.log(`relative cost: 1x ${one.ratio.toFixed(3)}, 3x ${three.ratio.toFixed(3)}`);
  assert.ok(one.ratio > 0.8 && one.ratio < 1.25, `1x read ${one.ratio}`);
  assert.ok(three.ratio > 1.8 && three.ratio < 4.5, `3x read ${three.ratio}`);
});
