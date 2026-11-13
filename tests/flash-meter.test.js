// DRIFT-7 C4a: the full-colour flash meter (createFlashMeter in helpers-flash.js) and the controls it must catch.
// Part 1 tests the pieces (glyph coverage, cell luminance, swing tracker, transition ring, summed-area window,
// field size). Part 2 runs the meter on 30 s of synthetic scenes at 120x40, 18 fps (tests/helpers-flash-controls.js):
// each control asserts WHICH rules fail and which pass. Part 3 pins the meter's constants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_FRACTION, STEP_FRACTION, TRANSITION_SWING, DARK_SIDE_MAX, RED_SATURATION, RED_SWING, RED_SCALE,
  L1_COUNT, L2_COUNT, R_COUNT, METER_RGB_CELL, METER_PALETTE_BG, FLASH_FRACTION, SHADE_STEP_LSTAR,
  glyphCoverage, DEFAULT_COVERAGE, luminanceOf, fieldSize, createSwingTracker, createTransitionLog,
  createWindowCounter, createFlashMeter, RULE_IDS, ruleOf, failedRules,
} from './helpers-flash.js';
import {
  CONTROL_COLS as C, CONTROL_ROWS as R, CONTROL_FPS as FPS, newFrame, runControl, rgbOf256, makeReducer256,
  strobe, bloom, redPulse, gradient, hsvKaleidoscope, isoKaleidoscope, safeKaleidoscope, pop, hueOnly, oneStep, hueStep,
} from './helpers-flash-controls.js';
import { RGB_CELL, PALETTE_BG } from '../src/renderer.js';
import { rgbTo256 } from '../src/color.js';

// ---- helpers

const RULES = RULE_IDS; // DRIFT-8 C4: the shared list (the seven brightness and red rules, and C)
const cell = ruleOf;
// the rules a report fails (every one of the eight; all are binding)
const failed = (rep) => failedRules(rep);
// the brightness and red rules only: for the controls that are about those, whose colour verdict is rule C's (tests/flash-colour.test.js)
const failedBright = (rep) => failedRules(rep, { not: ['c'] });
const pct = (rep, rule) => (cell(rep, rule).worstFraction * 100).toFixed(1) + '%';
const table = [];
const record = (name, rep) => table.push(`${name.padEnd(34)} ` + RULES.map((r) => `${r}=${pct(rep, r)}`).join(' ') + ` | fails: ${failed(rep).join(',') || 'none'}`);

const memo = new Map();
function control(name, make, opts = {}) {
  if (!memo.has(name)) {
    const rep = runControl(make(opts.cols ?? C, opts.rows ?? R), opts);
    record(name, rep);
    memo.set(name, rep);
  }
  return memo.get(name);
}

// ---- part 1: pieces

test('glyph coverage: space, blocks, shades, braille, defaults', () => {
  assert.equal(glyphCoverage(32), 0);
  assert.equal(glyphCoverage(0x2588), 1);
  assert.equal(glyphCoverage(0x2580), 0.5);
  assert.equal(glyphCoverage(0x2584), 0.5);
  assert.equal(glyphCoverage(0x2591), 0.25);
  assert.equal(glyphCoverage(0x2592), 0.5);
  assert.equal(glyphCoverage(0x2593), 0.75);
  assert.equal(glyphCoverage(0x2800), 0);
  assert.equal(glyphCoverage(0x2801), 1 / 8);
  assert.equal(glyphCoverage(0x28ff), 1);
  assert.equal(glyphCoverage(0x2803), 2 / 8);
  assert.equal(glyphCoverage(0x28f0), 4 / 8);
  assert.equal(glyphCoverage(65), DEFAULT_COVERAGE, 'a letter takes the documented default');
  assert.equal(DEFAULT_COVERAGE, 0.35);
  assert.equal(glyphCoverage(0x4e2d), DEFAULT_COVERAGE, 'an unknown glyph takes the default');
  assert.ok(glyphCoverage(46) < glyphCoverage(65), 'a full stop has less ink than a letter');
});

