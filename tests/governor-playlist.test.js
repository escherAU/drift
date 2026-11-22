// DRIFT-13 correction 1: the governor hands fg and bg through ungoverned (src/app.js govern()). That is safe only while no Classic high contrast scene has full-colour cells (`rgb: true`,
// shade RGB_CELL, colours in fg/bg): the governor works on (glyph, shade) alone and would hold a cell's glyph while its colours changed. Governing fg and bg was not chosen (it would be a second
// history per cell for a case that does not exist); this test is the guard instead: it fails the day a high contrast scene declares `rgb: true`, and says what to do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYLISTS } from '../src/scenes/index.js';
import { RGB_CELL } from '../src/renderer.js';
import { runSpied } from './helpers-governor-app.js';

const rgbScenes = (list) => list.filter((s) => s && s.rgb).map((s) => s.id);

test('DRIFT-13 no Classic high contrast scene declares rgb: true (the governor passes fg and bg through ungoverned)', () => {
  assert.deepEqual(rgbScenes(PLAYLISTS.contrast), [], 'a high contrast scene with rgb: true needs the governor to govern fg and bg too (src/app.js govern(), src/governor.js): make that change first, then take this test out');
  assert.equal(PLAYLISTS.contrast.length, 5, 'the high contrast playlist is the five scenes this test was written for (life, tunnel, wire, maze, blocktype): a new one is checked by the line above, update this count');
});

test('DRIFT-13 control: the guard notices a scene with rgb: true', () => {
  assert.deepEqual(rgbScenes([...PLAYLISTS.contrast, { id: 'fake', rgb: true }]), ['fake']);
});

test('DRIFT-13 in the real app no governed frame has a full-colour cell (the only way fg and bg reach the renderer) (life, its dissolve and the tunnel, 40x10 and 80x24)', async () => {
  for (const [cols, rows] of [[40, 10], [80, 24]]) {
    let paints = 0, rgbCells = 0;
    await runSpied({ cols, rows, fps: 18, seed: 1, clock: 'grid', clockSeed: 1, seconds: 36, sceneSeconds: 30, feedAll: true, stopAtDissolve: false, meter: false }, {
      onPaint: (f) => { paints++; for (let i = 0; i < f.shades.length; i++) if (f.shades[i] === RGB_CELL) rgbCells++; },
    });
    assert.ok(paints > 18 * 30, `${cols}x${rows}: the run painted (${paints})`);
    assert.equal(rgbCells, 0, `${cols}x${rows}: no cell had the full-colour shade`);
  }
});
