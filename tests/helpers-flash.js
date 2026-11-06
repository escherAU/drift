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