test('luminanceOf is the WCAG relative luminance, independent of src', () => {
  assert.equal(luminanceOf(0x000000), 0);
  assert.ok(Math.abs(luminanceOf(0xffffff) - 1) < 1e-12);
  assert.ok(Math.abs(luminanceOf(0xff0000) - 0.2126) < 1e-12);
  assert.ok(Math.abs(luminanceOf(0x00ff00) - 0.7152) < 1e-12);
  assert.ok(Math.abs(luminanceOf(0x0000ff) - 0.0722) < 1e-12);
  // mid grey 0x808080: ((128/255 + 0.055) / 1.055) ^ 2.4
  assert.ok(Math.abs(luminanceOf(0x808080) - 0.21586050011389926) < 1e-9);
});

test('cell luminance blends fg and bg by glyph coverage; palette cells use the palette tables', () => {
  const pal = { fgRgb: Uint32Array.of(0x000000, 0xffffff, 0xff0000), bgRgb: Uint32Array.of(0x202020, 0x000000, 0x000000) };
  const m = createFlashMeter(3, 3, 18);
  const f = newFrame(3, 3);
  f.fg.fill(0xffffff); f.bg.fill(0x000000);
  f.glyphs[0] = 32; f.glyphs[1] = 0x2588; f.glyphs[2] = 0x2591; f.glyphs[3] = 0x2592; f.glyphs[4] = 0x2593; f.glyphs[5] = 0x2580;
  f.glyphs[6] = 0x2801;
  f.glyphs[7] = 0x2588; f.shades[7] = 1;   // palette cell: fgRgb[1] white
  f.glyphs[8] = 32; f.shades[8] = 2;       // blank palette cell: bgRgb[0], not bgRgb[2] and not fg/bg
  m.push(f, pal);
  const Y = m.cellY;
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(Y(0), 0);        // space: bg only
  near(Y(1), 1);        // full block: fg only
  near(Y(2), 0.25); near(Y(3), 0.5); near(Y(4), 0.75);
  near(Y(5), 0.5);      // half block
  near(Y(6), 1 / 8);    // one braille dot
  near(Y(7), 1);        // palette table fg
  near(Y(8), luminanceOf(0x202020)); // blank palette cell reads table entry 0's bg
});

test('PALETTE_BG on a full-colour cell means the palette background (table entry 0)', () => {
  const pal = { fgRgb: Uint32Array.of(0xffffff), bgRgb: Uint32Array.of(0x808080) };
  const m = createFlashMeter(3, 3, 18);
  const f = newFrame(3, 3);
  f.bg.fill(PALETTE_BG); f.fg.fill(0x000000);
  m.push(f, pal);
  assert.ok(Math.abs(m.cellY(4) - luminanceOf(0x808080)) < 1e-12);
  assert.equal(METER_PALETTE_BG, PALETTE_BG);
  assert.equal(METER_RGB_CELL, RGB_CELL);
});

test('field is ceil(cols/3) x ceil(rows/3) cells at odd sizes', () => {
  assert.deepEqual(fieldSize(41, 11), { w: 14, h: 4 });
  assert.deepEqual(fieldSize(80, 24), { w: 27, h: 8 });
  assert.deepEqual(fieldSize(120, 40), { w: 40, h: 14 });
  assert.deepEqual(fieldSize(240, 67), { w: 80, h: 23 });
  assert.deepEqual(fieldSize(1, 1), { w: 1, h: 1 });
  assert.deepEqual(fieldSize(2, 2), { w: 1, h: 1 });
  for (const [c, r] of [[41, 11], [80, 24], [120, 40], [240, 67]]) {
    assert.deepEqual(createFlashMeter(c, r, 18).field, fieldSize(c, r), `${c}x${r}`);
  }
});

