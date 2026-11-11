// DRIFT-4: scene V, Highcandle at Dusk. The storyboard's promises, read off rendered frames:
//   - the dusk deepens one shade at a time (three steps, at 6, 12 and 18 s), each cell at its own moment, so the sky never jumps
//   - stars appear one at a time; windows light in a stated order (a seeded shuffle of the city's windows), never faster than one every
//     0.4 s, each warming through three steps; three Gloamcrows glide a column per 0.3 s
//   - the Great Lamp stays dark until 58 s, then rises to full gold over 3 s with a halo one shade brighter within five columns
//   - the tallest tower is in the middle; no banned glyph; calm frame to frame at three sizes
import test from 'node:test';
import assert from 'node:assert/strict';
import highcandle, {
  layoutOf, buildingsOf, windowsOf, windowCountAt, warmth, lampLevel,
  SKY_STEP, STAR_FROM, STAR_EVERY, STAR_MAX, WINDOW_FROM, WINDOW_EVERY, WINDOW_WARM, WINDOW_MAX, LAMP_AT, LAMP_RISE, CROW_STEP,
} from '../cartridges/delza/scenes/highcandle.js';
import { renderScene } from '../src/cells.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { DUSK, EMBER, GOLD, BARK, STONE, PARCH, brighter } from '../cartridges/delza/lib/palette.js';

const cp = (ch) => ch.codePointAt(0);
const BANNED = [0x25cd, 0x25ce, 0x25d1, 0x25e2, 0x25e3, 0x222b, 0x2261];
const W = 240, H = 67;
const frameAt = (t, w = W, h = H, seed = 1) => renderScene(highcandle, t, w, h, seed);
const cells = (f, ch, col) => { const out = []; for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] === cp(ch) && (col === undefined || (Array.isArray(col) ? col.includes(f.colours[i]) : f.colours[i] === col))) out.push([i % f.cols, Math.floor(i / f.cols)]); return out; };
const at = (f, x, y) => y * f.cols + x;
const SIZES = [[240, 67], [120, 40], [80, 24]];

test('highcandle: kind cells, an id, and the numbers the storyboard gives (6 s steps, a window per 0.4 s, a crow column per 0.3 s, the lamp over 3 s)', () => {
  assert.equal(highcandle.kind, 'cells');
  assert.equal(highcandle.id, 'highcandle');
  assert.deepEqual([SKY_STEP, WINDOW_EVERY, CROW_STEP, LAMP_RISE], [6, 0.4, 0.3, 3]);
});

for (const [w, h] of SIZES) {
  test(`highcandle ${w}x${h}: no banned glyph, plenty on screen at every stage, the tallest tower stands in the middle`, () => {
    const L = layoutOf(w, h);
    for (const t of [0, 5, 10, 25, 45, 57, 61, 70]) {
      const f = frameAt(t, w, h);
      let lit = 0;
      for (let i = 0; i < f.glyphs.length; i++) { assert.ok(!BANNED.includes(f.glyphs[i])); assert.ok(isAllowedGlyph(f.glyphs[i])); if (f.glyphs[i] !== 32) lit++; }
      assert.ok(lit > w * h * 0.3 && lit < w * h * 0.9, `${lit} lit at ${t}`);
    }
    // the top of the tower is higher than every other roof
    const f = frameAt(30, w, h); // before the lamp's halo brightens the roofs
    const roofRow = (x) => { for (let y = 0; y < h; y++) { const g = f.glyphs[y * w + x]; const c = f.colours[y * w + x]; if ((g === cp('█') || g === cp('▄') || g === cp('▓') || g === cp('▲')) && (c === BARK[0] || c === STONE[0])) return y; } return h; };
    const towerTop = roofRow(L.cx);
    assert.equal(towerTop, L.base - L.towerH, 'the tower roof sits at its stated height');
    for (let x = 0; x < w; x++) if (x < L.towerX - 1 || x > L.towerX + L.towerW) assert.ok(roofRow(x) > towerTop, `column ${x} is lower than the tower`);
    assert.equal(f.glyphs[(L.base - L.towerH - 1) * w + L.cx], cp('○'), 'with its (dark) lamp on top');
  });
}

