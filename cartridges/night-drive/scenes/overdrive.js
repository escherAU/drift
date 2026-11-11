// B4. Overdrive: the highway, a tunnel with rings of light, and the way out onto an elevated freeway with the city on both sides. A
// simulation (kind 'sim') because light trails are born, run their course and fade away.
//
//   0-15 s    approach   A1's road at double pace under stars; a tunnel mouth (┏━┓┃┗┛ in far silhouette) grows from the vanishing point
//                        and eats the scenery as it passes over it
//   15-60 s   the tunnel nested rings in violet.1 in perspective, a ceiling light (━ in tang.3, 1 to 4 cells, longer on the rings
//                        nearer to us) on each, tail lights (coral.3 ●) running away from us and headlights (ice.3 ●) coming toward us on
//                        the left, each with a trail of 4 to 10 cells fading from shade 3 to 0; our car (20x4) at the bottom
//   60-66 s   the exit   the far end opens: the city is revealed inside the end rectangle by a per-cell dissolve from the centre
//                        outward over 2 s, then the tunnel dissolves away the same way and the road and the skyline come back
//   66-90 s   freeway    the city on both sides of the road, one trail about every 2 s, the pace easing from double to A1's by 90 s
//
// THE GUARD (Ingrid's rule). How many cells change in a frame is a function of STEP COUNT and of the window size given to init, never of
// what the last frame did. A frame holds at most 8 steps (src/cells.js), so the ring schedule is built on RING SLOTS: one every
// `slotGap` steps, at most `ringBudget(w, h)` in any 8 consecutive steps, and each slot moves ONE ring one level. The rings are spaced
// `g` levels apart on a cycle of C levels, so no two ever share a level, and only the levels whose redraw is cheap enough for the window
// are moving ones: the big rings near the frame are still, drawn once (they dissolve in over 15 to 18 s; the rings that move are born at
// 18 s, when the mouth has gone, so a far-silhouette ring and a violet one never share a cell). The mouth stops growing at the level
// where one more step would change more than MOUTH_CAP of the window. The light trails are held back the same way: a new one is born
// only on a spawn slot (`spawnAllowed`), never on a ring slot, at most one per step. `ringLimit: false` is the control that proves the
// guard: it switches the schedule off (every ring moves on every step) and the share of changed cells goes through the bound.
//
// The sim's clock is its step count (30 a second): a picture is a function of (size, seed, steps), draw never changes the state, nothing
// depends on the end of the 90 s (the freeway carries on for as long as it is stepped, and the state is bounded). The background is never
// drawn: a blank cell is a space in colour 0. Colours only through lib/palette.js.
import { seedState, rnd } from '../../../src/scenes/simrng.js';
import { rand } from '../../../src/scenes/util.js';
import { canvas, clear, put } from '../lib/canvas.js';
import { hash } from '../lib/hash.js';
import { geometry as roadGeometry, edgeL, edgeR, laneX, dashRow, DASH_COUNT } from '../lib/road.js';
import { drawRear20, REAR_20_W, REAR_20_H } from '../lib/sprites.js';
import { skylineCells } from '../lib/skyline.js';
import { SUN, TANG, CORAL, MAG, CYAN, VIOLET, ICE, FAR, NEAR } from '../lib/palette.js';

