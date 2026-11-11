// B2. Luma's, Open Late: a diner and the Quarterlight Arcade next door, seen from across the street at night. The rooftop sign LUMA'S in tube
// letters (6 wide, 5 tall, 2-column gaps, the apostrophe one tube) with DINER under it, a far-silhouette facade with booth windows, a scalloped
// awning, a door with OPEN LATE and the pie line, the arcade with its chase-bulb marquee and two cabinets, the kerb and the Halcyon parked in
// profile with its lights off.
//
//   chase      the marquee's bulbs (a ring of ● lit and ○ unlit, every fourth one lit) step one place along the ring every 0.25 s
//   flicker    the faulty apostrophe and the M's diagonal (three cells) dip from magenta 3 through 2 to 1 and back: 3 -> 2 at 0, 2 -> 1 at 0.15 s, 1 -> 2
//              at 0.25 s, 2 -> 3 at 0.4 s. One dip in every slot of 17 grid steps (3.8 s), so two dips start at least 2.67 s apart; the glyphs are never blank.
//              Dips start 0.09 s before a step of the 4x frame grid (2/9 s), so that a 4x frame (0.222 s) never spans two shade steps: see dipStart
//   server     a silhouette walks the window row a column every 0.3 s and turns at the ends
//   steam      a puff rises from a mug a cell every 0.5 s (°, ·) and thins out at the top
//   game       the cabinet screen runs a 6x3 game, a ball between two ▌ paddles, one step every 0.25 s (the design says 0.15 s, but nothing may repeat
//              faster than four times a second, so 0.25 s)
//   customer   one comes out of the door every 40 s, from 40 s, and stays 6 s
//
// Compact rule (anything under 100 columns or 32 rows, such as 80x24): LUMA'S only (no DINER), the arcade drops to its marquee (three rows, beside
// the facade, only where there are 71 columns), a smaller facade, no steam, no game and no car. Under 40 columns or 18 rows the picture is blank.
// kind 'cells'. Pure in (t, w, h, seed): t0 in params shifts the scene's own clock. The still part of the picture is drawn once per (w, h, seed) and
// copied in; a frame only draws the moving parts on top. The background is never drawn: a blank cell is a space in colour 0.
import { rand } from '../../../src/scenes/util.js';
import { canvas, clear, put, text } from '../lib/canvas.js';
import { sceneTime, seedOf } from '../lib/clock.js';
import { SUN, TANG, CORAL, MAG, CYAN, MINT, ICE, VIOLET, TEXT, FAR, NEAR } from '../lib/palette.js';
import { drawProfile, PROFILE_W, PROFILE_H } from '../lib/sprites.js';

// Breakpoints, widest first; a window gets the first layout it is at least as big as.
export const LAYOUTS = Object.freeze([
  Object.freeze({ name: 'full', minCols: 100, minRows: 32 }),
  Object.freeze({ name: 'compact', minCols: 0, minRows: 0 }),
]);
export function layoutFor(w, h) {
  return LAYOUTS.find((l) => w >= l.minCols && h >= l.minRows) || LAYOUTS[LAYOUTS.length - 1];
}

export const MIN_W = 40, MIN_H = 18; // under this the window is too small for the picture, and stays blank
export const CHASE_STEP = 0.25, WALK_STEP = 0.3, STEAM_STEP = 0.5, GAME_STEP = 0.25;
export const CUSTOMER_EVERY = 40, CUSTOMER_STAY = 6, CUSTOMER_HEAD = 0.5;
export const DIP_LEN = 0.4, DIP_GAP_MIN = 2.5;
const GRID = 2 / 9; // the 4x frame step: four frames of 18 a second
const SLOT = 17; // grid steps in a flicker slot
const DIP_PHASE = 0.09; // a dip starts this long before a grid step
const cp = (ch) => ch.codePointAt(0);

