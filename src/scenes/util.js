// Shared helpers for scene modules. No terminal access, no module state that
// can change a scene's output: only (t, w, h, params) decide the result.
//
// SCENE CONTRACT
//   scene(t, w, h, params) -> Uint8Array(w * h)
//     t       seconds of scene time (any finite number)
//     w, h    grid size in cells (0 or negative gives an empty array)
//     params  optional object:
//               seed    integer, default 1 (varies phases / random placement)
//               out     optional Uint8Array of length w*h to fill and return
//               glyphs  optional Uint8Array of length w*h; scenes with
//                       scene.glyphs === true fill it with braille dot masks
//                       (bit pattern of U+2800..U+28FF); others leave it
//                       untouched. 0 means "use the density ramp".
//   Output is row-major, 0 = dark .. 255 = brightest, always in range.
//   The same inputs always give the same output, in any call order.
//   Geometry: a cell is 1 unit wide and 2 units tall, so circles stay round.

export function dims(w, h) {
  const W = w > 0 ? Math.floor(w) : 0;
  const H = h > 0 ? Math.floor(h) : 0;
  return [W, H];
}

export function outBuf(params, n) {
  const o = params && params.out;
  if (o instanceof Uint8Array && o.length === n) { o.fill(0); return o; }
  return new Uint8Array(n);
}

export function seedOf(params) {
  const s = params && Number.isFinite(params.seed) ? params.seed : 1;
  return s | 0;
}

export function timeOf(t) {
  return Number.isFinite(t) ? t : 0;
}

export function glyphBuf(params, n) {
  const g = params && params.glyphs;
  if (g instanceof Uint8Array && g.length === n) { g.fill(0); return g; }
  return null;
}

// 32-bit integer hash of three integers -> unsigned int.
export function hash32(a, b, c) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

// Uniform [0,1) from three integers.
export function rand(a, b, c) {
  return hash32(a, b, c) / 4294967296;
}

export function smooth(x) {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

export function clamp255(v) {
  return v <= 0 ? 0 : v >= 255 ? 255 : v | 0;
}

// Positive modulo.
export function pmod(a, m) {
  return ((a % m) + m) % m;
}

// ---- cheap trig for per-cell inner loops (accuracy ~1e-6, plenty for shading)
const SIN_N = 4096;
const SIN_TAB = new Float64Array(SIN_N + 2);
for (let i = 0; i < SIN_N + 2; i++) SIN_TAB[i] = Math.sin((i / SIN_N) * Math.PI * 2);

// sin(2*pi*x) for any finite x (x in turns).
export function sinTurns(x) {
  x -= Math.floor(x);
  const p = x * SIN_N;
  const i = p | 0;
  const f = p - i;
  return SIN_TAB[i] + (SIN_TAB[i + 1] - SIN_TAB[i]) * f;
}

// atan2 with ~1e-5 rad error; no special cases beyond (0,0) -> 0.
export function fastAtan2(y, x) {
  const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
  const mx = ax > ay ? ax : ay, mn = ax > ay ? ay : ax;
  if (mx === 0) return 0;
  const a = mn / mx;
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.57079637 - r;
  if (x < 0) r = 3.14159274 - r;
  return y < 0 ? -r : r;
}
