// Shared flash metric for the non-calm scene tests (DRIFT-2).
//
// A "flash" is a single frame step in which more than FLASH_FRACTION of ALL cells change,
// where a cell changes when its glyph differs OR its colour index differs from the frame
// before. That catches lit<->blank strobing, a whole screen re-rolling its glyphs, and a
// whole screen swapping colour, which a lit/unlit-only count misses.
//
// Threshold: measured over every non-calm scene solo and over every dissolve between any two
// of them (60 s at 120x40, 18 fps, seed 1) the worst single-frame change is 21.2% (waves,
// after it was calmed from 56%; vortex from 35%), then 20.1% (blocktype word swap), 18.5%
// (cloth), 17.8% (vortex, wire). 30% leaves a margin of more than 8 points over the worst
// real scene and stays well under the 40% ceiling this check must never exceed.
export const FLASH_FRACTION = 0.30;

export function changedFraction(g, prevG, c, prevC) {
  let n = 0;
  for (let i = 0; i < g.length; i++) if (g[i] !== prevG[i] || c[i] !== prevC[i]) n++;
  return n / g.length;
}

// frames: array of { g: glyphs copy, c: colour-index copy }. Returns the times (s) of flashes.
export function flashTimesOf(frames, fps) {
  const times = [];
  for (let k = 1; k < frames.length; k++) {
    const f = changedFraction(frames[k].g, frames[k - 1].g, frames[k].c, frames[k - 1].c);
    if (f > FLASH_FRACTION) times.push(k / fps);
  }
  return times;
}

export const snap = (f) => ({ g: f.glyphs.slice(), c: (f.shades || f.colours).slice() });

// ---- brightness ramps (DRIFT-4 A3)
//
// The 30% rule above counts cells that change. This one asks how far a cell that stays the same glyph moves in
// brightness. Brightness is the CIE L* (0-100) of the palette entry's foreground colour, read from the palette the
// frame was drawn in, so a palette swap that keeps the colours (insert -> boot) counts as no change at all.
//   A "shade step" is one level of the console's own scales: graphite -> dim is 18.4, dim -> silver 15 is 21.3,
//   a cartridge tint level is 9-14, the library's prompt cursor goes silver 3 -> 9 -> 15 in steps of 24 and 27.
//   SHADE_STEP_LSTAR = 28 allows exactly one such step per frame and refuses two (graphite -> silver 15 is 40,
//   tint+0 -> tint+3 is 35).
//   Cells that appear or disappear (blank <-> glyph) or change glyph are dissolves and wipes, not ramps: they are
//   bounded by the 30% rule, not by this one.
export const SHADE_STEP_LSTAR = 28;

const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export function lstarOf(r, g, b) {
  const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
}
const tableCache = new WeakMap();
// L* of every entry of a palette ({ sgr: [...] }); entries without a truecolor foreground read as 50.
export function lstarTable(palette) {
  if (!palette) return null;
  let t = tableCache.get(palette);
  if (!t) {
    t = palette.sgr.map((s) => { const m = /38;2;(\d+);(\d+);(\d+)/.exec(s); return m ? lstarOf(+m[1], +m[2], +m[3]) : 50; });
    tableCache.set(palette, t);
  }
  return t;
}

// Cells that kept their glyph (not blank) and moved by more than SHADE_STEP_LSTAR between two frames.
// a, b: { g, c, L } (L = lstarTable of the palette the frame was drawn in); cols for the report.
export function brightnessJumps(a, b, cols) {
  const out = [];
  if (!a.L || !b.L) return out;
  for (let i = 0; i < b.g.length; i++) {
    if (b.g[i] === 32 || b.g[i] !== a.g[i]) continue;
    const d = Math.abs(b.L[b.c[i]] - a.L[a.c[i]]);
    if (d > SHADE_STEP_LSTAR) out.push({ x: i % cols, y: Math.floor(i / cols), d: Math.round(d) });
  }
  return out;
}