// When the dip in slot k starts (seconds): 9 to 14 grid steps into the slot, less DIP_PHASE. Two dips are 12 to 22 grid steps (2.67 to 4.9 s) apart.
export function dipStart(k, seed) {
  return (SLOT * k + 9 + Math.floor(rand(seed + 71, k, 0) * 6)) * GRID - DIP_PHASE;
}
// The shade (1 to 3) of the flickering tubes at time T: 3, then 2 for 0.15 s, 1 for 0.1 s, 2 for 0.15 s, then 3 again. Every step is one shade.
export function flickerShade(T, seed) {
  if (!(T >= 0)) return 3;
  const a = T - dipStart(Math.floor(T / (SLOT * GRID)), seed);
  if (a < 0 || a >= DIP_LEN) return 3;
  return a < 0.15 ? 2 : a < 0.25 ? 1 : 2;
}

const LETTERS = Object.freeze({
  L: ['┃     ', '┃     ', '┃     ', '┃     ', '┗━━━━━'],
  U: ['┃    ┃', '┃    ┃', '┃    ┃', '┃    ┃', '┗━━━━┛'],
  M: ['┃╲  ╱┃', '┃ ╲╱ ┃', '┃    ┃', '┃    ┃', '┃    ┃'],
  A: ['┏━━━━┓', '┃    ┃', '┣━━━━┫', '┃    ┃', '┃    ┃'],
  "'": ['┃'],
  S: ['┏━━━━━', '┃     ', '┗━━━━┓', '     ┃', '━━━━━┛'],
});
const SPELL = "LUMA'S";
const DINER_TEXT = '━━━  D I N E R  ━━━';
const PIE = 'PIE · COFFEE · 24 HRS';
const WALKER_FULL = Object.freeze([' ▄ ', '▐█▌', '▐ ▌']);
const WALKER_SMALL = Object.freeze(['▐█▌', '▐ ▌']);
const CUSTOMER = Object.freeze(['▗█▖', '▝▀▘']);
const BALL_X = [1, 2, 3, 4, 3, 2], BALL_Y = [0, 1, 2, 1];

const ring = (m) => {
  const out = [];
  for (let i = 0; i < m.w; i++) out.push({ x: m.x + i, y: m.y });
  for (let j = 1; j < m.h - 1; j++) out.push({ x: m.x + m.w - 1, y: m.y + j });
  for (let i = m.w - 1; i >= 0; i--) out.push({ x: m.x + i, y: m.y + m.h - 1 });
  for (let j = m.h - 2; j >= 1; j--) out.push({ x: m.x, y: m.y + j });
  return out;
};

