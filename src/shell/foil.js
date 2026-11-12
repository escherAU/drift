// The foil label (DRIFT-7 C12): a rare, shiny label for one cartridge on the shelf. Pure: no I/O, no clock of its own.
//
// Manifest: foil: { hues: [2 to 6 colours like #3FE8FF], style: "sweep" | "holo" } (format 2, unlocked cartridges only;
// schema.js checks it). The shelf (library.js drawShelf) turns the label cells of that cartridge into full-colour cells
// AFTER the card is drawn, so the cached card grids and the memo are never touched.
//
//   Hue. Each manifest colour is read as an OKLCH hue angle (degrees). A cell's hue is a point on the cyclic ramp through
//   those angles (the last hue blends back to the first), each blend along the shorter arc. The colour shown is
//   safeHue(hue, lightness), i.e. the red-safe colour of that hue on the renderer's 6-bit grid (pixels.js: linear red share
//   at most 0.75 and never a saturated red), so a hue the author wrote that is too red is mapped to the nearest safe colour
//   rather than refused. The author's chroma is not used; only the hue angle is.
//
//   Brightness. Only the ink level sets it. The lightness given to safeHue for a cell of ink level lv (0..3) is the cube
//   root of the relative luminance of that level's tint colour, so the cell shows the same WCAG brightness the plain label
//   would have had (safeHue's luminance is L^3 whatever the hue). Hue moves; brightness never does.
//
//   Style (x, y are label-local cell coordinates: x 0..23, y 0..9; t is the stepped clock in seconds):
//     holo   phase = frac((x + 2y) / 30 - t / 5): a diagonal band crossing the card every 5 s
//     sweep  phase = frac(x / 24 - t / 4):        a vertical band crossing the card left to right every 4 s
//   Time is quantised to FOIL_STEPS_PER_SECOND (6) steps a second: t = floor(clock * 6) / 6.
import { safeHue, relY, RGB_CELL, PALETTE_BG } from '../pixels.js';

export { FOIL_STYLES, FOIL_MIN_HUES, FOIL_MAX_HUES } from '../cartridge/schema.js';
export const FOIL_STEPS_PER_SECOND = 6;
export const FOIL_HOLO_SECONDS = 5;
export const FOIL_SWEEP_SECONDS = 4;
export { RGB_CELL, PALETTE_BG };

const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };

// The OKLCH hue angle (degrees, 0..360) of a colour given as 0xRRGGBB or [r, g, b]. A grey has no hue; it reads as 0.
export function hueOfRgb(rgb) {
  const [R, G, B] = Array.isArray(rgb) ? rgb : [(rgb >>> 16) & 255, (rgb >>> 8) & 255, rgb & 255];
  const r = lin(R), g = lin(G), b = lin(B);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  if (Math.abs(a) < 1e-4 && Math.abs(bb) < 1e-4) return 0;
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

const parse = (hex) => parseInt(String(hex).slice(1), 16);

// The foil a cartridge carries into the library view.
//   manifestFoil  { hues: ['#rrggbb', ...], style }  (validated by schema.js)
//   levelRgb      the four tint colours of the cartridge's label, level 0 (dim) to 3 (bright), each [r, g, b]
// -> { style, hues: [degrees], L: [4 lightness values] }
export function makeFoil(manifestFoil, levelRgb) {
  return Object.freeze({
    style: manifestFoil.style,
    hues: Object.freeze(manifestFoil.hues.map((h) => hueOfRgb(parse(h)))),
    L: Object.freeze(levelRgb.map((c) => Math.cbrt(relY(((c[0] << 16) | (c[1] << 8) | c[2]) >>> 0)))),
  });
}

// The step the clock is on (a whole number): 0 for a clock of 0 or less. The epsilon keeps a clock that was built by adding
// frame times (0.1666666...) on its step.
export function foilStep(clock) {
  return clock > 0 ? Math.floor(clock * FOIL_STEPS_PER_SECOND + 1e-6) : 0;
}
export const foilTime = (clock) => foilStep(clock) / FOIL_STEPS_PER_SECOND;

const frac = (v) => v - Math.floor(v);

// The hue (degrees) at ramp phase 0..1: the cyclic ramp through the foil's hues, each blend along the shorter arc.
export function rampHue(hues, phase) {
  const n = hues.length;
  const u = frac(phase) * n;
  const i = Math.floor(u) % n;
  const f = u - Math.floor(u);
  const a = hues[i], b = hues[(i + 1) % n];
  const d = ((b - a + 540) % 360) - 180;
  return a + d * f;
}

// The hue of the label cell (x, y) at stepped time t.
export function foilHue(foil, x, y, t) {
  const phase = foil.style === 'holo' ? (x + 2 * y) / 30 - t / FOIL_HOLO_SECONDS : x / 24 - t / FOIL_SWEEP_SECONDS;
  return rampHue(foil.hues, phase);
}

// The foil colour (0xRRGGBB) of a label cell of ink level lv at (x, y), time t.
export function foilColour(foil, lv, x, y, t) {
  return safeHue(foilHue(foil, x, y, t), foil.L[lv]);
}

// The pass over a card's label rect, after the card was copied onto the frame. The card is at (x0, y0) in the frame; its
// label window is 24 x 10 at (3, 3). A cell is a foil cell when it is not blank and its shade is one of the card's four
// tint shades (tint + lv); it becomes a full-colour cell: shade RGB_CELL, fg = foilColour, bg = the palette background.
// clip = the same { clipX0, clipX1, clipY, clipY0 } the copy used, so a cell the copy did not draw is not touched.
// Everything else on the frame stays as it was.
export function applyFoil(f, cart, x0, y0, t, clip = {}) {
  const foil = cart.foil;
  if (!foil || cart.locked) return;
  const tint = cart.tint;
  const cx0 = clip.clipX0 === undefined ? 0 : clip.clipX0, cx1 = clip.clipX1 === undefined ? f.cols : clip.clipX1;
  const cy = clip.clipY === undefined ? Infinity : clip.clipY, cy0 = clip.clipY0 === undefined ? -Infinity : clip.clipY0;
  for (let ly = 0; ly < 10; ly++) {
    const yy = y0 + 3 + ly;
    if (yy < 0 || yy >= f.rows || yy >= cy || yy < cy0) continue;
    for (let lx = 0; lx < 24; lx++) {
      const xx = x0 + 3 + lx;
      if (xx < cx0 || xx >= cx1 || xx < 0 || xx >= f.cols) continue;
      const i = yy * f.cols + xx;
      if (f.glyphs[i] === 32) continue;
      const lv = f.shades[i] - tint;
      if (lv < 0 || lv > 3) continue;
      f.shades[i] = RGB_CELL;
      f.fg[i] = foilColour(foil, lv, lx, ly, t);
      f.bg[i] = PALETTE_BG;
    }
  }
}
