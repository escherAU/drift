// DRIFT-10 correction round 1: the per-PAINTED-FRAME cap of the Life scene (src/scenes/life.js FRAME_SHARE) and the count of steps the composer hands the scene (src/cells.js).
// Why: the viewer sees one picture per painted frame, and at --fps 8 to 15 a frame holds three to six 1/30 s steps (the composer steps from a time accumulator), so a limit per STEP is not a limit per
// frame. The cap is stated in cells per frame and does not depend on MIN_FPS or on the step rate: the composer tells step(s, n) how many steps the frame will run, and each step may change at most
// floor(cells * FRAME_SHARE / n) cells (never more than FLIP_SHARE of them, at least one so that a waiting cell is never stuck). What this file asserts:
//   cap          for every n from 1 to MAX_STEPS (read from src/cells.js) and every small size, the cells that change between two paints stay at or under FRAME_SHARE of the screen (plus, for n above
//                the steps a paint holds at MIN_FPS, the one cell a step that keeps a waiting cell from sticking); a run long enough to include reseeds, and the cap is reached at least once
//   relations    two paints can fall between two reads of the viewer's grid at every --fps from MIN_FPS to 30 (derived from the clock's late-fire bound, tests/helpers-clock.js), so twice FRAME_SHARE
//                is at or under the L3 limit (read from the meter); the steps one paint can hold at MIN_FPS (read from src/app.js) with the real step rate (src/cells.js) fit MAX_STEPS, and one
//                cell a step for that many steps stays inside the cap on the smallest listed board. If MIN_FPS drops, STEP_HZ rises or MAX_STEPS rises, one of these fails
//   composer     the count a frame runs is handed to every step() of that frame, on the real-time clock (realClock) and on the scene clock, and a step() with no count behaves as n = 1
import test from 'node:test';
import assert from 'node:assert/strict';
import life, { FLIP_SHARE, FRAME_SHARE } from '../src/scenes/life.js';
import { createCellComposer, MAX_STEPS, STEP_HZ } from '../src/cells.js';
import { MIN_FPS } from '../src/app.js';
import { STEP_FRACTION } from './helpers-flash.js';
import { QUANTUM_MS, JITTER_MS } from './helpers-clock.js';

const SIZES = [[10, 4], [13, 4], [15, 5], [20, 6], [25, 5], [80, 24]];
const SMALLEST = 10 * 4;

// cells (a cell = its two half blocks) that differ between two drawn pictures
function drawnDiff(s, prev) {
  let d = 0;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const top = 2 * y * s.w + x, bot = top + s.w;
    if (s.shown[top] !== prev[top] || s.shown[bot] !== prev[bot]) d++;
  }
  return d;
}

const STEPS_AT_FLOOR = Math.ceil(STEP_HZ / MIN_FPS) + 1; // a paint at the slowest rate, plus the step the accumulator carries over
// the most paints that can fall between two reads of a grid of one read per 1 / fps: paints are at least 1 / fps - (the latest a timer fires late) apart
const paintsPerRead = (fps) => Math.ceil(1 / fps / (1 / fps - Math.max(QUANTUM_MS, JITTER_MS) / 1000));

test('DRIFT-10 life frame cap: twice the share per painted frame is within the L3 limit at every --fps, and the steps a paint holds at MIN_FPS fit what the composer can hand over', () => {
  assert.ok(Number.isFinite(FRAME_SHARE) && FRAME_SHARE > 0, 'FRAME_SHARE is exported');
  for (let fps = MIN_FPS; fps <= 30; fps++) {
    const k = paintsPerRead(fps);
    assert.ok(k * FRAME_SHARE <= STEP_FRACTION + 1e-9, `--fps ${fps}: up to ${k} paints between two reads, ${k} x ${FRAME_SHARE} is over the L3 limit ${STEP_FRACTION}`);
  }
  assert.ok(FLIP_SHARE <= FRAME_SHARE, 'one step never changes more than a frame may');
  assert.ok(STEPS_AT_FLOOR <= MAX_STEPS, `a paint at ${MIN_FPS} fps holds up to ${STEPS_AT_FLOOR} steps; the composer hands over at most ${MAX_STEPS}`);
  // one cell a step is the least the scene ever lets through; on the smallest listed board, a paint at the floor must still fit the cap
  assert.ok(STEPS_AT_FLOOR <= Math.floor(FRAME_SHARE * SMALLEST), `${STEPS_AT_FLOOR} cells (one a step) on a 10x4 board are ${(STEPS_AT_FLOOR / SMALLEST * 100).toFixed(1)} % of it, over the cap ${(FRAME_SHARE * 100).toFixed(1)} %`);
});

