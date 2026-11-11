// Red Light, Rain: the drops on the glass and the wiper that clears them. The state is plain data (a list of drops and a grid of which
// cells hold one); the sim's step count and seed decide everything in it.
//
//   landing   a drop every 2 to 7 steps, 4.25 on average (about 6.7 a second), placed by a low-discrepancy sequence so the rain covers the glass evenly
//             (a rejected cell is skipped), never on the light, its glow and its reflections
//   life      a drop stays 14 to 22 s, unless the wiper takes it first
//   trickle   about 3 in 10 drops send a trickle down 0.1 to 0.7 s after landing: a ╎ under the drop that steps down a row every 0.5 to 1.5 s
//             for 2 to 6 rows and is gone (the drop stays)
//   wiper     a cycle of 126 steps (4.2 s): still for 90, then 36 steps (1.2 s) up and back. The arm is a line of ╱ from the pivot,
//             swinging from SREST to STOP columns per row (past upright, to the left); every drop the line crosses is cleared
import { rnd } from '../../../src/scenes/simrng.js';
import { put } from './canvas.js';
import { onGlass, inZone } from './dash.js';
import { ICE } from './palette.js';

const cp = (ch) => ch.codePointAt(0);
const DROP_GLYPHS = Object.freeze(['·', '°', "'", ','].map(cp));
const TRICKLE = cp('╎');
const ARM = cp('╱'), ARM_UP = cp('│'), ARM_LEFT = cp('╲');

export const CYCLE = 126;
export const SWEEP_AT = 90;
export const SWEEP_LEN = 36;
export const MAX_DROPS = 400;
const PHI1 = 0.7548776662466927, PHI2 = 0.5698402909980532;

export function rainInit(s, g) {
  s.drops = [];
  s.occ = new Uint8Array(g.W * g.H);
  s.nextLand = 6;
  s.k = 0;
  s.o0 = rnd(s);
  s.o1 = rnd(s);
}

// ---- the wiper

// The arm's slope (columns per row) at step n.
export function slopeAt(g, n) {
  const c = n < 0 ? 0 : n % CYCLE;
  if (c <= SWEEP_AT) return g.sRest;
  const p = c - SWEEP_AT;
  const tri = p < SWEEP_LEN / 2 ? p / (SWEEP_LEN / 2) : (SWEEP_LEN - p) / (SWEEP_LEN / 2);
  if (tri <= 0) return g.sRest;
  const a0 = Math.atan2(2, g.sRest), a1 = Math.atan2(2, g.sTop);
  return 2 / Math.tan(a0 + (a1 - a0) * tri);
}

// Is the cell inside the area the arm sweeps (the wedge between its two end slopes, as far as it reaches)?
export function inBand(g, x, y, lo = g.sTop, hi = g.sRest) {
  const dy = g.py - y;
  if (dy <= 0) return false;
  const dx = x - g.px, sd = dx / dy, tol = 0.5 / dy;
  return sd >= lo - tol && sd <= hi + tol && dx * dx + 4 * dy * dy <= g.len * g.len;
}

// The arm reaches the glass and the dashboard's top rows between the pillars, but not the light and its street.
function onArm(g, x, y) {
  if (inZone(g, x, y)) return false;
  return onGlass(g, x, y) || (y >= g.hoodTop && y < g.py && x >= g.pw[g.hoodTop] && x < g.W - g.pw[g.hoodTop]);
}

// The wiper: a line of ╱ from its pivot, leaning right at rest. At the top of the sweep it has passed upright (│) and leans left (╲).
export function drawWiper(cv, g, n) {
  const s = slopeAt(g, n);
  put(cv, g.px, g.py, ARM, ICE[0]);
  const glyph = s > 0.5 ? ARM : s >= -0.5 ? ARM_UP : ARM_LEFT;
  const rows = Math.floor(g.len / Math.sqrt(s * s + 4));
  for (let r = 1; r <= rows; r++) {
    const x = g.px + Math.round(s * r), y = g.py - r;
    if (onArm(g, x, y)) put(cv, x, y, glyph, ICE[0]);
  }
}

// ---- the drops

