// ROSETTE: a kaleidoscope in full colour, the whole screen, every cell changing every frame (kind 'cells', rgb: true).
//
// Half-block pixels (2 per cell row, H_px = 2 * rows). A pixel's centre offsets u, v from the screen centre, in pixel
// units, give r = 2 |(u, v)| / H_px and theta = atan2(v, u). The picture is folded N ways round the centre:
//   theta' = | ((theta + 0.05 T) mod (2 pi / N)) - pi / N |
//   f = sin(5 r - 0.7 T + 3 cos(N theta' / 2)) + 0.6 sin(11 r cos theta' + 0.4 T + phi1) + 0.4 sin(17 r sin theta' - 0.3 T + phi2)
// (phi1, phi2 from the seed). Colour = safeHue(200 + 120 f + 40 r + HUE_RATE TC, FILL_L) (TC: colour time, below): the hue wheel passes every cell at ONE
// lightness, and space shifts it 120 degrees per unit of f, so neighbouring petals always differ. HUE_RATE is 200 degrees a second,
// not the designer's 90: with 90 the drift is cancelled by the field's own movement in many places (120 df/dt reaches -127 deg/s), so
// 16.5 % of cells (median 9.3 %) kept their colour from one frame to the next at its worst frame; the brief asks for 95 % to change.
// 180 is the least that does (95.2 % on the worst of three seeds), 200 is shipped for margin (96.4 %). Hue only, at steady lightness:
// free under the flash meter, in truecolor and in 256 colours.
//
// The contours, where |f| < CONTOUR_BAND, are the same colour turned half way round the wheel (hue + 180). In truecolor they are a
// little lighter, CONTOUR_L 0.70 (safeHue row 44 of 64; it was 0.72, row 45, until DRIFT-8: the per-pixel brightness range over the whole
// run is 0.0585 at 0.70 and 0.0814 at 0.72, and 0.07 is the tripwire). On 256 colours (params.cmode, set by the cell composer) they are
// at the fill's lightness: snapped to the xterm cube, a lightness step between contour and fill shows as a larger brightness jump than
// in truecolor (measured per pixel over a 4x run: 0.1333 at 0.70, 0.0665 at the fill's lightness). The numbers below are from stage C14 at 0.72. Why not the designer's L 0.82: the flash meter. A brighter line changes the cell's brightness by more
// than the 0.10 swing the meter counts, every time the picture drifts across it; measured at 120x40 that was L2 at 4x 76.6 %
// (limit 25) and L1 at 4x 24.3 %. L 0.78 passes in truecolor (L2 at 4x 11.8 %) but on 256-colour output, where the same colours
// are snapped to the xterm cube, it fails (63.6 %); 0.74 fails there too (28.4 %), 0.72 and below pass (8.2 % with the hue
// turn). The turn gives the line its contrast instead: amber on lilac, rose on teal. The candidate table is in the DRIFT-7 report.
//
// N runs 6, 8, 12, 10, 15 s each (and round again). At a change each pixel switches from the old fold count to the new one
// at hash(px, py) * 3 s, a 3 s dissolve spread across the whole screen, so no frame has more than a small share of pixels
// changing fold.
//
// The colour clock (DRIFT-8 C3). T is scene time (the geometry: fold, rotation, the field that decides where the contours are). TC is colour time,
// colourTime(t, params), which runs at min(speed, 1) of real time and is T at 1x. Everything that moves the HUE reads it: HUE_RATE x TC and the
// 120 f term, where f is the same field evaluated at TC (the colour the pattern carries must not turn four times as fast at 4x: Desmond found the
// colour followed the pattern). Where TC equals T (every 1x frame) f is used as it is, so a 1x frame is byte for byte the old one; where it does
// not, the field is evaluated a second time, at TC, for the colour only. The contour test |f| < CONTOUR_BAND stays on scene time.
//
// Pure in (seed, T, TC) with T = t - t0 and TC = tc - tc0. The only state is a cache of what depends on the size alone (r and theta per pixel, the
// 4096-entry sine table, a pixel buffer) and on the seed (the switch time per pixel); it is rebuilt when the size or seed
// changes and is never mutated by a frame, so a call is a function of its arguments. No allocation per frame.
//
// Any size: 0x0 and 1x1 draw nothing that throws, and below 60 x 20 it draws one centred dim line, "This vision needs 60 x 20.".
import { safeHue, pixelsToCells } from '../../../src/pixels.js';
import { sceneTime, colourTime, seedOf } from '../lib/clock.js';

