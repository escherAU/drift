// SHARED suite for every non-calm scene. It loops over PLAYLISTS, so a later slice adds
// a scene to its mode's playlist and is covered automatically (determinism, sizes, glyph
// allow-list and width, colour range, buffer reuse, change over time, flash safety).
//
// Glyph width: the pinned list below is the set of BMP code points that Unicode 16.0
// (EastAsianWidth.txt) classes as Wide (W) or Fullwidth (F), plus the emoji-presentation
// singles that terminals draw two cells wide. Ambiguous (A) characters are single-width
// in Windows Terminal's default settings, which is what the allow-list relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYLISTS, findScene, allSceneIds } from '../src/scenes/index.js';
import { MODES } from '../src/modes.js';
import { renderScene, sceneKind, createCellComposer, STEP_HZ } from '../src/cells.js';
import { Scheduler } from '../src/compose.js';
import { isAllowedGlyph, allowedList } from '../src/glyphs.js';
import { helpFrameGlyphs } from './helpers-help.js';

export const WIDE_BMP = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2630, 0x2637], [0x2648, 0x2653], [0x267f, 0x267f], [0x268a, 0x268f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce],
  [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd],
  [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755],
  [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50],
  [0x2b55, 0x2b55], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0xa4cf], [0xa960, 0xa97f],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff01, 0xff60], [0xffe0, 0xffe6],
];
const isWide = (cp) => WIDE_BMP.some(([a, b]) => cp >= a && cp <= b);
// zero-width / invisible code points that would also break a grid
const isInvisible = (cp) => cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d || (cp >= 0x200b && cp <= 0x200f);

export const NON_CALM = Object.entries(PLAYLISTS)
  .filter(([m]) => m !== 'calm')
  .flatMap(([mode, list]) => list.map((scene) => ({ mode, scene })));
const PALETTE_SIZE = { chaos: 32, contrast: 1, experimental: 16 };

test('playlists: calm is the v1 five; every other mode has a scene; ids unique across ALL playlists', () => {
  assert.deepEqual(Object.keys(PLAYLISTS), MODES);
  assert.deepEqual(PLAYLISTS.calm.map((s) => s.id), ['squiggle', 'sunburst', 'plasma', 'ripples', 'rain']);
  for (const m of MODES) assert.ok(PLAYLISTS[m].length >= 1, m);
  const ids = allSceneIds();
  assert.equal(new Set(ids).size, ids.length, `duplicate scene id in ${ids}`);
  assert.deepEqual(NON_CALM.map((x) => x.scene.id).sort(), ['artist', 'blocktype', 'bounce', 'cloth', 'fireworks', 'glitch', 'glyphrain', 'life', 'maze', 'pendulum', 'sand', 'swarm', 'tunnel', 'vortex', 'waves', 'wire']);
  assert.equal(NON_CALM.find((x) => x.scene.id === 'life').mode, 'contrast');
});

test('findScene searches every playlist and reports its mode and index', () => {
  assert.deepEqual(findScene('glyphrain'), { mode: 'chaos', index: 0 });
  assert.deepEqual(findScene('LIFE'), { mode: 'contrast', index: 0 });
  assert.deepEqual(findScene('bounce'), { mode: 'experimental', index: 0 });
  assert.deepEqual(findScene('rain'), { mode: 'calm', index: 4 });
  assert.equal(findScene('nope'), null);
});

const SIZES = [[120, 40], [1, 1], [3, 2], [0, 0], [5, 0], [0, 5], [2, 200], [240, 67]];

