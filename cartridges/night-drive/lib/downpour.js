// Red Light, Rain: the downpour in the air. Slanted speed lines of 2 to 8 cells falling down and to the right in a wind that gusts
// slowly, lit deep red. Every streak is a pure function of (slot, step, seed): nothing here is state, so draw never changes anything
// and the picture at step n never depends on the frames before it.
//
//   wind      the slope (columns per row) is 1.0 give or take 0.24, two slow waves (18 s and 9.9 s); it never reverses. The same waves
//             slowly thin or thicken the rain (which lives are launched) and stretch or shorten the streaks; none of them touches colour
//   a slot    one lane of the rain: a speed of 0.9 to 1.6 rows a step (27 to 48 cells a second), a period (a trip down the glass, then a gap),
//             a kind and a length. Every trip is a new life with its own column; the slot count scales with the glass area
//   kinds     far 42% (all coral.0), mid 38% (coral.1 in front, coral.0 behind), near 13% (a coral.2 spark at the head), hot 7% (a coral.3
//             spark at the head). The streak is the diagonal ╲ in coral.0 or coral.1 and the spark is * in coral.2 or coral.3: a glyph only ever
//             takes two neighbouring shades, so a cell that keeps its glyph never jumps more than one shade, and never changes family
//   the lamp  when the light goes green, rain near it turns green: inside the ellipse mint, in the ring around it one shade lower, and
//             beyond that the rain stays red. A cell goes red, then dark for GAP steps, then green: the dark gap is longer than a 4x frame
import { hash } from './hash.js';
import { CORAL, MINT } from './palette.js';
import { RED_OFF, GREEN_ON } from './bokeh.js';
import { onGlass } from './dash.js';

export const SLANT = 0x2572; // ╲, the streak
export const SPARK = 0x2a; // *, the head of a bright streak, and the first beat of the wiper's spray
export const SLOPE_MIN = 0.7, SLOPE_MAX = 1.3; // the wind's stated range (columns per row); it is really 0.76 to 1.24
export const SPEED_MIN = 0.9, SPEED_MAX = 1.6; // rows a step: 27 to 48 cells a second
export const AIR_PER_CELL = 0.058; // slots per glass cell (before the correction for the glass's height)
export const KIND_SHARE = Object.freeze([0.42, 0.80, 0.93]); // far, mid, near; the rest is hot
export const REFILL_MIN = 12, REFILL_SPAN = 8; // a wiped cell shows no rain for 12 to 19 steps (0.4 to 0.63 s), then the rain is back
export const GREEN_LAG = 16; // rain near the lamp turns green this many steps after the lamp's own green begins
export const GAP_JITTER = 12; // and each cell starts its dark gap 0 to 11 steps late
export const RAIN_GREEN_BY = GREEN_ON + GREEN_LAG + GAP_JITTER; // from this step on, rain near the lamp is all green

const TAU = Math.PI * 2;
const P1 = 540, P2 = 297, P3 = 811; // the gust waves, in steps
const A1 = 0.17, A2 = 0.07;
const unit = (a, b, c) => hash(a, b, c) / 4294967296;
const phases = (seed) => [unit(seed, 11, 1) * TAU, unit(seed, 12, 2) * TAU, unit(seed, 13, 3) * TAU, unit(seed, 14, 4) * TAU];

// The wind's slope (columns per row) at step n, and the running total of it (the sum of the slope over steps 0 to n).
export function windSlope(n, seed) {
  const a = phases(seed);
  return 1 + A1 * Math.sin((TAU * n) / P1 + a[0]) + A2 * Math.sin((TAU * n) / P2 + a[1]);
}
function windTotal(n, seed) {
  const a = phases(seed);
  return n + A1 * (P1 / TAU) * (Math.cos(a[0]) - Math.cos((TAU * n) / P1 + a[0])) + A2 * (P2 / TAU) * (Math.cos(a[1]) - Math.cos((TAU * n) / P2 + a[1]));
}
// How much of the rain is launched (0.76 to 1) and how long the streaks run (0.8 to 1.2 times), at step n
export const densityAt = (n, seed) => 0.88 + 0.12 * Math.sin((TAU * n) / P3 + phases(seed)[2]);
export const lengthAt = (n, seed) => 1 + 0.2 * Math.sin((TAU * n) / P2 + phases(seed)[3]);

// ---- colour: the rain is red; near the lamp it takes the green, in whole shade steps

