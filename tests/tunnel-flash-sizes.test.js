// DRIFT-12: the tunnel scene of Classic high contrast against the five flash rules (X1_RULE_IDS) in the REAL app at the sizes where a layout or a limit changes, inverted, and at the shipped
// scene length. The same runs as tests/tunnel-flash.test.js (helpers: tests/helpers-wb-flash.js), at the default --fps 18; nothing below 40x10 (Classic shows the size card there).
// What this file covers (seeds 1 to 8, the whole scene):
//   breakpoints   40x10, 41x11, 78x24, 79x25, 88x39, 89x40 (the shell's layout breakpoints, src/shell/ui.js, and the size just above each), 1x, 2x and 4x, truecolor and 256 colours; the
//                 tunnel draws the whole grid at every size, but the rules' field (a third of the screen each way) steps with the size
//   inverted      80x24 and 120x40 with the config's invert on (what the `i` key leaves), 1x, 2x and 4x, both colour modes
//   scene length  the SHIPPED 180 s (DEFAULTS in src/app.js) at 80x24, 256 colours, seed 1: 1x (3240 frames) and 4x (the scene held for 180 real seconds)
//   clock arms    q156 and jitter: every breakpoint size once (speed 1x, 2x, 4x in turn, 256 colours and truecolor alternating) and the inverted 80x24 and 120x40 at 4x, held to 15 % of this
//                 file's grid frames (the last test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEEDS, MODES, BREAKPOINTS, passes, go, whole, line } from './helpers-wb-flash.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';

for (const speed of ['1x', '2x', '4x']) {
  for (const mode of MODES) {
    test(`DRIFT-12 tunnel ${speed} grid, ${mode}, the six layout breakpoint sizes, seeds 1 to 8: the five rules pass`, async () => {
      for (const [cols, rows] of BREAKPOINTS) {
        for (const seed of SEEDS) await passes('tunnel', { speed, cols, rows, mode, seed, clock: 'grid' }, `tunnel ${speed} ${mode} ${cols}x${rows} seed ${seed}`);
      }
    });
    test(`DRIFT-12 tunnel ${speed} grid, inverted, ${mode}, 80x24 and 120x40, seeds 1 to 8: the five rules pass`, async () => {
      for (const [cols, rows] of [[80, 24], [120, 40]]) {
        for (const seed of SEEDS) await passes('tunnel', { speed, cols, rows, mode, seed, clock: 'grid', invert: true }, `tunnel inverted ${speed} ${mode} ${cols}x${rows} seed ${seed}`);
      }
    });
  }
}

// the shipped scene length: the scheduler holds the scene for 180 s of scene time (DEFAULTS in src/app.js); at 4x the real-time clock holds it for 180 real seconds when sceneSeconds is 720
for (const [speed, factor] of [['1x', 1], ['4x', 4]]) {
  test(`DRIFT-12 tunnel at the shipped scene length (180 s), ${speed}, 256 colours, 80x24, seed 1: the five rules pass over the whole scene`, async () => {
    const r = await go('tunnel', { speed, cols: 80, rows: 24, mode: '256', seed: 1, clock: 'grid', sceneSeconds: 180 * factor, seconds: 190 });
    assert.ok(r.frames >= 180 * 18 - 2 * factor && r.frames <= 182 * 18, `the whole 180 s scene was metered (${r.frames} frames, ended at ${r.endedAt} s)`);
    assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `tunnel 180 s ${speed}: ${line(r.rep)}`);
  });
}

for (const clock of ['q156', 'jitter']) {
  test(`DRIFT-12 tunnel clock arm, ${clock}: the six breakpoint sizes (1x, 2x, 4x in turn) and inverted 80x24 and 120x40 at 4x`, async () => {
    const plan = BREAKPOINTS.map(([cols, rows], i) => ({ cols, rows, seed: 1 + i, speed: ['1x', '2x', '4x'][i % 3], mode: i % 2 ? 'truecolor' : '256' }));
    plan.push({ cols: 80, rows: 24, seed: 7, speed: '4x', mode: '256', invert: true }, { cols: 120, rows: 40, seed: 8, speed: '4x', mode: 'truecolor', invert: true });
    for (const p of plan) {
      const o = { ...p, clock, clockSeed: p.seed };
      const r = await clockArm(() => go('tunnel', o));
      whole(r, `tunnel ${clock} ${JSON.stringify(p)}`, o);
      judgeX1(r.rep, `tunnel ${clock} ${p.speed} ${p.mode} ${p.cols}x${p.rows}${p.invert ? ' inverted' : ''} seed ${p.seed}`);
    }
  });
}

test('DRIFT-12 tunnel sizes clock arms cost: read at most 15 % of the frames the grid arms of this file read (by count)', () => { assertArmCost('tunnel-flash-sizes'); });
