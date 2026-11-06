import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENES } from '../src/scenes/index.js';

const FPS = 18;
const DT = 1 / FPS;

// Stated slowness bound per scene: the largest allowed change of any single
// cell (0..255) between two frames 1/18 s apart, measured at 120x40.
const BOUND = { squiggle: 8, sunburst: 7, plasma: 3, ripples: 9, rain: 10 };

const ids = SCENES.map((s) => s.id);

function maxDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}
function sumDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s;
}
function maxStep(scene, w, h, params, timeScale = 1) {
  let worst = 0;
  for (let t0 = 0; t0 < 60; t0 += 0.7) {
    const a = scene(t0 * timeScale, w, h, params);
    const b = scene((t0 + DT) * timeScale, w, h, params);
    worst = Math.max(worst, maxDiff(a, b));
  }
  return worst;
}

test('there are exactly the five scenes, in order', () => {
  assert.deepEqual(ids, ['squiggle', 'sunburst', 'plasma', 'ripples', 'rain']);
});

for (const scene of SCENES) {
  const id = scene.id;
  test(`${id}: S1 determinism (same inputs twice -> identical)`, () => {
    for (const t of [0, 3.3, 77.7]) {
      const a = scene(t, 100, 30, { seed: 5 });
      const b = scene(t, 100, 30, { seed: 5 });
      assert.deepEqual(Array.from(a), Array.from(b));
    }
  });

  test(`${id}: S2/S3 dims are w*h and values live in 0..255`, () => {
    const g = scene(12.5, 120, 40, { seed: 1 });
    assert.ok(g instanceof Uint8Array);
    assert.equal(g.length, 120 * 40);
    let max = 0;
    for (const v of g) { assert.ok(v >= 0 && v <= 255); if (v > max) max = v; }
    assert.ok(max >= 100, `scene should reach a visible peak, got ${max}`);
  });

  test(`${id}: S4 no NaN/Infinity at t=0 and t=1e6 (output is real, not zero-filled)`, () => {
    for (const t of [0, 1e6, 123456.789]) {
      const g = scene(t, 120, 40, { seed: 1 });
      let max = 0, nonzero = 0;
      for (const v of g) { if (v > max) max = v; if (v > 0) nonzero++; }
      assert.ok(max >= 100, `t=${t}: max ${max} (NaN would collapse to 0)`);
      assert.ok(nonzero >= 20, `t=${t}: only ${nonzero} lit cells`);
    }
  });

  test(`${id}: S5 tiny and zero sizes do not throw and have correct dims`, () => {
    assert.equal(scene(4, 1, 1, {}).length, 1);
    assert.equal(scene(4, 20, 5, {}).length, 100);
    assert.equal(scene(4, 0, 0, {}).length, 0);
    assert.equal(scene(4, 0, 9, {}).length, 0);
    assert.equal(scene(4, 9, 0, {}).length, 0);
    assert.equal(scene(4, 2, 2).length, 4); // params omitted
  });

  test(`${id}: S6 slowness: no cell changes by more than ${BOUND[id]} per 1/18 s`, () => {
    for (const seed of [1, 7]) {
      const worst = maxStep(scene, 120, 40, { seed });
      assert.ok(worst <= BOUND[id], `${id} seed ${seed}: max step ${worst} > ${BOUND[id]}`);
    }
  });

  test(`${id}: S6 negative control: the same scene sped up 50x breaks the bound`, () => {
    const worst = maxStep(scene, 120, 40, { seed: 1 }, 50);
    assert.ok(worst > BOUND[id], `${id}: 50x speed only reached ${worst}; the bound would not bite`);
  });

  test(`${id}: S7 stateless: t=10, t=2, t=10 gives identical t=10 frames`, () => {
    const a = Array.from(scene(10, 90, 30, { seed: 3 }));
    scene(2, 90, 30, { seed: 3 });
    const b = Array.from(scene(10, 90, 30, { seed: 3 }));
    assert.deepEqual(a, b);
  });

  test(`${id}: S7 reuses a supplied output buffer without changing the result`, () => {
    const out = new Uint8Array(60 * 20).fill(77);
    const a = scene(9, 60, 20, { seed: 2, out });
    assert.equal(a, out);
    assert.deepEqual(Array.from(a), Array.from(scene(9, 60, 20, { seed: 2 })));
  });

  test(`${id}: S8 changes over time`, () => {
    const a = scene(1, 120, 40, { seed: 1 });
    const b = scene(30, 120, 40, { seed: 1 });
    assert.ok(sumDiff(a, b) > 2000, `diff ${sumDiff(a, b)}`);
  });
}

test('S7 seeded scenes: same seed -> same, different seed -> different (ripples, rain)', () => {
  for (const id of ['ripples', 'rain']) {
    const scene = SCENES.find((s) => s.id === id);
    const a = scene(25, 120, 40, { seed: 11 });
    const a2 = scene(25, 120, 40, { seed: 11 });
    const b = scene(25, 120, 40, { seed: 12 });
    assert.deepEqual(Array.from(a), Array.from(a2), `${id} same seed`);
    assert.ok(sumDiff(a, b) > 3000, `${id} different seed should differ, diff ${sumDiff(a, b)}`);
  }
});

test('S8 the five scenes are pairwise distinct', () => {
  const frames = SCENES.map((s) => s(40, 120, 40, { seed: 1 }));
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      assert.ok(sumDiff(frames[i], frames[j]) > 5000, `${ids[i]} vs ${ids[j]}`);
    }
  }
});

test('squiggle supplies braille masks through params.glyphs; others leave them zero', () => {
  const sq = SCENES.find((s) => s.id === 'squiggle');
  const glyphs = new Uint8Array(120 * 40).fill(9);
  const out = sq(30, 120, 40, { seed: 1, glyphs });
  let masks = 0;
  for (let i = 0; i < glyphs.length; i++) if (glyphs[i]) { masks++; assert.ok(out[i] > 0, 'a braille cell must be lit'); }
  assert.ok(masks > 40, `expected a visible braille line, got ${masks} cells`);
  const g2 = new Uint8Array(120 * 40);
  sq(30, 120, 40, { seed: 1, glyphs: g2 });
  assert.deepEqual(Array.from(glyphs), Array.from(g2), 'masks are deterministic');
  assert.equal(SCENES.filter((s) => s.glyphs).length, 1);
});
