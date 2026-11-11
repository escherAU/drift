// Red Light, Rain: the water on the glass and the wiper that knocks it off. The state is plain data (the water on the glass, the spray
// the blade throws, a grid of which cells hold water and a grid of when each cell was last wiped); the step count and the seed decide
// everything in it. The rain in the air (lib/downpour.js) has no state; the wiper dries the cells it crosses for a moment.
//
//   landing   the downpour lays water on the glass at LAND_RATE a cell a step (about 8 a step at 120x40), placed by a low-discrepancy
//             sequence so it covers the glass evenly; never on the light, its glow and its reflections, nor on a cell the blade has just
//             dried. A drop lives 18 to 33 steps (0.6 to 1.1 s). Because it lands that fast, the glass refills within a second of a sweep.
//   runs      about 1 drop in 4.5 is a runner: it slides down and to the right with the wind, a cell every 3 to 5 steps for 3 to 9 cells,
//             leaving a short trail of ╲ behind it
//   wiper     a cycle of 72 steps (2.4 s): still for 44, then 28 steps (0.93 s) up and back. The arm is a line of ╱ from the pivot, swinging
//             from SREST to STOP columns per row (past upright, to the left). Every cell the blade crosses is dried: the water on it is
//             gone, the rain in the air shows nothing there for 12 to 19 steps, and the blade throws spray off its leading edge
//   spray     short-lived particles (6 to 11 steps) thrown from the blade along its sweep and up: * then x then a degree sign
import { rnd } from '../../../src/scenes/simrng.js';
import { put } from './canvas.js';
import { onGlass, inZone } from './dash.js';
import { ICE } from './palette.js';
import { SLANT, SPARK, refillDelay, shownColour, drawStreaks, makeSlots } from './downpour.js';

const cp = (ch) => ch.codePointAt(0);
export const DROP_GLYPHS = Object.freeze(['·', '°', "'", ','].map(cp));
export const CROSS = cp('×'); // the second beat of the spray
export const DEGREE = cp('°');
const ARM = cp('╱'), ARM_UP = cp('│'), ARM_LEFT = cp('\\'); // the arm leans right, is upright, then leans left at the top (a back slash, not the rain's ╲)

export const CYCLE = 72; // steps: 2.4 s
export const SWEEP_AT = 44; // the blade starts to move at this step of the cycle
export const SWEEP_LEN = 28; // steps: 0.93 s, up and back
export const LAND_RATE = 0.0050; // landings per glass cell per step
export const RUN_SHARE = 0.22; // of the landings that run
export const DROP_TTL = [18, 16]; // lives 18 to 33 steps
export const SPRAY_LIFE = [6, 6]; // 6 to 11 steps
export const SPRAY_PER_STEP = 2; // sprayed off the leading edge each step of a sweep, whatever the blade meets
export const CAP_SHARE = 0.4; // water on the glass never covers more than this share of the glass
export const SPRAY_SHARE = 0.02; // nor the spray more than this share
const PHI1 = 0.7548776662466927, PHI2 = 0.5698402909980532;

export function glassArea(g) {
  let n = 0;
  for (let y = g.gTop; y < g.hoodTop; y++) for (let x = 0; x < g.W; x++) if (onGlass(g, x, y)) n++;
  return n;
}
export const waterCap = (g) => Math.max(40, Math.ceil(CAP_SHARE * glassArea(g)));
export const sprayCap = (g) => Math.max(8, Math.ceil(SPRAY_SHARE * glassArea(g)));

