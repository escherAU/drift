// DRIFT-8 C7: the flash meter's table of how much ink each block element has (glyphCoverage, and glyphHalves for the top and bottom half of the cell) is
// checked against GEOMETRY, for every glyph of U+2580-U+259F. The geometry here is its own: each glyph is written out as filled rectangles on an 8 x 8 grid
// (x to the right, y down, a rectangle is [x0, y0, x1, y1) in eighths of the cell) and rasterised below; the shades are their nominal fractions (the unicode
// light, medium and dark shade are 25, 50 and 75 percent). Nothing here is computed the way tests/helpers-flash.js computes its table.
//
// The defect this guards (found in DRIFT-8 C2): the table had U+2589-U+258F reversed, so "left seven eighths" read as one eighth and "left one eighth" as seven.
import test from 'node:test';
import assert from 'node:assert/strict';
import { glyphCoverage, glyphHalves } from './helpers-flash.js';

const Q = { UL: [0, 0, 4, 4], UR: [4, 0, 8, 4], LL: [0, 4, 4, 8], LR: [4, 4, 8, 8] };

// [code point, name, rectangles] - or [code point, name, null, fraction] for a shade
const BLOCKS = [
  [0x2580, 'upper half block', [[0, 0, 8, 4]]],
  [0x2581, 'lower one eighth block', [[0, 7, 8, 8]]],
  [0x2582, 'lower one quarter block', [[0, 6, 8, 8]]],
  [0x2583, 'lower three eighths block', [[0, 5, 8, 8]]],
  [0x2584, 'lower half block', [[0, 4, 8, 8]]],
  [0x2585, 'lower five eighths block', [[0, 3, 8, 8]]],
  [0x2586, 'lower three quarters block', [[0, 2, 8, 8]]],
  [0x2587, 'lower seven eighths block', [[0, 1, 8, 8]]],
  [0x2588, 'full block', [[0, 0, 8, 8]]],
  [0x2589, 'left seven eighths block', [[0, 0, 7, 8]]],
  [0x258a, 'left three quarters block', [[0, 0, 6, 8]]],
  [0x258b, 'left five eighths block', [[0, 0, 5, 8]]],
  [0x258c, 'left half block', [[0, 0, 4, 8]]],
  [0x258d, 'left three eighths block', [[0, 0, 3, 8]]],
  [0x258e, 'left one quarter block', [[0, 0, 2, 8]]],
  [0x258f, 'left one eighth block', [[0, 0, 1, 8]]],
  [0x2590, 'right half block', [[4, 0, 8, 8]]],
  [0x2591, 'light shade', null, 0.25],
  [0x2592, 'medium shade', null, 0.5],
  [0x2593, 'dark shade', null, 0.75],
  [0x2594, 'upper one eighth block', [[0, 0, 8, 1]]],
  [0x2595, 'right one eighth block', [[7, 0, 8, 8]]],
  [0x2596, 'quadrant lower left', [Q.LL]],
  [0x2597, 'quadrant lower right', [Q.LR]],
  [0x2598, 'quadrant upper left', [Q.UL]],
  [0x2599, 'quadrant upper left and lower left and lower right', [Q.UL, Q.LL, Q.LR]],
  [0x259a, 'quadrant upper left and lower right', [Q.UL, Q.LR]],
  [0x259b, 'quadrant upper left and upper right and lower left', [Q.UL, Q.UR, Q.LL]],
  [0x259c, 'quadrant upper left and upper right and lower right', [Q.UL, Q.UR, Q.LR]],
  [0x259d, 'quadrant upper right', [Q.UR]],
  [0x259e, 'quadrant upper right and lower left', [Q.UR, Q.LL]],
  [0x259f, 'quadrant upper right and lower left and lower right', [Q.UR, Q.LL, Q.LR]],
];

// the independent rasteriser: [coverage, top half share, bottom half share] of a glyph, each 0..1
export function geometryOf([, , rects, fraction]) {
  if (!rects) return [fraction, fraction, fraction]; // a shade inks both halves alike, at its nominal fraction
  const on = new Uint8Array(64);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) on[y * 8 + x] = 1;
  let all = 0, top = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (on[y * 8 + x]) { all++; if (y < 4) top++; }
  return [all / 64, top / 32, (all - top) / 32];
}

test('the geometry table itself: 32 glyphs, U+2580 to U+259F once each; the rasteriser reads known shapes right', () => {
  assert.equal(BLOCKS.length, 32);
  assert.deepEqual(BLOCKS.map((b) => b[0]), Array.from({ length: 32 }, (_, i) => 0x2580 + i));
  const g = (cp) => geometryOf(BLOCKS.find((b) => b[0] === cp));
  assert.deepEqual(g(0x2580), [0.5, 1, 0]);      // upper half: all of the top, none of the bottom
  assert.deepEqual(g(0x2584), [0.5, 0, 1]);      // lower half
  assert.deepEqual(g(0x2588), [1, 1, 1]);
  assert.deepEqual(g(0x2581), [1 / 8, 0, 1 / 4]); // lower one eighth: a quarter of the bottom half
  assert.deepEqual(g(0x2587), [7 / 8, 3 / 4, 1]); // lower seven eighths: all of the bottom, three quarters of the top
  assert.deepEqual(g(0x2589), [7 / 8, 7 / 8, 7 / 8]); // left seven eighths inks both halves alike
  assert.deepEqual(g(0x258f), [1 / 8, 1 / 8, 1 / 8]);
  assert.deepEqual(g(0x2594), [1 / 8, 1 / 4, 0]); // upper one eighth: a quarter of the top half
  assert.deepEqual(g(0x2599), [3 / 4, 1 / 2, 1]);
  // every glyph: the mean of the halves is the whole
  for (const b of BLOCKS) { const [c, t, bo] = geometryOf(b); assert.ok(Math.abs((t + bo) / 2 - c) < 1e-12, `U+${b[0].toString(16)}`); }
});

for (const b of BLOCKS) {
  const [cp, name] = b;
  test(`U+${cp.toString(16).toUpperCase()} ${name}: glyphCoverage and both halves of glyphHalves equal the 8 x 8 geometry`, () => {
    const [cov, top, bot] = geometryOf(b);
    const [t, bo] = glyphHalves(cp);
    assert.equal(glyphCoverage(cp), cov, `glyphCoverage(U+${cp.toString(16)}) is ${glyphCoverage(cp)}, the geometry says ${cov}`);
    assert.equal(t, top, `top half share is ${t}, the geometry says ${top}`);
    assert.equal(bo, bot, `bottom half share is ${bo}, the geometry says ${bot}`);
  });
}