test('swing tracker: a slow ramp totalling 0.10 counts once; a 0.05 jitter never counts', () => {
  const t = createSwingTracker(1, { swing: TRANSITION_SWING, darkSide: DARK_SIDE_MAX });
  let n = 0;
  for (let k = 0; k <= 30; k++) if (t.step(0, 0.2 + k * 0.01, 0)) n++; // 0.2 -> 0.5, 0.01 a step
  assert.equal(n, 1, 'the climb counts once, when it has totalled 0.10, and not again while it keeps rising');
  const j = createSwingTracker(1, { swing: TRANSITION_SWING, darkSide: DARK_SIDE_MAX });
  let m = 0;
  for (let k = 0; k < 200; k++) if (j.step(0, k % 2 ? 0.25 : 0.30, 0)) m++;
  assert.equal(m, 0, 'a 0.05 jitter never reaches the swing');
  const slow = createSwingTracker(1, { swing: TRANSITION_SWING, darkSide: DARK_SIDE_MAX });
  let s = 0;
  for (let k = 0; k <= 9; k++) if (slow.step(0, 0.2 + k * 0.01, 0)) s++; // totals 0.09
  assert.equal(s, 0, 'a ramp totalling 0.09 does not count');
});

test('swing tracker: up and down swings count at the turning points; the darker side must be under 0.8', () => {
  const t = createSwingTracker(1, { swing: TRANSITION_SWING, darkSide: DARK_SIDE_MAX });
  const seq = [0.1, 0.1, 0.3, 0.5, 0.45, 0.5, 0.2, 0.0, 0.05, 0.3];
  const fired = seq.map((v) => t.step(0, v, 0));
  // 0.1 -> 0.3 up (1), 0.5 -> 0.2 down (2), 0.0 -> 0.3 up (3)
  assert.deepEqual(fired.map((f, i) => (f ? i : -1)).filter((i) => i >= 0), [2, 6, 9]);
  const bright = createSwingTracker(1, { swing: TRANSITION_SWING, darkSide: DARK_SIDE_MAX });
  let n = 0;
  for (let k = 0; k < 20; k++) if (bright.step(0, k % 2 ? 0.85 : 0.97, 0)) n++;
  assert.equal(n, 0, 'a swing between two states both above 0.8 is not a flash');
  const edge = createSwingTracker(1, { swing: TRANSITION_SWING, darkSide: DARK_SIDE_MAX });
  n = 0;
  for (let k = 0; k < 20; k++) if (edge.step(0, k % 2 ? 0.75 : 0.9, 0)) n++;
  assert.ok(n > 10, 'darker side 0.75 is under 0.8: every swing counts');
});

test('red swing tracker: strict 20, and the swing needs a saturated red at one end', () => {
  const t = createSwingTracker(1, { swing: RED_SWING, strict: true, gate: true });
  let n = 0;
  for (let k = 0; k < 10; k++) if (t.step(0, k % 2 ? 0 : 20, 1)) n++;
  assert.equal(n, 0, 'a swing of exactly 20 is not above 20');
  const u = createSwingTracker(1, { swing: RED_SWING, strict: true, gate: true });
  n = 0;
  for (let k = 0; k < 10; k++) if (u.step(0, k % 2 ? 0 : 21, 1)) n++;
  assert.ok(n >= 8, 'a swing of 21 counts');
  const v = createSwingTracker(1, { swing: RED_SWING, strict: true, gate: true });
  n = 0;
  for (let k = 0; k < 10; k++) if (v.step(0, k % 2 ? 0 : 100, 0)) n++;
  assert.equal(n, 0, 'not saturated at either end: no red transition');
});

