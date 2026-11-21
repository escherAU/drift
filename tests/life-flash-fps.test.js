// DRIFT-10 correction round 1: Classic high contrast (the Life scene) held to the five flash rules (L1, L2, L3, R, C: X1_RULE_IDS) at the LOW frame rates, on small boards, in the REAL app.
// The defect it pins: at --fps 8 to 15 one painted frame holds three to six 1/30 s steps of the simulation, and the old per-step limit (8 % of the cells a step) let a reseed on a small
// board change 30 to 48 % of the screen in one painted frame (rule L3 allows 30 %). The fix (src/scenes/life.js, FRAME_SHARE; src/cells.js hands step() the number of steps a frame
// will run) caps the cells changed in one painted frame; tests/life-frame-cap.test.js pins the cap itself, tests/life-flash-controls.test.js shows the old code fails this file's runs.
// What this file covers (the meter reads every screen the viewer sees at the app's own --fps, the whole 30 s Life scene, as tests/life-flash.test.js):
//   grid arm      the exact clock; --fps 8, 10, 12, 15; sizes 10x4, 13x4, 15x5, 20x6, 25x5 and 80x24; seeds 1 to 8; truecolor and 256 colours; 1x and 4x (key presses, 30 real seconds of Life)
//   clock arms    q156 and jitter (the clock seed is the app seed); the same four rates and six sizes; 1x, both colour modes spread over the seeds, seeds 2 and 5 (the q156 clock reads worst there on the old
//                 Life); held by helpers-clock-arms to 15 % of the frames this file's grid arms meter (the last test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLife, PLAN, SPEED_OF } from './helpers-life-app.js';
import { failedRules, ruleOf, X1_RULE_IDS } from './helpers-flash.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';

const FPS_LIST = [8, 10, 12, 15];
const SIZES = [[10, 4], [13, 4], [15, 5], [20, 6], [25, 5], [80, 24]];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const line = (rep) => X1_RULE_IDS.map((id) => `${id} ${(ruleOf(rep, id).worstFraction * 100).toFixed(2)}`).join(' ');
const go = (o) => runLife({ seconds: 36, keys: PLAN[o.speed], sceneSeconds: 30 * SPEED_OF[o.speed], ...o });
function whole(r, label, o) {
  assert.ok(r.speedMax === SPEED_OF[o.speed], `${label}: the key presses reached ${SPEED_OF[o.speed]}x (top speed ${r.speedMax}x)`);
  assert.ok(r.frames >= 30 * o.fps - 2, `${label}: Life was on for its whole 30 real seconds (${r.frames} frames at ${o.fps} fps, ended at ${r.endedAt} s)`);
}

for (const speed of ['1x', '4x']) {
  for (const fps of FPS_LIST) {
    for (const mode of ['truecolor', '256']) {
      test(`DRIFT-10 life ${speed} grid, --fps ${fps}, ${mode}, the six small sizes, seeds 1 to 8: the five rules pass`, async () => {
        for (const [cols, rows] of SIZES) {
          for (const seed of SEEDS) {
            const o = { speed, fps, cols, rows, mode, seed, clock: 'grid' };
            const r = await go(o);
            whole(r, `${speed} fps ${fps} ${mode} ${cols}x${rows} seed ${seed}`, o);
            assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `${speed} fps ${fps} ${mode} ${cols}x${rows} seed ${seed}: ${line(r.rep)}`);
          }
        }
      });
    }
  }
}

for (const clock of ['q156', 'jitter']) {
  for (const fps of FPS_LIST) {
    test(`DRIFT-10 life 1x clock arm, ${clock}, --fps ${fps}, the six small sizes, seeds 2 and 5`, async () => {
      for (const [cols, rows] of SIZES) {
        for (const seed of [2, 5]) {
          const mode = seed === 2 ? '256' : 'truecolor';
          const o = { speed: '1x', fps, cols, rows, mode, seed, clock, clockSeed: seed };
          const r = await clockArm(() => go(o));
          whole(r, `${clock} fps ${fps} ${mode} ${cols}x${rows} seed ${seed}`, o);
          judgeX1(r.rep, `life 1x ${clock} fps ${fps} ${mode} ${cols}x${rows} seed ${seed}`);
        }
      }
    });
  }
}

test('DRIFT-10 life fps clock arms cost: read at most 15 % of the frames the grid arms of this file read (by count)', () => { assertArmCost('life flash fps'); });
