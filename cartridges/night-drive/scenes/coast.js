// A4. Coast Road 86: a side view. The Vantra Halcyon in profile on a cliff road above the sea, a moon over the water with a path of glitter
// under it, a far headland with a lighthouse, a retaining wall below the road, and a palm that passes in front now and then.
//
//   the car     stands still; the world moves past it. The wheels step through a vertical, a slash, a dash and a backslash once every
//               0.25 s (both wheels the same), the headlight beam and the tail light are fixed
//   posts       guard-rail posts on the cliff edge and a coral reflector on the retaining wall slide left a column every 0.05 s
//   headland    the far hills (and the lighthouse on them) slide left a column every 4 s, the crest first and each level below 0.4 s
//               later, so the step is spread over about a second; far silhouette, safe block glyphs only
//   lighthouse  a lamp on the headland; its beam of ten dashes in ice 0 swings on an 8 s turn and shows for the half facing us, growing
//               and shrinking one dash at a time (there is no dimmer ice, so it wipes in rather than fades)
//   glitter     under the moon: dashes and dots in ice 1 to 3, each changing at most every 0.66 s, and planned (lib/shimmer.js) so that
//               at most a handful change in a frame
//   palm        a near-silhouette palm crosses in front of the sea, right to left a column every 0.05 s (a slower step than the 0.03 s of
//               the design: at 0.04 s a frame with the headland step went over 5%), every 6 to 10 s (the first is already crossing at
//               the start); it is drawn behind the car and clear of the moon
//
// Compact rule (anything under 100 columns or 32 rows, such as 80x24): an 8x4 moon, 5 rows of sea, a 2-row headland and no lighthouse.
// Under 40 columns or 18 rows the picture is blank.
// kind 'cells'. Pure in (t, w, h, seed): t0 in params shifts the scene's own clock. The still part of the picture (stars, moon, sea, road,
// wall) is drawn once per (w, h, seed) and copied in; a frame only draws the moving parts on top. The background is never drawn.
import { rand } from '../../../src/scenes/util.js';
import { canvas, clear, put } from '../lib/canvas.js';
import { sceneTime, seedOf } from '../lib/clock.js';
import { CORAL, VIOLET, ICE, FAR, NEAR } from '../lib/palette.js';
import { drawProfile, PROFILE_W } from '../lib/sprites.js';
import { tickAt, changesAt, plan } from '../lib/shimmer.js';

// Breakpoints, widest first; a window gets the first layout it is at least as big as.
export const LAYOUTS = Object.freeze([
  Object.freeze({ name: 'full', minCols: 100, minRows: 32, moonW: 14, moonH: 6, ridgeRows: 4, lighthouse: true, glitter: 36 }),
  Object.freeze({ name: 'compact', minCols: 0, minRows: 0, moonW: 8, moonH: 4, ridgeRows: 2, lighthouse: false, glitter: 14 }),
]);
export function layoutFor(w, h) {
  return LAYOUTS.find((l) => w >= l.minCols && h >= l.minRows) || LAYOUTS[LAYOUTS.length - 1];
}

export const MIN_W = 40, MIN_H = 18; // under this the window is too small for the picture, and stays blank
export const POST_STEP = 0.05, POST_EVERY = 10, REFLECTOR_EVERY = 28; // seconds per column, columns
export const HEADLAND_STEP = 4, LEVEL_DELAY = 0.4; // seconds per column; seconds between one level of the hills and the next
export const PALM_STEP = 0.05, PALM_EVERY = 8, PALM_JITTER = 1, PALM_LEAD = 2.2, PALM_W = 9; // seconds per column; a start every 8 s +-1 s, so 6 to 10 s apart
export const BEAM_TURN = 8, BEAM_LEN = 10;
const GLITTER_PERIODS = [11, 12, 15, 20]; // ticks of 0.06 s: 0.66, 0.72, 0.9 and 1.2 s
const cp = (ch) => ch.codePointAt(0);
const MOON_FULL = Object.freeze([
  '   ▄▄████▄▄   ',
  ' ▄██████████▄ ',
  '▐████▓▓██████▌',
  '▐██████████▓█▌',
  ' ▀██████████▀ ',
  '   ▀▀████▀▀   ',
]);
const MOON_SMALL = Object.freeze([
  ' ▄████▄ ',
  '▐██▓███▌',
  '▐████▓█▌',
  ' ▀████▀ ',
]);
// Long runs of one glyph, so that a step of a column changes few cells (two to a run): a crown that is all small zigzags costs three times as much.
const PALM = Object.freeze([
  ' ▄▄▄ ▄▄▄ ',
  '▀▀▀▀█▀▀▀▀',
  '  ▀▀█▀▀  ',
  '    █    ',
]);
const TRUNK = '    █    ';
const GLITTER_STATES = [cp('━'), cp('─'), cp('·'), 32];

