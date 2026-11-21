// High contrast / wire: a rotating wireframe, drawn in braille dots (2x4 dots per cell, so
// the dot grid is square). A cube for PHASE_SECONDS, then a torus for PHASE_SECONDS, and
// round again. At each switch the shape shrinks to a point and the next one grows out of it,
// so nothing ever cuts.
//
// Strictly two-tone: colour index 0 only. Every lit cell is a braille glyph (U+2801..U+28FF).
//
// DRIFT-11, the flash rules. `ideal(t, w, h, params)` below is the picture as it was (pure in t and seed; the seed only sets the starting orientation) and is what the
// scene WANTS on the screen. The scene is a sim (kind 'sim', stepped from the real-time clock: realClock, src/cells.js): it computes that picture once every 0.6 s (a beat) as its
// target and DRAWS a copy that follows it under the limits of src/scenes/follow.js (a cell changes at most once every 0.6 s, so no cell changes three times in a second;
// and a share of the cells a step and a share a painted frame). The beat alone also keeps a cell to one change per 0.6 s; the gap is what holds if a deferred cell is late. Every line that sweeps over a cell would otherwise flip it on and off each pass: 22 polylines on the torus
// (L1 40.7 %, L2 98.6 % of the screen's fields on the old scene). What it looks like now: the shape still turns, but in steps: a clean new pose every beat (the follower takes about 0.4 s to put it on the screen, the pose
// settles cell for cell), so it reads as a ratchet, not a smooth spin. ROTATION scales the turning rate down to half, so a step is a small turn (5 to 11 degrees an axis).
// (A continuous picture with the follower alone, a target every 0.1 s, was measured and smears: a moving edge leaves a half-second trail of stale dots.)
import { seedOf, timeOf, smooth } from './util.js';
import { createFollow, follow } from './follow.js';

export const PHASE_SECONDS = 13;
const GROW = 0.8; // seconds to grow in, and to shrink out
const DIST = 7; // camera distance (the model sits at the origin, radius 1.5)
const ROTATION = 0.5; // the turning rate as a share of the old scene's: the pose changes by half as much from one beat to the next
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

export function ideal(t, w, h, params) {
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
  const ax = (cube ? 0.43 : 0.31) * T * ROTATION + off + (cube ? 0 : 1.1);
  const ay = (cube ? 0.66 : 0.52) * T * ROTATION + off * 0.7;
  const az = 0.19 * T * ROTATION + off * 0.3;
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

// ---- the sim: the target (ideal, once a beat) and the shown picture that follows it
const SUBSTEPS = 18; // sim steps per beat (0.6 s): the ideal picture is worked out once a beat, so a cell is asked to change at most once every 0.6 s by the picture itself
const BEAT_AT = 6; // the beat falls at steps 6, 24, 42, ... (not at multiples of 18): a still taken on a whole second (renderScene, the captures at 3 s and 12 s) is 12 steps after a beat, with the picture settled
const STEP_HZ = 30;

function init(w, h, seed) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const s = { w: W, h: H, seed: seed | 0, sub: 0, F: createFollow(W, H), params: null, targets: 0 };
  s.params = { seed: s.seed, glyphs: s.F.target, colours: new Uint8Array(W * H) };
  retarget(s);
  s.F.shown.set(s.F.target); // the first picture is what the target shows at t = 0: nothing is waiting
  s.F.dirty = false;
  return s;
}

function retarget(s) {
  if (s.w === 0 || s.h === 0) return;
  ideal(s.sub / STEP_HZ, s.w, s.h, s.params); // fills F.target in full
  s.targets++;
  s.F.dirty = true;
}

// n: the number of steps the composer runs for this painted frame (src/cells.js), 1 when the caller gives none (renderScene, a test)
function step(s, n = 1) {
  s.sub++;
  if (s.w === 0 || s.h === 0) return;
  if (s.sub % SUBSTEPS === BEAT_AT % SUBSTEPS) retarget(s);
  follow(s.F, s.sub, n);
}

function draw(s, params) {
  params.glyphs.set(s.F.shown);
  params.colours.fill(0);
}

export default { id: 'wire', kind: 'sim', realClock: true, init, step, draw };
ideal.id = 'wire-ideal'; // renderScene(ideal, ...) is the picture the scene wants at t (a pure 'cells' scene), which the tests of the look read
ideal.kind = 'cells';
