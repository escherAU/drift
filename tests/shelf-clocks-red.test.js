// DRIFT-9 red: the shelf cases that read over a limit, as real assertions. These are the cases tests/shelf-clocks.test.js leaves out (RED_CASES in tests/helpers-shelf-red.js): the same
// driver (the real app on the library, the clock, the viewer's 18 Hz grid) and the same assertion as every other case there, the five 1x rules (L1, L2 x1, L3, R x1, C) at the limits
// the shell ships with (25 %, 25 %, 30 %, 25 %, 25 %). Nothing is loosened, skipped or marked as an expected failure. They fail today: each failure message carries the case and the
// five numbers. The shelf is not fixed by this ticket; these are the arms the fix is to turn green.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runShelf, showNums, caseSeeds, caseKey, SHELF_SIZES, SHELF_TAPS } from './helpers-shelf-real.js';
import { RED_CASES } from './helpers-shelf-red.js';

test('shelf red: every case listed as red is a case of the matrix (the list names no case that is not run) and none is listed twice', () => {
  const all = new Set();
  for (const clock of ['grid', 'q156', 'jitter']) for (const mode of ['truecolor', '256']) for (const [c, r] of SHELF_SIZES) for (const tap of SHELF_TAPS) all.add(caseKey(clock, mode, c, r, tap));
  for (const k of RED_CASES) assert.ok(all.has(k), `${k} is a case of the matrix`);
  assert.equal(new Set(RED_CASES).size, RED_CASES.length);
});

for (const key of RED_CASES) {
  const m = /^(\S+) (\S+) (\d+)x(\d+) tap (\S+)$/.exec(key);
  const [, clock, mode, c, r, tapText] = m;
  const cols = Number(c), rows = Number(r);
  const tap = tapText === 'held' ? 'held' : Number(tapText);
  const si = SHELF_SIZES.findIndex(([a, b]) => a === cols && b === rows), ti = SHELF_TAPS.indexOf(tap);
  test(`shelf real app (DRIFT-9 red): ${key}: the five 1x rules pass`, async () => {
    const res = await runShelf({ clock, mode, cols, rows, gap: tap, ...caseSeeds(si, ti) });
    assert.equal(res.screen, 'library');
    assert.deepEqual(res.fail, [], `${key}: ${showNums(res.nums)}`);
  });
}
