// DRIFT-7 C13: the morph from the 2000 to the 9000 (p = 0 to 0.55 over the insert, 0.55 to 1 over the boot; an eject folds back from 0.55).
//   shed    0 - 0.30     2000-only cells become single braille dots at hue 200, no brighter than the cell they replace; edges first
//   unfold  0.10 - 0.55  the 9000 grows outward from the slot, enters at hue 200 + 300p, settles to its colour over two frames
//   light   0.55 - 1     hue only: every light opens from ion to its resting hue, the centre first
// The shell's own frames: the hook is called with the p and t the shell computes (recordCalls), and the cell budget is counted on those calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { consoleBodyGrid, consoleStyle } from '../src/shell/library.js';
import { driftmanSkin, DRIFTMAN_COLOURS } from '../src/shell/driftman.js';
import { safeHue } from '../src/pixels.js';
import { plan, SETTLE_P, DOT_P, SHED_END } from '../cartridges/driftman-9000/lib/morph.js';
import { lumOf } from '../cartridges/driftman-9000/lib/rest.js';
import {
  FULL, MINI, DT, drawHook, localCells, snapshot, cellY, changedCells, recordCalls, RGB_CELL, PALETTE_BG,
} from './helpers-driftman-console.js';

const STEP = 0.55 / 9; // p per insert frame (the shell steps 9 frames across step 5)
const DOT_GLYPHS = [0x2801, 0x2802, 0x2804, 0x2840];
const at = (size, p, t = 1.2) => localCells(drawHook(size, 'insert', p, t));
const GRAPHITE = 0x5D6474, DIM = 0x8B93A1, SILVER = 0xC8CCD4;

