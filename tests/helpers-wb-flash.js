// DRIFT-11: what the flash files of the two Classic high contrast scenes that were turned into followers (wire and blocktype, src/scenes/follow.js) share. The runs are
// tests/helpers-life-app.js runLife on the REAL app: createApp itself in contrast mode, started on the scene under test, a scene length of 30 s of scene time (the shipped default
// is 180 s, DEFAULTS in src/app.js), the loop on a clock, the bytes read back through the independent terminal reader, the screens through the flash meter at the viewer's own 18 Hz
// grid, judged by the five rules (L1, L2, L3, R, C: X1_RULE_IDS) at their own limits.
//
// What a 30 s run covers (the scenes are stepped from the real-time clock, which runs at min(speed, 1) of real time, so a run holds the scene for 30 REAL seconds at any speed:
// sceneSeconds = 30 * speed, as in tests/life-flash-speed.test.js):
//   wire        the cube from 0 to 13 s, the shrink and the grow at 13 s, the torus from 13 to 26 s, the shrink and the grow again at 26 s and the cube to 30 s
//               (PHASE_SECONDS 13, src/scenes/wire.js; coverage() below asserts it from the scene's own constants)
//   blocktype   five words and five transitions in a row: wipe (4.2 to 6 s), scroll (10.2 to 12 s), wave (16.2 to 18 s), wipe (22.2 to 24 s), scroll (28.2 to 30 s), each after a hold of
//               4.2 s (SLOT_SECONDS 6, TRANSITION_SECONDS 1.8); every kind, three slots in a row at least, and five words of the seed's order
import assert from 'node:assert/strict';
import { runLife, PLAN, SPEED_OF, isCardBoard, cardRun } from './helpers-life-app.js';
import { failedRules, ruleOf, X1_RULE_IDS } from './helpers-flash.js';
import { PHASE_SECONDS } from '../src/scenes/wire.js';
import { SLOT_SECONDS, TRANSITION_SECONDS } from '../src/scenes/blocktype.js';

export const SCENES = ['wire', 'blocktype'];
export const SCENE_INDEX = { tunnel: 1, wire: 2, blocktype: 4 }; // the contrast playlist in src/scenes/index.js: life, tunnel, wire, maze, blocktype
export const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
export const MODES = ['truecolor', '256'];
// the small boards (40 to 125 cells). DRIFT-12: all of them are below Classic's 40x10 minimum, where Classic shows the size card and neither scene runs: a run at one of these sizes is a run of
// the CARD (go() says so to runLife, and whole() then asserts the card run instead of a whole 30 s scene), so every test that loops over SMALL still passes the five rules, on the card.
export const SMALL = [[10, 4], [13, 4], [15, 5], [20, 6], [25, 5]];
export const BREAKPOINTS = [[40, 10], [41, 11], [78, 24], [79, 25], [88, 39], [89, 40]]; // the shell's layout breakpoints (src/shell/ui.js 137-139) and one cell above each

export const line = (rep) => X1_RULE_IDS.map((id) => `${id} ${(ruleOf(rep, id).worstFraction * 100).toFixed(2)}`).join(' ');

// One run: the scene for its whole 30 real seconds at `speed` ('1x', '2x', '4x': real `+` presses). o: { cols, rows, mode, seed, clock, clockSeed, fps, invert, root, ... } as runLife.
export function go(scene, o = {}) {
  const speed = o.speed || '1x';
  return runLife({ seconds: 36, keys: PLAN[speed], sceneSeconds: 30 * SPEED_OF[speed], ...o, scene, startScene: SCENE_INDEX[scene], card: isCardBoard(o.cols ?? 80, o.rows ?? 24) });
}

// the run held the scene for its whole 30 real seconds (a clock whose timer fires late may start the dissolve a frame early; the `+` presses come in the second second, at 1x, so a run at 2x or 4x
// holds the scene up to a second longer, which is why the upper bound is 32 s) at the speed the key presses reached
export function whole(r, label, o = {}) {
  if (r.card) { cardRun(r, o.cols ?? 80, o.rows ?? 24, label); return; } // below 40x10: the size card, static, never the scene (DRIFT-12)
  const speed = o.speed || '1x', fps = o.fps || 18;
  assert.equal(r.speedMax, SPEED_OF[speed], `${label}: the key presses reached ${SPEED_OF[speed]}x (the app's top speed was ${r.speedMax}x)`);
  assert.ok(r.frames >= 30 * fps - 2 && r.frames <= 32 * fps, `${label}: the whole 30 s scene was metered (${r.frames} frames at ${fps} fps, ended at ${r.endedAt} s)`);
}

// one run, asserted whole and passing the five rules; the failure message carries every rule's number
export async function passes(scene, o, label) {
  const r = await go(scene, o);
  whole(r, label, o);
  assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `${label}: ${line(r.rep)}`);
  return r;
}

// what a 30 s run covers, from the scenes' own constants
export function coverage() {
  return {
    wirePhases: Math.floor(30 / PHASE_SECONDS) + 1, // phases entered in 30 s: cube, torus, cube
    wireSwitches: Math.floor(30 / PHASE_SECONDS), // shrink-and-grow switches inside the 30 s
    blockSlots: Math.floor(30 / SLOT_SECONDS), // whole slots (words) in 30 s
    blockTransitions: Math.floor(30 / SLOT_SECONDS), // one transition at the end of each
    holdSeconds: SLOT_SECONDS - TRANSITION_SECONDS,
  };
}