// Where things stand in a window of w x h (plain numbers).
export function geometry(w, h) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const L = layoutFor(W, H);
  const seaRows = L.name === 'full' ? Math.max(8, Math.round(H * 0.3)) : 5;
  const roadY = H - 5;
  const seaTop = roadY - seaRows;
  const moonX = W - L.moonW - Math.max(3, Math.round(W * 0.1));
  return {
    W, H, layout: L.name, roadY, seaTop, seaRows, landBottom: seaTop - 1, ridgeRows: L.ridgeRows, postY: H - 4, wallTop: H - 3,
    carX: (W - PROFILE_W) >> 1, carY: roadY - 4, moon: { x: moonX, y: 1, w: L.moonW, h: L.moonH },
  };
}

// The height (0 to ridgeRows) of the far hills at world column xw: peaks every 16 columns, plus the lighthouse's headland at wl (or none).
export function hillAt(xw, S, ridgeRows, wl) {
  const k0 = Math.floor(xw / 16);
  let v = 0;
  for (let k = k0 - 1; k <= k0 + 1; k++) {
    const c = k * 16 + rand(S + 41, k, 0) * 12, half = 6 + rand(S + 41, k, 1) * 8, amp = 0.6 + rand(S + 41, k, 2) * (ridgeRows - 0.2);
    const d = amp - (Math.abs(xw - c) * amp) / half;
    if (d > v) v = d;
  }
  let hgt = Math.max(0, Math.min(ridgeRows, Math.round(v)));
  if (wl !== null) {
    const d = Math.abs(xw - wl);
    hgt = Math.max(hgt, d <= 3 ? ridgeRows : Math.max(0, ridgeRows - (d - 3)));
  }
  return hgt;
}

// The length (0 to BEAM_LEN) of the lighthouse beam at time T: it shows for the half of the turn facing us, swelling and shrinking.
export function beamLength(T) {
  const q = (((T % BEAM_TURN) + BEAM_TURN) % BEAM_TURN) / BEAM_TURN;
  return q < 0.5 ? Math.round(BEAM_LEN * Math.sin(2 * Math.PI * q)) : 0;
}

// When palm n starts crossing (seconds): 8 s apart, give or take a second, so 6 to 10 s between two; the first is already under way at 0.
export function palmStart(n, S) {
  return n * PALM_EVERY - PALM_LEAD + PALM_JITTER * (2 * rand(S + 63, n, 0) - 1);
}