export function rainInit(s, g, maxLen) {
  s.area = glassArea(g);
  s.maxLen = maxLen;
  s.slots = makeSlots(g, s.seed, maxLen, s.area);
  s.drops = []; // the water on the glass: { x, y, kind (0 drop, 1 runner, 2 trail), ttl, gl, wait, rows, step }
  s.spray = []; // { x, y, vx, vy, age, life }
  s.occ = new Uint8Array(g.W * g.H);
  s.wipe = new Int32Array(g.W * g.H).fill(-1000000);
  s.land = 0; // the landing accumulator
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

// The wiper: a line of ╱ from its pivot, leaning right at rest. At the top of the sweep it has passed upright (│) and leans left (a back slash).
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

// ---- the water on the glass

// Is the cell one the parked arm lies on? (Nothing lands or runs there: it would be hidden until the first sweep.)
function underArm(g, x, y) {
  const r = g.py - y;
  return r >= 0 && x === g.px + Math.round(g.sRest * r);
}

// The wire and the crossing's rows are drawn in front of the rain, so nothing lands or runs there.
const onCrossing = (g, y) => y === g.wireRow || (y >= g.pedRow && y <= g.zebraRow);

// May water be on this cell at step n?
function free(s, g, x, y, n) {
  return onGlass(g, x, y) && y < g.hoodTop && !inZone(g, x, y) && !onCrossing(g, y) && !s.occ[y * g.W + x] && !underArm(g, x, y) && n - s.wipe[y * g.W + x] >= refillDelay(s.seed, x, y);
}

function land(s, g, n) {
  const W = g.W, gw = W - 6, gh = g.hoodTop - g.gTop;
  for (let tries = 0; tries < 8; tries++) {
    const k = s.k++;
    const jit = (rnd(s) - 0.5) * 0.02;
    const u = (((s.o0 + k * PHI1 + jit) % 1) + 1) % 1, v = (((s.o1 + k * PHI2) % 1) + 1) % 1;
    const x = 3 + Math.floor(u * gw), y = g.gTop + Math.floor(v * gh);
    if (!free(s, g, x, y, n)) continue;
    const r1 = rnd(s), r2 = rnd(s), r3 = rnd(s), r4 = rnd(s);
    const run = r2 < RUN_SHARE;
    s.drops.push({ x, y, kind: run ? 1 : 0, ttl: DROP_TTL[0] + Math.floor(r1 * DROP_TTL[1]), gl: DROP_GLYPHS[Math.floor(r4 * 4)], wait: run ? 3 + Math.floor(r3 * 3) : 0, rows: run ? 3 + Math.floor(r3 * 7) : 0, step: 0 });
    s.occ[y * W + x] = 1;
    return;
  }
}

function spawnSpray(s, g, x, y, dir) {
  if (s.spray.length >= sprayCap(g)) return;
  const r1 = rnd(s), r2 = rnd(s), r3 = rnd(s);
  s.spray.push({ x, y, vx: dir * (0.45 + 0.5 * r1), vy: -(0.2 + 0.4 * r2), age: 0, life: SPRAY_LIFE[0] + Math.floor(r3 * SPRAY_LIFE[1]) });
}

// Dry the cells between two slopes of the arm: the water on them goes, the rain in the air shows nothing there for a moment,
// and the blade throws spray off its leading edge.
function wipeBand(s, g, lo, hi, n, dir) {
  const W = g.W;
  for (let y = g.gTop; y < g.hoodTop; y++) {
    const dy = g.py - y;
    const xa = Math.max(g.pw[y], Math.floor(g.px + lo * dy - 1)), xb = Math.min(W - 1 - g.pw[y], Math.ceil(g.px + hi * dy + 1));
    for (let x = xa; x <= xb; x++) if (inBand(g, x, y, lo, hi)) s.wipe[y * W + x] = n;
  }
  const hit = [];
  let j = 0;
  for (let i = 0; i < s.drops.length; i++) {
    const d = s.drops[i];
    if (inBand(g, d.x, d.y, lo, hi)) { s.occ[d.y * W + d.x] = 0; hit.push(d); } else s.drops[j++] = d;
  }
  s.drops.length = j;
  for (const d of hit) if (d.kind !== 2 && rnd(s) < 0.8) spawnSpray(s, g, d.x, d.y, dir);
  const s1 = dir < 0 ? lo : hi, rows = Math.floor(g.len / Math.sqrt(s1 * s1 + 4));
  for (let i = 0; i < SPRAY_PER_STEP; i++) {
    const r = 1 + Math.floor(rnd(s) * Math.max(1, Math.min(rows, g.py - g.gTop - 1)));
    const x = g.px + Math.round(s1 * r), y = g.py - r;
    if (onGlass(g, x, y)) spawnSpray(s, g, x, y, dir);
  }
}

export function rainStep(s, g) {
  const n = s.steps, W = g.W;
  const s0 = slopeAt(g, n - 1), s1 = slopeAt(g, n);
  if (s0 !== s1 && !s.noWiper) wipeBand(s, g, Math.min(s0, s1), Math.max(s0, s1), n, s1 < s0 ? -1 : 1);
  // the downpour lands
  s.land += LAND_RATE * s.area;
  while (s.land >= 1) { s.land -= 1; land(s, g, n); }
  // the water ages, and the runners run
  let j = 0;
  const trails = [];
  for (let i = 0; i < s.drops.length; i++) {
    const d = s.drops[i];
    let dead = false;
    if (d.kind === 1) {
      if (--d.wait <= 0) {
        if (d.rows <= 0) { d.kind = 0; d.ttl = 8; }
        else {
          const nx = d.x + (++d.step % 4 === 0 ? 0 : 1), ny = d.y + 1;
          if (nx >= W || !free(s, g, nx, ny, n)) dead = true;
          else {
            trails.push({ x: d.x, y: d.y, kind: 2, ttl: 10 + (d.x * 7 + d.y * 3 + n) % 10, gl: SLANT, wait: 0, rows: 0, step: 0 }); // the cell it leaves stays occupied
            d.x = nx; d.y = ny; d.rows--; d.wait = 3 + (d.x + d.y + n) % 3;
            s.occ[ny * W + nx] = 1;
          }
        }
      }
    } else if (--d.ttl <= 0) dead = true;
    if (dead) s.occ[d.y * W + d.x] = 0; else s.drops[j++] = d;
  }
  s.drops.length = j;
  for (const t of trails) s.drops.push(t);
  const cap = waterCap(g);
  while (s.drops.length > cap) { const d = s.drops.shift(); s.occ[d.y * W + d.x] = 0; }
  // the spray flies
  j = 0;
  for (let i = 0; i < s.spray.length; i++) {
    const p = s.spray[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.05;
    if (++p.age < p.life) s.spray[j++] = p;
  }
  s.spray.length = j;
}

// The water on the glass, then the spray, drawn over the rain in the air.
export function drawRain(cv, s, n) {
  drawStreaks(cv, s, n, put);
  for (const d of s.drops) {
    const col = shownColour(s, d.x, d.y, n, d.kind === 2 ? 0 : 1);
    if (col >= 0) put(cv, d.x, d.y, d.gl, col);
  }
  for (const p of s.spray) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (!onGlass(s.g, x, y)) continue;
    const star = p.age < 3, col = shownColour(s, x, y, n, star ? 2 : 1);
    if (col >= 0) put(cv, x, y, star ? SPARK : p.age < 7 ? CROSS : DEGREE, col);
  }
}

