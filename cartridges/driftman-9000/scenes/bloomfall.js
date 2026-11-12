// BLOOMFALL: blooms of colour open and fade over a slowly turning field of hue; pollen drops from the fading blooms; small pops
// of gold, mint and ion between (kind 'cells', rgb: true).
//
// The ground is the huefield (lib/huefield.js) at L 0.22: hue turns about 90 degrees a second at one dim lightness, so it moves all
// the time and costs the flash meter nothing. Over it, in half-block pixels (2 per cell row, so a pixel is square):
//
//   Blooms. Seeded Poisson arrivals, mean 0.8 a second, refused when 4 are alive (alive = born less than 6 s ago) or when the centre is
//   under 20 columns from a living one (three tries at a place). Bloom j has k_j petals (5-9), a hue h_j from a red-safe set, R_max 6-18
//   rows (never more than 42 % of the screen height), and, tau seconds after its birth, radius R(tau) = R_max (1 - e^(-tau/1.2)). A pixel is
//   inside when r <= R (0.65 + 0.35 cos(k theta + 0.3 tau)), r in rows. The envelope is
//       E = smoothstep(0, 1.5, tau) (1 - smoothstep(3.5, 6, tau))
//   up in 1.5 s, held to 3.5 s, down in 2.5 s: a period of 6 s, so a big bloom is 1 s at 4x and passes the meter's L1 and L2 (a 2 s bloom does not).
//   Colour: safeHue(h_j + 60 r/R + turn tau, 0.18 + 0.5 E (1 - 0.4 r/R)) mixed into the field hue and lightness by m = smoothstep(0, 0.2, E):
//   a bloom at E = 0 is the field, so nothing snaps on at birth or off at death. Hue turns 120 degrees a second inside a bloom (through
//   safeHue). Where two blooms overlap the brighter one shows. The magenta bloom is the one red-leaning hue: it is small (R_max 9 at most)
//   and slow (40 degrees a second).
//   Pollen. When a bloom starts to fade (tau 3.5) it drops 20-40 braille specks from inside its disc: 3 rows a second down, swaying,
//   fading over 3 s (in over the first 0.3 s).
//   Pops. 2-6 a second, 1-3 cells in a row (a diamond, plus, middle dot or cross), gold, mint or ion: up in 0.1 s, down over 0.5 s.
//
// Menu order will be Rosette, Cortex, Bloomfall; Cortex arrives in a later stage and goes in between the two.
//
// Pure in (seed, T) with T = t - t0. The only state is caches that are functions of their keys and never mutated by a frame: the spawn plan
// (a memo of the fixed seeded sequence, extended as T grows) and the buffers that depend on the size. No allocation per frame.
//
// Any size: 0x0 and 1x1 draw nothing that throws, and below 60 x 20 it draws one centred dim line, "This vision needs 60 x 20.".
import { safeHue, pixelsToCells } from '../../../src/pixels.js';
import { sceneTime, seedOf } from '../lib/clock.js';
import { hueAt, cos, sin } from '../lib/huefield.js';

export const MIN_W = 60, MIN_H = 20;
export const MESSAGE = 'This vision needs 60 x 20.';
export const FIELD_L = 0.22;
export const RATE = 0.8, MAX_ALIVE = 4, MIN_GAP = 20, PRE_ROLL = 6, TRIES = 3;
export const RISE = 1.5, FALL_FROM = 3.5, FALL_TO = 6, BLOOM_LIFE = 6, SETTLE = 1.2;
export const TURN_RATE = 120, MAGENTA_TURN_RATE = 40;
export const MAGENTA = 330;
export const HUES = Object.freeze([165, 200, 235, 270, 300, MAGENTA, 80]); // mint, ion, blue, violet, orchid, magenta, gold
export const POLLEN_FALL = 3, POLLEN_LIFE = 3, POLLEN_FADE_IN = 0.3, POLLEN_HUE = 75;
export const POP_UP = 0.1, POP_DOWN = 0.5, POP_MIN_AMP = 0.04;
export const POP_HUES = Object.freeze([85, 165, 205]); // gold, mint, ion
const POP_GLYPHS = Object.freeze([0x25c6, 0x2b, 0xb7, 0xd7]); // diamond, plus, middle dot, cross
const ACTIVE = FALL_FROM + POLLEN_LIFE; // a bloom is drawn (disc, then pollen) until this old
const BG = 0x05060c; // the skin background
const DIM = 0x5a6a94; // the message: dim mist
const TAU = Math.PI * 2;
const BRAILLE_BIT = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80]; // indexed row * 2 + column of the dot in its cell