// ---- the still picture and the lists of moving parts, per (w, h, seed)
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
  const n = W * H;
  const sg = new Uint16Array(n).fill(32), sc = new Uint8Array(n);
  const set = (x, y, glyph, col) => { if (x >= 0 && y >= 0 && x < W && y < H) { sg[y * W + x] = glyph; sc[y * W + x] = col; } };
  const m = g.moon;

  // stars above the hills, clear of the moon
  for (let y = 0; y <= g.landBottom - L.ridgeRows - 1; y++) {
    for (let x = 0; x < W; x++) {
      if (rand(S + 21, x, y) >= 0.02) continue;
      if (x >= m.x - 1 && x <= m.x + m.w && y >= m.y - 1 && y <= m.y + m.h) continue;
      if (rand(S + 23, x, y) < 0.25) set(x, y, cp('°'), ICE[1]); else set(x, y, cp('·'), ICE[0]);
    }
  }
  // the moon, its maria in ice 1
  const art = L.name === 'full' ? MOON_FULL : MOON_SMALL;
  for (let j = 0; j < art.length; j++) {
    let i = 0;
    for (const ch of art[j]) { if (ch !== ' ') set(m.x + i, m.y + j, cp(ch), ch === '▓' ? ICE[1] : ICE[3]); i++; }
  }

  // the glitter path under the moon: a trapezoid of candidate cells, a few of them chosen
  const cxm = m.x + (m.w >> 1);
  const glitterAt = new Set();
  const cand = [];
  for (let y = g.seaTop; y < g.roadY; y++) {
    const hw = Math.min(9, 2 + Math.floor((y - g.seaTop) * 0.8));
    for (let x = cxm - hw; x <= cxm + hw; x++) {
      if (x < 0 || x >= W) continue;
      if (x >= g.carX - 1 && x <= g.carX + PROFILE_W + 4 && y >= g.carY) continue; // the car hides what is under it
      cand.push({ x, y, hw, r: rand(S + 53, x, y) });
    }
  }
  cand.sort((a, b) => a.r - b.r || a.y - b.y || a.x - b.x);
  const glitter = cand.slice(0, L.glitter).map((c) => {
    glitterAt.add(c.y * W + c.x);
    const d = Math.abs(c.x - cxm);
    const states = [0, 1, 2, 3].sort((a, b) => rand(S + 55, c.x * 7 + a, c.y) - rand(S + 55, c.x * 7 + b, c.y));
    return { x: c.x, y: c.y, col: d <= 1 ? ICE[3] : d * 2 <= c.hw ? ICE[2] : ICE[1], states, start: Math.floor(rand(S + 57, c.x, c.y) * 4) };
  });
  const shift = plan(glitter.length, GLITTER_PERIODS, S, 59);

  // the sea (not under the glitter), the road, the retaining wall
  for (let y = g.seaTop; y < g.roadY; y++) {
    for (let x = 0; x < W; x++) {
      if (glitterAt.has(y * W + x)) continue;
      const r = rand(S + 51, x, y);
      if (r < 0.62) set(x, y, cp('─'), VIOLET[0]); else if (r < 0.72) set(x, y, cp('~'), VIOLET[0]);
    }
  }
  for (let x = 0; x < W; x++) {
    set(x, g.roadY, cp('▀'), NEAR);
    for (let y = g.wallTop; y < H; y++) set(x, y, cp('▓'), FAR);
  }

  const wl = L.lighthouse ? Math.round(W * 0.3) : null;
  return { W, H, g, L, sg, sc, glitter, shift, wl, reflectorOff: Math.floor(rand(S + 61, 0, 0) * REFLECTOR_EVERY), landKey: '', land: null };
}

// The hill heights for columns -1 .. W (so a column can see both neighbours), once for each level of the hills: level k (1 at the foot, ridgeRows at
// the crest) steps one column left HEADLAND_STEP seconds apart like the rest, but the crest steps first and each level below LEVEL_DELAY later, so the
// whole step is spread over about a second and no one frame carries the whole headland. Memoised on the plan by the steps the levels are on.
// Returns { shifts, rows } with rows[k - 1] the Int8Array of level k.
function landOf(p, S, T) {
  const R = p.L.ridgeRows;
  const shifts = [];
  for (let k = 1; k <= R; k++) shifts.push(Math.max(0, Math.floor((T - (R - k) * LEVEL_DELAY) / HEADLAND_STEP + 1e-9)));
  const key = shifts.join(',');
  if (p.landKey === key) return p.land;
  const byShift = new Map();
  const rows = shifts.map((sh) => {
    let a = byShift.get(sh);
    if (!a) {
      a = new Int8Array(p.W + 2);
      for (let x = -1; x <= p.W; x++) a[x + 1] = hillAt(x + sh, S, R, p.wl);
      byShift.set(sh, a);
    }
    return a;
  });
  p.land = { shifts, rows }; p.landKey = key;
  return p.land;
}

