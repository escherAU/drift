// I. The Thornwell Path: a forest walk with parallax. Orrin stands about a third of the way across while the world slides
// past him, every layer at its own pace (whole columns, never a smear):
//   mist (parchment, top rows) 1 column per 3 s     far ridge 1 per 2 s     pines 1 per 0.6 s
//   ground and stones 1 per 0.3 s                   near trunks 1 per 0.15 s, about one every 15 s
// Orrin's two walking frames alternate every 0.35 s; Pim the moth circles the lantern; the lantern lights every cell within
// four columns one shade brighter, and the glow travels with Orrin, so it never flickers. A Brambleback ambles across the
// mid-ground every 40 to 60 s. At 80x24 (under 100 columns or 30 rows) the far ridge is dropped and the pines are shorter.
//
// kind 'cells'. Pure in (t, w, h, seed): every layer's place is a hash of its column and the seed.
import { rand } from '../../../src/scenes/util.js';
import { canvas, clear, put, glow } from '../lib/canvas.js';
import { sceneTime, seedOf } from '../lib/clock.js';
import { MOSS, BARK, PARCH } from '../lib/palette.js';
import { drawOrrin, drawPim, drawPine, drawBrambleback, ORRIN_H, ORRIN_LANTERN, PINE_W, BRAMBLE_W, BRAMBLE_H } from '../lib/sprites.js';

export const MIST_STEP = 3, RIDGE_STEP = 2, PINE_STEP = 0.6, GROUND_STEP = 0.3, TRUNK_STEP = 0.15, BRAMBLE_STEP = 0.25;
const PINE_SPACING = 9;
const ORBIT = [[3, 0], [2, 1], [0, 1], [-2, 1], [-3, 0], [-2, -1], [0, -1], [2, -1]];

const cp = (ch) => ch.codePointAt(0);
const BLOCK = { light: cp('░'), mid: cp('▒'), dark: cp('▓'), full: cp('█'), tri: cp('▲'), dot: cp('·') };

export function layoutOf(w, h) {
  const gh = Math.max(3, Math.round(h * 0.22));
  const small = w < 100 || h < 30;
  return { gh, gy: h - gh, small, hmin: small ? 3 : 4, hmax: small ? 6 : 8 };
}

function thornwell(t, w, h, params) {
  const cv = canvas(params.glyphs, params.colours, w, h);
  clear(cv);
  const W = cv.w, H = cv.h;
  if (W === 0 || H === 0) return;
  const T = sceneTime(t, params);
  const S = seedOf(params);
  const { gy, gh, small, hmin, hmax } = layoutOf(W, H);

  // mist: soft clumps of light shade across the top rows
  const mistOff = Math.floor(T / MIST_STEP);
  const mistRows = small ? 2 : 3;
  for (let y = 0; y < Math.min(mistRows, H); y++) {
    for (let x = 0; x < W; x++) if (rand(S + 1, (x + mistOff) >> 1, y) < 0.3) put(cv, x, y, BLOCK.light, PARCH[0]);
  }

  // far ridge: a line of tiny triangles above the pines (not at 80x24)
  if (!small) {
    const ridgeOff = Math.floor(T / RIDGE_STEP);
    for (let x = 0; x < W; x++) {
      const wx = x + ridgeOff;
      if (wx % 2 !== 0) continue;
      const peak = Math.floor(rand(S + 3, wx >> 2, 0) * 3);
      put(cv, x, gy - hmax - 2 - peak, BLOCK.tri, MOSS[0]);
    }
  }

  // pines: slot k sits near column k * 9, 4 to 8 rows tall; every third one is further away and darker
  const pineOff = Math.floor(T / PINE_STEP);
  const k0 = Math.floor(pineOff / PINE_SPACING) - 1, k1 = Math.floor((pineOff + W + PINE_W) / PINE_SPACING) + 1;
  for (let k = k0; k <= k1; k++) {
    const px = k * PINE_SPACING + Math.floor(rand(S + 5, k, 1) * 5) - pineOff;
    const ph = hmin + Math.floor(rand(S + 5, k, 2) * (hmax - hmin + 1));
    const far = (((k % 3) + 3) % 3) === 0;
    drawPine(cv, px, gy - ph, ph, far ? 0 : 1, far ? 1 : 2);
  }

  // the Brambleback crosses the mid-ground (behind the path), one start in each 50 s
  const bk = Math.floor(T / 50);
  const bs = bk * 50 + 15 + Math.floor(rand(S + 13, bk, 0) * 10); // starts 40 to 60 s apart
  if (T >= bs) {
    const bx = W + 1 - Math.floor((T - bs) / BRAMBLE_STEP);
    if (bx > -BRAMBLE_W) drawBrambleback(cv, bx, gy - BRAMBLE_H);
  }

  // ground: moss with a bark-brown path along its first rows; stones move with the ground
  const groundOff = Math.floor(T / GROUND_STEP);
  for (let y = Math.max(0, gy); y < H; y++) {
    const path = y > gy && y <= gy + 2;
    for (let x = 0; x < W; x++) {
      const r = rand(S + 9, x + groundOff, y);
      if (r > (path ? 0.9 : 0.965)) put(cv, x, y, BLOCK.dot, PARCH[1]);
      else if (path) put(cv, x, y, BLOCK.light, BARK[1]);
      else put(cv, x, y, BLOCK.mid, y === gy ? MOSS[2] : MOSS[1]);
    }
  }

  // near trunks: dark on dark, so one passing cannot flash
  const tk = Math.floor(T / 15);
  for (let k = tk - 1; k <= tk; k++) {
    const ts = k * 15 + Math.floor(rand(S + 11, k, 0) * 6);
    if (T < ts) continue;
    const tx = W + 3 - Math.floor((T - ts) / TRUNK_STEP);
    if (tx < -3) continue;
    for (let y = 0; y < H; y++) {
      put(cv, tx, y, BLOCK.dark, BARK[0]);
      put(cv, tx + 1, y, BLOCK.full, BARK[1]);
      put(cv, tx + 2, y, BLOCK.dark, BARK[0]);
    }
  }

  // Orrin, his lantern, Pim and the glow
  const ox = Math.round(W * 0.3) - 3, oy = gy + 3 - ORRIN_H;
  drawOrrin(cv, ox, oy, Math.floor(T / 0.35));
  const lx = ox + ORRIN_LANTERN.x, ly = oy + ORRIN_LANTERN.y;
  const beat = Math.floor(T / 0.25);
  const [dx, dy] = ORBIT[beat & 7];
  drawPim(cv, lx + dx, ly + dy, beat);
  glow(cv, lx, ly, 4, 2, 1);
}

thornwell.id = 'thornwell';
thornwell.kind = 'cells';
export default thornwell;