// ---- the full-colour flash meter (DRIFT-7 C4a)
//
// Frames that carry their own colours (fg/bg per cell) cannot be judged by the palette-index rules above: a
// kaleidoscope changes the colour of every cell every frame and is still fine, a bloom that changes only brightness
// is not. This meter judges brightness (WCAG relative luminance) and saturated red, per cell, over time.
//
//   const meter = createFlashMeter(cols, rows, fps);
//   meter.push(frame, palette);   // once per frame, in order; frame = { cols, rows, glyphs, shades?, fg?, bg? }
//   const rep = meter.report();
//
// It has its own luminance function and imports nothing from src (a bug in the code under test must not be able to
// hide itself). RGB_CELL and PALETTE_BG are copied as literals and a test pins them to the renderer's.
//
// Cell colour. A cell with shade 255 (METER_RGB_CELL, or no shades array) takes frame.fg[i] / frame.bg[i]; a bg of
// PALETTE_BG (0x1000000) means the palette's background, palette.bgRgb[0]. Any other shade reads palette.fgRgb[shade]
// and palette.bgRgb[shade]; a blank palette cell reads entry 0, as the renderer does. `palette` is the second
// argument of push (or frame.palette). Colours are used as given (the 6-bit truncation of the truecolor path is not
// applied); to judge 256-colour output, feed frames reduced to it (makeReducer256 in helpers-flash-controls.js).
// Brightness Y = coverage(glyph) * Y(fg) + (1 - coverage) * Y(bg), all in linear light.
//
// Glyph coverage (share of the cell the glyph inks), see glyphCoverage: space 0; full block 1; half blocks 0.5;
// light/medium/dark shade 0.25/0.5/0.75; other block elements by their fraction; braille = dots / 8; punctuation with
// little ink 0.15; every other glyph (letters, digits, box drawing, anything unknown) DEFAULT_COVERAGE 0.35.
//
// Transition. A swing of >= TRANSITION_SWING (0.10) in Y between turning points of a cell's Y series. A ramp
// accumulates: a cell climbing 0.01 a frame counts once, when it has climbed 0.10 from its last turning point, and
// not again until it turns and falls 0.10. The darker end of the swing must be under DARK_SIDE_MAX (0.8), as in WCAG.
// A red transition is the same on max(0, R - G - B) * 320 (linear R, G, B of the cell's blended colour) with a swing
// ABOVE RED_SWING (20), and needs the cell to be saturated red (linear R / (R + G + B) >= 0.8) in the frame it
// completes or the one before.
//
// Time. Frame k occurs at k / fps seconds ("1x") or k / (4 * fps) seconds ("4x": the same frames played four times
// as fast). "Any 1 s window" is the trailing window of the last fps frames at 1x and 4 * fps frames at 4x (the
// transition log keeps frame indices). A cell is HOT for a rule at frame k when it has completed at least N
// transitions in that window: N = 7 (L1), 3 (L2), 2 red (R).
//
// Field. A window of ceil(cols/3) x ceil(rows/3) cells slid over the screen in steps of one cell. A rule's worst
// fraction is the largest share of hot cells in any field at any frame (found with a summed-area table of the hot
// grid). It passes when the worst fraction is <= FIELD_FRACTION (0.25).
//
// Two grids (DRIFT-8 C2). The scenes draw in half-block pixels, two to a cell, and a meter that blends the halves of a cell into
// one value cannot see two halves swapping colour (the DRIFT-7 challenge, finding 2). So every frame is judged twice, and every rule
// reports the WORSE of the two readings (the larger worstFraction, the cell grid's on a tie) and passes only when BOTH pass:
//   the cell grid   cols x rows, the cell's Y from the whole glyph's coverage: what this meter has always read (bit-identical to before C2)
//   the pixel grid  cols x 2 rows, the top and the bottom pixel of every cell, each from its half's coverage (glyphHalves), with a field of the
//                   same area: ceil(cols/3) columns by 2 * ceil(rows/3) pixel rows
// A straight switch to pixels would loosen a thin feature (a patch whose top halves flicker fills half the pixels it fills cells), which is why
// the cell grid stays. rep.cell and rep.pixel are the two readings, each with the rule set below; rep.l1 ... rep.r are the worse of them, with
// details.grid saying which grid the number comes from. The ceilings that tests measured on the cell grid stay on rep.cell; new per-pixel ceilings go on rep.pixel.
//
// Rules:  l1.x1, l1.x4  WCAG: cells with >= 7 transitions in 1 s, at 1x and 4x.
//         l2.x1, l2.x4  in-house: >= 3 transitions in 1 s, at 1x and 4x. Both are binding: a scene must stay quiet
//                       when the same frames are played four times as fast (a 2 s bloom fails l2.x4).
//         l3            worst single frame step: the share of ALL cells whose Y moved >= 0.10 since the frame
//                       before; passes when <= STEP_FRACTION (0.30). Hue changes at steady brightness are free.
//         r.x1, r.x4    cells with >= 2 red transitions in 1 s, at 1x and 4x.
//         c             DRIFT-8 C4, a house rule beyond WCAG: pixels with >= 7 colour swings (OKLab, four axes) in 1 s; see "Rule C" below. One view.
//
// report() -> {
//   cols, rows, fps, frames, field: { w, h },
//   l1: { x1: RULE, x4: RULE }, l2: { x1: RULE, x4: RULE }, l3: STEP, r: { x1: RULE, x4: RULE }, c: RULE,
//   pass,        // every rule passes, on both grids
//   cell, pixel, // { field, frames, l1, l2, l3, r, c, pass } each: the two readings the above are the worse of
// }
// (meter.cellY(i) is the cell's Y; meter.pixelY(i, half) the top (0) or bottom (1) pixel's.)
// RULE = { worstFraction, limit, pass, details: { frame, timeS, field: { x, y, w, h }, hotCells } }
//        (frame = frame index of the worst reading; timeS = its time at that speed; field = top-left cell and size of
//         the worst field; hotCells = hot cells in it)
// STEP = { worstFraction, limit, pass, details: { frame, timeS, cells } }  (the step INTO `frame`)
// Nothing pushed yet: all fractions 0, details frame -1.
//
// Rule C, colour flicker (DRIFT-8 C4). A HOUSE RULE, beyond WCAG: WCAG 2.x counts brightness (and saturated red) and calls a change of hue at steady
// brightness free, but a whole screen turning hue several times a second is the thing that made the owner's kaleidoscope uncomfortable, and at 4x
// (before the colour clock) about half of Rosette's field did exactly that.
//   Each pixel's colour is converted to OKLab (a, b; L is brightness and is judged by the rules above). FOUR axes are tracked per pixel: a, b and the
//   two diagonals (a + b) / sqrt 2 and (a - b) / sqrt 2. A colour pair that differs by (da, db) = (0.09, 0.09) moves a and b by 0.09 each (under the
//   swing) and moves the diagonal by 0.127: a meter that follows a and b alone is blind to it, and to any hue wobble that runs along a diagonal.
//   A SWING is a change of COLOUR_SWING (0.10) or more between successive turning points of one axis (the same tracker as the brightness swings, no dark
//   side gate). A pixel is HOT at frame k when ANY axis has completed C_COUNT (7) swings in the last second; the rule FAILS when hot pixels exceed
//   FIELD_FRACTION (25%) of any field (the same field as L2). 7 swings a second on one axis is a hue turning 3.5 cycles a second (two swings a cycle);
//   that limit, and the 0.10 swing, are never loosened.
//   C is judged at the speed the viewer sees: frames are pushed at the playback rate (18 fps), so a 4x key press is frames computed 4x further apart
//   (and the colour clock, tc, keeps hue at its 1x rate); there is no "x4 view" of C, which would say nothing about the colour clock.
//   Read per grid like the other rules (the cell grid on the cell's colour, the coverage-weighted mean of its fg and bg in OKLab; the pixel grid on each half), rep.c = the worse,
//   rep.pixel.c the pixels. Report shape: rep.c is a RULE like l1.x1 (single: no x1/x4 views), judged at 18 fps frames whatever speed the key gave them.
//   BLIND SPOTS (rule C is not a promise of comfort): (1) a change of colour that stays under the swing on every axis (a grey <-> teal at equal lightness
//   moves a and b by less than 0.10 up to about safeHue's chroma) passes; (2) a pattern that moves fast while each pixel changes slowly passes; (3) the
//   consequence: fine colour detail rotated fast FAILS (it changes each pixel's colour many times a second), which is why the owner's kaleidoscope
//   probe (hue 0.15 cycles/s, rotation 0.08 turns/s) fails and the Rosette (ten times slower rotation) passes. (The owner's remembered benchmark "1.5 cycles/s" was a
//   misreading of that probe's 0.15.)
export const COLOUR_SWING = 0.10;
export const C_COUNT = 7;
export const COLOUR_AXES = 4;
export const FIELD_FRACTION = 0.25;
export const STEP_FRACTION = 0.30;
export const TRANSITION_SWING = 0.10;
export const DARK_SIDE_MAX = 0.8;
export const RED_SATURATION = 0.8;
export const RED_SWING = 20;
export const RED_SCALE = 320;
export const L1_COUNT = 7;
export const L2_COUNT = 3;
export const R_COUNT = 2;
export const FAST_SPEED = 4;
export const METER_RGB_CELL = 255;
export const METER_PALETTE_BG = 0x1000000;
export const DEFAULT_COVERAGE = 0.35;
const LOW_INK_COVERAGE = 0.15;
const EPS = 1e-9;

