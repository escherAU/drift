// DRIFT-11: Classic high contrast, the wire scene, held to the five flash rules (X1_RULE_IDS) at the LOW frame rates on the SMALL boards, in the REAL app: the gap Desmond caught in DRIFT-10
// (tests/life-flash-fps.test.js), crossed with this scene from the start. At --fps 8 to 15 one painted frame holds three to six 1/30 s steps of the scene, and without the per-frame cap
// in src/scenes/follow.js a pose change on a small board changes 30 to 45 % of the screen in one painted frame (rule L3 allows 30 %); tests/wire-blocktype-flash-controls.test.js takes the cap out.
// What this file covers (the whole 30 real seconds of the scene, asserted; the meter reads every screen the viewer sees at the app's own --fps; what a run covers: tests/helpers-wb-flash.js):
//   grid arm      the exact clock; --fps 8, 10, 12, 15, 18 and 30; sizes 10x4, 13x4, 15x5, 20x6, 25x5 and 80x24; seeds 1 to 8; truecolor and 256 colours; 1x and 4x (key presses): the FULL cross,
//                 1152 runs
//   clock arms    q156 and jitter (the clock seed is the app seed) on EVERY fps x size of the grid arm (so every clock x the lowest fps 8 x every small board is in), two runs each:
//                 seed 2 in 256 colours at 1x and seed 5 in truecolor at 4x. 144 runs, 12.5 % of the frames of the grid arm's 1152 (the 15 % that helpers-clock-arms allows): the full cross
//                 on the clocks (both colour modes, both speeds, eight seeds, 2304 more runs) is `node tools/life-matrix.mjs --scene wire --clocks q156,jitter --fps 8,10,12,15,18,30
//                 --sizes 10x4,13x4,15x5,20x6,25x5,80x24 --speeds 1x,4x`, which the README's figures come from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEEDS, MODES, SMALL, passes, go, whole } from './helpers-wb-flash.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';

const SCENE = 'wire';
const FPS_LIST = [8, 10, 12, 15, 18, 30];
const SIZES = [...SMALL, [80, 24]];

for (const speed of ['1x', '4x']) {
  for (const fps of FPS_LIST) {
    for (const mode of MODES) {
      test(`DRIFT-11 wire ${speed} grid, --fps ${fps}, ${mode}, the six sizes, seeds 1 to 8: the five rules pass`, async () => {
        for (const [cols, rows] of SIZES) {
          for (const seed of SEEDS) await passes(SCENE, { speed, fps, cols, rows, mode, seed, clock: 'grid' }, `${speed} fps ${fps} ${mode} ${cols}x${rows} seed ${seed}`);
        }
      });
    }
  }
}

for (const clock of ['q156', 'jitter']) {
  for (const fps of FPS_LIST) {
    test(`DRIFT-11 wire clock arm, ${clock}, --fps ${fps}, the six sizes: seed 2 at 1x (256 colours) and seed 5 at 4x (truecolor)`, async () => {
      for (const [cols, rows] of SIZES) {
        for (const [seed, speed, mode] of [[2, '1x', '256'], [5, '4x', 'truecolor']]) {
          const o = { speed, fps, cols, rows, mode, seed, clock, clockSeed: seed };
          const r = await clockArm(() => go(SCENE, o));
          whole(r, `${clock} ${speed} fps ${fps} ${mode} ${cols}x${rows} seed ${seed}`, o);
          judgeX1(r.rep, `wire ${speed} ${clock} fps ${fps} ${mode} ${cols}x${rows} seed ${seed}`);
        }
      }
    });
  }
}

test('DRIFT-11 wire fps clock arms cost: read at most 15 % of the frames the grid arms of this file read (by count)', () => { assertArmCost('wire-flash-fps'); });