function coast(t, w, h, params) {
  const cv = canvas(params.glyphs, params.colours, w, h);
  clear(cv);
  const W = cv.w, H = cv.h;
  if (W < MIN_W || H < MIN_H || cv.g.length < W * H || cv.c.length < W * H) return;
  const T = sceneTime(t, params);
  const S = seedOf(params);
  const p = planOf(W, H, S);
  const g = p.g;
  cv.g.set(p.sg, 0); cv.c.set(p.sc, 0);

  // the far hills, and the lighthouse on them
  const land = landOf(p, S, T);
  const base = g.landBottom + 1;
  for (let x = 0; x < W; x++) {
    // a column is built up from its foot, a level at a time, for as long as each level's hills reach that high
    for (let k = 1; k <= g.ridgeRows; k++) {
      const lv = land.rows[k - 1], b = lv[x + 1];
      if (b < k) break;
      let glyph = '█';
      if (b === k) {
        const a = lv[x], c = lv[x + 2];
        if (a < b && c >= b) glyph = b > 1 ? '▟' : '▗';
        else if (a >= b && c < b) glyph = b > 1 ? '▙' : '▖';
        else glyph = '▄';
      }
      put(cv, x, base - k, cp(glyph), FAR);
    }
  }
  if (p.wl !== null) {
    const lx = p.wl - land.shifts[g.ridgeRows - 1];
    const yb = base - g.ridgeRows - 1;
    const tower = ['', '▄█▄', '▐█▌', '▟█▙'];
    for (let j = 1; j < 4; j++) { let i = 0; for (const ch of tower[j]) { put(cv, lx - 1 + i, yb - 3 + j, cp(ch), FAR); i++; } }
    put(cv, lx, yb - 3, cp('●'), ICE[3]);
    const len = beamLength(T);
    for (let k = 1; k <= len; k++) put(cv, lx + k, yb - 3, cp('─'), ICE[0]);
  }

  // the glitter
  const u = tickAt(T);
  for (let k = 0; k < p.glitter.length; k++) {
    const gl = p.glitter[k];
    const glyph = GLITTER_STATES[gl.states[(gl.start + changesAt(u, p.shift.phase[k], p.shift.P[k])) & 3]];
    if (glyph !== 32) put(cv, gl.x, gl.y, glyph, gl.col);
  }

  // posts on the cliff edge and a reflector on the wall, sliding left a column every 0.05 s
  const c = Math.floor(T / POST_STEP + 1e-9);
  for (let x = (POST_EVERY - (c % POST_EVERY)) % POST_EVERY; x < W; x += POST_EVERY) put(cv, x, g.postY, cp('╥'), ICE[0]);
  for (let x = (REFLECTOR_EVERY - ((c + p.reflectorOff) % REFLECTOR_EVERY)) % REFLECTOR_EVERY; x < W; x += REFLECTOR_EVERY) put(cv, x, g.wallTop + 1, cp('▪'), CORAL[1]);

  // palms: the passes that can still be on screen
  const C = Math.floor(T * 100 + 1e-6);
  const cross = (W + PALM_W) * PALM_STEP;
  const ph0 = Math.max(5, Math.min(24, Math.round(g.roadY * 0.6)));
  for (let k = Math.max(0, Math.floor((T - cross) / PALM_EVERY) - 1), kMax = Math.floor((T + PALM_LEAD + PALM_JITTER) / PALM_EVERY); k <= kMax; k++) {
    const cols = Math.floor((C - Math.round(palmStart(k, S) * 100)) / Math.round(PALM_STEP * 100));
    if (cols < 0) continue;
    const x0 = W - cols;
    if (x0 >= W || x0 + PALM_W <= 0) continue;
    const ph = Math.max(5, Math.min(Math.round(ph0 * (0.9 + 0.2 * rand(S + 65, k, 0))), g.roadY - (g.moon.y + g.moon.h + 1))); // never up to the moon
    const top = g.roadY - ph;
    for (let j = 0; j < PALM.length; j++) { let i = 0; for (const ch of PALM[j]) { if (ch !== ' ') put(cv, x0 + i, top + j, cp(ch), NEAR); i++; } }
    for (let y = top + PALM.length; y < g.roadY; y++) { let i = 0; for (const ch of TRUNK) { if (ch !== ' ') put(cv, x0 + i, y, cp(ch), NEAR); i++; } }
  }

  // the car, standing still, with its headlight beam and tail light
  drawProfile(cv, g.carX, g.carY, T);
  for (let i = 0; i < 3; i++) put(cv, g.carX + 31 + i, g.carY + 2, cp('═'), ICE[0]);
  put(cv, g.carX + 1, g.carY + 2, cp('━'), CORAL[3]);
}

coast.id = 'coast';
coast.kind = 'cells';
export default coast;
