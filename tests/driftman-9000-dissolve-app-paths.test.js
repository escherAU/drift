// DRIFT-8 r4: the ways a viewer can reach a dissolve that the plain 1x and 4x runs do not take, judged by the flash meter on the REAL app (the rig of tests/helpers-flash-app.js: a fake
// terminal, a fake clock, the bytes read back by an independent terminal reader). Every case asserts every X1_RULE_IDS rule (L1, L2, L3, R, C at the 18 fps the viewer sees) passes at 80x24.
//
// The meter's 4x view of a dissolve (the same frames shown four times as fast) is not a way a dissolve can be seen: the dissolve lasts 2 s of real time at any speed (tests/compose-fade-scale.test.js,
// tests/driftman-9000-dissolve-app.test.js). These are the paths that could have come close, run for what they are:
//   (a) a dissolve, then 4x: the speed pressed up INSIDE a dissolve that started at 1x (Bloomfall to Rosette, at 183.33 s of the running program, 183.83 s here), so the dissolve is already under way
//       when the hold clock jumps to 4x. The gaps pin that 4x was reached (62 s for the 1x hold and fade, then 17 s = 60 / 4 + 2).
//   (b) space at 4x: the skip key pressed while the program runs at 4x and Bloomfall is on screen; the dissolve that follows lasts its 2 s (36 frames from the press to the switch).
//   (c) the menu jump at 4x: Enter, the arrow keys from the first entry (the menu does not open on the playing entry: ROSETTE, CORTEX, BLOOMFALL), Enter. The program-switch dissolve is the one the menu
//       reaches the other three ordered pairs by (bloomfall>cortex, rosette>bloomfall, cortex>rosette). The meter runs from 6 s before the pick to 4 s after it.
// Seeds 8, 12, 16 (the ones the 4x proxy read highest at) and 80x24 only: the other sizes cost more per run in proportion to their cells and add no path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAppDissolves, runAppWindow, PLAN_4X, APP_FPS } from './helpers-flash-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { FLASH_MODE, MODE_NOTE } from './helpers-flash-modes.js';

const pc = (x) => (100 * x).toFixed(1);
const show = (rep) => `L1 ${pc(rep.l1.x1.worstFraction)} L2 ${pc(rep.l2.x1.worstFraction)} L3 ${pc(rep.l3.worstFraction)} R ${pc(rep.r.x1.worstFraction)} C ${pc(rep.c.worstFraction)}`;
const SEEDS = [8, 12, 16];
const fr = (s) => Math.round(s * APP_FPS);
const judgeRep = (tag, rep) => { const f = failedRules(rep, { only: X1_RULE_IDS }); return { line: `${tag} ${show(rep)}`, bad: f.length ? [`${tag}: ${f.join(',')} ${show(rep)}`] : [] }; };

test(`9000 dissolve then 4x: + four times inside Bloomfall>Rosette at 1x (running + 183.83 s), seeds ${SEEDS.join(', ')}, every dissolve of the run passes every rule${MODE_NOTE}`, async () => {
  const lines = [], bad = [];
  const PRESS = 183.83;
  for (const seed of SEEDS) {
    const plan = [0, 0.2, 0.4, 0.6].map((o) => ({ atRunning: PRESS + o, key: '+' }));
    const res = await runAppDissolves({ mode: FLASH_MODE, seed, seconds: 220, plan, speed: 1 });
    const tag = `${FLASH_MODE} 80x24 seed ${seed}`;
    const pressFrame = res.runningAt + fr(PRESS);
    const i = res.dissolves.findIndex((d) => d.from === 'bloomfall' && d.to === 'rosette');
    assert.ok(i > 0, `${tag}: no bloomfall>rosette dissolve (${res.dissolves.map((d) => `${d.from}>${d.to}`).join(', ')})`);
    const d = res.dissolves[i], next = res.dissolves[i + 1];
    // the presses landed inside the dissolve
    const into = d.switchFrame - pressFrame;
    assert.ok(into > 0 && into < 2 * APP_FPS, `${tag}: the presses are ${into} frames before the switch, want inside the 36-frame dissolve`);
    assert.equal(res.dissolves[i - 1].to, 'bloomfall', `${tag}: the dissolve before it`);
    assert.ok(Math.abs(d.sinceLast - 62) <= 0.1, `${tag}: bloomfall>rosette came ${d.sinceLast} s after cortex>bloomfall, want 62 (1x hold and fade)`);
    assert.ok(next && next.from === 'rosette' && next.to === 'cortex', `${tag}: the dissolve after it: ${next && `${next.from}>${next.to}`}`);
    assert.ok(Math.abs(next.sinceLast - 17) <= 0.1, `${tag}: rosette>cortex came ${next.sinceLast} s later, want 17 = 60 / 4 + 2 (4x was reached)`);
    for (const x of res.dissolves) { const j = judgeRep(`${tag} ${x.from}>${x.to} @${x.switchFrame - res.runningAt} frames (presses ${into} frames before the first)`, x.report); lines.push(j.line); bad.push(...j.bad); }
  }
  console.log(`APP DISSOLVE then 4x${MODE_NOTE}\n  ${lines.join('\n  ')}`);
  assert.deepEqual(bad, []);
});

