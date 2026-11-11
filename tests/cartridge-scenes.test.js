// DRIFT-4: the per-scene suite for cartridge scenes. It discovers the INSTALL cartridges (never lists
// one by name, so Delza is picked up when she lands) and runs the same checks the shared non-calm suite
// runs, from tests/helpers-scene-checks.js: kind, determinism, seed (text scenes are exempt, and must be
// seed-independent), sizes, glyph allow-list and width, colour below the palette length, buffer fill,
// visible and changing, a 60 s solo flash check, the dissolve flash on every ordered pair WITHIN each
// cartridge (never across), and for field scenes the calm contract, the slowness bound and the 7.5%
// crossfade check on adjacent program pairs.
//
// Today the install folder holds Classic and three locked cartridges, none of which has scenes, so the
// install loop registers nothing but discovery. The checks themselves are proven live by running the
// same registration over a temporary trusted fixture cartridge (field, cells, sim, text, builtin), and by
// controls that each broken scene makes a check fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCartridges, loadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { sceneFamily } from '../src/cartridge/schema.js';
import { paletteLength } from '../src/cartridge/palette.js';
import {
  checkKind, checkDeterminism, checkSizes, checkGlyphWidth, checkBufferFill, checkVisibleAndChanging,
  checkSoloFlash, checkPairFlash, checkFieldContract, checkCrossfade, crossfadeWorst, maxFieldStep,
  MAX_FIELD_STEP, CROSSFADE_LIMIT,
} from './helpers-scene-checks.js';
import { tmpRoot, makeFixtureCartridge } from './helpers-cartridge.js';

// Register every check for one cartridge's loaded scenes. `entries` is loadScenes().scenes.
function registerSceneChecks(label, cart, entries) {
  const palLen = paletteLength(cart.skin);
  const cells = entries.filter((e) => sceneFamily(e) === 'cells');
  const fields = entries.filter((e) => sceneFamily(e) === 'field');

  for (const e of cells) {
    const name = `${label}/${e.id}`;
    const s = e.scene;
    test(`${name}: has an id, a kind, and is a cells scene or a sim`, () => checkKind(e));
    test(`${name}: determinism${e.kind === 'text' ? ' (a text scene is seed-independent)' : ' (another seed differs)'}`, () => checkDeterminism(s, { seedIndependent: e.kind === 'text' }));
    test(`${name}: sizes (120x40, 240x67, 80x24, 1x1, 0x0, 2x200): right length, allowed glyphs, colours below ${palLen}`, () => checkSizes(s, palLen));
    test(`${name}: no glyph is double-width, zero-width or outside the BMP`, () => checkGlyphWidth(s));
    test(`${name}: fills caller buffers completely and does not replace them`, () => checkBufferFill(s));
    test(`${name}: draws something visible and changes over time`, () => checkVisibleAndChanging(s));
    test(`${name}: 60 s solo has no flash closer than 3 s`, () => checkSoloFlash(s));
  }
  if (cells.length > 1) {
    test(`${label}: the dissolve between every ordered pair of its scenes (${cells.length * (cells.length - 1)} pairs) has no flash closer than 3 s`, () => {
      for (const A of cells) for (const B of cells) if (A !== B) checkPairFlash(A.scene, B.scene);
    });
  }
  for (const e of fields) {
    test(`${label}/${e.id}: field contract (0..255, seed, tiny sizes, stateless, buffer reuse) and step <= ${MAX_FIELD_STEP} per 1/18 s`, () => checkFieldContract(e.scene));
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const p of cart.manifest.programs.filter((x) => x.transition === 'crossfade')) {
    const ids = p.scenes;
    if (ids.length < 2) continue;
    test(`${label}/${p.id}: crossfade between adjacent scenes changes at most ${CROSSFADE_LIMIT * 100}% of cells per frame`, () => {
      for (let i = 0; i < ids.length; i++) checkCrossfade(byId.get(ids[i]).scene, byId.get(ids[(i + 1) % ids.length]).scene, { fadeSeconds: p.fadeSeconds });
    });
  }
}

// ---- the install cartridges

const found = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });

test('install cartridges: discovery finds Classic and the locked ones with no errors; none of them has scenes to check', () => {
  assert.deepEqual(found.errors, []);
  const ids = found.cartridges.map((c) => c.id);
  assert.ok(ids.includes('classic'), ids.join());
  const classic = found.cartridges.find((c) => c.id === 'classic');
  assert.equal(classic.runtime, 'classic');
  assert.equal(classic.manifest.scenes, undefined);
  for (const c of found.cartridges.filter((x) => x.locked)) assert.equal(c.manifest.scenes, undefined, c.id);
});

