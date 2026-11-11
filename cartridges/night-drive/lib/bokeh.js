// Red Light, Rain: the traffic light blurred by rain into a bokeh, and how it changes colour. Pure functions of the step count, so the
// picture at step n never depends on the frames before it.
//
//   0 to 58 s      red: concentric rings of ░ ▒ ▓ █ in coral shades 0 to 3 (rim to core)
//   58.0 to 58.5   the red ramps down, a cell at a time (each cell starts 0 to 3 steps late), one shade every 3 steps, then goes dark
//   58.5 to 59.0   the green ramps up from dark in mint, the same cells and glyphs, one shade every 3 steps
//   58.5 to 60.5   the reflections under the light go coral.1, coral.0, dark, mint.0, mint.1, row by row
// A cell that keeps its glyph moves one shade at a time (3 steps is more than a frame at 18 fps), and the cell is dark between the
// colours, so there is never a red-to-green cut.
import { hash } from './hash.js';
import { CORAL, MINT } from './palette.js';

export const RED_OFF = 1740; // step 58.0 s
export const GREEN_ON = 1755; // step 58.5 s
export const RAMP_STEP = 3;
export const RING_GLYPHS = Object.freeze(['░', '▒', '▓', '█'].map((ch) => ch.codePointAt(0)));

// The cells of a bokeh of the layout L, as offsets from the light: glyph, target shade and the two start delays of the cell.
export function bokehCells(L, seed) {
  const out = [];
  const hy = L.bokehHalfH, hx = Math.floor(L.bokehRx);
  for (let dy = -hy; dy <= hy; dy++) {
    for (let dx = -hx; dx <= hx; dx++) {
      const d2 = (dx / L.bokehRx) ** 2 + (dy / L.bokehRy) ** 2;
      if (d2 > 1) continue;
      const shade = d2 < 0.12 ? 3 : d2 < 0.35 ? 2 : d2 < 0.65 ? 1 : 0;
      out.push({ dx, dy, shade, glyph: RING_GLYPHS[shade], a: hash(dx, dy, seed) % 4, b: hash(dy, dx, seed + 7) % 4 });
    }
  }
  return out;
}

// The colour index of a bokeh cell with target shade t at step n; 0 means dark (nothing is drawn).
export function lampColour(n, t, a, b) {
  if (n < RED_OFF + a) return CORAL[t];
  if (n < GREEN_ON + b) {
    const s = t - (Math.floor((n - RED_OFF - a) / RAMP_STEP) + 1);
    return s >= 0 ? CORAL[s] : 0;
  }
  return MINT[Math.min(t, Math.floor((n - GREEN_ON - b) / RAMP_STEP))];
}

// The reflection cells: streaks of ╎ and ┊ that narrow going down the street. Rows are centred on the light.
export const REFLECTIONS = Object.freeze({
  full: Object.freeze(['╎┊╎', '┊╎┊╎┊', '╎┊╎', '┊╎┊', '╎', '┊']),
  compact: Object.freeze(['┊╎┊', '╎┊╎', '┊╎', '╎']),
});

// A reflection cell's colour at step n; o is the cell's start delay in steps (a few per row, so the retint runs down the street).
export function reflColour(n, o) {
  const t0 = GREEN_ON + o;
  if (n < t0) return CORAL[1];
  const j = Math.floor((n - t0) / RAMP_STEP);
  return j === 0 ? CORAL[0] : j === 1 ? 0 : j === 2 ? MINT[0] : MINT[1];
}
