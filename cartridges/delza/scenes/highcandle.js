// V. Highcandle at Dusk: the city of nine hundred lamps, and the one that has gone dark. A sky in three bands of shade glyphs (dusk
// violet on top, ember below it, gold at the horizon) over a silhouette of houses and towers, the tallest tower in the middle with
// its Great Lamp unlit.
//
// The dusk is one slow story told once and then held:
//   dusk     the sky steps one shade darker every 6 s (three steps, at 6, 12 and 18 s). Each cell takes its step at its own moment
//            inside a 4 s window, so the sky never changes all at once.
//   stars    from 4 s, one star `·` appears every 1.5 s, in the order of a seeded shuffle (up to 24)
//   windows  from 7 s, one window `▪` lights every 0.4 s (never faster), in the order of a seeded shuffle, warming from dark to gold
//            in three steps of 0.2 s; at most 80 windows ever light, the rest of the city stays dark
//   crows    three Gloamcrows glide across, a column every 0.3 s, their wings flipping `v` and `^` every 0.5 s
//   the lamp at 58 s the Great Lamp rises from dark to full gold in six steps over 3 s, and a halo one shade brighter spreads to
//            every cell within five columns (half as many rows) as it climbs. That is the climax; after it everything holds.
//
// kind 'cells'. Pure in (t, w, h, seed): the seed shapes the skyline, the windows, the stars and the crows' heights.
import { rand } from '../../../src/scenes/util.js';
import { canvas, clear, put, glow } from '../lib/canvas.js';
import { sceneTime, seedOf } from '../lib/clock.js';
import { DUSK, EMBER, GOLD, BARK, STONE, PARCH } from '../lib/palette.js';

export const SKY_STEP = 6, SKY_WINDOW = 4, STAR_FROM = 4, STAR_EVERY = 1.5, STAR_MAX = 24;
export const WINDOW_FROM = 7, WINDOW_EVERY = 0.4, WINDOW_WARM = 0.2, WINDOW_MAX = 80;
export const LAMP_AT = 58, LAMP_RISE = 3, CROW_STEP = 0.3;
const LAMP_COLOUR = [GOLD[0], GOLD[1], GOLD[1], GOLD[2], GOLD[3], GOLD[3]];
const cp = (ch) => ch.codePointAt(0);

export function layoutOf(w, h) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const base = H - Math.max(2, Math.round(H * 0.08)); // the first row of the street
  const horizon = base - Math.max(3, Math.round(H * 0.12)); // the sky's last row; the roofs overlap it
  const towerH = Math.max(7, Math.round(H * 0.5));
  const towerW = W >= 100 ? 9 : 7;
  const cx = Math.floor(W / 2);
  return { W, H, base, horizon, towerH, towerW, cx, towerX: cx - Math.floor(towerW / 2) };
}

// Houses from the left edge to the right, skipping the tower's ground. {x, w, h, roof, shade}
export function buildingsOf(w, h, seed) {
  const L = layoutOf(w, h);
  const out = [];
  const maxH = Math.max(3, Math.round(h * 0.26));
  let x = -1;
  for (let k = 0; x < L.W; k++) {
    const bw = 4 + Math.floor(rand(seed + 3, k, 0) * 6);
    const bh = 3 + Math.floor(rand(seed + 3, k, 1) * (maxH - 2));
    const near = x + bw > L.towerX - 1 && x < L.towerX + L.towerW + 1;
    if (!near) out.push({ x, w: bw, h: Math.min(bh, L.base - 2), roof: rand(seed + 3, k, 2) < 0.5 ? 'peak' : 'flat', shade: rand(seed + 3, k, 3) < 0.4 ? 1 : 0 });
    x += bw + (rand(seed + 3, k, 4) < 0.3 ? 1 : 0);
  }
  return out;
}

// Every window of the city: [{x, y}] in the order they light (a seeded shuffle), capped at WINDOW_MAX.
export function windowsOf(w, h, seed) {
  const L = layoutOf(w, h);
  const all = [];
  for (const b of buildingsOf(w, h, seed)) {
    for (let y = L.base - b.h + 1; y <= L.base - 2; y += 2) {
      for (let x = b.x + 1; x <= b.x + b.w - 2; x += 2) if (x >= 0 && x < L.W && rand(seed + 5, x, y) < 0.7) all.push({ x, y, r: rand(seed + 7, x, y) });
    }
  }
  for (let y = L.base - L.towerH + 3; y <= L.base - 2; y += 3) {
    for (let x = L.towerX + 1; x <= L.towerX + L.towerW - 2; x += 2) if (rand(seed + 5, x, y) < 0.8) all.push({ x, y, r: rand(seed + 7, x, y) });
  }
  all.sort((a, b) => a.r - b.r || a.x - b.x || a.y - b.y);
  return all.slice(0, WINDOW_MAX);
}

// How many windows are lit (or warming) at time T: one more every WINDOW_EVERY from WINDOW_FROM.
export function windowCountAt(T, total) {
  if (T < WINDOW_FROM) return 0;
  return Math.min(total, Math.floor((T - WINDOW_FROM) / WINDOW_EVERY) + 1);
}

// Warmth of a window (0 dark to 3 full gold), `age` seconds after it was lit.
export const warmth = (age) => (age < 0 ? 0 : Math.min(3, 1 + Math.floor(age / WINDOW_WARM)));
// The lamp's level (0 dark to 6 full) at time T.
export const lampLevel = (T) => (T < LAMP_AT ? 0 : Math.min(6, 1 + Math.floor(((T - LAMP_AT) / LAMP_RISE) * 6)));

