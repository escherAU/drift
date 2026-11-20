// DRIFT-9 S2: the shelf scrub on the REAL app, on the three clocks (grid, q156, jitter), in both colour modes, at four sizes and five tap intervals, metered on the viewer's 18 Hz
// grid against the five rules (L1, L2 x1, L3, R x1, C), every one at its own limit. The driver is tests/helpers-shelf-real.js (what the hand-run shelf.mjs of the DRIFT-9 challenge
// did): createApp itself with startScreen library, the shipped cartridges, its own timer loop on the clock through the `timer` seam, the real renderer, the bytes read back by an
// independent terminal reader, 256-colour output decoded from the indexes sent. The first second (the library's fade-in) is not metered. tools/shelf-matrix.mjs runs the wider
// matrix for a reviewer (it is not part of this suite).
//   sizes  40x10 (the list tier), 81x24 and 79x25 (either side of the compact tier's width), 89x40 (the full tier just above its breakpoint)
//   taps   a key held down (first press, then repeats every 33 ms from 0.5 s on, for 3 s), and 14 taps 0.3, 0.44, 0.48 and 0.7 s apart, from 2 s
//   seeds  the app's seed and the jitter clock's seed change from case to case (none is a replay from t0 of the same run), see caseSeeds() in helpers-shelf-real.js
// Each case is its own test, so a case that fails names its clock, mode, size and tap interval and carries the number. The cases that read over a limit on the exact grid or on a real
// clock are asserted in tests/shelf-clocks-red.test.js (DRIFT-9 red), not here; RED_CASES lists them so that no case is asserted twice and none is left out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runShelf, showNums, caseSeeds, caseKey, SHELF_CLOCKS, SHELF_MODES, SHELF_SIZES, SHELF_TAPS } from './helpers-shelf-real.js';
import { RED_CASES } from './helpers-shelf-red.js';

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

test('shelf clocks: the arm catches the known failure, 40x10 in 256 colours on the exact grid with taps 0.48 s apart reads L2 37.50 % (a real number from the challenge, over 25 %)', async () => {
  const r = await runShelf({ clock: 'grid', mode: '256', cols: 40, rows: 10, gap: 0.48 });
  assert.deepEqual(r.fail, ['l2.x1'], showNums(r.nums));
  assert.equal(r.nums.l2, 37.5);
  assert.ok(r.nums.l1 === 0 && r.nums.r === 0 && r.nums.c === 0, 'and only L2 is over: ' + showNums(r.nums));
  // the size matrix is what keeps it in view: take the small sizes out and the arm, run on the rest of the same taps, no longer reads this case at all
  const without = SHELF_SIZES.filter(([c]) => c > 40);
  assert.ok(without.length === SHELF_SIZES.length - 1 && !without.some(([c, r2]) => c === 40 && r2 === 10), 'the mutated matrix has lost 40x10');
  const lostSmall = RED_CASES.filter((k) => without.some(([c, r2]) => k.includes(` ${c}x${r2} `)));
  const inFull = RED_CASES.filter((k) => SHELF_SIZES.some(([c, r2]) => k.includes(` ${c}x${r2} `)));
  assert.ok(inFull.length > lostSmall.length, `the full matrix reads ${inFull.length} failing cases, the matrix without 40x10 only ${lostSmall.length}`);
  assert.ok(inFull.some((k) => k.includes(' 40x10 ')), '40x10 is among the failing cases');
});

SHELF_CLOCKS.forEach((clock) => SHELF_MODES.forEach((mode) => SHELF_SIZES.forEach(([cols, rows], si) => SHELF_TAPS.forEach((tap, ti) => {
  const key = caseKey(clock, mode, cols, rows, tap);
  if (RED_CASES.includes(key)) return; // asserted in tests/shelf-clocks-red.test.js
  test(`shelf real app: ${key}: the five 1x rules pass`, async () => {
    const r = await runShelf({ clock, mode, cols, rows, gap: tap, ...caseSeeds(si, ti) });
    assert.equal(r.screen, 'library');
    assert.deepEqual(r.fail, [], `${key}: ${showNums(r.nums)}`);
  });
}))));
