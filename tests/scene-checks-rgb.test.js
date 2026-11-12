// DRIFT-7 C4b: the full-colour branches of the per-scene checks (tests/helpers-scene-checks.js). A scene with
// rgb: true is judged on its fg/bg as well as its glyphs and palette shades, and on the full-colour flash meter
// (tests/helpers-flash.js) instead of the changed-cells fraction. Palette scenes are judged exactly as before.
// Every rule has a must-fail control (assert.throws) and a must-pass twin.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIZES, checkKind, checkDeterminism, checkSizes, checkGlyphWidth, checkBufferFill, checkVisibleAndChanging,
  checkSoloFlash, checkPairFlash,
} from './helpers-scene-checks.js';
import {
  kaleidoscope, hueSweep, colourDrift, frozenRgb, nondeterministicFg, strobingRgb, writes255, wideField, paletteBgScene,
  partialWriter, paletteScribbler, paletteStrobe, landscapeOnly, portraitOnly, flatRgb, seedFg, nondeterministicSeedFg,
} from './helpers-rgb-scenes.js';
import { renderScene } from '../src/cells.js';
import { makePlain } from './helpers-fullcolour.js';

const PAL = 36; // a palette length smaller than 255

// ---- the safeHue kaleidoscope passes every check at every size

test('rgb kaleidoscope (safeHue) passes kind, determinism, sizes, glyph width, buffer fill, visible-and-changing', () => {
  const scene = kaleidoscope();
  checkKind({ id: scene.id, kind: 'cells', scene });
  checkDeterminism(scene, { seedIndependent: true });
  checkSizes(scene, PAL);
  checkGlyphWidth(scene);
  checkBufferFill(scene);
  checkVisibleAndChanging(scene);
});

test('rgb kaleidoscope passes checkSizes at all six SIZES (the list is unchanged)', () => {
  assert.deepEqual(SIZES, [[120, 40], [240, 67], [80, 24], [1, 1], [0, 0], [2, 200]]);
  const scene = kaleidoscope();
  for (const [w, h] of SIZES) checkSizes(scene, PAL); // checkSizes walks SIZES itself; this pins the list it walks
  assert.equal(SIZES.length, 6);
});

test('rgb kaleidoscope passes the solo flash check at 120x40 and 80x24 for 60 s', () => {
  checkSoloFlash(kaleidoscope());
});

test('rgb pair: kaleidoscope into the hue sweep passes the dissolve check; a palette scene into the kaleidoscope too', () => {
  checkPairFlash(kaleidoscope(), hueSweep(), { seconds: 30 });
  checkPairFlash(hueSweep(), kaleidoscope(), { seconds: 30 });
  checkPairFlash(makePlain(), kaleidoscope(), { seconds: 30 });
});

// ---- checkSizes

test('checkSizes: 255 is allowed only when the scene is rgb; a palette scene writing 255 fails', () => {
  checkSizes(writes255(true), PAL);
  assert.throws(() => checkSizes(writes255(false), PAL), /colour 255 >= 36/);
});

test('checkSizes: rgb fg and bg are at most 0xFFFFFF (bg may also be PALETTE_BG)', () => {
  checkSizes(wideField('fg', 0xffffff), PAL);
  checkSizes(wideField('bg', 0xffffff), PAL);
  checkSizes(paletteBgScene(), PAL);
  assert.throws(() => checkSizes(wideField('fg', 0x1000000), PAL), /fg/);
  assert.throws(() => checkSizes(wideField('fg', 0xffffffff), PAL), /fg/);
  assert.throws(() => checkSizes(wideField('bg', 0x1000001), PAL), /bg/);
});

test('checkSizes: a palette scene is not asked about fg/bg (behaviour unchanged)', () => {
  checkSizes(paletteScribbler(), PAL);
  checkSizes(makePlain(), PAL);
  assert.throws(() => checkSizes(makePlain(), 3), /colour 3 >= 3/);
});

// ---- checkDeterminism

test('checkDeterminism: fg that differs between two identical calls fails; fg that does not passes', () => {
  assert.throws(() => checkDeterminism(nondeterministicFg(), { seedIndependent: true }));
  checkDeterminism(colourDrift(), { seedIndependent: true });
});