// OKLCH hue (degrees) of a 0xRRGGBB colour, from the published OKLab matrices (independent of safeHue)
function oklabHue(rgb) {
  const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const r = lin((rgb >>> 16) & 255), g = lin((rgb >>> 8) & 255), b = lin(rgb & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
}
const hueGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// ---- p = 0 is the 2000 as it was a frame earlier

for (const [size, name] of [[FULL, 'full'], [MINI, 'mini']]) {
  test(`9000 morph, ${name}: at p = 0 the hook draws the 2000's body as the shell draws it (same glyph in every cell, graphite/dim/silver colours), apart from the dial pointer`, () => {
    const ui = driftmanSkin.palette.ui;
    const body = { led: 'on', ledShade: ui.accent, openShade: DRIFTMAN_COLOURS.housing, link: false };
    // the shell's standard body at the click (consoleBodyGrid is the body alone: no screen text, no LEDs)
    const ref = name === 'full' ? consoleBodyGrid({ st: consoleStyle(driftmanSkin, body), ui }) : null;
    const c = at(size, 0);
    const c2 = at(size, 2.4e-16);
    assert.deepEqual([...c2.glyphs], [...c.glyphs], 'the p the shell hands over at the click (a hair above 0) is p = 0');
    let inked = 0, pointer = 0;
    if (ref) {
      for (let i = 0; i < ref.g.length; i++) {
        if (ref.g[i] === 32) { assert.equal(c.glyphs[i], 32, `blank in the shell's body at ${i}`); continue; }
        if (ref.s[i] === DRIFTMAN_COLOURS.amber) { pointer++; continue; } // the TUNE pointer needs the cursor, which the hook is not given
        inked++;
        assert.equal(c.glyphs[i], ref.g[i], `glyph at cell ${i % 84},${Math.floor(i / 84)}`);
        const want = ref.s[i] === DRIFTMAN_COLOURS.housing ? GRAPHITE : ref.s[i] === DRIFTMAN_COLOURS.dim ? DIM : ref.s[i] === 15 ? SILVER : -1;
        assert.equal(c.fg[i], want, `colour of shade ${ref.s[i]} at ${i % 84},${Math.floor(i / 84)}`);
        assert.equal(c.bg[i], PALETTE_BG);
      }
      assert.ok(pointer <= 2, 'pointer cells: ' + pointer);
      assert.ok(inked > 400, 'the body has ' + inked + ' inked cells');
    } else {
      assert.equal(String.fromCodePoint(...Array.from({ length: 13 }, (_, k) => c.glyphs[2 * 38 + 19 + k])), 'DRIFTMAN 2000');
    }
  });
}

// ---- shed

for (const [size, name] of [[FULL, 'full'], [MINI, 'mini']]) {
  test(`9000 morph, ${name}: shed cells (a share of them) become single braille dots for one frame and are never brighter than the cell they replace; the 2000 is gone by 0.36`, () => {
    const base = at(size, 0), rest = localCells(drawHook(size, 'boot', 1, 3.4));
    let dots = 0, gone = 0;
    const dotFrames = new Map();
    for (let k = 0; k <= 12; k++) {
      const c = at(size, k * 0.0611);
      for (let i = 0; i < base.glyphs.length; i++) {
        if (base.glyphs[i] === 32 || c.glyphs[i] === base.glyphs[i] || c.glyphs[i] === rest.glyphs[i]) continue; // (a braille glyph that is the 9000's own is not a dot)
        if (DOT_GLYPHS.includes(c.glyphs[i])) {
          dots++;
          dotFrames.set(i, (dotFrames.get(i) || 0) + 1);
          assert.equal(c.shades[i], RGB_CELL);
          assert.ok(cellY(c, i) <= cellY(base, i) + 1e-9, `a dot at cell ${i} is brighter than the cell it replaces: ${cellY(c, i)} > ${cellY(base, i)} (k ${k})`);
          assert.ok(hueGap(oklabHue(c.fg[i]), 200) < 8, 'dot hue ' + oklabHue(c.fg[i])); // safeHue's gamut step and 6-bit grid move a dim hue a few degrees
        }
      }
    }
    for (const [i, n] of dotFrames) assert.ok(n <= 1, `cell ${i} showed its dot in ${n} frames`);
    assert.ok(dots > (name === 'full' ? 60 : 8), 'dots: ' + dots); // a share of the shed cells (DOT_SHARE) show a dot; the rest go at once (the cell budget)
    const late = at(size, SHED_END + DOT_P + 0.01);
    for (let i = 0; i < base.glyphs.length; i++) if (base.glyphs[i] !== 32 && late.glyphs[i] === base.glyphs[i] && !(late.glyphs[i] === plan(name).news.find((n) => n.y * base.cols + n.x === i)?.g)) gone++;
    assert.equal(gone, 0, 'a 2000 cell is still there at 0.36');
  });
}

test('9000 morph, full: the edges of the console go first (at p = 0.12 most of the outermost ring of 2000 cells is shed, little of the inside)', () => {
  const base = at(FULL, 0), c = at(FULL, 0.12);
  const edge = [0, 0], inner = [0, 0];
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 84; x++) {
      const i = y * 84 + x;
      if (base.glyphs[i] === 32) continue;
      const d = Math.min(x, 83 - x, y, 17 - y);
      const bucket = d <= 1 ? edge : d >= 6 ? inner : null;
      if (!bucket) continue;
      bucket[0]++;
      if (c.glyphs[i] !== base.glyphs[i]) bucket[1]++;
    }
  }
  const fe = edge[1] / edge[0], fi = inner[1] / inner[0];
  console.log(`SHED at p 0.12: edge ${edge[1]}/${edge[0]} = ${(fe * 100).toFixed(0)}%, inner ${inner[1]}/${inner[0]} = ${(fi * 100).toFixed(0)}%`);
  assert.ok(edge[0] > 100 && inner[0] > 30);
  assert.ok(fe > fi + 0.3, `edge ${fe} inner ${fi}`);
});

// ---- unfold

