// DRIFT-13 phase 2: the flash governor as WIRED into the app (src/app.js govern()). The helpers the wired tests and tools/governor-wired.mjs share.
//
// A SPY TREE is a temporary copy of src/ (tests/helpers-life-app.js makeTree) with two one-line additions that only OBSERVE: src/app.js reports every governed paint (the composed frame, what was
// painted, the governor, `wall`) to globalThis.__gov13.spy, and src/governor.js counts every governor built and every paint governed in globalThis.__gov13. Nothing else differs from the
// shipped code, so the bytes the app writes are the same (tests/governor-app.test.js asserts it on a run). The real tree is what the rule tests judge; the spy tree is for what the screen
// cannot tell: which cells were held, what the composer asked for, and whether the governor was ever made.
import assert from 'node:assert/strict';
import { runLife, makeTree, rmTree, plusKeys } from './helpers-life-app.js';
import { ruleOf } from './helpers-flash.js';

export const GOV_CALL = 'const g = gov.govern(f.glyphs, f.shades, wall);';
export const GOV_BUILD = "if (!(fps > 0)) throw new RangeError('createGovernor: fps must be positive');";
export const GOV_PAINT = 'stats.paints++;';
const must = (text, from, to) => { assert.ok(text.split(from).length === 2, `spy edit: ${from} occurs exactly once`); return text.replace(from, to); };

export const SPY_EDITS = {
  'src/app.js': (t) => must(t, GOV_CALL, `${GOV_CALL} if (globalThis.__gov13 && globalThis.__gov13.spy) globalThis.__gov13.spy(f, g, gov, wall);`),
  'src/governor.js': (t) => must(must(t, GOV_BUILD, `globalThis.__gov13 = globalThis.__gov13 || {}; globalThis.__gov13.built = (globalThis.__gov13.built || 0) + 1; ${GOV_BUILD}`), GOV_PAINT, `${GOV_PAINT} if (globalThis.__gov13) globalThis.__gov13.paints = (globalThis.__gov13.paints || 0) + 1;`),
};

// edits: more tree edits on top of the spy (the mutants); runLife's options as they are. onPaint(f, g, gov, wall, app) is called for every governed paint with the composed frame f (help
// panel included) and the painted frame g (both { glyphs, shades }: valid only inside the call). Returns the runLife result plus { built, paints } (governors made, paints governed).
// the same spy tree for a test that builds its own app (tests/helpers-size-card.js startCard with `root`): fn(root, g13); g13.app is the test's to set, g13.spy is called on every governed paint
export async function withSpyTree(fn, { onPaint = null, edits = {} } = {}) {
  const merged = { ...SPY_EDITS };
  for (const [rel, f2] of Object.entries(edits)) { const first = merged[rel]; merged[rel] = first ? (t) => f2(first(t)) : f2; }
  const root = makeTree('new', merged);
  const g13 = { built: 0, paints: 0, spy: null, app: null };
  if (onPaint) g13.spy = (f, g, gov, wall) => onPaint(f, g, gov, wall, g13.app);
  globalThis.__gov13 = g13;
  try { return await fn(root, g13); } finally { globalThis.__gov13 = undefined; rmTree(root); }
}

export async function runSpied(o = {}, { onPaint = null, edits = {}, treeLife = 'new' } = {}) {
  const merged = { ...SPY_EDITS };
  for (const [rel, fn] of Object.entries(edits)) { const first = merged[rel]; merged[rel] = first ? (t) => fn(first(t)) : fn; }
  const root = makeTree(treeLife, merged);
  const g13 = { built: 0, paints: 0, spy: null };
  globalThis.__gov13 = g13;
  let appRef = null;
  if (onPaint) g13.spy = (f, g, gov, wall) => onPaint(f, g, gov, wall, appRef);
  try {
    const r = await runLife({ ...o, root, onApp: (a) => { appRef = a; } });
    return { ...r, built: g13.built, paints: g13.paints };
  } finally {
    globalThis.__gov13 = undefined;
    rmTree(root);
  }
}

