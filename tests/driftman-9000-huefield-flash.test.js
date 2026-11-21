// DRIFT-8 C2: the huefield (cartridges/driftman-9000/lib/huefield.js, the living colour ground the 9000's visions share) against the flash meter on its own,
// as a full screen of half-block pixels (every cell an upper half block: top pixel field(x, y + 1/4), bottom pixel field(x, y + 3/4)), on truecolor output and on
// 256-colour output (the renderer's own nearest256 through makeReducer256), at the lightnesses the visions use. The visions have their own flash files; this one
// asks the question of the colour field alone, so a change to the field cannot hide behind a vision's dark ground.
// Control: the same field with its lightness stepped between 0.30 and 0.75 four and a half times a second must fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { field } from '../cartridges/driftman-9000/lib/huefield.js';
import { newFrame } from './helpers-flash-controls.js';
import { shownMeter } from './helpers-flash-modes.js';
import { RULE_IDS, ruleOf, failedRules } from './helpers-flash-halves.js';
import { meterStats } from './helpers-flash.js';
import { createRun } from './helpers-clock.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';

const FPS = 18;
const UPPER = 0x2580;
const pc = (x) => (x * 100).toFixed(1);
const showOne = (rep) => `L1 ${pc(rep.l1.x1.worstFraction)}/${pc(rep.l1.x4.worstFraction)} L2 ${pc(rep.l2.x1.worstFraction)}/${pc(rep.l2.x4.worstFraction)} L3 ${pc(rep.l3.worstFraction)} R ${pc(rep.r.x1.worstFraction)}/${pc(rep.r.x4.worstFraction)} C ${pc(rep.c.worstFraction)}`;
const show = (rep) => `${showOne(rep.cell)} | pixel ${showOne(rep.pixel)}`;
const failed = (rep) => failedRules(rep);

// DRIFT-9 item 4: `clock` = 'q156' | 'jitter' (tests/helpers-clock.js) shows sample k (the viewer's 18 Hz grid) the field of the last paint at or before it, so the time is the paint's, not k's; none is the old exact grid.
function run(cols, rows, mode, { L = 0.66, seed = 1, seconds = 12, lAt = null, clock = null } = {}) {
  const clk = createRun({ clock, fps: FPS });
  const meter = shownMeter(cols, rows, FPS, mode);
  const f = newFrame(cols, rows);
  f.glyphs.fill(UPPER);
  const N = Math.round(seconds * FPS);
  for (let k = 0; k < N; k++) {
    const t = clk.sceneIndex(k) / FPS, l = lAt ? lAt(k) : L;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      f.fg[i] = field(x + 0.5, y + 0.25, t, l, seed);
      f.bg[i] = field(x + 0.5, y + 0.75, t, l, seed);
    }
    meter.push(f);
  }
  return meter.report();
}

const TABLE = [];
for (const mode of ['truecolor', '256']) {
  for (const [cols, rows, seconds] of [[120, 40, 12], [61, 21, 12], [80, 24, 12], [240, 67, 5]]) {
    test(`huefield flash ${cols}x${rows} ${mode}: the field alone at L 0.22, 0.45 and 0.66 passes every rule at the meter's 1x and 4x views, on the cell grid and the pixel grid`, () => {
      for (const L of [0.22, 0.45, 0.66]) {
        const rep = run(cols, rows, mode, { L, seconds });
        TABLE.push(`${cols}x${rows} ${mode.padEnd(9)} L ${L} ${show(rep)}`);
        assert.deepEqual(failed(rep), [], `${cols}x${rows} ${mode} L ${L}: ${show(rep)}`);
        assert.equal(rep.pass, true);
        assert.equal(rep.cell.pass && rep.pixel.pass, true);
      }
    });
  }
  test(`huefield flash control ${mode}: the same field with its lightness stepped between 0.30 and 0.75 four and a half times a second fails L1 and L2`, () => {
    const rep = run(61, 21, mode, { seconds: 8, lAt: (k) => (k % 4 < 2 ? 0.30 : 0.75) });
    TABLE.push(`61x21 ${mode.padEnd(9)} stepped lightness ${show(rep)}`);
    assert.equal(rep.pass, false);
    assert.ok(failed(rep).includes('l1.x1') && failed(rep).includes('l2.x1'), failed(rep).join(','));
  });
}

test('huefield flash TABLE: every measured value', () => {
  console.log(['TABLE huefield flash meter (x1/x4 views; limits L1 25, L2 25, L3 30, R 25; cell grid | pixel grid)', ...TABLE.map((l) => '  ' + l)].join('\n'));
  assert.ok(TABLE.length > 0);
});

// ---- DRIFT-9 item 4: the same field on the q156 and the jitter clock (run's `clock`): the half-block field alone at 80x24 on 256-colour output (the mode its colour snapping reads highest in) at L 0.66 (the lightest of the three the file runs) for 12 s, the five 1x rules at their own limits (the worse of the cell grid and the pixel grid). One arm per clock, a control (the stepped-lightness field fails L1 and L2 on this clock too) and the cost by count.
for (const clock of [{ mode: 'q156', seed: 1 }, { mode: 'jitter', seed: 3 }]) {
  test(`huefield flash on the ${clock.mode} clock, 80x24 256 colours: the field alone at L 0.66 for 12 s passes the five 1x rules on the cell grid and the pixel grid`, async () => {
    for (const L of [0.66]) {
      const rep = await clockArm(async () => run(80, 24, '256', { L, clock }));
      judgeX1(rep, `huefield ${clock.mode} 80x24 256 L ${L} (the worse of the cell grid and the pixel grid)`);
    }
  });
  test(`huefield flash clock control (${clock.mode}): the field with its lightness stepped between 0.30 and 0.75 four and a half times a second fails L1 and L2 on this clock too`, () => {
    const kept = meterStats.frames; // not an arm, and not one of the file's other arms: not counted
    try {
      const rep = run(61, 21, '256', { seconds: 8, lAt: (k) => (k % 4 < 2 ? 0.30 : 0.75), clock });
      assert.ok(failed(rep).includes('l1.x1') && failed(rep).includes('l2.x1'), `${clock.mode}: ${failed(rep).join(',')}`);
    } finally { meterStats.frames = kept; }
  });
}
test('DRIFT-9 clock arms cost: huefield flash clock arms read at most 15 % of the frames the other arms of this file read (by count)', () => { assertArmCost('huefield flash'); });
