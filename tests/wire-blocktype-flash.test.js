// DRIFT-11: Classic high contrast, the wire scene and the blocktype scene, held to the five flash rules (L1, L2, L3, R, C: X1_RULE_IDS, the viewer's own second) in the REAL app at 1x, 2x
// and 4x (real `+` key presses). The owner decided on 2026-11-21 that the mode must pass the rules beyond Life; these two scenes read L1 40.74 / L2 98.61 (wire) and L2 81.02 (blocktype) before
// (tests/wire-blocktype-flash-controls.test.js asserts the old looks still fail, with the numbers). Helpers and what a 30 s run covers: tests/helpers-wb-flash.js.
// What this file covers (each scene, seeds 1 to 8, the whole 30 real seconds of the scene at the default --fps 18, asserted):
//   grid arm      the exact clock, 1x, 2x and 4x, truecolor and 256 colours, 80x24 and 120x40
//   clock arms    q156 and jitter (the clock seed is the app seed), 256 colours at 80x24 on seeds 1 to 4 at 1x and seed 5 at 4x, and truecolor at 120x40 on seed 2; held by
//                 helpers-clock-arms to 15 % of the frames this file's grid arms meter (the last test).
// Sizes at the layout breakpoints, the small boards, the inverted screen and the shipped scene length are tests/wire-blocktype-flash-sizes.test.js; the low frame rates
// are wire-flash-fps and blocktype-flash-fps; the whole high-contrast cycle is wire-blocktype-cycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, SEEDS, MODES, passes, coverage } from './helpers-wb-flash.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';
import { go, whole } from './helpers-wb-flash.js';

test('DRIFT-11 what a 30 s run covers: wire both phases and both switches, blocktype every transition kind in at least three slots in a row', () => {
  const c = coverage();
  assert.equal(c.wirePhases, 3, 'cube, torus, cube');
  assert.equal(c.wireSwitches, 2, 'the shrink and the grow at 13 s and at 26 s');
  assert.equal(c.blockSlots, 5);
  assert.ok(c.blockSlots >= 3, 'three slots in a row: wipe, scroll, wave');
  assert.equal(c.holdSeconds, 4.2);
});

for (const scene of SCENES) {
  for (const speed of ['1x', '2x', '4x']) {
    for (const mode of MODES) {
      for (const [cols, rows] of [[80, 24], [120, 40]]) {
        test(`DRIFT-11 ${scene} ${speed} grid, ${mode}, ${cols}x${rows}, seeds 1 to 8: the five rules pass over the whole 30 s scene`, async () => {
          for (const seed of SEEDS) await passes(scene, { speed, cols, rows, mode, seed, clock: 'grid' }, `${scene} ${speed} ${mode} ${cols}x${rows} seed ${seed}`);
        });
      }
    }
  }
}

for (const scene of SCENES) {
  for (const clock of ['q156', 'jitter']) {
    test(`DRIFT-11 ${scene} clock arm, ${clock}, 1x 256 colours 80x24 seeds 1 to 4 and 4x seed 5, truecolor 120x40 seed 2`, async () => {
      for (const [speed, seed] of [['1x', 1], ['1x', 2], ['1x', 3], ['1x', 4], ['4x', 5]]) {
        const o = { speed, cols: 80, rows: 24, mode: '256', seed, clock, clockSeed: seed };
        const r = await clockArm(() => go(scene, o));
        whole(r, `${scene} ${clock} ${speed} seed ${seed}`, o);
        judgeX1(r.rep, `${scene} ${clock} ${speed} 256 80x24 seed ${seed}`);
      }
      const o = { cols: 120, rows: 40, mode: 'truecolor', seed: 2, clock, clockSeed: 2 };
      const r = await clockArm(() => go(scene, o));
      whole(r, `${scene} ${clock} 120x40`, o);
      judgeX1(r.rep, `${scene} ${clock} 1x truecolor 120x40 seed 2`);
    });
  }
}

test('DRIFT-11 wire and blocktype clock arms cost: read at most 15 % of the frames the grid arms of this file read (by count)', () => { assertArmCost('wire-blocktype-flash'); });