// Where everything stands in a window of w x h (plain numbers). A window under MIN_W x MIN_H has no picture: { ok: false }.
export function geometry(w, h) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const L = layoutFor(W, H);
  const out = { W, H, layout: L.name, ok: W >= MIN_W && H >= MIN_H };
  if (!out.ok) return out;
  const full = L.name === 'full';
  const hasMarquee = full || W >= 71;
  const total = full ? 96 : hasMarquee ? 71 : 38;
  const fx = (W - total) >> 1;
  const baseY = full ? H - 8 : H - 3;
  const r0 = baseY - (full ? 10 : 8);
  const gap = full || W >= 43 ? 2 : 1;
  const sw = 31 + 5 * gap;
  const sx = full ? fx + 6 : (W - sw) >> 1;
  const sy = r0 - (full ? 7 : 6);
  Object.assign(out, {
    kerbY: baseY + 1, groundY: H - 1, baseY, r0, fx,
    sign: { x: sx, y: sy, w: sw, gap, apos: sx + 24 + 4 * gap, m: sx + 12 + 2 * gap },
    facade: { x: fx, y: r0, w: full ? 54 : 38, h: baseY - r0 + 1 },
    pie: full ? { x: fx + 3, y: r0 + 9 } : { x: fx + 11, y: r0 + 7 },
  });
  out.flicker = [
    { x: out.sign.apos, y: sy, glyph: '┃' },
    { x: out.sign.m + 1, y: sy, glyph: '╲' },
    { x: out.sign.m + 2, y: sy + 1, glyph: '╲' },
  ];
  if (full) {
    const ax = fx + 56;
    out.windows = [{ x: fx + 2, y: r0 + 3, w: 14, h: 6 }, { x: fx + 17, y: r0 + 3, w: 14, h: 6 }, { x: fx + 41, y: r0 + 3, w: 11, h: 6 }];
    out.door = { x: fx + 32, y: r0 + 3, w: 8, h: 8 };
    out.walkWindow = { x: out.windows[1].x + 1, y: out.windows[1].y + 1, w: 12, h: 4 };
    out.steam = { x: out.windows[0].x + 7, rows: [r0 + 6, r0 + 5, r0 + 4] };
    out.diner = { x: sx + ((sw - [...DINER_TEXT].length) >> 1), y: r0 - 1, text: DINER_TEXT };
    out.arcade = { x: ax, y: r0, w: 40, h: 11 };
    out.cabinets = [{ x: ax + 4, y: r0 + 2, w: 12 }, { x: ax + 22, y: r0 + 2, w: 12 }];
    out.game = { x: ax + 7, y: r0 + 3, w: 6, h: 3 };
    out.marquee = { x: ax + 4, y: r0 - 5, w: 31, h: 5 };
    out.car = { x: fx + 14, y: H - 5 };
  } else {
    out.windows = [{ x: fx + 11, y: r0 + 3, w: 12, h: 4 }, { x: fx + 24, y: r0 + 3, w: 12, h: 4 }];
    out.door = { x: fx + 2, y: r0 + 3, w: 8, h: 6 };
    out.walkWindow = { x: out.windows[0].x + 1, y: out.windows[0].y + 1, w: 10, h: 2 };
    out.steam = null;
    out.diner = null;
    out.arcade = null;
    out.cabinets = [];
    out.game = null;
    out.marquee = hasMarquee ? { x: fx + 40, y: r0 + 1, w: 31, h: 3 } : null;
    out.car = null;
  }
  out.door.openAt = { x: out.door.x + 2, y: r0 + 4 };
  out.door.lateAt = { x: out.door.x + 2, y: r0 + 5 };
  out.ring = out.marquee ? ring(out.marquee) : [];
  return out;
}

// ---- the still picture, per (w, h, seed)
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

function frameBox(cv, x, y, w, h, col) {
  for (let i = 1; i < w - 1; i++) { put(cv, x + i, y, cp('─'), col); put(cv, x + i, y + h - 1, cp('─'), col); }
  for (let j = 1; j < h - 1; j++) { put(cv, x, y + j, cp('│'), col); put(cv, x + w - 1, y + j, cp('│'), col); }
  put(cv, x, y, cp('┌'), col); put(cv, x + w - 1, y, cp('┐'), col);
  put(cv, x, y + h - 1, cp('└'), col); put(cv, x + w - 1, y + h - 1, cp('┘'), col);
}

