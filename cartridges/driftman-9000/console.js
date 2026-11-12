// The Driftman 9000's console (DRIFT-7 C13): the hook the shell calls, in phases insert, boot and eject, to draw the console body.
//
//   drawConsole(frame, { phase, p, t, rect, screen, tier })     pure; writes only inside rect (and the frame)
//
// p is the morph: 0 is the 2000 as it was a frame ago, 0.55 is the finished 9000 (where an eject folds back from), 1 is the awake
// machine at rest. lib/morph.js says which cell goes or comes when, lib/machine.js holds the cells of the machine, lib/rest.js its
// colours. The shell draws the screen text and the LEDs over this. Tier 'full' is the 84 x 18 console, 'mini' the compact layout's
// 38 x 4 one (no screen, the plain name). A rect smaller than the layout shows the part of it that fits.
import { RGB_CELL, PALETTE_BG, safeHue } from '../../src/pixels.js';
import { plan, LIFE_FROM, DOT_P, SETTLE_P, GREEK_P } from './lib/morph.js';
import { finalColour, mixLinear, lumOf } from './lib/rest.js';
import { K_STATIC, K_FILL, K_NAME } from './lib/machine.js';

const num = (v, d) => (Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// the lightness of a dot: no brighter than graphite (luminance 0.129), on safeHue's 64-row grid
const DOT_L = Math.floor(Math.cbrt(0.09) * 63) / 63;

export default {
  id: 'driftman-9000',
  drawConsole(f, ctx) {
    const rect = ctx && ctx.rect;
    if (!f || !rect) return;
    const rx = Math.trunc(num(rect.x, 0)), ry = Math.trunc(num(rect.y, 0));
    const rw = Math.trunc(num(rect.w, 0)), rh = Math.trunc(num(rect.h, 0));
    if (rw <= 0 || rh <= 0 || !(f.cols > 0) || !(f.rows > 0)) return;
    const cols = f.cols, rows = f.rows;
    const x0 = Math.max(0, rx), y0 = Math.max(0, ry), x1 = Math.min(cols, rx + rw), y1 = Math.min(rows, ry + rh);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * cols + x; f.glyphs[i] = 32; f.shades[i] = 0; }
    const tier = ctx.tier === 'mini' ? 'mini' : 'full';
    const pl = plan(tier);
    const p = clamp(num(ctx.p, 0), 0, 1), t = Math.max(0, num(ctx.t, 0));
    const v = clamp((p - LIFE_FROM) / (1 - LIFE_FROM), 0, 1);

    // the 2000, shed: whole until its cell's time, one dot for DOT_P, then gone
    const dotY = safeHue(200, DOT_L);
    for (const o of pl.olds) {
      if (p >= o.th + (o.dot ? DOT_P : 0)) continue;
      const x = rx + o.x, y = ry + o.y;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      const i = y * cols + x;
      f.shades[i] = RGB_CELL; f.bg[i] = PALETTE_BG;
      if (p <= o.th) { f.glyphs[i] = o.g; f.fg[i] = o.c; } else { f.glyphs[i] = o.dot; f.fg[i] = dotY; }
    }

    // the 9000, unfolded
    for (const c of pl.news) {
      if (p < c.tu) continue;
      const x = rx + c.x, y = ry + c.y;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      const i = y * cols + x;
      f.shades[i] = RGB_CELL;
      if (c.k === K_FILL) { f.glyphs[i] = 32; f.fg[i] = 0; f.bg[i] = finalColour(c, t, v); continue; }
      let colour = finalColour(c, t, v);
      const s = clamp((p - c.tu) / SETTLE_P, 0, 1);
      if (s < 1 && c.k !== K_STATIC) colour = mixLinear(safeHue(200 + 300 * p, Math.cbrt(lumOf(colour))), colour, s);
      let g = c.g;
      if (c.k === K_NAME) {
        const q = p - c.tu;
        if (q < GREEK_P) g = c.greek[0]; else if (q < 2 * GREEK_P) g = c.greek[1];
      }
      f.glyphs[i] = g; f.fg[i] = colour; f.bg[i] = PALETTE_BG;
    }
  },
};
