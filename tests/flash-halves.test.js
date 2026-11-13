// DRIFT-8 C2: the flash meter on half-cell pixels (createFlashMeter in helpers-flash.js).
//
// Before C2 the meter blended the top and the bottom half of every cell into one value, so two halves that swap colour (the 9000's Rosette draws
// in half blocks) read as a cell that never changes: a full-screen 9 Hz white/black swap of the halves passed every rule at 0.0 (DRIFT-7
// challenge, finding 2). Now each glyph has a top and a bottom coverage and the meter judges BOTH grids: the pixel grid (cols x 2 rows) and the
// old cell grid. Every rule reports the WORSE of the two and `pass` needs both (a straight switch to pixels would loosen a thin feature: a patch
// whose top halves flicker fills half the pixels it fills cells). rep.cell and rep.pixel are the two readings; rep.l1 ... rep.r the worse of them.
//
//   T2.1  the glyph half table          T2.2  the field area            T2.3  the worse of the two grids
//   T2.4  must-fail controls the old meter could not see (sizes and rates it was not tuned on, truecolor, palette cells and 256 colours)
//   (T2.5, the mutation proof that the blended meter is blind to T2.4, is tests/flash-halves-mutation.test.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  glyphCoverage, glyphHalves, fieldSize, pixelFieldSize, createFlashMeter, luminanceOf, DEFAULT_COVERAGE,
} from './helpers-flash.js';
import { newFrame } from './helpers-flash-controls.js';
import {
  halvesSwap, halvesSwapPalette, SWAP_PALETTE, topFlicker, TEAL, AMBER, TEAL_AMBER_DY, runAt, RULE_IDS, ruleOf, failedRules,
} from './helpers-flash-halves.js';

const pct = (x) => (x * 100).toFixed(1);
const readout = (rep) => RULE_IDS.map((r) => `${r}=${pct(ruleOf(rep, r).worstFraction)}`).join(' ');
const failedOf = (rep) => failedRules(rep);
const TABLE = [];

// ---- T2.1 the glyph half table

test('T2.1 glyph halves: blocks, eighths, quadrants and braille by geometry', () => {
  const eq = (g, top, bot, what) => assert.deepEqual(glyphHalves(g), [top, bot], what ?? `U+${g.toString(16)}`);
  eq(0x2580, 1, 0, 'upper half block');
  eq(0x2584, 0, 1, 'lower half block');
  eq(0x2588, 1, 1, 'full block');
  eq(32, 0, 0, 'space');
  // lower eighths fill the bottom half first
  eq(0x2581, 0, 0.25, 'lower 1/8'); eq(0x2582, 0, 0.5, 'lower 1/4'); eq(0x2583, 0, 0.75, 'lower 3/8');
  eq(0x2585, 0.25, 1, 'lower 5/8'); eq(0x2586, 0.5, 1, 'lower 3/4'); eq(0x2587, 0.75, 1, 'lower 7/8');
  eq(0x2594, 0.25, 0, 'upper 1/8');
  // columns ink both halves alike
  eq(0x258c, 0.5, 0.5, 'left half'); eq(0x2590, 0.5, 0.5, 'right half'); eq(0x2595, 1 / 8, 1 / 8, 'right 1/8');
  // NOTE (found in C2, not changed): glyphCoverage has U+2589-258F reversed (U+2589 "left 7/8" reads 1/8 and U+258F "left 1/8" reads 7/8). The halves keep
  // glyphCoverage's value in both halves so that the cell reading is exactly what it has always been; the next test pins mean(top, bottom) = glyphCoverage.
  eq(0x258d, glyphCoverage(0x258d), glyphCoverage(0x258d), 'left eighths ink both halves alike');
  eq(0x2591, 0.25, 0.25, 'light shade'); eq(0x2592, 0.5, 0.5, 'medium shade'); eq(0x2593, 0.75, 0.75, 'dark shade');
  // quadrants U+2596-259F: [top, bottom]
  const quad = { 0x2596: [0, 0.5], 0x2597: [0, 0.5], 0x2598: [0.5, 0], 0x2599: [0.5, 1], 0x259a: [0.5, 0.5], 0x259b: [1, 0.5], 0x259c: [1, 0.5], 0x259d: [0.5, 0], 0x259e: [0.5, 0.5], 0x259f: [0.5, 1] };
  for (const [g, [t, b]] of Object.entries(quad)) eq(+g, t, b);
  // braille: the top four dots over the bottom four. Dot bits: 1 2 3 7 on the left (0x01 0x02 0x04 0x40), 4 5 6 8 on the right (0x08 0x10 0x20 0x80).
  eq(0x2800, 0, 0, 'blank braille');
  eq(0x28ff, 1, 1, 'all eight dots');
  eq(0x2801, 0.25, 0, 'dot 1 (top left)'); eq(0x2802, 0.25, 0, 'dot 2'); eq(0x2808, 0.25, 0, 'dot 4 (top right)'); eq(0x2810, 0.25, 0, 'dot 5');
  eq(0x2804, 0, 0.25, 'dot 3 (row 3)'); eq(0x2820, 0, 0.25, 'dot 6'); eq(0x2840, 0, 0.25, 'dot 7 (bottom left)'); eq(0x2880, 0, 0.25, 'dot 8 (bottom right)');
  eq(0x281b, 1, 0, 'the top four dots'); eq(0x28e4, 0, 1, 'the bottom four dots'); eq(0x28f0, 0.25, 0.75, 'dots 5 6 7 8: one in the top rows, three in the bottom');
});