function highcandle(t, w, h, params) {
  const cv = canvas(params.glyphs, params.colours, w, h);
  clear(cv);
  const W = cv.w, H = cv.h;
  if (W === 0 || H === 0) return;
  const T = sceneTime(t, params);
  const S = seedOf(params);
  const L = layoutOf(W, H);

  // ---- sky: three bands, each cell stepping darker at its own moment inside the 4 s window of each 6 s step
  const bandRows = Math.max(1, L.base + 1);
  const steps = (x, y) => {
    let n = 0;
    for (let k = 1; k <= 3; k++) if (T >= k * SKY_STEP + rand(S + 11, x, y) * SKY_WINDOW - SKY_WINDOW / 2) n++;
    return n;
  };
  for (let y = 0; y <= L.base && y < H; y++) {
    const f = y / bandRows; // 0 top, 1 horizon
    const band = f < 0.4 ? 0 : f < 0.72 ? 1 : 2;
    const fam = [DUSK, EMBER, GOLD][band];
    const glyph = [cp('░'), cp('▒'), cp('▓')][band];
    const dens = [0.5, 0.8, 1][band];
    const start = [2, 3, 3][band];
    for (let x = 0; x < W; x++) {
      if (rand(S + 13, x, y) >= dens) continue;
      put(cv, x, y, glyph, fam[Math.max(0, start - steps(x, y))]);
    }
  }
  // ---- stars, one at a time, only in the sparse violet band
  const starRows = Math.max(1, Math.floor(bandRows * 0.4));
  const starCells = [];
  for (let y = 0; y < starRows; y++) for (let x = 0; x < W; x++) if (rand(S + 13, x, y) >= 0.5 && rand(S + 15, x, y) < 0.08) starCells.push({ x, y, r: rand(S + 17, x, y) });
  starCells.sort((a, b) => a.r - b.r || a.x - b.x || a.y - b.y);
  const stars = T < STAR_FROM ? 0 : Math.min(STAR_MAX, starCells.length, Math.floor((T - STAR_FROM) / STAR_EVERY) + 1);
  for (let i = 0; i < stars; i++) put(cv, starCells[i].x, starCells[i].y, cp('·'), PARCH[2]);

  // ---- crows: three, right to left, a column per 0.3 s, wings flip every 0.5 s
  for (let k = 0; k < 3; k++) {
    const span = W + 16;
    const x = W + 6 - ((Math.floor(T / CROW_STEP) + Math.floor((k * span) / 3) + Math.floor(rand(S + 19, k, 0) * 8)) % span);
    const y = 2 + Math.floor((rand(S + 19, k, 1) * 0.5 + k * 0.15) * Math.max(1, L.horizon - 3)) + (Math.floor(T / 2.4 + k) & 1);
    put(cv, x, y, Math.floor(T / 0.5 + k) & 1 ? cp('^') : cp('v'), STONE[2]);
    put(cv, x + 1, y, Math.floor(T / 0.5 + k) & 1 ? cp('^') : cp('v'), STONE[2]);
  }

  // ---- the city: bark and stone silhouettes
  for (const b of buildingsOf(W, H, S)) {
    for (let y = L.base - b.h + 1; y <= L.base + 1; y++) {
      for (let x = b.x; x < b.x + b.w; x++) put(cv, x, y, cp(b.shade ? '▓' : '█'), b.shade ? STONE[0] : BARK[0]);
    }
    if (b.roof === 'peak') {
      for (let x = b.x; x < b.x + b.w; x++) put(cv, x, L.base - b.h, cp('▲'), b.shade ? STONE[0] : BARK[0]);
    } else {
      for (let x = b.x; x < b.x + b.w; x++) put(cv, x, L.base - b.h, cp('▄'), b.shade ? STONE[0] : BARK[0]);
    }
  }
  // the tallest tower, in the middle, with the lamp room on top
  for (let y = L.base - L.towerH + 1; y <= L.base + 1; y++) for (let x = L.towerX; x < L.towerX + L.towerW; x++) put(cv, x, y, cp('█'), BARK[0]);
  for (let x = L.towerX - 1; x <= L.towerX + L.towerW; x++) put(cv, x, L.base - L.towerH, cp('▄'), STONE[0]);
  const lampY = L.base - L.towerH - 1;
  put(cv, L.cx - 1, lampY, cp('▐'), STONE[1]);
  put(cv, L.cx + 1, lampY, cp('▌'), STONE[1]);
  put(cv, L.cx, lampY - 1, cp('▲'), STONE[1]);
  // the street
  for (let y = L.base + 1; y < H; y++) for (let x = 0; x < W; x++) put(cv, x, y, cp(y === L.base + 1 ? '▄' : '█'), BARK[0]);

  // ---- windows: dark ones everywhere, then the lit ones in their order
  const wins = windowsOf(W, H, S);
  const n = windowCountAt(T, wins.length);
  wins.forEach((win, i) => {
    const age = i < n ? T - (WINDOW_FROM + i * WINDOW_EVERY) : -1;
    const wm = warmth(age);
    put(cv, win.x, win.y, cp('▪'), wm === 0 ? BARK[1] : GOLD[wm]);
  });

  // ---- the Great Lamp, and its halo
  const lv = lampLevel(T);
  put(cv, L.cx, lampY, cp(lv === 0 ? '○' : '●'), lv === 0 ? STONE[1] : LAMP_COLOUR[lv - 1]);
  if (lv >= 3) glow(cv, L.cx, lampY, 5, 2.5, 1);
}

highcandle.id = 'highcandle';
highcandle.kind = 'cells';
export default highcandle;
