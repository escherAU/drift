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
