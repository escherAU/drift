// A small drawing surface over a scene's glyph and colour buffers, shared by Delza's scenes. Every call is clipped to
// the window, so a scene never throws at any size. Glyphs are code points; a space is blank and always colour 0.
import { colour, brighter } from './palette.js';

export function canvas(g, c, w, h) {
  return { g, c, w: w > 0 ? Math.floor(w) : 0, h: h > 0 ? Math.floor(h) : 0 };
}

export function clear(cv) {
  cv.g.fill(32);
  cv.c.fill(0);
}

export function put(cv, x, y, cp, col) {
  const X = Math.floor(x), Y = Math.floor(y);
  if (X < 0 || Y < 0 || X >= cv.w || Y >= cv.h) return;
  const i = Y * cv.w + X;
  cv.g[i] = cp;
  cv.c[i] = cp === 32 ? 0 : col;
}

// Text at (x, y); spaces are skipped, so what lies underneath shows through.
export function text(cv, x, y, str, col) {
  let n = 0;
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp !== 32) put(cv, x + n, y, cp, col);
    n++;
  }
}

// Text that owns its cells, spaces included.
export function label(cv, x, y, str, col) {
  let n = 0;
  for (const ch of String(str)) put(cv, x + n++, y, ch.codePointAt(0), col);
}

export function fillRect(cv, x, y, w, h, cp, col) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(cv, x + i, y + j, cp, col);
}

// Draw art (an array of strings, a space is transparent) with its top-left at (x, y).
//   opts.ink    rows of hue letters a..h, one per art cell: lower case is shade 2, upper case shade 3
//   opts.hue    one hue letter for every cell when there is no ink (default d)
//   opts.shade  force this shade (0 to 3) on every cell, whatever the ink says
//   opts.col    force one palette index on every cell
//   opts.remap  swap hue letters before colouring, e.g. { e: 'f', f: 'h' } (the Cinderhorn cooling)
//   opts.keep   a function (column, row) -> true to draw that cell, false to leave it (a reveal that goes cell by cell)
export function blit(cv, x, y, art, opts = {}) {
  const { ink, hue = 'd', shade, col, remap, keep } = opts;
  for (let j = 0; j < art.length; j++) {
    const row = art[j];
    const inkRow = ink ? ink[j] : null;
    let i = 0;
    for (const ch of row) {
      if (ch !== ' ' && (!keep || keep(x + i, y + j))) {
        let k = col;
        if (k === undefined) {
          let letter = inkRow && inkRow[i] !== undefined && inkRow[i] !== ' ' ? inkRow[i] : hue;
          const lower = letter === letter.toLowerCase();
          letter = letter.toLowerCase();
          if (remap && remap[letter]) letter = remap[letter];
          k = colour(letter, shade !== undefined ? shade : lower ? 2 : 3);
        }
        put(cv, x + i, y + j, ch.codePointAt(0), k);
      }
      i++;
    }
  }
}

// Every non-blank cell inside the ellipse (rx columns, ry rows) around (cx, cy) goes `n` shades up in its own family.
export function glow(cv, cx, cy, rx, ry, n) {
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(cv.w - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(cv.h - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const i = y * cv.w + x;
      if (cv.g[i] !== 32) cv.c[i] = brighter(cv.c[i], n);
    }
  }
}
