// DRIFT-9 S2: the shelf scrub on the REAL app, on the three clocks (grid, q156, jitter), in both colour modes, at four sizes and five tap intervals, metered on the viewer's 18 Hz
// grid against the five rules (L1, L2 x1, L3, R x1, C), every one at its own limit. The driver is tests/helpers-shelf-real.js (what the hand-run shelf.mjs of the DRIFT-9 challenge
// did): createApp itself with startScreen library, the shipped cartridges, its own timer loop on the clock through the `timer` seam, the real renderer, the bytes read back by an
// independent terminal reader, 256-colour output decoded from the indexes sent. The first second (the library's fade-in) is not metered. tools/shelf-matrix.mjs runs the wider
// matrix for a reviewer (it is not part of this suite).
//   sizes  40x10 (the list tier), 81x24 and 79x25 (either side of the compact tier's width), 89x40 (the full tier just above its breakpoint)
//   taps   a key held down (first press, then repeats every 33 ms from 0.5 s on, for 3 s), and 14 taps 0.3, 0.44, 0.48 and 0.7 s apart, from 2 s
//   seeds  the app's seed and the jitter clock's seed change from case to case (none is a replay from t0 of the same run), see caseSeeds() in helpers-shelf-real.js
// Each case is its own test, so a case that fails names its clock, mode, size and tap interval and carries the number. Every case is asserted here, once, and passes (DRIFT-9 item 3 turned the 21 that read over L2 25 % green; tests/shelf-gate-mutant.test.js proves the gate that did it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runShelf, showNums, caseSeeds, caseKey, SHELF_CLOCKS, SHELF_MODES, SHELF_SIZES, SHELF_TAPS } from './helpers-shelf-real.js';

test('shelf clocks: the matrix has the four required sizes, the five tap intervals, both colour modes and the three clocks', () => {
  assert.deepEqual(SHELF_SIZES, [[40, 10], [81, 24], [79, 25], [89, 40]]);
  assert.deepEqual(SHELF_TAPS, ['held', 0.3, 0.44, 0.48, 0.7]);
  assert.deepEqual(SHELF_MODES, ['truecolor', '256']);
  assert.deepEqual(SHELF_CLOCKS, ['grid', 'q156', 'jitter']);
});

test('shelf clocks: the arm drives the REAL app on the library, across seeds (not replays from t0): the screen is the library, it painted, the cursor moved, and different seeds read differently', async () => {
  const reps = new Set();
  for (const [seed, clockSeed] of [[1, 1], [2, 2], [3, 3]]) {
    const r = await runShelf({ clock: 'jitter', clockSeed, seed, mode: '256', cols: 81, rows: 24, gap: 0.44 });
    assert.equal(r.screen, 'library', `seed ${seed}: the app's shell is on the library`);
    assert.ok(r.paints > 20, `seed ${seed}: the app painted (${r.paints} samples with output)`);
    assert.ok(r.frames >= 100, `seed ${seed}: the meter read ${r.frames} frames`);
    assert.ok(r.cursors >= 3, `seed ${seed}: the cursor stood on ${r.cursors} cartridges`);
    reps.add(JSON.stringify(r.rep));
  }
  assert.ok(reps.size >= 2, 'the seeds do not replay one run');
});

SHELF_CLOCKS.forEach((clock) => SHELF_MODES.forEach((mode) => SHELF_SIZES.forEach(([cols, rows], si) => SHELF_TAPS.forEach((tap, ti) => {
  const key = caseKey(clock, mode, cols, rows, tap);
  test(`shelf real app: ${key}: the five 1x rules pass`, async () => {
    const r = await runShelf({ clock, mode, cols, rows, gap: tap, ...caseSeeds(si, ti) });
    assert.equal(r.screen, 'library');
    assert.deepEqual(r.fail, [], `${key}: ${showNums(r.nums)}`);
  });
}))));