// Breakpoints, widest first; a window gets the first layout it is at least as big as.
//   rings      most rings drawn at once (the moving ones and the still ones, the tunnel mouth counted)
//   moving     most of those that move
//   particles  most light trails alive at once (a trail still fading counts)
//   rays       the lanes the trails run along, as a share of the road's half-width at each row (negative = left = headlights)
//   slotGap    steps between ring slots; ringCap the share of the window one ring move may change at most
//   spawnEvery steps between spawn slots in the tunnel
export const LAYOUTS = Object.freeze([
  Object.freeze({ name: 'full', minCols: 100, minRows: 32, rings: 7, moving: 4, particles: 12, rays: Object.freeze([-0.8, 0.8, -0.45, 0.45]), car: 'rear20', slotGap: 4, ringCap: 0.05, streaks: true, spawnEvery: 14 }),
  Object.freeze({ name: 'mid', minCols: 60, minRows: 18, rings: 4, moving: 2, particles: 6, rays: Object.freeze([-0.65, 0.75, 0.4]), car: 'rear20', slotGap: 8, ringCap: 0.115, streaks: true, spawnEvery: 24 }),
  Object.freeze({ name: 'small', minCols: 0, minRows: 0, rings: 2, moving: 1, particles: 3, rays: Object.freeze([-0.6, 0.6]), car: 'rear20', slotGap: 8, ringCap: 0.15, streaks: false, spawnEvery: 40 }),
]);
export function layoutFor(w, h) {
  return LAYOUTS.find((l) => w >= l.minCols && h >= l.minRows) || LAYOUTS[LAYOUTS.length - 1];
}

// ---- the timeline, in steps (30 a second)
export const T_TUNNEL = 450; // 15 s: the mouth has grown over the scenery, the rings begin
export const T_RINGS = 550; // the mouth has dissolved away (by step 540); the rings that move are born from here
export const T_EXIT = 1800; // 60 s: the far end opens
export const T_REVEAL = 60; // 2 s: the city inside the end rectangle
export const T_FREE = 1980; // 66 s: the freeway
export const T_EASE = 2700; // 90 s: the pace is back to A1's
const TRAIL_AGE = 8; // steps for a trail cell to drop one shade: 4 shades in 32 steps, so even at 4x a cell never drops two in a frame
const MINGAP = 40; // steps between two trails born on the same lane: the older one has faded off the start cell
const MOUTH_CAP = 0.12; // the most of the window one step of the growing mouth may change; the mouth stops growing at the level where that runs out
const MIN_W = 30, MIN_H = 9; // under this the window is too small for a picture and stays blank

const cp = (ch) => ch.codePointAt(0);
const G = { tl: cp('┏'), tr: cp('┓'), bl: cp('┗'), br: cp('┛'), h: cp('━'), v: cp('┃'), dot: cp('·'), dash: cp('│'), head: cp('●'), under: cp('▁'), wall: cp('█'), edgeL: cp('╱'), edgeR: cp('╲'), flat: cp('─') };
const dims = (w, h) => [w > 0 ? Math.floor(w) : 0, h > 0 ? Math.floor(h) : 0];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function perimeter(r) {
  return 2 * ((r.x1 - r.x0 + 1) + (r.y1 - r.y0 + 1)) - 4;
}

// ---- the rings: rect(level), level 1 (a small box at the vanishing point) to K (against the frame)
function buildRects(W, vy, cxf, A, Bup, Bdn, streaks) {
  const S = streaks ? Bup : Math.max(Bup, Math.floor(A / 2));
  const rects = [];
  for (let k = 1; k <= S; k++) {
    const s = k / S;
    const x0 = Math.round(cxf - A * s);
    const r = { x0, x1: W - 1 - x0, y0: vy - (streaks ? k : Math.max(1, Math.round(Bup * s))), y1: vy + Math.max(1, Math.round(Bdn * s)) };
    const prev = rects[rects.length - 1];
    if (prev && prev.x0 === r.x0 && prev.y0 === r.y0 && prev.y1 === r.y1) continue;
    rects.push(r);
  }
  return rects;
}

