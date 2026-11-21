// DRIFT-11: the wire and blocktype scenes of Classic high contrast against the five flash rules (X1_RULE_IDS) in the REAL app at the sizes where a layout or a limit changes, inverted, and at the
// shipped scene length. The same runs as tests/wire-blocktype-flash.test.js (helpers and what a 30 s run covers: tests/helpers-wb-flash.js), at the default --fps 18, 1x.
// What this file covers (each scene, seeds 1 to 8, the whole scene):
//   breakpoints   40x10, 41x11, 78x24, 79x25, 88x39, 89x40: the shell's layout breakpoints (src/shell/ui.js lines 137-139: 'list' from 40x10, 'compact' from 78x24, 'full' from 88x39) and the size
//                 just above each. Neither scene reads those breakpoints (both draw the whole grid); they are here because the rules' field (a third of the screen each way) and the scenes' layouts
//                 (the word's scale, the shape's size) step with the size.
//   small boards  10x4, 13x4, 15x5, 20x6, 25x5 (40 to 125 cells): a whole transition or pose change is a large share of the screen, which the per-frame cap in src/scenes/follow.js spreads over
//                 frames (tests/wire-blocktype-flash-controls.test.js takes it out and L3 fails)
//   inverted      80x24 and 120x40 with the config's invert on (what the `i` key leaves), both colour modes
//   scene length  a scene length of 30 s is every run (the matrix tool's); one arm per scene holds the scene for the SHIPPED 180 s (DEFAULTS in src/app.js) at 80x24, 256 colours, seed 1:
//                 the cube and the torus alternating thirteen seconds at a time and thirty words, 3240 frames
//   clock arms    q156 and jitter: 41x11 seed 2, 79x25 seed 3, 10x4 seed 5 and 20x6 seed 6 (256 colours and truecolor alternating), held to 15 % of this file's grid frames (the last test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, SEEDS, MODES, SMALL, BREAKPOINTS, passes, go, whole, line } from './helpers-wb-flash.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';

for (const scene of SCENES) {
  for (const mode of MODES) {
    test(`DRIFT-11 ${scene} 1x grid, ${mode}, the layout breakpoint sizes and the small boards, seeds 1 to 8: the five rules pass`, async () => {
      for (const [cols, rows] of [...BREAKPOINTS, ...SMALL]) {
        for (const seed of SEEDS) await passes(scene, { cols, rows, mode, seed, clock: 'grid' }, `${scene} ${mode} ${cols}x${rows} seed ${seed}`);
      }
    });
    test(`DRIFT-11 ${scene} 1x grid, inverted, ${mode}, 80x24 and 120x40, seeds 1 to 8: the five rules pass`, async () => {
      for (const [cols, rows] of [[80, 24], [120, 40]]) {
        for (const seed of SEEDS) await passes(scene, { cols, rows, mode, seed, clock: 'grid', invert: true }, `${scene} inverted ${mode} ${cols}x${rows} seed ${seed}`);
      }
    });
  }
}

// the shipped scene length: the scheduler holds the scene for 180 s of scene time (DEFAULTS in src/app.js), 3240 frames at 18 fps
for (const scene of SCENES) {
  test(`DRIFT-11 ${scene} at the shipped scene length (180 s), 256 colours, 80x24, seed 1: the five rules pass over the whole scene`, async () => {
    const r = await go(scene, { cols: 80, rows: 24, mode: '256', seed: 1, clock: 'grid', sceneSeconds: 180, seconds: 190 });
    assert.ok(r.frames >= 180 * 18 - 2 && r.frames <= 180 * 18, `the whole 180 s scene was metered (${r.frames} frames, ended at ${r.endedAt} s)`);
    assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `${scene} 180 s: ${line(r.rep)}`);
  });
}

for (const scene of SCENES) {
  for (const clock of ['q156', 'jitter']) {
    test(`DRIFT-11 ${scene} clock arm, ${clock}, 1x: 41x11 seed 2, 79x25 seed 3, 10x4 seed 5, 20x6 seed 6`, async () => {
      for (const [cols, rows, seed] of [[41, 11, 2], [79, 25, 3], [10, 4, 5], [20, 6, 6]]) {
        const mode = seed % 2 === 0 ? '256' : 'truecolor';
        const o = { cols, rows, mode, seed, clock, clockSeed: seed };
        const r = await clockArm(() => go(scene, o));
        whole(r, `${scene} ${clock} ${cols}x${rows} seed ${seed}`, o);
        judgeX1(r.rep, `${scene} ${clock} 1x ${mode} ${cols}x${rows} seed ${seed}`);
      }
    });
  }
}

test('DRIFT-11 wire and blocktype sizes clock arms cost: read at most 15 % of the frames the grid arms of this file read (by count)', () => { assertArmCost('wire-blocktype-flash-sizes'); });
