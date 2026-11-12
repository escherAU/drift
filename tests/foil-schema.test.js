// DRIFT-7 C12: the manifest field `foil: { hues: [2 to 6 colours], style: "sweep" | "holo" }`. Data only (any folder), format 2,
// unlocked cartridges only (the existing "locked cartridges cannot have" check covers it; tested here through the loader too).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, FORMAT_GATES, formatGate, FOIL_STYLES, FOIL_MIN_HUES, FOIL_MAX_HUES } from '../src/cartridge/schema.js';
import { discoverCartridges } from '../src/cartridge/loader.js';
import { tmpRoot, writeCart, dataManifest, lockedManifest, LABEL } from './helpers-cartridge.js';

const HUES = ['#3FE8FF', '#FF4FD8'];
const man = (over = {}) => dataManifest('fx', { format: 2, foil: { hues: HUES, style: 'holo' }, ...over });
const foilOf = (foil, over = {}) => validateManifest(man({ foil, ...over }), { trusted: false });

test('foil: a valid foil is accepted for both styles and 2 to 6 hues, and is kept (copied) on the manifest', () => {
  for (const style of ['holo', 'sweep']) {
    const r = foilOf({ hues: HUES, style });
    assert.equal(r.ok, true, style + ': ' + r.reason);
    assert.deepEqual(r.manifest.foil, { hues: HUES, style });
  }
  for (const n of [2, 3, 4, 5, 6]) {
    const hues = Array.from({ length: n }, (_, i) => '#' + (0x102030 + i * 0x101010).toString(16).padStart(6, '0'));
    const r = foilOf({ hues, style: 'holo' });
    assert.equal(r.ok, true, n + ' hues: ' + r.reason);
    assert.deepEqual(r.manifest.foil.hues, hues);
  }
  // lower-case hex is fine; the copy is not the author's array
  const src = { hues: ['#3fe8ff', '#ff4fd8'], style: 'sweep' };
  const r = foilOf(src);
  assert.equal(r.ok, true);
  assert.notEqual(r.manifest.foil.hues, src.hues);
  assert.deepEqual([FOIL_STYLES.slice(), FOIL_MIN_HUES, FOIL_MAX_HUES], [['sweep', 'holo'], 2, 6]);
});

test('foil: data only, so a user-folder cartridge may carry it too (install-folder arm and user-folder arm both accept)', () => {
  assert.equal(validateManifest(man(), { trusted: true }).ok, true);
  assert.equal(validateManifest(man(), { trusted: false }).ok, true);
});

test('foil: a manifest without a foil has no foil key at all', () => {
  const r = validateManifest(dataManifest('fx', { format: 2 }), { trusted: false });
  assert.equal(r.ok, true);
  assert.equal('foil' in r.manifest, false);
});

test('foil: refused with a reason that names the field: 1 hue, 7 hues, a bad hex, a bad style, an unknown key, the wrong shapes', () => {
  const six = Array.from({ length: 6 }, () => '#3FE8FF');
  const cases = [
    [{ hues: ['#3FE8FF'], style: 'holo' }, /foil\.hues must list 2 to 6 colours/],
    [{ hues: [...six, '#3FE8FF'], style: 'holo' }, /foil\.hues must list 2 to 6 colours/],
    [{ hues: [], style: 'holo' }, /foil\.hues must list 2 to 6 colours/],
    [{ style: 'holo' }, /foil\.hues must list 2 to 6 colours/],
    [{ hues: '#3FE8FF', style: 'holo' }, /foil\.hues must list 2 to 6 colours/],
    [{ hues: ['#3FE8FF', '#12345'], style: 'holo' }, /foil\.hues\[1\] must be a colour like #3FE8FF/],
    [{ hues: ['#3FE8FF', 'red'], style: 'holo' }, /foil\.hues\[1\] must be a colour like/],
    [{ hues: ['#3FE8FF', '#GGGGGG'], style: 'holo' }, /foil\.hues\[1\] must be a colour like/],
    [{ hues: ['#3FE8FF', '#3FE8FF80'], style: 'holo' }, /foil\.hues\[1\] must be a colour like/],
    [{ hues: ['3FE8FF', '#3FE8FF'], style: 'holo' }, /foil\.hues\[0\] must be a colour like/],
    [{ hues: ['#3FE8FF', 0xff0000], style: 'holo' }, /foil\.hues\[1\] must be a colour like/],
    [{ hues: HUES, style: 'rainbow' }, /foil\.style must be one of sweep, holo/],
    [{ hues: HUES, style: 'HOLO' }, /foil\.style must be one of sweep, holo/],
    [{ hues: HUES }, /foil\.style must be one of sweep, holo/],
    [{ hues: HUES, style: 'holo', speed: 2 }, /unknown field 'speed' in foil/],
    ['holo', /'foil' must be an object/],
    [null, /'foil' must be an object/],
    [[HUES, 'holo'], /'foil' must be an object/],
    [7, /'foil' must be an object/],
  ];
  for (const [foil, re] of cases) {
    const r = foilOf(foil);
    assert.equal(r.ok, false, JSON.stringify(foil));
    assert.match(r.reason, re, JSON.stringify(foil));
  }
});

test('foil: format 1 + foil says "needs a newer Drift" (like the other format 2 fields), format 2 is the gate', () => {
  assert.equal(FORMAT_GATES.foil, 2);
  assert.equal(formatGate('foil', 1) !== null, true);
  assert.equal(formatGate('foil', 2), null);
  const r = validateManifest(man({ format: 1 }), { trusted: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /'foil'/);
  assert.match(r.reason, /needs a newer Drift/);
  assert.match(r.reason, /format 2/);
  assert.match(r.reason, /format 1/);
  assert.doesNotMatch(r.reason, /unknown field/);
  // a format 1 cartridge without it still validates
  assert.equal(validateManifest(dataManifest('fx', { format: 1 }), { trusted: true }).ok, true);
});

test('foil: a locked cartridge cannot have one (the existing check), and the loader path agrees: locked arm refused, unlocked arm loads', () => {
  const locked = validateManifest(lockedManifest('fx', { format: 2, foil: { hues: HUES, style: 'holo' } }), { trusted: true });
  assert.equal(locked.ok, false);
  assert.match(locked.reason, /locked cartridges cannot have 'foil'/);
  // the same locked manifest without the foil is fine
  assert.equal(validateManifest(lockedManifest('fx', { format: 2 }), { trusted: true }).ok, true);

  const root = tmpRoot('drift-foil-schema-');
  writeCart(root, 'lockfoil', { 'manifest.json': lockedManifest('lockfoil', { format: 2, foil: { hues: HUES, style: 'holo' } }), 'label.txt': LABEL });
  writeCart(root, 'openfoil', { 'manifest.json': dataManifest('openfoil', { format: 2, foil: { hues: HUES, style: 'sweep' } }), 'label.txt': LABEL });
  const d = discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
  const ids = d.cartridges.map((c) => c.id);
  assert.deepEqual(ids, ['openfoil'], 'the unlocked foil cartridge loads, the locked one does not');
  assert.deepEqual(d.cartridges[0].manifest.foil, { hues: HUES, style: 'sweep' });
  assert.equal(d.errors.length, 1);
  assert.match(d.errors[0].reason || String(d.errors[0]), /locked cartridges cannot have 'foil'/);
});
