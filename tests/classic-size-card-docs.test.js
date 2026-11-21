// DRIFT-12 part A, item 9 and 11: the minimum window is stated in --help and in the README (and the numbers are the source's), the README no longer promises Classic anything below it, and
// the console's own too-small card is byte-for-byte what it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { helpText, CLASSIC_MIN_COLS, CLASSIC_MIN_ROWS } from '../src/app.js';
import { drawTooSmall, newFrame, MSG_TOO_SMALL, MSG_TOO_SMALL_CLASSIC, sizeTier } from '../src/shell/ui.js';

const README = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

test('9 the minimum in the source is 40x10, the console\'s own "list" tier from 40x10 (the card shows exactly where the console would show its tiny card)', () => {
  assert.equal(CLASSIC_MIN_COLS, 40);
  assert.equal(CLASSIC_MIN_ROWS, 10);
  assert.equal(sizeTier(39, 10), 'tiny');
  assert.equal(sizeTier(40, 9), 'tiny');
  assert.notEqual(sizeTier(40, 10), 'tiny');
  assert.equal(MSG_TOO_SMALL_CLASSIC, 'Make the window bigger to see drift.');
});

test('9 --help states the minimum window (40x10) and the card', () => {
  const txt = flat(helpText());
  assert.ok(txt.includes('Classic needs a window of at least 40x10 (columns x rows)'), txt);
  assert.ok(txt.includes('"make the window bigger" card'));
  assert.ok(!/at least 41x11|at least 39x9/.test(txt));
});

test('9 the README states the minimum window, the card, the pause and what is not reachable below it', () => {
  const t = flat(README);
  for (const need of [
    '**Minimum window: 40 columns x 10 rows (DRIFT-12).**',
    'Below 40 columns, or below 10 rows, it shows a card, "Make the window bigger to see drift."',
    "Classic's clock stands still",
    'in high contrast it is the same two colours as the art (strictly two-tone) and `i` inverts it',
    'not reachable: Classic shows the size card below 40x10',
  ]) assert.ok(t.includes(need), `the README says: ${need}`);
});

test('9 the README no longer says Classic runs, or is measured, on boards below 40x10 (the gap sentences are "not reachable")', () => {
  const t = flat(README);
  for (const gone of [
    'Classic has no minimum size, so a window this small runs Life',
    'Not covered: **the cycle below 40x10.**',
    'except on the smallest boards (below: the cycle under 40x10, and boards of 34 cells or fewer)',
  ]) assert.ok(!t.includes(gone), `the README no longer says: ${gone}`);
});

test('11 the console\'s too-small card is unchanged: the words, the wrap and the centring are byte-for-byte what they were, and a Classic message is only an extra argument', () => {
  assert.equal(MSG_TOO_SMALL, 'Make the window bigger to see the cartridges.');
  const rowsOf = (f) => { const out = []; for (let y = 0; y < f.rows; y++) out.push(String.fromCodePoint(...f.glyphs.slice(y * f.cols, (y + 1) * f.cols))); return out; };
  const card = (c, r, ...extra) => { const f = newFrame(c, r); drawTooSmall(f, 7, ...extra); return { rows: rowsOf(f), shades: [...f.shades].join(','), glyphs: [...f.glyphs].join(',') }; };
  // golden rows for the console's card at three sizes, written out by hand
  assert.deepEqual(card(39, 10).rows.filter((l) => l.trim()).map((l) => l.trim()), ['Make the window bigger to see the', 'cartridges.']);
  assert.deepEqual(card(20, 6).rows.filter((l) => l.trim()).map((l) => l.trim()), ['Make the window', 'bigger to see the', 'cartridges.']);
  assert.deepEqual(card(10, 4).rows.map((l) => l.trim()), ['Make the', 'window', 'bigger to', 'see the']);
  assert.deepEqual(card(39, 10), card(39, 10, MSG_TOO_SMALL), 'naming the console\'s message gives the same card');
  assert.notDeepEqual(card(39, 10), card(39, 10, MSG_TOO_SMALL_CLASSIC));
});
