// Chaos / glitch: short words that assemble out of noise. A word starts as scrambling
// characters (drawn from one of several glyph sets), its letters lock in one by one
// (left to right, or in random order), it holds, then it scrambles out letter by letter
// and vanishes. Many words run at once: the screen is cut into lanes of LANE_ROWS rows and
// every lane into slots about SLOT_COLS wide, so the number of streams grows with the screen
// area. Each stream has its own period and phase, so the words are staggered.
//
// kind 'cells', pure in t. Colour index = hue * 4 + brightness level.
// Everything about an event comes from glitchEvent(), which tests use to pin times.
import { hash32, rand, seedOf, timeOf } from './util.js';

export const WORDS = [
  'GLITCH', 'STATIC', 'SIGNAL', 'STORM', 'NOISE', 'VOLT', 'PULSE', 'BLAZE', 'FLUX', 'ECHO',
  'ZAP', 'CHAOS', 'RIOT', 'NEON', 'SURGE', 'SPARK', 'FRENZY', 'TURBO', 'WARP', 'HYPER',
  'CRASH', 'BUZZ', 'FUZZ', 'QUASAR', 'static', 'glitch', 'flux', 'wire',
];

function range(a, b) { const o = []; for (let c = a; c <= b; c++) o.push(c); return o; }
const cps = (str) => Array.from(str, (ch) => ch.codePointAt(0));

// Varied scramble sets; every code point is on the allow-list (src/glyphs.js).
export const SCRAMBLE_SETS = [
  [...range(0x41, 0x5a), ...range(0x30, 0x39)], // capitals and digits
  [...range(0x391, 0x3a1), ...range(0x3b1, 0x3c9)], // Greek
  cps('!#$%&*+<=>?@^~/|\\{}[]()'), // ASCII symbols
  [...range(0x2580, 0x258f), 0x2591, 0x2592, 0x2593, ...range(0x2500, 0x250f)], // blocks and box lines
  range(0x2801, 0x28ff).filter((c) => (c & 7) !== 0), // braille noise
  [0x2211, 0x221a, 0x221e, 0x2248, 0x2260, 0x2264, 0x2265, 0x2202, 0x222b, 0xd7, 0xf7, 0xb1, 0xb0, 0x25a0, 0x25b2, 0x25c6, 0x25cb, 0x25cf], // maths and shapes
];

const IN_START = 0.6; // first letter may lock this long after the event starts
const LOCK_STEP = 0.16; // gap between locks
const HOLD = 2.0;
const OUT_STEP = 0.1;
const OUT_SCRAMBLE = 0.35; // a letter scrambles this long before it vanishes
const DMAX = IN_START + 7 * LOCK_STEP + HOLD + OUT_SCRAMBLE + 7 * OUT_STEP + 0.1; // longest possible event
const ROLL_HZ = 14; // scramble glyphs change this many times a second

export const LANE_ROWS = 2; // screen rows per lane
export const SLOT_COLS = 16; // target columns per stream; the words are at most 8 long
const KEY_TRACKS = 64; // stream key = lane * KEY_TRACKS + track

export function laneCount(H) { return Math.max(1, Math.floor(H / LANE_ROWS)); }
export function trackCount(W) { return Math.max(2, Math.floor(W / SLOT_COLS)); }
function laneRow(lane, H) { return Math.min(H - 1, Math.floor(((lane + 0.5) * H) / laneCount(H))); }

function streamPeriod(seed, key) { return DMAX + 0.3 + 1.4 * rand(seed, key, 1); }
function streamPhase(seed, key, P) { return rand(seed, key, 2) * P; }

function permutation(n, seed, a, b) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = hash32(seed, a * 31 + i, b) % (i + 1);
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}

