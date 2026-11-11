// Per-scene checks for cartridge scenes (DRIFT-4). Each function asserts and throws on a failure, so a
// suite can run it inside test() and a control can prove it bites with assert.throws. They mirror the
// shared non-calm suite (tests/noncalm-scenes.test.js, which stays as it was): kind, determinism, sizes,
// glyph allow-list and width, colour range, buffer fill, visibility, flash safety, and for field scenes the
// calm contract (values 0..255, slowness bound) plus the crossfade check.
import assert from 'node:assert/strict';
import { renderScene, sceneKind, createCellComposer } from '../src/cells.js';
import { Scheduler, createComposer } from '../src/compose.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { isWide, isInvisible } from './helpers-width.js';
import { flashTimesOf, snap } from './helpers-flash.js';

export const FPS = 18;
export const SIZES = [[120, 40], [240, 67], [80, 24], [1, 1], [0, 0], [2, 200]];
export const MAX_FIELD_STEP = 12; // per cell, 0..255, between two frames 1/18 s apart
export const CROSSFADE_LIMIT = 0.075; // share of cells that may change glyph or shade in one frame of a crossfade

const hex = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
const same = (a, b) => assert.deepEqual(Array.from(a), Array.from(b));

// ---- cells, sim and text scenes

export function checkKind(entry) {
  const k = sceneKind(entry.scene);
  if (entry.kind === 'sim') {
    assert.equal(k, 'sim');
    for (const f of ['init', 'step', 'draw']) assert.equal(typeof entry.scene[f], 'function', f);
  } else if (entry.kind === 'cells' || entry.kind === 'text') {
    assert.equal(k, 'cells');
    assert.equal(typeof entry.scene, 'function');
  } else {
    assert.ok(k === 'cells' || k === 'sim', `${entry.kind} -> ${k}`);
  }
  assert.equal(typeof entry.id, 'string');
}

// seedIndependent: text scenes ignore the seed (and must). Everything else must change with it.
export function checkDeterminism(scene, { seedIndependent = false } = {}) {
  for (const t of [0, 3.3, 20.1]) {
    const a = renderScene(scene, t, 100, 30, 5);
    const b = renderScene(scene, t, 100, 30, 5);
    same(a.glyphs, b.glyphs);
    same(a.colours, b.colours);
  }
  if (seedIndependent) {
    for (const t of [0, 1, 2, 5, 10, 20]) {
      const x = renderScene(scene, t, 100, 30, 5), y = renderScene(scene, t, 100, 30, 6);
      same(x.glyphs, y.glyphs);
      same(x.colours, y.colours);
    }
  } else {
    const x = renderScene(scene, 10, 100, 30, 5), y = renderScene(scene, 10, 100, 30, 6);
    assert.notDeepEqual(Array.from(x.glyphs), Array.from(y.glyphs), 'seed matters');
  }
}

export function checkSizes(scene, paletteLength) {
  for (const [w, h] of SIZES) {
    for (const t of [0, 1.7, 40]) {
      const f = renderScene(scene, t, w, h, 1);
      assert.equal(f.glyphs.length, w * h, `${w}x${h}`);
      assert.equal(f.colours.length, w * h);
      assert.ok(f.glyphs instanceof Uint16Array && f.colours instanceof Uint8Array);
      for (let i = 0; i < f.glyphs.length; i++) {
        assert.ok(isAllowedGlyph(f.glyphs[i]), `${w}x${h} t=${t} cell ${i}: ${hex(f.glyphs[i])}`);
        assert.ok(f.colours[i] < paletteLength, `${w}x${h} colour ${f.colours[i]} >= ${paletteLength}`);
      }
    }
  }
}