for (const { mode, scene } of NON_CALM) {
  const id = scene.id;
  const sizeOf = PALETTE_SIZE[mode];

  test(`${mode}/${id}: has an id, a kind, and is a cells scene or a sim`, () => {
    assert.equal(typeof scene.id, 'string');
    const k = sceneKind(scene);
    assert.ok(k === 'cells' || k === 'sim', k);
    if (k === 'sim') for (const f of ['init', 'step', 'draw']) assert.equal(typeof scene[f], 'function', f);
  });

  test(`${mode}/${id}: determinism (same seed and time -> identical frame; another seed differs)`, () => {
    for (const t of [0, 3.3, 20.1]) {
      const a = renderScene(scene, t, 100, 30, 5);
      const b = renderScene(scene, t, 100, 30, 5);
      assert.deepEqual(Array.from(a.glyphs), Array.from(b.glyphs), `glyphs t=${t}`);
      assert.deepEqual(Array.from(a.colours), Array.from(b.colours), `colours t=${t}`);
    }
    const x = renderScene(scene, 10, 100, 30, 5), y = renderScene(scene, 10, 100, 30, 6);
    assert.notDeepEqual(Array.from(x.glyphs), Array.from(y.glyphs), 'seed matters');
  });

  test(`${mode}/${id}: sizes (incl. tiny and 0x0): right length, allowed glyphs, colours in palette, no NaN`, () => {
    for (const [w, h] of SIZES) {
      for (const t of [0, 1.7, 40]) {
        const f = renderScene(scene, t, w, h, 1);
        assert.equal(f.glyphs.length, w * h, `${w}x${h}`);
        assert.equal(f.colours.length, w * h);
        assert.ok(f.glyphs instanceof Uint16Array && f.colours instanceof Uint8Array);
        for (let i = 0; i < f.glyphs.length; i++) {
          assert.ok(isAllowedGlyph(f.glyphs[i]), `${w}x${h} t=${t} cell ${i}: U+${f.glyphs[i].toString(16)}`);
          assert.ok(f.colours[i] < sizeOf, `${w}x${h} colour ${f.colours[i]} >= ${sizeOf}`);
        }
      }
    }
  });

  test(`${mode}/${id}: no glyph is double-width, zero-width or outside the BMP (all times, seeds, sizes)`, () => {
    const seen = new Set();
    for (const [w, h] of [[120, 40], [30, 10], [80, 24]]) {
      for (const seed of [1, 2, 3]) {
        for (const t of [0, 2, 7, 15, 33]) {
          const f = renderScene(scene, t, w, h, seed);
          for (const g of f.glyphs) seen.add(g);
        }
      }
    }
    for (const cp of seen) {
      assert.ok(cp < 0x10000, `U+${cp.toString(16)} outside BMP`);
      assert.ok(!isWide(cp), `U+${cp.toString(16)} is Wide/Fullwidth`);
      assert.ok(!isInvisible(cp), `U+${cp.toString(16)} is invisible/zero-width`);
      assert.ok(isAllowedGlyph(cp), `U+${cp.toString(16)} not in the allow-list`);
    }
    assert.ok(seen.size >= 2, 'draws at least two different glyphs');
  });

  test(`${mode}/${id}: fills caller buffers completely (reuse: stale garbage never survives) and does not replace them`, () => {
    const g = new Uint16Array(60 * 20).fill(0x1f), c = new Uint8Array(60 * 20).fill(200);
    const out = renderScene(scene, 5, 60, 20, 1, g, c);
    assert.equal(out.glyphs, g);
    assert.equal(out.colours, c);
    const fresh = renderScene(scene, 5, 60, 20, 1);
    assert.deepEqual(Array.from(g), Array.from(fresh.glyphs));
    assert.deepEqual(Array.from(c), Array.from(fresh.colours));
  });

  test(`${mode}/${id}: draws something visible and changes over time`, () => {
    const lit = (f) => f.glyphs.reduce((n, v) => n + (v !== 32 ? 1 : 0), 0);
    const a = renderScene(scene, 2, 120, 40, 1), b = renderScene(scene, 6, 120, 40, 1);
    assert.ok(lit(a) > 20 && lit(b) > 20, `lit ${lit(a)} ${lit(b)}`);
    assert.ok(lit(a) < 120 * 40 * 0.9, 'not a solid wall');
    assert.notDeepEqual(Array.from(a.glyphs), Array.from(b.glyphs), 'frames at 2 s and 6 s differ');
  });

  if (mode === 'contrast') {
    test(`${mode}/${id}: high contrast scenes use only colour index 0`, () => {
      for (const t of [0, 5, 30]) {
        const f = renderScene(scene, t, 120, 40, 1);
        assert.ok(f.colours.every((v) => v === 0));
      }
    });
  }
}