// ---- the lanes the light trails run along: cells from the vanishing point toward us, each with the glyph it draws
function buildRays(W, H, rg, inset, L) {
  const vy = rg.horizon, rEnd = H - 2;
  const avoid = new Set(); // the road edges (╱ ╲) and the cells next to them: a trail is never confused with an edge
  for (let r = vy + 1; r <= rEnd; r++) for (const e of [edgeL(rg, r), edgeR(rg, r)]) for (let d = -1; d <= 1; d++) avoid.add(e + d + ',' + r);
  const taken = new Set();
  const rays = [];
  for (const f of L.rays) {
    let cells = [];
    let prevX = null;
    const dir = f < 0 ? -1 : 1;
    for (let r = vy + (rg.below >= 12 ? 3 : 1); r <= rEnd; r++) {
      const half = (edgeR(rg, r) - edgeL(rg, r)) / 2;
      const xr = Math.round(rg.cx + f * half);
      const run = [];
      if (prevX === null || (xr - prevX) * dir <= 0) run.push(xr);
      else for (let x = prevX + dir; x !== xr + dir; x += dir) run.push(x);
      prevX = xr;
      run.forEach((x, i) => {
        if (x < inset || x > W - 1 - inset) { cells = []; return; }
        const key = x + ',' + r;
        if (avoid.has(key) || taken.has(key)) { cells = []; return; }
        cells.push({ x, y: r, g: i === run.length - 1 ? (dir < 0 ? G.edgeL : G.edgeR) : G.flat });
      });
    }
    if (cells.length < 6) continue;
    for (const c of cells) taken.add(c.x + ',' + c.y);
    const len = cells.length;
    const mv = clamp(Math.round(84 / len), 3, 6);
    const travel = Math.min(len, Math.floor(84 / mv));
    rays.push({ dir: f < 0 ? 1 : -1, mv, travel, win0: len - travel, cells });
  }
  return rays;
}

// Everything that depends only on the window size (plain numbers and arrays, so a sim can keep it in its state).
export function planOf(w, h, withRays = true) {
  const [W, H] = dims(w, h);
  const L = layoutFor(W, H);
  const p = { W, H, ok: W >= MIN_W && H >= MIN_H, layout: L.name, slotGap: L.slotGap, spawnEvery: L.spawnEvery, cap: L.particles, K: 0, Mm: 0, R: 0, g: 0, C: 0, RC: 0, gC: 0, CC: 0, statics: [], rects: [], rays: [] };
  if (!p.ok) return p;
  const rg = roadGeometry(W, H);
  const vy = rg.horizon, inset = W >= 100 ? 2 : 1, cxf = (W - 1) / 2;
  const A = cxf - inset, Bup = vy - 1, Bdn = H - 2 - vy;
  Object.assign(p, { vy, inset, cxf, A, Bup, Bdn, streaks: L.streaks });
  p.rects = buildRects(W, vy, cxf, A, Bup, Bdn, L.streaks);
  p.K = p.rects.length;
  p.Mm = 1;
  while (p.Mm < p.K && perimeter(p.rects[p.Mm - 1]) + perimeter(p.rects[p.Mm]) <= MOUTH_CAP * W * H) p.Mm++;
  // the moving levels: the highest m for which every move up to it (and the wrap from m back to 1) changes no more than ringCap of the window
  const cap = L.ringCap * W * H;
  const per = p.rects.map(perimeter);
  let m = 1;
  while (m + 1 <= Math.floor(0.8 * p.K) && per[m - 1] + per[m] <= cap && per[m] + per[0] <= cap) m++;
  const R = m >= 2 ? Math.min(L.moving, Math.floor(m / 2)) : 0;
  if (R >= 1) { p.R = R; p.g = Math.floor(m / R); p.C = R * p.g; }
  // the control (ringLimit: false) has no cost cap and no limit on the ring count: every ring of the layout roams every level, moving a level on every step
  p.RC = Math.max(1, L.rings);
  p.gC = 5;
  p.CC = p.K;
  // the still rings: the tunnel mouth at level K, and a ring every second level below it, but never touching the moving ones
  p.statics = [p.K];
  for (let lv = p.K - 2; p.statics.length < Math.max(1, L.rings - p.R) && lv > p.C + 1; lv -= 2) p.statics.unshift(lv);
  if (withRays) p.rays = buildRays(W, H, rg, inset, L);
  p.end = p.rects[p.statics[0] - 1];
  // the distance of the far corner from the centre, in end-rectangle units (for the dissolve outward)
  p.dMax = Math.max(1.0001, endDist(p, inset, 1), endDist(p, W - 1 - inset, H - 2), endDist(p, inset, H - 2), endDist(p, W - 1 - inset, 1));
  return p;
}