test('highcandle sky: three bands, each cell steps one shade darker at its own moment inside a 4 s window of each 6 s step, three steps in all', () => {
  const band = (t, fam, ch) => {
    const f = frameAt(t);
    const shades = new Map();
    for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] === cp(ch) && fam.includes(f.colours[i])) shades.set(fam.indexOf(f.colours[i]), (shades.get(fam.indexOf(f.colours[i])) || 0) + 1);
    return shades;
  };
  // violet on top (starts at shade 2), ember in the middle and gold at the horizon (both start at shade 3)
  assert.deepEqual([...band(0.5, DUSK, '░').keys()], [2], 'violet starts at shade 2');
  assert.deepEqual([...band(0.5, EMBER, '▒').keys()], [3]);
  assert.deepEqual([...band(0.5, GOLD, '▓').keys()], [3]);
  assert.deepEqual([...band(30, DUSK, '░').keys()], [0], 'after 18 s the violet is at its darkest');
  assert.deepEqual([...band(30, EMBER, '▒').keys()], [0]);
  // inside a window both neighbouring shades are present, never three at once
  for (const t of [7, 13, 19]) {
    const shades = [...band(t, EMBER, '▒').keys()].sort();
    assert.ok(shades.length === 2 && shades[1] - shades[0] === 1, `ember at ${t} s: ${shades}`);
  }
  assert.deepEqual([...band(10, EMBER, '▒').keys()], [2], 'between the windows the whole band is at one shade (10 s)');
});

for (const [w, h] of SIZES) {
  test(`highcandle ${w}x${h}: no brightness jump - from one frame to the next at most 2.5% of the screen changes over 75 s, at its most when the dusk is turning`, () => {
    let prev = null, worst = 0, worstT = 0;
    for (let k = 0; k < 75 * 18; k++) {
      const f = frameAt(k / 18, w, h);
      if (prev) { let c = 0; for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] !== prev.g[i] || f.colours[i] !== prev.c[i]) c++; if (c / f.glyphs.length > worst) { worst = c / f.glyphs.length; worstT = k / 18; } }
      prev = { g: f.glyphs.slice(), c: f.colours.slice() };
    }
    assert.ok(worst < 0.025, `worst frame changed ${(worst * 100).toFixed(2)}% at ${worstT.toFixed(2)} s`);
    assert.ok(worst > 0.003);
  });
}

test('highcandle control: a sky that steps all at once (no per-cell moment) would break the same bound', () => {
  // the whole sky above the street on one shade, flipping at 6 s: a single frame changes far more than 2.5%
  const sky = Object.assign((t, w, h, p) => { p.glyphs.fill(32); p.colours.fill(0); for (let y = 0; y < Math.floor(h * 0.7); y++) for (let x = 0; x < w; x++) { p.glyphs[y * w + x] = cp('░'); p.colours[y * w + x] = t < 6 ? DUSK[2] : DUSK[1]; } }, { id: 'jump' });
  const a = renderScene(sky, 5.97, W, H), b = renderScene(sky, 6.03, W, H);
  let c = 0; for (let i = 0; i < a.glyphs.length; i++) if (a.colours[i] !== b.colours[i]) c++;
  assert.ok(c / a.glyphs.length > 0.5, 'the jumping sky changes most of the screen in one frame');
});