test('9000 morph, full: the drawing grows outward from the slot (cells near the centre line arrive before cells far from it), and every cell has arrived by 0.55', () => {
  const rest = localCells(drawHook(FULL, 'boot', 1, 3.4)), base = at(FULL, 0);
  const early = at(FULL, 0.25), whole = at(FULL, 0.55);
  const isNew = (i) => rest.glyphs[i] !== 32 && rest.glyphs[i] !== base.glyphs[i];
  let nearSum = 0, nearN = 0, farSum = 0, farN = 0;
  for (let i = 0; i < rest.glyphs.length; i++) {
    if (!isNew(i)) continue;
    assert.equal(whole.glyphs[i], rest.glyphs[i], 'arrived by 0.55: cell ' + i);
    const dx = Math.abs((i % 84) - 41.5);
    if (early.glyphs[i] === rest.glyphs[i]) { nearSum += dx; nearN++; } else { farSum += dx; farN++; }
  }
  console.log(`UNFOLD at p 0.25: ${nearN} cells in (mean |x - 41.5| ${(nearSum / nearN).toFixed(1)}), ${farN} still to come (mean ${(farSum / farN).toFixed(1)})`);
  assert.ok(nearN > 50 && farN > 50);
  assert.ok(nearSum / nearN + 5 < farSum / farN);
});

test('9000 morph: a light cell enters at hue 200 + 300p at its final lightness and is its own colour one frame later; a plain stroke arrives in its own colour; luminance is held through the entry', () => {
  const pl = plan('full');
  const spec = pl.news.filter((c) => c.k === 3 && c.tu > 0.2 && c.tu < 0.45 && c.a % 2 === 0).slice(0, 4);
  assert.ok(spec.length >= 3, 'spectrum cells arriving in the middle of the unfold: ' + spec.length);
  for (const cell of spec) {
    const i = cell.y * 84 + cell.x;
    const own = safeHue(200, 0.70); // before the machine wakes (v = 0) every spectrum column is ion at L 0.70
    const p0 = cell.tu + 1e-4;
    const first = at(FULL, p0);
    assert.equal(first.glyphs[i], cell.g);
    assert.equal(first.fg[i], safeHue(200 + 300 * p0, Math.cbrt(lumOf(own))), 'the first frame is the entry colour');
    assert.ok(hueGap(oklabHue(first.fg[i]), (200 + 300 * p0) % 360) < 8, `entry hue ${oklabHue(first.fg[i])} vs ${(200 + 300 * p0) % 360}`);
    assert.ok(Math.abs(lumOf(first.fg[i]) - lumOf(own)) / lumOf(own) < 0.12, 'luminance held at entry: ' + lumOf(first.fg[i]) + ' vs ' + lumOf(own));
    assert.equal(at(FULL, cell.tu + STEP).fg[i], own, 'one insert frame later it is its own colour');
    assert.equal(at(FULL, cell.tu + 2 * STEP).fg[i], own);
    assert.ok(SETTLE_P <= STEP && 2 * STEP >= SETTLE_P);
  }
  const stroke = pl.news.find((c) => c.k === 0 && c.c === 0x4A6AB0 && c.tu > 0.2 && c.tu < 0.4);
  const j = stroke.y * 84 + stroke.x;
  assert.equal(at(FULL, stroke.tu + 1e-4).fg[j], 0x4A6AB0, 'a plain stroke is its colour from the first frame');
});

test('9000 morph: each name letter shows two Greek letters, then lands (the rest letters are Latin and digits)', () => {
  const pl = plan('full');
  const d = pl.news.find((c) => c.k === 5 && c.a === 0); // the D
  const i = d.y * 84 + d.x;
  const seq = [];
  for (let k = 0; k <= 60; k++) { const c = at(FULL, d.tu + k * 0.004); if (c.glyphs[i] !== 32 && seq[seq.length - 1] !== c.glyphs[i]) seq.push(c.glyphs[i]); }
  assert.equal(seq.length, 3, 'two Greek letters then the landing: ' + seq.map((g) => String.fromCodePoint(g)).join(''));
  assert.ok(seq[0] >= 0x391 && seq[0] <= 0x3a9 && seq[1] >= 0x391 && seq[1] <= 0x3a9, 'Greek capitals');
  assert.equal(seq[2], 'D'.codePointAt(0));
});

// ---- light: hue only, centre first

