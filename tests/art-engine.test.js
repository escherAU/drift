// DRIFT-2 S4: the artist's engine (src/art/engine.js) on synthetic pieces: parsing, stroke
// order, and the monotonic draw / erase frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePiece, pieceToText, buildPlan, strokeOrder, paintPiece, isOutlineGlyph, baseLevel, FADE_SEC, MIN_DRAW_SEC, MAX_DRAW_SEC } from '../src/art/engine.js';

const SAMPLE = 'title: Box\n---\n\n   ┌──┐   \n   │▓▓│\n   └──┘\n\n';

test('parse: title, the --- line, bounding box crop, trailing spaces', () => {
  const p = parsePiece(SAMPLE);
  assert.equal(p.title, 'Box');
  assert.equal(p.width, 4);
  assert.equal(p.height, 3);
  assert.equal(p.cells.length, 12);
  assert.deepEqual(p.cells[0], { x: 0, y: 0, cp: 0x250c });
  assert.equal(pieceToText(p), '┌──┐\n│▓▓│\n└──┘');
});

test('parse: CRLF files give the same piece as LF files', () => {
  const lf = parsePiece(SAMPLE);
  const crlf = parsePiece(SAMPLE.replace(/\n/g, '\r\n'));
  assert.deepEqual(crlf, lf);
});

test('parse: a missing title or --- is an error; an empty drawing is a 0x0 piece', () => {
  assert.throws(() => parsePiece('Box\n---\nx'), /title/);
  assert.throws(() => parsePiece('title: Box\nx\n'), /---/);
  const e = parsePiece('title: Empty\n---\n   \n');
  assert.equal(e.cells.length, 0);
  assert.equal(e.width, 0);
});

const SHAPES = parsePiece([
  'title: Shapes', '---',
  '  /\\      ##',
  ' /  \\     ##',
  '/____\\       ',
  '      .  o  ',
  '░▒▓██▓▒░',
].join('\n'));

test('outline glyphs are line characters; fills are the rest', () => {
  for (const ch of '/\\|_-()') assert.ok(isOutlineGlyph(ch.codePointAt(0)), ch);
  for (const cp of [0x2500, 0x2554, 0x2584, 0x258c, 0x2590, 0x25e2]) assert.ok(isOutlineGlyph(cp), cp.toString(16));
  for (const cp of [0x2588, 0x2591, 0x2593, 0x2800, 0x28ff, 0x3b1, 0x25cf, 0x23, 0x6f, 0x40]) assert.ok(!isOutlineGlyph(cp), cp.toString(16));
});

test('stroke order is deterministic and covers every non-blank cell exactly once', () => {
  const a = strokeOrder(SHAPES), b = strokeOrder(parsePiece(pieceToText(SHAPES).replace(/^/, 'title: Shapes\n---\n')));
  assert.deepEqual(Array.from(a.order), Array.from(b.order));
  assert.equal(a.order.length, SHAPES.cells.length);
  assert.deepEqual(Array.from(a.order).sort((x, y) => x - y), SHAPES.cells.map((_, k) => k));
});

test('stroke order: outlines before fills; the pen walks along a line (neighbouring cells follow each other)', () => {
  const { order, lifts } = strokeOrder(SHAPES);
  const outlineCount = SHAPES.cells.filter((c) => isOutlineGlyph(c.cp)).length;
  order.forEach((k, j) => assert.equal(isOutlineGlyph(SHAPES.cells[k].cp), j < outlineCount, `cell ${j}`));
  // the triangle's roof is traced as one stroke: every step from its second cell on is a pen move to a neighbour
  let steps = 0, adjacent = 0;
  for (let j = 1; j < order.length; j++) {
    if (lifts[j]) continue;
    steps++;
    const p = SHAPES.cells[order[j - 1]], q = SHAPES.cells[order[j]];
    if (Math.abs(p.x - q.x) <= 1 && Math.abs(p.y - q.y) <= 1) adjacent++;
  }
  assert.equal(adjacent, steps, 'every move that is not a lift goes to a neighbouring cell');
  assert.ok(lifts.some((l) => l === 1), 'separate shapes need pen lifts');
});

