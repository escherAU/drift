// DRIFT-7 C4b: the byte budget helper (tests/helpers-budget.js) and its fixtures (tests/helpers-budget-fixtures.js).
// measureBytes feeds the REAL renderer at exact 1/18 s steps; checkBudget compares against a per-scene limit and the
// two global ceilings. The CPU helper's test is in tests/budget-cpu.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEADY_CEILING, WORST_SECOND_CEILING, CPU_MEAN_CEILING_MS, BUDGET_RUN, BUDGET_FPS,
  limitFromMeasured, measureBytes, checkBudget, LIMIT_ROUND, LIMIT_MARGIN_NUM, LIMIT_MARGIN_DEN,
} from './helpers-budget.js';
import { makeHog, makeOrb, ORB_LIMIT, ORB_MEASURED, hogFrameSource } from './helpers-budget-fixtures.js';
import { RGB_CELL } from '../src/renderer.js';

// ---- constants

test('the budget constants are exported with the ruled values', () => {
  assert.equal(STEADY_CEILING, 12_000_000);
  assert.equal(WORST_SECOND_CEILING, 12_700_000);
  assert.equal(CPU_MEAN_CEILING_MS, 27);
  assert.deepEqual(BUDGET_RUN, { '120x40': 60, '240x67': 30 });
  assert.equal(BUDGET_FPS, 18);
  assert.equal(LIMIT_ROUND, 10_000);
  assert.equal(LIMIT_MARGIN_NUM / LIMIT_MARGIN_DEN, 1.1);
});

// ---- limitFromMeasured: ceil(x * 1.10), then up to the next 10 KB/s

test('limitFromMeasured: x1.10 rounded up to the next 10_000', () => {
  assert.equal(limitFromMeasured(1_234_567), 1_360_000); // 1,358,023.7 -> 1,358,024 -> 1,360,000
  assert.equal(limitFromMeasured(1_000_000), 1_100_000);
  for (const x of [100_000, 400_000, 700_000, 800_000]) assert.equal(limitFromMeasured(x), x * 11 / 10, `${x}: an exact multiple stays (the float 1.1 trap: ${x} * 1.1 = ${x * 1.1})`);
  assert.equal(limitFromMeasured(1_200_000), 1_320_000);
  assert.equal(limitFromMeasured(1_090_909), 1_200_000); // 1,199,999.9 -> 1,200,000
  assert.equal(limitFromMeasured(1_090_910), 1_210_000, 'one byte over the multiple goes to the next');
  assert.equal(limitFromMeasured(0), 0);
  assert.equal(limitFromMeasured(1), 10_000);
  assert.equal(limitFromMeasured(9_090), 10_000); // 9,999
  assert.equal(limitFromMeasured(9_091), 20_000); // 10,000.1 -> 10,001 -> 20,000
  assert.equal(limitFromMeasured(1_234_567.89), 1_360_000, 'a fractional bytes/s works the same');
});

test('limitFromMeasured is a multiple of 10_000, at least 1.10 x measured, and less than 1.10 x + 10_000', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let k = 0; k < 500; k++) {
    const x = Math.floor(rnd() * 12_000_000);
    const l = limitFromMeasured(x);
    assert.equal(l % 10_000, 0);
    assert.ok(l >= x * 1.1 - 1e-6, `${x} -> ${l}`);
    assert.ok(l < x * 1.1 + 10_000 + 1, `${x} -> ${l}`);
  }
});

test('a measured rate near the ceiling gives a limit above it, and checkBudget refuses that limit', () => {
  assert.equal(limitFromMeasured(10_909_090), 12_000_000, 'exactly the ceiling: allowed');
  assert.equal(limitFromMeasured(10_909_091), 12_010_000, 'one byte more and the limit passes the ceiling');
  const m = { steady: 100, worst: 100, frames: 1, total: 100 };
  checkBudget(m, { steady: limitFromMeasured(10_909_090), worst: limitFromMeasured(11_000_000) });
  assert.throws(() => checkBudget(m, { steady: limitFromMeasured(10_909_091), worst: 1 }), /steady limit .* ceiling/);
  assert.throws(() => checkBudget(m, { steady: 1, worst: WORST_SECOND_CEILING + 1 }), /worst limit .* ceiling/);
});

// ---- measureBytes on tiny frame sources (the steps, the dropped first frame, the sliding window)

