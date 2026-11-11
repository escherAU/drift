// DRIFT-5: the size matrix for Night Drive's two sim scenes (redlight, overdrive). Same runner and same rules as night-drive-matrix-cells.test.js
// (no throw; worst frame strictly under 30%; no ramp, wide, off-list, banned, blank-colour or out-of-family cell; lit at or above the floor and blank
// under it), over every size of tests/helpers-night-drive-matrix.js at speeds 4, 3, 2 (90 s), 1 (shortened window) and 0.25 (20 s).
// Floors: redlight is blank under 40 columns or 12 rows (module constants MIN_W=40, MIN_H=12, not exported), overdrive under 30 columns or 9 rows
// (MIN_W=30, MIN_H=9, not exported); both arms of each floor are pinned.
// Redlight at 240x67 runs only 4x and 3x here: it is the costliest run of the matrix by far (899 KB/s of output) and 1x at that size is already
// pinned by R13 in tests/night-drive-redlight.test.js.
// Why: the sims' densities and caps depend on the window size, and the older suites run them only at 120x40, 80x24, 240x67 and their breakpoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODS, PLANTED, matrixRun, matrixScene, sizesFor, pct } from './helpers-night-drive-matrix.js';
import { FLASH_FRACTION } from './helpers-flash.js';

const WINDOWS = { shortSeconds1x: 45, shortSeconds025x: 20 };

for (const id of ['redlight', 'overdrive']) {
  test(`matrix ${id}: every size x speeds 4, 3, 2, 1, 0.25 - no throw, worst frame under 30%, no ramp / wide / glyph / banned / blank-colour / colour violation, lit at or above the floor and blank under it`, () => {
    const skip = id === 'redlight' ? (w, h, speed) => w === 240 && h === 67 && speed < 3 : null;
    const r = matrixScene(id, { windows: WINDOWS, skip });
    console.log(`TABLE matrix ${id}: ${r.runs} runs over ${sizesFor(id).length} sizes, worst share ${pct(r.worst.share)} (${r.worst.tag})`);
    assert.deepEqual(r.bad, [], `${id}: runs that broke a rule`);
    assert.ok(r.worst.share < FLASH_FRACTION);
  });
}

test('matrix floors: redlight is blank at 39 columns AND at 11 rows and lit at 40x12; overdrive is blank at 29 columns AND at 8 rows and lit at 30x9', () => {
  const bad = [];
  for (const [id, c, r] of [['redlight', 40, 12], ['overdrive', 30, 9]]) {
    const sc = MODS[id].default;
    const lo = matrixRun(sc, c - 1, r + 8, 4, 20), lr = matrixRun(sc, c + 60, r - 1, 4, 20), at = matrixRun(sc, c, r, 4, 20);
    if (lo.litMax !== 0 || lo.throws) bad.push(`${id} ${c - 1}x${r + 8}: should be blank, litMax ${lo.litMax} ${lo.throws || ''}`);
    if (lr.litMax !== 0 || lr.throws) bad.push(`${id} ${c + 60}x${r - 1}: should be blank, litMax ${lr.litMax} ${lr.throws || ''}`);
    if (!(at.litMin > 0) || at.throws) bad.push(`${id} ${c}x${r}: should be lit, litMin ${at.litMin} ${at.throws || ''}`);
  }
  assert.deepEqual(bad, []);
});

test('matrix sims controls: the runner catches a 50% flip, a wide glyph, a two-shade ramp jump, a blank cell with a colour and a banned glyph', () => {
  const run = (k) => matrixRun(PLANTED[k], 40, 12, 1, 5);
  const flip = run('flip');
  assert.ok(!(flip.worst < FLASH_FRACTION), `flip reads ${pct(flip.worst)}`);
  assert.ok(run('wide').wide > 0);
  assert.ok(run('ramp').ramp > 0);
  assert.ok(run('blank').blankCol > 0);
  assert.ok(run('banned').banned > 0);
  const clean = run('clean');
  assert.deepEqual([clean.worst, clean.ramp, clean.wide, clean.banned, clean.blankCol], [0, 0, 0, 0, 0]);
});
