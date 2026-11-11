// DRIFT-4 slice 2, A2: the library's motion. Part 1 (carousel): the 34 column slide with an ease-out over 0.36 s,
// the TUNE dial turning one notch per step, the console screen retyping, one queued key press.
import test from 'node:test';
import assert from 'node:assert/strict';
import { driftmanSkin } from '../src/shell/driftman.js';
import { consoleGrid, consoleStyle, gridRows, drawLibrary, shelfLayout, slideOffset, slideEase, NEIGHBOUR_STEP, DIAL_POSITIONS } from '../src/shell/library.js';
import { SLIDE_SECONDS, TYPE_SECONDS } from '../src/shell/shell.js';
import { newFrame } from '../src/shell/ui.js';
import { mkShell, DT } from './helpers-shell.js';
import { frameLines } from './helpers-help.js';

const ui = driftmanSkin.palette.ui;
const LIB = { screen: 'library' };
const mkSel = (over = {}) => ({
  id: 'x', title: 'Sample', code: 'DM-09', blurb: 'A short blurb that needs a line or two to say what it is for.', facts: ['3 scenes', 'calm'],
  locked: false, label: ['hello'], ink: null, tint: 20, ...over,
});

// ---- the slide

test('slide: SLIDE_SECONDS is 0.36 and the offset runs from 34 columns to exactly 0 with an ease-out', () => {
  assert.equal(SLIDE_SECONDS, 0.36);
  assert.equal(NEIGHBOUR_STEP, 34);
  assert.equal(slideOffset(0, 1), 34);
  assert.equal(slideOffset(0, -1), -34);
  assert.equal(slideOffset(1, 1), 0);
  assert.equal(slideOffset(1, -1), 0);
  assert.equal(slideEase(0), 0);
  assert.equal(slideEase(1), 1);
  let last = 34;
  const steps = [];
  for (let k = 1; k <= 20; k++) {
    const o = slideOffset(k / 20, 1);
    assert.ok(o <= last, `monotonic at ${k}`);
    steps.push(last - o);
    last = o;
  }
  assert.ok(steps[0] > steps[steps.length - 2], `ease-out: first step ${steps[0]} larger than the last moving step`);
  assert.ok(slideEase(0.5) > 0.5, 'ease-out is ahead of linear');
});

test('slide: through the real app the selected cartridge moves left in 0.36 s, monotonically, ending on the settled spot', () => {
  const c = mkShell({ startScreen: LIB, cols: 120, rows: 40 });
  c.app.start();
  c.tick(0.5);
  const L = shelfLayout(120, 40, 'full');
  const xOf = () => { const row = frameLines(c.app.screenshot())[L.cartTop + 14]; return row.indexOf('FIXTURE'); };
  const settledBefore = c.text();
  assert.ok(settledBefore.includes('DRIFT CLASSIC') || settledBefore.length > 0);
  c.key('\x1b[C');
  assert.equal(c.sh().cartridge, 'fixture');
  const xs = [];
  const times = [];
  let t = 0;
  while (t < 0.6) { c.app.tick(DT); t += DT; xs.push(xOf()); times.push(t); }
  const final = xs[xs.length - 1];
  assert.equal(final, L.cartX + 3, 'settled: the name plate text sits 3 columns into the cartridge in the slot');
  const real = xs.filter((x) => x >= 0);
  assert.equal(real.length, xs.length, 'visible the whole time');
  for (let k = 1; k < xs.length; k++) assert.ok(xs[k] <= xs[k - 1], `monotonic at ${times[k].toFixed(2)}`);
  const moving = xs.map((x, k) => ({ x, k })).filter((o) => o.x !== final);
  const lastMoving = moving[moving.length - 1];
  assert.ok(times[lastMoving.k] < SLIDE_SECONDS + 1e-9, `the last displaced frame (${times[lastMoving.k].toFixed(3)} s) is inside the slide`);
  assert.ok(times[lastMoving.k] > SLIDE_SECONDS - 0.12, 'and it ran almost to the end');
  const d0 = xs[0] - xs[1], dLast = xs[lastMoving.k - 1] - xs[lastMoving.k];
  assert.ok(xs[0] - final > 0, 'the first frame is displaced');
  assert.ok(xs[0] - final > 4, `first-frame displacement (${xs[0] - final}) is large`);
  assert.ok(d0 >= dLast, `ease-out: first step ${d0} >= last step ${dLast}`);
  c.done();
});

test('slide: one key press is queued while sliding and runs after the first; a third is dropped', () => {
  const c = mkShell({ startScreen: LIB, cols: 120, rows: 40 });
  c.app.start();
  c.tick(0.5);
  assert.equal(c.sh().cartridge, 'classic');
  c.key('\x1b[C');
  assert.equal(c.sh().cartridge, 'fixture');
  c.tick(0.1);
  c.key('\x1b[C'); // queued
  c.key('\x1b[C'); // dropped
  assert.equal(c.sh().cartridge, 'fixture', 'the queued press waits');
  c.tick(0.2);
  assert.equal(c.sh().cartridge, 'fixture', 'still sliding');
  c.tick(0.2);
  assert.equal(c.sh().cartridge, 'locker', 'the queued press ran when the first finished');
  c.tick(2);
  assert.equal(c.sh().cartridge, 'locker', 'and the third was dropped (three cartridges: it would be classic)');
  // the other arm: a press after the slide has settled runs at once
  c.key('\x1b[C');
  assert.equal(c.sh().cartridge, 'classic');
  c.done();
});

