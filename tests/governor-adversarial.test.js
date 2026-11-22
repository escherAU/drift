// DRIFT-13 phase 1: the flash governor against adversaries, through the REAL flash meter. Every arm asserts the five rules at their 1x views (L1, L2, L3, R, C, on both grids) pass
// on the GOVERNED output, and the control arms assert the same adversary UNgoverned FAILS (otherwise the adversary proves nothing). The timelines are the app's own loop schedule on
// the grid, q156 and jitter clocks (tests/helpers-clock.js); the meter reads on the fps grid, as tests/helpers-life-app.js does.
//
// The cross is a stated, principled SUBSET (the full cross is 79 sizes x 23 fps x 6 adversaries x 3 clocks x 3 variants; tools/governor-matrix.mjs runs it in phase 3):
//   sizes   arm: EVERY size 40x10 .. 50x16 (all 77 column and row pairs) plus 80x24 and 120x40, one fps / adversary / clock each, chosen by a fixed rotation so that over the sizes every
//           adversary, every clock and every fps from 8 to 30 appears
//   fps     arm: EVERY integer fps 8 .. 30 at 40x10, 42x12 (the 56-cell fields), 45x12 and 80x24, adversary and clock rotating
//   matrix  arm: every adversary on every clock at 42x12 for fps 8, 18, 26 and 30
//   fast    arm: paints 1.5x and 2x faster than the viewer reads (a read catches two paints), fps 8, 18, 30, three sizes
//   big     arm: 120x40 at fps 8, 18, 30, every adversary
//   long    arm: 60 s at 42x12 (the 56-cell fields) and 80x24, fps 26, every clock
//   variants: strict, blocks and nbhd each run the matrix arm; nbhd (the shipped candidate) runs all of them
import test from 'node:test';
import assert from 'node:assert/strict';
import { runArm, failed, numbers, ADVERSARIES, MUST_FAIL } from './helpers-governor.js';
import { meterStats } from './helpers-flash.js';

const CLOCKS = ['grid', 'q156', 'jitter'];
const SIZES = [];
for (let c = 40; c <= 50; c++) for (let r = 10; r <= 16; r++) SIZES.push([c, r]);
SIZES.push([80, 24], [120, 40]);

const check = (o, label) => {
  const r = runArm(o);
  const bad = failed(r.rep);
  assert.deepEqual(bad, [], `${label}: ${numbers(r.rep)} (paints ${r.paints}, reads ${r.reads})`);
  return r;
};

test('DRIFT-13 adversarial (sizes): every size 40x10 .. 50x16 and 80x24, 120x40 passes the five rules governed (nbhd)', () => {
  const before = meterStats.frames;
  let worst = 0;
  SIZES.forEach(([cols, rows], i) => {
    const fps = 8 + ((i * 7) % 23), kind = ADVERSARIES[i % ADVERSARIES.length], clock = CLOCKS[Math.floor(i / ADVERSARIES.length) % 3];
    const seconds = cols * rows > 1000 ? 12 : 20;
    const r = check({ cols, rows, fps, clock, seed: i + 1, seconds, kind }, `${cols}x${rows} fps ${fps} ${clock} ${kind}`);
    worst = Math.max(worst, r.rep.l2.x1.worstFraction);
  });
  console.log(`GOVERNOR sizes arm: ${SIZES.length} sizes, ${meterStats.frames - before} meter frames, worst L2 ${(worst * 100).toFixed(2)} %`);
});

test('DRIFT-13 adversarial (fps): every integer fps 8 .. 30 passes at 40x10, 42x12, 45x12 and 80x24 (nbhd)', () => {
  const before = meterStats.frames;
  let i = 0;
  for (let fps = 8; fps <= 30; fps++) for (const [cols, rows] of [[40, 10], [42, 12], [45, 12], [80, 24]]) {
    const kind = ADVERSARIES[(i + fps) % ADVERSARIES.length], clock = CLOCKS[(i + 1) % 3];
    check({ cols, rows, fps, clock, seed: fps, seconds: cols * rows > 1000 ? 10 : 16, kind }, `${cols}x${rows} fps ${fps} ${clock} ${kind}`);
    i++;
  }
  console.log(`GOVERNOR fps arm: ${i} runs, ${meterStats.frames - before} meter frames`);
});

