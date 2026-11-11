// DRIFT-4: scene IV, Across the Reach (the map). The storyboard's promises, read off rendered frames:
//   - the features: Thornwell Wood (leaf triangles), Hollowmere (waves), Lowmarrow (houses), mountains and a river, Highcandle (a castle
//     with a gold diamond), a compass with N S E W, a cartouche, a scroll rod down each side
//   - a dotted route drawn one dot every 0.3 s with a gold marker at its head; the marker rests 2 s at each landmark and the label fades up
//     over 0.5 s; three cloud shadows drift a column per 1.5 s; fog ahead of the marker thins away; the route is taken up and redrawn every 90 s
//   - no banned glyph, calm frame to frame, the same map at 80x24, 120x40 and 240x67
import test from 'node:test';
import assert from 'node:assert/strict';
import reach, { routeOf, headAt, labelColour, layoutOf, N_DOTS, DOT_EVERY, PAUSE, START, CYCLE, RETURN, CLOUD_STEP, FOG_LEAD, LANDMARKS, TITLE } from '../cartridges/delza/scenes/reach.js';
import { renderScene } from '../src/cells.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { LEAF, STONE, PARCH, GOLD, DIM, MOSS } from '../cartridges/delza/lib/palette.js';

const cp = (ch) => ch.codePointAt(0);
const BANNED = [0x25cd, 0x25ce, 0x25d1, 0x25e2, 0x25e3, 0x222b, 0x2261];
const frameAt = (t, w = 240, h = 67, seed = 1) => renderScene(reach, t, w, h, seed);
const cells = (f, ch, col) => { const out = []; for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] === cp(ch) && (col === undefined || (Array.isArray(col) ? col.includes(f.colours[i]) : f.colours[i] === col))) out.push([i % f.cols, Math.floor(i / f.cols)]); return out; };
const rowText = (f, y) => String.fromCodePoint(...f.glyphs.slice(y * f.cols, (y + 1) * f.cols));
const allText = (f) => Array.from({ length: f.rows }, (_, y) => rowText(f, y)).join('\n');
const SIZES = [[240, 67], [120, 40], [80, 24]];

test('reach: kind cells, an id, and the numbers the storyboard gives (a dot every 0.3 s, 2 s at each landmark, a cloud step of 1.5 s, redrawn every 90 s)', () => {
  assert.equal(reach.kind, 'cells');
  assert.equal(reach.id, 'reach');
  assert.deepEqual([DOT_EVERY, PAUSE, CLOUD_STEP, CYCLE], [0.3, 2, 1.5, 90]);
  assert.deepEqual(LANDMARKS, ['Lowmarrow', 'Thornwell Wood', 'Hollowmere', 'Highcandle']);
});

for (const [w, h] of SIZES) {
  test(`reach ${w}x${h}: once the route is done every map feature is on the paper and no banned glyph is used`, () => {
    const R = routeOf(w, h);
    const f = frameAt(R.leave[3] + 3, w, h);
    const text = allText(f);
    assert.ok(text.includes(TITLE), 'the cartouche');
    for (const name of LANDMARKS) assert.ok(text.includes(name), name);
    assert.ok(cells(f, '▲', LEAF).length >= (w >= 200 ? 60 : 12), `Thornwell Wood: ${cells(f, '▲', LEAF).length} leaf triangles`);
    assert.ok(cells(f, '≈', STONE).length >= (w >= 200 ? 60 : 12), 'Hollowmere waves');
    assert.ok(cells(f, '■').length >= 2 && cells(f, '▪').length >= 1, 'Lowmarrow houses');
    assert.ok(cells(f, '▟').length >= 3 && cells(f, '▙').length >= 3, 'mountains');
    assert.ok(cells(f, '▲', PARCH).length >= 3, 'snowy peaks');
    assert.ok(cells(f, '╲', STONE).length + cells(f, '╱', STONE).length >= (w >= 200 ? 8 : 3), 'the river');
    const castle = cells(f, '◆', GOLD[3]);
    assert.equal(castle.length, 1, 'Highcandle has one gold diamond');
    assert.ok(text.includes('▟█▙') && text.includes('▐███▌'), 'and a castle under it');
    assert.ok(text.includes('W←┼→E') && text.includes('↑') && text.includes('↓'), 'the compass');
    assert.ok(/\bN\b/.test(text) && /\bS\b/.test(text), 'with N and S');
    // scroll rods: ▐█▌ down the left edge, the same down the right
    for (const y of [3, Math.floor(h / 2), h - 3]) {
      assert.equal(rowText(f, y).slice(0, 3), '▐█▌');
      assert.equal(rowText(f, y).slice(-3), '▐█▌');
    }
    for (let i = 0; i < f.glyphs.length; i++) { assert.ok(!BANNED.includes(f.glyphs[i]), `banned U+${f.glyphs[i].toString(16)}`); assert.ok(isAllowedGlyph(f.glyphs[i])); }
  });
}

