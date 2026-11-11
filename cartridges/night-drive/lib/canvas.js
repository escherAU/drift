// A small drawing surface over a scene's glyph and colour buffers, shared by Night Drive's scenes. Every call is clipped to
// the window, so a scene never throws at any size. Glyphs are code points; a space is blank and always colour 0.
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

export function fillRect(cv, x, y, w, h, cp, col) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(cv, x + i, y + j, cp, col);
}

// Draw art (an array of strings, a space is transparent) with its top-left at (x, y).
//   opts.ink   rows of ink letters, one per art cell; opts.map says which palette index each letter is
//   opts.col   one palette index for every cell (used where there is no ink letter for a cell)
export function blit(cv, x, y, art, opts = {}) {
  const { ink, map, col = 0 } = opts;
  for (let j = 0; j < art.length; j++) {
    const inkRow = ink ? ink[j] : null;
    let i = 0;
    for (const ch of art[j]) {
      if (ch !== ' ') {
        const letter = inkRow ? inkRow[i] : undefined;
        const k = letter !== undefined && letter !== ' ' && map && map[letter] !== undefined ? map[letter] : col;
        put(cv, x + i, y + j, ch.codePointAt(0), k);
      }
      i++;
    }
  }
}