const PAL_SOURCE = (fn) => fn; // a frame source is (t, cols, rows) -> { glyphs, shades?, fg?, bg? }
function rgbFrame(cols, rows) {
  const n = cols * rows;
  return { cols, rows, glyphs: new Uint16Array(n).fill(0x78), shades: new Uint8Array(n).fill(RGB_CELL), fg: new Uint32Array(n).fill(0xfc0000), bg: new Uint32Array(n).fill(0x0000fc) };
}

test('measureBytes: t steps are exactly k / 18, the first frame is dropped, frames = seconds * fps', () => {
  const ts = [];
  const f = rgbFrame(20, 5);
  const m = measureBytes(PAL_SOURCE((t) => { ts.push(t); return f; }), 20, 5, 4);
  assert.equal(ts.length, 4 * 18 + 1, 'one extra frame, the full repaint, is rendered and dropped');
  for (let k = 0; k < ts.length; k++) assert.equal(ts[k], k / 18, `frame ${k}`);
  assert.equal(m.frames, 72);
  assert.equal(m.total, 0, 'a frame that never changes costs nothing after the first repaint');
  assert.equal(m.steady, 0);
  assert.equal(m.worst, 0);
});

test('measureBytes: steady = total / seconds, worst = the busiest 18 consecutive frames, measured through the real renderer', () => {
  // quiet for 10 s except second 5 (frames 90..107), when 40 of 100 cells change colour every frame
  const base = rgbFrame(20, 5);
  const f = rgbFrame(20, 5);
  const m = measureBytes((t) => {
    const k = Math.round(t * 18);
    f.fg.set(base.fg);
    if (k >= 90 && k < 108) for (let i = 0; i < 40; i++) f.fg[i] = 0x00fc00 + ((k + i) % 2) * 0xfc0000;
    return f;
  }, 20, 5, 10);
  assert.equal(m.frames, 180);
  assert.ok(m.total > 0);
  assert.equal(m.steady, m.total / 10);
  // the burst's own frames (and the step back after it) are the whole of the traffic
  assert.ok(m.worst >= m.total * 0.9, `worst ${m.worst} of total ${m.total}`);
  assert.ok(m.worst > m.steady * 8, 'a one second burst in ten is eight or more times the average');
  assert.equal(m.perFrame.length, 180);
  assert.equal(m.perFrame.reduce((a, b) => a + b, 0), m.total);
  // sliding: the worst window really is 18 consecutive frames
  let best = 0;
  for (let i = 0; i + 18 <= m.perFrame.length; i++) { let s = 0; for (let j = 0; j < 18; j++) s += m.perFrame[i + j]; if (s > best) best = s; }
  assert.equal(m.worst, best);
});

test('measureBytes: a run shorter than one second still reports a worst window (the whole run)', () => {
  const f = rgbFrame(10, 4);
  const m = measureBytes((t) => { f.fg.fill(Math.round(t * 18) % 2 ? 0xfc0000 : 0x00fc00); return f; }, 10, 4, 0.5);
  assert.equal(m.frames, 9);
  assert.equal(m.worst, m.total);
});

test('measureBytes takes a cells scene too (the composer path), and counts the sync wrapper the app adds to every frame', () => {
  const orb = makeOrb();
  const m = measureBytes(orb, 60, 20, 2);
  assert.equal(m.frames, 36);
  assert.ok(m.total > 36 * 24, 'every frame that drew anything carries the 2026 begin/end wrapper');
  assert.ok(m.perFrame.every((b) => b === 0 || b > 24));
});

// ---- the fixtures: both arms

const HOG_SECONDS = 4;

// Finding: the densest frame a cell can be is 39 bytes (an SGR with two three-digit truecolours, 36 bytes, and a three-byte
// glyph), so at 240x67 and 18 fps NO scene can send more than 16_000 x 39 x 18 = 11.2 MB/s. The 12 MB/s steady ceiling is
// above that: at 240x67 the ceilings can never fire and the per-scene limits do all the work. The ceiling arm of checkBudget
// is proved on a screen bigger than the budget sizes (300x80, 24_000 cells), and the 240x67 hog on the arms that can fire.
test('byte hog at 240x67: random glyph, fg and bg in every cell every frame sends the most a scene can, and fails any per-scene limit', () => {
  const m = measureBytes(hogFrameSource(), 240, 67, HOG_SECONDS);
  console.log(`hog 240x67 ${HOG_SECONDS} s: steady ${Math.round(m.steady)} B/s, worst ${m.worst} B/s, ${m.frames} frames`);
  assert.ok(m.steady > 0.97 * (240 * 67 - 1) * 39 * 18, `steady ${m.steady} is the densest output (39 B a cell; the bottom-right cell is never drawn)`);
  assert.ok(m.steady < STEADY_CEILING, 'so it sits just under the ceiling');
  assert.throws(() => checkBudget(m, ORB_LIMIT), /steady/);
  assert.throws(() => checkBudget(m, { steady: 12_000_000, worst: 1_000_000 }), /worst/, 'the worst-second arm alone');
  assert.throws(() => checkBudget(m, { steady: 1_000_000, worst: WORST_SECOND_CEILING }), /steady/, 'the steady arm alone');
  checkBudget(m, { steady: STEADY_CEILING, worst: WORST_SECOND_CEILING }); // under both ceilings: the only way to pass is a limit this high
});