// ---- distance from the centre, in two systems
// The end rectangle: 1 on its outline, less inside, more outside. The exit dissolves outward in these units.
function endDist(p, x, y) {
  const e = p.end;
  const dx = Math.abs(x - p.cxf) / ((e.x1 - e.x0 + 1) / 2);
  const dy = y < p.vy ? (p.vy - y) / Math.max(1, p.vy - e.y0) : (y - p.vy) / Math.max(1, e.y1 - p.vy);
  return Math.max(dx, dy);
}
// The frame: 0 at the vanishing point, 1 at the edge of the window. The mouth and the still rings dissolve in by it.
function frameDist(p, x, y) {
  const dx = Math.abs(x - p.cxf) / p.A;
  const dy = y < p.vy ? (p.vy - y) / p.Bup : (y - p.vy) / p.Bdn;
  return Math.min(1, Math.max(dx, dy));
}
// a fixed number in [-0.5, 0.5) for a cell: what keeps a whole ring (all at one distance) from changing in a single step
const spread = (x, y, seed) => (hash(x, y, seed) % 4096) / 4096 - 0.5;

// When the scenery in a cell is eaten by the mouth (steps), and when it comes back / the tunnel in that cell goes (steps).
function eatenAt(p, x, y, seed) {
  const u = (frameDist(p, x, y) * p.K) / p.Mm;
  return u <= 1 ? Math.round(T_TUNNEL * Math.sqrt(u) + 12 * spread(x, y, seed)) : appearAt(p, x, y, seed);
}
function backAt(p, x, y, seed) {
  const d = endDist(p, x, y);
  const sp = spread(x, y, seed);
  const slow = T_FREE - T_EXIT - T_REVEAL;
  const t = d <= 1 ? T_EXIT + T_REVEAL * d + 0.2 * T_REVEAL * sp : T_EXIT + T_REVEAL + slow * Math.min(1, (d - 1) / (p.dMax - 1)) + 0.2 * slow * sp;
  return Math.max(T_EXIT, Math.round(t));
}
function appearAt(p, x, y, seed) {
  return T_TUNNEL + Math.round(90 * (0.3 * frameDist(p, x, y) + 0.7 * (spread(x, y, seed) + 0.5)));
}

// ---- the schedule: pure functions of (step, w, h)

// The mouth's level (1 to K) after the last ring slot at or before `step`: it grows slowly at first and faster as it nears.
function mouthLevel(p, step) {
  const m = Math.floor(Math.max(0, step) / p.slotGap) * p.slotGap;
  const u = Math.min(1, m / (T_TUNNEL - p.slotGap));
  return Math.min(p.Mm, 1 + Math.floor((p.Mm - 1) * u * u));
}
const slotsDone = (p, n) => Math.floor(n / p.slotGap) - Math.floor(T_RINGS / p.slotGap);

// The level (0 = not there yet) of moving ring r at step n. `limited`: one ring per ring slot; otherwise every ring moves every step.
function ringLevel(p, r, n, limited) {
  if (n <= T_RINGS || (limited && p.R === 0)) return 0;
  const nn = Math.min(n, T_EXIT);
  let d;
  if (limited) {
    const m = slotsDone(p, nn);
    d = m - 1 - r < 0 ? 0 : Math.floor((m - 1 - r) / p.R) + 1 - r * p.g;
  } else d = nn - T_RINGS - r * p.gC;
  return d <= 0 ? 0 : ((d - 1) % (limited ? p.C : p.CC)) + 1;
}

