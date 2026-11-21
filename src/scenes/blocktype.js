// High contrast / blocktype: big block capitals spelling short words, one word every
// SLOT_SECONDS. Each font pixel is scaled up to a square of s by s half-row pixels and pairs
// of pixel rows are packed into ▀ ▄ █ and space, so the letters are solid and sharp.
//
// Between words (the last TRANSITION_SECONDS of a slot) one of three transitions plays, in
// turn: a wipe (a bar sweeps across and the new word follows it), a scroll (the words slide
// past each other, vertically, in a band that sweeps across) and a wave (a ripple runs across
// the text, the new word behind it rippling and settling). During the hold the word is
// perfectly still, with nothing else on the screen.
//
// Strictly two-tone: colour index 0 only.
//
// DRIFT-11, the flash rules. `ideal(t, w, h, params)` is the picture the scene wants at scene time t (pure in t and seed) and is what the tests of the look read. The scene itself
// is a sim (kind 'sim', stepped from the real-time clock: realClock, src/cells.js) that draws a copy of the ideal which follows it under the per-frame limits of src/scenes/follow.js
// (no more than a share of the cells changes in a step or in a painted frame, so a small screen takes a transition over a few frames). It does NOT use the per-cell gap of that module:
// the ideal itself changes every pixel at most TWICE in a transition (in the wipe the bar passes: old, bar, new; in the scroll and the wave: old, the in-between picture, new), and
// a transition is 6 s from the next, so no cell can change three times in a second whatever the board. The old transitions moved letters across the screen in small steps (a rippled
// column changed with every step of the ripple, a scrolling letter with every pixel of its travel): every cell they touched flipped many times in 1.8 s (L2 81 % on the old scene).
// What it looks like now: the same three transitions, but each stage is a picture that holds still while the sweep goes by, instead of letters sliding smoothly.
import { FONT, GLYPH_W, GLYPH_H } from './blockfont.js';
import { seedOf, timeOf, smooth, pmod } from './util.js';
import { createFollow, follow } from './follow.js';

export const BLOCK_WORDS = ['DRIFT', 'HELLO', 'NEON', 'PIXEL', 'ORBIT', 'WAVES', 'SIGNAL', 'NIGHT'];
export const SLOT_SECONDS = 6;
export const TRANSITION_SECONDS = 1.8;
const STEP_HZ = 30;

// The word of the slot that contains t; the seed rotates the order.
export function wordIndexAt(t, seed = 1) {
  const k = Math.floor(timeOf(t) / SLOT_SECONDS);
  return pmod(k + (seed | 0), BLOCK_WORDS.length);
}

function layout(word, W, Hp) {
  const wordPx = word.length * (GLYPH_W + 1) - 1;
  const sH = Math.floor((W * 0.9) / wordPx), sV = Math.floor((Hp * 0.55) / GLYPH_H);
  const s = Math.max(1, Math.min(sH, sV));
  return { s, x0: Math.floor((W - wordPx * s) / 2), y0: Math.floor((Hp - GLYPH_H * s) / 2) };
}

// Draw word into the pixel buffer px (W wide, Hp tall). o: xlo/xhi clip columns, dy a vertical shift of the whole word,
// colDy(x) per-column vertical shift (integers). A pixel's value depends on its column and the stage only, never on the time.
function drawWord(px, W, Hp, word, L, o) {
  const { s, x0, y0 } = L;
  const ldy = o.dy || 0;
  for (let i = 0; i < word.length; i++) {
    const glyph = FONT[word[i]];
    const lx = x0 + i * (GLYPH_W + 1) * s;
    for (let r = 0; r < GLYPH_H; r++) {
      const row = glyph[r];
      for (let c = 0; c < GLYPH_W; c++) {
        if (row.charCodeAt(c) !== 35) continue;
        for (let sx = 0; sx < s; sx++) {
          const x = lx + c * s + sx;
          if (x < 0 || x >= W || x < o.xlo || x >= o.xhi) continue;
          const dy = ldy + (o.colDy ? o.colDy(x) : 0);
          for (let sy = 0; sy < s; sy++) {
            const y = y0 + r * s + sy + dy;
            if (y >= 0 && y < Hp) px[y * W + x] = 1;
          }
        }
      }
    }
  }
}

// scroll: the stage of a column. The cascade runs left to right: column share c = x / W starts its in-between picture when e reaches c * SCROLL_SPREAD
// and takes the new word SCROLL_MID later (e is the transition's progress, 0 to 1; SCROLL_SPREAD + SCROLL_MID is below 1 + SCROLL_SPREAD so every column is done at e = 1).
const SCROLL_SPREAD = 0.6;
const SCROLL_MID = 0.35;
// wave: the band the new word ripples in behind the front, as a share of the width (at least 8 columns), and the ripple's wavelength
const WAVE_BAND = 0.3;

