// Night Drive's pictures: the Vantra Halcyon (a made-up low wedge coupe: long nose, short tail, a full-width tail-light bar, a
// louvred rear window, plate NITE86), seen from behind at two sizes, from the side, and as the car ahead on the road.
// Art is rows of text (a space is clear); ink rows give each cell an ink letter (see INK_COLOURS). Every glyph is on the
// allow-list and none is one the font may lack: no triangles-in-corners, no half-moons, no integral. The wheels of the profile
// are a four-step spinner (a vertical, a slash, a dash, a backslash) because the round wheel glyphs are not safe.
import { blit, put } from './canvas.js';
import { VIOLET, MAG, CYAN, CORAL, ICE, FAR } from './palette.js';

// ink letters: b body, m roof and shoulder edge, w window, t tail lights, p plate, y tyre, h headlight
export const INK_COLOURS = Object.freeze({ b: VIOLET[1], m: MAG[1], w: CYAN[0], t: CORAL[3], p: ICE[2], y: FAR, h: ICE[3] });

const sp = (n) => ' '.repeat(n);
const rep = (ch, n) => ch.repeat(n);

// ---- the Halcyon from behind, 34 wide and 7 tall
export const REAR_34_W = 34;
export const REAR_34_H = 7;
export const REAR_34 = Object.freeze([
  sp(8) + '▗' + rep('▄', 16) + '▖' + sp(8),
  sp(6) + '▗▛' + rep('░', 18) + '▜▖' + sp(6),
  sp(3) + '▗▄▄▟' + rep('▀', 20) + '▙▄▄▖' + sp(3),
  '  ▐██' + rep('━', 24) + '██▌  ',
  '  ▐' + rep('█', 9) + '▌ NITE86 ▐' + rep('█', 9) + '▌  ',
  '  ▐' + rep('▀', 28) + '▌  ',
  '   ▐██▌' + sp(20) + '▐██▌   ',
]);

// ---- the same car, small (80x24 and the tunnel): 20 wide and 4 tall, no plate
export const REAR_20_W = 20;
export const REAR_20_H = 4;
export const REAR_20 = Object.freeze([
  sp(4) + '▗' + rep('▄', 10) + '▖' + sp(4),
  '  ▗▟' + rep('▀', 12) + '▙▖  ',
  ' ▐█' + rep('━', 14) + '█▌ ',
  '  ▐▌' + sp(12) + '▐▌  ',
]);

// ---- the profile, facing right: 33 wide and 4 tall. The wheels are drawn on top of the last row, at PROFILE_WHEELS.
export const PROFILE_W = 33;
export const PROFILE_H = 4;
export const PROFILE_33 = Object.freeze([
  sp(8) + '▗' + rep('▄', 8) + '▖' + sp(15),
  sp(5) + '▗▄▟▀' + rep('░', 8) + '▀▙' + rep('▄', 8) + '▖' + sp(5),
  '  ▐' + rep('█', 27) + '▌  ',
  '   ▝▀' + sp(3) + rep('▀', 16) + sp(3) + '▀▀▀▘' + sp(2),
]);
export const PROFILE_WHEELS = Object.freeze([{ x: 5, y: 3 }, { x: 24, y: 3 }]);

// ---- the car ahead, closing: tail lights only (drawn by the scene), then 6x2, then 12x3
export const CAR_AHEAD_6 = Object.freeze([' ▗▄▄▖ ', '▐━━━━▌']);
export const CAR_AHEAD_12 = Object.freeze([
  ' ▗' + rep('▄', 8) + '▖ ',
  '▐█' + rep('━', 8) + '█▌',
  ' ▀▀' + sp(6) + '▀▀ ',
]);

// ink for an art cell, by its glyph and row (the same car gets the same colours at every size)
function inkRows(art, { tail, head } = {}) {
  const last = art.length - 1;
  return Object.freeze(art.map((row, j) => {
    let out = '';
    let i = 0;
    for (const ch of row) {
      let k;
      if (ch === ' ') k = ' ';
      else if (tail && tail.row === j && tail.cols.includes(i)) k = 't';
      else if (head && head.row === j && head.cols.includes(i)) k = 'h';
      else if (ch === '░') k = 'w';
      else if (ch === '━') k = 't';
      else if (/[A-Z0-9]/.test(ch)) k = 'p';
      else if (j === last && art === REAR_34) k = 'y';
      else if (j === last && art === REAR_20) k = 'y';
      else if (j === 0) k = 'm';
      else if ('▗▖▛▜▟▙▄'.includes(ch) && j <= 2) k = 'm';
      else k = 'b';
      out += k;
      i++;
    }
    return out;
  }));
}
export const REAR_34_INK = inkRows(REAR_34);
export const REAR_20_INK = inkRows(REAR_20);
export const PROFILE_INK = inkRows(PROFILE_33, { tail: { row: 2, cols: [3, 4] }, head: { row: 2, cols: [28, 29] } });
export const AHEAD_6_INK = inkRows(CAR_AHEAD_6);
export const AHEAD_12_INK = inkRows(CAR_AHEAD_12);

export function drawRear34(cv, x, y) { blit(cv, x, y, REAR_34, { ink: REAR_34_INK, map: INK_COLOURS }); }
export function drawRear20(cv, x, y) { blit(cv, x, y, REAR_20, { ink: REAR_20_INK, map: INK_COLOURS }); }
export function drawAhead6(cv, x, y) { blit(cv, x, y, CAR_AHEAD_6, { ink: AHEAD_6_INK, map: INK_COLOURS }); }
export function drawAhead12(cv, x, y) { blit(cv, x, y, CAR_AHEAD_12, { ink: AHEAD_12_INK, map: INK_COLOURS }); }

// ---- the wheel spinner: one step every 0.25 s, four to the turn; parked it rests on a plus
export const WHEEL_FRAMES = Object.freeze(['▐│▌', '▐╱▌', '▐─▌', '▐╲▌']);
export const WHEEL_PARKED = '▐┼▌';
export const WHEEL_STEP = 0.25;
export function wheelGlyph(t, parked = false) {
  if (parked) return WHEEL_PARKED;
  const T = Number.isFinite(t) && t > 0 ? t : 0;
  return WHEEL_FRAMES[Math.floor(T / WHEEL_STEP) & 3];
}

// The profile with its wheels at time t (parked = the car is standing still).
export function drawProfile(cv, x, y, t, parked = false) {
  blit(cv, x, y, PROFILE_33, { ink: PROFILE_INK, map: INK_COLOURS });
  const wheel = wheelGlyph(t, parked);
  for (const wh of PROFILE_WHEELS) {
    let i = 0;
    for (const ch of wheel) {
      put(cv, x + wh.x + i, y + wh.y, ch.codePointAt(0), ch === '▐' || ch === '▌' ? FAR : ICE[1]);
      i++;
    }
  }
}