test('9000 morph, light phase (p 0.55 to 1): the glyphs are the rest frame\'s, brightness is the rest frame\'s, and only hue opens out from ion, the centre first', () => {
  const rest = localCells(drawHook(FULL, 'boot', 1, 3.4));
  const t = 0.3;
  const a = localCells(drawHook(FULL, 'boot', 0.55, t)), b = localCells(drawHook(FULL, 'boot', 0.75, t)), c = localCells(drawHook(FULL, 'boot', 1, t));
  for (const x of [a, b]) {
    assert.deepEqual([...x.glyphs], [...rest.glyphs]);
    for (let i = 0; i < x.glyphs.length; i++) assert.ok(Math.abs(cellY(x, i) - cellY(c, i)) < 0.04, `cell ${i}: ${cellY(x, i)} vs ${cellY(c, i)}`);
  }
  // at 0.55 the spectrum is one hue; at 1 it is thirteen
  const spec = (x) => new Set(Array.from({ length: 13 }, (_, k) => x.fg[7 * 84 + 67 + k])).size;
  assert.equal(spec(a), 1);
  assert.equal(spec(c), 13);
  // the centre first: a halo cell near the centre line has opened further than one at the end of the ring
  const dist = (rgb) => hueGap(oklabHue(rgb), 200);
  const nearI = 16 * 84 + 40, farI = 16 * 84 + 12;
  assert.ok(dist(b.fg[nearI]) > dist(b.fg[farI]) + 10, `near ${dist(b.fg[nearI])} far ${dist(b.fg[farI])}`);
  assert.ok(dist(c.fg[farI]) > dist(b.fg[farI]), 'and the far cell gets there');
});

// ---- the cell budget, on the shell's own call sequence

for (const [cols, rows, size, name] of [[120, 40, FULL, '120x40'], [240, 67, FULL, '240x67'], [80, 24, MINI, '80x24']]) {
  test(`9000 morph budget at ${name}: changed cells per frame in the console over the shell's insert + boot and its eject`, async () => {
    const { up, down } = await recordCalls(cols, rows);
    const count = (calls) => {
      const per = [];
      let prev = null;
      for (const k of calls) {
        const c = localCells(drawHook(size, k.phase, k.p, k.t));
        if (prev) per.push(changedCells(prev, c));
        prev = c;
      }
      return per;
    };
    const u = count(up), e = count(down);
    const stat = (a) => `max ${Math.max(...a)} mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(0)}`;
    console.log(`BUDGET ${name} insert+boot (${u.length} frames): ${stat(u)}; per frame ${u.slice(0, 26).join(',')} ...; eject (${e.length}): ${stat(e)}`);
    // insert (9 frames of the morph) is where the shape changes; the boot adds the hue fan
    const insertFrames = u.slice(0, 10);
    assert.ok(Math.max(...insertFrames) <= BUDGET[name].insert, `${name}: insert frame of ${Math.max(...insertFrames)} changed cells`);
    assert.ok(Math.max(...u) <= BUDGET[name].all, `${name}: a frame of ${Math.max(...u)} changed cells`);
    assert.ok(Math.max(...e) <= BUDGET[name].eject, `${name}: an eject frame of ${Math.max(...e)} changed cells`);
    // the fixtures are not vacuous: the morph really changes hundreds of cells in total
    assert.ok(insertFrames.reduce((x, y) => x + y, 0) > (size === FULL ? 800 : 100));
  });
}

// bounds from the measurement above (the brief's target is about 250 changed cells per frame, 5% of 120x40)
// measured: 120x40 and 240x67 (the hook's cells do not depend on the screen size) insert frames max 245, whole insert + boot max 245, eject max 236 (5.1% of 120x40);
// 80x24 (the 38 x 4 mini console) max 65 and 35.
const BUDGET = {
  '120x40': { insert: 250, all: 250, eject: 250 },
  '240x67': { insert: 250, all: 250, eject: 250 },
  '80x24': { insert: 70, all: 70, eject: 40 },
};
void DT; void snapshot;
