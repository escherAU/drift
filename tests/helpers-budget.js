// The byte and CPU budget helper for full-colour scenes (DRIFT-7 C4b).
//
// A full-colour frame costs terminal bytes every time a cell's colours change, so a scene has a byte budget:
//
//   const m = measureBytes(sceneOrSource, 240, 67, BUDGET_RUN['240x67']);   // { steady, worst, frames, total, perFrame }
//   checkBudget(m, { steady: SCENE_LIMIT_STEADY, worst: SCENE_LIMIT_WORST });
//
// measureBytes feeds the REAL renderer (src/renderer.js createRenderer), truecolor, exact 1/18 s steps (frame k at
// t = k / fps). The first frame (the full repaint) is rendered and dropped. What the app writes per frame is
// SYNC_BEGIN + render() + SYNC_END (only when render() is not empty), so that is what is counted, in UTF-8 bytes.
//   steady  total / seconds                        bytes per second over the whole run
//   worst   the largest sum over any 18 consecutive frames (a run shorter than that: the whole run)
//   frames  seconds * fps                          frames counted (the dropped first frame is not one)
//   total   bytes over those frames
//   perFrame  the bytes of each counted frame (so a test can see where the traffic is)
//
// What it measures. `source` is either a cells/sim scene (kind 'cells' | 'sim', run through createCellComposer, with the
// frame handed to the renderer the way src/app.js renderArgs does it: fg/bg attached only when a full-colour cell is on
// screen) or a frame source (t, cols, rows) => { glyphs, shades?, fg?, bg? }.
//
// Limits. A scene's own limit is its measured rate x 1.10, rounded up to the next 10 KB/s (limitFromMeasured). The cartridge
// ticket that adds a scene measures it at BUDGET_RUN and writes the two limits down as constants; checkBudget then asserts
// both measured values are within them, and that the limits themselves are within the global ceilings (STEADY_CEILING,
// WORST_SECOND_CEILING), so a limit cannot be raised past the ceiling.
//
// CPU. measureCpu is the mean of (scene + render) per frame, in ms, after warm-up (see CPU_RUN) at 240x67, in this
// process, best of three runs. A timing check shares the machine with whatever else is running: tests/budget-cpu.test.js
// holds it, and `node --test --test-concurrency=1 tests/budget-cpu.test.js` is the authoritative run.
import assert from 'node:assert/strict';
import { createRenderer, SYNC_BEGIN, SYNC_END, RGB_CELL } from '../src/renderer.js';
import { createCellComposer } from '../src/cells.js';
import { makePalette } from '../src/color.js';

export const BUDGET_FPS = 18;
export const STEADY_CEILING = 12_000_000;       // bytes per second, whole run
export const WORST_SECOND_CEILING = 12_700_000; // bytes in any 18 consecutive frames
export const CPU_MEAN_CEILING_MS = 27;          // mean ms per frame (scene + render) at 240x67
export const BUDGET_RUN = { '120x40': 60, '240x67': 30 }; // seconds per size for measureBytes callers
export const CPU_RUN = { cols: 240, rows: 67, warmup: 18, frames: 180, runs: 3 };

// limit = ceil(measured x 1.10), rounded up to the next multiple of LIMIT_ROUND. 1.10 is done as 11 / 10 on the
// integer side so that 100_000 gives exactly 110_000 and not 120_000 (100_000 * 1.1 is 110000.00000000001, which rounds up
// to 110_001 and then to the next 10_000).
export const LIMIT_MARGIN_NUM = 11;
export const LIMIT_MARGIN_DEN = 10;
export const LIMIT_ROUND = 10_000;
export function limitFromMeasured(bytesPerS) {
  const padded = Math.ceil((bytesPerS * LIMIT_MARGIN_NUM) / LIMIT_MARGIN_DEN);
  return Math.ceil(padded / LIMIT_ROUND) * LIMIT_ROUND;
}

const PALETTE = makePalette([200, 100, 50], 'truecolor');

