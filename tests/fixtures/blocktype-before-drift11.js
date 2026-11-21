// High contrast / blocktype: big block capitals spelling short words, one word every
// SLOT_SECONDS. Each font pixel is scaled up to a square of s by s half-row pixels and pairs
// of pixel rows are packed into ▀ ▄ █ and space, so the letters are solid and sharp.
//
// Between words (the last TRANSITION_SECONDS of a slot) one of three transitions plays, in
// turn: a wipe (a bar sweeps across and the new word follows it), a scroll (the letters
// lift away one after another while the next word rises into place) and a wave (a ripple
// runs across the text and swaps the word as it passes). During the hold the word is
// perfectly still, with nothing else on the screen.
//
// Strictly two-tone: colour index 0 only. kind 'cells', pure in t and seed.
import { FONT, GLYPH_W, GLYPH_H } from './blockfont.js';
import { seedOf, timeOf, smooth, pmod } from './util.js';

export const BLOCK_WORDS = ['DRIFT', 'HELLO', 'NEON', 'PIXEL', 'ORBIT', 'WAVES', 'SIGNAL', 'NIGHT'];
export const SLOT_SECONDS = 6;
export const TRANSITION_SECONDS = 1.8;

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

// Draw word into the pixel buffer px (W wide, Hp tall). o: xlo/xhi clip columns,
// letterDy[i] per-letter vertical shift, colDy(x) per-column vertical shift (integers).
function drawWord(px, W, Hp, word, L, o) {
  const { s, x0, y0 } = L;
  for (let i = 0; i < word.length; i++) {
    const glyph = FONT[word[i]];
    const lx = x0 + i * (GLYPH_W + 1) * s;
    const ldy = o.letterDy ? o.letterDy[i] : 0;
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

const SPREAD = 0.9; // scroll: how far the letters' start times are spread over the transition

export default function blocktype(t, w, h, params) {
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
      // wipe: the bar sweeps left to right, the new word behind it
      const xc = Math.round(e * W);
      drawWord(px, W, Hp, nxt, Ln, { xlo: 0, xhi: xc });
      drawWord(px, W, Hp, cur, Lc, { xlo: xc, xhi: W });
      if (xc > 0 && xc < W) {
        const yTop = Math.max(0, Math.min(Lc.y0, Ln.y0) - 1), yBot = Math.min(Hp, Math.max(Lc.y0 + GLYPH_H * Lc.s, Ln.y0 + GLYPH_H * Ln.s) + 1);
        for (let y = yTop; y < yBot; y++) px[y * W + xc] = 1;
      }
    } else if (kind === 1) {
      // scroll: letters leave upwards one after another, the next word rises from below
      const travel = Math.ceil(Hp / 2 + (GLYPH_H * Math.max(Lc.s, Ln.s)) / 2) + 2;
      const prog = (i, n) => Math.min(1, Math.max(0, e * (1 + SPREAD) - (i / Math.max(1, n - 1)) * SPREAD));
      const up = Array.from(cur, (_, i) => -Math.round(prog(i, cur.length) * travel));
      const rise = Array.from(nxt, (_, i) => Math.round((1 - prog(i, nxt.length)) * travel));
      drawWord(px, W, Hp, cur, Lc, { xlo: 0, xhi: W, letterDy: up });
      drawWord(px, W, Hp, nxt, Ln, { xlo: 0, xhi: W, letterDy: rise });
    } else {
      // wave: a ripple crosses the text; left of its front the new word, right of it the old
      const sigma = Math.max(4, W * 0.1), amp = Math.max(3, Hp * 0.12);
      const front = e * (W + 5 * sigma) - 2.5 * sigma;
      const colDy = (x) => {
        const d = (x - front) / sigma;
        return Math.round(amp * Math.exp(-d * d) * Math.sin((x - front) * 0.55));
      };
      const xc = Math.min(W, Math.max(0, Math.round(front)));
      drawWord(px, W, Hp, nxt, Ln, { xlo: 0, xhi: xc, colDy });
      drawWord(px, W, Hp, cur, Lc, { xlo: xc, xhi: W, colDy });
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
blocktype.id = 'blocktype';
blocktype.kind = 'cells';