test('T2.1 glyph halves: the mean of the two halves is glyphCoverage for every glyph; a non-block glyph is the same in both halves', () => {
  for (let g = 0; g < 65536; g++) {
    const [t, b] = glyphHalves(g);
    assert.ok(Math.abs((t + b) / 2 - glyphCoverage(g)) < 1e-12, `U+${g.toString(16)}: (${t} + ${b}) / 2 vs ${glyphCoverage(g)}`);
  }
  // letters, digits, punctuation, box drawing, CJK and glyphs past the table: one value for both halves, the glyph's own coverage
  for (const g of [65, 97, 48, 46, 44, 0x2500, 0x2502, 0x256d, 0x25cf, 0x4e2d, 0x2022]) {
    const [t, b] = glyphHalves(g);
    assert.equal(t, b, `U+${g.toString(16)} is the same in both halves`);
    assert.equal(t, glyphCoverage(g));
  }
  assert.deepEqual(glyphHalves(70000), [DEFAULT_COVERAGE, DEFAULT_COVERAGE]);
  // the geometry glyphs are the ones that differ between halves
  const differ = [];
  for (let g = 0; g < 65536; g++) { const [t, b] = glyphHalves(g); if (t !== b) differ.push(g); }
  assert.ok(differ.every((g) => (g >= 0x2580 && g <= 0x259f) || (g >= 0x2800 && g <= 0x28ff)), 'only block elements and braille differ between halves');
});

test('T2.1 the meter reads a half block as two pixels: top lit, bottom dark', () => {
  const m = createFlashMeter(3, 3, 18);
  const f = newFrame(3, 3);
  f.glyphs.fill(0x2580); f.fg.fill(0xffffff); f.bg.fill(0x000000);
  f.glyphs[1] = 0x2584; f.glyphs[2] = 0x2588; f.glyphs[3] = 32; f.glyphs[4] = 0x259b;
  m.push(f);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(m.pixelY(0, 0), 1); near(m.pixelY(0, 1), 0); near(m.cellY(0), 0.5);
  near(m.pixelY(1, 0), 0); near(m.pixelY(1, 1), 1);
  near(m.pixelY(2, 0), 1); near(m.pixelY(2, 1), 1);
  near(m.pixelY(3, 0), 0); near(m.pixelY(3, 1), 0);
  near(m.pixelY(4, 0), 1); near(m.pixelY(4, 1), 0.5); // U+259B: upper left, upper right, lower left
});

// ---- T2.2 the field

test('T2.2 field area: the pixel field is a third of the columns by 2 * ceil(rows / 3) pixel rows, the same share of the screen as the cell field', () => {
  const want = { '61x21': [21, 14], '80x24': [27, 16], '120x40': [40, 28], '280x70': [94, 48], '41x11': [14, 8] };
  for (const [key, [w, h]] of Object.entries(want)) {
    const [cols, rows] = key.split('x').map(Number);
    assert.deepEqual(pixelFieldSize(cols, rows), { w, h }, key);
    assert.equal(w, Math.ceil(cols / 3));
    assert.equal(h, 2 * Math.ceil(rows / 3));
    const cf = fieldSize(cols, rows);
    assert.equal((w * h) / (cols * 2 * rows), (cf.w * cf.h) / (cols * rows), `${key}: the field keeps its share of the screen`);
    const m = createFlashMeter(cols, rows, 18);
    m.push(newFrame(cols, rows));
    const rep = m.report();
    assert.deepEqual(m.pixelField, { w, h });
    assert.deepEqual(rep.pixel.field, { w, h }, `${key} rep.pixel.field`);
    assert.deepEqual(rep.cell.field, cf, `${key} rep.cell.field`);
    assert.deepEqual(rep.field, cf, `${key} rep.field stays the cell field`);
  }
});

// ---- T2.3 the worse of the two grids