test('transition ring: counts in a window and keeps the newest after it wraps', () => {
  const log = createTransitionLog(2, 3);
  for (let f = 0; f < 10; f++) log.add(0, f * 2); // frames 0,2,...,18 on cell 0 (a ring of 3 keeps 14, 16, 18)
  assert.equal(log.hot(0, 3, 18, 5), true, '14, 16, 18 are within (13, 18]');
  assert.equal(log.hot(0, 3, 18, 4), false, '14 is not within (14, 18]');
  assert.equal(log.hot(0, 2, 18, 3), true, '16 and 18 are within (15, 18]');
  assert.equal(log.hot(0, 1, 18, 1), true);
  assert.equal(log.hot(0, 1, 19, 1), false, '18 is not within (18, 19]');
  assert.equal(log.hot(1, 1, 18, 1000), false, 'a cell with no transitions is never hot');
  log.add(1, 5);
  assert.equal(log.hot(1, 1, 5, 1), true);
  assert.equal(log.hot(1, 2, 5, 1000), false, 'one transition is not two');
  assert.equal(log.hot(0, 3, 18, 5), true, 'cell 1 does not disturb cell 0');
  assert.throws(() => log.hot(0, 4, 18, 6), /ring/);
});

test('summed-area window maximum equals brute force on random grids', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const [cols, rows, p] of [[41, 11, 0.3], [80, 24, 0.5], [17, 9, 0.1], [120, 40, 0.05], [30, 30, 0.9], [3, 3, 0.5]]) {
    const { w, h } = fieldSize(cols, rows);
    const wc = createWindowCounter(cols, rows, w, h);
    for (let trial = 0; trial < 4; trial++) {
      const grid = new Uint8Array(cols * rows);
      for (let i = 0; i < grid.length; i++) grid[i] = rnd() < p ? 1 : 0;
      let best = -1, bx = 0, by = 0;
      for (let y = 0; y + h <= rows; y++) for (let x = 0; x + w <= cols; x++) {
        let s = 0;
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) s += grid[(y + yy) * cols + x + xx];
        if (s > best) { best = s; bx = x; by = y; }
      }
      const got = wc.best(grid);
      assert.deepEqual(got, { count: best, x: bx, y: by }, `${cols}x${rows} trial ${trial}`);
    }
  }
});

test('the meter owns its luminance: helpers-flash.js imports nothing from src', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('./helpers-flash.js', import.meta.url), 'utf8');
  assert.equal(/from\s+['"][^'"]*src\//.test(text), false);
});

// ---- part 2: controls

test('rgbOf256 inverts rgbTo256 on the cube and the greys', () => {
  assert.equal(rgbOf256(rgbTo256([0, 0, 0])), 0x000000);
  assert.equal(rgbOf256(rgbTo256([255, 255, 255])), 0xffffff);
  assert.equal(rgbOf256(rgbTo256([255, 0, 0])), 0xff0000);
  assert.equal(rgbOf256(rgbTo256([96, 0, 134])), 0x5f0087);
  assert.equal(rgbOf256(rgbTo256([128, 128, 128])), 0x808080);
  const red = makeReducer256(3, 3)(Object.assign(newFrame(3, 3), {}), null);
  assert.equal(red.frame.fg[0], 0x000000);
});

test('control 1: 4 Hz strobe fails L1 and L2 (and L3), not R', () => {
  const rep = control('1 strobe 4 Hz', strobe);
  assert.deepEqual(failed(rep), ['l1.x1', 'l1.x4', 'l2.x1', 'l2.x4', 'l3']);
  assert.ok(rep.l1.x1.worstFraction > 0.9);
  assert.ok(rep.l1.x1.details.field.w === 40 && rep.l1.x1.details.field.h === 14);
  assert.ok(Number.isInteger(rep.l1.x1.details.frame) && rep.l1.x1.details.timeS > 0);
});

test('control 2: 0.6 s bloom fails L2 (passes L1 at 1x; fails L1 at 4x)', () => {
  const rep = control('2 bloom 0.6 s', (c, r) => bloom(c, r, { period: 0.6 }));
  assert.equal(rep.l1.x1.pass, true, 'two changes per 0.6 s: under 7 a second at 1x');
  assert.equal(rep.l2.x1.pass, false);
  assert.equal(rep.l1.x4.pass, false, 'at 4x it is 13 changes a second');
  assert.equal(rep.r.x1.pass && rep.r.x4.pass, true);
});

