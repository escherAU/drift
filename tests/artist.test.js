// DRIFT-2 S4: the artist scene and its gallery (src/art/pieces/*.txt). The shared non-calm suite
// (tests/noncalm-scenes.test.js) covers determinism, sizes, glyph width, buffer reuse and the flash
// rule; this file covers the gallery contents and the draw / hold / erase / rest cycle.
//
// ORIGINALITY is checked by the reviewer reading the pieces, not by a machine: the tests below only
// stop an accidental duplicate (two pieces the same, or one file copied under another name).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import artist, { timeline, stateAt, HOLD_SEC, ERASE_SEC, REST_SEC } from '../src/scenes/artist.js';
import { PIECES, GALLERY_ERRORS, PIECES_DIR, loadGallery, OPENING_ORDER } from '../src/art/gallery.js';
import { buildPlan, pieceToText, strokeOrder, parsePiece } from '../src/art/engine.js';
import { renderScene, createCellComposer } from '../src/cells.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { PLAYLISTS } from '../src/scenes/index.js';
import { WIDE_BMP } from './noncalm-scenes.test.js';

const isWide = (cp) => WIDE_BMP.some(([a, b]) => cp >= a && cp <= b);
const W = 120, H = 40;
const frame = (t, w = W, h = H, seed = 1) => renderScene(artist, t, w, h, seed);
const litCount = (f) => f.glyphs.reduce((n, g) => n + (g !== 32 ? 1 : 0), 0);

test('the artist is the last scene of the experimental playlist', () => {
  const list = PLAYLISTS.experimental;
  assert.equal(list[list.length - 1].id, 'artist');
  assert.equal(artist.kind, 'cells');
});

// ---- the gallery
test('gallery: every file parses (no errors), there are at least 8 pieces, loaded in the gallery order (OPENING_ORDER first, then filename)', () => {
  assert.deepEqual(GALLERY_ERRORS, []);
  assert.ok(PIECES.length >= 8, `${PIECES.length} pieces`);
  const files = fs.readdirSync(PIECES_DIR).filter((f) => f.endsWith('.txt')).sort();
  assert.deepEqual([...PIECES.map((p) => p.file)].sort(), files, 'every file is loaded once');
  const names = PIECES.map((p) => p.file.replace(/\.txt$/i, ''));
  assert.deepEqual(names.slice(0, OPENING_ORDER.length), OPENING_ORDER.filter((n) => names.includes(n)));
  const rest = names.slice(OPENING_ORDER.length);
  assert.deepEqual(rest, [...rest].sort(), 'the rest follow in filename order');
});

test('gallery: titles are unique and non-empty; no two pieces are identical; no file is a copy of another', () => {
  const titles = PIECES.map((p) => p.title);
  assert.equal(new Set(titles).size, titles.length, `duplicate title in ${titles}`);
  for (const t of titles) assert.ok(t.trim().length > 0);
  const drawings = PIECES.map(pieceToText);
  assert.equal(new Set(drawings).size, drawings.length, 'two pieces draw the same picture');
  const raw = PIECES.map((p) => fs.readFileSync(path.join(PIECES_DIR, p.file), 'utf8').replace(/\r\n/g, '\n').split('\n').slice(2).join('\n').trim());
  assert.equal(new Set(raw).size, raw.length, 'two files have the same art text');
});

test('gallery: every piece fits 116x36, is not blank, has only allow-listed single-width glyphs', () => {
  for (const p of PIECES) {
    assert.ok(p.width >= 20 && p.width <= 116, `${p.title}: width ${p.width}`);
    assert.ok(p.height >= 10 && p.height <= 36, `${p.title}: height ${p.height}`);
    assert.ok(p.cells.length >= 60, `${p.title}: only ${p.cells.length} cells`);
    for (const c of p.cells) {
      assert.ok(c.cp < 0x10000, `${p.title}: U+${c.cp.toString(16)} outside the BMP`);
      assert.ok(isAllowedGlyph(c.cp), `${p.title}: U+${c.cp.toString(16)} (${String.fromCodePoint(c.cp)}) at ${c.x},${c.y} not allow-listed`);
      assert.ok(!isWide(c.cp), `${p.title}: U+${c.cp.toString(16)} is wide`);
      assert.notEqual(c.cp, 32);
    }
  }
});

