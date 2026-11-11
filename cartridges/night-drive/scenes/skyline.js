// A2. Velvet Skyline: parked at an overlook across Velvet Bay from Port Solace. Two towers (The Orchid, a magenta crown over tubes, and
// Solace Tower, cyan crown bands on a mast with a coral beacon), a skyline of lit windows, a violet rail bridge, the bay with its
// reflections, and a guard rail along the bottom.
//
//   beacon      coral 0 -> 1 -> 2 -> 3 -> 2 -> 1 -> 0 over a 4 s period: 2 s at rest, then up and down through the shades (each of 1 and 2
//               holds 0.3 s, so even a 4x frame never skips one); a halo of four dots shows at the peak
//   windows     one window changes every 0.4 s, in a seeded order that visits them all before any repeats; a change holds shade 1 for 0.3 s
//               between a dim (sun 0) and a lit (sun 2) window, so a window stays in the sun family and never moves two shades at once
//   reflections streaks of  - . and a dot in the bay, one shade below what they mirror; each shifts a column at most every 0.6 s, and the
//               shifts are planned (lib/shimmer.js) so that about a dozen cells change in a frame, never a crowd
//   train       from 8 s, and again every 30 s: eight squares in sun 2 cross the bridge row at a column per 0.08 s
//   searchlights two thin beams of a slash in cyan 0 step one column every 1.5 s, there and back, behind the buildings
//
// Compact rule (anything under 100 columns or 32 rows, such as 80x24): the same two towers (one a side), a shorter skyline and 6 rows of
// reflections instead of 9. Under 40 columns or 18 rows the picture is blank.
// kind 'cells'. Pure in (t, w, h, seed): t0 in params shifts the scene's own clock. The static part of the picture (stars, buildings, towers,
// bridge, bay edge, guard rail) is drawn once per (w, h, seed) and copied in; a frame only draws the moving parts on top. The background is
// never drawn: a blank cell is a space in colour 0.
import { rand } from '../../../src/scenes/util.js';
import { canvas, clear, put } from '../lib/canvas.js';
import { sceneTime, seedOf } from '../lib/clock.js';
import { SUN, CORAL, MAG, VIOLET, CYAN, ICE, NEAR } from '../lib/palette.js';
import { skylineCells, SKY_WINDOW } from '../lib/skyline.js';
import { tickAt, changesAt, plan } from '../lib/shimmer.js';

// Breakpoints, widest first; a window gets the first layout it is at least as big as.
export const LAYOUTS = Object.freeze([
  Object.freeze({ name: 'full', minCols: 100, minRows: 32, reflRows: 9, maxStreaks: 90, maxBuilding: 14, orchidAt: 0.22, solaceAt: 0.7 }),
  Object.freeze({ name: 'compact', minCols: 0, minRows: 0, reflRows: 6, maxStreaks: 60, maxBuilding: 9, orchidAt: 0.22, solaceAt: 0.7 }),
]);
export function layoutFor(w, h) {
  return LAYOUTS.find((l) => w >= l.minCols && h >= l.minRows) || LAYOUTS[LAYOUTS.length - 1];
}

export const MIN_W = 40, MIN_H = 18; // under this the window is too small for the picture, and stays blank
export const WINDOW_EVERY = 0.4, WINDOW_RAMP = 0.3; // seconds
export const TRAIN_FIRST = 8, TRAIN_PERIOD = 30, TRAIN_CARS = 8, TRAIN_STEP = 0.08;
export const BEACON_PERIOD = 4;
export const BEAM_STEP = 1.5, BEAM_RANGE = 5;
const STREAK_PERIODS = [10, 12, 14, 15]; // ticks of 0.06 s: 0.6, 0.72, 0.84 and 0.9 s
const cp = (ch) => ch.codePointAt(0);
const DOT = cp('·'), RING = cp('°');
const STREAK_GLYPHS = [cp('─'), cp('─'), cp('-'), cp('-'), cp('·')];

// Where things stand in a window of w x h (plain numbers): the bridge row, the bay's rows, the guard rail.
export function geometry(w, h) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const L = layoutFor(W, H);
  const bridgeY = H - 6 - L.reflRows;
  return { W, H, layout: L.name, bridgeY, reflTop: bridgeY + 3, reflBottom: H - 4, guardY: H - 2 };
}

// The beacon's shade (0 to 3) at phase p seconds into its 4 s period.
export function beaconShade(p) {
  if (p < 2) return 0;
  if (p < 2.3) return 1;
  if (p < 2.6) return 2;
  if (p < 3.4) return 3;
  if (p < 3.7) return 2;
  return 1;
}

// A window's shade (0 dim, 1 changing, 2 lit): `on` is its level at the start (0 or 2), `pos` its place in the order of changes, n the
// number of windows, U the time in tenths of a second. The m-th change (m = 0, 1, ...) is the window at place m mod n, and begins at (m + 1) * 0.4 s.
export function windowShade(on, pos, n, U) {
  const M = Math.floor(U / 4);
  if (M <= pos) return on;
  const count = Math.floor((M - 1 - pos) / n) + 1;
  const level = count & 1 ? 2 - on : on;
  const began = 4 * (pos + n * (count - 1) + 1);
  return U - began < 3 ? 1 : level;
}

