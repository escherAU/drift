// HUEFIELD: the living colour background the Driftman 9000 visions share (DRIFT-7 C15).
//
//   field(x, y, t, L, seed)  -> 0xRRGGBB = safeHue(hueAt(x, y, t, seed), L)
//   hueAt(x, y, t, seed)     -> the hue in degrees (not wrapped)
//        h = h0(seed) + 90 t + 120 n(x / 40, y / 20, 0.15 t) + 30 sin(0.08 x - 0.05 y + 0.7 t)
//   x is a column and y a row (a half-block pixel row is y = py / 2), t is scene seconds, L is the OKLab lightness you choose and hold.
//
// The hue wheel moves fast and over many hues (about 90 degrees a second, 30 to 160 at any one point), at ONE lightness: every colour goes
// through safeHue (src/pixels.js), whose relative luminance is L cubed whatever the hue and whose red share never passes 0.75. So the fast
// hue is a same-brightness change (free under the flash meter's L3) and never reaches a saturated red. Nothing here makes a colour any
// other way; a scene that wants a bloom or a mix takes hueAt and calls safeHue itself.
//
// n is smooth value noise in -1..1: a periodic lattice of 32 x 32 x 32 seeded values (a table, built once per seed), trilinear with a
// 1024-step smoothstep weight table, so a call is eight table reads and no allocation. The lattice repeats every 32 units, which is 1280
// columns, 640 rows or 213 seconds; the 90 t drift and the sine never repeat, so the field does not either.
//
// Pure in its arguments: the only state is the table cache (keyed by seed, same table every time).
import { safeHue } from '../../../src/pixels.js';

const TAU = Math.PI * 2;

// ---- the sine table: 4096 entries, one turn
export const SINE_N = 4096;
export const SIN = new Float32Array(SINE_N);
for (let i = 0; i < SINE_N; i++) SIN[i] = Math.sin((i * TAU) / SINE_N);
const K = SINE_N / TAU;
export const sin = (x) => SIN[Math.floor(x * K + 0.5) & (SINE_N - 1)]; // nearest entry
export const cos = (x) => SIN[(Math.floor(x * K + 0.5) + (SINE_N >> 2)) & (SINE_N - 1)];

// ---- the weight table: smoothstep over 0..1 in WEIGHT_N steps (WEIGHT_N + 1 entries so that 1 is reachable)
export const WEIGHT_N = 1024;
export const WEIGHT = new Float32Array(WEIGHT_N + 1);
for (let i = 0; i <= WEIGHT_N; i++) { const s = i / WEIGHT_N; WEIGHT[i] = s * s * (3 - 2 * s); }

// ---- the seed

export function hash1(a, b = 0) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The hue the field starts at, 0..360, from the seed.
export const h0Of = (seed) => 360 * hash1(seed, 0x51ed);

// ---- the lattice: LATTICE_N^3 values in -1..1, one table per seed (the last one used is kept in front of a small map)
export const LATTICE_N = 32;
const MASK = LATTICE_N - 1, SHIFT = 5;
const lattices = new Map();
let lastSeed = null, lastLat = null, lastH0 = 0;

function latticeFor(seed) {
  const s = seed | 0;
  if (s === lastSeed) return lastLat;
  let lat = lattices.get(s);
  if (!lat) {
    if (lattices.size >= 12) lattices.clear();
    lat = new Float32Array(LATTICE_N * LATTICE_N * LATTICE_N);
    for (let i = 0; i < lat.length; i++) lat[i] = 2 * hash1(i, s) - 1;
    lattices.set(s, lat);
  }
  lastSeed = s; lastLat = lat; lastH0 = h0Of(s);
  return lat;
}

// Smooth noise in -1..1 at (u, v, w), seeded. The lattice step is 1 in each of u, v, w.
export function noise(u, v, w, seed = 1) {
  const lat = latticeFor(seed);
  const fu = u - Math.floor(u), fv = v - Math.floor(v), fw = w - Math.floor(w);
  const x0 = Math.floor(u) & MASK, y0 = Math.floor(v) & MASK, z0 = Math.floor(w) & MASK;
  const x1 = (x0 + 1) & MASK, y1 = (y0 + 1) & MASK, z1 = (z0 + 1) & MASK;
  const wx = WEIGHT[(fu * WEIGHT_N) | 0], wy = WEIGHT[(fv * WEIGHT_N) | 0], wz = WEIGHT[(fw * WEIGHT_N) | 0];
  const b0 = z0 << (2 * SHIFT), b1 = z1 << (2 * SHIFT), r0 = y0 << SHIFT, r1 = y1 << SHIFT;
  const a00 = lat[b0 | r0 | x0], a10 = lat[b0 | r0 | x1], a01 = lat[b0 | r1 | x0], a11 = lat[b0 | r1 | x1];
  const c00 = lat[b1 | r0 | x0], c10 = lat[b1 | r0 | x1], c01 = lat[b1 | r1 | x0], c11 = lat[b1 | r1 | x1];
  const p0 = a00 + (a10 - a00) * wx, p1 = a01 + (a11 - a01) * wx, q0 = c00 + (c10 - c00) * wx, q1 = c01 + (c11 - c01) * wx;
  const m0 = p0 + (p1 - p0) * wy, m1 = q0 + (q1 - q0) * wy;
  return m0 + (m1 - m0) * wz;
}

// The hue at column x, row y, scene time t. A NaN or infinite argument gives a finite hue.
export function hueAt(x, y, t, seed = 1) {
  const n = noise(x / 40, y / 20, 0.15 * t, seed); // also selects the table (and h0) for this seed
  return lastH0 + 90 * t + 120 * n + 30 * sin(0.08 * x - 0.05 * y + 0.7 * t);
}

// The colour at column x, row y, scene time t, at OKLab lightness L (held by safeHue).
export function field(x, y, t, L, seed = 1) {
  return safeHue(hueAt(x, y, t, seed), L);
}