// -> (t) => renderer arguments, shaped like src/app.js renderArgs
function argsSource(source, cols, rows) {
  const isScene = source && (source.kind === 'cells' || source.kind === 'sim');
  const cc = isScene ? createCellComposer({ scenes: [source], cols, rows, seed: 1 }) : null;
  const allRgb = new Uint8Array(cols * rows).fill(RGB_CELL);
  return (t) => {
    const f = cc ? cc.frame({ a: 0, b: 0, p: 0 }, t) : source(t, cols, rows);
    const shades = f.shades || allRgb;
    const a = { cols, rows, glyphs: f.glyphs, shades, palette: PALETTE };
    if (f.fg && shades.indexOf(RGB_CELL) !== -1) { a.fg = f.fg; a.bg = f.bg; a.mode = 'truecolor'; }
    return a;
  };
}

export function measureBytes(source, cols, rows, seconds, fps = BUDGET_FPS) {
  const next = argsSource(source, cols, rows);
  const renderer = createRenderer();
  const N = Math.round(seconds * fps);
  const perFrame = [];
  let total = 0;
  for (let k = 0; k <= N; k++) {
    const out = renderer.render(next(k / fps));
    if (k === 0) continue; // the full repaint
    const bytes = out ? Buffer.byteLength(SYNC_BEGIN + out + SYNC_END, 'utf8') : 0;
    perFrame.push(bytes);
    total += bytes;
  }
  const win = Math.min(fps, perFrame.length);
  let sum = 0, worst = 0;
  for (let i = 0; i < perFrame.length; i++) {
    sum += perFrame[i];
    if (i >= win) sum -= perFrame[i - win];
    if (i >= win - 1 && sum > worst) worst = sum;
  }
  return { steady: total / seconds, worst, frames: perFrame.length, total, perFrame };
}

// Both global ceilings are checked on the LIMITS first (a limit past a ceiling is refused whatever was measured), then the
// measured values against the limits. Failures say "steady" or "worst" and give both numbers.
export function checkBudget(measured, limit) {
  assert.ok(limit.steady <= STEADY_CEILING, `steady limit ${limit.steady} B/s is over the ceiling ${STEADY_CEILING}`);
  assert.ok(limit.worst <= WORST_SECOND_CEILING, `worst limit ${limit.worst} B/s is over the ceiling ${WORST_SECOND_CEILING}`);
  assert.ok(measured.steady <= limit.steady, `steady ${Math.round(measured.steady)} B/s is over its limit ${limit.steady}`);
  assert.ok(measured.worst <= limit.worst, `worst second ${measured.worst} B is over its limit ${limit.worst}`);
}

// Mean ms per frame of (scene + render), `frames` frames after `warmup`, best of `runs` fresh runs. Each run starts a new
// composer and renderer at t = 0 and steps t by 1 / fps.
export function measureCpu(source, { cols = CPU_RUN.cols, rows = CPU_RUN.rows, warmup = CPU_RUN.warmup, frames = CPU_RUN.frames, runs = CPU_RUN.runs, fps = BUDGET_FPS } = {}) {
  const runsMs = [];
  for (let r = 0; r < runs; r++) {
    const next = argsSource(source, cols, rows);
    const renderer = createRenderer();
    let ns = 0n;
    for (let k = 0; k < warmup + frames; k++) {
      const t0 = process.hrtime.bigint();
      renderer.render(next(k / fps));
      const dt = process.hrtime.bigint() - t0;
      if (k >= warmup) ns += dt;
    }
    runsMs.push(Number(ns) / 1e6 / frames);
  }
  return { meanMs: Math.min(...runsMs), runsMs, frames };
}

export function checkCpu(measured) {
  assert.ok(measured.meanMs <= CPU_MEAN_CEILING_MS, `mean ${measured.meanMs.toFixed(2)} ms per frame is over the ceiling ${CPU_MEAN_CEILING_MS} ms`);
}
