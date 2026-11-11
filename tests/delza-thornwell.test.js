// DRIFT-4: scene I, The Thornwell Path. The storyboard's parallax, read off rendered frames: each layer steps whole columns at its
// own pace (mist 1 per 3 s, ridge 1 per 2 s, pines 1 per 0.6 s, ground 1 per 0.3 s, near trunks 1 per 0.15 s), Orrin's frames
// alternate every 0.35 s, Pim circles the lantern, the lantern lights the cells near it one shade, a trunk comes by about every
// 15 s and a Brambleback every 40 to 60 s, and at 80x24 the far ridge is dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import thornwell, { layoutOf, MIST_STEP, RIDGE_STEP, PINE_STEP, GROUND_STEP, TRUNK_STEP } from '../cartridges/delza/scenes/thornwell.js';
import { renderScene } from '../src/cells.js';
import { BARK, MOSS, PARCH, STONE, GOLD } from '../cartridges/delza/lib/palette.js';
import { canvas, put, glow } from '../cartridges/delza/lib/canvas.js';
import { ORRIN_W, ORRIN_H } from '../cartridges/delza/lib/sprites.js';

const cp = (ch) => ch.codePointAt(0);
const W = 120, H = 40;
const L = layoutOf(W, H);
const ox = Math.round(W * 0.3) - 3, oy = L.gy + 3 - ORRIN_H;
const frameAt = (t, w = W, h = H, seed = 1) => renderScene(thornwell, t, w, h, seed);
const at = (f, x, y) => y * f.cols + x;
// a trunk cell is a solid bark block (the path is bark-coloured too, but light shade)
const isTrunk = (f, i) => (f.glyphs[i] === cp('▓') || f.glyphs[i] === cp('█')) && (f.colours[i] === BARK[0] || f.colours[i] === BARK[1]);
const nearOrrin = (x) => x >= ox - 3 && x <= ox + ORRIN_W + 8;

// Does every cell of rows y0..y1 at t2 equal the cell one column to the right at t1 (the layer moved one column left)?
// Trunk cells, Orrin's neighbourhood and the picture's edge are skipped; returns how many cells were compared.
function movedOneLeft(t1, t2, y0, y1, what) {
  const a = frameAt(t1), b = frameAt(t2);
  let compared = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i1 = at(a, x + 1, y), i2 = at(b, x, y);
      if (isTrunk(a, i1) || isTrunk(b, i2) || nearOrrin(x) || nearOrrin(x + 1)) continue;
      assert.equal(b.glyphs[i2], a.glyphs[i1], `${what}: glyph at (${x},${y}) t=${t2} vs (${x + 1},${y}) t=${t1}`);
      assert.equal(b.colours[i2], a.colours[i1], `${what}: colour at (${x},${y})`);
      compared++;
    }
  }
  return compared;
}
function holds(t1, t2, y0, y1, what) {
  const a = frameAt(t1), b = frameAt(t2);
  for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) {
    if (nearOrrin(x)) continue;
    const i = at(a, x, y);
    if (isTrunk(a, i) || isTrunk(b, i)) continue; // a trunk is the fast layer
    assert.equal(b.glyphs[i], a.glyphs[i], `${what} must hold still between ${t1} and ${t2} at (${x},${y})`);
  }
}

test('thornwell layers: the constants are the storyboard\'s (mist 3 s, ridge 2 s, pines 0.6 s, ground 0.3 s, trunks 0.15 s a column)', () => {
  assert.deepEqual([MIST_STEP, RIDGE_STEP, PINE_STEP, GROUND_STEP, TRUNK_STEP], [3, 2, 0.6, 0.3, 0.15]);
});

test('thornwell mist: the top rows move one whole column every 3 s and hold still in between', () => {
  assert.ok(movedOneLeft(0.2, 3.2, 0, 2, 'mist') > 200);
  holds(0.2, 2.9, 0, 2, 'mist');
  assert.ok(movedOneLeft(3.2, 6.2, 0, 2, 'mist') > 200, 'and again the next step');
});

test('thornwell far ridge: a row of small triangles that moves one column every 2 s', () => {
  const rows = [L.gy - 8 - 4, L.gy - 8 - 2];
  const f = frameAt(1);
  let ridge = 0;
  for (let y = rows[0]; y <= rows[1]; y++) for (let x = 0; x < W; x++) if (f.glyphs[at(f, x, y)] === cp('▲') && f.colours[at(f, x, y)] === MOSS[0]) ridge++;
  assert.ok(ridge > 20, `${ridge} ridge triangles`);
  assert.ok(movedOneLeft(0.3, 2.3, rows[0], rows[1], 'ridge') > 200);
  holds(0.3, 1.9, rows[0], rows[1], 'ridge');
});

