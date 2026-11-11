// A1. Midnight On-Ramp: out of Port Solace on Shoreline 9, lamps sliding past. A three-lane road in perspective under a sky of
// stars, a low ridge with the small city of Port Solace in front of it, and the Vantra Halcyon from behind at the bottom.
//
//   dashes    two dashed lane lines at the thirds of the road; a dash takes 1.2 s from the horizon to the car (three in flight, so the
//             picture repeats every 0.4 s)
//   lamps     a street lamp every 2.4 s on the right, drawn in perspective from one row to sixteen, leaving past the edge (not at 80x24)
//   posts     a reflector post on the left verge every 1.2 s
//   stars     one star at a time ramps ice 0 -> 1 -> 2 -> 1 -> 0 over 2 s (a new one every 2.5 s); the rest hold still
//   sway      the car moves one column left for 1.5 s and back, every 7 to 11 s (seeded): single steps, nothing in between
//   pass      from 41 s and then every 45 s a car ahead shows as two tail lights at the horizon, grows to a small and then a larger
//             picture as we close on it, and slides past in the left lane
//
// Compact rule (anything under 100 columns or 32 rows, such as 80x24): the ridge is one row, no city, no lamps, the 20x4 car.
// kind 'cells'. Pure in (t, w, h, seed): t0 in params shifts the scene's own clock. The background is never drawn: a blank cell is a
// space in colour 0, so the cartridge's one background (#0D0820) is all there is behind it.
import { rand } from '../../../src/scenes/util.js';
import { canvas, clear, put } from '../lib/canvas.js';
import { sceneTime, seedOf } from '../lib/clock.js';
import { SUN, TANG, CORAL, MAG, CYAN, ICE, FAR, NEAR } from '../lib/palette.js';
import { geometry, edgeL, edgeR, laneX, laneCentre, laneWidth, dashRow, lamp, post, DASH_COUNT } from '../lib/road.js';
import {
  REAR_34_W, REAR_34_H, REAR_20_W, REAR_20_H, drawRear34, drawRear20, drawAhead6, drawAhead12,
} from '../lib/sprites.js';

// Breakpoints, widest first; a window gets the first layout it is at least as big as.
export const LAYOUTS = Object.freeze([
  Object.freeze({ name: 'full', minCols: 100, minRows: 32, ridgeRows: 4, city: true, lamps: true, car: 'rear34' }),
  Object.freeze({ name: 'compact', minCols: 0, minRows: 0, ridgeRows: 1, city: false, lamps: false, car: 'rear20' }),
]);
export function layoutFor(w, h) {
  return LAYOUTS.find((l) => w >= l.minCols && h >= l.minRows) || LAYOUTS[LAYOUTS.length - 1];
}

export const STAR_PERIOD = 2.5, STAR_RAMP = 2, STAR_DENSITY = 0.02;
export const SWAY_HOLD = 1.5, SWAY_MIN = 7, SWAY_SPAN = 4;
export const PASS_FIRST = 41, PASS_PERIOD = 45, PASS_SECONDS = 10.5;
const cp = (ch) => ch.codePointAt(0);

// ---- stars. Static ones are '·' in ice 0 (or '°' in ice 1); the ramping one is always a '·' cell.
export function starsOf(w, h, seed) {
  const L = layoutFor(w, h);
  const g = geometry(w, h);
  const rows = Math.max(0, g.horizon - L.ridgeRows - 1);
  const dim = [], bright = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < g.W; x++) {
      if (rand(seed + 21, x, y) >= STAR_DENSITY) continue;
      (rand(seed + 23, x, y) < 0.25 ? bright : dim).push({ x, y, r: rand(seed + 25, x, y) });
    }
  }
  dim.sort((a, b) => a.r - b.r || a.x - b.x || a.y - b.y);
  return { dim, bright };
}
// The ramp's shade (0 to 2) at `age` seconds into its slot: 0, then 1 2 2 1 in single steps over 2 s, then 0 again until the next slot.
export function starShade(age) {
  if (age < 0 || age >= STAR_RAMP) return 0;
  const p = age / STAR_RAMP;
  return p < 0.25 ? 1 : p < 0.75 ? 2 : 1;
}

