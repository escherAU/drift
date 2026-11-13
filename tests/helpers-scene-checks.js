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
import { flashTimesOf, snap, createFlashMeter, RULE_IDS, ruleOf } from './helpers-flash.js';
import { RGB_CELL, PALETTE_BG } from '../src/renderer.js';
import { makePalette } from '../src/color.js';

// Full-colour scenes (DRIFT-7 C4b). A scene with rgb: true gets extra rules, each in the check it belongs to:
//   checkSizes        colour 255 (RGB_CELL) is allowed; fg and bg of those cells are <= 0xFFFFFF (bg may be PALETTE_BG).
//   checkDeterminism, checkBufferFill, checkVisibleAndChanging   fg and bg are compared as well as glyphs and colours.
//   checkSoloFlash, checkPairFlash   judged by the full-colour flash meter (createFlashMeter) over the same frames; palette
//                     cells in the frame resolve through METER_PALETTE (override with { palette }).
// Palette scenes (no rgb flag) go through the code they always did.
export const METER_PALETTE = makePalette([200, 100, 50], 'truecolor');

export const FPS = 18;
export const SIZES = [[120, 40], [240, 67], [80, 24], [1, 1], [0, 0], [2, 200]];
export const MAX_FIELD_STEP = 12; // per cell, 0..255, between two frames 1/18 s apart
export const CROSSFADE_LIMIT = 0.075; // share of cells that may change glyph or shade in one frame of a crossfade

const hex = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
const same = (a, b) => assert.deepEqual(Array.from(a), Array.from(b));
const isRgb = (scene) => scene && scene.rgb === true;
// Two renders of an rgb scene agree on glyphs and colours, and on fg and bg of every full-colour cell
// (the colours of a palette cell are in the palette, so its fg/bg are not asked about).
function sameRgbFrame(a, b, what) {
  same(a.glyphs, b.glyphs);
  same(a.colours, b.colours);
  for (let i = 0; i < a.glyphs.length; i++) {
    if (a.colours[i] !== RGB_CELL) continue;
    assert.equal(a.fg[i], b.fg[i], `${what}: fg of cell ${i}`);
    assert.equal(a.bg[i], b.bg[i], `${what}: bg of cell ${i}`);
  }
}

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
    if (isRgb(scene)) sameRgbFrame(a, b, `t=${t}`);
  }
  if (seedIndependent) {
    for (const t of [0, 1, 2, 5, 10, 20]) {
      const x = renderScene(scene, t, 100, 30, 5), y = renderScene(scene, t, 100, 30, 6);
      same(x.glyphs, y.glyphs);
      same(x.colours, y.colours);
      if (isRgb(scene)) sameRgbFrame(x, y, `seed t=${t}`);
    }
  } else {
    const x = renderScene(scene, 10, 100, 30, 5), y = renderScene(scene, 10, 100, 30, 6);
    if (isRgb(scene)) {
      // a full-colour scene may let the seed move only its colours
      const sig = (f) => Array.from(f.glyphs).join(',') + '|' + Array.from(f.fg).join(',') + '|' + Array.from(f.bg).join(',');
      assert.notEqual(sig(x), sig(y), 'seed matters');
    } else {
      assert.notDeepEqual(Array.from(x.glyphs), Array.from(y.glyphs), 'seed matters');
    }
  }
}