test('plan: ranks invert the order, times rise along the route, draw time is clamped, the plan is cached', () => {
  const plan = buildPlan(SHAPES);
  assert.equal(buildPlan(SHAPES), plan);
  for (let j = 0; j < plan.order.length; j++) assert.equal(plan.rank[plan.order[j]], j);
  for (let j = 1; j < plan.order.length; j++) assert.ok(plan.at[plan.order[j]] > plan.at[plan.order[j - 1]]);
  assert.equal(plan.at[plan.order[0]], 0);
  assert.ok(plan.at[plan.order[plan.order.length - 1]] < 1);
  assert.ok(plan.drawSec >= MIN_DRAW_SEC && plan.drawSec <= MAX_DRAW_SEC);
  assert.equal(baseLevel(0x2588) > baseLevel(0x2591), true);
});

function frame(piece, phase, sec, erase = 4) {
  const w = piece.width + 4, h = piece.height + 2;
  const dst = { glyphs: new Uint16Array(w * h).fill(32), colours: new Uint8Array(w * h), cols: w, x0: 2, y0: 1 };
  paintPiece(piece, phase, sec, erase, dst);
  return dst;
}
const litSet = (d) => new Set(Array.from(d.glyphs).map((g, i) => (g !== 32 ? i : -1)).filter((i) => i >= 0));

test('drawing only ADDS cells over time; the end of drawing and the hold equal the piece exactly', () => {
  const plan = buildPlan(SHAPES);
  let prev = new Set();
  for (let sec = 0; sec <= plan.drawSec + 0.001; sec += plan.drawSec / 200) {
    const s = litSet(frame(SHAPES, 'draw', sec));
    for (const i of prev) assert.ok(s.has(i), `cell ${i} vanished at ${sec}`);
    prev = s;
  }
  const want = frame(SHAPES, 'hold', 0);
  assert.equal(want.glyphs.filter((g) => g !== 32).length, SHAPES.cells.length);
  assert.deepEqual(Array.from(frame(SHAPES, 'draw', plan.drawSec).glyphs), Array.from(want.glyphs));
  assert.deepEqual(Array.from(frame(SHAPES, 'hold', 8).glyphs), Array.from(want.glyphs));
  // the hold has settled to the base brightness
  const held = frame(SHAPES, 'hold', FADE_SEC + 0.01);
  SHAPES.cells.forEach((cell, k) => assert.equal(held.colours[(1 + cell.y) * held.cols + 2 + cell.x], plan.base[k]));
});

test('the pen is the brightest cell and fresh strokes fade to the base brightness', () => {
  const plan = buildPlan(SHAPES);
  const f = frame(SHAPES, 'draw', plan.drawSec * 0.5);
  const top = Math.max(...f.colours);
  assert.ok(top >= 14, `pen at ${top}`);
  assert.ok(Array.from(f.colours).some((c, i) => c > 0 && f.glyphs[i] !== 32 && c < 15));
});

for (const style of ['wipe', 'dissolve']) {
  test(`${style}: erasing only REMOVES cells, ends empty, and each step removes a bounded share`, () => {
    const E = 4, steps = 4 * 30;
    let prev = litSet(frame(SHAPES, style, 0, E));
    assert.equal(prev.size, SHAPES.cells.length, 'starts as the full piece');
    let worst = 0;
    for (let k = 1; k <= steps + 5; k++) {
      const s = litSet(frame(SHAPES, style, k / 30, E));
      for (const i of s) assert.ok(prev.has(i), `${style}: cell ${i} appeared at step ${k}`);
      worst = Math.max(worst, prev.size - s.size);
      prev = s;
    }
    assert.equal(prev.size, 0, 'empty at the end');
    assert.ok(worst <= Math.ceil(SHAPES.cells.length * 0.2), `${style}: removed ${worst} of ${SHAPES.cells.length} in one step`);
  });
}

test('wipe removes in exactly the reverse of the stroke order', () => {
  const plan = buildPlan(SHAPES);
  let prev = litSet(frame(SHAPES, 'wipe', 0, 4));
  const gone = [];
  const idxOf = (k) => (1 + SHAPES.cells[k].y) * (SHAPES.width + 4) + 2 + SHAPES.cells[k].x;
  for (let k = 1; k <= 400; k++) {
    const s = litSet(frame(SHAPES, 'wipe', k / 100, 4));
    for (const i of prev) if (!s.has(i)) gone.push(i);
    prev = s;
  }
  const want = Array.from(plan.order).reverse().map(idxOf);
  assert.deepEqual(gone, want);
});
