// Experimental / pendulum: five double pendula hanging from one pivot at the middle of the
// screen, started a hair apart (0.0015 rad). For a few seconds they swing as one; then the
// chaos shows and they fly apart. The tip of each leaves a trail that fades over about three
// seconds. Rods are box-drawing strokes, the elbow is a ring and the tip a solid disc.
//
// kind 'sim' (fixed 1/30 s step, 8 RK4 substeps each). Units: x in columns, y in half-rows;
// the pivot is the middle of the box and the two rods together are shorter than the distance
// to the nearest edge, so every part is always on screen. Equal masses and rod lengths.
//
// Energy: RK4 at h = 1/240 s conserves the total energy to a tiny relative error even though
// the motion is chaotic (the trajectory itself is not predictable, the energy is). The test
// checks the drift over 10 simulated minutes at three sizes; see pendulumEnergy().
import { rnd, seedState, strokeGlyph } from './simrng.js';

const SUB = 8;
const H = 1 / (30 * SUB);
const N = 5;
const TRAIL = 100; // steps a trail cell lives
const FAMS = [
  [0x28ff, 0x28f6, 0x28e4, 0x2836, 0x2812, 0x2802], // braille
  [0x2588, 0x2593, 0x2592, 0x2591, 0xb7, 0x2e], // blocks
  [0x25c6, 0x25cf, 0x25c7, 0x25cb, 0xb7, 0x2e], // geometric
  [0x3a9, 0x3a3, 0x3bb, 0x2248, 0xb7, 0x2e], // greek and maths
  [0x25a0, 0x25aa, 0x25a1, 0x2261, 0x2d, 0x2e], // squares
];

const K = new Float64Array(16);

// time derivatives of (a1, a2, w1, w2) for a double pendulum, equal masses, angles from straight down
function deriv(a1, a2, w1, w2, g, l1, l2, out, o) {
  const d = a1 - a2;
  const sd = Math.sin(d), cd = Math.cos(d);
  const den = 3 - Math.cos(2 * d);
  out[o] = w1;
  out[o + 1] = w2;
  out[o + 2] = (-3 * g * Math.sin(a1) - g * Math.sin(a1 - 2 * a2) - 2 * sd * (w2 * w2 * l2 + w1 * w1 * l1 * cd)) / (l1 * den);
  out[o + 3] = (2 * sd * (2 * w1 * w1 * l1 + 2 * g * Math.cos(a1) + w2 * w2 * l2 * cd)) / (l2 * den);
}

function rk4(s, q) {
  const { g, l1, l2 } = s;
  const a1 = q.a1, a2 = q.a2, w1 = q.w1, w2 = q.w2;
  deriv(a1, a2, w1, w2, g, l1, l2, K, 0);
  deriv(a1 + 0.5 * H * K[0], a2 + 0.5 * H * K[1], w1 + 0.5 * H * K[2], w2 + 0.5 * H * K[3], g, l1, l2, K, 4);
  deriv(a1 + 0.5 * H * K[4], a2 + 0.5 * H * K[5], w1 + 0.5 * H * K[6], w2 + 0.5 * H * K[7], g, l1, l2, K, 8);
  deriv(a1 + H * K[8], a2 + H * K[9], w1 + H * K[10], w2 + H * K[11], g, l1, l2, K, 12);
  q.a1 += (H / 6) * (K[0] + 2 * K[4] + 2 * K[8] + K[12]);
  q.a2 += (H / 6) * (K[1] + 2 * K[5] + 2 * K[9] + K[13]);
  q.w1 += (H / 6) * (K[2] + 2 * K[6] + 2 * K[10] + K[14]);
  q.w2 += (H / 6) * (K[3] + 2 * K[7] + 2 * K[11] + K[15]);
}

// total energy (kinetic + potential, unit masses) of pendulum q in sim s
export function pendulumEnergy(s, q) {
  const { g, l1, l2 } = s;
  const t = 0.5 * l1 * l1 * q.w1 * q.w1 + 0.5 * (l1 * l1 * q.w1 * q.w1 + l2 * l2 * q.w2 * q.w2 + 2 * l1 * l2 * q.w1 * q.w2 * Math.cos(q.a1 - q.a2));
  const v = -2 * g * l1 * Math.cos(q.a1) - g * l2 * Math.cos(q.a2);
  return t + v;
}

// elbow and tip positions of q
export function pendulumPoints(s, q) {
  const x1 = s.px + s.l1 * Math.sin(q.a1), y1 = s.py + s.l1 * Math.cos(q.a1);
  return { x1, y1, x2: x1 + s.l2 * Math.sin(q.a2), y2: y1 + s.l2 * Math.cos(q.a2) };
}

