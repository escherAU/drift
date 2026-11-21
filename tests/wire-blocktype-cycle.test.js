// DRIFT-11: the WHOLE Classic high contrast cycle held to the five flash rules (L1, L2, L3, R, C: X1_RULE_IDS) in the REAL app: createApp itself in contrast mode from its first scene, a scene
// length of 30 s, every frame of a 170 s run metered (feedAll): Life, tunnel, wire, maze and blocktype and the four dissolves between them (tools/life-matrix.mjs --whole-cycle is the same run).
// Before DRIFT-11 this read L1 43.52 and L2 99.54 (wire and blocktype; tests/wire-blocktype-flash-controls.test.js asserts that the old looks still read it). What this file covers (3060 frames
// a run at 18 fps, asserted):
//   grid arm      the exact clock, seeds 1 to 3, truecolor and 256 colours, at 80x24, 120x40, 60x16, 100x30, 78x24, 79x25, 89x40, 88x39 and the small-ish boards 41x11 and 40x10; and at --fps 8
//                 on 80x24, 41x11 and 120x40 (seeds 1 to 3, both colour modes)
//   clock arms    q156 and jitter (the clock seed is the app seed): 80x24 at --fps 18, seeds 1 to 3 (256 colours), 41x11 seed 2, and 80x24 at --fps 8 seed 1; held by helpers-clock-arms to 15 % of
//                 the frames this file's grid arms meter (the last test)
//   the others    tunnel and maze, which DRIFT-11 did not touch, and Life (DRIFT-10): each alone, 80x24, 1x, seeds 1 to 3 on the exact clock, pass (their source is unchanged: the render-hash test)
// NOT covered, and measured (README, "What the five rules do not cover"): the cycle on the smallest boards. Tunnel and maze read L2 over the limit on the small boards 10x4 to 25x5 (not DRIFT-11 scenes;
// tests/tools-life-matrix.test.js pins their readings); wire and blocktype alone pass those boards (tests/wire-blocktype-flash-sizes.test.js, wire-flash-fps, blocktype-flash-fps).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLife } from './helpers-life-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';
import { line, SCENE_INDEX } from './helpers-wb-flash.js';

const cycle = (o) => runLife({ seconds: 170, sceneSeconds: 30, feedAll: true, stopAtDissolve: false, scene: 'life', startScene: 0, ...o });
function whole(r, label, fps = 18) {
  assert.equal(r.frames, Math.round(170 * fps), `${label}: every frame of the 170 s run was metered (${r.frames})`);
  assert.ok(r.ids.includes('wire') && r.ids.includes('blocktype') && r.ids.includes('tunnel') && r.ids.includes('maze') && r.ids.includes('fading'), `${label}: the run went through all five scenes and the dissolves`);
}
const GRID_SIZES = [[80, 24], [120, 40], [60, 16], [100, 30], [78, 24], [79, 25], [89, 40], [88, 39], [41, 11], [40, 10]];

for (const mode of ['truecolor', '256']) {
  test(`DRIFT-11 whole cycle grid, ${mode}, ten sizes, seeds 1 to 3: the five rules pass over all five scenes and the four dissolves`, async () => {
    for (const [cols, rows] of GRID_SIZES) {
      for (const seed of [1, 2, 3]) {
        const r = await cycle({ cols, rows, mode, seed, clock: 'grid' });
        whole(r, `${mode} ${cols}x${rows} seed ${seed}`);
        assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `whole cycle ${mode} ${cols}x${rows} seed ${seed}: ${line(r.rep)}`);
      }
    }
  });
  test(`DRIFT-11 whole cycle grid, --fps 8, ${mode}, 80x24, 41x11 and 120x40, seeds 1 to 3: the five rules pass`, async () => {
    for (const [cols, rows] of [[80, 24], [41, 11], [120, 40]]) {
      for (const seed of [1, 2, 3]) {
        const r = await cycle({ cols, rows, mode, seed, clock: 'grid', fps: 8 });
        whole(r, `fps 8 ${mode} ${cols}x${rows} seed ${seed}`, 8);
        assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `whole cycle --fps 8 ${mode} ${cols}x${rows} seed ${seed}: ${line(r.rep)}`);
      }
    }
  });
}

for (const scene of ['life', 'tunnel', 'maze']) {
  test(`DRIFT-11 ${scene} alone, 80x24, 1x grid, 256 colours, seeds 1 to 3: the five rules still pass (the scenes DRIFT-11 left alone)`, async () => {
    for (const seed of [1, 2, 3]) {
      const r = await runLife({ cols: 80, rows: 24, mode: '256', seed, clock: 'grid', seconds: 32, scene, startScene: scene === 'life' ? 0 : scene === 'tunnel' ? 1 : 3 });
      assert.ok(r.frames >= 538, `${scene} seed ${seed}: the whole scene (${r.frames} frames)`);
      assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `${scene} seed ${seed}: ${line(r.rep)}`);
    }
  });
}

for (const clock of ['q156', 'jitter']) {
  test(`DRIFT-11 whole cycle clock arm, ${clock}, 80x24 seeds 1 to 3, 41x11 seed 2, 80x24 --fps 8 seed 1`, async () => {
    for (const [cols, rows, seed, fps] of [[80, 24, 1, 18], [80, 24, 2, 18], [80, 24, 3, 18], [41, 11, 2, 18], [80, 24, 1, 8]]) {
      const o = { cols, rows, mode: '256', seed, clock, clockSeed: seed, fps };
      const r = await clockArm(() => cycle(o));
      whole(r, `${clock} ${cols}x${rows} seed ${seed} fps ${fps}`, fps);
      judgeX1(r.rep, `whole cycle ${clock} 256 ${cols}x${rows} seed ${seed} fps ${fps}`);
    }
  });
}

test('DRIFT-11 whole cycle clock arms cost: read at most 15 % of the frames the grid arms of this file read (by count)', () => {
  assert.equal(SCENE_INDEX.wire, 2);
  assertArmCost('wire-blocktype-cycle');
});