test('highcandle stars: none before 4 s, then one more every 1.5 s, up to 24, always in the dark upper sky', () => {
  const stars = (t) => cells(frameAt(t), '·', PARCH[2]);
  assert.equal(stars(STAR_FROM - 0.1).length, 0);
  for (let k = 0; k < 8; k++) assert.equal(stars(STAR_FROM + k * STAR_EVERY + 0.1).length, k + 1, `star ${k + 1}`);
  const full = stars(STAR_FROM + 40 * STAR_EVERY);
  assert.equal(full.length, STAR_MAX);
  const L = layoutOf(W, H);
  assert.ok(full.every(([, y]) => y < L.base * 0.4), 'in the violet band');
  // each earlier star is still where it was
  const a = new Set(stars(10).map((c) => c.join())), b = new Set(stars(20).map((c) => c.join()));
  assert.ok([...a].every((k) => b.has(k)));
});

test('highcandle windows: a seeded order, one more lit every 0.4 s from 7 s, never two at once, each warming dark - gold in three steps of 0.2 s, 80 at most', () => {
  const wins = windowsOf(W, H, 1);
  assert.ok(wins.length > 40 && wins.length <= WINDOW_MAX, `${wins.length} windows`);
  assert.equal(new Set(wins.map((w) => w.x + ',' + w.y)).size, wins.length, 'no window twice');
  const lit = (t) => { const f = frameAt(t); return cells(f, '▪', [GOLD[1], GOLD[2], GOLD[3]]).map((c) => c.join()); };
  assert.equal(lit(WINDOW_FROM - 0.1).length, 0, 'dark before 7 s');
  // the lit ones are exactly the first n of the order
  for (const t of [7.05, 8.5, 12.3, 20.1, 30.7, 45]) {
    const n = windowCountAt(t, wins.length);
    const want = wins.slice(0, n).map((w) => w.x + ',' + w.y).sort();
    assert.deepEqual(lit(t).sort(), want, `at ${t} s the first ${n} are lit`);
  }
  // never faster than one per 0.4 s: in any 0.4 s no more than one new window
  let prevN = 0;
  for (let t = 6; t < 60; t += 0.1) {
    const n = windowCountAt(t, wins.length);
    assert.ok(n >= prevN && n - windowCountAt(t - 0.4, wins.length) <= 1, `at ${t.toFixed(1)} s`);
    prevN = n;
  }
  assert.equal(windowCountAt(WINDOW_FROM, 100), 1);
  assert.equal(windowCountAt(WINDOW_FROM + 0.4, 100), 2);
  assert.equal(windowCountAt(1000, 100), 100);
  // a window's three warming steps, read off the picture
  const w0 = wins[0];
  const colourAt = (age) => { const f = frameAt(WINDOW_FROM + age); return f.colours[at(f, w0.x, w0.y)]; };
  assert.equal(colourAt(-0.05), BARK[1]);
  assert.equal(colourAt(0.05), GOLD[1]);
  assert.equal(colourAt(WINDOW_WARM + 0.05), GOLD[2]);
  assert.equal(colourAt(2 * WINDOW_WARM + 0.05), GOLD[3]);
  assert.deepEqual([-1, 0, 0.19, 0.2, 0.4, 5].map(warmth), [0, 1, 1, 2, 3, 3]);
  // the whole city lit (up to 80) well before the lamp; the rest of the windows stay dark
  assert.ok(WINDOW_FROM + WINDOW_MAX * WINDOW_EVERY < LAMP_AT);
});

test('highcandle crows: three, flying left a column every 0.3 s, wings flipping v and ^ every 0.5 s', () => {
  const crows = (t) => { const f = frameAt(t); return [...cells(f, 'v', STONE[2]), ...cells(f, '^', STONE[2])].sort((a, b) => a[0] - b[0] || a[1] - b[1]); };
  const a = crows(10.05), b = crows(10.35);
  assert.equal(a.length, 6, 'three crows, two glyphs each');
  assert.equal(b.length, 6);
  const xs = (list) => list.map(([x]) => x).sort((p, q) => p - q);
  assert.deepEqual(xs(b), xs(a).map((x) => x - 1), 'every crow a column to the left');
  // between steps they hold still
  assert.deepEqual(xs(crows(10.15)), xs(a));
  // wings: the glyph of one crow differs half a second later
  const glyphOf = (t) => { const f = frameAt(t); return [cells(f, 'v', STONE[2]).length, cells(f, '^', STONE[2]).length]; };
  const g0 = glyphOf(20.05), g1 = glyphOf(20.55);
  assert.notDeepEqual(g0, g1, 'wings flipped');
  assert.equal(g0[0] + g0[1], 6);
});