test('reach route: one dot every 0.3 s from Lowmarrow (after its 2 s rest), a gold marker at the head', () => {
  const R = routeOf(240, 67);
  assert.equal(new Set(R.dots.map((d) => d.x + ',' + d.y)).size, R.dots.length, 'at this size no two dots share a cell');
  const dotsAt = (t) => cells(frameAt(t), '·', PARCH[2]).length;
  const marker = (t) => cells(frameAt(t), '●', GOLD[3]);
  assert.equal(marker(0.5).length, 0, 'nothing before the route begins');
  const t0 = R.leave[0];
  for (let k = 0; k <= 12; k++) {
    const t = t0 + k * DOT_EVERY + 0.05;
    assert.equal(dotsAt(t), k, `${k} dots behind the marker at ${t.toFixed(2)} s`);
    const m = marker(t);
    assert.equal(m.length, 1, 'one marker');
    assert.deepEqual(m[0], [R.dots[k].x, R.dots[k].y], 'at the head of the route');
  }
});

test('reach landmarks: the marker rests 2 s at each of the four, then moves on; the route ends at Highcandle', () => {
  const R = routeOf(240, 67);
  const at = (t) => { const m = cells(frameAt(t), '●', GOLD[3]); assert.equal(m.length, 1, `marker at ${t}`); return m[0].join(','); };
  for (let j = 0; j < 4; j++) {
    assert.ok(Math.abs(R.leave[j] - R.arrive[j] - PAUSE) < 1e-9);
    assert.equal(at(R.arrive[j] + 0.05), at(R.leave[j] - 0.05), `rests at ${LANDMARKS[j]}`);
    assert.deepEqual(at(R.arrive[j] + 0.05).split(',').map(Number), [R.dots[R.ks[j]].x, R.dots[R.ks[j]].y]);
    if (j < 3) assert.notEqual(at(R.leave[j] + DOT_EVERY * 2 + 0.05), at(R.leave[j] - 0.05), 'and moves on after');
  }
  assert.equal(headAt(R, R.leave[3] + 5).n, N_DOTS);
  assert.deepEqual(at(R.leave[3] + 5).split(',').map(Number), [R.lm[3].x, R.lm[3].y], 'the route ends at Highcandle');
  assert.equal(R.ks[0], 0);
  assert.ok(R.ks.every((k, j) => j === 0 || k > R.ks[j - 1]), 'the landmarks come in order along the route');
});

test('reach labels: dim until the marker arrives, then up to the text colour over 0.5 s', () => {
  const R = routeOf(240, 67);
  for (let j = 0; j < 4; j++) {
    const name = LANDMARKS[j];
    const colourAt = (t) => {
      const f = frameAt(t);
      for (let y = 0; y < f.rows; y++) { const x = rowText(f, y).indexOf(' ' + name + ' '); if (x >= 0) return f.colours[y * f.cols + x + 1]; }
      return -1;
    };
    assert.equal(colourAt(R.arrive[j] - 0.1), DIM, `${name} before`);
    assert.equal(colourAt(R.arrive[j] + 0.01), DIM, `${name} at the instant`);
    const mid = colourAt(R.arrive[j] + 0.3);
    assert.ok(mid === PARCH[1] || mid === PARCH[2], `${name} half way is neither dim nor full (${mid})`);
    assert.equal(colourAt(R.arrive[j] + 0.6), PARCH[3], `${name} after`);
  }
  assert.deepEqual([0, 0.15, 0.3, 0.4, 0.5, 2].map(labelColour), [DIM, PARCH[1], PARCH[2], PARCH[3], PARCH[3], PARCH[3]]);
  assert.equal(labelColour(-1), DIM);
});

