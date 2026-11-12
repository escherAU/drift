// Fixtures for the byte and CPU budget helper (DRIFT-7 C4b): a byte hog that must FAIL the budget, a still field with a
// moving orb that must pass a small limit, and a scene that burns a set number of ms per call.
import { limitFromMeasured } from './helpers-budget.js';

const pack = (r, g, b) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
function mix(a, b) {
  let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

// ---- the hog: every cell gets a new random glyph, fg and bg every frame.
// Glyphs are three-byte block elements (light/medium/dark shade and the quadrants), none of them blank or a full block, so
// the renderer has to write all three. Every channel is 100..224 in steps of 4 (the renderer drops the two low bits), so each
// is three digits long: the densest output a cell can have, 39 bytes (36 of colour, 3 of glyph). At 240x67 and 18 fps that
// is 16_000 x 39 x 18 = 11.2 MB/s, the most any scene can send, and it is UNDER the 12 MB/s steady ceiling.
const HOG_GLYPHS = [0x2591, 0x2592, 0x2593, 0x2596, 0x2597, 0x2598, 0x2599, 0x259a, 0x259b, 0x259c, 0x259d, 0x259e, 0x259f];
const chan = (h, s) => 100 + ((h >>> s) & 31) * 4;
const hogRgb = (h) => (chan(h, 0) << 16) | (chan(h, 5) << 8) | chan(h, 10);
function fillHog(k, n, glyphs, fg, bg) {
  for (let i = 0; i < n; i++) {
    const a = mix(i, k), b = mix(a, 1), c = mix(a, 2);
    glyphs[i] = HOG_GLYPHS[a % HOG_GLYPHS.length];
    fg[i] = hogRgb(b);
    bg[i] = hogRgb(c);
  }
}
// a frame source: (t, cols, rows) => frame
export function hogFrameSource() {
  let n = -1, f = null;
  return (t, cols, rows) => {
    if (n !== cols * rows) { n = cols * rows; f = { cols, rows, glyphs: new Uint16Array(n), shades: new Uint8Array(n).fill(255), fg: new Uint32Array(n), bg: new Uint32Array(n) }; }
    fillHog(Math.round(t * 18), n, f.glyphs, f.fg, f.bg);
    return f;
  };
}
// the same as a full-colour cells scene (pure in t)
export function makeHog() {
  const hog = (t, w, h, params) => fillHog(Math.round(t * 18), w * h, params.glyphs, params.fg, params.bg);
  hog.id = 'budget-hog'; hog.kind = 'cells'; hog.rgb = true;
  return hog;
}

// ---- the orb: a still field (dim punctuation on near-black, never changing) and one glowing disc drifting across it.
// The disc is about a third of the screen high; its colours depend on the distance from its centre, so every cell it covers
// changes a little every frame, and the cells it just left go back to the field.
const FIELD_GLYPHS = [46, 58, 43, 42]; // . : + *
export function makeOrb() {
  const orb = (t, w, h, params) => {
    const R = Math.max(3, h * 0.3);
    const cx = w * (0.5 + 0.3 * Math.sin(t * 0.5)), cy = h * (0.5 + 0.25 * Math.sin(t * 0.37 + 1));
    const { glyphs, fg, bg } = params;
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        const dx = (x - cx) / 2, dy = y - cy; // a cell is about twice as tall as wide
        const d = Math.sqrt(dx * dx + dy * dy) / R;
        if (d < 1) {
          const k = 1 - d;
          glyphs[i] = 0x2593;
          fg[i] = pack(90 + 160 * k, 60 + 150 * k * k, 200 * (1 - k * 0.5));
          bg[i] = pack(20 + 60 * k, 10 + 30 * k, 40 + 40 * k);
        } else {
          const hsh = mix(i, 7);
          glyphs[i] = FIELD_GLYPHS[hsh & 3];
          fg[i] = pack(40 + ((hsh >>> 4) & 31), 40 + ((hsh >>> 9) & 31), 60 + ((hsh >>> 14) & 31));
          bg[i] = 0x06060c;
        }
      }
    }
  };
  orb.id = 'budget-orb'; orb.kind = 'cells'; orb.rgb = true;
  return orb;
}
// Measured at 240x67, 30 s (see tests/budget.test.js): steady and worst-second bytes/s x 1.10, rounded up to 10 KB/s.
export const ORB_MEASURED = { steady: 915_171, worst: 1_004_374 };
export const ORB_LIMIT = { steady: limitFromMeasured(ORB_MEASURED.steady), worst: limitFromMeasured(ORB_MEASURED.worst) };

// ---- a scene whose first `calls` calls each burn `ms` and every later one is cheap (warm-up must not be counted)
export function makeSlowStart(ms, calls) {
  let n = 0;
  const slow = (t, w, h, params) => {
    if (n++ < calls) { const until = performance.now() + ms; while (performance.now() < until) { /* burn */ } }
    const c = w * h;
    for (let i = 0; i < c; i++) { params.glyphs[i] = 46; params.fg[i] = 0x808080; params.bg[i] = 0x000000; }
  };
  slow.id = 'budget-slow-start'; slow.kind = 'cells'; slow.rgb = true;
  return slow;
}

// ---- a scene that costs about `ms` per call and otherwise draws a static field (so the render side is cheap)
export function makeSlowScene(ms) {
  const slow = (t, w, h, params) => {
    const until = performance.now() + ms;
    while (performance.now() < until) { /* burn */ }
    const n = w * h;
    for (let i = 0; i < n; i++) { params.glyphs[i] = 46; params.fg[i] = 0x808080; params.bg[i] = 0x000000; }
  };
  slow.id = `budget-slow-${ms}`; slow.kind = 'cells'; slow.rgb = true;
  return slow;
}
