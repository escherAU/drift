// DRIFT-12: the tunnel scene of Classic high contrast against the five flash rules (X1_RULE_IDS) at the LOW and the HIGH frame rates, 256 colours, in the REAL app (the other colour mode:
// tests/tunnel-flash-fps.test.js; the runs: tests/helpers-wb-flash.js go(), the whole 30 real seconds of the scene, the meter reading every screen at the app's own --fps).
// What this file covers (asserted):
//   grid arm      the exact clock; --fps 8, 10, 12, 15, 18, 24 and 30 (the app's lowest is 8, src/app.js MIN_FPS); the eight sizes 40x10, 41x11, 78x24, 79x25, 88x39, 89x40, 80x24 and 120x40; seeds 1 to 8;
//                 1x and 4x (real `+` presses): the FULL cross, 896 runs. At 8 fps one painted frame holds 3.75 steps of the scene, and with a late timer two paints can sit between two reads of the
//                 viewer's grid: that is where L3 (30 % of the cells in one read) was thinnest in every measurement (24.50 % at --fps 10 on q156, 40x10)
//   clock arms    q156 and jitter (the clock seed is the app seed) on EVERY fps x size of the grid arm, one run each (seed 2 at 2x), 56 runs a clock, 112 in all: 12.5 % of the frames of the grid
//                 arm's 896 runs (helpers-clock-arms allows 15 %: the last test). The full cross on the clocks is the matrix tool's: `node tools/life-matrix.mjs --scene tunnel --clocks q156,jitter
//                 --fps 8,10,12,15,18,24,30 --sizes 40x10,41x11,78x24,79x25,88x39,89x40,80x24,120x40 --speeds 1x,2x,4x`, which the README's figures come from.
import test from 'node:test';
import { SEEDS, passes, go, whole } from './helpers-wb-flash.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';

const MODE = '256';
const FPS_LIST = [8, 10, 12, 15, 18, 24, 30];
const SIZES = [[40, 10], [41, 11], [78, 24], [79, 25], [88, 39], [89, 40], [80, 24], [120, 40]];

for (const speed of ['1x', '4x']) {
  for (const fps of FPS_LIST) {
    test(`DRIFT-12 tunnel ${speed} grid, --fps ${fps}, ${MODE}, the eight sizes, seeds 1 to 8: the five rules pass`, async () => {
      for (const [cols, rows] of SIZES) {
        for (const seed of SEEDS) await passes('tunnel', { speed, fps, cols, rows, mode: MODE, seed, clock: 'grid' }, `${speed} fps ${fps} ${MODE} ${cols}x${rows} seed ${seed}`);
      }
    });
  }
}

for (const clock of ['q156', 'jitter']) {
  for (const fps of FPS_LIST) {
    test(`DRIFT-12 tunnel clock arm, ${clock}, --fps ${fps}, ${MODE}, the eight sizes: seed 2 at 2x`, async () => {
      for (const [cols, rows] of SIZES) {
        const [seed, speed] = [2, '2x'];
        const o = { speed, fps, cols, rows, mode: MODE, seed, clock, clockSeed: seed };
        const r = await clockArm(() => go('tunnel', o));
        whole(r, `${clock} ${speed} fps ${fps} ${MODE} ${cols}x${rows} seed ${seed}`, o);
        judgeX1(r.rep, `tunnel ${speed} ${clock} fps ${fps} ${MODE} ${cols}x${rows} seed ${seed}`);
      }
    });
  }
}

test('DRIFT-12 tunnel fps clock arms cost (tunnel-flash-fps-256): read at most 15 % of the frames the grid arms of this file read (by count)', () => { assertArmCost('tunnel-flash-fps-256'); });