// ---- the whole Classic high contrast cycle in the real app, and the cases Desmond Hale named
// SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]: from 1x, one `+` press is 1.5x, two 2x, three 3x, four 4x (real presses, as tests/helpers-life-app.js PLAN)
export const PLANS = { 1: [], 1.5: plusKeys(1), 2: plusKeys(2), 3: plusKeys(3), 4: plusKeys(4) };
export const CYCLE_SECONDS = 170; // five scenes of 30 real seconds and the four dissolves of 2 s between them (and a little of the second lap)

// o: { cols, rows, fps, seed, clock, speed (1, 1.5, 2, 3, 4), mode ('256' | 'truecolor') }; extra: runLife options on top (root, grab, beforeFrame, invert ...)
export function cycle(o, extra = {}) {
  const { cols, rows, fps, seed, clock = 'grid', speed = 1, mode = '256' } = o;
  return runLife({ cols, rows, fps, seed, clock, clockSeed: seed, mode, keys: PLANS[speed], sceneSeconds: 30 * speed, seconds: CYCLE_SECONDS, feedAll: true, stopAtDissolve: false, ...extra });
}

// The cases of the README's "Not covered" (4) and the two 25.00 % edges of DRIFT-12, whole cycle, seeds as Desmond found them. `before` is the worst reading of `rule` on the tree before the
// governor was wired in (BEFORE13_EDITS), as the run printed it; `fails` says whether that reading is over the limit (the edges pass at it, with no margin).
export const DESMOND = [
  { id: '42x12 grid 1x --fps 26 seed 6', cols: 42, rows: 12, fps: 26, seed: 6, clock: 'grid', speed: 1, mode: '256', rule: 'l2.x1', before: '26.79', fails: true },
  { id: '42x12 grid 1x --fps 27 seed 6', cols: 42, rows: 12, fps: 27, seed: 6, clock: 'grid', speed: 1, mode: '256', rule: 'l2.x1', before: '28.57', fails: true },
  { id: '42x12 grid 1x --fps 26 seed 6 truecolor', cols: 42, rows: 12, fps: 26, seed: 6, clock: 'grid', speed: 1, mode: 'truecolor', rule: 'l2.x1', before: '26.79', fails: true },
  { id: '45x12 q156 1x --fps 21 seed 6', cols: 45, rows: 12, fps: 21, seed: 6, clock: 'q156', speed: 1, mode: '256', rule: 'l2.x1', before: '26.67', fails: true },
  { id: '45x12 q156 4x --fps 21 seed 6', cols: 45, rows: 12, fps: 21, seed: 6, clock: 'q156', speed: 4, mode: '256', rule: 'l2.x1', before: '26.67', fails: true },
  { id: '41x12 q156 2x --fps 9 seed 5', cols: 41, rows: 12, fps: 9, seed: 5, clock: 'q156', speed: 2, mode: '256', rule: 'l3', before: '30.28', fails: true },
  { id: '42x12 q156 1.5x --fps 21 seed 6', cols: 42, rows: 12, fps: 21, seed: 6, clock: 'q156', speed: 1.5, mode: '256', rule: 'l2.x1', before: '26.79', fails: true },
  { id: '42x12 grid 1.5x --fps 23 seed 6', cols: 42, rows: 12, fps: 23, seed: 6, clock: 'grid', speed: 1.5, mode: '256', rule: 'l2.x1', before: '26.79', fails: true },
  { id: '42x12 grid 1.5x --fps 25 seed 6', cols: 42, rows: 12, fps: 25, seed: 6, clock: 'grid', speed: 1.5, mode: '256', rule: 'l2.x1', before: '26.79', fails: true },
  { id: '42x12 grid 1x --fps 24 seed 6 (25.00 edge)', cols: 42, rows: 12, fps: 24, seed: 6, clock: 'grid', speed: 1, mode: '256', rule: 'l2.x1', before: '25.00', fails: false },
  { id: '40x10 grid 1x --fps 30 seed 7 (25.00 edge)', cols: 40, rows: 10, fps: 30, seed: 7, clock: 'grid', speed: 1, mode: '256', rule: 'l2.x1', before: '25.00', fails: false },
  { id: '40x10 grid 4x --fps 24 seed 8 (25.00 edge)', cols: 40, rows: 10, fps: 24, seed: 8, clock: 'grid', speed: 4, mode: '256', rule: 'l2.x1', before: '25.00', fails: false },
];
export const pctOf = (rep, id) => (ruleOf(rep, id).worstFraction * 100).toFixed(2);