// ---- sway of the car: 0 or -1 columns
export function swayStarts(seed, until) {
  const out = [];
  let s = SWAY_MIN + SWAY_SPAN * rand(seed + 31, 0, 0);
  for (let k = 1; s <= until; k++) { out.push(s); s += SWAY_MIN + SWAY_SPAN * rand(seed + 31, k, 0); }
  return out;
}
export function swayOffset(T, seed) {
  let s = SWAY_MIN + SWAY_SPAN * rand(seed + 31, 0, 0);
  for (let k = 1; s <= T; k++) {
    if (T < s + SWAY_HOLD) return -1;
    s += SWAY_MIN + SWAY_SPAN * rand(seed + 31, k, 0);
  }
  return 0;
}

// ---- the car ahead: seconds into the current pass, or -1 when there is none
export function passAge(T) {
  if (T < PASS_FIRST) return -1;
  const s = (T - PASS_FIRST) % PASS_PERIOD;
  return s < PASS_SECONDS ? s : -1;
}

// The row of the car ahead's foot, `age` seconds into a pass: it crawls for a few seconds, then gathers speed (u^4) and runs
// off the bottom of the window.
export function passRow(g, age) {
  const u = Math.min(1, Math.max(0, age / PASS_SECONDS));
  return g.horizon + Math.round(1 + (g.below - 1) * u * u * u * u);
}

// ---- the ridge: a height in rows (0 to ridgeRows) for every column
export function ridgeOf(w, h, seed) {
  const L = layoutFor(w, h);
  const g = geometry(w, h);
  const hg = new Array(g.W).fill(0);
  const peaks = [];
  for (let k = 0; k * 16 < g.W + 16; k++) {
    peaks.push({ c: k * 16 + rand(seed + 41, k, 0) * 12, half: 6 + rand(seed + 41, k, 1) * 8, amp: 0.6 + rand(seed + 41, k, 2) * (L.ridgeRows + 0.4) });
  }
  const span = L.city ? 15 : -1;
  for (let x = 0; x < g.W; x++) {
    let v = 0;
    for (const p of peaks) v = Math.max(v, p.amp - (Math.abs(x - p.c) * p.amp) / p.half);
    hg[x] = Math.max(0, Math.min(L.ridgeRows, Math.round(v)));
    if (Math.abs(x - g.cx) < span) hg[x] = Math.min(hg[x], 1);
  }
  return hg;
}

// ---- the city: Port Solace, in the middle in front of the ridge. {x, w, h, windows: [{x, y}]}
export function cityOf(w, h, seed) {
  const L = layoutFor(w, h);
  if (!L.city) return [];
  const g = geometry(w, h);
  const out = [];
  let x = Math.floor(g.cx) - 15;
  for (let k = 0; x < Math.floor(g.cx) + 15; k++) {
    const bw = 3 + Math.floor(rand(seed + 51, k, 0) * 3);
    const bh = 2 + Math.floor(rand(seed + 51, k, 1) * (L.ridgeRows + 2));
    const windows = [];
    for (let y = g.horizon - bh + 1; y <= g.horizon - 1; y += 2) {
      for (let wx = x + 1; wx <= x + bw - 2; wx += 2) if (rand(seed + 53, wx, y) < 0.6) windows.push({ x: wx, y });
    }
    out.push({ x, w: bw, h: bh, windows });
    x += bw + (rand(seed + 51, k, 2) < 0.3 ? 1 : 0);
  }
  return out;
}