test('control 3: 2 s bloom passes at 1x and fails at 4x (L2 at 4x is the rule; L1 and R still pass)', () => {
  const rep = control('3 bloom 2 s', (c, r) => bloom(c, r, { period: 2 }));
  assert.equal(rep.l1.x1.pass && rep.l2.x1.pass && rep.l3.pass && rep.r.x1.pass, true, 'all rules pass at 1x');
  assert.deepEqual(failed(rep), ['l2.x4'], 'WHICH rule: L2 at 4x, and only that');
  assert.equal(rep.l1.x4.pass && rep.r.x4.pass, true);
  assert.equal(rep.pass, false, 'L2 at 4x counts: the report fails');
  assert.equal(rep.passStrict, undefined, 'one verdict: pass');
  assert.equal(rep.l2.x4.binding, undefined, 'no rule is advisory any more');
});

test('control 4: 2 Hz red pulse fails R (at both speeds)', () => {
  const rep = control('4 red pulse 2 Hz', redPulse);
  assert.equal(rep.r.x1.pass, false);
  assert.equal(rep.r.x4.pass, false);
  assert.equal(rep.l1.x1.pass, true, 'four changes a second is under the WCAG seven');
  assert.ok(rep.r.x1.worstFraction > 0.9);
});

test('control 5: HSV kaleidoscope (brightness moves with hue) fails L2', () => {
  const rep = control('5 hsv kaleidoscope fast', hsvKaleidoscope);
  assert.equal(rep.l2.x1.pass, false);
  assert.ok(rep.l2.x1.worstFraction > 0.9);
  assert.equal(rep.l3.pass, false, 'and many cells change brightness in a single step');
});

test('control 6a: same-brightness kaleidoscope WITHOUT safeHue passes L1-L3 and fails R', () => {
  const rep = control('6a iso kaleidoscope (no safeHue)', isoKaleidoscope);
  assert.deepEqual(failedBright(rep), ['r.x1', 'r.x4']);
  assert.deepEqual(failed(rep), ['r.x1', 'r.x4', 'c'], 'and rule C (DRIFT-8 C4) fails it too: the same fast hue');
});

test('control 6b: the same pattern WITH safeHue passes everything at 1x and 4x', () => {
  const rep = control('6b safeHue kaleidoscope', safeKaleidoscope);
  assert.deepEqual(failedBright(rep), [], 'every brightness and red rule, 1x and 4x');
  // DRIFT-8 C4: its colour is another matter. Hue 1.5 cycles a second over fine detail rotating at 0.3 turns a second changes every pixel's colour far more than 7 times a
  // second: rule C fails it (the colour-flicker rule, a house rule beyond WCAG: tests/flash-colour.test.js)
  assert.deepEqual(failed(rep), ['c']);
});

test('control 7: gradient passes at 1x; at 4x R is the rule that moves', () => {
  const rep = control('7 gradient', gradient);
  assert.equal(rep.l1.x1.pass && rep.l2.x1.pass && rep.l3.pass && rep.r.x1.pass, true);
  assert.deepEqual(failed(rep), ['r.x4'], 'the red channel climbs and falls slowly; played at 4x it counts as a pulse');
});

test('control 8: a small pop (under 25% of any field) at 4 Hz is free; a bigger one is not', () => {
  const rep = control('8 pop 20x6 at 4 Hz', pop);
  assert.deepEqual(failed(rep), []);
  assert.ok(Math.abs(rep.l1.x1.worstFraction - 120 / 560) < 1e-9, 'the patch fills 120 of the 560 cells in a field');
  const big = control('8b pop 24x6 at 4 Hz', (c, r) => pop(c, r, { w: 24 }));
  assert.equal(big.l1.x1.pass, false, '144 of 560 is 25.7%');
  assert.ok(Math.abs(big.l1.x1.worstFraction - 144 / 560) < 1e-9);
  assert.equal(big.l3.pass, true, 'it is a small share of the whole screen');
});