for (const variant of ['strict', 'blocks', 'nbhd']) {
  test(`DRIFT-13 adversarial (matrix): every adversary on every clock at 42x12, fps 8, 18, 26, 30 passes (${variant})`, () => {
    for (const fps of [8, 18, 26, 30]) for (const clock of CLOCKS) for (const kind of ADVERSARIES) {
      check({ cols: 42, rows: 12, fps, clock, seed: fps, seconds: 16, kind, governor: { variant } }, `${variant} 42x12 fps ${fps} ${clock} ${kind}`);
    }
  });
}

test('DRIFT-13 adversarial (fast paints): paints faster than the viewer reads (1.5x, 2x: a read catches two paints) pass at 40x10, 42x12 and 80x24 (nbhd)', () => {
  for (const paintRate of [1.5, 2]) for (const fps of [8, 18, 30]) for (const [cols, rows] of [[40, 10], [42, 12], [80, 24]]) for (const kind of ['flip', 'noise', 'checker']) {
    check({ cols, rows, fps, clock: CLOCKS[(fps + paintRate * 2) % 3], seed: fps, seconds: 10, kind, paintRate }, `${cols}x${rows} fps ${fps} paintRate ${paintRate} ${kind}`);
  }
});

test('DRIFT-13 adversarial (big): 120x40 at fps 8, 18, 30, every adversary (nbhd)', () => {
  for (const fps of [8, 18, 30]) for (const kind of ADVERSARIES) check({ cols: 120, rows: 40, fps, clock: CLOCKS[fps % 3], seed: 3, seconds: 8, kind }, `120x40 fps ${fps} ${kind}`);
});

test('DRIFT-13 adversarial (long): 60 s at 42x12 and 80x24, fps 26, every clock (nbhd)', () => {
  for (const [cols, rows] of [[42, 12], [80, 24]]) for (const clock of CLOCKS) check({ cols, rows, fps: 26, clock, seed: 9, seconds: 60, kind: clock === 'grid' ? 'noise' : clock === 'q156' ? 'dissolve' : 'sweep' }, `${cols}x${rows} 60 s ${clock}`);
});

// ---- the must-fail controls: the same adversaries, painted as they are
test('DRIFT-13 control: every adversary except the dissolve FAILS the meter ungoverned (so the governed passes are the governor\'s)', () => {
  for (const kind of MUST_FAIL) for (const [cols, rows, fps] of [[40, 10, 8], [42, 12, 18], [42, 12, 30], [80, 24, 18], [120, 40, 30]]) for (const clock of CLOCKS) {
    if (kind === 'lockstep56' && cols * rows > 600) continue; // a 56-cell board is a tenth of a 120x40 field: that case is legal there
    const r = runArm({ cols, rows, fps, clock, seed: 2, seconds: 8, kind, governor: false });
    assert.ok(failed(r.rep).length > 0, `${kind} ${cols}x${rows} fps ${fps} ${clock}: ungoverned it must fail (${numbers(r.rep)})`);
  }
  console.log('CONTROL ungoverned adversaries fail: flip, checker, noise, sweep, lockstep56 on 5 size/fps cases and 3 clocks');
});

test('DRIFT-13 control: the governed dissolve and the ungoverned dissolve read alike where the governor has nothing to hold (looks unchanged where they already pass)', () => {
  const a = runArm({ cols: 80, rows: 24, fps: 18, clock: 'grid', seconds: 16, kind: 'dissolve', governor: false });
  const b = runArm({ cols: 80, rows: 24, fps: 18, clock: 'grid', seconds: 16, kind: 'dissolve' });
  assert.deepEqual(failed(a.rep), []);
  assert.deepEqual(failed(b.rep), []);
  assert.equal(b.stats.held, 0, 'a plain dissolve (each cell flips twice in 4 s) is never held');
});