// How many ring moves happen on step n (the mouth growing in the approach, the rings in the tunnel).
function movesAt(p, n, limited) {
  if (!p.ok || n < 1) return 0;
  let m = 0;
  if (n <= T_TUNNEL) {
    if (n % p.slotGap === 0 && mouthLevel(p, n) > mouthLevel(p, n - 1)) m++;
  } else if (n > T_RINGS && n <= T_EXIT && (limited ? p.R > 0 : p.RC > 0)) {
    if (limited) {
      if (n % p.slotGap === 0) {
        const i = slotsDone(p, n) - 1;
        if (Math.floor(i / p.R) >= (i % p.R) * p.g) m++;
      }
    } else for (let r = 0; r < p.RC; r++) if (n - T_RINGS - r * p.gC >= 1) m++;
  }
  return m;
}

// Ring moves scheduled on steps step0 + 1 .. step0 + n.
export function movesInWindow(step0, n, w, h) {
  const p = planOf(w, h, false);
  let m = 0;
  for (let k = 1; k <= n; k++) m += movesAt(p, step0 + k, true);
  return m;
}
// The most ring moves allowed in any 8 consecutive steps (8 is the most the engine ever runs in one frame).
export function ringBudget(w, h) {
  const p = planOf(w, h, false);
  return p.ok ? Math.ceil(8 / p.slotGap) : 0;
}
// Is a new light trail allowed to be born on this step? Never on a ring slot; in the tunnel on every spawnEvery-th step, after the exit on
// every 60th (about one every 2 s).
export function spawnAllowed(step, w, h) {
  return spawnSlot(planOf(w, h, false), step);
}
function spawnSlot(p, n) {
  if (!p.ok || n <= T_TUNNEL) return false;
  if (n % p.slotGap === 0) return false;
  return n <= T_EXIT ? n % p.spawnEvery === 1 : n % 60 === 1;
}

// The dashes' pace, in steps of A1's clock: double until the freeway, then easing to 1 by 90 s and staying there.
export function dashClock(n) {
  if (n <= T_FREE) return 2 * n;
  const e = n - T_FREE, span = T_EASE - T_FREE;
  if (n <= T_EASE) return 2 * T_FREE + 2 * e - (e * e) / (2 * span);
  return 2 * T_FREE + 2 * span - span / 2 + (n - T_EASE);
}

// ---- the sim
function makeInit(limited) {
  return function init(w, h, seed) {
    const [W, H] = dims(w, h);
    const sd = Number.isFinite(seed) ? seed | 0 : 1;
    const s = { w: W, h: H, seed: sd, rs: seedState(seed, 0x0d21e), steps: 0, ok: W >= MIN_W && H >= MIN_H, limited, spawned: 0, parts: [], last: [] };
    if (!s.ok) return s;
    const p = planOf(W, H);
    s.plan = p;
    s.last = p.rays.map(() => -1000);
    const rg = roadGeometry(W, H);
    // the scenery: stars, the horizon, the road's edges; each cell is eaten by the mouth and comes back after the exit
    const world = [];
    const add = (x, y, g, c) => { if (x >= p.inset && x <= W - 1 - p.inset && y >= 1 && y <= H - 2) world.push({ i: y * W + x, g, c, off: eatenAt(p, x, y, sd), on: backAt(p, x, y, sd) }); };
    for (let y = 1; y < p.vy - 1; y++) for (let x = p.inset; x <= W - 1 - p.inset; x++) if (rand(sd + 21, x, y) < 0.02) add(x, y, G.dot, ICE[0]);
    for (let x = p.inset; x <= W - 1 - p.inset; x++) add(x, p.vy, G.under, MAG[1]);
    for (let r = p.vy + 1; r <= H - 2; r++) { add(edgeL(rg, r), r, G.edgeL, CYAN[3]); add(edgeR(rg, r), r, G.edgeR, CYAN[3]); }
    s.world = world;
    // the city: in the end rectangle low enough to fit it, taller outside; each cell comes in with the dissolve outward
    const e = p.end;
    const maxH = Math.max(2, p.vy - 3);
    const inside = (x) => x > e.x0 && x < e.x1;
    const cells = skylineCells({ x0: p.inset, x1: W - 1 - p.inset, base: p.vy, maxH, seed: sd, cap: (x) => (inside(x) ? Math.max(1, p.vy - e.y0 - 1) : maxH) });
    s.sky = cells.map((c) => ({ i: c.y * W + c.x, g: c.g, c: c.c, on: backAt(p, c.x, c.y, sd) }));
    return s;
  };
}

