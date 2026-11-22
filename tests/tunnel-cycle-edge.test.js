// DRIFT-12 correction round 1, DRIFT-13 phase 2: the two places where the whole Classic high contrast cycle PASSED AT THE LIMIT before the flash governor, asserted so a change is noticed. Both are the same
// board and clock: 40x10 (a field of 56 cells, so the L2 limit of 25 % is 14 cells and one cell is 1.79 %), the exact grid clock, 256 colours, the real app (createApp itself, real `+` presses,
// every frame metered):
//   (a) seed 7 at --fps 30, 1x: in the dissolve from the wire into the maze (about 95 s of the 30 s scene length cycle); it reads the same 25.00 % on the tree before DRIFT-12
//   (b) seed 8 at --fps 24, 4x: at the end of the dissolve from Life into the tunnel (about 32.8 s)
// The runs stop a few seconds after the dissolve they are about (the frames are the same ones the whole 170 s cycle plays: nothing in the run depends on what comes after).
// On the tree before the governor (BEFORE13_EDITS: src/ with the governor's one line taken out of app.js) L2 reads EXACTLY 25.00 % (14 of 56 cells) and the rule fails only ABOVE 25 %: it passed at the
// limit with NO MARGIN, and that is asserted still, as the control. With the governor wired in (DRIFT-13) the same runs read 10.71 % (6 cells) and 8.93 % (5 cells), under the limit with room, and
// the other four rules are held to their own limits as everywhere. A board of 56 cells (40x10 to 42x12) is where Classic high contrast has no room: see the README, "Classic high contrast: the flash
// governor (DRIFT-13)".
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLife, PLAN, SPEED_OF, makeTree, rmTree, BEFORE13_EDITS } from './helpers-life-app.js';
import { failedRules, ruleOf, X1_RULE_IDS } from './helpers-flash.js';
import { line } from './helpers-wb-flash.js';

const FIELD = 56;
let BEFORE = null;
test.before(() => { BEFORE = makeTree('new', BEFORE13_EDITS); });
test.after(() => { if (BEFORE) rmTree(BEFORE); });

async function edge({ seed, fps, speed, seconds, between, root = null }) {
  const r = await runLife({ cols: 40, rows: 10, mode: '256', seed, clock: 'grid', fps, seconds, sceneSeconds: 30 * SPEED_OF[speed], keys: PLAN[speed], feedAll: true, stopAtDissolve: false, scene: 'life', startScene: 0, root });
  assert.equal(r.frames, Math.round(seconds * fps), `every frame of the run was metered (${r.frames})`);
  assert.equal(r.speedMax, SPEED_OF[speed], `the key presses reached ${SPEED_OF[speed]}x`);
  const [from, to] = between;
  const a = r.ids.indexOf(from);
  assert.ok(a >= 0 && r.ids.indexOf('fading', a) > a && r.ids.indexOf(to, r.ids.indexOf('fading', a)) > 0, `the run goes ${from}, a dissolve, ${to}`);
  return r;
}
function atTheLimit(r, label) {
  assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `${label}: the five rules pass (${line(r.rep)})`);
  const l2 = ruleOf(r.rep, 'l2.x1').worstFraction;
  console.log(`EDGE before the governor, ${label}: ${line(r.rep)} (L2 ${(l2 * 100).toFixed(2)} % = ${Math.round(l2 * FIELD)} of ${FIELD} cells)`);
  // it passes at the limit (rule L2 fails only above 25 %) and has no margin: exactly 14 of 56 cells
  assert.equal(Math.round(l2 * FIELD), 14, `${label}: L2 is 14 of ${FIELD} cells`);
  assert.ok(Math.abs(l2 - 0.25) < 1e-9, `${label}: L2 reads exactly 25.00 % (${(l2 * 100).toFixed(4)})`);
}
function belowTheLimit(r, label, cells) {
  assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `${label}: the five rules pass (${line(r.rep)})`);
  const l2 = ruleOf(r.rep, 'l2.x1').worstFraction;
  console.log(`EDGE with the governor, ${label}: ${line(r.rep)} (L2 ${(l2 * 100).toFixed(2)} % = ${Math.round(l2 * FIELD)} of ${FIELD} cells)`);
  assert.equal(Math.round(l2 * FIELD), cells, `${label}: L2 is ${cells} of ${FIELD} cells`);
  assert.ok(l2 < 0.25 - 1e-9, `${label}: L2 is under the limit (${(l2 * 100).toFixed(4)})`);
}

test('DRIFT-12 edge: whole cycle, 40x10, grid clock, 256 colours, seed 7 at --fps 30, 1x: the five rules pass; L2 reads exactly 25.00 % (14 of 56 cells) in the wire to maze dissolve before the governor (no margin) and 10.71 % (6 cells) with it', async () => {
  const o = { seed: 7, fps: 30, speed: '1x', seconds: 100, between: ['wire', 'maze'] };
  atTheLimit(await edge({ ...o, root: BEFORE }), 'seed 7 --fps 30 1x');
  belowTheLimit(await edge(o), 'seed 7 --fps 30 1x', 6);
});

test('DRIFT-12 edge: whole cycle, 40x10, grid clock, 256 colours, seed 8 at --fps 24, 4x (real + presses): the five rules pass; L2 reads exactly 25.00 % (14 of 56 cells) at the end of the Life to tunnel dissolve before the governor (no margin) and 8.93 % (5 cells) with it', async () => {
  const o = { seed: 8, fps: 24, speed: '4x', seconds: 36, between: ['life', 'tunnel'] };
  atTheLimit(await edge({ ...o, root: BEFORE }), 'seed 8 --fps 24 4x');
  belowTheLimit(await edge(o), 'seed 8 --fps 24 4x', 5);
});
