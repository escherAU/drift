// II. The Tallow & Tin: the inn at Lowmarrow, a cross-section of one warm room. A stone hearth in the middle, three patrons
// in silhouette at bark tables with their mugs, a cat by the fire, a window with a moon and two stars, the sign in gold.
//
// This is Delza's simulation scene (kind 'sim', a fixed 1/30 s step):
//   fire     an 8x4 patch of ember cells with gold tips; every 0.1 s each cell may move one shade, never to nothing
//   sparks   one rises from the flames every 0.8 s and fades as it climbs
//   smoke    a thread of pipe smoke from the patron on the right
//   mugs     each patron raises a mug every 9 to 14 s (start to start), for 1.2 s
//   cat      flicks its tail every 6 s
// Only the fire patch, the sparks, the smoke, the raised mug and the tail ever change, well under 1% of the screen, and the
// fire never goes out. The warm light is a fixed glow (one shade up) round the hearth, so nothing flickers across the room.
import { rnd, seedState } from '../../../src/scenes/simrng.js';
import { canvas, clear, put, text, blit, glow, fillRect } from '../lib/canvas.js';
import { BARK, STONE, PARCH, GOLD, EMBER, DUSK } from '../lib/palette.js';

const STEP_FIRE = 3; // steps between fire changes (0.1 s)
const SPARK_EVERY = 24; // 0.8 s
const SMOKE_EVERY = 36;
const SPARK_LIFE = 30, SPARK_ROW_STEPS = 4.5;
const SMOKE_LIFE = 56, SMOKE_ROW_STEPS = 12;
const MUG_UP_STEPS = 36;
const TAIL_PERIOD = 180, TAIL_FLICK = 12;
const FIRE_W = 8, FIRE_H = 4;
const cp = (ch) => ch.codePointAt(0);
// fire glyphs by row (0 = the tips) and heat 0 to 3: flames climb from solid to spark
const FIRE_GLYPHS = [
  [cp('·'), cp("'"), cp('^'), cp('▲')],
  [cp('░'), cp('▒'), cp('▲'), cp('▲')],
  [cp('░'), cp('▒'), cp('▓'), cp('▓')],
  [cp('▒'), cp('▓'), cp('▓'), cp('█')],
];

export function layoutOf(w, h) {
  const fy = h - Math.max(3, Math.round(h * 0.16)); // the floor's top row
  const cx = Math.floor(w / 2);
  return {
    fy, cx,
    fireX: cx - 4, fireY: fy - 5,
    patrons: [Math.round(w * 0.16), Math.round(w * 0.7), Math.round(w * 0.84)],
    catX: cx + 11,
    windowX: Math.round(w * 0.14),
  };
}

function init(w, h, seed) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const s = { w: W, h: H, rs: seedState(seed, 0x7a11), steps: 0, fire: new Uint8Array(FIRE_W * FIRE_H), sparks: [], smoke: [], patrons: [] };
  for (let i = 0; i < s.fire.length; i++) s.fire[i] = 1 + Math.floor(rnd(s) * 3); // 1 to 3
  for (let i = 0; i < 3; i++) s.patrons.push({ cd: Math.floor((4 + rnd(s) * 10 + i * 2) * 30), up: 0 });
  return s;
}

function step(s) {
  s.steps++;
  if (s.w === 0 || s.h === 0) return;
  if (s.steps % STEP_FIRE === 0) {
    for (let i = 0; i < s.fire.length; i++) {
      const row = Math.floor(i / FIRE_W);
      const r = rnd(s);
      const v = s.fire[i] + (r < 0.1 ? -1 : r > 0.9 ? 1 : 0);
      const lo = row === FIRE_H - 1 ? 2 : 1, hi = row === 0 ? 2 : 3; // the base burns hot, the tips never flare to white
      s.fire[i] = v < lo ? lo : v > hi ? hi : v;
    }
  }
  if (s.steps % SPARK_EVERY === 0) s.sparks.push({ x: Math.floor(rnd(s) * FIRE_W), born: s.steps, lean: rnd(s) < 0.5 ? -1 : 1 });
  if (s.steps % SMOKE_EVERY === 0) s.smoke.push({ born: s.steps, ph: rnd(s) * 6.28 });
  s.sparks = s.sparks.filter((k) => s.steps - k.born < SPARK_LIFE);
  s.smoke = s.smoke.filter((k) => s.steps - k.born < SMOKE_LIFE);
  for (const p of s.patrons) {
    if (p.up > 0) p.up--;
    else if (--p.cd <= 0) { p.up = MUG_UP_STEPS; p.cd = Math.floor((7.8 + rnd(s) * 5) * 30); } // 9 to 14 s from one raise to the next, counting the 1.2 s the mug is up
  }
}