function step(s) {
  s.steps++;
  if (!s.ok) return;
  const n = s.steps, p = s.plan;
  let k = 0;
  for (let i = 0; i < s.parts.length; i++) if (n - s.parts[i].born <= s.parts[i].life) s.parts[k++] = s.parts[i];
  s.parts.length = k;
  if (!spawnSlot(p, n) || s.parts.length >= p.cap) return;
  // a lane that has been quiet long enough, chosen by the seed (the generator moves only here, on a spawn slot: a function of the step count)
  const open = [];
  for (let i = 0; i < p.rays.length; i++) if (n - s.last[i] >= MINGAP) open.push(i);
  if (open.length === 0) return;
  const best = open[Math.floor(rnd(s) * open.length)];
  const ray = p.rays[best];
  s.parts.push({ ray: best, born: n, q0: ray.dir > 0 ? ray.win0 : ray.cells.length - 1, dir: ray.dir, mv: ray.mv, travel: ray.travel, life: (ray.travel - 1) * ray.mv + 32 });
  s.last[best] = n;
  s.spawned++;
}

function drawRing(cv, r, col, vis) {
  const { x0, x1, y0, y1 } = r;
  if (x1 - x0 < 1 || y1 - y0 < 1) return;
  const at = (x, y, g) => { if (!vis || vis(x, y)) put(cv, x, y, g, col); };
  for (let x = x0 + 1; x < x1; x++) { at(x, y0, G.h); at(x, y1, G.h); }
  for (let y = y0 + 1; y < y1; y++) { at(x0, y, G.v); at(x1, y, G.v); }
  at(x0, y0, G.tl); at(x1, y0, G.tr); at(x0, y1, G.bl); at(x1, y1, G.br);
}

// The ceiling light on a ring: 1 to 4 cells of ━ in the middle of its top edge, longer on the rings nearer to us.
function streakLen(p, lv) {
  return Math.min(4, 1 + Math.floor((3 * (lv - 1)) / Math.max(1, p.K - 3)));
}
function drawStreak(cv, p, r, lv, vis) {
  const len = Math.min(streakLen(p, lv), r.x1 - r.x0 - 1);
  const start = Math.floor(p.cxf - (len - 1) / 2 + 1e-9);
  for (let i = 0; i < len; i++) if (!vis || vis(start + i, r.y0)) put(cv, start + i, r.y0, G.h, TANG[3]);
}