// Event k of stream (lane, track) at screen W x H. Times are in scene seconds (t0 absolute).
export function glitchEvent(seed, lane, track, k, W, H) {
  const key = lane * KEY_TRACKS + track;
  const P = streamPeriod(seed, key), phase = streamPhase(seed, key, P);
  const r = (n) => rand(seed * 977 + 13, key * 4099 + k, n);
  const word = WORDS[(r(1) * WORDS.length) | 0];
  const len = word.length;
  const delay = r(2) * (P - DMAX);
  const lockMode = r(3) < 0.5 ? 'ltr' : 'random';
  const outMode = r(4) < 0.5 ? 'ltr' : 'random';
  const lockOrder = lockMode === 'ltr' ? Array.from({ length: len }, (_, i) => i) : permutation(len, seed, key, k * 2);
  const outOrder = outMode === 'ltr' ? Array.from({ length: len }, (_, i) => i) : permutation(len, seed, key, k * 2 + 1);
  const lockAt = new Array(len), vanishAt = new Array(len);
  for (let i = 0; i < len; i++) lockAt[i] = IN_START + lockOrder[i] * LOCK_STEP;
  const outStart = IN_START + (len - 1) * LOCK_STEP + HOLD;
  for (let i = 0; i < len; i++) vanishAt[i] = outStart + OUT_SCRAMBLE + outOrder[i] * OUT_STEP;
  const tracks = trackCount(W);
  const lo = Math.floor((track * W) / tracks), hi = Math.floor(((track + 1) * W) / tracks);
  const x = lo + Math.floor(r(5) * Math.max(1, hi - lo - len + 1));
  return {
    word, len, x, row: laneRow(lane, H), hue: (r(6) * 8) | 0, set: (r(7) * SCRAMBLE_SETS.length) | 0,
    lockMode, outMode, lockAt, vanishAt, outStart, duration: Math.max(...vanishAt),
    t0: k * P - phase + delay, period: P,
  };
}

// The event of the cycle that contains t (it may not have started yet, or may be over).
export function glitchEventAt(seed, lane, track, t, W, H) {
  const key = lane * KEY_TRACKS + track;
  const P = streamPeriod(seed, key), phase = streamPhase(seed, key, P);
  return glitchEvent(seed, lane, track, Math.floor((t + phase) / P), W, H);
}

// True while every letter of the word is locked in and none has started to leave.
export function fullyShown(ev, t) {
  const tau = t - ev.t0;
  return tau >= Math.max(...ev.lockAt) && tau < ev.outStart;
}

export default function glitch(t, w, h, params) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const g = params.glyphs, col = params.colours;
  g.fill(32);
  col.fill(0);
  if (W === 0 || H === 0) return;
  const T = timeOf(t), s = seedOf(params);
  const roll = Math.floor(T * ROLL_HZ);
  const lanes = laneCount(H), tracks = trackCount(W);
  for (let lane = 0; lane < lanes; lane++) {
    for (let track = 0; track < tracks; track++) {
      const ev = glitchEventAt(s, lane, track, T, W, H);
      const tau = T - ev.t0;
      if (tau < 0 || tau >= ev.duration) continue;
      const set = SCRAMBLE_SETS[ev.set];
      const base = ev.row * W;
      for (let i = 0; i < ev.len; i++) {
        const x = ev.x + i;
        if (x >= W) break;
        let ch, lvl;
        if (tau >= ev.vanishAt[i]) continue;
        if (tau >= ev.lockAt[i] && tau < ev.outStart) { ch = ev.word.charCodeAt(i); lvl = 3; }
        else {
          const hsh = hash32(s * 31 + roll, (lane * KEY_TRACKS + track) * 16 + i, ev.t0 * 100 | 0);
          // mostly this event's set, now and then a glyph from another set
          const pick = (hsh & 7) === 0 ? SCRAMBLE_SETS[(hsh >>> 4) % SCRAMBLE_SETS.length] : set;
          ch = pick[(hsh >>> 8) % pick.length];
          lvl = 1 + ((hsh >>> 5) & 1);
        }
        g[base + x] = ch;
        col[base + x] = ev.hue * 4 + lvl;
      }
    }
  }
}
glitch.id = 'glitch';
glitch.kind = 'cells';