const SRGB_LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) { const s = i / 255; SRGB_LIN[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }

// WCAG relative luminance of 0xRRGGBB (this file's own; src/pixels.js relY is deliberately not used).
export function luminanceOf(rgb) {
  return 0.2126 * SRGB_LIN[(rgb >>> 16) & 255] + 0.7152 * SRGB_LIN[(rgb >>> 8) & 255] + 0.0722 * SRGB_LIN[rgb & 255];
}

let COVERAGE = null;
function buildCoverage() {
  const t = new Float64Array(65536).fill(DEFAULT_COVERAGE);
  for (const ch of ".,'`:;\"!|-_~^") t[ch.charCodeAt(0)] = LOW_INK_COVERAGE;
  t[0] = 0; t[32] = 0; t[0xa0] = 0;
  for (let i = 1; i <= 7; i++) t[0x2580 + i] = i / 8;           // lower 1/8 .. 7/8 blocks (U+2581-2587)
  t[0x2580] = 0.5; t[0x2584] = 0.5; t[0x2588] = 1;              // upper half, lower half, full block
  for (let i = 1; i <= 7; i++) t[0x2588 + i] = (8 - i) / 8;     // left 7/8 .. 1/8 blocks (U+2589-258F: U+2589 is 7/8, U+258F is 1/8; tests/glyph-coverage-geometry.test.js)
  t[0x258c] = 0.5; t[0x2590] = 0.5;                             // left half, right half
  t[0x2591] = 0.25; t[0x2592] = 0.5; t[0x2593] = 0.75;          // light, medium, dark shade
  t[0x2594] = 1 / 8; t[0x2595] = 1 / 8;                         // upper 1/8, right 1/8
  const quad = [1, 1, 1, 3, 2, 3, 3, 1, 2, 3];                  // U+2596-259F quadrants, out of 4
  for (let i = 0; i < quad.length; i++) t[0x2596 + i] = quad[i] / 4;
  for (let m = 0; m < 256; m++) { let k = 0; for (let b = m; b; b >>= 1) k += b & 1; t[0x2800 + m] = k / 8; }
  return t;
}
export function glyphCoverage(g) {
  if (!COVERAGE) COVERAGE = buildCoverage();
  return g >= 0 && g < 65536 ? COVERAGE[g] : DEFAULT_COVERAGE;
}

// ---- half-cell coverage (DRIFT-8 C2)
//
// Every cell is two pixels stacked, the way the scenes draw (a half block, or a space in one colour). Each glyph gets the share of
// its TOP half and of its BOTTOM half that it inks, so that (top + bottom) / 2 is glyphCoverage for every glyph:
//   upper half block U+2580: 1 / 0. Lower 1/8 .. 7/8 blocks U+2581-2587 fill the bottom first (the lower half block holds 4/8): bottom
//   min(i, 4) / 4, top max(0, i - 4) / 4. Upper 1/8 block U+2594: top 1/4, bottom 0. Left and right blocks, the shades and the full
//   block ink both halves alike. Quadrants U+2596-259F by their corners. Braille: the top four dots (rows 1-2, bits 0x1b) over the
//   bottom four (rows 3-4, bits 0xe4), each out of 4. Every other glyph is the same in both halves (its glyphCoverage).
const QUADRANTS = [[0, 0.5], [0, 0.5], [0.5, 0], [0.5, 1], [0.5, 0.5], [1, 0.5], [1, 0.5], [0.5, 0], [0.5, 0.5], [0.5, 1]]; // U+2596-259F [top, bottom]
let HALVES = null;
function buildHalves() {
  if (!COVERAGE) COVERAGE = buildCoverage();
  const top = Float64Array.from(COVERAGE), bot = Float64Array.from(COVERAGE);
  top[0x2580] = 1; bot[0x2580] = 0;
  for (let i = 1; i <= 7; i++) { bot[0x2580 + i] = Math.min(i, 4) / 4; top[0x2580 + i] = Math.max(0, i - 4) / 4; }
  top[0x2594] = 0.25; bot[0x2594] = 0;
  for (let i = 0; i < QUADRANTS.length; i++) { top[0x2596 + i] = QUADRANTS[i][0]; bot[0x2596 + i] = QUADRANTS[i][1]; }
  const dots = (m) => { let c = 0; for (; m; m >>= 1) c += m & 1; return c; };
  for (let m = 0; m < 256; m++) { top[0x2800 + m] = dots(m & 0x1b) / 4; bot[0x2800 + m] = dots(m & 0xe4) / 4; }
  HALVES = { top, bot };
}
// [top, bottom] coverage of a glyph
export function glyphHalves(g) {
  if (!HALVES) buildHalves();
  return g >= 0 && g < 65536 ? [HALVES.top[g], HALVES.bot[g]] : [DEFAULT_COVERAGE, DEFAULT_COVERAGE];
}

// The pixel field: a third of the columns by two pixel rows for each cell row of the cell field (the same area as the cell field).
export function pixelFieldSize(cols, rows) {
  const f = fieldSize(cols, rows);
  return { w: f.w, h: 2 * f.h };
}

export function fieldSize(cols, rows) {
  return { w: Math.max(1, Math.ceil(cols / 3)), h: Math.max(1, Math.ceil(rows / 3)) };
}

// Per-cell swing tracker. step(i, v, s) feeds cell i's next value v (s = 1 when the cell is saturated red now) and
// returns true when that value completes a transition. State per cell: direction (0 until the first transition),
// the extreme reached in that direction, and (before the first transition) the lowest and highest values seen.
//   swing   minimum swing; strict: the swing must exceed it (red) instead of reaching it (luminance)
//   darkSide  the darker end of a swing must be under this
//   gate    a transition also needs saturated red now or in the previous frame (red rule)
export function createSwingTracker(n, { swing, darkSide = Infinity, strict = false, gate = false }) {
  const dir = new Int8Array(n), ext = new Float64Array(n), lo = new Float64Array(n), hi = new Float64Array(n);
  const seen = new Uint8Array(n), prevSat = new Uint8Array(n);
  const min = strict ? swing + EPS : swing - EPS;
  return {
    step(i, v, s) {
      if (!seen[i]) { seen[i] = 1; lo[i] = hi[i] = ext[i] = v; prevSat[i] = s; return false; }
      const ok = !gate || s !== 0 || prevSat[i] !== 0;
      prevSat[i] = s;
      const d = dir[i];
      if (d === 0) {
        if (v < lo[i]) lo[i] = v;
        if (v > hi[i]) hi[i] = v;
        if (v - lo[i] >= min && ok && lo[i] < darkSide) { dir[i] = 1; ext[i] = v; return true; }
        if (hi[i] - v >= min && ok && v < darkSide) { dir[i] = -1; ext[i] = v; return true; }
      } else if (d === 1) {
        if (v > ext[i]) ext[i] = v;
        else if (ext[i] - v >= min && ok && v < darkSide) { dir[i] = -1; ext[i] = v; return true; }
      } else if (v < ext[i]) ext[i] = v;
      else if (v - ext[i] >= min && ok && ext[i] < darkSide) { dir[i] = 1; ext[i] = v; return true; }
      return false;
    },
  };
}

// Per-cell ring of the frame indices of the last `len` transitions. hot(i, count, frame, window) is true when the
// cell has completed at least `count` (<= len) transitions in frames (frame - window, frame].
export function createTransitionLog(n, len) {
  const ts = new Int32Array(n * len).fill(-1000000000);
  const head = new Uint8Array(n); // next slot to write
  return {
    len,
    add(i, frame) { ts[i * len + head[i]] = frame; head[i] = head[i] + 1 === len ? 0 : head[i] + 1; },
    hot(i, count, frame, window) {
      if (count > len) throw new RangeError(`ring of ${len} cannot answer for ${count} transitions`);
      let slot = head[i] - count;
      if (slot < 0) slot += len;
      return frame - ts[i * len + slot] < window;
    },
  };
}

// Largest count of set cells in any fw x fh window of a cols x rows 0/1 grid, by a summed-area table.
// best(grid) -> { count, x, y } (first window in row-major order that reaches the maximum).
export function createWindowCounter(cols, rows, fw, fh) {
  const W = cols + 1;
  const S = new Int32Array(W * (rows + 1));
  return {
    best(grid) {
      for (let y = 0; y < rows; y++) {
        let run = 0;
        for (let x = 0; x < cols; x++) { run += grid[y * cols + x]; S[(y + 1) * W + x + 1] = S[y * W + x + 1] + run; }
      }
      let count = -1, bx = 0, by = 0;
      for (let y = 0; y + fh <= rows; y++) {
        for (let x = 0; x + fw <= cols; x++) {
          const s = S[(y + fh) * W + x + fw] - S[y * W + x + fw] - S[(y + fh) * W + x] + S[y * W + x];
          if (s > count) { count = s; bx = x; by = y; }
        }
      }
      return { count, x: bx, y: by };
    },
  };
}

// ---- OKLab a and b of a colour (rule C)
//
// This file's own conversion (it imports nothing from src, like the rest of the meter). A colour that is exactly an 8-bit RGB (a half block's fg or bg, a space) goes through a
// direct-mapped cache, because a full-colour scene draws a few hundred distinct colours in a frame and the conversion (three cube roots) would otherwise be most of the meter's
// cost; a blend (a glyph that covers part of a half) is converted from its linear light. The cache is a pure memo: it never changes a result.
const LAB_BITS = 13, LAB_SIZE = 1 << LAB_BITS;
const LAB_KEYS = new Int32Array(LAB_SIZE).fill(-1), LAB_A = new Float64Array(LAB_SIZE), LAB_B = new Float64Array(LAB_SIZE);
const LAB_OUT = new Float64Array(2); // a, b of the last labOfLinear
function labOfLinear(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  LAB_OUT[0] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  LAB_OUT[1] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
}
// the cache slot holding the OKLab a and b of 0xRRGGBB (read LAB_A[slot], LAB_B[slot])
function labSlot(rgb) {
  const h = Math.imul(rgb, 0x9e3779b1) >>> (32 - LAB_BITS);
  if (LAB_KEYS[h] !== rgb) {
    labOfLinear(SRGB_LIN[(rgb >>> 16) & 255], SRGB_LIN[(rgb >>> 8) & 255], SRGB_LIN[rgb & 255]);
    LAB_KEYS[h] = rgb; LAB_A[h] = LAB_OUT[0]; LAB_B[h] = LAB_OUT[1];
  }
  return h;
}

// A grid of values (one per pixel or one per cell) with the whole rule set on it: swing trackers, transition logs,
// hot grids and a field window. The meter runs two of these side by side (see createFlashMeter).
//   put(i, y, rv, rs, k)   the next luminance, red value and red flag of item i at frame k (call only for items whose
//                          inputs changed since the previous frame: an identical input cannot complete a transition)
//   end(k)                 close frame k: the L3 step count and the hot grids (a cell can only be hot while its
//                          latest transition is under the 4x window old, so older cells are skipped)
function createGrid(w, h, fw, fh, win1, win4) {
  const n = w * h;
  const Y = new Float64Array(n);
  const lumTracker = createSwingTracker(n, { swing: TRANSITION_SWING, darkSide: DARK_SIDE_MAX });
  const redTracker = createSwingTracker(n, { swing: RED_SWING, strict: true, gate: true });
  const lumLog = createTransitionLog(n, L1_COUNT), redLog = createTransitionLog(n, R_COUNT);
  const counter = createWindowCounter(w, h, fw, fh);
  const lastT = new Int32Array(n).fill(-1000000000), live = new Uint8Array(n);
  const mk = (id, log, count, window, speed) => ({ id, log, count, window, speed, hot: new Uint8Array(n), total: 0, best: { count: 0, x: 0, y: 0, frame: -1, hotCells: 0 } });
  const specs = [
    mk('l1.x1', lumLog, L1_COUNT, win1, 1), mk('l1.x4', lumLog, L1_COUNT, win4, FAST_SPEED),
    mk('l2.x1', lumLog, L2_COUNT, win1, 1), mk('l2.x4', lumLog, L2_COUNT, win4, FAST_SPEED),
    mk('r.x1', redLog, R_COUNT, win1, 1), mk('r.x4', redLog, R_COUNT, win4, FAST_SPEED),
  ];
  // rule C (DRIFT-8 C4): four axes per item (a, b, (a+b)/sqrt2, (a-b)/sqrt2), one tracker and one ring of swings per axis; an item is hot when any axis is
  const NAX = COLOUR_AXES;
  // One swing tracker per axis, the same rule as createSwingTracker (no dark side, no gate, a swing reaches COLOUR_SWING), written out for speed: every changed pixel steps four of
  // them every frame and they were most of the meter's cost. A pixel is hot while its latest swing is within a second of the oldest of its last C_COUNT swings on an axis; that
  // is known when the swing is logged (hot until oldest + window - 1), so no ring is read at the end of the frame.
  const cDir = new Int8Array(n * NAX).fill(2); // 2 = not seen yet, 0 = seen and not yet turned, 1 = rising, -1 = falling
  // one record of 8 doubles per item (one cache line): the last (a, b) it was given, and the extreme each axis has reached in its direction
  const CS = new Float64Array(n * 8);
  for (let i = 0; i < n; i++) { CS[i * 8] = NaN; CS[i * 8 + 1] = NaN; }
  const cLo = new Float64Array(n * NAX), cHi = new Float64Array(n * NAX); // only read before an axis has turned once
  const cTs = new Int32Array(n * NAX * C_COUNT).fill(-1000000000), cHead = new Uint8Array(n * NAX);
  const hotUntil = new Int32Array(n).fill(-1000000000);
  const cMin = COLOUR_SWING - EPS;
  const colLog = { hot(i, count, frame) { return frame <= hotUntil[i]; } };
  const BRIGHTNESS_SPECS = specs.length;
  specs.push(mk('c', colLog, C_COUNT, win1, 1));
  // an axis completed a swing at frame k: log it, and the item is hot until the oldest of its last C_COUNT swings on that axis is a second old
  function swung(i, j, k) {
    const h = cHead[j], nh = h + 1 === C_COUNT ? 0 : h + 1;
    cTs[j * C_COUNT + h] = k; cHead[j] = nh;
    const until = cTs[j * C_COUNT + nh] + win1 - 1; // the slot to be written next holds the oldest of the last C_COUNT swings
    if (until > hotUntil[i]) hotUntil[i] = until;
  }
  const step = { count: 0, frame: -1 };
  let moved = 0;
  const swingMin = TRANSITION_SWING - EPS;
  const colV = new Float64Array(4);
  return {
    Y, field: { w: fw, h: fh },
    put(i, y, rv, rs, k) {
      if (k > 0) { const d = y - Y[i]; if ((d < 0 ? -d : d) >= swingMin) moved++; }
      Y[i] = y;
      if (lumTracker.step(i, y, 0)) { lumLog.add(i, k); lastT[i] = k; }
      if (redTracker.step(i, rv, rs)) { redLog.add(i, k); lastT[i] = k; }
    },
    // the item's colour as OKLab a and b, onto the four axes
    putColour(i, a, bb, k) {
      const r8 = i * 8;
      if (a === CS[r8] && bb === CS[r8 + 1]) return; // an unchanged (a, b) cannot complete a swing
      CS[r8] = a; CS[r8 + 1] = bb;
      colV[0] = a; colV[1] = bb; colV[2] = (a + bb) * Math.SQRT1_2; colV[3] = (a - bb) * Math.SQRT1_2;
      const j0 = i * NAX, x0 = r8 + 2;
      for (let ax = 0; ax < NAX; ax++) {
        const v = colV[ax], j = j0 + ax, x = x0 + ax, d = cDir[j];
        if (d === 1) {
          const e = CS[x];
          if (v > e) CS[x] = v; else if (e - v >= cMin) { cDir[j] = -1; CS[x] = v; swung(i, j, k); }
        } else if (d === -1) {
          const e = CS[x];
          if (v < e) CS[x] = v; else if (v - e >= cMin) { cDir[j] = 1; CS[x] = v; swung(i, j, k); }
        } else if (d === 2) {
          cDir[j] = 0; cLo[j] = v; cHi[j] = v; CS[x] = v;
        } else {
          if (v < cLo[j]) cLo[j] = v;
          if (v > cHi[j]) cHi[j] = v;
          if (v - cLo[j] >= cMin) { cDir[j] = 1; CS[x] = v; swung(i, j, k); } else if (cHi[j] - v >= cMin) { cDir[j] = -1; CS[x] = v; swung(i, j, k); }
        }
      }
    },
    end(k) {
      if (moved > step.count) { step.count = moved; step.frame = k; }
      moved = 0;
      const ns = BRIGHTNESS_SPECS; // the six brightness and red rules; rule C has its own pass below (a pixel's colour swings must not keep it in this loop)
      for (let i = 0; i < n; i++) {
        if (k - lastT[i] >= win4) {
          if (live[i]) { live[i] = 0; for (let s = 0; s < ns; s++) { const sp = specs[s]; if (sp.hot[i]) { sp.hot[i] = 0; sp.total--; } } }
          continue;
        }
        live[i] = 1;
        for (let s = 0; s < ns; s++) {
          const sp = specs[s];
          const hv = sp.log.hot(i, sp.count, k, sp.window) ? 1 : 0;
          if (hv !== sp.hot[i]) { sp.total += hv - sp.hot[i]; sp.hot[i] = hv; }
        }
      }
      const cs = specs[BRIGHTNESS_SPECS];
      for (let i = 0; i < n; i++) {
        const hv = k <= hotUntil[i] ? 1 : 0;
        if (hv !== cs.hot[i]) { cs.total += hv - cs.hot[i]; cs.hot[i] = hv; }
      }
      for (const sp of specs) {
        if (sp.total > sp.best.count) { // a field cannot hold more than the screen does; only look when it could beat the best
          const win = counter.best(sp.hot);
          if (win.count > sp.best.count) sp.best = { count: win.count, x: win.x, y: win.y, frame: k, hotCells: win.count };
        }
      }
    },
    report(fps, frames) {
      const fieldN = fw * fh;
      const ruleOf = (sp) => {
        const frac = sp.best.count / fieldN;
        return {
          worstFraction: frac, limit: FIELD_FRACTION, pass: frac <= FIELD_FRACTION,
          details: {
            frame: sp.best.frame, timeS: sp.best.frame < 0 ? 0 : sp.best.frame / (fps * sp.speed),
            field: { x: sp.best.x, y: sp.best.y, w: fw, h: fh }, hotCells: sp.best.hotCells,
          },
        };
      };
      const [l1x1, l1x4, l2x1, l2x4, rx1, rx4, cr] = specs.map(ruleOf);
      const frac = step.count / n;
      const l3 = {
        worstFraction: frac, limit: STEP_FRACTION, pass: frac <= STEP_FRACTION,
        details: { frame: step.frame, timeS: step.frame < 0 ? 0 : step.frame / fps, cells: step.count },
      };
      const all = [l1x1, l1x4, l2x1, l2x4, l3, rx1, rx4, cr];
      return { field: { w: fw, h: fh }, l1: { x1: l1x1, x4: l1x4 }, l2: { x1: l2x1, x4: l2x4 }, l3, r: { x1: rx1, x4: rx4 }, c: cr, pass: all.every((r) => r.pass) };
    },
  };
}

// The worse of the cell and the pixel reading of one rule: the larger worstFraction (the cell's on a tie), and pass only
// when both pass. details.grid names the grid the numbers come from.
function worseOf(cell, pixel) {
  const w = pixel.worstFraction > cell.worstFraction ? pixel : cell;
  return { ...w, pass: cell.pass && pixel.pass, details: { ...w.details, grid: w === pixel ? 'pixel' : 'cell' } };
}

export function createFlashMeter(cols, rows, fps) {
  const n = cols * rows;
  const cf = fieldSize(cols, rows);
  const pixelField = pixelFieldSize(cols, rows);
  const win1 = Math.max(1, Math.round(fps)), win4 = win1 * FAST_SPEED;
  const cellGrid = createGrid(cols, rows, cf.w, cf.h, win1, win4);
  const pixGrid = createGrid(cols, 2 * rows, pixelField.w, pixelField.h, win1, win4);
  // what each cell was made of last frame: an unchanged cell (same glyph, shade, fg, bg, same palette) is skipped
  const pG = new Uint16Array(n), pS = new Uint8Array(n), pF = new Uint32Array(n), pB = new Uint32Array(n);
  let prevPal, k = -1;
  if (!COVERAGE) COVERAGE = buildCoverage();
  if (!HALVES) buildHalves();
  const TOP = HALVES.top, BOT = HALVES.bot;

  function push(frame, palette) {
    if (frame.cols !== cols || frame.rows !== rows) throw new Error(`flash meter size is ${cols}x${rows}, frame is ${frame.cols}x${frame.rows}`);
    const pal = palette || frame.palette;
    const { glyphs, shades, fg, bg } = frame;
    const fgT = pal && pal.fgRgb, bgT = pal && pal.bgRgb;
    k++;
    const all = k === 0 || pal !== prevPal;
    prevPal = pal;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const g = glyphs[i];
        const s0 = shades ? shades[i] : METER_RGB_CELL;
        const fv = fg ? fg[i] : 0, bv = bg ? bg[i] : 0;
        if (!all && g === pG[i] && s0 === pS[i] && fv === pF[i] && bv === pB[i]) continue;
        pG[i] = g; pS[i] = s0; pF[i] = fv; pB[i] = bv;
        let s = s0, f, b;
        if (s === METER_RGB_CELL) {
          f = fv; b = bv;
          if (b === METER_PALETTE_BG) b = bgT ? bgT[0] : 0;
        } else {
          if (g === 32) s = 0;
          f = fgT ? fgT[s] : 0; b = bgT ? bgT[s] : 0;
        }
        const fr = SRGB_LIN[(f >>> 16) & 255], fgn = SRGB_LIN[(f >>> 8) & 255], fb = SRGB_LIN[f & 255];
        const br = SRGB_LIN[(b >>> 16) & 255], bgn = SRGB_LIN[(b >>> 8) & 255], bb = SRGB_LIN[b & 255];
        // the cell: the whole glyph's coverage (what the meter has always read)
        let c = COVERAGE[g], d = 1 - c;
        let r = c * fr + d * br, gr = c * fgn + d * bgn, bl = c * fb + d * bb;
        let sum = r + gr + bl, red = r - gr - bl;
        cellGrid.put(i, 0.2126 * r + 0.7152 * gr + 0.0722 * bl, red > 0 ? red * RED_SCALE : 0, sum > 0 && r / sum >= RED_SATURATION ? 1 : 0, k);
        // rule C: the cell's colour is the coverage-weighted mean of its fg and bg in OKLab (a and b); a pixel with no ink is bg, a pixel full of ink is fg, otherwise its linear blend
        const sf = labSlot(f), sb = labSlot(b);
        const fa = LAB_A[sf], fb2 = LAB_B[sf], ba = LAB_A[sb], bb2 = LAB_B[sb];
        cellGrid.putColour(i, c * fa + d * ba, c * fb2 + d * bb2, k);
        // the two pixels of the cell: the top half's and the bottom half's coverage
        c = TOP[g]; d = 1 - c;
        r = c * fr + d * br; gr = c * fgn + d * bgn; bl = c * fb + d * bb;
        sum = r + gr + bl; red = r - gr - bl;
        pixGrid.put(2 * y * cols + x, 0.2126 * r + 0.7152 * gr + 0.0722 * bl, red > 0 ? red * RED_SCALE : 0, sum > 0 && r / sum >= RED_SATURATION ? 1 : 0, k);
        if (c === 1) pixGrid.putColour(2 * y * cols + x, fa, fb2, k); else if (c === 0) pixGrid.putColour(2 * y * cols + x, ba, bb2, k); else { labOfLinear(r, gr, bl); pixGrid.putColour(2 * y * cols + x, LAB_OUT[0], LAB_OUT[1], k); }
        c = BOT[g]; d = 1 - c;
        r = c * fr + d * br; gr = c * fgn + d * bgn; bl = c * fb + d * bb;
        sum = r + gr + bl; red = r - gr - bl;
        pixGrid.put((2 * y + 1) * cols + x, 0.2126 * r + 0.7152 * gr + 0.0722 * bl, red > 0 ? red * RED_SCALE : 0, sum > 0 && r / sum >= RED_SATURATION ? 1 : 0, k);
        if (c === 1) pixGrid.putColour((2 * y + 1) * cols + x, fa, fb2, k); else if (c === 0) pixGrid.putColour((2 * y + 1) * cols + x, ba, bb2, k); else { labOfLinear(r, gr, bl); pixGrid.putColour((2 * y + 1) * cols + x, LAB_OUT[0], LAB_OUT[1], k); }
      }
    }
    cellGrid.end(k);
    pixGrid.end(k);
  }

  function report() {
    const cell = cellGrid.report(fps), pixel = pixGrid.report(fps);
    const both = (a, b) => ({ x1: worseOf(a.x1, b.x1), x4: worseOf(a.x4, b.x4) });
    const l1 = both(cell.l1, pixel.l1), l2 = both(cell.l2, pixel.l2), r = both(cell.r, pixel.r), l3 = worseOf(cell.l3, pixel.l3), c = worseOf(cell.c, pixel.c);
    return {
      cols, rows, fps, frames: k + 1, field: { ...cf },
      l1, l2, l3, r, c,
      pass: cell.pass && pixel.pass,
      cell: { ...cell, frames: k + 1 }, pixel: { ...pixel, frames: k + 1 },
    };
  }

  // cellY: the Y of the whole cell (the glyph's total coverage); pixelY: the Y of the top (half 0) or bottom (half 1) pixel
  return { push, report, field: cf, pixelField, cellY: (i) => cellGrid.Y[i], pixelY: (i, half) => pixGrid.Y[2 * Math.floor(i / cols) * cols + (i % cols) + half * cols] };
}

// ---- the rule list every flash test shares (DRIFT-8 C4)
//
// One list of rule ids, one lookup, one "which rules failed". A flash test judges with failedRules(rep) so that a rule added here (rule C was) reaches every test at once;
// a test that must leave a rule out says so by name (failedRules(rep, { not: [...] })) and prints why. 'c' is a single rule (judged at the speed the viewer sees, see the Rule C
// block above); the others are { x1, x4 } or single.
export const RULE_IDS = ['l1.x1', 'l1.x4', 'l2.x1', 'l2.x4', 'l3', 'r.x1', 'r.x4', 'c'];
export const ruleOf = (rep, id) => { const [a, b] = id.split('.'); return b ? rep[a][b] : rep[a]; };
export function failedRules(rep, { only = RULE_IDS, not = [] } = {}) {
  return only.filter((id) => !not.includes(id) && !ruleOf(rep, id).pass);
}
// the rules a 1x-pace frame sequence is judged on when its meter x4 view is not a real speed: the x1 view of every rule (L3 and C have one view)
export const X1_RULE_IDS = ['l1.x1', 'l2.x1', 'l3', 'r.x1', 'c'];