const clampi = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// The picture at scene time t, into params.glyphs (every cell written) and params.colours (all 0), as a pure function of t and the seed.
export function ideal(t, w, h, params) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const g = params.glyphs, col = params.colours;
  g.fill(32);
  col.fill(0);
  if (W === 0 || H === 0) return;
  const T = timeOf(t), seed = seedOf(params);
  const Hp = H * 2;
  const k = Math.floor(T / SLOT_SECONDS);
  const local = T - k * SLOT_SECONDS;
  const cur = BLOCK_WORDS[wordIndexAt(T, seed)];
  const px = new Uint8Array(W * Hp);
  const tStart = SLOT_SECONDS - TRANSITION_SECONDS;
  if (local < tStart) {
    drawWord(px, W, Hp, cur, layout(cur, W, Hp), { xlo: 0, xhi: W });
  } else {
    const nxt = BLOCK_WORDS[wordIndexAt(T + SLOT_SECONDS, seed)];
    const e = smooth((local - tStart) / TRANSITION_SECONDS);
    const Lc = layout(cur, W, Hp), Ln = layout(nxt, W, Hp);
    const kind = pmod(k, 3);
    if (kind === 0) {
      // wipe: the bar sweeps left to right, the new word behind it. A column is the old word, then the bar, then the new word.
      const xc = Math.round(e * W);
      drawWord(px, W, Hp, nxt, Ln, { xlo: 0, xhi: xc });
      drawWord(px, W, Hp, cur, Lc, { xlo: xc, xhi: W });
      if (xc > 0 && xc < W) {
        const yTop = Math.max(0, Math.min(Lc.y0, Ln.y0) - 1), yBot = Math.min(Hp, Math.max(Lc.y0 + GLYPH_H * Lc.s, Ln.y0 + GLYPH_H * Ln.s) + 1);
        for (let y = yTop; y < yBot; y++) px[y * W + xc] = 1;
      }
    } else if (kind === 1) {
      // scroll: a band sweeps left to right. Ahead of it the old word; in it the in-between picture of a scroll (the old word half way up and out, the new word half way up
      // and in, both at once); behind it the new word. A column is the old word, the in-between picture, the new word: two changes.
      const travel = Math.ceil(Hp / 2 + (GLYPH_H * Math.max(Lc.s, Ln.s)) / 2) + 2;
      const half = Math.round(travel / 2);
      const xB = clampi(Math.round((e / SCROLL_SPREAD) * W), 0, W); // columns left of xB have left the old word
      const xC = clampi(Math.round(((e - SCROLL_MID) / SCROLL_SPREAD) * W), 0, W); // columns left of xC are the new word at rest
      drawWord(px, W, Hp, nxt, Ln, { xlo: 0, xhi: xC });
      drawWord(px, W, Hp, cur, Lc, { xlo: xC, xhi: xB, dy: -half });
      drawWord(px, W, Hp, nxt, Ln, { xlo: xC, xhi: xB, dy: travel - half });
      drawWord(px, W, Hp, cur, Lc, { xlo: xB, xhi: W });
    } else {
      // wave: left of the front the new word, in the band just behind the front rippling, right of it the old word at rest. A column is the old word, the new word
      // rippling, the new word at rest: two changes. The ripple is a fixed pattern of the column (a sine of x), the same whenever a column is in the band.
      const band = Math.max(8, Math.round(W * WAVE_BAND)), amp = Math.max(2, Math.round(Hp * 0.12));
      const front = Math.round(e * (W + band));
      const colDy = (x) => Math.round(amp * Math.sin(x * 0.55));
      const xr = clampi(front, 0, W), xs = clampi(front - band, 0, W);
      drawWord(px, W, Hp, nxt, Ln, { xlo: 0, xhi: xs });
      drawWord(px, W, Hp, nxt, Ln, { xlo: xs, xhi: xr, colDy });
      drawWord(px, W, Hp, cur, Lc, { xlo: xr, xhi: W });
    }
  }
  for (let y = 0; y < H; y++) {
    const a = 2 * y * W, b = a + W;
    for (let x = 0; x < W; x++) {
      const top = px[a + x], bot = px[b + x];
      if (top || bot) g[y * W + x] = top && bot ? 0x2588 : top ? 0x2580 : 0x2584;
    }
  }
}

// ---- the sim: the target (ideal) and the shown picture that follows it
function init(w, h, seed) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const s = { w: W, h: H, seed: seed | 0, sub: 0, F: createFollow(W, H, 0), params: null, targets: 0, slot: -1 };
  s.params = { seed: s.seed, glyphs: s.F.target, colours: new Uint8Array(W * H) };
  retarget(s);
  s.F.shown.set(s.F.target); // the first picture is what the ideal shows at t = 0: nothing is waiting
  s.F.dirty = false;
  return s;
}

function retarget(s) {
  const T = s.sub / STEP_HZ;
  s.slot = Math.floor(T / SLOT_SECONDS);
  ideal(T, s.w, s.h, s.params); // fills F.target in full
  s.targets++;
  s.F.dirty = true;
}

// n: the number of steps the composer runs for this painted frame (src/cells.js), 1 when the caller gives none (renderScene, a test)
function step(s, n = 1) {
  s.sub++;
  if (s.w === 0 || s.h === 0) return;
  const T = s.sub / STEP_HZ;
  // during a hold the ideal does not change: it is worked out again only when a transition is on or a new slot has begun
  if (T - Math.floor(T / SLOT_SECONDS) * SLOT_SECONDS >= SLOT_SECONDS - TRANSITION_SECONDS - 1 / STEP_HZ || Math.floor(T / SLOT_SECONDS) !== s.slot) retarget(s);
  follow(s.F, s.sub, n);
}

function draw(s, params) {
  params.glyphs.set(s.F.shown);
  params.colours.fill(0);
}

export default { id: 'blocktype', kind: 'sim', realClock: true, init, step, draw };
ideal.id = 'blocktype-ideal'; // renderScene(ideal, ...) is the picture the scene wants at t (a pure 'cells' scene), which the tests of the look read
ideal.kind = 'cells';