test('control 9: a hue-only change at steady brightness, no red, passes', () => {
  const rep = control('9 hue only (greens to blues)', hueOnly);
  assert.deepEqual(failed(rep), []);
  assert.ok(rep.l3.worstFraction < 0.05);
});

test('control 10: L3 - a step that moves over 30% of cells fails L3 alone; hue change in every cell is free', () => {
  const n = C * R;
  const opts = { seconds: 3 };
  const over = control('10a step 31% of cells', (c, r) => oneStep(c, r, { count: Math.floor(n * 0.31) }), opts);
  assert.deepEqual(failed(over), ['l3'], 'one transition per cell: L1, L2 and R are quiet');
  assert.ok(over.l3.worstFraction > 0.30 && over.l3.worstFraction < 0.32);
  const exact = control('10b step exactly 30%', (c, r) => oneStep(c, r, { count: n * 0.3 }), opts);
  assert.equal(exact.l3.worstFraction, 0.3);
  assert.deepEqual(failed(exact), [], '"more than 30%" fails; exactly 30% does not');
  const just = control('10c step 30% + 1 cell', (c, r) => oneStep(c, r, { count: n * 0.3 + 1 }), opts);
  assert.deepEqual(failed(just), ['l3']);
  const hue = control('10d hue step, all cells', hueStep, opts);
  assert.deepEqual(failed(hue), []);
  assert.equal(hue.l3.worstFraction, 0);
  assert.ok(Math.abs(luminanceOf(0x3a7a3a) - luminanceOf(0x4a6ab2)) < 0.05, 'the two hues are about equally bright');
});

test('control 11: on 256-colour output the safeHue kaleidoscope still passes and the strobe still fails', () => {
  const safe = control('11a safeHue kaleidoscope, 256', safeKaleidoscope, { reduce256: true });
  assert.deepEqual(failedBright(safe), []);
  const bad = control('11b strobe, 256', strobe, { reduce256: true });
  assert.ok(failed(bad).includes('l1.x1'));
  assert.ok(failed(bad).includes('l2.x1'));
});

test('control 12: palette cells inside a full-colour frame count with their table colours', () => {
  const pal = { fgRgb: Uint32Array.of(0x101010, 0xe0e0e0), bgRgb: Uint32Array.of(0x000000, 0x000000) };
  // full blocks toggling between palette entries 0 and 1; the frame's own fg/bg are one constant colour, so a meter
  // that ignored the tables would see nothing move
  const make = (c, r) => {
    const f = newFrame(c, r);
    f.glyphs.fill(0x2588); f.fg.fill(0x808080); f.bg.fill(0x808080);
    return (t) => { f.shades.fill(Math.floor(t * 8) % 2 === 0 ? 0 : 1); return f; };
  };
  const rep = control('12a palette cells strobing', make, { palette: pal });
  assert.equal(rep.l1.x1.pass, false);
  assert.ok(rep.l1.x1.worstFraction > 0.9);
  // PALETTE_BG on full-colour cells reads entry 0 of whichever palette is pushed: two palettes alternate
  const A = { fgRgb: Uint32Array.of(0), bgRgb: Uint32Array.of(0x101010) }, B = { fgRgb: Uint32Array.of(0), bgRgb: Uint32Array.of(0xe0e0e0) };
  const m = createFlashMeter(C, R, FPS);
  const f = newFrame(C, R);
  f.bg.fill(PALETTE_BG);
  for (let k = 0; k <= 30 * FPS; k++) m.push(f, Math.floor(k / FPS * 8) % 2 === 0 ? A : B);
  const r2 = m.report();
  record('12b PALETTE_BG, palettes swap', r2);
  assert.equal(r2.l1.x1.pass, false);
  // a palette-only frame (no fg/bg arrays at all) is fine
  const m3 = createFlashMeter(6, 6, FPS);
  const g = { cols: 6, rows: 6, glyphs: new Uint16Array(36).fill(0x2588), shades: new Uint8Array(36).fill(1) };
  m3.push(g, pal);
  assert.ok(Math.abs(m3.cellY(0) - luminanceOf(0xe0e0e0)) < 1e-12);
});