function buildPlan(W, H, S) {
  const g = geometry(W, H);
  const full = g.layout === 'full';
  const n = W * H;
  const sg = new Uint16Array(n).fill(32), sc = new Uint8Array(n);
  const cv = canvas(sg, sc, W, H);
  const { r0, baseY, fx } = g;
  const fw = g.facade.w;

  // stars above the roofs, clear of the signs
  const rects = [{ x: g.sign.x - 1, y: g.sign.y - 1, w: g.sign.w + 2, h: 7 }];
  if (g.diner) rects.push({ x: g.diner.x - 1, y: g.diner.y, w: 21, h: 1 });
  if (g.marquee) rects.push({ x: g.marquee.x - 1, y: g.marquee.y - 1, w: g.marquee.w + 2, h: g.marquee.h + 2 });
  for (let y = 0; y <= r0 - 2; y++) {
    for (let x = 0; x < W; x++) {
      if (rand(S + 21, x, y) >= 0.02) continue;
      if (rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) continue;
      put(cv, x, y, cp(rand(S + 23, x, y) < 0.25 ? '°' : '·'), rand(S + 23, x, y) < 0.25 ? ICE[1] : ICE[0]);
    }
  }

  // the sign
  let x = g.sign.x;
  for (const ch of SPELL) {
    const art = LETTERS[ch];
    for (let j = 0; j < art.length; j++) text(cv, x, g.sign.y + j, art[j], MAG[3]);
    x += (ch === "'" ? 1 : 6) + g.sign.gap;
  }
  if (g.diner) text(cv, g.diner.x, g.diner.y, g.diner.text, CYAN[3]);

  // kerb and ground
  for (let i = 0; i < W; i++) { put(cv, i, g.kerbY, cp('─'), VIOLET[0]); put(cv, i, g.groundY, cp('═'), FAR); }

  // the diner's facade
  for (let i = 0; i < fw; i++) { put(cv, fx + i, r0, cp('▄'), FAR); put(cv, fx + i, baseY, cp('▄'), FAR); }
  for (let y = r0 + 1; y < baseY; y++) { put(cv, fx, y, cp('█'), FAR); put(cv, fx + fw - 1, y, cp('█'), FAR); }
  const scallops = Math.floor((fw - 2) / 3);
  for (let k = 0; k < scallops; k++) text(cv, fx + 1 + 3 * k, r0 + 1, '▛▀▜', CORAL[2]);
  for (let i = 1 + 3 * scallops; i < fw - 1; i++) put(cv, fx + i, r0 + 1, cp('█'), FAR);
  g.windows.forEach((wd, k) => {
    frameBox(cv, wd.x, wd.y, wd.w, wd.h, VIOLET[0]);
    for (let j = 1; j < wd.h - 1; j++) for (let i = 1; i < wd.w - 1; i++) put(cv, wd.x + i, wd.y + j, cp('░'), SUN[1]);
    const ix = wd.x + 1, iy = wd.y + 1;
    if (full && k === 0) {
      text(cv, ix, iy + 1, ' ▄        ▄ ', NEAR);
      text(cv, ix, iy + 2, '▐█▌      ▐█▌', NEAR);
      text(cv, ix, iy + 3, '▀▀▀▀▀▀▀▀▀▀▀▀', NEAR);
      put(cv, ix + 6, iy + 3, cp('▄'), TANG[2]); // the mug
    } else if (full && k === 2) {
      text(cv, ix, iy + 1, ' ▄    ▄  ', NEAR);
      text(cv, ix, iy + 2, '▐█▌  ▐█▌ ', NEAR);
      text(cv, ix, iy + 3, '▀▀▀▀▀▀▀▀▀', NEAR);
    } else if (!full && k === 1) {
      text(cv, ix, iy, '▐█▌    ▐█▌', NEAR);
      text(cv, ix, iy + 1, '▀▀▀▀▀▀▀▀▀▀', NEAR);
    }
  });
  const d = g.door;
  frameBox(cv, d.x, d.y, d.w, d.h, VIOLET[0]);
  put(cv, d.x, baseY, cp('┴'), VIOLET[0]); put(cv, d.x + d.w - 1, baseY, cp('┴'), VIOLET[0]);
  for (let i = 1; i < d.w - 1; i++) put(cv, d.x + i, baseY, cp('─'), VIOLET[0]);
  text(cv, d.openAt.x, d.openAt.y, 'OPEN', MINT[3]);
  text(cv, d.lateAt.x, d.lateAt.y, 'LATE', MINT[3]);
  put(cv, d.x + 6, baseY - 2, cp('▪'), SUN[2]);
  text(cv, g.pie.x, g.pie.y, PIE, TEXT);

  // the arcade
  if (g.arcade) {
    const a = g.arcade;
    for (let i = 0; i < a.w; i++) { put(cv, a.x + i, r0, cp('▄'), FAR); put(cv, a.x + i, baseY, cp('▄'), FAR); }
    for (let y = r0 + 1; y < baseY; y++) { put(cv, a.x, y, cp('█'), FAR); put(cv, a.x + a.w - 1, y, cp('█'), FAR); }
    g.cabinets.forEach((c, k) => {
      frameBox(cv, c.x, c.y, c.w, 5, CYAN[1]);
      text(cv, c.x, c.y + 4, '└──┬────┬──┘', CYAN[1]);
      for (const row of [5, 6]) { text(cv, c.x + 3, c.y + row, '│▓▓▓▓│', FAR); }
      text(cv, c.x + 3, c.y + 7, '▀▀▀▀▀▀', FAR);
      if (k === 1) { text(cv, c.x + 1, c.y + 1, ' ▄▄  ▀▀ ▄ ', CYAN[3]); text(cv, c.x + 1, c.y + 2, '  ▀▀ ▄▄   ', CYAN[3]); }
    });
  }
  if (g.marquee) {
    const m = g.marquee;
    text(cv, m.x + 4, m.y + (full ? 2 : 1), 'Q U A R T E R L I G H T', TANG[3]);
    if (full) text(cv, m.x + 10, m.y + 3, 'A R C A D E', TANG[3]);
  }

  // the car, parked: the lights are off and the body is violet 0
  if (g.car) {
    drawProfile(cv, g.car.x, g.car.y, 0, true);
    for (let j = 0; j < PROFILE_H; j++) for (let i = 0; i < PROFILE_W; i++) {
      const at = (g.car.y + j) * W + g.car.x + i;
      if (g.car.x + i >= W || g.car.y + j >= H) continue;
      if (sc[at] === VIOLET[1] || sc[at] === ICE[3]) sc[at] = VIOLET[0];
      else if (sc[at] === CORAL[3]) sc[at] = CORAL[0];
    }
  }
  return { g, sg, sc };
}