const installed = found.cartridges.filter((c) => !c.locked && c.runtime === 'cartridge');
for (const cart of installed) {
  const res = await loadScenes(cart);
  test(`install/${cart.id}: every scene loads (smoke render, ids, kinds)`, () => {
    assert.deepEqual(res.errors, []);
    assert.equal(res.scenes.length, cart.manifest.scenes.length);
  });
  registerSceneChecks(`install/${cart.id}`, cart, res.scenes);
}

// ---- the checks, proven live on a temporary trusted fixture cartridge

const fixtureRoot = tmpRoot('drift-fixture-');
makeFixtureCartridge(fixtureRoot);
const fx = discoverCartridges({ dirs: [{ dir: fixtureRoot, trusted: true }] });
const fixture = fx.cartridges[0];
const fxLoaded = await loadScenes(fixture);

test('fixture: the temp cartridge discovers and loads all seven scenes (field, field, cells, sim, text, builtin x2)', () => {
  assert.deepEqual(fx.errors, []);
  assert.deepEqual(fxLoaded.errors, []);
  assert.equal(fxLoaded.scenes.length, 7);
  assert.equal(paletteLength(fixture.skin), 18);
});

registerSceneChecks('fixture', fixture, fxLoaded.scenes);

const fxScene = (id) => fxLoaded.scenes.find((e) => e.id === id).scene;

// ---- controls: each check must fail on a scene built to break it

const cellsScene = (id, fn) => Object.assign(fn, { id, kind: 'cells' });
const fill = (cp, col) => (t, w, h, p) => { p.glyphs.fill(cp); p.colours.fill(col); };

test('control: a scene that draws U+2196, a wide glyph or a colour past the palette fails the size and width checks', () => {
  assert.throws(() => checkSizes(cellsScene('arrow', fill(0x2196, 0)), 16), /not|U\+2196|false/);
  assert.throws(() => checkSizes(cellsScene('wide', fill(0x4e00, 0)), 16));
  assert.throws(() => checkGlyphWidth(cellsScene('wide', fill(0x4e00, 0))), /Wide|allow-list/);
  assert.throws(() => checkSizes(cellsScene('loud', fill(0x41, 16)), 16), /colour 16 >= 16/);
  assert.doesNotThrow(() => checkSizes(cellsScene('quiet', fill(0x41, 15)), 16));
  assert.doesNotThrow(() => checkSizes(cellsScene('wide-palette', fill(0x41, 17)), 18));
  assert.throws(() => checkSizes(cellsScene('wide-palette', fill(0x41, 18)), 18));
});

test('control: the seed check bites both ways (a seed-blind scene fails unless it is a text scene)', () => {
  const blind = cellsScene('blind', (t, w, h, p) => { p.glyphs.fill(32); p.colours.fill(0); p.glyphs[0] = 0x41 + (Math.floor(t) % 5); });
  assert.throws(() => checkDeterminism(blind, { seedIndependent: false }), /seed matters/);
  assert.doesNotThrow(() => checkDeterminism(blind, { seedIndependent: true }));
  assert.throws(() => checkDeterminism(fxScene('tide'), { seedIndependent: true }), 'a scene that uses the seed is not seed-independent');
  assert.doesNotThrow(() => checkDeterminism(fxScene('note'), { seedIndependent: true }));
  assert.throws(() => checkDeterminism(fxScene('note'), { seedIndependent: false }), /seed matters/);
  const random = cellsScene('random', (t, w, h, p) => { p.glyphs.fill(0x41 + Math.floor(Math.random() * 20)); p.colours.fill(0); });
  assert.throws(() => checkDeterminism(random, { seedIndependent: false }));
});

test('control: a scene that leaves cells untouched, draws nothing, or never changes fails the buffer and visibility checks', () => {
  assert.throws(() => checkBufferFill(cellsScene('lazy', () => {})));
  assert.throws(() => checkVisibleAndChanging(cellsScene('blank', fill(32, 0))), /visible/);
  assert.throws(() => checkVisibleAndChanging(cellsScene('static', fill(0x41, 3))), /solid wall|differ/);
  const staticPartial = cellsScene('still', (t, w, h, p) => { p.glyphs.fill(32); p.colours.fill(0); for (let i = 0; i < 100; i++) { p.glyphs[i] = 0x41; p.colours[i] = 3; } });
  assert.throws(() => checkVisibleAndChanging(staticPartial), /differ/);
  assert.doesNotThrow(() => checkVisibleAndChanging(fxScene('drops')));
  assert.doesNotThrow(() => checkVisibleAndChanging(fxScene('note')), 'a text scene passes although its glyphs hold still while it fades');
});