function init(w, h, seed) {
  const W = w > 0 ? Math.floor(w) : 0, Hh = h > 0 ? Math.floor(h) : 0;
  const reach = Math.min(W / 2, Hh) - 1; // both rods together
  const on = reach >= 3;
  const s = {
    w: W, h: Hh, rs: seedState(seed, 0x1f83d9ab), steps: 0, p: [], px: W / 2, py: Hh, l1: on ? reach / 2 : 0, l2: on ? reach / 2 : 0,
    g: 0, reach: on ? reach : 0,
    stamp: new Int32Array(W * Hh).fill(-1000000), owner: new Uint8Array(W * Hh),
  };
  if (!on) return s;
  s.g = 9 * s.l1; // g / l fixes the swing rate (about 2 s a swing) whatever the size
  const a1 = 1.6 + rnd(s) * 1.3, a2 = 1.7 + rnd(s) * 1.3;
  for (let i = 0; i < N; i++) s.p.push({ a1: a1 + i * 0.0015, a2, w1: 0, w2: 0 });
  return s;
}

function paint(s, i, x, y) {
  const cx = Math.floor(x), cy = Math.floor(y / 2);
  if (cx < 0 || cx >= s.w || cy < 0 || cy >= s.h) return;
  s.stamp[cy * s.w + cx] = s.steps;
  s.owner[cy * s.w + cx] = i;
}

function step(s) {
  if (s.p.length === 0) return;
  s.steps++;
  for (let i = 0; i < s.p.length; i++) {
    const q = s.p[i];
    let last = pendulumPoints(s, q);
    for (let k = 0; k < SUB; k++) {
      rk4(s, q);
      const now = pendulumPoints(s, q);
      const n = Math.max(1, Math.ceil(Math.hypot(now.x2 - last.x2, (now.y2 - last.y2) / 2) / 0.8));
      for (let j = 1; j <= n; j++) paint(s, i, last.x2 + ((now.x2 - last.x2) * j) / n, last.y2 + ((now.y2 - last.y2) * j) / n);
      last = now;
    }
  }
}

function rod(s, g, c, x0, y0, x1, y1, level) {
  const len = Math.hypot(x1 - x0, (y1 - y0) / 2);
  const n = Math.max(2, Math.ceil(len * 1.5));
  const ch = strokeGlyph(x1 - x0, y1 - y0);
  for (let k = 1; k < n; k++) {
    const x = Math.floor(x0 + ((x1 - x0) * k) / n), y = Math.floor((y0 + ((y1 - y0) * k) / n) / 2);
    if (x < 0 || x >= s.w || y < 0 || y >= s.h) continue;
    g[y * s.w + x] = ch;
    c[y * s.w + x] = level;
  }
}

function put(s, g, c, x, y, ch, level) {
  const cx = Math.floor(x), cy = Math.floor(y / 2);
  if (cx < 0 || cx >= s.w || cy < 0 || cy >= s.h) return;
  g[cy * s.w + cx] = ch;
  c[cy * s.w + cx] = level;
}

function draw(s, params) {
  const g = params.glyphs, c = params.colours;
  g.fill(32);
  c.fill(0);
  if (s.p.length === 0) return;
  const n = s.w * s.h;
  for (let i = 0; i < n; i++) {
    const age = s.steps - s.stamp[i];
    if (age < 0 || age >= TRAIL) continue;
    const fam = FAMS[s.owner[i] % FAMS.length];
    g[i] = fam[Math.min(fam.length - 1, Math.floor((age * fam.length) / TRAIL))];
    c[i] = 3 + Math.floor(((TRAIL - age) * 12) / TRAIL);
  }
  for (let i = s.p.length - 1; i >= 0; i--) {
    const q = s.p[i], pt = pendulumPoints(s, q);
    const lvl = i === 0 ? 15 : 6;
    rod(s, g, c, s.px, s.py, pt.x1, pt.y1, lvl);
    rod(s, g, c, pt.x1, pt.y1, pt.x2, pt.y2, lvl);
    put(s, g, c, pt.x1, pt.y1, 0x25ce, lvl);
    put(s, g, c, pt.x2, pt.y2, 0x25cf, i === 0 ? 15 : 9);
  }
  put(s, g, c, s.px, s.py, 0x25cb, 15);
}

export default { id: 'pendulum', kind: 'sim', init, step, draw };