const HEAD = [' ▄▄▄ ', '▐███▌', ' ▀▀▀ '];
const CAT = [' ▲▲  ', '▐▓▓▌'];

function draw(s, params) {
  const cv = canvas(params.glyphs, params.colours, s.w, s.h);
  clear(cv);
  const W = cv.w, H = cv.h;
  if (W === 0 || H === 0) return;
  const L = layoutOf(W, H);
  const { fy, cx } = L;

  // roof beam, timber posts, the sign on two chains
  for (let x = 0; x < W; x++) put(cv, x, 0, cp('▄'), BARK[0]);
  for (let y = 1; y < fy; y++) { put(cv, 2, y, cp('█'), BARK[0]); put(cv, W - 3, y, cp('█'), BARK[0]); }
  const sign = '◆ THE TALLOW & TIN ◆';
  const sx = cx - Math.floor(sign.length / 2);
  put(cv, sx + 2, 1, cp('│'), BARK[1]);
  put(cv, sx + sign.length - 3, 1, cp('│'), BARK[1]);
  text(cv, sx, 2, sign, GOLD[3]);
  for (let i = 0; i < sign.length; i++) put(cv, sx + i, 3, cp('▀'), BARK[1]);

  // the chimney breast climbs from the hearth to the beam; two lamps hang on chains; shelves of tin and tankards each side
  for (let y = 5; y < fy - 9; y++) for (let x = cx - 4; x < cx + 4; x++) put(cv, x, y, (x + y) % 3 === 0 ? cp('▓') : cp('█'), STONE[0]);
  if (W >= 100) { // the lamps and shelves need the width (not at 80 columns)
    const lampY = Math.max(6, Math.round(fy * 0.4));
    for (const lx of [cx - 28, cx + 27]) {
      for (let y = 1; y < lampY; y++) put(cv, lx, y, cp('│'), BARK[0]);
      put(cv, lx, lampY, cp('◆'), GOLD[1]);
    }
    for (const [sx0, sy] of [[cx - 24, fy - 17], [cx + 14, fy - 13], [cx - 18, fy - 12]]) {
      for (let i = 0; i < 14; i++) put(cv, sx0 + i, sy, cp('▀'), BARK[1]);
      for (let i = 1; i < 14; i += 3) put(cv, sx0 + i, sy - 1, i % 2 ? cp('▪') : cp('○'), STONE[1]);
    }
  }

  // the floor
  for (let x = 0; x < W; x++) put(cv, x, fy, cp('▀'), BARK[2]);
  for (let y = fy + 1; y < H; y++) for (let x = 0; x < W; x++) put(cv, x, y, (x + y) % 5 === 0 ? cp('░') : cp('▒'), BARK[0]);

  // the window with a moon and two stars
  if (W >= 60) {
    const wx = L.windowX, wy = 6;
    const box = '╔═╗║╝═╚║';
    fillRect(cv, wx, wy, 7, 5, 32, 0);
    for (let i = 1; i < 6; i++) { put(cv, wx + i, wy, cp(box[1]), STONE[1]); put(cv, wx + i, wy + 4, cp(box[5]), STONE[1]); }
    for (let j = 1; j < 4; j++) { put(cv, wx, wy + j, cp(box[7]), STONE[1]); put(cv, wx + 6, wy + j, cp(box[3]), STONE[1]); }
    put(cv, wx, wy, cp(box[0]), STONE[1]); put(cv, wx + 6, wy, cp(box[2]), STONE[1]);
    put(cv, wx, wy + 4, cp(box[6]), STONE[1]); put(cv, wx + 6, wy + 4, cp(box[4]), STONE[1]);
    put(cv, wx + 2, wy + 1, cp('○'), PARCH[3]);
    put(cv, wx + 4, wy + 2, cp('·'), PARCH[2]);
    put(cv, wx + 3, wy + 3, cp('·'), PARCH[1]);
  }

  // the hearth: pillars, a lintel, logs
  const hx0 = cx - 9, hx1 = cx + 8, top = fy - 8;
  for (let y = top; y < fy; y++) {
    for (let x = hx0; x <= hx1; x++) {
      const post = x < hx0 + 3 || x > hx1 - 3;
      const lintel = y < top + 2;
      if (!post && !lintel) continue;
      put(cv, x, y, (x * 7 + y * 3) % 4 === 0 ? cp('▓') : cp('█'), STONE[1]);
    }
  }
  for (let x = hx0 - 1; x <= hx1 + 1; x++) put(cv, x, top - 1, cp('▄'), STONE[2]);
  for (let x = 0; x < FIRE_W; x++) put(cv, L.fireX + x, fy - 1, cp('▀'), BARK[2]);

  // patrons at their tables; a mug in front of each
  const mugUp = (i) => s.patrons[i].up > 0;
  for (let i = 0; i < 3; i++) {
    const px = L.patrons[i];
    blit(cv, px, fy - 5, HEAD, { hue: 'g', shade: 0 });
    for (let k = -1; k < 8; k++) put(cv, px + k, fy - 2, cp('▄'), BARK[2]);
    put(cv, px, fy - 1, cp('▌'), BARK[1]); put(cv, px + 6, fy - 1, cp('▐'), BARK[1]);
    if (mugUp(i)) { put(cv, px + 5, fy - 4, cp('▪'), STONE[2]); put(cv, px + 5, fy - 3, cp('╱'), DUSK[0]); } else put(cv, px + 6, fy - 3, cp('▪'), STONE[2]);
  }

  // the cat by the fire; its tail flicks for 0.4 s in every 6
  const tail = s.steps % TAIL_PERIOD < TAIL_FLICK ? '-' : '~';
  blit(cv, L.catX, fy - 2, CAT, { hue: 'a', shade: 2 });
  put(cv, L.catX + 4, fy - 1, cp(tail), BARK[2]);

  // the fixed warm light round the hearth (everything drawn so far, one shade up)
  glow(cv, cx, fy - 4, 13, 5, 1);

  // the fire: ember cells, gold at the tips
  for (let i = 0; i < s.fire.length; i++) {
    const row = Math.floor(i / FIRE_W), col = i % FIRE_W;
    const v = s.fire[i];
    put(cv, L.fireX + col, L.fireY + row, FIRE_GLYPHS[row][v], (row === 0 ? GOLD : EMBER)[v]);
  }

  // sparks climb out of the flames and fade
  for (const k of s.sparks) {
    const age = s.steps - k.born;
    const y = L.fireY - 1 - Math.floor(age / SPARK_ROW_STEPS);
    const x = L.fireX + k.x + k.lean * Math.floor(age / 12);
    const shade = age < 10 ? 3 : age < 20 ? 2 : 1;
    put(cv, x, y, age < 20 ? cp('·') : cp('°'), GOLD[shade]);
  }

  // pipe smoke from the right-hand patron
  const bx = L.patrons[1] + 1, by = fy - 6;
  for (const k of s.smoke) {
    const age = s.steps - k.born;
    const y = by - Math.floor(age / SMOKE_ROW_STEPS);
    const x = bx + Math.round(Math.sin(age / 18 + k.ph));
    put(cv, x, y, age < SMOKE_LIFE / 2 ? cp('°') : cp('·'), PARCH[age < SMOKE_LIFE / 2 ? 1 : 0]);
  }
}

export default { id: 'tallow', kind: 'sim', init, step, draw };