// Is the cell one the parked arm lies on? (Nothing lands or runs there: it would be hidden until the first sweep.)
function underArm(g, x, y) {
  const r = g.py - y;
  return r >= 0 && x === g.px + Math.round(g.sRest * r);
}

// The wire and the crossing's rows are drawn in front of the rain, so nothing lands or runs there.
const onCrossing = (g, y) => y === g.wireRow || (y >= g.pedRow && y <= g.zebraRow);

function land(s, g) {
  const W = g.W, gw = W - 6, gh = g.hoodTop - g.gTop;
  for (let tries = 0; tries < 12; tries++) {
    const k = s.k++;
    const jit = (rnd(s) - 0.5) * 0.02;
    const u = (((s.o0 + k * PHI1 + jit) % 1) + 1) % 1, v = (((s.o1 + k * PHI2) % 1) + 1) % 1;
    const x = 3 + Math.floor(u * gw), y = g.gTop + Math.floor(v * gh);
    if (!onGlass(g, x, y) || inZone(g, x, y) || onCrossing(g, y) || s.occ[y * W + x] || underArm(g, x, y)) continue;
    const r1 = rnd(s), r2 = rnd(s), r3 = rnd(s), r4 = rnd(s);
    s.drops.push({ x, y, ttl: 420 + Math.floor(r1 * 240), tr: r2 < 0.32 ? 3 + Math.floor(r3 * 18) : -1, t: 0, wait: 0, rows: 0, gl: DROP_GLYPHS[Math.floor(r4 * 4)] });
    s.occ[y * W + x] = 1;
    return;
  }
}

export function rainStep(s, g) {
  const n = s.steps, W = g.W;
  if (n >= s.nextLand) { land(s, g); s.nextLand = n + 2 + Math.floor(rnd(s) * 5) + (rnd(s) < 0.25 ? 1 : 0); }
  const s0 = slopeAt(g, n - 1), s1 = slopeAt(g, n);
  const sweeping = s0 !== s1, lo = Math.min(s0, s1), hi = Math.max(s0, s1);
  let j = 0;
  const born = [];
  for (let i = 0; i < s.drops.length; i++) {
    const d = s.drops[i];
    let dead = false;
    if (d.t) {
      if (--d.wait <= 0) {
        if (d.rows <= 0) dead = true;
        else {
          const ny = d.y + 1;
          s.occ[d.y * W + d.x] = 0;
          if (ny >= g.hoodTop || inZone(g, d.x, ny) || onCrossing(g, ny) || !onGlass(g, d.x, ny) || s.occ[ny * W + d.x] || underArm(g, d.x, ny)) dead = true;
          else { d.y = ny; s.occ[ny * W + d.x] = 1; d.rows--; d.wait = 15 + Math.floor(rnd(s) * 31); }
        }
      }
    } else {
      d.ttl--;
      if (d.tr > 0 && --d.tr === 0) born.push(d); // a trickle starts to run from this drop, which stays where it is
      if (d.ttl <= 0) dead = true;
    }
    if (!dead && sweeping && inBand(g, d.x, d.y, lo, hi)) dead = true;
    if (dead) { s.occ[d.y * W + d.x] = 0; d.ttl = -1; } else s.drops[j++] = d;
  }
  s.drops.length = j;
  for (const d of born) { // a new trickle, one row under its drop, if that cell is free glass
    const ny = d.y + 1;
    if (d.ttl < 0 || ny >= g.hoodTop || inZone(g, d.x, ny) || onCrossing(g, ny) || !onGlass(g, d.x, ny) || s.occ[ny * W + d.x] || underArm(g, d.x, ny)) continue;
    const wait = 15 + Math.floor(rnd(s) * 31), rows = 2 + Math.floor(rnd(s) * 5);
    s.drops.push({ x: d.x, y: ny, ttl: 0, tr: -1, t: 1, wait, rows, gl: 0 });
    s.occ[ny * W + d.x] = 1;
  }
  while (s.drops.length > MAX_DROPS) { const d = s.drops.shift(); s.occ[d.y * W + d.x] = 0; }
}

export function drawRain(cv, s) {
  for (const d of s.drops) put(cv, d.x, d.y, d.t ? TRICKLE : d.gl, d.t ? ICE[0] : ICE[1]);
}
