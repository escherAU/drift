// DRIFT-7 C14: the Rosette against the flash meter (every rule L1, L2, L3, R at 1x and 4x), on truecolor output and on 256-colour
// output (the renderer's own nearest256 through makeReducer256), its byte budget and its CPU budget. Structure and look are in
// driftman-9000-rosette.test.js. The scene runs solo through the real cell composer, frame k at t = (k + phase) / 18, 66 s (the four
// 3 s melts at 15, 30, 45 and 60 s are all inside), at 120x40, 80x24, 240x67, 61x21, 60x20 and the size just above each layout
// breakpoint (compact 78x24, full 88x39, extra-large 176x58). A second clock phase and a second seed at the sizes where the contours cost most.
//
// Why the contour is L 0.72 turned 180 degrees and not the designer's 0.82 (or stage A's 0.78): see the header of rosette.js and the
// controls below. 0.82 fails the meter in truecolor (L2 at 4x 76.6 % at 120x40). 0.78 passes in truecolor but, snapped to the 256-colour
// cube, fails (L2 at 4x 63.6 %). 0.72 and below pass both; the hue turn is what gives the line its contrast.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlashMeter } from './helpers-flash.js';
import { makeReducer256 } from './helpers-flash-controls.js';
import {
  STEADY_CEILING, WORST_SECOND_CEILING, CPU_MEAN_CEILING_MS, BUDGET_RUN, limitFromMeasured, measureBytes, checkBudget, measureCpu, checkCpu,
} from './helpers-budget.js';
import { createCellComposer } from '../src/cells.js';
import { nearest256 } from '../src/renderer.js';
import rosette, { makeRosette } from '../cartridges/driftman-9000/scenes/rosette.js';

const FPS = 18;
const SECONDS = 66;
const pc = (x) => (x * 100).toFixed(1);
const show = (rep) => `L1 ${pc(rep.l1.x1.worstFraction)}/${pc(rep.l1.x4.worstFraction)} L2 ${pc(rep.l2.x1.worstFraction)}/${pc(rep.l2.x4.worstFraction)} L3 ${pc(rep.l3.worstFraction)} R ${pc(rep.r.x1.worstFraction)}/${pc(rep.r.x4.worstFraction)}`;
const failed = (rep) => [['l1.x1', rep.l1.x1], ['l1.x4', rep.l1.x4], ['l2.x1', rep.l2.x1], ['l2.x4', rep.l2.x4], ['l3', rep.l3], ['r.x1', rep.r.x1], ['r.x4', rep.r.x4]].filter(([, r]) => !r.pass).map(([id]) => id);

// One solo run through the composer. reduce256: the frames as 256-colour output would show them.
function run(scene, cols, rows, { phase = 0, seed = 1, seconds = SECONDS, reduce256 = false } = {}) {
  const cc = createCellComposer({ scenes: [scene], cols, rows, seed });
  const meter = createFlashMeter(cols, rows, FPS);
  const reduce = reduce256 ? makeReducer256(cols, rows) : null;
  const N = Math.round(seconds * FPS);
  for (let k = 0; k < N; k++) {
    const f = cc.frame({ a: 0, b: 0, p: 0 }, (k + phase) / FPS);
    if (reduce) { const r = reduce(f, null); meter.push(r.frame, r.palette); } else meter.push(f);
  }
  return meter.report();
}

// ---- 1. truecolor, solo, 1x and 4x

const SIZES = ['120x40', '80x24', '61x21', '60x20', '78x24', '88x39', '176x58', '240x67'];
const EXTRA = { '120x40': [{ phase: 0.5 }, { seed: 2 }], '78x24': [{ phase: 0.5 }], '88x39': [{ seed: 2 }, { seed: 3, phase: 0.25 }], '240x67': [{ seed: 2 }] };

for (const sz of SIZES) {
  test(`rosette flash ${sz}: solo for ${SECONDS} s, every rule passes at 1x and 4x (clock phases and seeds: ${(EXTRA[sz] || []).map((o) => JSON.stringify(o)).join(' ') || 'the default only'})`, () => {
    const [cols, rows] = sz.split('x').map(Number);
    const lines = [];
    for (const o of [{}, ...(EXTRA[sz] || [])]) {
      const rep = run(rosette, cols, rows, o);
      lines.push(`${sz} ${JSON.stringify(o)} truecolor ${show(rep)}`);
      assert.deepEqual(failed(rep), [], `${sz} ${JSON.stringify(o)}: ${show(rep)}`);
    }
    console.log('METER ' + lines.join('\n      '));
  });
}

// ---- 2. 256-colour output

for (const sz of ['120x40', '80x24', '61x21', '88x39', '176x58', '240x67']) {
  test(`rosette flash ${sz} on 256-colour output (nearest256): every rule passes at 1x and 4x`, () => {
    const [cols, rows] = sz.split('x').map(Number);
    const rep = run(rosette, cols, rows, { reduce256: true });
    console.log(`METER ${sz} 256-colour ${show(rep)}`);
    assert.deepEqual(failed(rep), [], `${sz}: ${show(rep)}`);
  });
}

test('rosette 256 colours: the output is not garbage, at least 24 distinct 256-colour indexes over 60 s (measured 32), and every index is a cube or grey entry', () => {
  const cols = 120, rows = 40, n = cols * rows;
  const cc = createCellComposer({ scenes: [rosette], cols, rows, seed: 1 });
  const used = new Set();
  let cells = 0;
  for (let k = 0; k < 60 * FPS; k += 5) {
    const f = cc.frame({ a: 0, b: 0, p: 0 }, k / FPS);
    for (let i = 0; i < n; i++) { used.add(nearest256(f.fg[i])); used.add(nearest256(f.bg[i])); cells++; }
  }
  console.log(`256-colour: ${used.size} distinct indexes over ${cells} cells`);
  assert.ok(used.size >= 24, `${used.size}`);
  for (const i of used) assert.ok(i >= 16 && i <= 255, `index ${i}`);
});