// ---- pure pieces (exported for the tests)

export function smoothstep(a, b, x) {
  const u = (x - a) / (b - a);
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

export function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const envelope = (tau) => smoothstep(0, RISE, tau) * (1 - smoothstep(FALL_FROM, FALL_TO, tau));
export const radiusAt = (rmax, tau) => (tau <= 0 ? 0 : rmax * (1 - Math.exp(-tau / SETTLE)));

// ---- the spawn plan: a memo of one fixed seeded sequence per (seed, size)

const gapOf = (seed, i) => -Math.log(1 - hash3(i, seed, 11)) / RATE;

// The time of arrival i (from -PRE_ROLL), for the statistics tests.
export function arrivalTime(seed, i) {
  let t = -PRE_ROLL;
  for (let j = 0; j <= i; j++) t += gapOf(seed, j);
  return t;
}

// Arrivals in [0, T).
export function attemptCount(seed, T) {
  let t = -PRE_ROLL + gapOf(seed, 0), n = 0, i = 0;
  while (t < T) { if (t >= 0) n++; i++; t += gapOf(seed, i); }
  return n;
}

function newMemo(seed, w, h) {
  return { seed, w, h, blooms: [], idx: 0, tNext: -PRE_ROLL + gapOf(seed, 0) };
}

function attempt(M, i, t) {
  const { seed, w, h, blooms } = M;
  let alive = 0;
  for (let j = blooms.length - 1; j >= 0 && t - blooms[j].start < BLOOM_LIFE; j--) alive++;
  if (alive >= MAX_ALIVE) return;
  const mx = Math.floor(0.12 * w), y0 = Math.floor(0.25 * h), ySpan = Math.max(1, Math.ceil(0.5 * h) + 1);
  for (let k = 0; k < TRIES; k++) {
    const cx = Math.min(w - 1, mx + Math.floor(hash3(i, seed, 20 + k) * Math.max(1, w - 2 * mx)));
    let ok = true;
    for (let j = blooms.length - 1; j >= 0 && t - blooms[j].start < BLOOM_LIFE; j--) if (Math.abs(cx - blooms[j].cx) < MIN_GAP) { ok = false; break; }
    if (!ok) continue;
    const cy = Math.min(h - 1, y0 + Math.floor(hash3(i, seed, 30 + k) * ySpan));
    const hue = HUES[Math.floor(HUES.length * hash3(i, seed, 41))];
    let rmax = Math.min(6 + 12 * hash3(i, seed, 42), Math.max(6, 0.42 * h));
    if (hue === MAGENTA) rmax = Math.min(rmax, 9);
    blooms.push({
      start: t, cx, cy, hue, rmax,
      k: 5 + Math.floor(5 * hash3(i, seed, 40)),
      turn: hue === MAGENTA ? MAGENTA_TURN_RATE : TURN_RATE,
      np: 20 + Math.floor(21 * hash3(i, seed, 43)),
      pseed: Math.floor(hash3(i, seed, 44) * 4294967296) | 0,
    });
    return;
  }
}

let lastMemo = null;
const memos = new Map();
function memoFor(seed, w, h) {
  if (lastMemo && lastMemo.seed === seed && lastMemo.w === w && lastMemo.h === h) return lastMemo;
  const key = `${seed}:${w}x${h}`;
  let m = memos.get(key);
  if (!m) { if (memos.size >= 24) memos.clear(); m = newMemo(seed, w, h); memos.set(key, m); }
  lastMemo = m;
  return m;
}

// The plan for (seed, w, h) extended to cover time T: { blooms } in order of birth. Shared, never to be mutated.
export function plan(seed, w, h, T) {
  const M = memoFor(seed | 0, w, h);
  while (M.tNext <= T) { attempt(M, M.idx, M.tNext); M.idx++; M.tNext += gapOf(M.seed, M.idx); }
  return M;
}

// ---- pollen

const SCR = new Float64Array(5);
// Speck i of bloom b: out = [x0, y0, sway amplitude (columns), sway rate (rad/s), sway phase]; x0 in columns and y0 in rows, absolute.
export function speckOf(b, i, out) {
  const u1 = hash3(b.pseed, i, 1), u2 = hash3(b.pseed, i, 2);
  const rad = Math.sqrt(u2) * 0.8 * b.rmax, ang = TAU * u1;
  out[0] = b.cx + 0.5 + 2 * rad * Math.cos(ang);
  out[1] = b.cy + 0.5 + rad * Math.sin(ang);
  out[2] = 0.8 + hash3(b.pseed, i, 3);
  out[3] = 1.5 + 1.5 * hash3(b.pseed, i, 4);
  out[4] = TAU * hash3(b.pseed, i, 5);
}

// Speck i, a seconds after the bloom started to fade: out.x, out.y (columns, rows) and out.a (0..1 brightness).
export function speckState(b, i, a, out) {
  speckOf(b, i, SCR);
  out.x = SCR[0] + SCR[2] * Math.sin(SCR[3] * a + SCR[4]);
  out.y = SCR[1] + POLLEN_FALL * a;
  out.a = a <= 0 || a >= POLLEN_LIFE ? 0 : smoothstep(0, POLLEN_FADE_IN, a) * (1 - a / POLLEN_LIFE);
}

// ---- pops

export function popAmp(age) {
  if (age <= 0 || age >= POP_UP + POP_DOWN) return 0;
  return age < POP_UP ? smoothstep(0, POP_UP, age) : 1 - smoothstep(POP_UP, POP_UP + POP_DOWN, age - 0);
}

const popCount = (seed, sec) => 2 + Math.floor(5 * hash3(sec, seed, 60));
// Pop i of second sec: out = [start, x, y, n, hue]
function popAt(seed, w, h, sec, i, count, out) {
  const key = sec * 8 + i;
  const n = 1 + Math.floor(3 * hash3(key, seed, 61));
  out[0] = sec + (i + hash3(key, seed, 62)) / count;
  out[1] = Math.floor(hash3(key, seed, 63) * (w - n + 1));
  out[2] = Math.floor(hash3(key, seed, 64) * h);
  out[3] = n;
  out[4] = POP_HUES[Math.floor(3 * hash3(key, seed, 65))];
}
const popGlyph = (seed, sec, i, j) => POP_GLYPHS[Math.floor(4 * hash3(sec * 8 + i, seed, 70 + j))];

// The pops that begin in second sec, as objects (for the tests): { t, x, y, n, hue, glyphs }
export function popsOf(seed, w, h, sec) {
  const count = popCount(seed, sec), out = new Float64Array(5), list = [];
  for (let i = 0; i < count; i++) {
    popAt(seed, w, h, sec, i, count, out);
    const glyphs = [];
    for (let j = 0; j < out[3]; j++) glyphs.push(popGlyph(seed, sec, i, j));
    list.push({ t: out[0], x: out[1], y: out[2], n: out[3], hue: out[4], glyphs });
  }
  return list;
}

// ---- the size cache

let cache = null;
export function cacheFor(w, h) {
  if (cache && cache.w === w && cache.h === h) return cache;
  const hPx = 2 * h, n = w * hPx;
  cache = {
    w, h, hPx, n,
    pixels: new Uint32Array(n), hue: new Float32Array(n), lum: new Float32Array(n),
    bits: new Uint8Array(w * h), amp: new Float32Array(w * h), touched: new Int32Array(1024),
  };
  return cache;
}

// ---- the scene

function message(w, h, params) {
  const { glyphs, fg, bg } = params;
  const n = w * h;
  for (let i = 0; i < n; i++) { glyphs[i] = 32; fg[i] = BG; bg[i] = BG; }
  const row = Math.floor(h / 2), x0 = Math.floor((w - MESSAGE.length) / 2);
  for (let k = 0; k < MESSAGE.length; k++) {
    const x = x0 + k;
    if (x < 0 || x >= w) continue;
    const i = row * w + x;
    glyphs[i] = MESSAGE.charCodeAt(k); fg[i] = DIM;
  }
}

const ACTIVE_BLOOMS = new Array(12).fill(null);
const POP_SCR = new Float64Array(5);

function bloomfall(t, w, h, params) {
  if (!(w > 0 && h > 0)) return;
  if (w < MIN_W || h < MIN_H) { message(w, h, params); return; }
  const T = sceneTime(t, params), seed = seedOf(params);
  const c = cacheFor(w, h);
  const { pixels, hue, lum, hPx } = c;
  const M = plan(seed, w, h, T);

  // 1. the field
  for (let py = 0; py < hPx; py++) {
    const yf = (py + 0.5) * 0.5, row = py * w;
    for (let px = 0; px < w; px++) {
      const i = row + px;
      const hh = hueAt(px + 0.5, yf, T, seed);
      hue[i] = hh - 360 * Math.floor(hh / 360);
      lum[i] = FIELD_L;
      pixels[i] = safeHue(hh, FIELD_L);
    }
  }

  // 2. the blooms alive or dropping pollen
  const blooms = M.blooms;
  let lo = 0, hi = blooms.length - 1, last = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (blooms[mid].start <= T) { last = mid; lo = mid + 1; } else hi = mid - 1; }
  let na = 0;
  for (let j = last; j >= 0 && T - blooms[j].start < ACTIVE && na < ACTIVE_BLOOMS.length; j--) ACTIVE_BLOOMS[na++] = blooms[j];
  for (let a = 0; a < na; a++) {
    const b = ACTIVE_BLOOMS[a], tau = T - b.start;
    const E = envelope(tau);
    if (E <= 0) continue;
    const R = radiusAt(b.rmax, tau), Rpx = 2 * R, m = smoothstep(0, 0.2, E);
    const cxp = b.cx + 0.5, cyp = 2 * b.cy + 1;
    const x0 = Math.max(0, Math.floor(cxp - Rpx)), x1 = Math.min(w - 1, Math.ceil(cxp + Rpx));
    const y0 = Math.max(0, Math.floor(cyp - Rpx)), y1 = Math.min(hPx - 1, Math.ceil(cyp + Rpx));
    const rot = 0.3 * tau, hueTurn = b.turn * tau, k = b.k, Rsq = Rpx * Rpx;
    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - cyp, row = py * w;
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - cxp, d2 = dx * dx + dy * dy;
        if (d2 > Rsq) continue;
        const rr = Math.sqrt(d2) * 0.5; // rows
        if (rr > R * (0.65 + 0.35 * cos(k * Math.atan2(dy, dx) + rot))) continue;
        const ratio = rr / R;
        const Lb = 0.18 + 0.5 * E * (1 - 0.4 * ratio), L = FIELD_L + m * (Lb - FIELD_L);
        const i = row + px;
        if (L <= lum[i]) continue;
        const hF = hue[i];
        let d = b.hue + 60 * ratio + hueTurn - hF;
        d -= 360 * Math.floor((d + 180) / 360);
        pixels[i] = safeHue(hF + m * d, L);
        lum[i] = L;
      }
    }
  }
  pixelsToCells(params, w, h, pixels, w, hPx);

  // 3. pollen
  const { bits, amp, touched } = c;
  let nt = 0;
  for (let a = 0; a < na; a++) {
    const b = ACTIVE_BLOOMS[a], fall = T - b.start - FALL_FROM;
    if (fall <= 0 || fall >= POLLEN_LIFE) continue;
    for (let s = 0; s < b.np; s++) {
      speckOf(b, s, SCR);
      const al = smoothstep(0, POLLEN_FADE_IN, fall) * (1 - fall / POLLEN_LIFE);
      if (al < 0.1) continue;
      const x = SCR[0] + SCR[2] * sin(SCR[3] * fall + SCR[4]), y = SCR[1] + POLLEN_FALL * fall;
      const cx = Math.floor(x), cy = Math.floor(y);
      if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
      const ci = cy * w + cx;
      if (bits[ci] === 0 && nt < touched.length) touched[nt++] = ci;
      bits[ci] |= BRAILLE_BIT[Math.floor((y - cy) * 4) * 2 + Math.floor((x - cx) * 2)];
      if (al > amp[ci]) amp[ci] = al;
    }
  }
  for (let q = 0; q < nt; q++) {
    const ci = touched[q];
    params.glyphs[ci] = 0x2800 + bits[ci];
    params.fg[ci] = safeHue(POLLEN_HUE, 0.24 + 0.6 * amp[ci]);
    bits[ci] = 0; amp[ci] = 0;
  }

  // 4. pops (from this second and the one before: a pop lives 0.6 s)
  const sec0 = Math.floor(T);
  for (let sec = sec0 - 1; sec <= sec0; sec++) {
    if (sec < 0) continue;
    const count = popCount(seed, sec);
    for (let i = 0; i < count; i++) {
      popAt(seed, w, h, sec, i, count, POP_SCR);
      const age = T - POP_SCR[0];
      if (age <= 0 || age >= POP_UP + POP_DOWN) continue;
      const al = popAmp(age);
      if (al <= POP_MIN_AMP) continue;
      const col = safeHue(POP_SCR[4], FIELD_L + 0.63 * al), y = POP_SCR[2], x = POP_SCR[1], n = POP_SCR[3];
      for (let j = 0; j < n; j++) {
        const ci = y * w + x + j;
        params.glyphs[ci] = popGlyph(seed, sec, i, j);
        params.fg[ci] = col;
      }
    }
  }
}
bloomfall.id = 'bloomfall';
bloomfall.kind = 'cells';
bloomfall.rgb = true;

export default bloomfall;
