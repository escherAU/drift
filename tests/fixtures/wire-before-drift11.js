// High contrast / wire: a rotating wireframe, drawn in braille dots (2x4 dots per cell, so
// the dot grid is square). A cube for PHASE_SECONDS, then a torus for PHASE_SECONDS, and
// round again. At each switch the shape shrinks to a point and the next one grows out of it,
// so nothing ever cuts.
//
// Strictly two-tone: colour index 0 only. Every lit cell is a braille glyph (U+2801..U+28FF).
// kind 'cells', pure in t and seed (the seed only sets the starting orientation).
import { seedOf, timeOf, smooth } from './util.js';

export const PHASE_SECONDS = 13;
const GROW = 0.8; // seconds to grow in, and to shrink out
const DIST = 7; // camera distance (the model sits at the origin, radius 1.5)
const REACH = 1.9; // generous bound on the projected radius, for fitting the screen

export function phaseAt(t) {
  const k = Math.floor(timeOf(t) / PHASE_SECONDS);
  return (k % 2 + 2) % 2 === 0 ? 'cube' : 'torus';
}

// ---- models: arrays of closed or open polylines over a shared point table [x, y, z, ...]
const CUBE_HALF = 0.866; // corner radius 1.5
const CUBE_PTS = [];
for (let i = 0; i < 8; i++) CUBE_PTS.push((i & 1 ? 1 : -1) * CUBE_HALF, (i & 2 ? 1 : -1) * CUBE_HALF, (i & 4 ? 1 : -1) * CUBE_HALF);
const CUBE_LINES = [];
for (let i = 0; i < 8; i++) for (let b = 1; b <= 4; b <<= 1) if (!(i & b)) CUBE_LINES.push([i, i | b]);

const TORUS_R = 1.05, TORUS_r = 0.45;
const SECTIONS = 16, SECTION_PTS = 12, RINGS = 6, RING_PTS = 64;
const TORUS_PTS = [];
const TORUS_LINES = []; // each is a list of point indexes, closed by repeating the first
function torusPoint(u, v) {
  const rr = TORUS_R + TORUS_r * Math.cos(v);
  TORUS_PTS.push(rr * Math.cos(u), TORUS_r * Math.sin(v), rr * Math.sin(u));
  return TORUS_PTS.length / 3 - 1;
}
for (let i = 0; i < SECTIONS; i++) {
  const line = [];
  for (let j = 0; j < SECTION_PTS; j++) line.push(torusPoint((i / SECTIONS) * Math.PI * 2, (j / SECTION_PTS) * Math.PI * 2));
  line.push(line[0]);
  TORUS_LINES.push(line);
}
for (let k = 0; k < RINGS; k++) {
  const line = [];
  for (let m = 0; m < RING_PTS; m++) line.push(torusPoint((m / RING_PTS) * Math.PI * 2, (k / RINGS) * Math.PI * 2));
  line.push(line[0]);
  TORUS_LINES.push(line);
}

const BITS = [1, 2, 4, 64, 8, 16, 32, 128]; // [(x & 1) * 4 + (y & 3)]
const SCRATCH = new Float64Array(TORUS_PTS.length / 3 * 2 + 16);

function plot(g, W, Wd, Hd, x, y) {
  if (x < 0 || y < 0 || x >= Wd || y >= Hd) return;
  const i = (y >> 2) * W + (x >> 1);
  g[i] = (g[i] === 32 ? 0x2800 : g[i]) | BITS[(x & 1) * 4 + (y & 3)];
}

function line(g, W, Wd, Hd, x0, y0, x1, y1) {
  let x = Math.round(x0), y = Math.round(y0);
  const xe = Math.round(x1), ye = Math.round(y1);
  const dx = Math.abs(xe - x), dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1, sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 4096; n++) {
    plot(g, W, Wd, Hd, x, y);
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

export default function wire(t, w, h, params) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const g = params.glyphs, col = params.colours;
  g.fill(32);
  col.fill(0);
  if (W === 0 || H === 0) return;
  const T = timeOf(t), s = seedOf(params);
  const local = T - PHASE_SECONDS * Math.floor(T / PHASE_SECONDS);
  const grow = Math.min(smooth(Math.min(1, local / GROW)), smooth(Math.min(1, (PHASE_SECONDS - local) / GROW)));
  if (grow < 0.03) return;
  const cube = phaseAt(T) === 'cube';
  const Wd = W * 2, Hd = H * 4;
  const S = (0.5 * 0.92 * Math.min(Wd, Hd) / REACH) * grow;
  const off = s * 1.3;
  const ax = (cube ? 0.43 : 0.31) * T + off + (cube ? 0 : 1.1);
  const ay = (cube ? 0.66 : 0.52) * T + off * 0.7;
  const az = 0.19 * T + off * 0.3;
  const ca = Math.cos(ax), sa = Math.sin(ax), cb = Math.cos(ay), sb = Math.sin(ay), cc = Math.cos(az), sc = Math.sin(az);
  // R = Rz * Ry * Rx
  const m00 = cc * cb, m01 = cc * sb * sa - sc * ca, m02 = cc * sb * ca + sc * sa;
  const m10 = sc * cb, m11 = sc * sb * sa + cc * ca, m12 = sc * sb * ca - cc * sa;
  const m20 = -sb, m21 = cb * sa, m22 = cb * ca;
  const pts = cube ? CUBE_PTS : TORUS_PTS;
  const n = pts.length / 3;
  const P = n * 2 <= SCRATCH.length ? SCRATCH : new Float64Array(n * 2);
  const cx = Wd / 2, cy = Hd / 2;
  for (let i = 0; i < n; i++) {
    const x = pts[3 * i], y = pts[3 * i + 1], z = pts[3 * i + 2];
    const X = m00 * x + m01 * y + m02 * z, Y = m10 * x + m11 * y + m12 * z, Z = m20 * x + m21 * y + m22 * z;
    const f = DIST / (DIST + Z);
    P[2 * i] = cx + X * f * S;
    P[2 * i + 1] = cy - Y * f * S;
  }
  if (cube) {
    // two dots wide, so the few lines of the cube read as solid strokes
    for (const [a, b] of CUBE_LINES) {
      line(g, W, Wd, Hd, P[2 * a], P[2 * a + 1], P[2 * b], P[2 * b + 1]);
      line(g, W, Wd, Hd, P[2 * a] + 1, P[2 * a + 1], P[2 * b] + 1, P[2 * b + 1]);
    }
  } else {
    for (const ln of TORUS_LINES) {
      for (let i = 1; i < ln.length; i++) {
        const a = ln[i - 1], b = ln[i];
        line(g, W, Wd, Hd, P[2 * a], P[2 * a + 1], P[2 * b], P[2 * b + 1]);
      }
    }
  }
}
wire.id = 'wire';
wire.kind = 'cells';
