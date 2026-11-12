// The morph from the 2000 to the 9000: when each cell of the old body goes and when each cell of the new machine arrives.
//
// p runs 0 to 1 across the insert and the boot; the shell hands over at p = 0.55 (the end of the insert, and where an eject
// starts folding back), so the SHAPE of the change is finished by 0.55 and only light is left for the boot:
//   shed    0 - 0.30   a 2000-only cell becomes one braille dot (hue 200, no brighter than what it replaces) for one frame, then goes;
//                      the cells at the edge of the console go first, the rest in a scatter
//   unfold  0.10 - 0.55  a 9000 cell appears when the drawing has grown out from the slot to it (the centre line first), enters at
//                      hue 200 + 300p and settles to its own colour over SETTLE_P; the pane's glass fills in as a scatter;
//                      each name letter shows two Greek letters, then lands
//   light   0.55 - 1   hue only (rest.js, the fan): every light opens from ion to its resting hue, the centre first
import { old2000 } from './old2000.js';
import { machine, K_STATIC, K_FILL, K_NAME } from './machine.js';

export const LIFE_FROM = 0.55; // p where the shape is whole (the shell's INSERT_MORPH)
export const SHED_END = 0.30;
export const DOT_P = 0.06; // a shed cell shows its dot for this much p (one insert frame is 0.061)
export const UNFOLD_FROM = 0.10;
export const UNFOLD_SPAN = 0.42; // strokes and glass arrive between UNFOLD_FROM and UNFOLD_FROM + UNFOLD_SPAN (0.43)
export const UNFOLD_Q = 0.8;
export const SETTLE_P = 0.06; // a light cell shows its entry hue for one insert frame, then its own colour
export const GREEK_P = 0.06; // each of the two Greek letters of a name letter lasts this long
export const DOTS = [0x2801, 0x2802, 0x2804, 0x2840];
export const DOT_SHARE = 0.15; // the share of shed cells that show a dot on the way out; the rest go at once (the cell budget)

// a stable scatter in [0, 1) from a cell and a salt
export function scatter(x, y, s) {
  let h = (Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) + Math.imul(s + 1, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// the Greek letters each name letter passes through, in order, before it lands
const GREEK = {
  D: ['Ξ', 'Δ'], R: ['Γ', 'Ρ'], I: ['Ι', 'Ψ'], F: ['Φ', 'Π'], T: ['Σ', 'Τ'], M: ['Μ', 'Ω'], A: ['Λ', 'Α'], N: ['Ν', 'Ζ'],
  9: ['Θ', 'Ξ'], 0: ['Ο', 'Θ'],
};
export const greekOf = (g) => (GREEK[String.fromCodePoint(g)] || ['Ξ', 'Θ']).map((s) => s.codePointAt(0));

const cache = new Map();

// the place of each item in a list sorted by key, as a fraction in (0, 1): equal shares of the cells get equal shares of the time
function ranks(items, key) {
  const order = items.map((_, i) => i).sort((p, q) => key(items[p]) - key(items[q]) || p - q);
  const u = new Array(items.length);
  order.forEach((i, r) => { u[i] = (r + 0.5) / items.length; });
  return u;
}

function build(tier) {
  const m = machine(tier);
  const W = m.W, H = m.H;
  const span = Math.max(1, Math.min(9, Math.floor(Math.min(W, H) / 2)));
  // Shed: the order is edges first (then a scatter); the times are laid out so that the number of cells going per frame falls away
  // linearly (the unfold, which rises, takes up the slack): u -> 1 - sqrt(1 - u).
  const rawOlds = old2000(tier).map(([x, y, g, c]) => ({
    x, y, g, c, edge: Math.min(1, Math.min(x, W - 1 - x, y, H - 1 - y) / span), s: scatter(x, y, 3),
    dot: scatter(x, y, 9) < DOT_SHARE ? DOTS[Math.floor(scatter(x, y, 5) * DOTS.length) % DOTS.length] : 0,
  }));
  const uo = ranks(rawOlds, (o) => 0.5 * o.s + 0.5 * o.edge);
  const olds = rawOlds.map((o, i) => ({ x: o.x, y: o.y, g: o.g, c: o.c, dot: o.dot, th: 0.005 + (SHED_END - 0.005) * (1 - Math.sqrt(1 - uo[i])) }));
  const gone = new Map();
  for (const o of olds) gone.set(o.y * W + o.x, o.th + (o.dot ? DOT_P : 0));
  // Unfold: strokes in order of distance from the centre line (a little lower rows later), the glass fill as a scatter; each group's
  // times rise: u -> sqrt(u), so the number of cells arriving per frame grows while the shed falls.
  const strokes = m.cells.filter((c) => c.k !== K_FILL), fills = m.cells.filter((c) => c.k === K_FILL);
  const us = ranks(strokes, (c) => Math.pow(c.dx, 0.8) + 0.1 * (c.y / Math.max(1, H - 1)) + 0.01 * scatter(c.x, c.y, 11));
  const uf = ranks(fills, (c) => scatter(c.x, c.y, 7));
  const when = new Map();
  strokes.forEach((c, i) => when.set(c, UNFOLD_FROM + UNFOLD_SPAN * Math.pow(us[i], UNFOLD_Q)));
  fills.forEach((c, i) => when.set(c, UNFOLD_FROM + UNFOLD_SPAN * Math.pow(uf[i], UNFOLD_Q)));
  const news = m.cells.map((c) => {
    // everything must have landed by LIFE_FROM: a name letter after its two Greek letters, a light after settling to its colour
    const cap = c.k === K_NAME ? LIFE_FROM - 2 * GREEK_P : (c.k === K_STATIC || c.k === K_FILL) ? LIFE_FROM - 1e-3 : LIFE_FROM - SETTLE_P;
    const tu = Math.max(Math.min(when.get(c), cap), (gone.get(c.y * W + c.x) || 0) + 1e-6);
    return { ...c, tu, greek: c.k === K_NAME ? greekOf(c.g) : null };
  });
  return { W, H, olds, news };
}

export function plan(tier) {
  const key = tier === 'mini' ? 'mini' : 'full';
  let v = cache.get(key);
  if (!v) { v = build(key); cache.set(key, v); }
  return v;
}