test('thornwell pines: the mid-ground steps one column every 0.6 s, 4 to 8 rows tall, in leaf green', () => {
  assert.ok(movedOneLeft(0.7, 1.3, L.gy - 8, L.gy - 1, 'pines') > 300);
  holds(0.7, 1.15, L.gy - 8, L.gy - 1, 'pines');
  const f = frameAt(30);
  const heights = new Set();
  for (let x = 0; x < W; x++) {
    let top = -1;
    for (let y = L.gy - 1; y >= L.gy - 9; y--) { const i = at(f, x, y); if (f.glyphs[i] === cp('▲') && f.colours[i] !== MOSS[0] && !isTrunk(f, i)) top = y; }
    if (top >= 0) heights.add(L.gy - top);
  }
  assert.ok(Math.min(...heights) >= 2 && Math.max(...heights) <= 8, `pine heights ${[...heights].sort()}`);
  assert.ok(Math.max(...heights) >= 6, 'and the tall ones are tall');
});

test('thornwell ground: stones move one column every 0.3 s along the path', () => {
  assert.ok(movedOneLeft(0.35, 0.65, L.gy + 1, L.gy + 2, 'path') > 100);
  holds(0.35, 0.55, L.gy + 1, L.gy + 2, 'path');
});

test('thornwell near trunks: dark on dark, one column every 0.15 s, about one every 15 s', () => {
  const trunkX = (t) => { const f = frameAt(t); for (let x = 0; x < W; x++) if (f.glyphs[at(f, x, 0)] === cp('█') && f.colours[at(f, x, 0)] === BARK[1]) return x; return -1; };
  const x1 = trunkX(8.01), x2 = trunkX(8.16), x3 = trunkX(8.31);
  assert.ok(x1 > 0 && x2 > 0, `a trunk on screen at 8 s (${x1})`);
  assert.equal(x1 - x2, 1);
  assert.equal(x2 - x3, 1);
  // dark: every trunk cell is bark at shade 0 or 1, never brighter
  const f = frameAt(8.01);
  for (let y = 0; y < H; y++) { const i = at(f, x1, y); assert.ok([BARK[0], BARK[1]].includes(f.colours[i]), `trunk colour at row ${y}`); }
  // how many come by in 75 s: they enter on the right at a column each 0.15 s
  let entries = 0, prev = false;
  for (let t = 0; t < 75; t += 0.15) {
    const f2 = frameAt(t);
    const here = isTrunk(f2, at(f2, W - 1, 0)); // any part of a trunk in the last column; one entry per trunk, not per edge
    if (here && !prev) entries++;
    prev = here;
  }
  assert.ok(entries >= 4 && entries <= 6, `${entries} trunks in 75 s`);
});

test('thornwell Orrin: stands a third of the way across, two walking frames 0.35 s apart, Pim circles the lantern flapping every 0.25 s', () => {
  // legs row: frame A is '/  ' (a slash at the left foot), frame B is two upright strokes at columns 1 and 2
  const legs = (t) => { const f = frameAt(t); return f.glyphs[at(f, ox, oy + 3)] === cp('╱') && f.glyphs[at(f, ox + 1, oy + 3)] !== cp('│') ? 'A' : f.glyphs[at(f, ox + 1, oy + 3)] === cp('│') && f.glyphs[at(f, ox + 2, oy + 3)] === cp('│') ? 'B' : '?'; };
  assert.equal(legs(0.1), 'A');
  assert.equal(legs(0.4), 'B');
  assert.equal(legs(0.8), 'A');
  assert.equal(legs(1.1), 'B');
  assert.ok(ox / W > 0.2 && ox / W < 0.35);
  const lx = ox + 5, ly = oy;
  const pim = (t) => { const f = frameAt(t); for (let y = ly - 2; y <= ly + 2; y++) for (let x = lx - 4; x <= lx + 4; x++) { const g = f.glyphs[at(f, x, y)]; if ((g === cp('ω') || g === cp('v')) && f.colours[at(f, x, y)] === PARCH[3]) return { x: x - lx, y: y - ly, g: String.fromCodePoint(g) }; } return null; };
  const seen = new Set(), wings = [];
  for (let k = 0; k < 8; k++) { const p = pim(0.05 + k * 0.25); assert.ok(p, `Pim at beat ${k}`); seen.add(p.x + ',' + p.y); wings.push(p.g); }
  assert.equal(seen.size, 8, 'eight different places round the lantern');
  assert.deepEqual(wings, ['ω', 'v', 'ω', 'v', 'ω', 'v', 'ω', 'v']);
  assert.deepEqual(pim(0.05 + 8 * 0.25), pim(0.05), 'a full turn every 2 s');
});

