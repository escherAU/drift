// Test helper: draw the help panel over a blank frame and return the code points drawn.
import { drawHelp } from '../src/overlay.js';

export function helpFrame(mode, cols, rows, extra = {}) {
  const glyphs = new Uint16Array(cols * rows).fill(32);
  const shades = new Uint8Array(cols * rows);
  const info = { mode, modeName: mode, sceneName: 'testscene', ui: { text: 15, dim: 7, head: 15 }, ...extra };
  drawHelp(glyphs, shades, cols, rows, info);
  return { glyphs, shades, cols, rows };
}

export function helpFrameGlyphs(mode, cols, rows) {
  return new Set(helpFrame(mode, cols, rows).glyphs);
}

export function frameLines(f) {
  const out = [];
  for (let y = 0; y < f.rows; y++) {
    let s = '';
    for (let x = 0; x < f.cols; x++) s += String.fromCharCode(f.glyphs[y * f.cols + x]);
    out.push(s);
  }
  return out;
}