function draw(s, params) {
  const cv = canvas(params.glyphs, params.colours, s.w, s.h);
  clear(cv);
  if (!s.ok) return;
  const n = s.steps, p = s.plan, W = s.w, H = s.h, seed = s.seed;
  const g = params.glyphs, c = params.colours;
  const rg = roadGeometry(W, H);

  // ---- the scenery: there until the mouth passes over it, back from the exit
  const sceneryHere = (x, y) => n < eatenAt(p, x, y, seed) || n >= backAt(p, x, y, seed);
  for (const e of s.world) if (n < e.off || n >= e.on) { g[e.i] = e.g; c[e.i] = e.c; }
  if (n < T_TUNNEL || n >= T_EXIT) {
    const clock = dashClock(n) / 30;
    for (let line = 1; line <= 2; line++) {
      for (let i = 0; i < DASH_COUNT; i++) {
        const r = dashRow(rg, clock, i);
        if (r <= p.vy || r > H - 2) continue;
        const x = laneX(rg, r, line);
        if (x >= p.inset && x <= W - 1 - p.inset && sceneryHere(x, r)) put(cv, x, r, G.dash, SUN[2]);
      }
    }
  }
  // ---- the city
  for (const e of s.sky) if (n >= e.on) { g[e.i] = e.g; c[e.i] = e.c; }

  // ---- the tunnel: the mouth (and with it the outermost still ring), the still rings, the moving rings, each ring's ceiling light
  const rects = p.rects;
  const here = n >= T_EXIT ? (x, y) => n < backAt(p, x, y, seed) : null;
  if (n <= T_TUNNEL) drawRing(cv, rects[mouthLevel(p, n) - 1], FAR, null);
  else {
    // the mouth dissolves away as the still rings dissolve in; the outermost still ring is far silhouette too
    drawRing(cv, rects[p.Mm - 1], FAR, (x, y) => n < appearAt(p, x, y, seed) && (!here || here(x, y)));
    drawRing(cv, rects[p.K - 1], FAR, (x, y) => n >= appearAt(p, x, y, seed) && (!here || here(x, y)));
    for (const lv of p.statics) {
      if (lv === p.K) continue;
      const r = rects[lv - 1];
      drawRing(cv, r, VIOLET[1], (x, y) => n >= appearAt(p, x, y, seed) && (!here || here(x, y)));
      if (p.streaks) drawStreak(cv, p, r, lv, (x, y) => n >= appearAt(p, x, y, seed) && (!here || here(x, y)));
    }
    for (let r = 0; r < (s.limited ? p.R : p.RC); r++) {
      const lv = ringLevel(p, r, n, s.limited);
      if (lv === 0) continue;
      drawRing(cv, rects[lv - 1], VIOLET[1], here);
      if (p.streaks) drawStreak(cv, p, rects[lv - 1], lv, here);
    }
  }

  // ---- the frame of the window (near silhouette) and our car
  for (let x = 0; x < W; x++) { put(cv, x, 0, G.wall, NEAR); put(cv, x, H - 1, G.wall, NEAR); }
  for (let y = 1; y < H - 1; y++) for (let i = 0; i < p.inset; i++) { put(cv, i, y, G.wall, NEAR); put(cv, W - 1 - i, y, G.wall, NEAR); }

  // ---- the light trails: a head and a trail of up to 10 cells that fall one shade per 8 steps
  for (const q of s.parts) {
    const ray = p.rays[q.ray];
    const age = n - q.born, k = Math.floor(age / q.mv);
    const fam = q.dir > 0 ? ICE : CORAL;
    for (let vis = Math.max(0, k - 10); vis < k; vis++) {
      if (vis > q.travel - 1) continue;
      const shade = 3 - Math.floor((age - vis * q.mv) / TRAIL_AGE);
      if (shade < 0) continue;
      const cell = ray.cells[q.q0 + q.dir * vis];
      put(cv, cell.x, cell.y, cell.g, fam[shade]);
    }
    if (k <= q.travel - 1) {
      const cell = ray.cells[q.q0 + q.dir * k];
      put(cv, cell.x, cell.y, G.head, fam[3]);
    }
  }
  drawRear20(cv, Math.floor((W - REAR_20_W) / 2), H - 1 - REAR_20_H);
}

// The scene. `ringLimit: false` is the control: every ring moves on every step, and the guard is gone.
export function createOverdrive({ ringLimit = true } = {}) {
  return {
    id: 'overdrive',
    kind: 'sim',
    init: makeInit(ringLimit),
    step,
    draw,
    ringLimit,
    movesInWindow(step0, n, w, h) {
      const p = planOf(w, h, false);
      let m = 0;
      for (let k = 1; k <= n; k++) m += movesAt(p, step0 + k, ringLimit);
      return m;
    },
  };
}

const overdrive = createOverdrive();
export default overdrive;