const triangle = (s) => { const m = ((s % (2 * BEAM_RANGE)) + 2 * BEAM_RANGE) % (2 * BEAM_RANGE); return m <= BEAM_RANGE ? m : 2 * BEAM_RANGE - m; };

// ---- the static picture and the lists of moving parts, per (w, h, seed)
const memo = new Map();
function planOf(W, H, S) {
  const key = W + 'x' + H + 'x' + S;
  let p = memo.get(key);
  if (p) return p;
  p = buildPlan(W, H, S);
  memo.set(key, p);
  if (memo.size > 6) memo.delete(memo.keys().next().value);
  return p;
}

function buildPlan(W, H, S) {
  const L = layoutFor(W, H);
  const g = geometry(W, H);
  const by = g.bridgeY;
  const n = W * H;
  const sg = new Uint16Array(n).fill(32), sc = new Uint8Array(n);
  const set = (x, y, glyph, col) => { if (x >= 0 && y >= 0 && x < W && y < H) { sg[y * W + x] = glyph; sc[y * W + x] = col; } };

  // the towers
  const cxO = Math.max(3, Math.round(W * L.orchidAt));
  const cxS = Math.min(W - 5, Math.round(W * L.solaceAt));
  const hO = Math.max(5, Math.min(30, Math.round(by * 0.78)));
  const hS = Math.max(6, Math.min(36, by - 1));
  const windows = new Map(); // cell index -> true (a Map keeps the order they were found in)
  const addWindow = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) windows.set(y * W + x, true); };
  const beacon = { x: cxS, y: by - hS };

  // stars, then everything else paints over them
  for (let y = 0; y <= by - 2; y++) {
    for (let x = 0; x < W; x++) {
      if (rand(S + 21, x, y) >= 0.02) continue;
      if (Math.abs(x - beacon.x) <= 3 && Math.abs(y - beacon.y) <= 3) continue; // the beacon's halo is the only dot there
      if (rand(S + 23, x, y) < 0.25) set(x, y, RING, ICE[1]); else set(x, y, DOT, ICE[0]);
    }
  }

  // the skyline of buildings, with room left for the towers
  const cap = (x) => ((x >= cxO - 3 && x <= cxO + 3) || (x >= cxS - 4 && x <= cxS + 4) ? 0 : 99);
  const maxH = Math.max(2, Math.min(L.maxBuilding, Math.round(by * 0.45)));
  for (const c of skylineCells({ x0: 0, x1: W - 1, base: by, maxH, seed: S, cap, salt: 0 })) {
    if (c.g === SKY_WINDOW) addWindow(c.x, c.y); else set(c.x, c.y, c.g, c.c);
  }

  // The Orchid: a diamond crown over a spire, tubes at the sides, a core with windows in a checkerboard
  {
    const top = by - hO;
    for (let r = 0; r < hO; r++) {
      const y = top + r;
      if (r === 0) set(cxO, y, cp('◆'), MAG[3]);
      else if (r === 1) { set(cxO - 1, y, cp('▟'), MAG[2]); set(cxO, y, cp('█'), MAG[2]); set(cxO + 1, y, cp('▙'), MAG[2]); }
      else {
        set(cxO - 2, y, cp('┃'), MAG[2]); set(cxO + 2, y, cp('┃'), MAG[2]);
        for (let x = cxO - 1; x <= cxO + 1; x++) set(x, y, cp('█'), NEAR);
        if ((r - 2) % 2 === 0) addWindow(cxO, y); else { addWindow(cxO - 1, y); addWindow(cxO + 1, y); }
      }
    }
  }
  // Solace Tower: a beacon on a mast over three cyan bands, then the shaft
  {
    const mast = Math.min(3, Math.max(0, hS - 7));
    for (let r = 1; r <= mast; r++) set(cxS, beacon.y + r, cp('┃'), ICE[0]);
    const r0 = 1 + mast;
    for (let r = r0; r < hS; r++) {
      const y = beacon.y + r, rel = r - r0;
      if (rel % 3 === 0 && rel <= 6) { for (let x = cxS - 3; x <= cxS + 3; x++) set(x, y, cp('▄'), CYAN[3]); continue; }
      set(cxS - 3, y, cp('▐'), CYAN[1]); set(cxS + 3, y, cp('▌'), CYAN[1]);
      for (let x = cxS - 2; x <= cxS + 2; x++) set(x, y, cp('█'), NEAR);
      if (rel % 2 === 1) { addWindow(cxS - 1, y); addWindow(cxS + 1, y); }
    }
  }

  // the rail bridge on its piers, the edge of the bay, and the guard rail
  for (let x = 0; x < W; x++) {
    const pier = x % 11 === 2;
    set(x, by, pier ? cp('╤') : cp('═'), VIOLET[1]);
    if (pier) set(x, by + 1, cp('│'), VIOLET[1]);
    set(x, by + 2, cp('▔'), VIOLET[0]);
    set(x, g.guardY, x % 9 === 0 ? cp('╤') : cp('═'), ICE[0]);
    if (x % 9 === 0) set(x, g.guardY + 1, cp('│'), ICE[0]);
  }

  // windows: the seeded order of changes, and which start lit
  const idx = Int32Array.from(windows.keys());
  const wn = idx.length;
  const order = Array.from({ length: wn }, (_, i) => i).sort((a, b) => rand(S + 31, idx[a], 0) - rand(S + 31, idx[b], 0) || a - b);
  const pos = new Int32Array(wn);
  order.forEach((k, r) => { pos[k] = r; });
  const on = new Uint8Array(wn);
  for (let k = 0; k < wn; k++) on[k] = rand(S + 33, idx[k], 0) < 0.5 ? 2 : 0;

  // reflections: streaks in the bay, in pairs of cells that never touch, each shifting between its two columns
  const rows = Math.max(0, g.reflBottom - g.reflTop + 1);
  const want = Math.min(L.maxStreaks, Math.round((W * rows) / 13));
  const cand = [];
  for (let y = g.reflTop; y <= g.reflBottom; y++) for (let x = 0; x < W - 1; x++) cand.push({ x, y, r: rand(S + 41, x, y) });
  cand.sort((a, b) => a.r - b.r || a.y - b.y || a.x - b.x);
  const taken = new Uint8Array(n);
  const streaks = [];
  for (const c of cand) {
    if (streaks.length >= want) break;
    const i = c.y * W + c.x;
    if (taken[i] || taken[i + 1] || (c.x > 0 && taken[i - 1]) || (c.x + 2 < W && taken[i + 2])) continue;
    taken[i] = taken[i + 1] = 1;
    const near = (cx) => Math.abs(c.x - cx) <= 9;
    const pick = Math.floor(rand(S + 43, c.x, c.y) * 3);
    const col = near(cxO) ? MAG[2] : near(cxS) ? CYAN[2] : pick === 0 ? SUN[1] : pick === 1 ? ICE[0] : VIOLET[1];
    streaks.push({ x: c.x, y: c.y, glyph: STREAK_GLYPHS[Math.floor(rand(S + 45, c.x, c.y) * STREAK_GLYPHS.length)], col });
  }
  const shift = plan(streaks.length, STREAK_PERIODS, S, 47);

  return { W, H, by, sg, sc, idx, wn, pos, on, streaks, shift, beacon, cxS, geo: g };
}

