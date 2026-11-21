// DRIFT-12: the WHOLE Classic high contrast cycle held to the five flash rules (L1, L2, L3, R, C: X1_RULE_IDS) at 1x, 2x AND 4x in the REAL app: createApp itself in contrast mode from its first
// scene, every frame of a 170 s run metered (feedAll): Life, tunnel, wire, maze and blocktype and the four dissolves between them (tools/life-matrix.mjs --whole-cycle is the same run). Before
// DRIFT-12 the cycle read L2 100.00 % and L3 up to 54.75 % at 4x and L2 up to 60.71 % at 2x, all of it from the tunnel (tests/tunnel-flash-controls.test.js asserts the old look still fails).
// The speed keys are real `+` presses; the scene length is 30 s of scene time x the speed, so every scene is held for 30 REAL seconds at that speed and the run covers all five and all four
// dissolves (asserted from the scene ids the app reports). What this file covers (3060 frames a run at 18 fps, asserted):
//   grid arm      the exact clock, 1x, 2x and 4x, seeds 1 to 3, truecolor and 256 colours, at 40x10, 41x11, 78x24, 79x25, 88x39, 89x40, 80x24 and 120x40
//   fps arm       the exact clock, --fps 8, 10, 12, 15, 24 and 30 (18 is the arm above) at 40x10, 80x24 and 120x40, 1x, 2x and 4x, 256 colours seed 1 and truecolor seed 2
//   inverted      80x24 and 120x40, 1x, 2x and 4x, both colour modes, seed 1
//   shipped       the scene length the app ships with (180 s; 920 s of run, 16 560 frames) at 80x24, 256 colours, seed 1: 1x and 4x
//   alone         every scene of the mode on its own at 2x and 4x, 80x24 and 40x10, seeds 1 to 3: Life, tunnel, maze (wire and blocktype: tests/wire-blocktype-flash.test.js)
//   clock arms    q156 and jitter: 80x24 at 1x seeds 1 to 3, 2x seed 4, 4x seed 5 and 6; 41x11 4x seed 2; 40x10 2x seed 3; 80x24 4x --fps 8 seed 1; held by helpers-clock-arms to 15 % of the
//                 frames this file's grid arms meter (the last test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLife, PLAN, SPEED_OF } from './helpers-life-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';
import { line, MODES } from './helpers-wb-flash.js';

const SPEEDS = ['1x', '2x', '4x'];
const SIZES = [[40, 10], [41, 11], [78, 24], [79, 25], [88, 39], [89, 40], [80, 24], [120, 40]];
const cycle = ({ speed = '1x', sceneLen = 30, ...o }) => runLife({ seconds: sceneLen * 5 + 20, sceneSeconds: sceneLen * SPEED_OF[speed], keys: PLAN[speed], feedAll: true, stopAtDissolve: false, scene: 'life', startScene: 0, ...o });
function whole(r, label, o = {}) {
  const fps = o.fps || 18, len = o.sceneLen || 30;
  assert.equal(r.frames, Math.round((len * 5 + 20) * fps), `${label}: every frame of the run was metered (${r.frames})`);
  for (const id of ['life', 'tunnel', 'wire', 'maze', 'blocktype', 'fading']) assert.ok(r.ids.includes(id), `${label}: the run went through ${id}`);
  assert.equal(r.speedMax, SPEED_OF[o.speed || '1x'], `${label}: the key presses reached ${SPEED_OF[o.speed || '1x']}x`);
}
const check = async (o, label) => {
  const r = await cycle(o);
  whole(r, label, o);
  assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `${label}: ${line(r.rep)}`);
  return r;
};