// ---- the principled sample across the sweep (tests/governor-sweep.test.js)
// Sizes: the boards of 56 to 72 cells where Classic has no room (40x10 to 46x12), a middle size, the usual ones, and the shell's layout breakpoints 78x24 and 88x39 (src/shell/*: the tiers
// switch at 78 columns and at 88 x 39).
export const SWEEP_SIZES = [[40, 10], [41, 10], [42, 10], [40, 11], [41, 11], [42, 11], [40, 12], [41, 12], [42, 12], [43, 12], [45, 12], [46, 12], [50, 16], [80, 24], [120, 40], [78, 24], [88, 39]];
export const SWEEP_FPS = [8, 9, 12, 18, 21, 24, 26, 27, 30];
export const SWEEP_SPEEDS = [1, 1.5, 2, 3, 4];
const ROT = 4; // grid cases per size: each size meets four of the nine frame rates, four of the five speeds, both colour modes and four seeds, rotated so that every size, rate and speed is hit about as often
export const ROTATION = SWEEP_SIZES.flatMap(([cols, rows], i) => Array.from({ length: ROT }, (_, j) => ({
  id: `${cols}x${rows} grid ${SWEEP_SPEEDS[(i + j) % 5]}x --fps ${SWEEP_FPS[(i + 2 * j) % 9]} ${(i + j) % 2 ? 'truecolor' : '256'} seed ${1 + ((i * 3 + j * 5) % 8)}`,
  cols, rows, fps: SWEEP_FPS[(i + 2 * j) % 9], seed: 1 + ((i * 3 + j * 5) % 8), clock: 'grid', speed: SWEEP_SPEEDS[(i + j) % 5], mode: (i + j) % 2 ? 'truecolor' : '256',
})));
// the clock arms of the rotation: q156 and jitter (clock seed = app seed), on the sizes and rates where the viewer's grid and the timer disagree most; held to 15 % of the grid frames by
// tests/helpers-clock-arms.js
export const CLOCK_ROTATION = [
  { cols: 42, rows: 10, fps: 12, seed: 3, clock: 'q156', speed: 2, mode: '256' },
  { cols: 41, rows: 11, fps: 24, seed: 4, clock: 'jitter', speed: 3, mode: 'truecolor' },
  { cols: 50, rows: 16, fps: 30, seed: 8, clock: 'q156', speed: 4, mode: '256' },
  { cols: 80, rows: 24, fps: 18, seed: 2, clock: 'q156', speed: 1, mode: '256' },
  { cols: 120, rows: 40, fps: 8, seed: 5, clock: 'jitter', speed: 1.5, mode: 'truecolor' },
  { cols: 78, rows: 24, fps: 27, seed: 6, clock: 'q156', speed: 1, mode: 'truecolor' },
  { cols: 88, rows: 39, fps: 21, seed: 7, clock: 'jitter', speed: 2, mode: '256' },
].map((o) => ({ ...o, id: `${o.cols}x${o.rows} ${o.clock} ${o.speed}x --fps ${o.fps} ${o.mode} seed ${o.seed}` }));
export const SAMPLE = [...DESMOND, ...ROTATION, ...CLOCK_ROTATION];
