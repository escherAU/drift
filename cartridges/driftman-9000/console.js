// The Driftman 9000's console (DRIFT-7 C13). Skeleton: the 2000's body, drawn inside the rect and clipped to it and to the frame.
import { RGB_CELL, PALETTE_BG } from '../../src/pixels.js';
import { old2000 } from './lib/old2000.js';

const num = (v, d) => (Number.isFinite(v) ? v : d);

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
    for (const [lx, ly, g, c] of old2000(tier)) {
      const x = rx + lx, y = ry + ly;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      const i = y * cols + x;
      f.glyphs[i] = g; f.shades[i] = RGB_CELL; f.fg[i] = c; f.bg[i] = PALETTE_BG;
    }
  },
};