test('T2.3 worse-of: a patch whose TOP halves flicker is caught by the cell grid and not the pixel grid (a thin feature); pass needs both', () => {
  // 24 x 6 cells at 120x40: 144 of the field's 560 cells (25.7 %) but only 144 of its 1120 pixels (12.9 %)
  const rep = runAt(topFlicker(120, 40, { w: 24, h: 6 }), 120, 40);
  TABLE.push('T2.3 top halves 24x6   ' + readout(rep.cell) + ' | pixel ' + readout(rep.pixel));
  assert.equal(rep.cell.l1.x1.pass, false); assert.ok(Math.abs(rep.cell.l1.x1.worstFraction - 144 / 560) < 1e-9);
  assert.equal(rep.pixel.l1.x1.pass, true); assert.ok(Math.abs(rep.pixel.l1.x1.worstFraction - 144 / 1120) < 1e-9);
  assert.equal(rep.l1.x1.pass, false, 'a pixel-only meter would have passed this');
  assert.equal(rep.l1.x1.worstFraction, rep.cell.l1.x1.worstFraction, 'the reported number is the worse (the cell grid\'s)');
  assert.equal(rep.l1.x1.details.grid, 'cell');
  assert.equal(rep.pass, false);
  assert.equal(rep.cell.pass, false);
  assert.equal(rep.pixel.pass, true, 'the pixel grid on its own passes it');
  // the same patch, a little smaller: both grids pass and the report passes
  const ok = runAt(topFlicker(120, 40, { w: 20, h: 6 }), 120, 40);
  assert.equal(ok.pass, true);
  assert.equal(ok.cell.pass, true); assert.equal(ok.pixel.pass, true);
  assert.ok(Math.abs(ok.l1.x1.worstFraction - 120 / 560) < 1e-9, 'worse of 21.4 % (cells) and 10.7 % (pixels)');
});

test('T2.3 worse-of: a top-pixel swing that is under the 0.10 swing once averaged with the bottom half is caught by the pixel grid and not the cell grid', () => {
  const lo = 0x303030, hi = 0x6e6e6e;
  const dY = luminanceOf(hi) - luminanceOf(lo);
  assert.ok(dY >= 0.10 && dY / 2 < 0.10, `the top pixel swings ${dY.toFixed(3)}, the cell ${(dY / 2).toFixed(3)}`);
  const rep = runAt(topFlicker(120, 40, { w: 40, h: 14, x0: 0, y0: 0, hi, lo }), 120, 40);
  TABLE.push('T2.3 top swing 0.126   ' + readout(rep.cell) + ' | pixel ' + readout(rep.pixel));
  assert.equal(rep.cell.l1.x1.worstFraction, 0, 'the cell average never moves by 0.10');
  assert.ok(rep.pixel.l1.x1.worstFraction > 0.49, 'half the pixels of the field flicker');
  assert.equal(rep.pixel.l1.x1.pass, false);
  assert.equal(rep.l1.x1.pass, false); assert.equal(rep.l1.x1.details.grid, 'pixel');
  assert.equal(rep.l1.x1.worstFraction, rep.pixel.l1.x1.worstFraction);
  assert.equal(rep.cell.pass, true);
  assert.equal(rep.pass, false, 'pass needs both grids');
});

test('T2.3 report shape: rep.cell and rep.pixel carry the same rule set as the report; the report is their worse', () => {
  const rep = runAt(topFlicker(120, 40, { w: 24, h: 6 }), 120, 40, { seconds: 4 });
  assert.deepEqual(Object.keys(rep).sort(), ['c', 'cell', 'cols', 'field', 'fps', 'frames', 'l1', 'l2', 'l3', 'pass', 'pixel', 'r', 'rows'].sort());
  for (const sub of [rep.cell, rep.pixel]) {
    assert.deepEqual(Object.keys(sub).sort(), ['c', 'field', 'frames', 'l1', 'l2', 'l3', 'pass', 'r'].sort());
    assert.equal(sub.frames, rep.frames);
  }
  for (const id of RULE_IDS) {
    const c = ruleOf(rep.cell, id), p = ruleOf(rep.pixel, id), w = ruleOf(rep, id);
    assert.equal(w.worstFraction, Math.max(c.worstFraction, p.worstFraction), id);
    assert.equal(w.pass, c.pass && p.pass, id);
    assert.equal(w.limit, c.limit);
    assert.ok(w.details.grid === 'cell' || w.details.grid === 'pixel');
  }
  assert.equal(rep.pass, rep.cell.pass && rep.pixel.pass);
});

// ---- T2.4 must-fail controls