test('slide: a queued press of the other direction also waits its turn, then goes that way', () => {
  const c = mkShell({ startScreen: LIB, cols: 120, rows: 40 });
  c.app.start();
  c.tick(0.5);
  c.key('\x1b[C');
  c.tick(0.1);
  c.key('\x1b[D');
  c.tick(0.5);
  assert.equal(c.sh().cartridge, 'classic', 'right then left ends where it began');
  c.done();
});

// ---- the TUNE dial and the retyped screen

const dialCells = (g) => gridRows(g).slice(5, 10).map((r) => [...r].slice(54, 63).join('')).join('|');

test('dial: the TUNE pointer turns one notch per step (8 positions) and comes back after 8', () => {
  assert.equal(DIAL_POSITIONS, 8);
  const st = consoleStyle(driftmanSkin);
  const seen = [];
  for (let i = 0; i < 17; i++) seen.push(dialCells(consoleGrid(mkSel(), { st, ui, n: 9, index: 0, dial: i })));
  for (let i = 0; i + 1 < seen.length; i++) assert.notEqual(seen[i], seen[i + 1], `notch ${i} -> ${i + 1} differs`);
  for (let i = 0; i + 8 < seen.length; i++) assert.equal(seen[i], seen[i + 8], `notch ${i} and ${i + 8} are the same`);
  assert.equal(new Set(seen.slice(0, 8)).size, 8, 'eight different positions');
  // negative steps (cursor moved left) work too
  assert.equal(dialCells(consoleGrid(mkSel(), { st, ui, n: 9, dial: -1 })), seen[7]);
  // without a dial field the dial follows the index, as before
  assert.equal(dialCells(consoleGrid(mkSel(), { st, ui, n: 9, index: 3 })), seen[3]);
});

test('dial: through the app the pointer moves one notch per step, also across the wrap of the cartridge list', () => {
  const c = mkShell({ startScreen: LIB, cols: 120, rows: 40 });
  c.app.start();
  c.tick(0.5);
  const L = shelfLayout(120, 40, 'full');
  const dialNow = () => frameLines(c.app.screenshot()).slice(L.consoleTop + 5, L.consoleTop + 10).map((r) => [...r].slice(L.consoleX + 54, L.consoleX + 63).join('')).join('|');
  const a = [dialNow()];
  for (let i = 0; i < 4; i++) { c.key('\x1b[C'); c.tick(0.5); a.push(dialNow()); }
  for (let i = 0; i + 1 < a.length; i++) assert.notEqual(a[i], a[i + 1], `step ${i + 1} turned the dial`);
  assert.equal(new Set(a).size, 5, 'four steps right on a three cartridge shelf: four different notches (it does not follow the list index)');
  c.key('\x1b[D'); c.tick(0.5);
  assert.equal(dialNow(), a[3], 'one step back turns it back');
  c.done();
});

test('retype: the console screen text is revealed left to right and complete at 1; no field means complete', () => {
  const st = consoleStyle(driftmanSkin);
  const lit = (g) => gridRows(g).slice(4, 13).map((r) => [...r].slice(4, 48).join('').replace(/ /g, '').length).reduce((a, b) => a + b, 0);
  const full = lit(consoleGrid(mkSel(), { st, ui, n: 3 }));
  assert.equal(lit(consoleGrid(mkSel(), { st, ui, n: 3, type: 1 })), full);
  assert.equal(lit(consoleGrid(mkSel(), { st, ui, n: 3, type: 0 })), 0, 'nothing typed yet');
  let last = 0;
  for (let k = 0; k <= 10; k++) {
    const n = lit(consoleGrid(mkSel(), { st, ui, n: 3, type: k / 10 }));
    assert.ok(n >= last, `monotonic at ${k}`);
    last = n;
  }
  // left to right: at the half way point the text left of column 22 is whole and the right of it is absent
  const rows = gridRows(consoleGrid(mkSel(), { st, ui, n: 3, type: 0.5 })).slice(4, 13).map((r) => [...r].slice(4, 48));
  const fullRows = gridRows(consoleGrid(mkSel(), { st, ui, n: 3 })).slice(4, 13).map((r) => [...r].slice(4, 48));
  for (let j = 0; j < 9; j++) {
    assert.equal(rows[j].slice(0, 22).join(''), fullRows[j].slice(0, 22).join(''), `row ${j} left half`);
    assert.equal(rows[j].slice(22).join('').trim(), '', `row ${j} right half`);
  }
});

test('retype: TYPE_SECONDS is about 0.3 and the view field drives drawLibrary', () => {
  assert.ok(TYPE_SECONDS >= 0.25 && TYPE_SECONDS <= 0.36);
  const v = { cartridges: [mkSel(), mkSel({ id: 'y', title: 'Other', tint: 24 })], index: 0, prev: 0, slide: 1, message: '', dip: 0 };
  const a = newFrame(120, 40), b = newFrame(120, 40);
  drawLibrary(a, { ...v, type: 0 }, driftmanSkin);
  drawLibrary(b, v, driftmanSkin);
  assert.ok(!frameLines(a).join('\n').includes('A short blurb'));
  assert.ok(frameLines(b).join('\n').includes('A short blurb'));
});