for (let n = 1; n <= MAX_STEPS; n++) {
  test(`DRIFT-10 life frame cap: ${n} step${n > 1 ? 's' : ''} in a paint change at most FRAME_SHARE of the screen, every small size, seeds 1 to 4, reseeds included`, () => {
    for (const [w, h] of SIZES) {
      const cells = w * h;
      const limit = Math.max(Math.floor(cells * FRAME_SHARE + 1e-9), n > STEPS_AT_FLOOR ? n : 0); // above the steps a paint holds at the floor (a stall) one cell a step may exceed the share
      let worst = 0, reseeds = 0;
      for (const seed of [1, 2, 3, 4]) {
        const s = life.init(w, h, seed);
        for (let paint = 0; paint < Math.ceil(3600 / n); paint++) { // 2 minutes of steps: reseeds (idle after 3 s) happen many times
          const prev = Uint8Array.from(s.shown);
          for (let k = 0; k < n; k++) life.step(s, n);
          const d = drawnDiff(s, prev);
          if (d > worst) worst = d;
          assert.ok(d <= limit, `${w}x${h} seed ${seed} n ${n} paint ${paint}: ${d} of ${cells} cells changed (${(d / cells * 100).toFixed(1)} %), cap ${limit}`);
        }
        reseeds += s.reseeds;
      }
      assert.ok(reseeds >= 4, `${w}x${h} n ${n}: the runs include reseeds (${reseeds})`);
      assert.ok(worst >= 1, `${w}x${h} n ${n}: something changed`);
    }
  });
}

test('DRIFT-10 life frame cap: the cap binds (a reseed on a 10x4 board with 6 steps in a paint moves the cap and no more)', () => {
  const s = life.init(10, 4, 3);
  s.cells.fill(0); s.shown.fill(1); s.dirty = true; // the board is empty and the picture is full: every cell wants to change at once, the worst reseed
  const prev = Uint8Array.from(s.shown);
  for (let k = 0; k < 6; k++) life.step(s, 6);
  const d = drawnDiff(s, prev);
  assert.ok(d >= 1 && d <= Math.floor(40 * FRAME_SHARE), `${d} cells changed in a 6-step paint (cap ${Math.floor(40 * FRAME_SHARE)})`);
  assert.ok(d >= Math.floor(40 * FRAME_SHARE) / 2, `and the cap is mostly used (${d}): the rest waits for the next paints, it is not lost`);
});

test('DRIFT-10 life frame cap: a step with no count behaves as one step in the paint (the old call shape: renderScene, captures)', () => {
  const a = life.init(20, 6, 2), b = life.init(20, 6, 2);
  for (let i = 0; i < 600; i++) { life.step(a); life.step(b, 1); }
  assert.deepEqual(Array.from(a.shown), Array.from(b.shown));
});

// stub sims: record the second argument of every step()
function spySim(id, extra = {}) {
  const calls = [];
  return { calls, scene: { id, kind: 'sim', ...extra, init: () => ({}), step: (s, n) => { calls.push(n); }, draw: (s, p) => { p.glyphs.fill(32); p.colours.fill(0); } } };
}

test('DRIFT-10 composer: a frame that runs n steps hands n to each of them, on the real-time clock (realClock) and on the scene clock', () => {
  const rc = spySim('rc', { realClock: true }), sc = spySim('sc');
  const comp = createCellComposer({ scenes: [rc.scene, sc.scene], cols: 10, rows: 4, seed: 1 });
  comp.frame({ a: 0, b: 0, p: 0 }, 0, 0); // the first frame: no time has passed
  rc.calls.length = 0; sc.calls.length = 0;
  comp.frame({ a: 0, b: 0, p: 0 }, 0.14, 0.14); // 0.14 s = 4 steps
  assert.deepEqual(rc.calls, [4, 4, 4, 4]);
  comp.frame({ a: 1, b: 1, p: 0 }, 0.28, 0.28);
  assert.deepEqual(sc.calls.slice(-4), [4, 4, 4, 4]);
  // a frame at the slowest rate holds MIN_FPS's worth
  rc.calls.length = 0;
  comp.frame({ a: 0, b: 0, p: 0 }, 0.28 + 1 / MIN_FPS, 0.28 + 1 / MIN_FPS);
  assert.ok(rc.calls.length >= 3 && rc.calls.length <= MAX_STEPS, `${rc.calls.length} steps at ${MIN_FPS} fps`);
  assert.ok(rc.calls.every((v) => v === rc.calls.length), 'each of them was told the count');
});