// [cols, rows, fps, seconds]: the 120x40 at 18 fps the meter was tuned on, and sizes and rates it was not (small, a different frame rate, the biggest)
const CASES = [[120, 40, 18, 8], [61, 21, 18, 8], [80, 24, 24, 8], [280, 70, 18, 5]];
for (const [cols, rows, fps, seconds] of CASES) {
  const tag = `${cols}x${rows}@${fps}`;
  test(`T2.4 must-fail ${tag}: halves swapping white/black on every frame and at 4 Hz read 0 on the cell grid (the old meter) and fail L1, L2 and L3 on the pixel grid`, () => {
    for (const [name, hz] of [['every frame', fps / 2], ['4 Hz', 4]]) {
      const rep = runAt(halvesSwap(cols, rows, { hz }), cols, rows, { fps, seconds });
      TABLE.push(`T2.4 ${tag} swap ${name}`.padEnd(30) + readout(rep.cell) + ' | pixel ' + readout(rep.pixel));
      for (const id of RULE_IDS) assert.equal(ruleOf(rep.cell, id).worstFraction, 0, `${tag} ${name}: the cell grid (the old meter) reads ${id} = 0`);
      assert.equal(rep.cell.pass, true, 'the old reading passes');
      for (const id of ['l1.x1', 'l1.x4', 'l2.x1', 'l2.x4', 'l3']) {
        assert.ok(ruleOf(rep.pixel, id).worstFraction > 0.99, `${tag} ${name}: pixel ${id} ${pct(ruleOf(rep.pixel, id).worstFraction)}`);
        assert.equal(ruleOf(rep, id).pass, false, `${tag} ${name}: the report fails ${id}`);
      }
      assert.equal(rep.pass, false);
      assert.equal(rep.r.x1.pass && rep.r.x4.pass, true, 'grey: no red');
    }
  });
}

test('T2.4 must-fail: the same swap through palette cells, and through 256-colour output, fails; a swap of two palette entries is seen too', () => {
  for (const [cols, rows] of [[120, 40], [61, 21]]) {
    const pal = runAt(halvesSwapPalette(cols, rows, { hz: 9 }), cols, rows, { palette: SWAP_PALETTE });
    TABLE.push(`T2.4 ${cols}x${rows} palette swap`.padEnd(30) + readout(pal.cell) + ' | pixel ' + readout(pal.pixel));
    assert.equal(pal.cell.l1.x1.worstFraction, 0); assert.ok(pal.pixel.l1.x1.worstFraction > 0.99); assert.equal(pal.pass, false);
    const c256 = runAt(halvesSwap(cols, rows, { hz: 9 }), cols, rows, { reduce256: true });
    TABLE.push(`T2.4 ${cols}x${rows} swap 256 colours`.padEnd(30) + readout(c256.cell) + ' | pixel ' + readout(c256.pixel));
    assert.equal(c256.cell.l1.x1.worstFraction, 0); assert.ok(c256.pixel.l1.x1.worstFraction > 0.99); assert.equal(c256.pass, false);
  }
});

test('T2.4 colour-only: halves swapping teal/amber (the same lightness) read 0 on every brightness and red rule; rule C (DRIFT-8 C4) fails it, on the pixel grid only (the cell grid blends the halves)', () => {
  assert.ok(TEAL_AMBER_DY < 0.02, `teal and amber differ by ${TEAL_AMBER_DY.toFixed(4)} in luminance`);
  for (const [cols, rows] of [[120, 40], [61, 21]]) {
    const rep = runAt(halvesSwap(cols, rows, { hz: 9, a: TEAL, b: AMBER }), cols, rows);
    TABLE.push(`T2.4 ${cols}x${rows} teal/amber 9 Hz`.padEnd(30) + readout(rep.cell) + ' | pixel ' + readout(rep.pixel) + ' (colour-only: rule C)');
    assert.deepEqual(failedRules(rep, { not: ['c'] }), [], 'the brightness and red rules do not see a change of hue at one lightness');
    for (const id of RULE_IDS.filter((r) => r !== 'c')) assert.equal(ruleOf(rep.pixel, id).worstFraction, 0, id);
    assert.deepEqual(failedOf(rep), ['c'], 'the colour rule sees it (this was the KNOWN GAP of C2)');
    assert.ok(rep.pixel.c.worstFraction > 0.99, `pixel grid ${pct(rep.pixel.c.worstFraction)}`);
    assert.equal(rep.cell.c.worstFraction, 0, 'the cell grid blends the two halves of every cell into one colour that never changes');
    assert.equal(rep.c.details.grid, 'pixel');
    assert.equal(rep.pass, false);
  }
});

test('T2.4 a swap of halves that do not differ (a space, both halves one colour) reads nothing: no false alarm', () => {
  const f = newFrame(120, 40);
  f.fg.fill(0x808080); f.bg.fill(0x808080);
  const rep = runAt(() => f, 120, 40, { seconds: 3 });
  assert.equal(rep.pass, true);
  for (const id of RULE_IDS) assert.equal(ruleOf(rep, id).worstFraction, 0, id);
});

test('T2.4 measured table', () => {
  console.log('\nTABLE flash halves (worstFraction %, cell grid | pixel grid)\n  ' + TABLE.join('\n  '));
  assert.ok(TABLE.length > 0);
});