export const MIN_W = 60, MIN_H = 20;
export const MESSAGE = 'This vision needs 60 x 20.';
export const FOLDS = Object.freeze([6, 8, 12, 10]);
export const FOLD_SECONDS = 15, MELT_SECONDS = 3;
export const FILL_L = 0.66, CONTOUR_L = 0.70, CONTOUR_TURN = 180, CONTOUR_BAND = 0.06;
export const CONTOUR_L_256 = FILL_L; // on 256 colours the contour is drawn at the fill's lightness (params.cmode === '256')
export const HUE_RATE = 200; // degrees of hue per second (the designer's 90, see the header)
const BG = 0x05060c; // the skin background
const DIM = 0x5a6a94; // the message: dim mist
const TAU = Math.PI * 2;

// ---- the sine table: 4096 entries, one turn

export const SINE_N = 4096;
export const SINE = new Float32Array(SINE_N);
for (let i = 0; i < SINE_N; i++) SINE[i] = Math.sin((i * TAU) / SINE_N);
const K = SINE_N / TAU;
const SIN = (x) => SINE[Math.floor(x * K + 0.5) & (SINE_N - 1)]; // nearest entry
const COS = (x) => SINE[(Math.floor(x * K + 0.5) + (SINE_N >> 2)) & (SINE_N - 1)];

// ---- pure pieces (exported for the tests)

