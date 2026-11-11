// DRIFT-5: the size matrix for Night Drive's six cells scenes (onramp, skyline, sundown, coast, diner, caller).
//
// What it pins: each scene, ALONE through the real cell composer, at every size of its matrix (tests/helpers-night-drive-matrix.js: one column or row
// either side of every layout breakpoint, the scene's blank floor and its neighbours, the console's tiers, tiny windows, big windows) at speeds 4, 3, 2
// (the whole tape length: 90 s, the caller 75 s), 1x (shortened window) and 0.25x (20 s):
//   no throw; the worst frame changes strictly under 30% of the cells; no ramp violation (a cell that keeps its glyph moves one shade of one family,
//   28 L* at most); no wide or invisible glyph; no glyph outside the allow-list; no banned glyph; no blank cell with a colour; no lit cell outside the
//   fixed colour families (16..51).
// Floors: a scene is blank BY DESIGN under its floor (skyline, coast, diner, caller: under 40x18) and lit at or above it; onramp and sundown draw at
// every size down to 20x6. Both arms of the floor are pinned (floor-1 columns AND floor-1 rows blank, the floor itself lit).
// Why: the older suites only run 120x40, 80x24 and the breakpoints themselves, so a defect that appears at one column off a breakpoint (a layout
// edge, a size-dependent density) went unseen. The controls at the bottom plant one defect each to show the runner bites.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODS, FLOORS, PLANTED, matrixRun, matrixScene, breakpointsOf, sizesFor, pct,
} from './helpers-night-drive-matrix.js';
import { FLASH_FRACTION } from './helpers-flash.js';

const CELLS = ['onramp', 'skyline', 'sundown', 'coast', 'diner', 'caller'];
// The 1x and 0.25x windows: nothing needed shortening (this file runs in about 17 s), so 1x runs 45 s and 0.25x 20 s as ordered.
const WINDOWS = { shortSeconds1x: 45, shortSeconds025x: 20 };

test('matrix: the derived breakpoints are where the tests think they are (100x32 full for all eight; overdrive mid 60x18; sundown compact rows-only from 24)', () => {
  for (const id of Object.keys(MODS)) breakpointsOf(id); // asserts inside
  assert.deepEqual(breakpointsOf('sundown'), { corners: [[100, 32]], rowsOnly: [24] });
  assert.deepEqual(breakpointsOf('overdrive').corners, [[100, 32], [60, 18]]);
  assert.deepEqual(FLOORS.skyline, [40, 18]);
  assert.deepEqual([FLOORS.coast, FLOORS.diner, FLOORS.caller], [[40, 18], [40, 18], [40, 18]]);
  // the lists contain what they promise
  const has = (id, w, h) => sizesFor(id).some(([a, b]) => a === w && b === h);
  for (const id of CELLS) for (const [w, h] of [[99, 31], [100, 32], [101, 33], [99, 33], [101, 31], [240, 67], [89, 40], [78, 24], [40, 10], [20, 6]]) assert.ok(has(id, w, h), `${id} runs ${w}x${h}`);
  for (const h of [23, 24, 25]) for (const w of [80, 41]) assert.ok(has('sundown', w, h), `sundown runs ${w}x${h}`);
  for (const id of ['skyline', 'coast', 'diner', 'caller']) for (const [w, h] of [[40, 18], [39, 18], [40, 17], [41, 19]]) assert.ok(has(id, w, h), `${id} floor size ${w}x${h}`);
});

for (const id of CELLS) {
  test(`matrix ${id}: every size x speeds 4, 3, 2, 1, 0.25 - no throw, worst frame under 30%, no ramp / wide / glyph / banned / blank-colour / colour violation, lit at or above the floor and blank under it`, () => {
    const r = matrixScene(id, { windows: WINDOWS });
    console.log(`TABLE matrix ${id}: ${r.runs} runs over ${sizesFor(id).length} sizes, worst share ${pct(r.worst.share)} (${r.worst.tag})`);
    assert.deepEqual(r.bad, [], `${id}: runs that broke a rule`);
    assert.ok(r.worst.share < FLASH_FRACTION);
  });
}

test('matrix floors: skyline, coast, diner, caller are blank at floor-1 columns AND at floor-1 rows and lit at the floor; onramp and sundown are lit at 20x6', () => {
  const bad = [];
  for (const id of ['skyline', 'coast', 'diner', 'caller']) {
    const [c, r] = FLOORS[id];
    const sc = MODS[id].default;
    const lo = matrixRun(sc, c - 1, r + 6, 4, 20), lr = matrixRun(sc, c + 60, r - 1, 4, 20), at = matrixRun(sc, c, r, 4, 20);
    if (lo.litMax !== 0 || lo.throws) bad.push(`${id} ${c - 1}x${r + 6}: should be blank, litMax ${lo.litMax} ${lo.throws || ''}`);
    if (lr.litMax !== 0 || lr.throws) bad.push(`${id} ${c + 60}x${r - 1}: should be blank, litMax ${lr.litMax} ${lr.throws || ''}`);
    if (!(at.litMin > 0) || at.throws) bad.push(`${id} ${c}x${r}: should be lit, litMin ${at.litMin} ${at.throws || ''}`);
  }
  for (const id of ['onramp', 'sundown']) {
    const t = matrixRun(MODS[id].default, 20, 6, 4, 20);
    if (!(t.litMin > 0) || t.throws) bad.push(`${id} 20x6: should be lit, litMin ${t.litMin} ${t.throws || ''}`);
  }
  assert.deepEqual(bad, []);
});

test('matrix controls: the runner catches a 50% flip, a wide glyph, a two-shade ramp jump, a blank cell with a colour and a banned glyph, and passes a clean scene', () => {
  const run = (k) => matrixRun(PLANTED[k], 40, 12, 1, 5);
  const clean = run('clean');
  assert.deepEqual([clean.worst, clean.ramp, clean.wide, clean.glyph, clean.banned, clean.blankCol, clean.colour, clean.throws], [0, 0, 0, 0, 0, 0, 0, null], 'the clean control reads clean');
  const flip = run('flip');
  assert.ok(!(flip.worst < FLASH_FRACTION) && flip.worst > 0.45, `flip reads ${pct(flip.worst)}`);
  assert.ok(run('wide').wide > 0, 'U+4E16 is flagged wide');
  const ramp = run('ramp');
  assert.ok(ramp.ramp > 0 && ramp.firstRamp, 'shade 3 to shade 0 on one glyph is a ramp violation');
  assert.ok(run('blank').blankCol > 0, 'a blank cell in colour 5 is flagged');
  assert.ok(run('banned').banned > 0, 'U+25D0 is flagged banned');
  // the floor check bites too: a scene that draws under a 40x18 floor reads as lit there
  assert.ok(run('clean').litMin > 0 && run('clean').litMax > 0);
});