export function checkGlyphWidth(scene) {
  const seen = new Set();
  for (const [w, h] of [[120, 40], [30, 10], [80, 24]]) {
    for (const seed of [1, 2, 3]) {
      for (const t of [0, 2, 7, 15, 33]) for (const g of renderScene(scene, t, w, h, seed).glyphs) seen.add(g);
    }
  }
  for (const cp of seen) {
    assert.ok(cp < 0x10000, `${hex(cp)} outside BMP`);
    assert.ok(!isWide(cp), `${hex(cp)} is Wide/Fullwidth`);
    assert.ok(!isInvisible(cp), `${hex(cp)} is invisible/zero-width`);
    assert.ok(isAllowedGlyph(cp), `${hex(cp)} not in the allow-list`);
  }
  assert.ok(seen.size >= 2, 'draws at least two different glyphs');
}

export function checkBufferFill(scene) {
  const g = new Uint16Array(60 * 20).fill(0x1f), c = new Uint8Array(60 * 20).fill(200);
  const out = renderScene(scene, 5, 60, 20, 1, g, c);
  assert.equal(out.glyphs, g);
  assert.equal(out.colours, c);
  const fresh = renderScene(scene, 5, 60, 20, 1);
  same(g, fresh.glyphs);
  same(c, fresh.colours);
}

// Sampled over several times (a text scene holds one card for seconds, so two fixed times can match).
export function checkVisibleAndChanging(scene) {
  const lit = (f) => f.glyphs.reduce((n, v) => n + (v !== 32 ? 1 : 0), 0);
  const sig = (f) => Array.from(f.glyphs).join(',') + '|' + Array.from(f.colours).join(',');
  let best = 0;
  const sigs = new Set();
  for (const t of [1, 2, 4, 6, 9, 13, 20, 30]) {
    const f = renderScene(scene, t, 120, 40, 1);
    const n = lit(f);
    assert.ok(n < 120 * 40 * 0.9, `t=${t}: not a solid wall (lit ${n})`);
    best = Math.max(best, n);
    sigs.add(sig(f));
  }
  assert.ok(best > 20, `draws something visible (most lit cells ${best})`);
  assert.ok(sigs.size >= 2, 'frames at different times differ');
}

function assertSpaced(times, what) {
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 3, `${what}: flashes at ${times[i - 1]} s and ${times[i]} s`);
}

function runSolo(scene, W, H, secs) {
  const cc = createCellComposer({ scenes: [scene], cols: W, rows: H, seed: 1 });
  const frames = [];
  for (let k = 0; k < secs * FPS; k++) frames.push(snap(cc.frame({ a: 0, b: 0, p: 0 }, k / FPS)));
  return frames;
}

// 60 s alone: no flash closer than 3 s, and at most one in the minute.
export function checkSoloFlash(scene, { seconds = 60, sizes = [[120, 40], [80, 24]] } = {}) {
  for (const [W, H] of sizes) {
    const times = flashTimesOf(runSolo(scene, W, H, seconds), FPS);
    assertSpaced(times, `${scene.id} ${W}x${H}`);
    assert.ok(times.length <= 1, `${scene.id} ${W}x${H}: ${times.length} flashes in ${seconds} s`);
  }
}

// The dissolve from A to B (one direction) over 60 s at 120x40.
export function checkPairFlash(A, B, { seconds = 60, W = 120, H = 40 } = {}) {
  const cc = createCellComposer({ scenes: [A, B], cols: W, rows: H, seed: 1 });
  const sched = new Scheduler({ count: 2, durationSec: 12, fadeSec: 2, start: 0 });
  const frames = [];
  for (let k = 0; k < seconds * FPS; k++) {
    sched.advance(1 / FPS);
    frames.push(snap(cc.frame(sched.state(), k / FPS)));
  }
  assertSpaced(flashTimesOf(frames, FPS), `${A.id} -> ${B.id}`);
}

// ---- field scenes (the calm contract)

function maxDiff(a, b) { let m = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; } return m; }
function sumDiff(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s; }