export function checkSizes(scene, paletteLength) {
  for (const [w, h] of SIZES) {
    for (const t of [0, 1.7, 40]) {
      const f = renderScene(scene, t, w, h, 1);
      assert.equal(f.glyphs.length, w * h, `${w}x${h}`);
      assert.equal(f.colours.length, w * h);
      assert.ok(f.glyphs instanceof Uint16Array && f.colours instanceof Uint8Array);
      const rgb = isRgb(scene);
      if (rgb) assert.ok(f.fg instanceof Uint32Array && f.bg instanceof Uint32Array && f.fg.length === w * h && f.bg.length === w * h);
      for (let i = 0; i < f.glyphs.length; i++) {
        assert.ok(isAllowedGlyph(f.glyphs[i]), `${w}x${h} t=${t} cell ${i}: ${hex(f.glyphs[i])}`);
        if (rgb && f.colours[i] === RGB_CELL) {
          assert.ok(f.fg[i] <= 0xffffff, `${w}x${h} t=${t} cell ${i}: fg ${f.fg[i].toString(16)} > 0xFFFFFF`);
          assert.ok(f.bg[i] <= 0xffffff || f.bg[i] === PALETTE_BG, `${w}x${h} t=${t} cell ${i}: bg ${f.bg[i].toString(16)} > 0xFFFFFF and not PALETTE_BG`);
        } else {
          assert.ok(f.colours[i] < paletteLength, `${w}x${h} colour ${f.colours[i]} >= ${paletteLength}`);
        }
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

// A full-colour scene also gets fg/bg buffers full of stale values: it must write fg and bg of every full-colour cell
// (so the result equals a render into fresh buffers), and the same buffers reused at a different shape with the same
// cell count (30x40 after 60x20) must show nothing of the earlier call.
export function checkBufferFill(scene) {
  const rgb = isRgb(scene);
  const g = new Uint16Array(60 * 20).fill(0x1f), c = new Uint8Array(60 * 20).fill(200);
  const F = rgb ? new Uint32Array(60 * 20).fill(0xa5a5a5) : null, B = rgb ? new Uint32Array(60 * 20).fill(0x5a5a5a) : null;
  const out = renderScene(scene, 5, 60, 20, 1, g, c, F, B);
  assert.equal(out.glyphs, g);
  assert.equal(out.colours, c);
  const fresh = renderScene(scene, 5, 60, 20, 1);
  same(g, fresh.glyphs);
  same(c, fresh.colours);
  if (rgb) {
    assert.equal(out.fg, F);
    assert.equal(out.bg, B);
    sameRgbFrame(out, fresh, '60x20 into stale buffers');
    const out2 = renderScene(scene, 9, 30, 40, 1, g, c, F, B);
    assert.equal(out2.fg, F);
    const fresh2 = renderScene(scene, 9, 30, 40, 1);
    sameRgbFrame(out2, fresh2, '30x40 into the 60x20 buffers');
  }
}

// Sampled over several times (a text scene holds one card for seconds, so two fixed times can match).
// A full-colour scene may fill the screen with colour (a field of half blocks is 100% "lit"), so its wall rule is that the
// screen is not ONE flat cell look (same glyph, fg and bg everywhere); and its signature includes fg and bg, so glyphs that
// never change while the colours move are not frozen.
export function checkVisibleAndChanging(scene) {
  const rgb = isRgb(scene);
  const lit = (f) => f.glyphs.reduce((n, v) => n + (v !== 32 ? 1 : 0), 0);
  const sig = (f) => Array.from(f.glyphs).join(',') + '|' + Array.from(f.colours).join(',') + (rgb ? '|' + Array.from(f.fg).join(',') + '|' + Array.from(f.bg).join(',') : '');
  const looks = (f) => {
    const s = new Set();
    for (let i = 0; i < f.glyphs.length; i++) s.add(f.colours[i] === RGB_CELL ? `${f.glyphs[i]}|${f.fg[i]}|${f.bg[i]}` : `${f.glyphs[i]}|p${f.colours[i]}`);
    return s.size;
  };
  let best = 0;
  const sigs = new Set();
  for (const t of [1, 2, 4, 6, 9, 13, 20, 30]) {
    const f = renderScene(scene, t, 120, 40, 1);
    const n = lit(f);
    if (rgb) assert.ok(looks(f) > 1, `t=${t}: not one flat colour`);
    else assert.ok(n < 120 * 40 * 0.9, `t=${t}: not a solid wall (lit ${n})`);
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

// The full-colour verdict: runs `frames` (an iterable of composer frames, in order) through the flash meter and asserts
// every rule passes. The message names each failing rule, its worst fraction, and where it happened.
function assertMeterPasses(frames, W, H, palette, what) {
  const meter = createFlashMeter(W, H, FPS);
  for (const f of frames) meter.push(f, palette);
  const rep = meter.report();
  const rules = RULE_IDS.map((id) => [id, ruleOf(rep, id)]); // the shared list, rule C (colour flicker, DRIFT-8 C4) included
  const bad = rules.filter(([, r]) => !r.pass).map(([id, r]) => `${id} ${(r.worstFraction * 100).toFixed(1)}% > ${(r.limit * 100).toFixed(0)}% (frame ${r.details.frame})`);
  assert.ok(rep.pass && bad.length === 0, `${what}: flash meter fails ${bad.join('; ')}`);
}

function* soloFrames(scene, W, H, secs) {
  const cc = createCellComposer({ scenes: [scene], cols: W, rows: H, seed: 1 });
  for (let k = 0; k < secs * FPS; k++) yield cc.frame({ a: 0, b: 0, p: 0 }, k / FPS);
}

// 60 s alone: no flash closer than 3 s, and at most one in the minute. A full-colour scene instead passes the flash meter
// (every rule L1, L2, L3, R at 1x and 4x) over the same frames.
export function checkSoloFlash(scene, { seconds = 60, sizes = [[120, 40], [80, 24]], palette = METER_PALETTE } = {}) {
  for (const [W, H] of sizes) {
    if (isRgb(scene)) { assertMeterPasses(soloFrames(scene, W, H, seconds), W, H, palette, `${scene.id} ${W}x${H}`); continue; }
    const times = flashTimesOf(runSolo(scene, W, H, seconds), FPS);
    assertSpaced(times, `${scene.id} ${W}x${H}`);
    assert.ok(times.length <= 1, `${scene.id} ${W}x${H}: ${times.length} flashes in ${seconds} s`);
  }
}

// The dissolve from A to B (one direction) over 60 s at 120x40.
// If either scene is full-colour the dissolve frames (the composer's per-cell pick) go through the flash meter.
export function checkPairFlash(A, B, { seconds = 60, W = 120, H = 40, palette = METER_PALETTE } = {}) {
  const cc = createCellComposer({ scenes: [A, B], cols: W, rows: H, seed: 1 });
  const sched = new Scheduler({ count: 2, durationSec: 12, fadeSec: 2, start: 0 });
  if (isRgb(A) || isRgb(B)) {
    const frames = (function* () { for (let k = 0; k < seconds * FPS; k++) { sched.advance(1 / FPS); yield cc.frame(sched.state(), k / FPS); } })();
    assertMeterPasses(frames, W, H, palette, `${A.id} -> ${B.id}`);
    return;
  }
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
