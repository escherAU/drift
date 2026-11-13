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
import { RULE_IDS, ruleOf } from './helpers-flash-halves.js';

const FPS = 18;
const UPPER = 0x2580;
const pc = (x) => (x * 100).toFixed(1);
const showOne = (rep) => `L1 ${pc(rep.l1.x1.worstFraction)}/${pc(rep.l1.x4.worstFraction)} L2 ${pc(rep.l2.x1.worstFraction)}/${pc(rep.l2.x4.worstFraction)} L3 ${pc(rep.l3.worstFraction)} R ${pc(rep.r.x1.worstFraction)}/${pc(rep.r.x4.worstFraction)}`;
const show = (rep) => `${showOne(rep.cell)} | pixel ${showOne(rep.pixel)}`;
const failed = (rep) => RULE_IDS.filter((r) => !ruleOf(rep, r).pass);

function run(cols, rows, mode, { L = 0.66, seed = 1, seconds = 12, lAt = null } = {}) {
  const meter = shownMeter(cols, rows, FPS, mode);
  const f = newFrame(cols, rows);
  f.glyphs.fill(UPPER);
  const N = Math.round(seconds * FPS);
  for (let k = 0; k < N; k++) {
    const t = k / FPS, l = lAt ? lAt(k) : L;
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
