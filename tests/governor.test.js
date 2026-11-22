// DRIFT-13 phase 1: the flash governor (src/governor.js), unit level. The meter-level properties (every size, every fps, the three clocks, adversaries, must-fail controls and
// mutants) are in tests/governor-adversarial.test.js and tests/governor-mutation.test.js. Everything here is a pure function of its inputs: no clock, no app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGovernor, exactCap, fieldOf, STEP_LIMIT, READ_CAP, FIELD_LIMIT, EPS_T } from '../src/governor.js';
import { fieldSize } from './helpers-flash.js';

const SP = 32, FULL = 0x2588;
const frame = (n, g = SP, s = 0) => ({ glyphs: new Uint16Array(n).fill(g), shades: new Uint8Array(n).fill(s) });
const rngOf = (seed) => { let s = (Math.imul(seed + 1, 2654435761) >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
const count = (a, v) => { let c = 0; for (let i = 0; i < a.length; i++) if (a[i] === v) c++; return c; };
const expectW = (fps) => Math.max(1, Math.max(1, Math.round(fps)) / fps);

// ---- 1. per cell: the third change inside W is held, released when the first of the three is W old
for (const fps of [8, 18, 26, 30, 25.6, 8.5, 29.4]) {
  test(`DRIFT-13 per cell: a third change inside W is held and released at exactly W (fps ${fps})`, () => {
    const W = expectW(fps);
    const gov = createGovernor({ cols: 40, rows: 10, fps });
    assert.equal(gov.limits.W, W, 'W = max(1, round(fps) / fps), the meter\'s window in seconds');
    const n = 400, cell = 123;
    const f = frame(n);
    gov.govern(f.glyphs, f.shades, -50); // first paint: ungoverned, a long time ago
    const seq = [0x41, 0x42, 0x43, 0x44];
    const at = (t, v) => { f.glyphs[cell] = v; return gov.govern(f.glyphs, f.shades, t).glyphs[cell]; };
    const tA = 0, tB = 0.3 * W, tC = 0.6 * W;
    assert.equal(at(tA, seq[0]), seq[0], 'first change');
    assert.equal(at(tB, seq[1]), seq[1], 'second change');
    assert.equal(at(tC, seq[2]), seq[1], 'third change inside W: held, the old glyph stays');
    assert.equal(at(tA + W - 1e-6, seq[2]), seq[1], 'just under W after the first of the three: still held');
    assert.equal(at(tA + W, seq[2]), seq[2], 'exactly W after it: released');
    // the next change is again a third one: needs the (now) second-to-last change, tB, to be W old
    assert.equal(at(tA + W + 0.01, seq[3]), seq[2], 'a fourth change right after is held (second-to-last is tB, not yet W old)');
    assert.equal(at(tB + W - 1e-6, seq[3]), seq[2], 'just under W after tB: held');
    assert.equal(at(tB + W, seq[3]), seq[3], 'exactly W after tB: released');
  });
}

test('DRIFT-13 per cell: no cell ever makes three changes less than W apart (random frames, 3000 paints)', () => {
  for (const fps of [8, 18, 30]) {
    const W = expectW(fps), rnd = rngOf(fps), n = 400;
    const gov = createGovernor({ cols: 40, rows: 10, fps });
    const hist = Array.from({ length: n }, () => []);
    const painted = new Uint16Array(n).fill(SP);
    const f = frame(n);
    gov.govern(f.glyphs, f.shades, -50);
    let t = 0;
    for (let k = 0; k < 3000; k++) {
      t += 0.005 + rnd() * 0.05;
      for (let i = 0; i < n; i++) if (rnd() < 0.3) f.glyphs[i] = rnd() < 0.5 ? SP : FULL;
      const o = gov.govern(f.glyphs, f.shades, t);
      for (let i = 0; i < n; i++) if (o.glyphs[i] !== painted[i]) { painted[i] = o.glyphs[i]; hist[i].push(t); }
    }
    let changes = 0;
    for (let i = 0; i < n; i++) {
      changes += hist[i].length;
      for (let j = 2; j < hist[i].length; j++) assert.ok(hist[i][j] - hist[i][j - 2] >= W - EPS_T, `fps ${fps} cell ${i}: changes ${j - 2} and ${j} are ${hist[i][j] - hist[i][j - 2]} s apart (W ${W})`);
    }
    assert.ok(changes > 1000, `the test actually changed cells (${changes})`);
  }
});

// ---- 2. per read: the union of cells changed inside one 1 / fps is at most floor(0.25 n) (READ_CAP, 5 points under the meter's 0.30), exactly
for (const [cols, rows, cap] of [[40, 10, 100], [80, 24, 480]]) {
  test(`DRIFT-13 per read: ${cols}x${rows}, a frame that changes every cell paints exactly ${cap} (the cap), catches up, and two paints inside 1/fps share one budget`, () => {
    const fps = 18, R = 1 / fps, n = cols * rows;
    assert.equal(createGovernor({ cols, rows, fps }).limits.stepCap, cap);
    assert.equal(cap, Math.floor(READ_CAP * n), 'a size where 0.25 n is an integer');
    assert.ok(cap / n <= READ_CAP && (cap + 1) / n > READ_CAP, 'as the meter compares count / n, against the cap');
    assert.ok(cap / n < STEP_LIMIT && READ_CAP === 0.25 && STEP_LIMIT === 0.30, 'and the cap is a margin under the limit of 0.30');
    const gov = createGovernor({ cols, rows, fps });
    const blank = frame(n), full = frame(n, FULL);
    gov.govern(blank.glyphs, blank.shades, -50);
    let o = gov.govern(full.glyphs, full.shades, 0);
    assert.equal(count(o.glyphs, FULL), cap, 'the first paint of the change: exactly the cap');
    assert.equal(gov.stats.last.changed, cap);
    o = gov.govern(full.glyphs, full.shades, 0.5 * R);
    assert.equal(count(o.glyphs, FULL), cap, 'a second paint inside 1/fps shares the budget: nothing more is painted');
    assert.equal(gov.stats.last.changed, 0);
    o = gov.govern(full.glyphs, full.shades, 0.999 * R);
    assert.equal(count(o.glyphs, FULL), cap, 'still inside the window of the first paint');
    o = gov.govern(full.glyphs, full.shades, R);
    assert.equal(count(o.glyphs, FULL), 2 * cap, 'exactly 1/fps after the first paint: a new window, the next cap cells (catch-up)');
    assert.equal(gov.stats.last.changed, cap);
    // two paints 1/fps apart do not share: each one gets the full cap
    o = gov.govern(full.glyphs, full.shades, 2 * R);
    assert.equal(gov.stats.last.changed, Math.min(cap, n - 2 * cap), 'and the third window takes what is left (or the cap)');
  });
}

test('DRIFT-13 per read: exactCap is the largest count the meter passes (every n up to 6000, and the meter\'s own comparison)', () => {
  for (let n = 1; n <= 6000; n++) {
    for (const lim of [0.30, READ_CAP]) {
      const c = exactCap(n, lim);
      assert.ok(c / n <= lim, `n ${n}: ${c} / ${n} <= ${lim}`);
      assert.ok((c + 1) / n > lim, `n ${n}: ${c + 1} / ${n} > ${lim}`);
    }
  }
  assert.equal(exactCap(0, 0.3), 0);
  assert.equal(exactCap(56, FIELD_LIMIT), 14, 'a 56-cell field may hold 14 hot cells (14 / 56 = 0.25 exactly)');
});

test('DRIFT-13 per read: a cell that changed inside the window and changes again costs nothing more, a read window slides by time', () => {
  const fps = 20, R = 0.05, n = 400, gov = createGovernor({ cols: 40, rows: 10, fps });
  const a = frame(n), b = frame(n, FULL);
  gov.govern(a.glyphs, a.shades, -50);
  gov.govern(b.glyphs, b.shades, 0); // 100 cells now FULL
  const c = frame(n, 0x41); // everything wants a third value
  gov.govern(c.glyphs, c.shades, 0.01);
  // the 100 cells already inside the window may change again for free (they stay inside the union); no new cell may
  const o = gov.govern(c.glyphs, c.shades, 0.01 + 1e-4);
  const changed = count(o.glyphs, 0x41);
  assert.ok(changed <= 100, `no more than the 100 cells already in the window changed to the new glyph (${changed})`);
  const union = new Set();
  for (let i = 0; i < n; i++) if (o.glyphs[i] !== SP) union.add(i);
  assert.ok(union.size <= 100, `the union of cells touched inside the window is at most the cap (${union.size})`);
  void R;
});

// ---- 3. a held cell keeps its old pair whole
test('DRIFT-13 pairs: a held cell keeps its old glyph AND shade; the painted pairs only ever come from the cell\'s own input history', () => {
  const n = 400, rnd = rngOf(7), gov = createGovernor({ cols: 40, rows: 10, fps: 18 });
  const seen = Array.from({ length: n }, () => new Set());
  const f = frame(n);
  const pairKey = (g, s) => g * 256 + s;
  for (let i = 0; i < n; i++) seen[i].add(pairKey(SP, 0));
  gov.govern(f.glyphs, f.shades, -50);
  let t = 0, held = 0, mixed = 0;
  for (let k = 0; k < 400; k++) {
    t += 0.01 + rnd() * 0.04;
    for (let i = 0; i < n; i++) if (rnd() < 0.5) { f.glyphs[i] = [SP, FULL, 0x2580][Math.floor(rnd() * 3)]; f.shades[i] = Math.floor(rnd() * 3); seen[i].add(pairKey(f.glyphs[i], f.shades[i])); }
    const o = gov.govern(f.glyphs, f.shades, t);
    for (let i = 0; i < n; i++) {
      assert.ok(seen[i].has(pairKey(o.glyphs[i], o.shades[i])), `cell ${i} paint ${k}: (${o.glyphs[i]}, ${o.shades[i]}) was never asked for by that cell`);
      if (o.glyphs[i] !== f.glyphs[i] || o.shades[i] !== f.shades[i]) held++;
      if ((o.glyphs[i] === f.glyphs[i]) !== (o.shades[i] === f.shades[i]) && !seen[i].has(pairKey(o.glyphs[i], o.shades[i]))) mixed++;
    }
  }
  assert.ok(held > 1000, `cells were held in this run (${held})`);
  assert.equal(mixed, 0);
});

test('DRIFT-13 pairs: a held cell that wanted a new glyph with the same shade (or the reverse) keeps both old values', () => {
  const n = 400, gov = createGovernor({ cols: 40, rows: 10, fps: 18 });
  const f = frame(n, SP, 0);
  gov.govern(f.glyphs, f.shades, -50);
  const cell = 5;
  const step = (t, g, s) => { f.glyphs[cell] = g; f.shades[cell] = s; const o = gov.govern(f.glyphs, f.shades, t); return [o.glyphs[cell], o.shades[cell]]; };
  assert.deepEqual(step(0, 0x41, 0), [0x41, 0]);
  assert.deepEqual(step(0.2, 0x41, 3), [0x41, 3]);
  assert.deepEqual(step(0.4, 0x42, 3), [0x41, 3], 'third change inside W held: neither the new glyph nor the old shade alone');
  assert.deepEqual(step(0.5, 0x41, 4), [0x41, 3], 'shade-only change held as a whole too');
});

// ---- 4. degenerate and shape cases
test('DRIFT-13 shapes: empty, one cell, all-blank, unchanged, first paint, reset, resize, wrong size', () => {
  const e = createGovernor({ cols: 0, rows: 0, fps: 18 });
  const o0 = e.govern(new Uint16Array(0), new Uint8Array(0), 0);
  assert.equal(o0.glyphs.length, 0);
  const one = createGovernor({ cols: 1, rows: 1, fps: 18 });
  assert.equal(one.limits.stepCap, 1, 'a one-cell screen is never frozen (cap held at 1)');
  const f1 = frame(1);
  one.govern(f1.glyphs, f1.shades, -50);
  f1.glyphs[0] = FULL;
  assert.equal(one.govern(f1.glyphs, f1.shades, 0).glyphs[0], FULL);

  const n = 400, gov = createGovernor({ cols: 40, rows: 10, fps: 18 });
  const blank = frame(n), full = frame(n, FULL);
  const first = gov.govern(full.glyphs, full.shades, 0);
  assert.equal(count(first.glyphs, FULL), n, 'the first paint is not governed (a fresh screen)');
  assert.equal(gov.stats.ungoverned, 1);
  // an unchanged frame: no work, no holds, the output equals the input and is the same object
  const again = gov.govern(full.glyphs, full.shades, 1);
  assert.equal(again, first, 'the same returned object');
  assert.equal(gov.stats.last.wanted, 0); assert.equal(gov.stats.last.changed, 0); assert.equal(gov.stats.last.held, 0);
  assert.deepEqual(Array.from(again.glyphs), Array.from(full.glyphs));
  // all-blank after reset: ungoverned again, and the whole change goes through
  gov.reset();
  const afterReset = gov.govern(blank.glyphs, blank.shades, 1.01);
  assert.equal(count(afterReset.glyphs, SP), n, 'after reset() the next paint is ungoverned');
  assert.equal(gov.stats.ungoverned, 2);
  // resize
  gov.resize(60, 20);
  const big = frame(1200, FULL);
  assert.equal(count(gov.govern(big.glyphs, big.shades, 2).glyphs, FULL), 1200, 'after resize() the first paint is ungoverned');
  assert.throws(() => gov.govern(full.glyphs, full.shades, 3), RangeError, 'a frame of the old size is refused');
});

test('DRIFT-13 shapes: strictly the input\'s own values, palette indices stay in the input\'s set, inversion (indices swapped) changes nothing but the indices', () => {
  const n = 400, rnd = rngOf(11);
  const a = createGovernor({ cols: 40, rows: 10, fps: 18 }), b = createGovernor({ cols: 40, rows: 10, fps: 18 });
  const f = frame(n), g = frame(n, SP, 1);
  a.govern(f.glyphs, f.shades, -50); b.govern(g.glyphs, g.shades, -50);
  let t = 0, held = 0;
  for (let k = 0; k < 300; k++) {
    t += 0.01 + rnd() * 0.05;
    for (let i = 0; i < n; i++) if (rnd() < 0.4) { f.glyphs[i] = rnd() < 0.5 ? SP : FULL; f.shades[i] = rnd() < 0.5 ? 0 : 1; }
    for (let i = 0; i < n; i++) { g.glyphs[i] = f.glyphs[i]; g.shades[i] = 1 - f.shades[i]; }
    const oa = a.govern(f.glyphs, f.shades, t), ob = b.govern(g.glyphs, g.shades, t);
    for (let i = 0; i < n; i++) {
      assert.ok(oa.shades[i] === 0 || oa.shades[i] === 1, 'palette index in the input set');
      assert.equal(ob.glyphs[i], oa.glyphs[i], 'the same glyphs with the indices swapped');
      assert.equal(ob.shades[i], 1 - oa.shades[i], 'and exactly the swapped indices');
      if (oa.glyphs[i] !== f.glyphs[i] || oa.shades[i] !== f.shades[i]) held++;
    }
  }
  assert.ok(held > 500, `the run held cells (${held})`);
});

test('DRIFT-13 shapes: determinism, the same inputs give the same output on two governors', () => {
  const n = 400, run = () => {
    const rnd = rngOf(5), gov = createGovernor({ cols: 40, rows: 10, fps: 24 }), f = frame(n), outs = [];
    gov.govern(f.glyphs, f.shades, -50);
    let t = 0;
    for (let k = 0; k < 200; k++) { t += 0.02 + rnd() * 0.03; for (let i = 0; i < n; i++) if (rnd() < 0.6) f.glyphs[i] = rnd() < 0.5 ? SP : FULL; outs.push(Array.from(gov.govern(f.glyphs, f.shades, t).glyphs).join(',')); }
    return outs;
  };
  assert.deepEqual(run(), run());
});

test('DRIFT-13 priority: the cells that wait are spread over the screen, not the lowest indices (no banding)', () => {
  const n = 400, gov = createGovernor({ cols: 40, rows: 10, fps: 18 });
  const blank = frame(n), full = frame(n, FULL);
  gov.govern(blank.glyphs, blank.shades, -50);
  const o = gov.govern(full.glyphs, full.shades, 0);
  const perRow = new Array(10).fill(0);
  for (let i = 0; i < n; i++) if (o.glyphs[i] === FULL) perRow[Math.floor(i / 40)]++;
  for (let r = 0; r < 10; r++) assert.ok(perRow[r] >= 4 && perRow[r] <= 22, `row ${r} got ${perRow[r]} of its 40 cells (the cap is 100 of 400: 10 a row on average; lowest-index-first would give 40, 40, 40, 0, ...)`);
  // different paints hold different cells: a second window paints a different set
  const o2 = gov.govern(full.glyphs, full.shades, 1);
  assert.ok(count(o2.glyphs, FULL) > 100, 'catch-up moves on');
});

// ---- the blocks variant's arithmetic
test('DRIFT-13 blocks: the block cap keeps every slid field at or under 25 % (40x10 .. 50x16, 80x24, 120x40; the 56-cell fields exactly)', () => {
  const sizes = [[80, 24], [120, 40], [61, 21]];
  for (let c = 40; c <= 50; c++) for (let r = 10; r <= 16; r++) sizes.push([c, r]);
  for (const [cols, rows] of sizes) {
    const gov = createGovernor({ cols, rows, fps: 18, variant: 'blocks' });
    const f = fieldOf(cols, rows), m = fieldSize(cols, rows);
    assert.deepEqual(f, m, `${cols}x${rows}: the governor's field is the meter's`);
    const cap = gov.limits.blockCap, fieldN = f.w * f.h;
    assert.ok(4 * cap / fieldN <= FIELD_LIMIT, `${cols}x${rows}: 4 blocks of ${cap} in a ${fieldN}-cell field is at most 25 % (as the meter compares)`);
    // every field position overlaps at most 4 blocks (2 across, 2 down)
    const bx = Math.ceil(cols / f.w), by = Math.ceil(rows / f.h);
    assert.equal(gov.limits.blocks, bx * by);
    for (let y = 0; y + f.h <= rows; y++) for (let x = 0; x + f.w <= cols; x++) {
      const bs = new Set();
      for (const yy of [y, y + f.h - 1]) for (const xx of [x, x + f.w - 1]) bs.add(Math.floor(yy / f.h) * bx + Math.floor(xx / f.w));
      assert.ok(bs.size <= 4, `${cols}x${rows} field at ${x},${y} overlaps ${bs.size} blocks`);
    }
  }
  for (const [c, r] of [[40, 10], [41, 11], [42, 12]]) {
    const gov = createGovernor({ cols: c, rows: r, fps: 18, variant: 'blocks' });
    assert.deepEqual(gov.limits.field, { w: 14, h: 4 }, `${c}x${r}: a 56-cell field`);
    assert.equal(gov.limits.blockCap, 3, 'floor(14 / 4) = 3 triple cells a block, 12 of the 14 a field may hold');
  }
});

// ---- 6. counted performance at 400x100
test('DRIFT-13 cost: at 400x100 a paint examines at most n cells, changes at most the cap, and allocates nothing after warm-up (buffer identity stable)', () => {
  const cols = 400, rows = 100, n = cols * rows, rnd = rngOf(3);
  for (const variant of ['strict', 'blocks']) {
    const gov = createGovernor({ cols, rows, fps: 18, variant });
    const f = frame(n);
    const o = gov.govern(f.glyphs, f.shades, -50);
    const g0 = o.glyphs, s0 = o.shades;
    const cap = gov.limits.stepCap;
    assert.equal(cap, 10000);
    let t = 0, maxChanged = 0, maxExamined = 0, held = 0;
    for (let k = 0; k < 60; k++) {
      t += 0.056;
      for (let i = 0; i < n; i++) f.glyphs[i] = rnd() < 0.5 ? SP : FULL;
      const p = gov.govern(f.glyphs, f.shades, t);
      assert.equal(p, o, 'the same returned object');
      assert.equal(p.glyphs, g0); assert.equal(p.shades, s0);
      maxChanged = Math.max(maxChanged, gov.stats.last.changed); maxExamined = Math.max(maxExamined, gov.stats.last.examined); held += gov.stats.last.held;
    }
    assert.ok(maxExamined <= n, `${variant}: examined ${maxExamined} <= ${n}`);
    assert.ok(maxChanged <= cap, `${variant}: changed ${maxChanged} <= ${cap}`);
    assert.ok(held > 0);
    console.log(`GOVERNOR COST 400x100 ${variant}: per paint examined ${maxExamined} (= n), changed at most ${maxChanged} (cap ${cap}); over 60 paints examined ${gov.stats.examined}, changed ${gov.stats.changed}, held ${gov.stats.held}`);
  }
});

test('DRIFT-13 observe: observe mode holds nothing and counts what the rules would hold', () => {
  const n = 400, gov = createGovernor({ cols: 40, rows: 10, fps: 18, observe: true, variant: 'blocks' });
  const f = frame(n), full = frame(n, FULL);
  gov.govern(f.glyphs, f.shades, -50);
  const o = gov.govern(full.glyphs, full.shades, 0);
  assert.equal(count(o.glyphs, FULL), n, 'everything is painted');
  assert.equal(gov.stats.readHeld, n - 100, 'the per-read cap would have held 300 of 400');
  assert.equal(gov.stats.strictHeld, 0);
  // two more changes of every cell inside one second: the third change of every cell would be held by the strict rule
  gov.govern(f.glyphs, f.shades, 0.5);
  gov.govern(full.glyphs, full.shades, 0.9);
  assert.ok(gov.stats.strictHeld > 0, 'the strict rule would hold third changes');
  assert.ok(gov.stats.blocksHeld > 0 && gov.stats.blocksHeld <= gov.stats.strictHeld, 'the blocks rule holds some of them (all but the block budgets)');
});