test('control: a strobing scene fails the solo flash check and the dissolve flash check', () => {
  const strobe = cellsScene('strobe', (t, w, h, p) => { const on = Math.floor(t * 2) % 2 === 0; p.glyphs.fill(on ? 0x2588 : 32); p.colours.fill(on ? 5 : 0); });
  assert.throws(() => checkSoloFlash(strobe, { seconds: 20, sizes: [[40, 12]] }), /flashes/);
  assert.throws(() => checkPairFlash(strobe, fxScene('tide'), { seconds: 20, W: 40, H: 12 }), /flashes/);
  assert.doesNotThrow(() => checkSoloFlash(fxScene('tide'), { seconds: 20, sizes: [[40, 12]] }));
});

test('control: a field scene that moves too fast, returns the wrong size or the wrong type fails the contract', () => {
  const haze = fxScene('haze');
  assert.ok(maxFieldStep(haze, 120, 40, { seed: 1 }) <= MAX_FIELD_STEP);
  const fast = Object.assign((t, w, h, p) => haze(t * 50, w, h, p), { id: 'fast' });
  assert.ok(maxFieldStep(fast, 120, 40, { seed: 1 }) > MAX_FIELD_STEP, 'the bound bites at 50x');
  assert.throws(() => checkFieldContract(fast), /max step/);
  const short = Object.assign((t, w, h, p) => new Uint8Array(3), { id: 'short' });
  assert.throws(() => checkFieldContract(short));
  const floaty = Object.assign((t, w, h, p) => new Float32Array(Math.max(0, w) * Math.max(0, h)).fill(200), { id: 'floaty' });
  assert.throws(() => checkFieldContract(floaty));
  const nan = Object.assign((t, w, h, p) => { const o = new Uint8Array(Math.max(0, w) * Math.max(0, h)); o.fill(Math.sin(1 / (t - t)) * 100); return o; }, { id: 'nan' });
  assert.throws(() => checkFieldContract(nan));
});

test('control: the crossfade check passes slow fixture pairs and fails an abrupt one (the limit is 7.5%)', () => {
  assert.equal(CROSSFADE_LIMIT, 0.075);
  const haze = fxScene('haze'), swell = fxScene('swell'), plasma = fxScene('plasma-ref');
  for (const [a, b] of [[haze, swell], [swell, plasma], [plasma, haze]]) {
    const w = crossfadeWorst(a, b, { fadeSeconds: 10 });
    assert.ok(w <= CROSSFADE_LIMIT, `${a.id} -> ${b.id}: ${w}`);
  }
  const black = Object.assign((t, w, h, p) => { const o = p && p.out instanceof Uint8Array ? p.out : new Uint8Array(Math.max(0, w) * Math.max(0, h)); o.fill(0); return o; }, { id: 'black' });
  const white = Object.assign((t, w, h, p) => { const o = p && p.out instanceof Uint8Array ? p.out : new Uint8Array(Math.max(0, w) * Math.max(0, h)); o.fill(255); return o; }, { id: 'white' });
  assert.ok(crossfadeWorst(black, white, { fadeSeconds: 0.1 }) > CROSSFADE_LIMIT, 'a 0.1 s black-to-white fade is far over');
  assert.throws(() => checkCrossfade(black, white, { fadeSeconds: 0.1 }), /limit 7\.5%/);
  assert.doesNotThrow(() => checkCrossfade(haze, swell, { fadeSeconds: 10 }));
});

test('control: the fixture is checked as one cartridge - dissolve pairs are inside it, never across cartridges', () => {
  const cells = fxLoaded.scenes.filter((e) => sceneFamily(e) === 'cells').map((e) => e.id);
  assert.deepEqual(cells, ['tide', 'drops', 'note', 'sandbox']);
  assert.deepEqual(fxLoaded.scenes.filter((e) => sceneFamily(e) === 'field').map((e) => e.id), ['haze', 'swell', 'plasma-ref']);
});
