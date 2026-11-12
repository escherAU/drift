// DRIFT-4 F2: the library carousel's output bandwidth, pinned without real time.
//
// A fake terminal counts the bytes the app writes while one slide plays (a right arrow, then 2 s at 18 fps, the same
// rhythm as `node tools/measure.mjs --library --cycle 2`). The budget is cycling <= 40 KB/s, so a slide may cost about
// 80 KB. The real cartridges are used: the fixtures have almost no label art, so they would hide the cost.
//
// The bounds below are the deterministic output of this run (seed 1, seven cartridges) plus headroom, not
// the budget: if one fails, a change made the carousel write more, so measure with
// `node tools/measure.mjs --library --cycle 2 --seconds 35 --cols 240 --rows 67` before loosening anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { INSTALL_DIR } from '../src/cartridge/loader.js';
import { shelfLayout, slideOffset, xlSlideProgress, bandProgress, BAND_STEPS, CART_W, NEIGHBOUR_STEP } from '../src/shell/library.js';
import { SLIDE_SECONDS } from '../src/shell/shell.js';
import { mkShell, DT } from './helpers-shell.js';
import { tmpRoot } from './helpers-cartridge.js';

// The shipped cartridges (classic and three locked) plus three clones of the locked ones under other ids and hues:
// seven in all, so every slot of the shelf, the far ones and the one sliding in, holds a different cartridge.
function sevenRoot() {
  const root = tmpRoot('drift-bandwidth-');
  fs.cpSync(INSTALL_DIR, root, { recursive: true });
  for (const [src, hue, code] of [['arcade', '#44CCAA', 'DM-11'], ['last-fantasy', '#CC66FF', 'DM-12'], ['night-drive', '#FF8855', 'DM-13']]) {
    fs.cpSync(path.join(INSTALL_DIR, src), path.join(root, src + '-b'), { recursive: true });
    const mf = path.join(root, src + '-b', 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    Object.assign(m, { id: src + '-b', title: m.title + ' B', labelHue: hue, code });
    fs.writeFileSync(mf, JSON.stringify(m));
  }
  return root;
}
const dirs = [{ dir: sevenRoot(), trusted: true }];
const RIGHT = '\x1b[C';
const bytesOf = (c) => c.stdout.writes.reduce((a, s) => a + Buffer.byteLength(s), 0);

function slideBytes(cols, rows, presses = 4) {
  const c = mkShell({ startScreen: { screen: 'library' }, cols, rows, dirs });
  c.app.start();
  c.tick(3); // fade-in over, idle running
  const per = [];
  for (let k = 0; k < presses; k++) {
    const before = bytesOf(c);
    c.key(RIGHT);
    c.tick(2);
    per.push(bytesOf(c) - before);
  }
  c.done();
  return per;
}

// [cols, rows, bound in bytes for one slide plus the 1.64 s of idle after it]. Measured here, worst of 4 slides:
// 240x67 60617, 120x40 142756, 80x24 5118 (until Delza: she is the first cartridge that is unlocked and has a coloured label,
// and 80x24 measured 8321 with her on the shelf, 4 KB/s as a 2 s cycle, a tenth of the 40 KB/s budget). The 240x67 bound is the budget itself (40 KB/s x 2 s, 32% above the
// measurement; it was 190-200 KB before the stepped slide); the others are the measurement + 25%. 120x40 was NOT within the 40 KB/s budget (142756 a slide, the 30% per-frame rule capped the shelf at 7 columns a frame
// so it could not take the stepped slide); the two-halves slide of the photosensitivity fix (bandProgress) writes about
// 83400, 40.7 KB/s as a 2 s cycle, and the bound is that + 25%.
// DRIFT-7 C6 (the Driftman 9000 on the shelf, nine cartridges in this run). Worst of 4 slides, before -> after:
// 240x67 62797 -> 66295 (bound unchanged, 80000), 120x40 84610 -> 84610 (unchanged, 104000), 80x24 8321 -> 38527 (4 slides:
// 5118 903 8190 38527 after; the slide that seats the 9000 writes its full-colour label and holo foil, 18.8 KB/s as a 2 s
// cycle, under the 40 KB/s budget). The 80x24 bound is that + 25%. `measure --library --cycle 2 --seconds 35 --cols 240 --rows 67`:
// 1212818 bytes, 33.8 KB/s before -> 878048 bytes, 24.5 KB/s after (a different mix of slides in the 35 s).
const BOUNDS = [
  [240, 67, 80000],
  [120, 40, 104000],
  [80, 24, 48200],
];

for (const [cols, rows, bound] of BOUNDS) {
  test(`bandwidth ${cols}x${rows}: every slide writes under ${bound} bytes`, (t) => {
    const per = slideBytes(cols, rows);
    t.diagnostic(`${cols}x${rows}: bytes per slide ${per.join(' ')}; as a 2 s cycle ${(Math.max(...per) / 2048).toFixed(1)} KB/s`);
    for (const b of per) assert.ok(b < bound, `a slide wrote ${b} bytes (bound ${bound})`);
  });
}

test('bandwidth: the extra-large slide moves on three of its frames (34 -> 21 -> 10 -> 0), holds between, ends settled', () => {
  assert.equal(xlSlideProgress(0), 0);
  assert.equal(xlSlideProgress(1), 1);
  const frame = DT / SLIDE_SECONDS;
  const offs = [];
  for (let k = 1; k * frame < 1; k++) offs.push(slideOffset(xlSlideProgress(k * frame), 1));
  assert.deepEqual(offs, [34, 21, 21, 10, 10, 0], 'frames 1-6 of the slide');
  // the cuts sit between frames: a frame 40% early or late lands on the same step
  for (let k = 1; k <= 6; k++) {
    const want = slideOffset(xlSlideProgress(k * frame), 1);
    for (const e of [-0.4, 0.4]) assert.equal(slideOffset(xlSlideProgress((k + e) * frame), 1), want, `frame ${k} ${e}`);
  }
  const moves = [NEIGHBOUR_STEP, 21, 10, 0].map((x, k, a) => (k ? a[k - 1] - x : 0)).slice(1);
  assert.equal(moves.reduce((a, b) => a + b, 0), NEIGHBOUR_STEP);
  assert.ok(moves[0] >= moves[1] && moves[1] >= moves[2] - 1, `ease-out: ${moves}`);
});

test('bandwidth: below the extra-large tier the shelf moves in two halves that take turns, each to where the whole shelf would be, ending settled', () => {
  assert.equal(bandProgress(0, 0), 0);
  assert.equal(bandProgress(0, 1), 0);
  assert.equal(bandProgress(1, 0), 1);
  assert.equal(bandProgress(1, 1), 1);
  const frame = DT / SLIDE_SECONDS;
  const seq = [[], []];
  for (let k = 1; k * frame < 1; k++) for (const b of [0, 1]) seq[b].push(slideOffset(bandProgress(k * frame, b), 1));
  // the upper half moves on frames 1, 3, 5 and the lower on 2, 4, 6; nothing moves backwards; both are at rest after 6
  assert.deepEqual(seq[0], [27, 27, 15, 15, 5, 5], 'upper half, frames 1-6');
  assert.deepEqual(seq[1], [34, 21, 21, 10, 10, 1], 'lower half, frames 1-6');
  // the halves are never more than one frame's step (7 columns) apart; in every frame at most one half moves
  for (let k = 0; k < 6; k++) assert.ok(Math.abs(seq[0][k] - seq[1][k]) <= 7, `frame ${k + 1}: halves ${seq[0][k]} / ${seq[1][k]}`);
  for (let k = 1; k < 6; k++) assert.ok(seq[0][k] === seq[0][k - 1] || seq[1][k] === seq[1][k - 1], `frame ${k + 1}: only one half moves`);
  // the cuts sit between frames: a frame 40% early or late lands on the same step
  for (let k = 1; k <= 6; k++) for (const b of [0, 1]) {
    const want = bandProgress(k * frame, b);
    for (const e of k === 6 ? [-0.4] : [-0.4, 0.4]) assert.equal(bandProgress((k + e) * frame, b), want, `frame ${k} half ${b} ${e}`); // frame 6 + 0.4 is already the settled frame
  }
});

test('bandwidth 240x67: the far slot the shelf moves towards keeps its old picture until the last frame', () => {
  const c = mkShell({ startScreen: { screen: 'library' }, cols: 240, rows: 67, dirs });
  c.app.start();
  c.tick(3);
  const L = shelfLayout(240, 67, 'full');
  assert.ok(L.xl);
  const slot = (f, x0) => {
    let o = '';
    for (let y = L.cartTop; y < L.cartTop + 18; y++) for (let x = x0; x < x0 + CART_W; x++) o += `${f.glyphs[y * f.cols + x]}/${f.shades[y * f.cols + x]},`;
    return o;
  };
  // right arrow: the shelf slides left, so the far-left slot is ahead of it. The sliding cartridges never reach it, so
  // it shows the old far cartridge in frames 1-5 and the new one in the settled frame 6.
  const farL = L.cartX - 2 * L.step;
  const before = slot(c.app.screenshot(), farL);
  c.key(RIGHT);
  const during = [];
  for (let k = 1; k <= 6; k++) { c.app.tick(DT); during.push(slot(c.app.screenshot(), farL)); }
  for (let k = 0; k < 5; k++) assert.equal(during[k] === before, true, `frame ${k + 1}: the far slot still shows the old picture`);
  assert.equal(during[5] === before, false, 'frame 6: the far slot has changed to the new far cartridge');
  c.done();
});