test('gallery: the pieces use a wide variety of glyph families', () => {
  const seen = new Set();
  for (const p of PIECES) for (const c of p.cells) seen.add(c.cp);
  const has = (lo, hi) => [...seen].some((cp) => cp >= lo && cp <= hi);
  assert.ok(has(0x2500, 0x257f), 'box drawing');
  assert.ok(has(0x2580, 0x259f), 'blocks');
  assert.ok(has(0x391, 0x3c9), 'Greek');
  assert.ok(has(0x2200, 0x22ff), 'maths');
  assert.ok(has(0x25a0, 0x25ff), 'geometric shapes');
  assert.ok(seen.size >= 30, `${seen.size} distinct glyphs`);
});

test('gallery: stroke order of every piece is deterministic and covers each non-blank cell exactly once', () => {
  for (const p of PIECES) {
    const a = strokeOrder(p), b = strokeOrder(parsePiece(fs.readFileSync(path.join(PIECES_DIR, p.file), 'utf8')));
    assert.deepEqual(Array.from(a.order), Array.from(b.order), p.title);
    assert.deepEqual(Array.from(a.order).sort((x, y) => x - y), p.cells.map((_, k) => k), p.title);
    const plan = buildPlan(p);
    assert.ok(plan.drawSec >= 8 && plan.drawSec <= 18, `${p.title}: draws in ${plan.drawSec} s`);
  }
});