export function hash2(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The fold counts in force at scene time T: { prev, cur, local } with local = seconds since the last change (0..15).
export function foldsAt(T) {
  const cycle = FOLD_SECONDS * FOLDS.length;
  const tl = T % cycle;
  const seg = Math.floor(tl / FOLD_SECONDS);
  return { prev: FOLDS[(seg + FOLDS.length - 1) % FOLDS.length], cur: FOLDS[seg], local: tl - seg * FOLD_SECONDS };
}

// When pixel (px, py) switches from the old fold to the new one, seconds after the change.
export const meltDelay = (px, py, seed) => MELT_SECONDS * hash2(px, py, seed);

// The fold count pixel (px, py) is drawn with at scene time T.
export function foldOf(px, py, seed, T) {
  const f = foldsAt(T);
  return f.local < meltDelay(px, py, seed) ? f.prev : f.cur;
}

export const phiOf = (seed) => [hash2(seed, 1, 7) * TAU, hash2(seed, 2, 7) * TAU];

// The field at radius r, angle a, fold n, time T (the table sine, as drawn).
export function fieldAt(r, a, n, T, p1, p2) {
  const seg = TAU / n;
  const q = a + 0.05 * T;
  const th = Math.abs(q - seg * Math.floor(q / seg) - seg / 2);
  return SIN(5 * r - 0.7 * T + 3 * COS((n * th) / 2)) + 0.6 * SIN(11 * r * COS(th) + 0.4 * T + p1) + 0.4 * SIN(17 * r * SIN(th) - 0.3 * T + p2);
}

// ---- the size cache

let cache = null;
// r and theta per pixel for a w x h-cell screen (H_px = 2 h pixels), the pixel buffer, and the switch delay per pixel for `seed`.
// The same object comes back for the same size (and the same seed); a new size builds a new one.
export function cacheFor(w, h, seed = 1) {
  if (cache && cache.w === w && cache.h === h) {
    if (cache.seed !== seed) { fillDelay(cache, seed); cache.seed = seed; }
    return cache;
  }
  const hPx = 2 * h, n = w * hPx;
  const c = { w, h, hPx, n, r: new Float32Array(n), ang: new Float32Array(n), delay: new Float32Array(n), pixels: new Uint32Array(n), seed };
  for (let py = 0; py < hPx; py++) {
    const v = py + 0.5 - hPx / 2;
    for (let px = 0; px < w; px++) {
      const u = px + 0.5 - w / 2, i = py * w + px;
      c.r[i] = (2 * Math.hypot(u, v)) / hPx;
      c.ang[i] = Math.atan2(v, u);
    }
  }
  fillDelay(c, seed);
  cache = c;
  return c;
}

function fillDelay(c, seed) {
  for (let py = 0; py < c.hPx; py++) for (let px = 0; px < c.w; px++) c.delay[py * c.w + px] = meltDelay(px, py, seed);
}

// ---- the scene

function message(w, h, params) {
  const { glyphs, fg, bg } = params;
  const n = w * h;
  for (let i = 0; i < n; i++) { glyphs[i] = 32; fg[i] = BG; bg[i] = BG; }
  const row = Math.floor(h / 2), x0 = Math.floor((w - MESSAGE.length) / 2);
  for (let k = 0; k < MESSAGE.length; k++) {
    const x = x0 + k;
    if (x < 0 || x >= w) continue;
    const i = row * w + x;
    glyphs[i] = MESSAGE.charCodeAt(k); fg[i] = DIM;
  }
}

// The scene function. makeRosette(contourL, contourTurn) exists so the tests can build the designer's L 0.82 contour as a
// control that must fail the meter; the shipped scene is makeRosette() with the defaults.
// contourL256 is the lightness used when params.cmode is '256'; a control that names only contourL gets that one in both modes.
export function makeRosette(contourL, contourTurn = CONTOUR_TURN, contourL256) {
  if (contourL === undefined) { contourL = CONTOUR_L; if (contourL256 === undefined) contourL256 = CONTOUR_L_256; } else if (contourL256 === undefined) contourL256 = contourL;
  function rosette(t, w, h, params) {
    if (!(w > 0 && h > 0)) return;
    if (w < MIN_W || h < MIN_H) { message(w, h, params); return; }
    const T = sceneTime(t, params), TC = colourTime(t, params), seed = seedOf(params);
    const c = cacheFor(w, h, seed);
    const [p1, p2] = phiOf(seed);
    const { prev, cur, local } = foldsAt(T);
    const melting = local < MELT_SECONDS;
    const rot = 0.05 * T, hueT = 200 + HUE_RATE * TC;
    const rotC = 0.05 * TC, split = TC !== T; // at 1x the colour clock is the scene clock and the picture's colour field is the picture itself
    const { r, ang, delay, pixels, n } = c;
    const cL = params.cmode === '256' ? contourL256 : contourL;
    const segC = TAU / cur, segP = TAU / prev;
    for (let i = 0; i < n; i++) {
      const ri = r[i];
      const useP = melting && local < delay[i];
      const N = useP ? prev : cur, seg = useP ? segP : segC;
      const q = ang[i] + rot;
      const th = Math.abs(q - seg * Math.floor(q / seg) - seg / 2);
      const cth = COS(th), sth = SIN(th);
      const f = SIN(5 * ri - 0.7 * T + 3 * COS((N * th) / 2)) + 0.6 * SIN(11 * ri * cth + 0.4 * T + p1) + 0.4 * SIN(17 * ri * sth - 0.3 * T + p2);
      let fc = f; // the field the colour reads: the same field at colour time, so the hue the pattern carries turns at its 1x rate at every speed
      if (split) {
        const qc = ang[i] + rotC, thc = Math.abs(qc - seg * Math.floor(qc / seg) - seg / 2);
        fc = SIN(5 * ri - 0.7 * TC + 3 * COS((N * thc) / 2)) + 0.6 * SIN(11 * ri * COS(thc) + 0.4 * TC + p1) + 0.4 * SIN(17 * ri * SIN(thc) - 0.3 * TC + p2);
      }
      const hue = hueT + 120 * fc + 40 * ri;
      pixels[i] = f > -CONTOUR_BAND && f < CONTOUR_BAND ? safeHue(hue + contourTurn, cL) : safeHue(hue, FILL_L);
    }
    pixelsToCells(params, w, h, pixels, w, 2 * h);
  }
  rosette.id = 'rosette';
  rosette.kind = 'cells';
  rosette.rgb = true;
  return rosette;
}

export default makeRosette();
