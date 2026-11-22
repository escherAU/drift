// DRIFT-13 phase 3: the pure parts of tools/contrast-matrix.mjs (axes, the full-factorial count, the seeded stratified sample, the summary), kept apart so a test can pin them without a
// 170 s run. Nothing here runs the app or the meter.
import { plusKeys } from './helpers-life-app.js';

// the five X1 rules and their limits in per cent (tests/helpers-flash.js: FIELD_FRACTION 0.25 for l1, l2, r, c; STEP_FRACTION and FLASH_FRACTION 0.30 for l3)
export const RULES = ['l1', 'l2', 'l3', 'r', 'c'];
export const LIMITS = { l1: 25, l2: 25, l3: 30, r: 25, c: 25 };

// the speeds the keys reach from 1x with real `+` presses (SPEEDS in src/app.js is 0.25 0.5 0.75 1 1.5 2 3 4): n presses = SPEEDS[3 + n]
export const SPEED_KEYS = { 1: [], 1.5: plusKeys(1), 2: plusKeys(2), 3: plusKeys(3), 4: plusKeys(4) };
export const SPEED_LIST = [1, 1.5, 2, 3, 4];
export const CLOCK_LIST = ['grid', 'q156', 'jitter'];
export const MODE_LIST = ['256', 'truecolor'];

// named size sets: the shell's layout breakpoints (compact 78x24 and 80x24, full 88x39 and 120x40, extra-large 176x58 and 240x67: tests/console-hook-flash.test.js)
export const SIZE_SETS = { breakpoints: ['78x24', '80x24', '88x39', '120x40'], 'breakpoints-all': ['78x24', '80x24', '88x39', '120x40', '176x58', '240x67'] };

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const uniq = (a) => [...new Set(a)];

// "40x10,80x24,40-50x10-16,breakpoints" -> ['40x10', '80x24', '40x10', ... ] without duplicates, in the order given
export function parseSizes(s) {
  const out = [];
  for (const tok of String(s).split(',').map((x) => x.trim()).filter(Boolean)) {
    if (SIZE_SETS[tok]) { out.push(...SIZE_SETS[tok]); continue; }
    const m = /^(\d+)(?:-(\d+))?x(\d+)(?:-(\d+))?$/.exec(tok);
    if (!m) throw new Error(`bad size "${tok}": use COLSxROWS, a range such as 40-50x10-16, or one of ${Object.keys(SIZE_SETS).join(', ')}`);
    const [c0, c1, r0, r1] = [Number(m[1]), Number(m[2] || m[1]), Number(m[3]), Number(m[4] || m[3])];
    if (c1 < c0 || r1 < r0) throw new Error(`bad size range "${tok}"`);
    for (const c of range(c0, c1)) for (const r of range(r0, r1)) out.push(`${c}x${r}`);
  }
  return uniq(out);
}
// "8-30" or "9,12,18" or "8-10,18"
export function parseInts(s, what = 'number') {
  const out = [];
  for (const tok of String(s).split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(tok);
    if (!m) throw new Error(`bad ${what} "${tok}"`);
    out.push(...range(Number(m[1]), Number(m[2] || m[1])));
  }
  return uniq(out);
}
// "1x,1.5x,2,3x,4x"
export function parseSpeeds(s) {
  const out = String(s).split(',').map((x) => x.trim().replace(/x$/, '')).filter(Boolean).map(Number);
  for (const v of out) if (!SPEED_LIST.includes(v)) throw new Error(`bad speed ${v}x: the keys reach ${SPEED_LIST.join('x, ')}x`);
  return uniq(out);
}
export function parseList(s, allowed, what) {
  const out = String(s).split(',').map((x) => x.trim()).filter(Boolean);
  for (const v of out) if (!allowed.includes(v)) throw new Error(`bad ${what} "${v}": one of ${allowed.join(', ')}`);
  return uniq(out);
}

export const caseKey = (tree, c) => `${tree}|${c.size}|${c.fps}|${c.speed}|${c.clock}|${c.mode}|${c.seed}`;
export const fullFactorial = (a) => a.sizes.length * a.fps.length * a.speeds.length * a.clocks.length * a.modes.length * a.seeds.length;