function diner(t, w, h, params) {
  const cv = canvas(params.glyphs, params.colours, w, h);
  clear(cv);
  const W = cv.w, H = cv.h;
  if (W < MIN_W || H < MIN_H || cv.g.length < W * H || cv.c.length < W * H) return;
  const T = sceneTime(t, params);
  const S = seedOf(params);
  const p = planOf(W, H, S);
  const g = p.g;
  cv.g.set(p.sg, 0); cv.c.set(p.sc, 0);

  // chase bulbs
  const step = Math.floor(T / CHASE_STEP + 1e-9) % 4;
  for (let i = 0; i < g.ring.length; i++) {
    const c = g.ring[i];
    if (((i - step) % 4 + 4) % 4 === 0) put(cv, c.x, c.y, cp('●'), SUN[3]); else put(cv, c.x, c.y, cp('○'), SUN[0]);
  }

  // the faulty tubes
  const shade = flickerShade(T, S);
  if (shade < 3) for (const c of g.flicker) put(cv, c.x, c.y, cp(c.glyph), MAG[shade]);

  // the server walks the window
  const ww = g.walkWindow, art = g.layout === 'full' ? WALKER_FULL : WALKER_SMALL;
  const span = ww.w - 3, cycle = 2 * span;
  const wn = Math.floor(T / WALK_STEP + 1e-9) % cycle;
  const wx = ww.x + (wn <= span ? wn : cycle - wn);
  for (let j = 0; j < art.length; j++) text(cv, wx, ww.y + (ww.h - art.length) + j, art[j], NEAR);

  // steam
  if (g.steam) {
    const ph = Math.floor(T / STEAM_STEP + 1e-9) % 4;
    if (ph < 3) put(cv, g.steam.x, g.steam.rows[ph], cp(ph === 0 ? '·' : '°'), ICE[0]);
  }

  // the game: a ball between two paddles
  if (g.game) {
    const gm = g.game, n = Math.floor(T / GAME_STEP + 1e-9);
    const left = n + ((6 - (n % 6)) % 6), right = n + ((3 - (n % 6) + 6) % 6);
    put(cv, gm.x, gm.y + BALL_Y[left % 4], cp('▌'), CYAN[3]);
    put(cv, gm.x + gm.w - 1, gm.y + BALL_Y[right % 4], cp('▌'), CYAN[3]);
    put(cv, gm.x + BALL_X[n % 6], gm.y + BALL_Y[n % 4], cp('●'), CYAN[3]);
  }

  // a customer comes out of the door
  if (T >= CUSTOMER_EVERY) {
    const age = T - Math.floor(T / CUSTOMER_EVERY) * CUSTOMER_EVERY;
    if (age < CUSTOMER_STAY) {
      text(cv, g.door.x + 2, g.baseY - 2, CUSTOMER[0], NEAR);
      if (age >= CUSTOMER_HEAD) text(cv, g.door.x + 2, g.baseY - 1, CUSTOMER[1], NEAR);
    }
  }
}

diner.id = 'diner';
diner.kind = 'cells';
export default diner;