test(`9000 space at 4x: the skip key in Bloomfall at running + 36, 40, 44 and 48 s, seeds ${SEEDS.join(', ')}: the switch to Rosette comes 36 +/- 1 frames later and every dissolve passes every rule${MODE_NOTE}`, async () => {
  const lines = [], bad = [];
  for (const seed of SEEDS) for (const at of [36, 40, 44, 48]) {
    const res = await runAppDissolves({ mode: FLASH_MODE, seed, seconds: 70, plan: [...PLAN_4X, { atRunning: at, key: ' ' }], speed: 4 });
    const tag = `${FLASH_MODE} 80x24 seed ${seed} space at ${at} s`;
    const pressFrame = res.runningAt + fr(at);
    const d = res.dissolves.find((x) => x.from === 'bloomfall' && x.to === 'rosette' && x.switchFrame > pressFrame);
    assert.ok(d, `${tag}: no bloomfall>rosette after the press (${res.dissolves.map((x) => `${x.from}>${x.to}`).join(', ')})`);
    const gap = d.switchFrame - pressFrame;
    assert.ok(Math.abs(gap - 36) <= 1, `${tag}: the switch came ${gap} frames after the press, want 36 (2 s of real time)`);
    for (const x of res.dissolves) { const j = judgeRep(`${tag} ${x.from}>${x.to}`, x.report); lines.push(j.line); bad.push(...j.bad); }
  }
  console.log(`APP SPACE at 4x${MODE_NOTE}\n  ${lines.join('\n  ')}`);
  assert.deepEqual(bad, []);
});

const DOWN = '\x1b[B';
const ENTRY = { rosette: 0, cortex: 1, bloomfall: 2 };
// where each jump is made, seconds into the running program at 4x (rosette 0-15.8 with the opening menu, cortex 17.8-32.8, bloomfall 34.8-49.8, rosette 51.8-66.8)
const JUMPS = [{ from: 'bloomfall', to: 'cortex', at: 41 }, { from: 'rosette', to: 'bloomfall', at: 56 }, { from: 'cortex', to: 'rosette', at: 24 }];

test(`9000 menu jump at 4x: bloomfall>cortex, rosette>bloomfall and cortex>rosette through the menu (Enter, arrows from the first entry, Enter), seeds ${SEEDS.join(', ')}, 6 s before the pick to 4 s after, every rule${MODE_NOTE}`, async () => {
  const lines = [], bad = [];
  for (const seed of SEEDS) for (const { from, to, at } of JUMPS) {
    const pick = at + 0.8;
    const keys = [...PLAN_4X, { atRunning: at, key: '\r' }];
    for (let s = 0; s < ENTRY[to]; s++) keys.push({ atRunning: at + 0.4 + 0.1 * s, key: DOWN });
    keys.push({ atRunning: pick, key: '\r' });
    const res = await runAppWindow({ mode: FLASH_MODE, seed, keys, pickAt: pick, before: 6, after: 4 });
    const tag = `${FLASH_MODE} 80x24 seed ${seed} ${from}>${to}`;
    assert.equal(res.ids[fr(at)], from, `${tag}: the scene playing when the menu was opened`);
    assert.equal(res.ids[fr(pick) + 4 * APP_FPS], to, `${tag}: the scene playing 4 s after the pick`);
    assert.equal(res.frames, 10 * APP_FPS + 1, `${tag}: the window is 6 s before the pick to 4 s after`);
    const j = judgeRep(tag, res.report); lines.push(j.line); bad.push(...j.bad);
  }
  console.log(`APP MENU JUMP at 4x${MODE_NOTE}\n  ${lines.join('\n  ')}`);
  assert.deepEqual(bad, []);
});