test('reach clouds: three shadows of light moss, a column to the right every 1.5 s, holding still in between', () => {
  // cells a grain speck or a label already holds are skipped, so compare each cloud's centre of mass rather than its exact cells
  const centres = (t) => {
    const cs = cells(frameAt(t), '░', MOSS[0]);
    const clumps = [[], [], []];
    for (const [x, y] of cs) clumps[y < 30 ? 0 : x < 150 ? 1 : 2].push([x, y]);
    return clumps.map((c) => ({ n: c.length, x: c.reduce((a, [x]) => a + x, 0) / c.length, y: c.reduce((a, [, y]) => a + y, 0) / c.length }));
  };
  const a = centres(40.1), hold = centres(40.4), b = centres(41.6), c = centres(43.1), d = centres(46.1);
  a.forEach((cl, k) => {
    assert.ok(cl.n >= 12, `cloud ${k} has ${cl.n} cells`);
    assert.ok(Math.abs(hold[k].x - cl.x) < 0.5, `cloud ${k} holds still inside a 1.5 s step`);
    assert.ok(b[k].x - cl.x > 0.3 && b[k].x - cl.x < 1.9, `cloud ${k} moved ${(b[k].x - cl.x).toFixed(2)} columns to the right`);
    assert.ok(c[k].x > b[k].x && d[k].x - cl.x > 3.3 && d[k].x - cl.x < 4.7, `and four columns in 6 s (${(d[k].x - cl.x).toFixed(2)})`);
    assert.ok(Math.abs(b[k].y - cl.y) < 0.5, 'level');
  });
  assert.ok(a[0].y < a[1].y || a[0].y < a[2].y, 'the clouds sit at different heights');
});

test('reach fog: lies ahead of the marker only, thins as it comes, and never comes back before the redraw', () => {
  const fog = (t) => cells(frameAt(t), '░', STONE[0]);
  const R = routeOf(240, 67);
  const counts = [2, 8, 14, 22, 30].map((t) => fog(t).length);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] < counts[i - 1], `fog thins: ${counts}`);
  assert.ok(counts[0] > 300 && counts[4] < counts[0] * 0.2, 'from a lot to little');
  for (const t of [5, 12, 20]) {
    const mx = R.dots[headAt(R, t).n].x;
    const f = fog(t);
    assert.ok(f.every(([x]) => x > mx), `t=${t}: no fog behind the marker (column ${mx})`);
    assert.ok(f.some(([x]) => x > mx + FOG_LEAD + 2), 'plenty ahead');
  }
});

test('reach redraw: every 90 s the route is taken up over 5 s (dots and fog sweep back) and begins again', () => {
  const R = routeOf(240, 67);
  const dots = (t) => cells(frameAt(t), '·', PARCH[2]).length;
  const full = dots(CYCLE - RETURN - 1);
  assert.ok(full >= N_DOTS - 2, `${full} dots at the end of a run`);
  const mid = dots(CYCLE - RETURN / 2);
  assert.ok(mid > 0 && mid < full, `${mid} dots half way back`);
  assert.ok(dots(CYCLE + 0.5) <= 1 && cells(frameAt(CYCLE + 0.5), '●', GOLD[3]).length === 0, 'then a clean map');
  assert.ok(dots(CYCLE + R.leave[0] + 2 * DOT_EVERY + 0.05) === 2, 'and the second run draws the same way');
  const route = (t) => cells(frameAt(t), '·', PARCH[2]).map((c) => c.join()).sort().join(' ');
  assert.equal(route(12.3), route(12.3 + CYCLE), 'the second run draws the same route');
});

for (const [w, h] of SIZES) {
  test(`reach ${w}x${h}: calm - from one frame to the next at most 2.5% of the screen changes over 90 s (the redraw included), and it does move`, () => {
    let prev = null, worst = 0;
    for (let k = 0; k < 90 * 18; k++) {
      const f = frameAt(k / 18, w, h);
      if (prev) { let c = 0; for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] !== prev.g[i] || f.colours[i] !== prev.c[i]) c++; worst = Math.max(worst, c / f.glyphs.length); }
      prev = { g: f.glyphs.slice(), c: f.colours.slice() };
    }
    assert.ok(worst < 0.025, `worst frame changed ${(worst * 100).toFixed(2)}%`);
    assert.ok(worst > 0.001);
  });
}

test('reach: the seed changes the trees, the grain and the fog; different moments differ; layout survives tiny windows', () => {
  assert.notDeepEqual(Array.from(frameAt(20, 120, 40, 1).glyphs), Array.from(frameAt(20, 120, 40, 2).glyphs));
  assert.notDeepEqual(Array.from(frameAt(2).glyphs), Array.from(frameAt(40).glyphs));
  for (const [w, h] of [[0, 0], [1, 1], [3, 3], [12, 8], [20, 6], [2, 200]]) assert.doesNotThrow(() => frameAt(33, w, h), `${w}x${h}`);
  assert.equal(layoutOf(80, 24).ok, true);
  assert.equal(layoutOf(10, 5).ok, false);
});
