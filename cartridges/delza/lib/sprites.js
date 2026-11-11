// Delza's pictures: Orrin the lamplighter's apprentice, Pim the moth, the Cinderhorn, the Brambleback and the pine.
// Art is rows of text (a space is clear); ink rows give each cell a hue letter (lower case shade 2, upper case shade 3).
// Every glyph is on the allow-list and none is one the font may lack (no half-moons, no triangles-in-corners, no integral).
import { blit } from './canvas.js';
import { colour } from './palette.js';

// ---- Orrin: 6 wide, 4 tall, two walking frames. The lantern ball is at column 5 of the top row.
export const ORRIN_W = 6;
export const ORRIN_H = 4;
export const ORRIN_LANTERN = Object.freeze({ x: 5, y: 0 });
const ORRIN_INK = [' dd  E', 'hhhhA ', ' hhA  ', 'h  h  '];
export const ORRIN_FRAMES = Object.freeze([
  [' ▄▄  ●', '▐▓▓▌╱ ', ' ▓▓╱  ', '╱  ╲  '],
  [' ▄▄  ●', '▐▓▓▌╱ ', ' ▓▓╱  ', ' ││   '],
]);
// A third picture for the fight: the same Orrin braced, lantern held out (the lantern is at column 5 of the middle row).
export const ORRIN_BRACE = Object.freeze([' ▄▄   ', '▐▓▓▌╱●', ' ▓▓╱  ', '╱  ╲  ']);
export const ORRIN_BRACE_LANTERN = Object.freeze({ x: 5, y: 1 });

const ORRIN_BRACE_INK = [' dd   ', 'hhhhAE', ' hhA  ', 'h  h  '];
export function drawOrrin(cv, x, y, frame, opts = {}) {
  const brace = frame === 'brace';
  blit(cv, x, y, brace ? ORRIN_BRACE : ORRIN_FRAMES[frame & 1], { ink: brace ? ORRIN_BRACE_INK : ORRIN_INK, ...opts });
}

// ---- Pim, the pale moth: two wing positions a quarter second apart.
export const PIM = Object.freeze(['ω', 'v']);
export function drawPim(cv, x, y, beat) {
  blit(cv, x, y, [PIM[beat & 1]], { hue: 'd', shade: 3 });
}

// ---- the Cinderhorn: a stag of embers and charcoal, 15 wide, 6 tall, facing left. Frame 1 has a hoof lifted (pawing).
export const STAG_W = 15;
export const STAG_H = 6;
const STAG_TOP = ['  ψ ψ          ', '   ╲╱          ', '  ▗▓▓▖         ', '   ▝▓▓▄▄▄▄▄▄▄▖ ', '     ▓▓▓▓▓▓▓▓▓▌'];
export const STAG_FRAMES = Object.freeze([
  [...STAG_TOP, '     ▐▌ ▐▌ ▐▌▐▌'],
  [...STAG_TOP, '     ▐▌ ▐▌ ▝▘▐▌'],
]);
// The horns and the embers on its back burn gold, the rest is ember; shade is chosen by the scene (cooling, glow).
const STAG_INK = ['  e e          ', '   ee          ', '  ffff         ', '   ffffffffffff', '     fffffffff ', '     ff ff ffff'];
export function drawStag(cv, x, y, frame, opts = {}) {
  blit(cv, x, y, STAG_FRAMES[frame & 1], { ink: STAG_INK, ...opts });
}

// ---- the Brambleback: a slow moss-covered tortoise whose shell grows a thicket, 12 wide, 4 tall, walking left.
export const BRAMBLE_W = 12;
export const BRAMBLE_H = 4;
export const BRAMBLE = Object.freeze([
  '   ▲ ▲ψ▲    ',
  ' ▄▟▓▒▓▒▓▙▄  ',
  '◀▐█████████▌',
  '  ▝▘ ▝▘▝▘   ',
]);
const BRAMBLE_INK = ['   b bsb    ', ' ccccccccc  ', 'ccccccccccc ', '  cc cccc   '];
export function drawBrambleback(cv, x, y, opts = {}) {
  blit(cv, x, y, BRAMBLE, { ink: BRAMBLE_INK, ...opts });
}

// ---- a pine, 5 wide and h tall (3 or more): a tip, tiers that widen, a trunk. Colour per row from shade `lo` to `hi`.
export const PINE_W = 5;
export function drawPine(cv, x, y, h, lo, hi) {
  if (h < 3) return;
  const tiers = h - 1;
  for (let r = 0; r < tiers; r++) {
    const width = r === 0 ? 1 : r % 2 === 1 ? 3 : 5;
    const art = ' '.repeat((PINE_W - width) / 2) + '▲'.repeat(width);
    const shade = lo + Math.round(((hi - lo) * r) / Math.max(1, tiers - 1));
    blit(cv, x, y + r, [art], { hue: 'b', shade });
  }
  blit(cv, x, y + tiers, ['  █  '], { hue: 'a', shade: 1 });
}

// A stump (burnt, 3 wide, 2 tall) for the Ashen Clearing.
export function drawStump(cv, x, y, shade = 0) {
  blit(cv, x, y, ['▄█▄', '▐▓▌'], { hue: 'a', shade });
}

// The colour of a hue letter at a shade, re-exported so a scene can colour a text of its own.
export { colour };