function skyline(t, w, h, params) {
  const cv = canvas(params.glyphs, params.colours, w, h);
  clear(cv);
  const W = cv.w, H = cv.h;
  if (W < MIN_W || H < MIN_H || cv.g.length < W * H || cv.c.length < W * H) return;
  const T = sceneTime(t, params);
  const S = seedOf(params);
  const p = planOf(W, H, S);
  const { g, c } = cv;
  g.set(p.sg, 0); c.set(p.sc, 0);

  // searchlights, behind the buildings: they only show on sky (a blank cell or a star)
  const s = Math.floor(T / BEAM_STEP + 1e-9);
  const len = Math.min(p.by - 1, 24);
  const beams = [Math.round(W * 0.12) + triangle(s), Math.round(W * 0.5) + triangle(s + BEAM_RANGE)];
  for (const bx of beams) {
    for (let k = 0; k < len; k++) {
      const x = bx + k, y = p.by - 1 - k;
      if (x < 0 || x >= W || y < 0) continue;
      const i = y * W + x, sgl = p.sg[i];
      if (sgl === 32 || sgl === DOT || sgl === RING) { g[i] = cp('╱'); c[i] = CYAN[0]; }
    }
  }

  // windows
  const U = Math.floor(T * 10 + 1e-6);
  for (let k = 0; k < p.wn; k++) {
    const i = p.idx[k];
    g[i] = cp('▪');
    c[i] = SUN[windowShade(p.on[k], p.pos[k], p.wn, U)];
  }

  // the beacon, and its halo at the peak
  const shade = beaconShade(T % BEACON_PERIOD);
  const bx = p.beacon.x, byy = p.beacon.y;
  put(cv, bx, byy, cp('●'), CORAL[shade]);
  if (shade === 3) for (const [dx, dy] of [[-1, 0], [1, 0], [-1, -1], [1, -1]]) put(cv, bx + dx, byy + dy, DOT, CORAL[1]);

  // reflections
  const u = tickAt(T);
  for (let k = 0; k < p.streaks.length; k++) {
    const st = p.streaks[k];
    put(cv, st.x + (changesAt(u, p.shift.phase[k], p.shift.P[k]) & 1), st.y, st.glyph, st.col);
  }

  // the train on the bridge
  const C = Math.floor(T * 100 + 1e-6) % (TRAIN_PERIOD * 100);
  if (C >= TRAIN_FIRST * 100) {
    const head = Math.floor((C - TRAIN_FIRST * 100) / (TRAIN_STEP * 100));
    for (let j = 0; j < TRAIN_CARS; j++) put(cv, head - j, p.by, cp('▪'), SUN[2]);
  }
}

skyline.id = 'skyline';
skyline.kind = 'cells';
export default skyline;