test('thornwell lantern: every cell within four columns of the lantern is one shade brighter; the glow() helper does exactly that and no more', () => {
  const f = frameAt(0.1);
  // Orrin's cloak: lower-case ink is shade 2; inside the glow it is shade 3, outside it stays 2
  const cloak = (x) => f.colours[at(f, x, oy + 1)];
  assert.equal(cloak(ox + 2), STONE[3], 'cloak 3 columns from the lantern');
  assert.equal(cloak(ox), STONE[2], 'cloak 5 columns away');
  // the helper on its own
  const g = new Uint16Array(15 * 7).fill(32), c = new Uint8Array(15 * 7);
  const cv = canvas(g, c, 15, 7);
  for (let x = 0; x < 15; x++) for (let y = 0; y < 7; y++) put(cv, x, y, cp('▓'), BARK[0]);
  put(cv, 0, 0, 32, 0);
  glow(cv, 7, 3, 4, 2, 1);
  const lit = []; for (let i = 0; i < c.length; i++) if (c[i] === BARK[1]) lit.push([i % 15, Math.floor(i / 15)]);
  assert.ok(lit.length > 15 && lit.every(([x, y]) => ((x - 7) / 4) ** 2 + ((y - 3) / 2) ** 2 <= 1), 'inside the ellipse only');
  assert.equal(c[7 * 1 + 15 * 3], BARK[1]);
  assert.equal(c[0], 0, 'a blank cell stays blank');
  assert.equal(c[14 + 15 * 6], BARK[0], 'far cells keep their shade');
  // the top shade stays the top shade
  const top = new Uint8Array(1).fill(GOLD[3]);
  glow(canvas(new Uint16Array(1).fill(cp('●')), top, 1, 1), 0, 0, 4, 2, 1);
  assert.equal(top[0], GOLD[3]);
});

test('thornwell Brambleback: one crosses the mid-ground every 40 to 60 s, walking left a column every 0.25 s', () => {
  const seen = (t) => { const f = frameAt(t); for (let x = 0; x < W; x++) if (f.glyphs[at(f, x, L.gy - 2)] === cp('◀')) return x; return -1; };
  // a start is the first sighting after 10 s without one (the tortoise goes behind Orrin and a trunk for a few seconds on its way)
  const starts = [];
  let lastSeen = -100;
  for (let t = 0; t < 230; t += 0.25) {
    if (seen(t) >= 0) { if (t - lastSeen > 10) starts.push(t); lastSeen = t; }
  }
  assert.ok(starts.length >= 4, `${starts.length} Bramblebacks in 230 s`);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 40 - 0.5 && starts[i] - starts[i - 1] <= 60 + 0.5, `starts ${starts[i - 1]} and ${starts[i]}`);
  const t0 = starts[0] + 5;
  assert.equal(seen(t0) - seen(t0 + 0.25), 1);
  assert.ok(seen(t0 + 20) < seen(t0));
});

test('thornwell at 80x24 (or under 100 columns, or under 30 rows) drops the far ridge and shortens the pines; 120x40 keeps both', () => {
  assert.equal(layoutOf(80, 24).small, true);
  assert.equal(layoutOf(99, 40).small, true);
  assert.equal(layoutOf(120, 29).small, true);
  assert.equal(layoutOf(100, 30).small, false);
  assert.ok(layoutOf(80, 24).hmax < layoutOf(120, 40).hmax);
  const count = (w, h) => { const f = frameAt(5, w, h); let n = 0; for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] === cp('▲') && f.colours[i] === MOSS[0]) n++; return n; };
  assert.ok(count(120, 40) > 20, 'ridge at 120x40');
  assert.equal(count(80, 24), 0, 'no ridge at 80x24');
  assert.ok(count(240, 67) > 40, 'and at 240x67');
});