// How green the rain is at a cell: 0 red, 1 the ring around the lamp (one shade lower), 2 inside it. g.tint = [cx, cy, rx, ry].
export function tintLevel(g, x, y) {
  const [cx, cy, rx, ry] = g.tint;
  const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
  return d < 1 ? 2 : d < 3.2 ? 1 : 0;
}
// The colour of a shade (0 to 3) of rain at a tint level.
export const rainColour = (shade, level) => (level === 0 ? CORAL[shade] : level === 2 ? MINT[shade] : MINT[shade > 0 ? shade - 1 : 0]);
// How green is the rain at (x, y) at step n: -1 while it is dark between the colours (only near the lamp, only as the light changes),
// else the tint level of the cell (0 red before the change; 1 or 2 green after it).
function levelAt(seed, g, x, y, n) {
  const lvl = tintLevel(g, x, y);
  if (lvl === 0) return 0;
  const a = hash(x, y, seed + 5) % GAP_JITTER;
  if (n < RED_OFF + a) return 0;
  return n < GREEN_ON + GREEN_LAG + a ? -1 : lvl;
}
// The colour to draw rain of a shade at (x, y) at step n, or -1 when this cell shows no rain.
export function shownColour(s, x, y, n, shade) {
  const lvl = levelAt(s.seed, s.g, x, y, n);
  return lvl < 0 ? -1 : rainColour(shade, lvl);
}
// How many steps after a wipe a cell stays dry
export const refillDelay = (seed, x, y) => REFILL_MIN + (hash(x, y, seed + 3) % REFILL_SPAN);

// ---- the slots

export function makeSlots(g, seed, maxLen, area) {
  // a taller glass keeps a streak on screen for more of its trip, so it needs fewer slots for the same density per cell
  const R = g.hoodTop - g.gTop, duty = (R + 5) / (R + maxLen + 2), n = Math.max(8, Math.round((area * AIR_PER_CELL) / duty));
  const slots = [];
  for (let j = 0; j < n; j++) {
    const v = SPEED_MIN + unit(j, seed, 1) * (SPEED_MAX - SPEED_MIN);
    const trip = Math.ceil((R + maxLen + 2) / v);
    const period = trip + (hash(j, seed, 2) % (Math.floor(trip * 0.5) + 1));
    const u = unit(j, seed, 4);
    slots.push({
      v: Math.round(v * 1000) / 1000,
      trip,
      period,
      phase: hash(j, seed, 3) % period,
      kind: u < KIND_SHARE[0] ? 0 : u < KIND_SHARE[1] ? 1 : u < KIND_SHARE[2] ? 2 : 3,
      len: 2 + ((v - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * (maxLen - 4) + unit(j, seed, 5) * 2, // faster rain runs longer
      jit: (unit(j, seed, 6) - 0.5) * 0.12, // each streak leans a little differently, so a gust turns them one at a time
    });
  }
  return slots;
}

// One slot at step n: null when it is between trips, else { x, y, len, vy, life } with (x, y) the head cell.
export function streakOf(s, j, n) {
  const sl = s.slots[j], g = s.g;
  const k = Math.floor((n + sl.phase) / sl.period), n0 = k * sl.period - sl.phase, age = n - n0;
  if (age >= sl.trip) return null;
  if (unit(j, k, s.seed + 9) >= densityAt(n0, s.seed)) return null;
  const len = Math.min(s.maxLen, Math.max(2, Math.round(sl.len * lengthAt(n0, s.seed))));
  const span = Math.ceil(1.3 * (g.hoodTop - g.gTop) + 8);
  const xs = Math.floor(unit(j, k, s.seed + 3) * (g.W + span)) - span;
  const y = g.gTop - 1 + Math.floor(sl.v * age);
  const x = xs + Math.round(sl.v * (windTotal(n, s.seed) - windTotal(n0, s.seed)) + sl.jit * sl.v * age);
  return { x, y, len, k, age };
}

// The cells of the streak: [x, y, glyph, shade] from the head back up the wind. A hot or near streak has a spark at its head.
export function* streakCells(s, j, n, slope) {
  const st = streakOf(s, j, n);
  if (!st) return;
  const sl = s.slots[j];
  for (let i = 0; i < st.len; i++) {
    const x = st.x - Math.round((slope + sl.jit) * i), y = st.y - i;
    if (y < s.g.gTop || y >= s.g.hoodTop) continue;
    if (i === 0 && sl.kind >= 2) { yield [x, y, SPARK, sl.kind === 2 ? 2 : 3]; continue; }
    yield [x, y, SLANT, sl.kind === 0 ? 0 : i < (st.len + 1) >> 1 ? 1 : 0];
  }
}

export function drawStreaks(cv, s, n, put) {
  const g = s.g, W = g.W, slope = windSlope(n, s.seed);
  for (let j = 0; j < s.slots.length; j++) {
    for (const [x, y, glyph, shade] of streakCells(s, j, n, slope)) {
      if (!onGlass(g, x, y)) continue;
      if (n - s.wipe[y * W + x] < refillDelay(s.seed, x, y)) continue; // the blade took it
      const col = shownColour(s, x, y, n, shade);
      if (col >= 0) put(cv, x, y, glyph, col);
    }
  }
}