test('sizes and rates the controls were not tuned on: 41x11 at 12 fps, 80x24 at 24 fps, 240x67 at 18 fps', () => {
  for (const [cols, rows, fps] of [[41, 11, 12], [80, 24, 24], [240, 67, 18]]) {
    const o = { cols, rows, fps, seconds: 8 };
    const tag = `${cols}x${rows}@${fps}`;
    assert.ok(failed(control(`u strobe ${tag}`, strobe, o)).includes('l1.x1'), `strobe ${tag}`);
    assert.equal(control(`u bloom 2 s ${tag}`, (c, r) => bloom(c, r, { period: 2 }), o).l2.x1.pass, true, `bloom 2 s ${tag}`);
    assert.deepEqual(failedBright(control(`u safeHue ${tag}`, safeKaleidoscope, o)), [], `safeHue kaleidoscope ${tag}`);
    assert.deepEqual(failed(control(`u hue only ${tag}`, hueOnly, o)), [], `hue only ${tag}`);
    assert.ok(failed(control(`u iso ${tag}`, isoKaleidoscope, o)).includes('r.x1'), `iso kaleidoscope ${tag}`);
    assert.ok(!control(`u red ${tag}`, redPulse, o).r.x1.pass, `red pulse ${tag}`);
  }
});

test('report shape and meter edge cases', () => {
  const m = createFlashMeter(41, 11, 18);
  const empty = m.report();
  for (const r of RULES) assert.equal(cell(empty, r).worstFraction, 0, r);
  assert.equal(empty.pass, true);
  assert.equal(empty.frames, 0);
  const rep = control('1 strobe 4 Hz', strobe);
  for (const r of RULES) {
    const c = cell(rep, r);
    assert.equal(typeof c.worstFraction, 'number');
    assert.equal(typeof c.limit, 'number');
    assert.equal(typeof c.pass, 'boolean');
    assert.equal('binding' in c, false);
    assert.ok(c.details && 'frame' in c.details && 'timeS' in c.details);
  }
  assert.deepEqual(Object.keys(rep).sort(), ['c', 'cell', 'cols', 'field', 'fps', 'frames', 'l1', 'l2', 'l3', 'pass', 'pixel', 'r', 'rows'].sort()); // DRIFT-8 C2: cell and pixel are the two readings, l1 ... r the worse of them (tests/flash-halves.test.js)
  assert.throws(() => m.push(newFrame(40, 11)), /size/);
  // no allocation per push after warm-up: heap growth over 300 pushes stays small
  const mm = createFlashMeter(120, 40, 18), fr = strobe(120, 40);
  for (let k = 0; k < 40; k++) mm.push(fr(k / 18));
  if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let k = 40; k < 340; k++) mm.push(fr(k / 18));
  assert.ok(process.memoryUsage().heapUsed - h0 < 8e6, 'no per-frame buffers');
});

// ---- part 3: constants

test('the thresholds are exported named constants with the ruled values; the older flash constants are untouched', () => {
  assert.equal(FIELD_FRACTION, 0.25);
  assert.equal(STEP_FRACTION, 0.30);
  assert.equal(TRANSITION_SWING, 0.10);
  assert.equal(DARK_SIDE_MAX, 0.8);
  assert.equal(RED_SATURATION, 0.8);
  assert.equal(RED_SWING, 20);
  assert.equal(RED_SCALE, 320);
  assert.equal(L1_COUNT, 7);
  assert.equal(L2_COUNT, 3);
  assert.equal(R_COUNT, 2);
  assert.equal(FLASH_FRACTION, 0.30);
  assert.equal(SHADE_STEP_LSTAR, 28);
});

test('measured table', () => {
  // printed so the numbers are in the test log; the assertions above are the checks
  console.log('\n' + table.sort().join('\n'));
  assert.ok(table.length > 0);
});
