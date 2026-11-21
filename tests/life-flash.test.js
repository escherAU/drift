// DRIFT-10: Classic high contrast (the Life scene) held to the five flash rules (L1, L2, L3, R, C: X1_RULE_IDS, the viewer's own second) in the REAL app at 1x.
// createApp itself, started in contrast mode on its first scene (life), scene length 30 s, `--fps` 18 (the default), the loop on a clock (tests/helpers-clock.js), the
// bytes read back through the independent terminal reader (tests/helpers-ansi.js), the screens through the flash meter (tests/helpers-life-app.js runLife).
// The run holds Life for its whole 30 s scene (a run ends when the scheduler starts to dissolve into the next scene: the dissolve is another scene's business) and is
// asserted to have read all of it (540 frames on the exact clock; a clock whose timer fires late may start the dissolve a frame early: at least 538).
// What this file covers:
//   grid arm      the exact clock, speed 1x, seeds 1 to 8, colour modes truecolor and 256 colours (the app's own 256-colour output: the renderer emits the indices and the reader
//                 reads them back, which is what the flash-256-* files' reducer emulates for the shell), sizes 80x24, 120x40 and the sizes at and just above each layout breakpoint
//                 of the shell (src/shell/ui.js lines 137-139: 'list' from 40x10, 'compact' from 78x24, 'full' from 88x39): 40x10, 41x11, 78x24, 79x25, 88x39, 89x40.
//                 Life itself reads none of those breakpoints (it draws its whole grid); the number of patterns it seeds steps with the area (patternCount in src/scenes/life.js:
//                 area / 2200, rounded), which these sizes cross as well. 20x6 and 10x4 are far below the smallest layout: there a reseed alone would change more than 30 % of the screen in
//                 one frame (L3) without the share limits in src/scenes/life.js (per step and per painted frame), which tests/life-flash-controls.test.js takes out. The low frame rates are tests/life-flash-fps.test.js.
//   inverted arm 80x24 and 120x40, seeds 1 to 8, both colour modes, with the config's invert on (what the `i` key leaves).
//   rate arm      `--fps` 8, 12, 24 and 30 on the exact clock (256 colours, 80x24, seeds 2, 4, 8), the meter reading at that rate.
//   clock arms    q156 and jitter (the clock seed is the app seed), 1x, 256 colours at 80x24 on seeds 1, 2, 3, 4, 8 (the seeds the old Life failed worst on) and truecolor at 120x40 on seed 2,
//                 held by helpers-clock-arms to 15 % of the frames this file's grid arms meter (the last test).
// Speeds above 1x are tests/life-flash-speed.test.js; the old Life failing all of this, and the mutants of the fix, are tests/life-flash-controls.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLife, LIFE_SECONDS_FRAMES, wholeScene } from './helpers-life-app.js';
import { failedRules, ruleOf, X1_RULE_IDS } from './helpers-flash.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const SIZES = [[80, 24], [120, 40], [40, 10], [41, 11], [78, 24], [79, 25], [88, 39], [89, 40], [20, 6], [10, 4]];
const MODES = ['truecolor', '256'];

const line = (rep) => X1_RULE_IDS.map((id) => `${id} ${(ruleOf(rep, id).worstFraction * 100).toFixed(2)}`).join(' ');

for (const [cols, rows] of SIZES) {
  for (const mode of MODES) {
    test(`DRIFT-10 life 1x grid, ${mode}, ${cols}x${rows}, seeds 1 to 8: the five rules pass over the whole 30 s scene`, async () => {
      for (const seed of SEEDS) {
        const r = await runLife({ cols, rows, mode, seed, clock: 'grid', seconds: 32 });
        wholeScene(r, `seed ${seed}`);
        assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `${mode} ${cols}x${rows} seed ${seed}: ${line(r.rep)}`);
      }
    });
  }
}

// inverted (black on white, as the `i` key and the saved config leave it): the same transitions in the other polarity
for (const mode of MODES) {
  test(`DRIFT-10 life 1x grid, inverted, ${mode}, 80x24 and 120x40, seeds 1 to 8: the five rules pass over the whole 30 s scene`, async () => {
    for (const [cols, rows] of [[80, 24], [120, 40]]) {
      for (const seed of SEEDS) {
        const r = await runLife({ cols, rows, mode, seed, clock: 'grid', seconds: 32, invert: true });
        wholeScene(r, `inverted ${cols}x${rows} seed ${seed}`);
        assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `inverted ${mode} ${cols}x${rows} seed ${seed}: ${line(r.rep)}`);
      }
    }
  });
}

// the rate: `--fps` 8 to 30 (the app is told it and ticked at it, the meter reads every screen the viewer would see at that rate); the flip gap is in real time, so it holds at every rate
test('DRIFT-10 life 1x grid, 256 colours, 80x24, --fps 8, 12, 24 and 30, seeds 2, 4, 8: the five rules pass over the whole 30 s scene', async () => {
  for (const fps of [8, 12, 24, 30]) {
    for (const seed of [2, 4, 8]) {
      const r = await runLife({ cols: 80, rows: 24, mode: '256', seed, clock: 'grid', fps, seconds: 32 });
      assert.ok(r.frames >= 30 * fps - 2 && r.frames <= 30 * fps, `--fps ${fps} seed ${seed}: the whole scene was metered (${r.frames} frames)`);
      assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `--fps ${fps} seed ${seed}: ${line(r.rep)}`);
    }
  }
});

// the clock arms: each one judged by the five rules at their own limits; the cost is held by count
for (const clock of ['q156', 'jitter']) {
  test(`DRIFT-10 life 1x clock arm, ${clock}, 256 colours, 80x24, seeds 1, 2, 3, 4, 8`, async () => {
    for (const seed of [1, 2, 3, 4, 8]) {
      const r = await clockArm(() => runLife({ cols: 80, rows: 24, mode: '256', seed, clock, clockSeed: seed, seconds: 32 }));
      wholeScene(r, `${clock} seed ${seed}`);
      judgeX1(r.rep, `life ${clock} 256 80x24 seed ${seed}`);
    }
  });
  test(`DRIFT-10 life 1x clock arm, ${clock}, truecolor, 120x40, seed 2`, async () => {
    const r = await clockArm(() => runLife({ cols: 120, rows: 40, mode: 'truecolor', seed: 2, clock, clockSeed: 2, seconds: 32 }));
    wholeScene(r, `${clock} 120x40`);
    judgeX1(r.rep, `life ${clock} truecolor 120x40 seed 2`);
  });
}

test('DRIFT-10 life clock arms cost: read at most 15 % of the frames the grid arms of this file read (by count)', () => { assertArmCost('life flash 1x'); });