// ---- 3. the controls: the meter bites on this path

test('rosette controls: the designer\'s contour (L 0.82, no hue turn) fails the meter at 120x40 and 80x24; stage A\'s 0.78 passes in truecolor and fails in 256 colours; the shipped contour passes both', () => {
  for (const sz of ['120x40', '80x24']) {
    const [cols, rows] = sz.split('x').map(Number);
    const sams = run(makeRosette(0.82, 0), cols, rows, { seconds: 30 });
    assert.ok(!sams.pass, `${sz}: L 0.82 must fail: ${show(sams)}`);
    assert.ok(failed(sams).includes('l2.x1') && failed(sams).includes('l2.x4'), `${sz}: ${failed(sams)}`);
    const a = makeRosette(0.78, 0);
    const aTrue = run(a, cols, rows, { seconds: 30 }), a256 = run(a, cols, rows, { seconds: 30, reduce256: true });
    assert.deepEqual(failed(aTrue), [], `${sz}: L 0.78 in truecolor: ${show(aTrue)}`);
    assert.ok(failed(a256).includes('l2.x4'), `${sz}: L 0.78 in 256 colours must fail L2 at 4x: ${show(a256)}`);
    console.log(`CONTROL ${sz} L 0.82 truecolor ${show(sams)} | L 0.78 truecolor ${show(aTrue)} | L 0.78 256 ${show(a256)}`);
    const shipped = run(rosette, cols, rows, { seconds: 30 }), shipped256 = run(rosette, cols, rows, { seconds: 30, reduce256: true });
    assert.ok(shipped.pass && shipped256.pass, `${sz}: ${show(shipped)} | ${show(shipped256)}`);
  }
});

test('rosette controls: a strobe over the Rosette\'s own frames (every cell black and white on alternate frames) fails L1 and L2', () => {
  const cols = 60, rows = 20;
  const cc = createCellComposer({ scenes: [rosette], cols, rows, seed: 1 });
  const meter = createFlashMeter(cols, rows, FPS);
  for (let k = 0; k < 6 * FPS; k++) {
    const f = cc.frame({ a: 0, b: 0, p: 0 }, k / FPS);
    const g = { cols, rows, glyphs: f.glyphs.slice(), shades: f.shades.slice(), fg: f.fg.slice(), bg: f.bg.slice() };
    g.fg.fill(k % 2 ? 0xffffff : 0x000000); g.bg.fill(k % 2 ? 0xffffff : 0x000000);
    meter.push(g);
  }
  const rep = meter.report();
  assert.ok(!rep.pass && failed(rep).includes('l1.x1') && failed(rep).includes('l2.x1'), show(rep));
});

// ---- 4. the byte budget

// Measured with measureBytes at BUDGET_RUN (60 s at 120x40, 30 s at 240x67, the real renderer, truecolor, seed 1).
const MEASURED = { '120x40': { steady: 2_938_100, worst: 3_057_338 }, '240x67': { steady: 9_131_554, worst: 9_901_177 } };
// The limits: measured x 1.10, rounded up to the next 10 KB/s (limitFromMeasured), each under the global ceilings.
const LIMIT = { '120x40': { steady: 3_240_000, worst: 3_370_000 }, '240x67': { steady: 10_050_000, worst: 10_900_000 } };

for (const sz of ['120x40', '240x67']) {
  test(`rosette bytes ${sz}: steady and worst second are within the scene's own limits, which are measured x 1.10 rounded up to 10 KB/s and under STEADY_CEILING and WORST_SECOND_CEILING`, () => {
    const [cols, rows] = sz.split('x').map(Number);
    const m = measureBytes(rosette, cols, rows, BUDGET_RUN[sz]);
    console.log(`BYTES ${sz}: steady ${Math.round(m.steady)} B/s, worst second ${m.worst} B (limits ${LIMIT[sz].steady} / ${LIMIT[sz].worst}; ceilings ${STEADY_CEILING} / ${WORST_SECOND_CEILING})`);
    assert.equal(LIMIT[sz].steady, limitFromMeasured(MEASURED[sz].steady));
    assert.equal(LIMIT[sz].worst, limitFromMeasured(MEASURED[sz].worst));
    assert.ok(Math.abs(m.steady - MEASURED[sz].steady) < 2000, `steady ${m.steady} is not the measured ${MEASURED[sz].steady}`);
    assert.ok(Math.abs(m.worst - MEASURED[sz].worst) < 20000, `worst ${m.worst} is not the measured ${MEASURED[sz].worst}`);
    checkBudget(m, LIMIT[sz]);
    assert.ok(LIMIT[sz].steady <= STEADY_CEILING && LIMIT[sz].worst <= WORST_SECOND_CEILING);
    // the control: a limit just under the measured value is refused
    assert.throws(() => checkBudget(m, { steady: Math.floor(m.steady) - 1, worst: LIMIT[sz].worst }), /steady/);
    assert.throws(() => checkBudget(m, { steady: LIMIT[sz].steady, worst: m.worst - 1 }), /worst/);
  });
}

// ---- 5. CPU

test('rosette CPU: mean scene + render per frame at 240x67 (180 frames after 18 warm-up, best of 3) is under the 27 ms ceiling', () => {
  const m = measureCpu(rosette);
  console.log(`CPU rosette 240x67: best mean ${m.meanMs.toFixed(2)} ms per frame (runs ${m.runsMs.map((x) => x.toFixed(2)).join(', ')}; ceiling ${CPU_MEAN_CEILING_MS})`);
  assert.equal(m.frames, 180);
  checkCpu(m);
});