test('highcandle lamp: dark until 58 s, then six steps to full gold over 3 s; the halo lifts every cell within five columns one shade', () => {
  const L = layoutOf(W, H);
  const lampY = L.base - L.towerH - 1;
  const lamp = (t) => { const f = frameAt(t); return { g: f.glyphs[at(f, L.cx, lampY)], c: f.colours[at(f, L.cx, lampY)] }; };
  assert.deepEqual(lamp(30), { g: cp('○'), c: STONE[1] });
  assert.deepEqual(lamp(LAMP_AT - 0.05), { g: cp('○'), c: STONE[1] });
  const seen = [];
  for (let k = 0; k < 6; k++) seen.push(lamp(LAMP_AT + (k + 0.5) * (LAMP_RISE / 6)));
  assert.ok(seen.every((s) => s.g === cp('●')));
  const cols = seen.map((s) => s.c);
  assert.equal(cols[5], GOLD[3]);
  assert.ok(cols[0] === GOLD[0] && cols.every((c, i) => i === 0 || c >= cols[i - 1]), `a rising ramp ${cols}`);
  assert.equal(lampLevel(LAMP_AT - 1), 0);
  assert.equal(lampLevel(LAMP_AT + LAMP_RISE + 1), 6);
  assert.deepEqual(lamp(75), { g: cp('●'), c: GOLD[3] }, 'and it stays lit');
  // the halo: a frame at 50 s (everything else done) against one at 65 s, apart from the crows, the lamp and the cells of the halo
  const before = frameAt(50), after = frameAt(65);
  const crow = (f, i) => (f.glyphs[i] === cp('v') || f.glyphs[i] === cp('^')) && f.colours[i] === STONE[2];
  let inside = 0, brighterCells = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = at(before, x, y);
      if (crow(before, i) || crow(after, i) || (x === L.cx && y === lampY)) continue;
      const dx = (x - L.cx) / 5, dy = (y - lampY) / 2.5;
      if (dx * dx + dy * dy <= 1 && before.glyphs[i] !== 32) {
        inside++;
        assert.equal(after.glyphs[i], before.glyphs[i]);
        assert.equal(after.colours[i], brighter(before.colours[i], 1), `halo cell (${x},${y})`);
        if (after.colours[i] !== before.colours[i]) brighterCells++;
      } else assert.deepEqual([after.glyphs[i], after.colours[i]], [before.glyphs[i], before.colours[i]], `outside the halo (${x},${y}) is unchanged`);
    }
  }
  assert.ok(inside > 30 && brighterCells > 20, `${inside} halo cells, ${brighterCells} brighter`);
});

test('highcandle: the order is deterministic, the seed changes the skyline, windows and stars, and tiny windows do not throw', () => {
  assert.deepEqual(Array.from(frameAt(33.3).glyphs), Array.from(frameAt(33.3).glyphs));
  assert.notDeepEqual(Array.from(frameAt(33.3, 120, 40, 1).glyphs), Array.from(frameAt(33.3, 120, 40, 2).glyphs));
  assert.notDeepEqual(windowsOf(120, 40, 1).map((w) => w.x), windowsOf(120, 40, 2).map((w) => w.x));
  assert.notDeepEqual(buildingsOf(120, 40, 1).map((b) => b.h), buildingsOf(120, 40, 2).map((b) => b.h));
  for (const [w, h] of [[0, 0], [1, 1], [3, 3], [12, 8], [2, 200], [200, 2]]) assert.doesNotThrow(() => frameAt(40, w, h), `${w}x${h}`);
});
