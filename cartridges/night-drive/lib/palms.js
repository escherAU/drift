// Sundown Grid's scenery: the palms at the edges and the wireframe mountains between them and the sun. Art and placement only.
import { rand } from '../../../src/scenes/util.js';
import { put } from './canvas.js';

export const PALM_W = 15;
export const PALM_H = 13;
// A crown of four rows (fronds, then the hanging tips) on a straight trunk with a flared foot. A space is transparent.
export const PALM = Object.freeze([
  '  ▄▄▀▀▄ ▄▀▀▄▄  ',
  ' ▀   ▄▀█▀▄   ▀ ',
  '    ▄▀ █ ▀▄    ',
  '   ▀   █   ▀   ',
  '       █       ',
  '       █       ',
  '       █       ',
  '       █       ',
  '       █       ',
  '       █       ',
  '       █       ',
  '       █       ',
  '      ▟█▙      ',
]);
// The frond that sways: the outer tip on row 1, which steps one cell outward and back.
export const PALM_TIP = Object.freeze({ row: 1, left: 1, right: 13 });

// Draw a palm with its top-left at (x, y). `side` is -1 for the left palm and 1 for the right; `out` puts its swaying tip one cell out.
export function drawPalm(cv, x, y, side, out, col) {
  const tipCol = side < 0 ? PALM_TIP.left : PALM_TIP.right;
  for (let j = 0; j < PALM.length; j++) {
    let i = 0;
    for (const ch of PALM[j]) {
      if (ch !== ' ' && !(j === PALM_TIP.row && i === tipCol)) put(cv, x + i, y + j, ch.codePointAt(0), col);
      i++;
    }
  }
  put(cv, x + tipCol + (out ? side : 0), y + PALM_TIP.row, '▀'.codePointAt(0), col);
}

// A mountain: a two-cell peak and a cap, then two wireframe edges one column further apart on every row. Its base is the row `base`
// and it is `hm` rows tall and 2 * hm wide, its peak cells at px and px + 1.
export function drawMountain(cv, px, base, hm, col) {
  for (let r = 0; r < hm; r++) {
    const y = base - hm + 1 + r;
    if (r === 0) {
      put(cv, px, y, '▗'.codePointAt(0), col);
      put(cv, px + 1, y, '▖'.codePointAt(0), col);
    } else if (r === 1) {
      put(cv, px - 1, y, '╱'.codePointAt(0), col);
      put(cv, px, y, '▟'.codePointAt(0), col);
      put(cv, px + 1, y, '▙'.codePointAt(0), col);
      put(cv, px + 2, y, '╲'.codePointAt(0), col);
    } else {
      put(cv, px - r, y, '╱'.codePointAt(0), col);
      put(cv, px + 1 + r, y, '╲'.codePointAt(0), col);
    }
  }
}

// The mountains in [lo, hi] (columns, inclusive): left to right, seeded heights from hmin to hmax, a little overlap allowed.
export function mountainsIn(lo, hi, hmin, hmax, seed, salt) {
  const out = [];
  let x = lo, k = 0;
  while (hi - x + 1 >= 2 * hmin) {
    let hm = hmin + Math.floor(rand(seed + 61, k, salt) * (hmax - hmin + 1));
    hm = Math.min(hm, Math.floor((hi - x + 1) / 2));
    out.push({ px: x + hm - 1, hm });
    x += 2 * hm - 1 + Math.floor(rand(seed + 63, k, salt) * 3);
    k++;
  }
  return out;
}
