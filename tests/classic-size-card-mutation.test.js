// DRIFT-12 part A, item 8: the controls. Each mutant is a one-line edit of a temporary copy of src/ (makeTree throws when an edit changes nothing, so a mutation that matches
// nothing cannot pass for a pass); the unmutated tree passes every check first, then each mutant must fail the checks named for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTree, rmTree } from './helpers-life-app.js';
import { checkCardAtSmallSizes, checkBoundary, checkResizeStaircase, checkTwoTone, measurePause, pauseViolations, heldViolations } from './helpers-size-card.js';

const fails = async (fn, label) => { await assert.rejects(fn, undefined, label); };
const mutant = (edit) => makeTree('new', { 'src/app.js': edit });
const swap = (from, to) => (text) => { if (!text.includes(from)) throw new Error(`the mutation matches nothing: ${from}`); return text.replace(from, to); };

test('8 control: the unmutated tree passes every check the mutants are held to', async () => {
  await checkCardAtSmallSizes(null);
  await checkBoundary(null);
  await checkResizeStaircase(null);
  await checkTwoTone(null);
  assert.deepEqual(pauseViolations(await measurePause({ clock: 'grid', at: 3.8, gap: 3.07 })), []);
  assert.deepEqual(await heldViolations(), []);
});

test('8 mutant: no size card (Classic renders at any size) fails the small sizes (test 1), the boundary pair (test 2) and the resize sequence (test 4)', async () => {
  const root = mutant(swap('(cols < CLASSIC_MIN_COLS || rows < CLASSIC_MIN_ROWS)', 'false'));
  try {
    await fails(() => checkCardAtSmallSizes(root), 'test 1');
    await fails(() => checkBoundary(root), 'test 2');
    await fails(() => checkResizeStaircase(root), 'test 4');
  } finally { rmTree(root); }
});

test('8 mutant: the threshold at 39x9 (one column and one row too low) fails the boundary pair, on each arm', async () => {
  for (const [from, to, label] of [['CLASSIC_MIN_COLS = 40', 'CLASSIC_MIN_COLS = 39', 'columns 39'], ['CLASSIC_MIN_ROWS = 10', 'CLASSIC_MIN_ROWS = 9', 'rows 9']]) {
    const root = mutant(swap(from, to));
    try { await fails(() => checkBoundary(root), label); } finally { rmTree(root); }
  }
  const both = mutant((t) => swap('CLASSIC_MIN_ROWS = 10', 'CLASSIC_MIN_ROWS = 9')(swap('CLASSIC_MIN_COLS = 40', 'CLASSIC_MIN_COLS = 39')(t)));
  try { await fails(() => checkBoundary(both), '39x9 together'); } finally { rmTree(both); }
});

test('8 mutant: the threshold at 41x11 (one column and one row too high) fails the boundary pair (40x10 must be art)', async () => {
  for (const [from, to, label] of [['CLASSIC_MIN_COLS = 40', 'CLASSIC_MIN_COLS = 41', 'columns 41'], ['CLASSIC_MIN_ROWS = 10', 'CLASSIC_MIN_ROWS = 11', 'rows 11']]) {
    const root = mutant(swap(from, to));
    try { await fails(() => checkBoundary(root), label); } finally { rmTree(root); }
  }
});

test('8 mutant: the card drawn in a third tone in high contrast fails the two-tone check', async () => {
  const root = mutant(swap('    const pal = paletteNow();\n    const f = newFrame(cols, rows);', "    const pal = shown.mode === 'contrast' ? makePalette([200, 60, 60], cmode) : paletteNow();\n    const f = newFrame(cols, rows);"));
  try { await fails(() => checkTwoTone(root), 'a red card in high contrast'); } finally { rmTree(root); }
});

test('8 mutant: the clock keeps running under the card fails the pause pin (every clock) and the held-time pin', async () => {
  const root = mutant(swap('if (!cardUp() && !paused && !helpOpen && dt > 0) {', 'if (!paused && !helpOpen && dt > 0) {'));
  try {
    for (const clock of ['grid', 'q156', 'jitter']) {
      const bad = pauseViolations(await measurePause({ clock, at: 3.8, gap: 3.07, root }));
      assert.ok(bad.length > 0 && bad.some((b) => b.startsWith('t moved')), `${clock}: the pin sees t move: ${bad.join('; ')}`);
    }
    assert.ok((await heldViolations({ root })).length > 0, 'the held-time pin sees it');
  } finally { rmTree(root); }
});

test('8 mutant: the composers are resized while the card shows (the scene state is thrown away) fails the "art after resuming equals the art before shrinking" check', async () => {
  const root = mutant(swap('if (cardUp()) return renderCard();', 'if (cardUp()) { resizeArt(cols, rows); return renderCard(); }'));
  try {
    await checkCardAtSmallSizes(root); // the card itself is still right
    await fails(() => checkResizeStaircase(root), 'the staircase');
  } finally { rmTree(root); }
});
