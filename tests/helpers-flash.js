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
// Rules:  l1.x1, l1.x4  WCAG: cells with >= 7 transitions in 1 s, at 1x and 4x.
//         l2.x1, l2.x4  in-house: >= 3 transitions in 1 s, at 1x and 4x. Both are binding: a scene must stay quiet
//                       when the same frames are played four times as fast (a 2 s bloom fails l2.x4).
//         l3            worst single frame step: the share of ALL cells whose Y moved >= 0.10 since the frame
//                       before; passes when <= STEP_FRACTION (0.30). Hue changes at steady brightness are free.
//         r.x1, r.x4    cells with >= 2 red transitions in 1 s, at 1x and 4x.
//
// report() -> {
//   cols, rows, fps, frames, field: { w, h },
//   l1: { x1: RULE, x4: RULE }, l2: { x1: RULE, x4: RULE }, l3: STEP, r: { x1: RULE, x4: RULE },
//   pass,        // every rule passes
// }
// RULE = { worstFraction, limit, pass, details: { frame, timeS, field: { x, y, w, h }, hotCells } }
//        (frame = frame index of the worst reading; timeS = its time at that speed; field = top-left cell and size of
//         the worst field; hotCells = hot cells in it)
// STEP = { worstFraction, limit, pass, details: { frame, timeS, cells } }  (the step INTO `frame`)
// Nothing pushed yet: all fractions 0, details frame -1.
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
  for (let i = 1; i <= 7; i++) t[0x2590 - i] = (8 - i) / 8;     // left 7/8 .. 1/8 blocks (U+2589-258F)
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

export function createFlashMeter(cols, rows, fps) {
  const n = cols * rows;
  const field = fieldSize(cols, rows);
  const fieldCells = field.w * field.h;
  const win1 = Math.max(1, Math.round(fps)), win4 = win1 * FAST_SPEED;
  const Y = new Float64Array(n), prevY = new Float64Array(n), RV = new Float64Array(n), RS = new Uint8Array(n);
  const lumTracker = createSwingTracker(n, { swing: TRANSITION_SWING, darkSide: DARK_SIDE_MAX });
  const redTracker = createSwingTracker(n, { swing: RED_SWING, strict: true, gate: true });
  const lumLog = createTransitionLog(n, L1_COUNT), redLog = createTransitionLog(n, R_COUNT);
  const counter = createWindowCounter(cols, rows, field.w, field.h);
  const mk = (id, log, count, window, speed) => ({ id, log, count, window, speed, hot: new Uint8Array(n), best: { count: 0, x: 0, y: 0, frame: -1, hotCells: 0 } });
  const specs = [
    mk('l1.x1', lumLog, L1_COUNT, win1, 1), mk('l1.x4', lumLog, L1_COUNT, win4, FAST_SPEED),
    mk('l2.x1', lumLog, L2_COUNT, win1, 1), mk('l2.x4', lumLog, L2_COUNT, win4, FAST_SPEED),
    mk('r.x1', redLog, R_COUNT, win1, 1), mk('r.x4', redLog, R_COUNT, win4, FAST_SPEED),
  ];
  const step = { count: 0, frame: -1 };
  let k = -1;

  function push(frame, palette) {
    if (frame.cols !== cols || frame.rows !== rows) throw new Error(`flash meter size is ${cols}x${rows}, frame is ${frame.cols}x${frame.rows}`);
    const pal = palette || frame.palette;
    const { glyphs, shades, fg, bg } = frame;
    const fgT = pal && pal.fgRgb, bgT = pal && pal.bgRgb;
    if (!COVERAGE) COVERAGE = buildCoverage();
    k++;
    for (let i = 0; i < n; i++) {
      const g = glyphs[i];
      let s = shades ? shades[i] : METER_RGB_CELL;
      let f, b;
      if (s === METER_RGB_CELL) {
        f = fg ? fg[i] : 0; b = bg ? bg[i] : 0;
        if (b === METER_PALETTE_BG) b = bgT ? bgT[0] : 0;
      } else {
        if (g === 32) s = 0;
        f = fgT ? fgT[s] : 0; b = bgT ? bgT[s] : 0;
      }
      const c = COVERAGE[g], d = 1 - c;
      const r = c * SRGB_LIN[(f >>> 16) & 255] + d * SRGB_LIN[(b >>> 16) & 255];
      const gr = c * SRGB_LIN[(f >>> 8) & 255] + d * SRGB_LIN[(b >>> 8) & 255];
      const bl = c * SRGB_LIN[f & 255] + d * SRGB_LIN[b & 255];
      Y[i] = 0.2126 * r + 0.7152 * gr + 0.0722 * bl;
      const sum = r + gr + bl;
      RS[i] = sum > 0 && r / sum >= RED_SATURATION ? 1 : 0;
      const red = r - gr - bl;
      RV[i] = red > 0 ? red * RED_SCALE : 0;
    }
    // L3: the share of all cells whose Y moved by the swing since the previous frame
    if (k > 0) {
      let moved = 0;
      for (let i = 0; i < n; i++) if (Math.abs(Y[i] - prevY[i]) >= TRANSITION_SWING - EPS) moved++;
      if (moved > step.count) { step.count = moved; step.frame = k; }
    }
    prevY.set(Y);
    for (let i = 0; i < n; i++) {
      if (lumTracker.step(i, Y[i], 0)) lumLog.add(i, k);
      if (redTracker.step(i, RV[i], RS[i])) redLog.add(i, k);
    }
    for (const sp of specs) {
      let total = 0;
      const hot = sp.hot, log = sp.log, count = sp.count, window = sp.window;
      for (let i = 0; i < n; i++) { const h = log.hot(i, count, k, window) ? 1 : 0; hot[i] = h; total += h; }
      if (total > sp.best.count) { // a field cannot hold more than the screen does; only look when it could beat the best
        const w = counter.best(hot);
        if (w.count > sp.best.count) sp.best = { count: w.count, x: w.x, y: w.y, frame: k, hotCells: w.count };
      }
    }
  }

  function ruleOf(sp) {
    const frac = sp.best.count / fieldCells;
    return {
      worstFraction: frac, limit: FIELD_FRACTION, pass: frac <= FIELD_FRACTION,
      details: {
        frame: sp.best.frame, timeS: sp.best.frame < 0 ? 0 : sp.best.frame / (fps * sp.speed),
        field: { x: sp.best.x, y: sp.best.y, w: field.w, h: field.h }, hotCells: sp.best.hotCells,
      },
    };
  }

  function report() {
    const [l1x1, l1x4, l2x1, l2x4, rx1, rx4] = specs.map(ruleOf);
    const frac = step.count / n;
    const l3 = {
      worstFraction: frac, limit: STEP_FRACTION, pass: frac <= STEP_FRACTION,
      details: { frame: step.frame, timeS: step.frame < 0 ? 0 : step.frame / fps, cells: step.count },
    };
    const all = [l1x1, l1x4, l2x1, l2x4, l3, rx1, rx4];
    return {
      cols, rows, fps, frames: k + 1, field: { ...field },
      l1: { x1: l1x1, x4: l1x4 }, l2: { x1: l2x1, x4: l2x4 }, l3, r: { x1: rx1, x4: rx4 },
      pass: all.every((r) => r.pass),
    };
  }

  return { push, report, field, cellY: (i) => Y[i] };
}