test('checkDeterminism: each arm on its own - same-seed repeat, seed independence, and "the seed matters" through colour alone', () => {
  // same seed twice, different fg: caught by the repeat arm (the seed does move the colours, so "seed matters" is satisfied)
  assert.throws(() => checkDeterminism(nondeterministicSeedFg()), /fg of cell/);
  // different seeds, different fg: a scene that claims to ignore the seed is caught by the seed arm
  assert.throws(() => checkDeterminism(seedFg(), { seedIndependent: true }), /fg of cell/);
  // the same scene, honest about the seed: only colours change with it, and that counts as mattering
  checkDeterminism(seedFg());
  // a palette-style seed test still wants a glyph change: colour-blind code would reject seedFg()
  assert.throws(() => checkDeterminism(colourDrift()), /seed matters/);
});

// ---- checkBufferFill

test('checkBufferFill: a scene that leaves fg (or bg) of some cells unwritten fails', () => {
  assert.throws(() => checkBufferFill(partialWriter('fg')));
  assert.throws(() => checkBufferFill(partialWriter('bg')));
  assert.throws(() => checkBufferFill(landscapeOnly()), /30x40/, 'fine at 60x20, stale at 30x40 in the same buffers');
  assert.throws(() => checkBufferFill(portraitOnly()), /60x20/, 'stale at 60x20 already');
  checkBufferFill(colourDrift());
  checkBufferFill(frozenRgb());
});

test('checkBufferFill: fg/bg buffers handed in come back as the same objects and are fully rewritten at another size', () => {
  checkBufferFill(kaleidoscope());
  checkBufferFill(hueSweep());
  checkBufferFill(makePlain()); // palette scene: still fine
});

// ---- checkVisibleAndChanging

test('checkVisibleAndChanging: glyphs frozen but fg/bg moving is NOT frozen; glyphs, fg and bg all frozen IS', () => {
  checkVisibleAndChanging(colourDrift());
  assert.throws(() => checkVisibleAndChanging(frozenRgb()), /differ/);
});

test('checkVisibleAndChanging: an rgb scene may fill the screen with colour, but not with one flat look', () => {
  // the kaleidoscope is a half block in nearly every cell (far over the 90% a palette scene is allowed) and passes
  const k = renderScene(kaleidoscope(), 4, 120, 40, 1);
  assert.ok(k.glyphs.filter((g) => g !== 32).length > 120 * 40 * 0.9);
  checkVisibleAndChanging(kaleidoscope());
  assert.throws(() => checkVisibleAndChanging(flatRgb()), /flat/);
});

test('checkVisibleAndChanging: a palette scene is judged on glyphs and shades only, as before', () => {
  // the palette scribbler changes nothing: its (ignored) fg/bg do not count, so it is frozen
  assert.throws(() => checkVisibleAndChanging(paletteScribbler()), /differ/);
});

// ---- flash

test('checkSoloFlash: a strobing rgb scene fails and the message names the meter rule', () => {
  assert.throws(() => checkSoloFlash(strobingRgb(), { seconds: 10 }), /l1\.x1/);
  assert.throws(() => checkSoloFlash(strobingRgb(), { seconds: 10 }), /l2\.x1/);
  checkSoloFlash(colourDrift(), { seconds: 10 });
});

test('checkSoloFlash: a palette scene keeps the changed-cells path (its message is about flashes, not meter rules)', () => {
  assert.throws(() => checkSoloFlash(paletteStrobe(), { seconds: 10 }), /flashes/);
});

test('checkPairFlash: a dissolve into a strobing rgb scene fails through the meter', () => {
  assert.throws(() => checkPairFlash(kaleidoscope(), strobingRgb(), { seconds: 40 }), /l[123]\.x|r\.x/);
  // the full-colour scene is the SECOND one: still the meter
  assert.throws(() => checkPairFlash(makePlain(), strobingRgb(), { seconds: 40 }), /l1\.x1/);
  assert.throws(() => checkPairFlash(strobingRgb(), makePlain(), { seconds: 40 }), /l1\.x1/);
});