// every case of the cross, sizes outermost, seeds innermost
export function expandAll(a) {
  const out = [];
  for (const size of a.sizes) for (const fps of a.fps) for (const speed of a.speeds) for (const clock of a.clocks) for (const mode of a.modes) for (const seed of a.seeds) out.push({ size, fps, speed, clock, mode, seed });
  return out;
}

// mulberry32: a small seeded generator, so a sample is the same on every machine
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// A seeded, stratified draw of n cases from the cross. Strata: with n >= (sizes x fps) pairs, the draw walks a shuffled list of the pairs (every pair is met floor(n / pairs) times, the first
// n mod pairs pairs once more); with fewer, sizes and rates come off shuffled decks (every size and every rate is met as evenly as n allows). The other four axes always come off their own
// shuffled decks (a deck is dealt out before it is reshuffled), so each speed, clock, mode and seed is met about n / (its length) times. A duplicate case is redrawn. n at or above the cross
// returns the whole cross. Same axes, n and seed: the same cases in the same order.
export function drawSample(a, n, seed = 1) {
  const total = fullFactorial(a);
  if (n >= total) return expandAll(a);
  const rnd = mulberry32(seed);
  const shuffle = (x) => { const y = x.slice(); for (let i = y.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [y[i], y[j]] = [y[j], y[i]]; } return y; };
  const deck = (vals) => { let d = []; return () => { if (!d.length) d = shuffle(vals); return d.pop(); }; };
  const pairs = shuffle(a.sizes.flatMap((size) => a.fps.map((fps) => ({ size, fps }))));
  const byPair = n >= pairs.length;
  const dSize = deck(a.sizes), dFps = deck(a.fps), dSpeed = deck(a.speeds), dClock = deck(a.clocks), dMode = deck(a.modes), dSeed = deck(a.seeds);
  const out = [], seen = new Set();
  for (let guard = 0; out.length < n && guard < n * 200 + 1000; guard++) {
    const { size, fps } = byPair ? pairs[out.length % pairs.length] : { size: dSize(), fps: dFps() };
    const c = { size, fps, speed: dSpeed(), clock: dClock(), mode: dMode(), seed: dSeed() };
    const k = `${c.size}|${c.fps}|${c.speed}|${c.clock}|${c.mode}|${c.seed}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(c);
  }
  return out;
}

// how often each value of each axis, and each (size, fps) pair, is met by `cases`; min and max per axis, so a claim of "every size, every rate ..." is a number
export function coverage(cases, a) {
  const count = (vals, get) => { const m = new Map(vals.map((v) => [String(v), 0])); for (const c of cases) m.set(String(get(c)), (m.get(String(get(c))) || 0) + 1); return m; };
  const axes = { sizes: count(a.sizes, (c) => c.size), fps: count(a.fps, (c) => c.fps), speeds: count(a.speeds, (c) => c.speed), clocks: count(a.clocks, (c) => c.clock), modes: count(a.modes, (c) => c.mode), seeds: count(a.seeds, (c) => c.seed) };
  const pairs = new Map(); for (const s of a.sizes) for (const f of a.fps) pairs.set(`${s}@${f}`, 0);
  for (const c of cases) pairs.set(`${c.size}@${c.fps}`, (pairs.get(`${c.size}@${c.fps}`) || 0) + 1);
  const mm = (m) => { const v = [...m.values()]; return { min: Math.min(...v), max: Math.max(...v), values: v.length }; };
  const out = { pairs: mm(pairs) };
  for (const [k, m] of Object.entries(axes)) out[k] = mm(m);
  return out;
}

// the summary of a run: results = [{ ...case, key, l1, l2, l3, r, c (per cent), fails: [rule ids], error?, ms }]
export function summarise(results) {
  const worst = Object.fromEntries(RULES.map((r) => [r, { value: -1, at: null }]));
  const near = Object.fromEntries(RULES.map((r) => [r, 0]));
  const failing = [];
  let ms = 0;
  for (const x of results) {
    ms += x.ms || 0;
    for (const r of RULES) {
      if (x[r] > worst[r].value) worst[r] = { value: x[r], at: x };
      if (x[r] >= LIMITS[r] - 1) near[r]++;
    }
    if ((x.fails && x.fails.length) || x.error) failing.push(x);
  }
  return { lines: results.length, failing, worst, near, ms };
}
export const caseLabel = (x) => `${x.size} fps ${x.fps} ${x.speed}x ${x.clock} ${x.mode} seed ${x.seed}`;
