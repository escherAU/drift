// A night skyline: a row of buildings standing on one line, as a list of cells. Shared by Overdrive (the freeway) and any later scene that
// wants a city on the horizon. Pure: the same arguments give the same cells, and nothing is drawn here.
//
//   skylineCells({ x0, x1, base, maxH, seed, cap, salt })
//     x0, x1   first and last column (inclusive)
//     base     the row the buildings stand on (the cells above it are the buildings, rows base - 1 and up)
//     maxH     the tallest a building may be, in rows
//     cap      optional (x) => the most rows a building may have at column x (a building takes the lowest cap of its columns)
//     salt     any integer, to make two skylines in one picture differ
//   Returns [{ x, y, g, c }]: g a code point, c a palette index. A building is 3 to 6 columns wide, roofed with a half block and
//   walled with a full block in a far silhouette (every third one in the near silhouette); lit windows are small squares in sun.1 on
//   every other row, never on the edge columns. The glyphs are only blocks and the small square, so none of them is a line glyph a
//   tunnel ring uses.
import { rand } from '../../../src/scenes/util.js';
import { SUN, FAR, NEAR } from './palette.js';

const cp = (ch) => ch.codePointAt(0);
export const SKY_ROOF = cp('▄');
export const SKY_WALL = cp('█');
export const SKY_WINDOW = cp('▪');

export function skylineCells({ x0, x1, base, maxH, seed = 1, cap = null, salt = 0 }) {
  const out = [];
  let x = x0, k = 0;
  while (x <= x1) {
    const bw = 3 + Math.floor(rand(seed + 71 + salt, k, 0) * 4);
    const xe = Math.min(x1, x + bw - 1);
    let limit = Math.max(0, maxH);
    if (cap) for (let xx = x; xx <= xe; xx++) limit = Math.min(limit, cap(xx));
    if (limit >= 1) {
      const h = Math.max(1, Math.round(limit * (0.4 + 0.6 * rand(seed + 73 + salt, k, 1))));
      const body = k % 3 === 1 ? NEAR : FAR;
      for (let xx = x; xx <= xe; xx++) {
        for (let r = 1; r <= h; r++) {
          const y = base - r;
          let g = r === h ? SKY_ROOF : SKY_WALL, c = body;
          if (r < h && r % 2 === 0 && xx > x && xx < xe && rand(seed + 75 + salt, xx, y) < 0.45) { g = SKY_WINDOW; c = SUN[1]; }
          out.push({ x: xx, y, g, c });
        }
      }
    }
    x = xe + 1 + (rand(seed + 77 + salt, k, 2) < 0.25 ? 1 : 0);
    k++;
  }
  return out;
}
