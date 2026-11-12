// DRIFT-7 C3b: the cartridge side of full colour. Schema: `rgb: true` on cells and sim scenes only, install folder only, format 2
// only. Loader: the smoke render accepts colour 255 + fg/bg for an rgb scene (and still fails it for any other scene), the scene
// module's own `rgb` must match the manifest, and a cartridge with an rgb scene must have skin.palette.bg.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FORMAT, validateManifest } from '../src/cartridge/schema.js';
import { discoverCartridges, loadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { tmpRoot, writeCart, LABEL } from './helpers-cartridge.js';

const man = (over = {}, scene = {}) => ({
  format: 2, id: 'fx', title: 'FX', version: '1.0.0', author: 'T', blurb: 'b', runtime: 'cartridge',
  scenes: [{ id: 'xx', kind: 'cells', rgb: true, ...scene }],
  programs: [{ id: 'main', transition: 'dissolve', scenes: ['xx'], sceneSeconds: 30 }],
  start: 'main',
  ...over,
});

test('FS1 FORMAT is 2; format-1 manifests still validate, format 3 is "needs a newer Drift"', () => {
  assert.equal(FORMAT, 2);
  assert.equal(validateManifest(man({ format: 1 }, { rgb: undefined }), { trusted: true }).ok, true);
  const r = validateManifest(man({ format: 3 }), { trusted: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /needs a newer Drift \(this cartridge is format 3; this Drift reads format 2\)/);
});

test('FS2 rgb: true is accepted on cells and sim scenes in the install folder (format 2) and kept on the scene', () => {
  for (const kind of ['cells', 'sim']) {
    const r = validateManifest(man({}, { kind }), { trusted: true });
    assert.equal(r.ok, true, kind + ': ' + r.reason);
    assert.equal(r.manifest.scenes[0].rgb, true);
  }
  // a scene without rgb carries no rgb key at all
  const p = validateManifest(man({}, { rgb: undefined }), { trusted: true });
  assert.equal(p.ok, true);
  assert.equal('rgb' in p.manifest.scenes[0], false);
  // rgb: false is allowed and dropped
  const f = validateManifest(man({}, { rgb: false }), { trusted: true });
  assert.equal(f.ok, true);
  assert.equal('rgb' in f.manifest.scenes[0], false);
});

test('FS3 rgb in a user-folder cartridge is refused with its own reason (install-folder arm accepts, user-folder arm refuses)', () => {
  const ok = validateManifest(man(), { trusted: true });
  assert.equal(ok.ok, true);
  const no = validateManifest(man(), { trusted: false });
  assert.equal(no.ok, false);
  assert.match(no.reason, /rgb/);
  assert.match(no.reason, /install folder/);
  // and a data-only user cartridge (no rgb) still loads as before
  const plain = { ...man(), scenes: [{ id: 'xx', kind: 'builtin', ref: 'sand' }] };
  assert.equal(validateManifest(plain, { trusted: false }).ok, true);
});

test('FS4 rgb needs format 2 (clear reason), and only on cells and sim; field, text and builtin refuse it; it must be true or false', () => {
  const old = validateManifest(man({ format: 1 }), { trusted: true });
  assert.equal(old.ok, false);
  assert.match(old.reason, /rgb/);
  assert.match(old.reason, /needs a newer Drift/);
  assert.match(old.reason, /format 2/);
  for (const sc of [{ kind: 'field' }, { kind: 'text' }, { kind: 'builtin', ref: 'sand' }]) {
    const r = validateManifest({ ...man(), scenes: [{ id: 'xx', rgb: true, ...sc }], programs: [{ id: 'main', transition: sc.kind === 'field' ? 'crossfade' : 'dissolve', scenes: ['xx'], sceneSeconds: 30, ...(sc.kind === 'field' ? { fadeSeconds: 5 } : {}) }] }, { trusted: true });
    assert.equal(r.ok, false, sc.kind);
    assert.match(r.reason, /rgb.*cells.*sim|only.*cells.*sim/, sc.kind);
  }
  for (const bad of ['yes', 1, null, {}]) {
    const r = validateManifest(man({}, { rgb: bad }), { trusted: true });
    assert.equal(r.ok, false);
    assert.match(r.reason, /rgb must be true or false/);
  }
});

// ---- the loader

const scene = (body, { rgb = true, id = 'xx' } = {}) => [
  `function ${id}(t, w, h, p) {`,
  '  p.glyphs.fill(0x41);',
  `  ${body}`,
  '}',
  `${id}.id = '${id}';`,
  `${id}.kind = 'cells';`,
  rgb ? `${id}.rgb = true;` : '',
  `export default ${id};`,
  '',
].join('\n');

function cart({ source, rgb = true, skin = { palette: { hue: '#7FB069', bg: '#0B140C' } }, format = 2, id = 'fx' }) {
  const root = tmpRoot();
  const files = {
    'manifest.json': man({ format, id }, rgb ? {} : { rgb: undefined }),
    'label.txt': LABEL,
    'scenes/xx.js': source,
  };
  if (skin) files['skin.json'] = skin;
  writeCart(root, id, files);
  return root;
}
const discover = (root, trusted = true) => discoverCartridges({ dirs: [{ dir: root, trusted }] });
async function load(opts) {
  const d = discover(cart(opts));
  if (d.cartridges.length === 0) return { discoverErrors: d.errors, scenes: [], errors: [] };
  const r = await loadScenes(d.cartridges[0]);
  return { ...r, discoverErrors: d.errors };
}

test('FL1 an rgb scene that fills fg/bg loads from the install folder, and carries its rgb flag', async () => {
  const r = await load({ source: scene('p.fg.fill(0x102030); p.bg.fill(0x010203);') });
  assert.deepEqual(r.errors, []);
  assert.equal(r.scenes.length, 1);
  assert.equal(r.scenes[0].scene.rgb, true);
  assert.equal(r.scenes[0].rgb, true, 'the loaded entry says rgb, for whoever builds the runtime');
});

test('FL2 smoke render: colour 255 passes for an rgb scene and fails for a non-rgb scene (both arms), palette-length rule unchanged', async () => {
  // arm 1: rgb scene, every cell colour 255 (the composer pre-fill) passes
  const ok = await load({ source: scene('p.fg.fill(0xFFFFFF); p.bg.fill(0);') });
  assert.deepEqual(ok.errors, []);
  // arm 2: the same body in a scene that is not rgb: colour 255 is past the palette, as before
  const bad = await load({ source: scene('p.colours.fill(255);', { rgb: false }), rgb: false });
  assert.match(bad.errors[0].reason, /smoke render used colour 255 but the palette has 16 entries/);
  // and an rgb scene still may not use a palette index past its palette
  const past = await load({ source: scene('p.colours.fill(16); p.fg.fill(0); p.bg.fill(0);') });
  assert.match(past.errors[0].reason, /used colour 16 but the palette has 16 entries/);
});

test('FL3 smoke render checks fg and bg of full-colour cells: past 0xFFFFFF fails, PALETTE_BG is a legal bg, but not a legal fg', async () => {
  const fg = await load({ source: scene('p.fg.fill(0x1000001); p.bg.fill(0);') });
  assert.match(fg.errors[0].reason, /smoke render drew a full-colour cell with fg 0x1000001/);
  const bg = await load({ source: scene('p.fg.fill(0); p.bg.fill(0x1000001);') });
  assert.match(bg.errors[0].reason, /smoke render drew a full-colour cell with bg 0x1000001/);
  const pbg = await load({ source: scene('p.fg.fill(0x808080); p.bg.fill(0x1000000);') });
  assert.deepEqual(pbg.errors, []);
  const pfg = await load({ source: scene('p.fg.fill(0x1000000); p.bg.fill(0);') });
  assert.match(pfg.errors[0].reason, /fg 0x1000000/);
  // cells that carry a palette index are not checked against fg/bg
  const mixed = await load({ source: scene('p.colours.fill(3); p.fg.fill(0xFFFFFFFF); p.bg.fill(0xFFFFFFFF);') });
  assert.deepEqual(mixed.errors, []);
});

test('FL4 the scene module\'s own rgb flag must match the manifest (both ways)', async () => {
  const a = await load({ source: scene('p.fg.fill(1);', { rgb: false }) });
  assert.match(a.errors[0].reason, /the manifest says rgb but the scene does not declare rgb = true/);
  const b = await load({ source: scene('p.fg.fill(1);', { rgb: true }), rgb: false });
  assert.match(b.errors[0].reason, /the scene declares rgb = true but the manifest does not say rgb/);
});

test('FL5 a cartridge with an rgb scene needs skin.palette.bg (both arms: with bg loads, without bg or without a skin is refused with a reason)', async () => {
  const src = scene('p.fg.fill(0x102030); p.bg.fill(0x010203);');
  assert.deepEqual((await load({ source: src })).errors, []);
  const noBg = await load({ source: src, skin: { palette: { hue: '#7FB069' } } });
  assert.equal(noBg.scenes.length, 0);
  assert.match(noBg.discoverErrors[0].reason, /full-colour \(rgb\) scene/);
  assert.match(noBg.discoverErrors[0].reason, /palette\.bg/);
  const noSkin = await load({ source: src, skin: null });
  assert.match(noSkin.discoverErrors[0].reason, /palette\.bg/);
});

test('FL6 an rgb cartridge in the user folder is skipped with the rgb reason; the install folder takes it', () => {
  const root = cart({ source: scene('p.fg.fill(1);') });
  const user = discover(root, false);
  assert.equal(user.cartridges.length, 0);
  assert.match(user.errors[0].reason, /rgb/);
  assert.match(user.errors[0].reason, /install folder/);
  assert.equal(discover(root, true).cartridges.length, 1);
});

test('FL7 a format-1 cartridge (and the shipped ones) still loads', async () => {
  const root = cart({ source: scene('p.colours.fill(3);', { rgb: false }), rgb: false, format: 1, skin: null });
  assert.equal(discover(root).cartridges.length, 1);
  const shipped = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
  assert.deepEqual(shipped.errors, []);
  for (const id of ['delza', 'night-drive']) {
    const c = shipped.cartridges.find((x) => x.id === id);
    assert.ok(c, id);
    assert.equal(c.manifest.format, 1);
    assert.deepEqual((await loadScenes(c)).errors, [], id);
  }
  assert.ok(path.isAbsolute(INSTALL_DIR));
});