export function maxFieldStep(scene, w, h, params, timeScale = 1) {
  let worst = 0;
  for (let t0 = 0; t0 < 60; t0 += 0.7) {
    worst = Math.max(worst, maxDiff(scene(t0 * timeScale, w, h, params), scene((t0 + 1 / FPS) * timeScale, w, h, params)));
  }
  return worst;
}

export function checkFieldContract(scene, { maxStep = MAX_FIELD_STEP } = {}) {
  assert.equal(typeof scene, 'function');
  for (const t of [0, 3.3, 77.7]) same(scene(t, 100, 30, { seed: 5 }), scene(t, 100, 30, { seed: 5 }));
  assert.notDeepEqual(Array.from(scene(10, 100, 30, { seed: 5 })), Array.from(scene(10, 100, 30, { seed: 6 })), 'seed matters');
  const g = scene(12.5, 120, 40, { seed: 1 });
  assert.ok(g instanceof Uint8Array);
  assert.equal(g.length, 120 * 40);
  assert.ok(Math.max(...g) >= 100, 'reaches a visible peak');
  for (const t of [0, 1e6, 123456.789]) {
    const f = scene(t, 120, 40, { seed: 1 });
    assert.ok(Math.max(...f) >= 100, `t=${t}: no NaN collapse`);
    assert.ok(f.filter((v) => v > 0).length >= 20, `t=${t}: lit cells`);
  }
  assert.equal(scene(4, 1, 1, {}).length, 1);
  assert.equal(scene(4, 20, 5, {}).length, 100);
  assert.equal(scene(4, 0, 0, {}).length, 0);
  assert.equal(scene(4, 0, 9, {}).length, 0);
  assert.equal(scene(4, 9, 0, {}).length, 0);
  assert.equal(scene(4, 2, 2).length, 4);
  for (const seed of [1, 7]) {
    const worst = maxFieldStep(scene, 120, 40, { seed });
    assert.ok(worst <= maxStep, `${scene.id} seed ${seed}: max step ${worst} > ${maxStep}`);
  }
  const a = Array.from(scene(10, 90, 30, { seed: 3 }));
  scene(2, 90, 30, { seed: 3 });
  same(a, scene(10, 90, 30, { seed: 3 }));
  const out = new Uint8Array(60 * 20).fill(77);
  const r = scene(9, 60, 20, { seed: 2, out });
  assert.equal(r, out);
  same(r, scene(9, 60, 20, { seed: 2 }));
  assert.ok(sumDiff(scene(1, 120, 40, { seed: 1 }), scene(30, 120, 40, { seed: 1 })) > 2000, 'changes over time');
}

// The crossfade from A to B: at most `limit` of the cells change glyph or shade in any one frame.
// Returns the worst share seen. fadeSeconds is the program's.
export function crossfadeWorst(A, B, { fadeSeconds = 15, W = 120, H = 40 } = {}) {
  const cc = createComposer({ scenes: [A, B], cols: W, rows: H, seed: 1 });
  const sched = new Scheduler({ count: 2, durationSec: 2, fadeSec: fadeSeconds, start: 0 });
  let prev = null, worst = 0;
  const total = Math.ceil((2 + fadeSeconds + 1) * FPS);
  for (let k = 0; k < total; k++) {
    sched.advance(1 / FPS);
    const f = snap(cc.frame(sched.state(), k / FPS));
    if (prev) {
      let n = 0;
      for (let i = 0; i < f.g.length; i++) if (f.g[i] !== prev.g[i] || f.c[i] !== prev.c[i]) n++;
      worst = Math.max(worst, n / f.g.length);
    }
    prev = f;
  }
  return worst;
}

export function checkCrossfade(A, B, { fadeSeconds = 15, limit = CROSSFADE_LIMIT } = {}) {
  const worst = crossfadeWorst(A, B, { fadeSeconds });
  assert.ok(worst <= limit, `${A.id} -> ${B.id}: ${(worst * 100).toFixed(2)}% of cells changed in one frame, limit ${(limit * 100).toFixed(1)}%`);
}
