// DRIFT-11: src/scenes/follow.js, the follower that wire and blocktype draw through, on its own: the per-cell gap, the per-step share and the per-painted-frame cap, with controls that show each
// one is the thing that holds. (Life, src/scenes/life.js, has its own copy of the same idea and its own tests, tests/life-frame-cap.test.js: the two sets of constants must agree.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFollow, follow, FLIP_GAP, FLIP_SHARE, FRAME_SHARE } from '../src/scenes/follow.js';
import { FLIP_SHARE as LIFE_SHARE, FRAME_SHARE as LIFE_FRAME } from '../src/scenes/life.js';
import { MAX_STEPS, STEP_HZ } from '../src/cells.js';
import { FLASH_FRACTION } from './helpers-flash.js';

test('DRIFT-11 follow constants: the same share and cap as Life (DRIFT-10), and a gap of which three changes cannot fit in the meter\'s second at any --fps from 8 to 30', () => {
  assert.equal(FLIP_SHARE, LIFE_SHARE);
  assert.equal(FRAME_SHARE, LIFE_FRAME);
  assert.equal(FLIP_GAP, 18);
  // three changes of one cell are at least 2 gaps apart; the meter's second is (fps - 1) / fps of a second between its first and last frame
  for (const fps of [8, 10, 12, 15, 18, 24, 30]) assert.ok((2 * FLIP_GAP) / STEP_HZ > (fps - 1) / fps + 0.1, `--fps ${fps}: ${(2 * FLIP_GAP) / STEP_HZ} s against a window of ${(fps - 1) / fps} s`);
  // two paints of FRAME_SHARE are what a late timer followed by one on time puts between two reads of the viewer's grid: the limit L3 allows
  assert.ok(2 * FRAME_SHARE <= FLASH_FRACTION + 1e-9, `${2 * FRAME_SHARE} against ${FLASH_FRACTION}`);
});

// a board whose target differs from what is shown in every cell
function allChanged(w, h, gap) {
  const f = createFollow(w, h, gap);
  f.target.fill(0x2588);
  f.dirty = true;
  return f;
}

test('DRIFT-11 follow frame cap: a painted frame that runs n steps changes at most max(n, FRAME_SHARE of the cells) of them, for every n up to MAX_STEPS, on boards from 10x4 to 400x100', () => {
  for (const [w, h] of [[10, 4], [13, 4], [15, 5], [20, 6], [25, 5], [80, 24], [400, 100]]) {
    const cells = w * h;
    for (let n = 1; n <= MAX_STEPS; n++) {
      const f = allChanged(w, h, 0);
      for (let k = 0; k < n; k++) follow(f, 1000 + k, n);
      assert.ok(f.flips <= Math.max(n, Math.floor(cells * FRAME_SHARE)), `${w}x${h} n=${n}: ${f.flips} cells changed in one painted frame`);
      assert.ok(f.flips >= 1, `${w}x${h} n=${n}: something changed (nothing waits for ever)`);
      if (cells >= 40) assert.ok(f.flips <= FLASH_FRACTION * cells, `${w}x${h} n=${n}: ${f.flips} of ${cells} cells is over ${FLASH_FRACTION * 100} %`);
    }
  }
});

test('DRIFT-11 follow share: one step changes at most FLIP_SHARE of the cells (at least one), and a change too big for the step finishes over the next steps', () => {
  const f = allChanged(80, 24, 0);
  follow(f, 1, 1);
  assert.equal(f.flips, Math.floor(80 * 24 * FLIP_SHARE));
  let steps = 1;
  while (f.dirty && steps < 100) { follow(f, 1 + steps, 1); steps++; }
  assert.deepEqual(Array.from(f.shown), Array.from(f.target), 'it arrives');
  assert.ok(steps <= Math.ceil(1 / FLIP_SHARE) + 1, `${steps} steps`);
  assert.equal(f.dirty, false);
});

// every cell asked to change at every step, for 300 steps: the smallest gap between two changes of one cell
function spacing(gap, w = 10, h = 4) {
  const f = createFollow(w, h, gap);
  const last = new Int32Array(w * h).fill(-1e9), flips = new Int32Array(w * h);
  let min = Infinity;
  for (let sub = 1; sub <= 300; sub++) {
    const before = f.shown.slice();
    f.target.fill(sub % 2 ? 0x2588 : 32); // the target flips at every step
    f.dirty = true;
    follow(f, sub, 1);
    for (let i = 0; i < w * h; i++) if (f.shown[i] !== before[i]) { min = Math.min(min, sub - last[i]); last[i] = sub; flips[i]++; }
  }
  return { min, most: Math.max(...flips) };
}
test('DRIFT-11 follow gap: with a target that changes every step a cell still changes at most once per FLIP_GAP steps (so at most 17 times in 300 steps); the control with the gap 0 changes at every step it is let', () => {
  const g = spacing(FLIP_GAP);
  assert.ok(g.min >= FLIP_GAP, `smallest spacing ${g.min}`);
  assert.ok(g.most <= Math.ceil(300 / FLIP_GAP), `most changes of one cell ${g.most}`);
  const none = spacing(0);
  assert.ok(none.min < FLIP_GAP && none.most > 2 * g.most, `control: spacing ${none.min}, ${none.most} changes of one cell`);
  const half = spacing(FLIP_GAP / 2);
  assert.ok(half.min < FLIP_GAP, `control: half the gap spaces changes ${half.min} steps apart`);
});

test('DRIFT-11 follow never adds changes: a shown cell only takes values its target had, so over a random target it changes no more often than the target does (any gap, any frame size)', () => {
  let seed = 7;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (const gap of [0, FLIP_GAP]) {
    for (const n of [1, 4, 8]) {
      const f = createFollow(20, 6, gap);
      const targetChanges = new Int32Array(120), shownChanges = new Int32Array(120);
      for (let sub = 1; sub <= 600; sub++) {
        if (sub % 5 === 0) for (let i = 0; i < 120; i++) if (rnd() < 0.3) { f.target[i] = f.target[i] === 32 ? 0x2588 : 32; targetChanges[i]++; f.dirty = true; }
        const before = f.shown.slice();
        follow(f, sub, n);
        for (let i = 0; i < 120; i++) if (f.shown[i] !== before[i]) { shownChanges[i]++; assert.equal(f.shown[i], f.target[i], 'a shown cell takes the target\'s value of that moment'); }
      }
      for (let i = 0; i < 120; i++) assert.ok(shownChanges[i] <= targetChanges[i], `gap ${gap} n ${n} cell ${i}: shown ${shownChanges[i]} changes, target ${targetChanges[i]}`);
    }
  }
});

test('DRIFT-11 follow cost: it looks at the cells only while something waits (a quiet board costs nothing), and at most once each per step', () => {
  const f = createFollow(400, 100, 18);
  for (let sub = 1; sub <= 50; sub++) follow(f, sub, 1);
  assert.equal(f.visits, 0);
  f.target[5] = 0x2588;
  f.dirty = true;
  follow(f, 51, 1);
  assert.ok(f.visits > 0 && f.visits <= 400 * 100, `${f.visits}`);
  assert.equal(f.shown[5], 0x2588);
  assert.equal(f.dirty, false);
  const v = f.visits;
  follow(f, 52, 1);
  assert.equal(f.visits, v, 'settled: no more visits');
});