test('loader: tolerates CRLF, skips a broken file (and says so), and a new file adds a piece', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-art-'));
  try {
    fs.writeFileSync(path.join(dir, 'b.txt'), 'title: Bee\r\n---\r\n  /\\\r\n |==|\r\n  \\/\r\n');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'title: Ant\n---\n o-o\n');
    fs.writeFileSync(path.join(dir, 'bad.txt'), 'no title here\n');
    fs.writeFileSync(path.join(dir, 'notes.md'), 'ignored');
    const g = loadGallery(dir);
    assert.deepEqual(g.pieces.map((p) => p.title), ['Ant', 'Bee']);
    assert.equal(g.errors.length, 1);
    assert.equal(g.errors[0].file, 'bad.txt');
    assert.equal(g.pieces[1].width, 4);
    fs.writeFileSync(path.join(dir, 'c.txt'), 'title: Cow\n---\n(oo)\n');
    assert.equal(loadGallery(dir).pieces.length, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the cycle
const tl = timeline(PIECES, W, H, 1);
const expectedOrder = (seed) => PIECES.map((_, k) => PIECES[(((seed | 0) % PIECES.length) + PIECES.length + k) % PIECES.length].title);

test('timeline: draw, hold 8 s, erase 4.5 s, rest 1.5 s for each piece, back to back', () => {
  assert.equal(tl.list.length, PIECES.length, 'all pieces fit 120x40');
  let at = 0;
  for (const e of tl.list) {
    assert.equal(e.start, at);
    assert.ok(Math.abs(e.holdEnd - e.drawEnd - HOLD_SEC) < 1e-9 && HOLD_SEC === 8);
    assert.ok(Math.abs(e.eraseEnd - e.holdEnd - ERASE_SEC) < 1e-9);
    assert.ok(Math.abs(e.end - e.eraseEnd - REST_SEC) < 1e-9);
    at = e.end;
  }
  assert.equal(tl.period, at);
});

test('cycles through every piece in order, forever (two laps), and the seed only rotates the start', () => {
  for (const seed of [1, 2, 5]) {
    const t2 = timeline(PIECES, W, H, seed);
    const seen = [];
    for (let t = 0; t < t2.period * 2; t += 0.5) {
      const s = stateAt(t2, t);
      if (!seen.length || seen[seen.length - 1] !== s.piece.title) seen.push(s.piece.title);
    }
    const want = expectedOrder(seed);
    assert.deepEqual(seen, [...want, ...want], `seed ${seed}`);
  }
});

test('the erase style alternates: wipe, dissolve, wipe, ... (also across the lap boundary)', () => {
  const styles = [];
  for (let lap = 0; lap < 2; lap++) {
    tl.list.forEach((e, i) => {
      const s = stateAt(tl, lap * tl.period + e.holdEnd + 0.1);
      assert.equal(s.index, i);
      styles.push(s.phase);
    });
  }
  styles.forEach((s, k) => assert.equal(s, k % 2 === 0 ? 'wipe' : 'dissolve', `piece ${k}`));
});

// pieces[i]'s grid position at WxH
function expectedGrid(p, w = W, h = H) {
  const g = new Uint16Array(w * h).fill(32);
  const x0 = Math.floor((w - p.width) / 2), y0 = Math.floor((h - p.height) / 2);
  for (const c of p.cells) g[(y0 + c.y) * w + x0 + c.x] = c.cp;
  return g;
}

test('the finished drawing equals the piece exactly, and so does the frame at the end of the hold', () => {
  tl.list.forEach((e) => {
    const want = Array.from(expectedGrid(e.piece));
    assert.deepEqual(Array.from(frame(e.drawEnd).glyphs), want, `${e.piece.title}: end of drawing`);
    assert.deepEqual(Array.from(frame(e.drawEnd + 3).glyphs), want, `${e.piece.title}: mid hold`);
    assert.deepEqual(Array.from(frame(e.holdEnd - 1e-6).glyphs), want, `${e.piece.title}: end of hold`);
    // settled colours: every cell at its base brightness
    const plan = buildPlan(e.piece);
    const f = frame(e.holdEnd - 0.01);
    const x0 = Math.floor((W - e.piece.width) / 2), y0 = Math.floor((H - e.piece.height) / 2);
    e.piece.cells.forEach((c, k) => assert.equal(f.colours[(y0 + c.y) * W + x0 + c.x], plan.base[k], e.piece.title));
  });
});

test('drawing only ADDS cells; erasing only REMOVES cells; the grid is empty after erase and rest', () => {
  const FPS = 30;
  tl.list.forEach((e, i) => {
    let prev = null;
    // draw
    for (let t = e.start; t <= e.drawEnd + 1e-9; t += 1 / FPS) {
      const g = frame(t).glyphs;
      if (prev) for (let k = 0; k < g.length; k++) if (prev[k] !== 32) assert.equal(g[k], prev[k], `${e.piece.title}: cell ${k} changed/vanished while drawing at ${t}`);
      prev = g.slice();
    }
    // erase
    const style = i % 2 === 0 ? 'wipe' : 'dissolve';
    assert.equal(stateAt(tl, e.holdEnd + 0.01).phase, style);
    prev = frame(e.holdEnd).glyphs.slice();
    let worst = 0;
    for (let t = e.holdEnd; t <= e.eraseEnd + 1e-9; t += 1 / FPS) {
      const g = frame(t).glyphs;
      let removed = 0;
      for (let k = 0; k < g.length; k++) {
        if (prev[k] === 32) assert.equal(g[k], 32, `${e.piece.title}: cell ${k} appeared while erasing at ${t}`);
        else if (g[k] === 32) removed++;
        else assert.equal(g[k], prev[k]);
      }
      worst = Math.max(worst, removed);
      prev = g.slice();
    }
    assert.ok(worst <= e.piece.cells.length * 0.05, `${e.piece.title} (${style}): ${worst} of ${e.piece.cells.length} cells vanish in one 1/30 s step`);
    assert.equal(litCount(frame(e.eraseEnd)), 0, `${e.piece.title}: empty at the end of erasing`);
    assert.equal(litCount(frame(e.eraseEnd + REST_SEC / 2)), 0, 'empty during the rest');
    assert.equal(litCount(frame(e.end - 1e-6)), 0, 'empty until the next piece starts');
    assert.ok(litCount(frame(e.end + 0.2)) >= 1, 'the next piece has begun');
  });
});

test('the pen leads: a bright cell at the end of the stroke; fresh strokes fade to base; the piece grows steadily', () => {
  const e = tl.list[0];
  const f = frame(e.start + (e.drawEnd - e.start) * 0.5);
  assert.ok(Math.max(...f.colours) >= 14, 'a bright pen cell');
  const mid = Array.from(f.colours).filter((c, k) => f.glyphs[k] !== 32);
  assert.ok(mid.some((c) => c < 12), 'older strokes have faded');
  assert.ok(litCount(frame(e.start + 2)) < litCount(frame(e.start + 6)));
  assert.ok(litCount(frame(e.start + 6)) < litCount(frame(e.drawEnd - 0.5)) || e.piece.cells.length < 200);
});

test('the dissolve fades cells before removing them (smooth), the wipe has a bright edge', () => {
  const dissolve = tl.list[1], wipe = tl.list[0];
  const d = frame(dissolve.holdEnd + 1.5);
  const lv = new Set(Array.from(d.colours).filter((c, k) => d.glyphs[k] !== 32));
  assert.ok([...lv].some((c) => c <= 6), 'dimming cells exist mid-dissolve');
  const w = frame(wipe.holdEnd + 1.5);
  assert.ok(Math.max(...w.colours) >= 14, 'bright eraser edge');
});

test('whole run at 18 fps and 120x40: no frame switches more than 3% of the grid between blank and lit', () => {
  let prev = null, worst = 0;
  for (let k = 0; k < Math.ceil(tl.period * 18) + 5; k++) {
    const g = frame(k / 18).glyphs;
    if (prev) {
      let sw = 0;
      for (let i = 0; i < g.length; i++) if ((g[i] !== 32) !== (prev[i] !== 32)) sw++;
      worst = Math.max(worst, sw / g.length);
    }
    prev = g.slice();
  }
  assert.ok(worst < 0.03, `worst ${(worst * 100).toFixed(2)}%`);
});

test('grids that are too small skip the pieces that do not fit; tiny grids stay blank without crashing', () => {
  for (const [w, h] of [[0, 0], [1, 1], [5, 0], [0, 5], [30, 10], [60, 12], [100, 17]]) {
    for (const t of [0, 3, 12, 40, 300]) {
      const f = renderScene(artist, t, w, h, 1);
      assert.equal(f.glyphs.length, w * h);
    }
  }
  assert.equal(litCount(renderScene(artist, 5, 30, 10, 1)), 0, 'nothing fits 30x10');
  // an 80x24 terminal shows only pieces that fit it, and every one that fits is eventually shown
  const t80 = timeline(PIECES, 80, 24, 1);
  const fit = PIECES.filter((p) => p.width <= 80 && p.height <= 24);
  assert.equal(t80.list.length, fit.length);
  assert.ok(fit.length >= 3, `${fit.length} pieces fit 80x24`);
  const e = t80.list[0];
  const f = renderScene(artist, e.drawEnd + 1, 80, 24, 1);
  assert.deepEqual(Array.from(f.glyphs), Array.from(expectedGrid(e.piece, 80, 24)));
  // a grid exactly as big as a piece shows that piece whole
  const p = PIECES[0];
  const tight = timeline(PIECES, p.width, p.height, 1);
  assert.ok(tight.list.some((x) => x.piece === p));
});

test('the seed rotates the first piece; another seed shows a different first piece', () => {
  const a = stateAt(timeline(PIECES, W, H, 1), 0).piece.title, b = stateAt(timeline(PIECES, W, H, 2), 0).piece.title;
  assert.notEqual(a, b);
  assert.equal(a, expectedOrder(1)[0]);
});

// ---- captures
import { runCaptureGallery, galleryCaptureNames } from '../tools/capture.mjs';
import { frameToText } from '../src/renderer.js';

test('capture: <piece>-half and -full at 120x40, plus artist-gallery.txt with every title; half is part of full', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-art-cap-'));
  try {
    const files = runCaptureGallery({ outDir: dir });
    assert.deepEqual(fs.readdirSync(dir).sort(), galleryCaptureNames().sort());
    assert.equal(files.length, PIECES.length * 2 + 1);
    const body = (f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').slice(1, 41);
    for (const p of PIECES) {
      const b = p.file.replace(/\.txt$/i, '');
      const half = body(`artist-${b}-half.txt`), full = body(`artist-${b}-full.txt`);
      assert.equal(full.length, 40);
      for (const l of [...half, ...full]) assert.equal(Array.from(l).length, 120);
      const lit = (rows) => rows.join('').replace(/ /g, '').length;
      assert.ok(lit(half) > 0 && lit(half) < lit(full), `${p.title}: half is between nothing and the whole`);
      assert.deepEqual(full, frameToText({ cols: 120, rows: 40, glyphs: expectedGrid(p) }).split('\n'));
    }
    const gallery = fs.readFileSync(path.join(dir, 'artist-gallery.txt'), 'utf8');
    for (const p of PIECES) {
      assert.ok(gallery.includes(`=== ${p.title} (${p.file})`), p.title);
      assert.ok(gallery.includes(pieceToText(p)), `${p.title} drawn in full`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the start of a visit
test('the default seed opens on the cat or the lighthouse, never the dragon', () => {
  const first = stateAt(timeline(PIECES, W, H, 1), 0).piece.title;
  assert.ok(['Cat', 'Lighthouse'].includes(first), `opens on ${first}`);
});

test('scene-local time: the composer hands the artist t0, so a visit begins at the start of a drawing (not mid-cycle)', () => {
  const cc = createCellComposer({ scenes: [artist], cols: W, rows: H, seed: 1 });
  const st = { a: 0, b: 0, p: 0 };
  const lit = (f) => f.glyphs.reduce((n, g) => n + (g !== 32 ? 1 : 0), 0);
  // the app's global clock is far into the cycle (here 100.3 s) when the artist is first shown
  const first = cc.frame(st, 100.3);
  const fresh = renderScene(artist, 0, W, H, 1);
  assert.deepEqual(Array.from(first.glyphs), Array.from(fresh.glyphs), 'first frame = the piece at its own t = 0');
  const litFirst = lit(first); // the composer reuses its buffer, so count now
  const first4 = stateAt(timeline(PIECES, W, H, 1), 0);
  assert.equal(first4.phase, 'draw');
  // 3 s later it is 3 s into that same drawing
  const later = cc.frame(st, 103.3);
  const want = renderScene(artist, 3, W, H, 1);
  assert.deepEqual(Array.from(later.glyphs), Array.from(want.glyphs));
  assert.ok(lit(later) > litFirst, 'the drawing has progressed');
  // leaving and returning starts a new visit from the top again
  const cc2 = createCellComposer({ scenes: [artist, PLAYLISTS.experimental[0]], cols: W, rows: H, seed: 1 });
  cc2.frame({ a: 0, b: 0, p: 0 }, 50);
  cc2.frame({ a: 1, b: 1, p: 0 }, 60);
  const back = cc2.frame({ a: 0, b: 0, p: 0 }, 200);
  assert.deepEqual(Array.from(back.glyphs), Array.from(fresh.glyphs), 'a second visit also starts at t = 0');
});

test('scene-local time: without t0 (captures, shared tests) the artist still runs on the t it is given (pure, unchanged)', () => {
  const a = renderScene(artist, 12, W, H, 1), b = renderScene(artist, 12, W, H, 1);
  assert.deepEqual(Array.from(a.glyphs), Array.from(b.glyphs));
  assert.ok(litCount(a) > 20);
});
