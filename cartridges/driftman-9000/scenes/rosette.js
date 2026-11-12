// ROSETTE (placeholder, DRIFT-7 stage A): a kaleidoscope in full colour. Half-block pixels, a field folded N ways round the
// centre, hue = safeHue(200 + 120 f + 40 r + 90 t, 0.66) so the whole wheel passes every cell every 4 s at one lightness,
// thin contours where |f| is small at L 0.78 (the designer's 0.82 fails the flash meter at 120x40: L1 at 4x 25.4%, L2 at 1x
// 28.2%, L2 at 4x 76.3%; 0.78 passes every rule at 1x and 4x). The fold count runs 6, 8, 12, 10 for 15 s each; at a change each pixel
// switches from the old fold to the new at hash(px, py) * 3 s. The final look is built in a later stage.
//
// kind 'cells', rgb: true. Pure in (seed, t - t0). Any size: 0x0 and 1x1 draw nothing that throws, and below 60 x 20 it
// draws one centred dim line, "This vision needs 60 x 20.".
import { safeHue } from '../../../src/pixels.js';
import { sceneTime, seedOf } from '../lib/clock.js';

export const MIN_W = 60, MIN_H = 20;
export const MESSAGE = 'This vision needs 60 x 20.';
export const FOLDS = Object.freeze([6, 8, 12, 10]);
export const FOLD_SECONDS = 15, MELT_SECONDS = 3;
const BG = 0x05060c; // the skin background
const DIM = 0x5a6a94; // the message: dim mist
const FILL_L = 0.66, CONTOUR_L = 0.78, CONTOUR_BAND = 0.06;
const TAU = Math.PI * 2;

function hash2(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function field(r, a, n, T, p1, p2) {
  const seg = TAU / n;
  let ang = (a + 0.05 * T) % seg;
  if (ang < 0) ang += seg;
  const th = Math.abs(ang - seg / 2);
  return Math.sin(5 * r - 0.7 * T + 3 * Math.cos((n * th) / 2))
    + 0.6 * Math.sin(11 * r * Math.cos(th) + 0.4 * T + p1)
    + 0.4 * Math.sin(17 * r * Math.sin(th) - 0.3 * T + p2);
}

function colourAt(px, py, w, hPx, T, seed, p1, p2, local, prevN, curN) {
  const u = px + 0.5 - w / 2, v = py + 0.5 - hPx / 2;
  const r = (2 * Math.hypot(u, v)) / hPx, a = Math.atan2(v, u);
  const n = local < MELT_SECONDS * hash2(px, py, seed) ? prevN : curN;
  const f = field(r, a, n, T, p1, p2);
  const contour = Math.abs(f) < CONTOUR_BAND;
  return safeHue(200 + 120 * f + 40 * r + 90 * T, contour ? CONTOUR_L : FILL_L);
}

function rosette(t, w, h, params) {
  const { glyphs, fg, bg } = params;
  const n = w * h;
  if (!(n > 0)) return;
  if (w < MIN_W || h < MIN_H) {
    for (let i = 0; i < n; i++) { glyphs[i] = 32; fg[i] = BG; bg[i] = BG; }
    const row = Math.floor(h / 2), x0 = Math.floor((w - MESSAGE.length) / 2);
    for (let k = 0; k < MESSAGE.length; k++) {
      const x = x0 + k;
      if (x < 0 || x >= w) continue;
      const i = row * w + x;
      glyphs[i] = MESSAGE.charCodeAt(k); fg[i] = DIM;
    }
    return;
  }
  const T = sceneTime(t, params), seed = seedOf(params);
  const p1 = hash2(seed, 1, 7) * TAU, p2 = hash2(seed, 2, 7) * TAU;
  const cycle = FOLD_SECONDS * FOLDS.length;
  const tl = T % cycle, seg = Math.floor(tl / FOLD_SECONDS), local = tl - seg * FOLD_SECONDS;
  const curN = FOLDS[seg], prevN = FOLDS[(seg + FOLDS.length - 1) % FOLDS.length];
  const hPx = 2 * h;
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const i = cy * w + cx;
      const top = colourAt(cx, 2 * cy, w, hPx, T, seed, p1, p2, local, prevN, curN);
      const bot = colourAt(cx, 2 * cy + 1, w, hPx, T, seed, p1, p2, local, prevN, curN);
      if (top === bot) { glyphs[i] = 32; fg[i] = top; bg[i] = top; } else { glyphs[i] = 0x2580; fg[i] = top; bg[i] = bot; }
    }
  }
}

rosette.id = 'rosette';
rosette.kind = 'cells';
rosette.rgb = true;
export default rosette;