test('byte hog on a 300x80 screen FAILS the ceilings: steady, and worst second, each named', () => {
  const m = measureBytes(hogFrameSource(), 300, 80, HOG_SECONDS);
  console.log(`hog 300x80 ${HOG_SECONDS} s: steady ${Math.round(m.steady)} B/s, worst ${m.worst} B/s, ${m.frames} frames`);
  assert.ok(m.steady > STEADY_CEILING, `steady ${m.steady}`);
  assert.ok(m.worst > WORST_SECOND_CEILING, `worst ${m.worst}`);
  const limit = { steady: STEADY_CEILING, worst: WORST_SECOND_CEILING };
  assert.throws(() => checkBudget(m, limit), /steady/);
  assert.throws(() => checkBudget({ ...m, steady: 1 }, limit), /worst/, 'the worst-second arm alone');
  assert.throws(() => checkBudget({ ...m, worst: 1 }, limit), /steady/, 'the steady arm alone');
});

test('the hog is a source and a scene: the composer path sends the same kind of traffic', () => {
  const m = measureBytes(makeHog(), 120, 40, 2);
  const s = measureBytes(hogFrameSource(), 120, 40, 2);
  assert.equal(m.total, s.total, 'identical frames, identical bytes');
  assert.ok(m.steady > 2_700_000, `hog scene at 120x40: ${m.steady}`);
});

test('still field with a moving orb at 240x67 passes its small limit and sits far under the ceilings', () => {
  const m = measureBytes(makeOrb(), 240, 67, BUDGET_RUN['240x67']);
  console.log(`orb 240x67 ${BUDGET_RUN['240x67']} s: steady ${Math.round(m.steady)} B/s, worst ${m.worst} B/s, ${m.frames} frames`);
  assert.equal(m.frames, 30 * 18);
  checkBudget(m, ORB_LIMIT);
  assert.ok(m.steady < STEADY_CEILING / 5);
  assert.ok(ORB_LIMIT.steady <= STEADY_CEILING && ORB_LIMIT.worst <= WORST_SECOND_CEILING);
  // the limit is the measured rate x 1.10 rounded up (ORB_MEASURED is what this run printed), and it bites
  assert.equal(ORB_LIMIT.steady, limitFromMeasured(ORB_MEASURED.steady));
  assert.equal(ORB_LIMIT.worst, limitFromMeasured(ORB_MEASURED.worst));
  assert.ok(Math.abs(m.steady - ORB_MEASURED.steady) < 1, `steady ${m.steady} vs recorded ${ORB_MEASURED.steady}`);
  assert.ok(Math.abs(m.worst - ORB_MEASURED.worst) < 1, `worst ${m.worst} vs recorded ${ORB_MEASURED.worst}`);
  assert.throws(() => checkBudget(m, { steady: Math.floor(m.steady / 2), worst: ORB_LIMIT.worst }), /steady/);
  assert.throws(() => checkBudget(m, { steady: ORB_LIMIT.steady, worst: Math.floor(m.worst / 2) }), /worst/);
});

test('the orb at 120x40 for 60 s passes a limit made by limitFromMeasured from its own measure', () => {
  const m = measureBytes(makeOrb(), 120, 40, BUDGET_RUN['120x40']);
  console.log(`orb 120x40 ${BUDGET_RUN['120x40']} s: steady ${Math.round(m.steady)} B/s, worst ${m.worst} B/s, ${m.frames} frames`);
  assert.equal(m.frames, 60 * 18);
  checkBudget(m, { steady: limitFromMeasured(m.steady), worst: limitFromMeasured(m.worst) });
});

test('measureBytes is deterministic: two runs of the same source give the same bytes', () => {
  const a = measureBytes(makeOrb(), 80, 24, 3), b = measureBytes(makeOrb(), 80, 24, 3);
  assert.equal(a.total, b.total);
  assert.deepEqual(a.perFrame, b.perFrame);
});
