// DRIFT-10: Classic high contrast (the Life scene) at 2x and 4x, held to the five flash rules (L1, L2, L3, R, C: X1_RULE_IDS) in the REAL app, as tests/life-flash.test.js does at 1x.
// The speed is reached by real `+` key presses on the app's stdin: SPEEDS in src/app.js is 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, so two presses (1 s in, 0.2 s apart) reach 2x and four
// presses (the PLAN_4X of tests/helpers-flash-app.js) reach 4x. The meter reads the screen the viewer sees on an 18 Hz grid, so a faster scene clock is frames computed further apart.
// Scene length: the scheduler's hold is in SCENE seconds, which run `speed` times faster than real ones. `sceneSeconds: 30` at 4x holds Life for 7.5 real seconds, so the arms below
// pass sceneSeconds = 30 * speed (Life on screen for about 30 real seconds, the whole scene, asserted: at least 538 frames) except the one arm that says so (a scene length of 30 s).
// What this file covers:
//   grid arm      the exact clock, 2x and 4x, seeds 1 to 8, both colour modes, 80x24 and 120x40; 4x at the sizes of the shell's layout breakpoints (40x10, 78x24, 88x39; src/shell/ui.js 137-139)
//                 on seeds 1 to 4; and a scene length of 30 s (the shipped default is 180 s, DEFAULTS in src/app.js) at 4x on seeds 1 to 8.
//   slower        0.5x and 0.25x (`-` pressed): Life moves about half and a quarter as often as at 1x, because the real-time clock runs at min(speed, 1) (src/app.js rt), and the five rules pass.
//   clock arms    q156 and jitter: 4x, 256 colours, 80x24, seeds 2, 4, 8; 2x seed 2; 4x truecolor 120x40 seed 2; held to 15 % of this file's grid frames (the last test).
// The reason it passes at speed is in src/cells.js and src/scenes/life.js: Life asks for the real-time clock (min(speed, 1) of real time), so it steps 10 generations a REAL second at
// any speed, and a cell may change at most once per 0.6 real seconds. The old Life read L2 up to 83 % at 4x here (tests/life-flash-controls.test.js asserts it fails).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLife, movingFrames, PLAN, SPEED_OF, LIFE_SECONDS_FRAMES } from './helpers-life-app.js';
import { failedRules, ruleOf, X1_RULE_IDS } from './helpers-flash.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const line = (rep) => X1_RULE_IDS.map((id) => `${id} ${(ruleOf(rep, id).worstFraction * 100).toFixed(2)}`).join(' ');
const go = (o) => runLife({ seconds: 36, keys: PLAN[o.speed], sceneSeconds: 30 * SPEED_OF[o.speed], ...o });
function whole(r, label, o) {
  assert.ok(r.speedMax === SPEED_OF[o.speed], `${label}: the key presses reached ${SPEED_OF[o.speed]}x (the app's top speed was ${r.speedMax}x)`);
  assert.ok(r.frames >= LIFE_SECONDS_FRAMES - 2, `${label}: Life was on for its whole 30 real seconds (${r.frames} frames, ended at ${r.endedAt} s)`);
}

for (const speed of ['2x', '4x']) {
  for (const [cols, rows] of [[80, 24], [120, 40]]) {
    for (const mode of ['truecolor', '256']) {
      test(`DRIFT-10 life ${speed} grid, ${mode}, ${cols}x${rows}, seeds 1 to 8: the five rules pass`, async () => {
        for (const seed of SEEDS) {
          const o = { speed, cols, rows, mode, seed, clock: 'grid' };
          const r = await go(o);
          whole(r, `${speed} ${mode} ${cols}x${rows} seed ${seed}`, o);
          assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `${speed} ${mode} ${cols}x${rows} seed ${seed}: ${line(r.rep)}`);
        }
      });
    }
  }
}

for (const [cols, rows] of [[40, 10], [78, 24], [88, 39]]) {
  for (const mode of ['truecolor', '256']) {
    test(`DRIFT-10 life 4x grid, ${mode}, ${cols}x${rows} (a layout breakpoint size), seeds 1 to 4: the five rules pass`, async () => {
      for (const seed of [1, 2, 3, 4]) {
        const o = { speed: '4x', cols, rows, mode, seed, clock: 'grid' };
        const r = await go(o);
        whole(r, `4x ${mode} ${cols}x${rows} seed ${seed}`, o);
        assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `4x ${mode} ${cols}x${rows} seed ${seed}: ${line(r.rep)}`);
      }
    });
  }
}