function onramp(t, w, h, params) {
  const cv = canvas(params.glyphs, params.colours, w, h);
  clear(cv);
  const W = cv.w, H = cv.h;
  if (W === 0 || H === 0) return;
  const T = sceneTime(t, params);
  const S = seedOf(params);
  const L = layoutFor(W, H);
  const g = geometry(W, H);

  // ---- stars
  const stars = starsOf(W, H, S);
  for (const s of stars.bright) put(cv, s.x, s.y, cp('°'), ICE[1]);
  for (const s of stars.dim) put(cv, s.x, s.y, cp('·'), ICE[0]);
  if (stars.dim.length) {
    const slot = Math.floor(T / STAR_PERIOD);
    const shade = starShade(T - slot * STAR_PERIOD);
    if (shade > 0) {
      const s = stars.dim[slot % stars.dim.length]; // the seeded shuffle, one after another: never the same star twice running
      put(cv, s.x, s.y, cp('·'), ICE[shade]);
    }
  }

  // ---- the ridge, then the city in front of it
  const hg = ridgeOf(W, H, S);
  for (let x = 0; x < W; x++) {
    const b = hg[x];
    if (b <= 0) continue;
    const a = x > 0 ? hg[x - 1] : 0, c = x < W - 1 ? hg[x + 1] : 0;
    let top;
    if (a < b && c >= b) top = b > 1 ? '▟' : '▗';
    else if (a >= b && c < b) top = b > 1 ? '▙' : '▖';
    else top = '▄';
    for (let k = 1; k <= b; k++) put(cv, x, g.horizon - k, cp(k === b ? top : '█'), FAR);
  }
  for (const b of cityOf(W, H, S)) {
    for (let k = 1; k <= b.h; k++) for (let x = b.x; x < b.x + b.w; x++) put(cv, x, g.horizon - k, cp(k === b.h ? '▄' : '█'), NEAR);
    for (const win of b.windows) put(cv, win.x, win.y, cp('▪'), SUN[1]);
  }

  // ---- the horizon line, and the road's two edges
  for (let x = 0; x < W; x++) put(cv, x, g.horizon, cp('▁'), MAG[1]);
  for (let r = g.horizon + 1; r < H; r++) {
    const l = edgeL(g, r), rr = edgeR(g, r);
    const n = Math.max(1, edgeL(g, r - 1) - l - 1);
    put(cv, l, r, cp('╱'), CYAN[3]);
    put(cv, rr, r, cp('╲'), CYAN[3]);
    for (let k = 1; k <= n; k++) { put(cv, l - k, r, cp('▁'), CYAN[3]); put(cv, rr + k, r, cp('▁'), CYAN[3]); }
  }

  // ---- the lane lines: three dashes in flight on each, far ones thin and near ones heavy
  const mid = g.horizon + g.below / 2;
  for (let line = 1; line <= 2; line++) {
    for (let i = 0; i < DASH_COUNT; i++) {
      const r = dashRow(g, T, i);
      put(cv, laneX(g, r, line), r, cp(r < mid ? '│' : '┃'), SUN[2]);
    }
  }

  // ---- reflector posts on the left verge
  const po = post(g, T);
  put(cv, po.x, po.foot, cp('▪'), CORAL[1]);

  // ---- the street lamp on the right
  if (L.lamps) {
    const la = lamp(g, T);
    const top = la.foot - la.height + 1;
    if (la.height === 1) put(cv, la.x, la.foot, cp('●'), TANG[3]);
    else {
      for (let y = top + 1; y < la.foot; y++) put(cv, la.x, y, cp('┃'), ICE[0]);
      put(cv, la.x, la.foot, cp(la.height >= 3 ? '┻' : '┃'), ICE[0]);
      put(cv, la.x, top, cp('┓'), ICE[0]);
      for (let a = 1; a <= la.arm; a++) put(cv, la.x - a, top, cp('━'), ICE[0]);
      put(cv, la.x - la.arm - 1, top, cp('●'), TANG[3]);
    }
  }

  // ---- the car ahead, in the left lane
  const age = passAge(T);
  if (age >= 0) {
    const row = passRow(g, age);
    const lw = laneWidth(g, row);
    const x = laneCentre(g, row, 0);
    if (lw < 8) { put(cv, x - 1, row, cp('▪'), CORAL[1]); put(cv, x + 1, row, cp('▪'), CORAL[1]); }
    else if (lw < 15) drawAhead6(cv, x - 3, row - 1);
    else drawAhead12(cv, x - 6, row - 2);
  }

  // ---- our car, the glow under its tail bar, and the sway
  const sway = swayOffset(T, S);
  const rear = L.car === 'rear34';
  const cw = rear ? REAR_34_W : REAR_20_W, ch = rear ? REAR_34_H : REAR_20_H;
  const cx = Math.floor((W - cw) / 2) + sway;
  const cy = H - 1 - ch;
  for (let i = 3; i < cw - 3; i++) put(cv, cx + i, H - 1, cp('░'), CORAL[0]);
  if (rear) drawRear34(cv, cx, cy); else drawRear20(cv, cx, cy);
}

onramp.id = 'onramp';
onramp.kind = 'cells';
export default onramp;