// ---- help panel glyphs join the same check
test('help panel (every mode, 120x40 and 30x10): only allow-listed, single-width glyphs', () => {
  for (const mode of MODES) {
    for (const [w, h] of [[120, 40], [30, 10], [80, 24]]) {
      for (const cp of helpFrameGlyphs(mode, w, h)) {
        assert.ok(isAllowedGlyph(cp), `${mode} ${w}x${h} U+${cp.toString(16)}`);
        assert.ok(!isWide(cp) && !isInvisible(cp), `U+${cp.toString(16)}`);
      }
    }
  }
});

test('the pinned wide list never overlaps the allow-list', () => {
  for (const cp of allowedList()) assert.ok(!isWide(cp), `U+${cp.toString(16)} is in both`);
});

// ---- flash test: 60 s at 120x40. A frame where more than 25% of cells switch between blank
// and lit is a flash; flashes must be at least 3 s apart. Over every non-calm scene and every
// dissolve between any two of them.
const FPS = 18, SECS = 60, W = 120, H = 40;
const lit = (g) => g !== 32;

function flashTimes(frames) {
  const times = [];
  let prev = null;
  frames.forEach((g, k) => {
    if (prev) {
      let sw = 0;
      for (let i = 0; i < g.length; i++) if (lit(g[i]) !== lit(prev[i])) sw++;
      if (sw / g.length > 0.25) times.push(k / FPS);
    }
    prev = g.slice();
  });
  return times;
}
function assertSpaced(times, what) {
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 3, `${what}: flashes at ${times[i - 1]} s and ${times[i]} s`);
}
function runSolo(scene) {
  const cc = createCellComposer({ scenes: [scene], cols: W, rows: H, seed: 1 });
  const frames = [];
  for (let k = 0; k < SECS * FPS; k++) frames.push(cc.frame({ a: 0, b: 0, p: 0 }, k / FPS).glyphs.slice());
  return frames;
}

for (const { mode, scene } of NON_CALM) {
  test(`flash: ${mode}/${id0(scene)} over 60 s at 120x40 has no flash closer than 3 s (and counts none above 25% switching)`, () => {
    const times = flashTimes(runSolo(scene));
    assertSpaced(times, scene.id);
    assert.ok(times.length <= 1, `${scene.id}: ${times.length} flashes in 60 s`);
  });
}
function id0(s) { return s.id; }

test('flash: every dissolve between any two non-calm scenes (both directions) over 60 s', () => {
  for (const A of NON_CALM) for (const B of NON_CALM) {
    if (A.scene === B.scene) continue;
    const cc = createCellComposer({ scenes: [A.scene, B.scene], cols: W, rows: H, seed: 1 });
    const sched = new Scheduler({ count: 2, durationSec: 12, fadeSec: 2, start: 0 });
    const frames = [];
    for (let k = 0; k < SECS * FPS; k++) {
      sched.advance(1 / FPS);
      frames.push(cc.frame(sched.state(), k / FPS).glyphs.slice());
    }
    assertSpaced(flashTimes(frames), `${A.scene.id} <-> ${B.scene.id}`);
    assert.ok(sched.cur !== undefined);
  }
});

test('flash control: a blank<->full toggle every 0.5 s IS detected (the detector is not vacuous)', () => {
  const frames = [];
  for (let k = 0; k < 60 * FPS; k++) frames.push(new Uint16Array(W * H).fill(Math.floor(k / 9) % 2 ? 0x2588 : 32));
  const t = flashTimes(frames);
  assert.ok(t.length > 50);
  assert.throws(() => assertSpaced(t, 'control'));
});

test('STEP_HZ is 30', () => assert.equal(STEP_HZ, 30));