test('DRIFT-10 life 4x with a scene length of 30 s (30 s of scene time, so 7.5 real seconds of Life; the shipped default is 180 s), 256 colours, 80x24, seeds 1 to 8', async () => {
  for (const seed of SEEDS) {
    const r = await runLife({ cols: 80, rows: 24, mode: '256', seed, clock: 'grid', keys: PLAN['4x'], sceneSeconds: 30, seconds: 36 });
    assert.equal(r.speedMax, 4);
    assert.ok(r.frames >= 100 && r.frames <= 160, `seed ${seed}: Life was on for about 7.5 s (${r.frames} frames)`);
    assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `seed ${seed}: ${line(r.rep)}`);
  }
});

for (const clock of ['q156', 'jitter']) {
  test(`DRIFT-10 life 4x clock arm, ${clock}, 256 colours, 80x24, seeds 2, 4, 8`, async () => {
    for (const seed of [2, 4, 8]) {
      const o = { speed: '4x', cols: 80, rows: 24, mode: '256', seed, clock, clockSeed: seed };
      const r = await clockArm(() => go(o));
      whole(r, `${clock} seed ${seed}`, o);
      judgeX1(r.rep, `life 4x ${clock} 256 80x24 seed ${seed}`);
    }
  });
  test(`DRIFT-10 life 2x clock arm, ${clock}, 256 colours, 80x24, seed 2`, async () => {
    const o = { speed: '2x', cols: 80, rows: 24, mode: '256', seed: 2, clock, clockSeed: 2 };
    const r = await clockArm(() => go(o));
    whole(r, `${clock} 2x`, o);
    judgeX1(r.rep, `life 2x ${clock} 256 80x24 seed 2`);
  });
  test(`DRIFT-10 life 4x clock arm, ${clock}, truecolor, 120x40, seed 2`, async () => {
    const o = { speed: '4x', cols: 120, rows: 40, mode: 'truecolor', seed: 2, clock, clockSeed: 2 };
    const r = await clockArm(() => go(o));
    whole(r, `${clock} 120x40`, o);
    judgeX1(r.rep, `life 4x ${clock} truecolor 120x40 seed 2`);
  });
}

// slower speeds slow Life: the min(speed, 1) of the real-time clock (src/app.js rt). Without the min (Life at full pace whatever the speed) the moving-frame counts below are the 1x one.
for (const seed of [1, 2, 3]) {
  test(`DRIFT-10 life slower speeds slow it: 0.5x moves at most 0.6 and 0.25x at most 0.35 of the frames 1x does, and the five rules pass, seed ${seed}`, async () => {
    const one = await movingFrames('1x', { seed });
    const half = await movingFrames('0.5x', { seed });
    const quarter = await movingFrames('0.25x', { seed });
    for (const [label, m, sp] of [['1x', one, 1], ['0.5x', half, 0.5], ['0.25x', quarter, 0.25]]) {
      assert.equal(m.r.state.speed, sp, `${label}: the key presses reached the speed`);
      assert.ok(m.r.frames >= 500, `${label}: Life was on for about its 30 real seconds (${m.r.frames} frames)`);
      assert.deepEqual(failedRules(m.r.rep, { only: X1_RULE_IDS }), [], `${label} seed ${seed}: ${line(m.r.rep)}`);
    }
    assert.ok(one.moving > 100, `1x moves (${one.moving} frames)`);
    assert.ok(half.moving <= 0.6 * one.moving, `0.5x moved in ${half.moving} frames, 1x in ${one.moving}`);
    assert.ok(quarter.moving <= 0.35 * one.moving, `0.25x moved in ${quarter.moving} frames, 1x in ${one.moving}`);
    console.log(`SLOWER seed ${seed}: frames that move 1x ${one.moving}, 0.5x ${half.moving}, 0.25x ${quarter.moving}`);
  });
}

test('DRIFT-10 life speed clock arms cost: read at most 15 % of the frames the grid arms of this file read (by count)', () => { assertArmCost('life flash speed'); });