for (const speed of SPEEDS) {
  for (const mode of MODES) {
    test(`DRIFT-12 whole cycle ${speed} grid, ${mode}, eight sizes, seeds 1 to 3: the five rules pass over all five scenes and the four dissolves`, async () => {
      for (const [cols, rows] of SIZES) {
        for (const seed of [1, 2, 3]) await check({ speed, cols, rows, mode, seed, clock: 'grid' }, `cycle ${speed} ${mode} ${cols}x${rows} seed ${seed}`);
      }
    });
    test(`DRIFT-12 whole cycle ${speed} grid, inverted, ${mode}, 80x24 and 120x40, seed 1: the five rules pass`, async () => {
      for (const [cols, rows] of [[80, 24], [120, 40]]) await check({ speed, cols, rows, mode, seed: 1, clock: 'grid', invert: true }, `cycle inverted ${speed} ${mode} ${cols}x${rows}`);
    });
  }
  test(`DRIFT-12 whole cycle ${speed} grid, --fps 8, 10, 12, 15, 24 and 30, 40x10, 80x24 and 120x40: the five rules pass`, async () => {
    for (const fps of [8, 10, 12, 15, 24, 30]) {
      for (const [cols, rows] of [[40, 10], [80, 24], [120, 40]]) {
        const [mode, seed] = fps % 2 === 0 ? ['256', 1] : ['truecolor', 2];
        await check({ speed, cols, rows, mode, seed, clock: 'grid', fps }, `cycle ${speed} fps ${fps} ${mode} ${cols}x${rows} seed ${seed}`);
      }
    }
  });
}

for (const speed of ['1x', '4x']) {
  test(`DRIFT-12 whole cycle at the shipped scene length (180 s), ${speed}, 256 colours, 80x24, seed 1: the five rules pass over 16 560 frames`, async () => {
    await check({ speed, sceneLen: 180, cols: 80, rows: 24, mode: '256', seed: 1, clock: 'grid' }, `cycle 180 s ${speed}`);
  });
}

for (const [scene, index] of [['life', 0], ['tunnel', 1], ['maze', 3]]) {
  for (const speed of ['2x', '4x']) {
    test(`DRIFT-12 ${scene} alone at ${speed}, 80x24 and 40x10, 256 colours and truecolor, seeds 1 to 3: the five rules pass (every scene of the mode at every asserted speed)`, async () => {
      for (const [cols, rows] of [[80, 24], [40, 10]]) {
        for (const mode of MODES) {
          for (const seed of [1, 2, 3]) {
            const r = await runLife({ cols, rows, mode, seed, clock: 'grid', seconds: 36, keys: PLAN[speed], sceneSeconds: 30 * SPEED_OF[speed], scene, startScene: index });
            assert.ok(r.frames >= 538, `${scene} ${speed} ${mode} ${cols}x${rows} seed ${seed}: the whole scene (${r.frames} frames)`);
            assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `${scene} ${speed} ${mode} ${cols}x${rows} seed ${seed}: ${line(r.rep)}`);
          }
        }
      }
    });
  }
}

for (const clock of ['q156', 'jitter']) {
  test(`DRIFT-12 whole cycle clock arm, ${clock}: 80x24 1x seeds 1 to 3, 2x seed 4, 4x seeds 5 and 6; 41x11 4x seed 2; 40x10 2x seed 3; 80x24 4x --fps 8`, async () => {
    const plan = [[80, 24, 1, '1x', 18], [80, 24, 2, '1x', 18], [80, 24, 3, '1x', 18], [80, 24, 4, '2x', 18], [80, 24, 5, '4x', 18], [80, 24, 6, '4x', 18], [41, 11, 2, '4x', 18], [40, 10, 3, '2x', 18], [80, 24, 1, '4x', 8]];
    for (const [cols, rows, seed, speed, fps] of plan) {
      const o = { cols, rows, mode: seed % 2 ? 'truecolor' : '256', seed, clock, clockSeed: seed, fps, speed };
      const r = await clockArm(() => cycle(o));
      whole(r, `${clock} ${cols}x${rows} seed ${seed} ${speed} fps ${fps}`, o);
      judgeX1(r.rep, `whole cycle ${clock} ${speed} ${o.mode} ${cols}x${rows} seed ${seed} fps ${fps}`);
    }
  });
}

test('DRIFT-12 whole cycle clock arms cost: read at most 15 % of the frames the grid arms of this file read (by count)', () => { assertArmCost('tunnel-cycle'); });
