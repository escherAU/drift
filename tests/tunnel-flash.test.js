// DRIFT-12: Classic high contrast, the tunnel scene, held to the five flash rules (L1, L2, L3, R, C: X1_RULE_IDS, the viewer's own second) in the REAL app at 1x, 2x and 4x (real `+` key
// presses). Before DRIFT-12 the tunnel read L2 up to 57.14 % at 2x and 100.00 % at 4x, L1 up to 17.86 % and L3 up to 55.50 % at 4x (tests/tunnel-flash-controls.test.js asserts that the old
// look still fails, with the numbers): its flow followed the speed keys, so every cell flipped two and four times as often. It is a sim on the real-time clock now (src/scenes/tunnel.js).
// The runs are tests/helpers-wb-flash.js go(): createApp in contrast mode started on the tunnel scene, a scene length of 30 s of scene time (the shipped default is 180 s: the sizes file runs
// that too), the whole 30 REAL seconds of the scene (sceneSeconds = 30 * speed), at the default --fps 18.
// What this file covers (seeds 1 to 8, asserted):
//   grid arm      the exact clock, 1x, 2x and 4x, truecolor and 256 colours, 80x24 and 120x40
//   clock arms    q156 and jitter (the clock seed is the app seed), 256 colours at 80x24 on seeds 1 to 4 at 1x and seed 5 at 4x, and truecolor at 120x40 on seed 2; held by
//                 helpers-clock-arms to 15 % of the frames this file's grid arms meter (the last test).
// The layout breakpoints, the inverted screen and the shipped scene length are tests/tunnel-flash-sizes.test.js; the frame rates are tunnel-flash-fps(-256); the whole high-contrast cycle
// is tunnel-cycle.
import test from 'node:test';
import { SEEDS, MODES, passes, go, whole } from './helpers-wb-flash.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';

for (const speed of ['1x', '2x', '4x']) {
  for (const mode of MODES) {
    for (const [cols, rows] of [[80, 24], [120, 40]]) {
      test(`DRIFT-12 tunnel ${speed} grid, ${mode}, ${cols}x${rows}, seeds 1 to 8: the five rules pass over the whole 30 s scene`, async () => {
        for (const seed of SEEDS) await passes('tunnel', { speed, cols, rows, mode, seed, clock: 'grid' }, `tunnel ${speed} ${mode} ${cols}x${rows} seed ${seed}`);
      });
    }
  }
}

for (const clock of ['q156', 'jitter']) {
  test(`DRIFT-12 tunnel clock arm, ${clock}, 256 colours 80x24: 1x seeds 1 to 4, 4x seed 5; truecolor 120x40 seed 2`, async () => {
    for (const [speed, seed] of [['1x', 1], ['1x', 2], ['1x', 3], ['1x', 4], ['4x', 5]]) {
      const o = { speed, cols: 80, rows: 24, mode: '256', seed, clock, clockSeed: seed };
      const r = await clockArm(() => go('tunnel', o));
      whole(r, `tunnel ${clock} ${speed} seed ${seed}`, o);
      judgeX1(r.rep, `tunnel ${clock} ${speed} 256 80x24 seed ${seed}`);
    }
    const o = { cols: 120, rows: 40, mode: 'truecolor', seed: 2, clock, clockSeed: 2 };
    const r = await clockArm(() => go('tunnel', o));
    whole(r, `tunnel ${clock} 120x40`, o);
    judgeX1(r.rep, `tunnel ${clock} 1x truecolor 120x40 seed 2`);
  });
}

test('DRIFT-12 tunnel clock arms cost: read at most 15 % of the frames the grid arms of this file read (by count)', () => { assertArmCost('tunnel-flash'); });
