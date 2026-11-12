// DRIFT-4 cartridge loader: discovery (sync, data only), loadScenes (async, imports code only for the
// install folder), the trust wall, and every way a cartridge folder can be wrong. Fixtures are built in
// fs.mkdtemp folders, so no banned glyph, CRLF file or scene code is committed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverCartridges, loadScenes, INSTALL_DIR, userDir } from '../src/cartridge/loader.js';
import { validateManifest, LIMITS, CODE_REASON } from '../src/cartridge/schema.js';
import { tmpRoot, writeCart, dataManifest, lockedManifest, makeFixtureCartridge, LABEL, NOTE_TEXT } from './helpers-cartridge.js';

const discover = (root, trusted = false) => discoverCartridges({ dirs: [{ dir: root, trusted }] });
const reasonFor = (r, name) => (r.errors.find((e) => path.basename(e.where) === name) || {}).reason;
const base = (id, over = {}) => ({ 'manifest.json': dataManifest(id), 'label.txt': LABEL, ...over });
const textFile = (cards, title = 'Test') => `title: ${title}\n---\n${cards.map((c) => c.join('\n')).join('\n\n')}\n`;
const textManifest = (id) => dataManifest(id, {
  scenes: [{ id: 'note', kind: 'text' }, { id: 'sandbox', kind: 'builtin', ref: 'sand' }],
  programs: [{ id: 'main', transition: 'dissolve', scenes: ['note', 'sandbox'] }],
});

// Put one cartridge in a fresh folder and discover it.
function one(files, { id = 'c1', trusted = false } = {}) {
  const root = tmpRoot();
  writeCart(root, id, files);
  return { root, r: discover(root, trusted) };
}
function expectSkip(files, re, opts = {}) {
  const id = opts.id || 'c1';
  const { r } = one(files, opts);
  assert.equal(r.cartridges.length, 0, 'the cartridge is skipped');
  assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
  assert.match(r.errors[0].reason, re);
  assert.equal(path.basename(r.errors[0].where), id);
  return r.errors[0].reason;
}

// ---- the install folder

test('install cartridges/ folder: zero errors, Classic first, then Delza, the Driftman 9000 and Night Drive (all playable) and the two locked ones', () => {
  const r = discover(INSTALL_DIR, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.cartridges.map((c) => c.id), ['classic', 'arcade', 'delza', 'driftman-9000', 'last-fantasy', 'night-drive']);
  const classic = r.cartridges[0];
  assert.equal(classic.runtime, 'classic');
  assert.equal(classic.locked, false);
  assert.equal(classic.trusted, true);
  assert.ok(classic.label.length > 0 && classic.label.length <= LIMITS.labelH);
  const delza = r.cartridges.find((c) => c.id === 'delza');
  assert.equal(delza.locked, false);
  assert.equal(delza.runtime, 'cartridge');
  const nd = r.cartridges.find((c) => c.id === 'night-drive');
  assert.equal(nd.locked, false);
  assert.equal(nd.runtime, 'cartridge');
  const locked = r.cartridges.filter((c) => c.id !== 'classic' && c.id !== 'delza' && c.id !== 'night-drive' && c.id !== 'driftman-9000');
  assert.equal(locked.length, 2);
  assert.deepEqual(locked.map((c) => c.id), ['arcade', 'last-fantasy']);
  assert.ok(locked.every((c) => c.locked === true && c.manifest.scenes === undefined));
  const codes = locked.map((c) => c.manifest.code);
  assert.ok(codes.every((c) => /^[A-Z0-9-]{5}$/.test(c)), codes.join());
  assert.equal(new Set(codes).size, 2, 'distinct codes');
  assert.ok(locked.every((c) => c.label.length <= LIMITS.labelH && c.label.every((l) => [...l].length <= LIMITS.labelW)));
});

test('userDir is the cartridges folder next to the config file', () => {
  assert.equal(userDir(path.join('x', 'drift', 'config.json')), path.join('x', 'drift', 'cartridges'));
  assert.ok(INSTALL_DIR.endsWith('cartridges') && fs.existsSync(path.join(INSTALL_DIR, 'classic', 'manifest.json')));
});

test('a missing folder is not an error; discovery never throws on nonsense input', () => {
  const root = tmpRoot();
  assert.deepEqual(discover(path.join(root, 'nope')), { cartridges: [], errors: [] });
  assert.deepEqual(discoverCartridges(), { cartridges: [], errors: [] });
  assert.deepEqual(discoverCartridges({ dirs: [] }), { cartridges: [], errors: [] });
  fs.writeFileSync(path.join(root, 'stray.txt'), 'x');
  assert.deepEqual(discover(root), { cartridges: [], errors: [] }, 'files beside the cartridges are ignored');
});

// ---- a good data-only cartridge, and the ways a manifest can be wrong

test('a data-only user cartridge (text + builtin scenes) loads and loadScenes returns both', async () => {
  const { r } = one({ 'manifest.json': textManifest('c1'), 'label.txt': LABEL, 'scenes/note.txt': textFile([['Hello there'], ['Second']]) });
  assert.deepEqual(r.errors, []);
  assert.equal(r.cartridges.length, 1);
  const cart = r.cartridges[0];
  assert.equal(cart.trusted, false);
  const s = await loadScenes(cart);
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.scenes.map((x) => [x.id, x.kind]), [['note', 'text'], ['sandbox', 'builtin']]);
  assert.equal(typeof s.scenes[0].scene, 'function');
  assert.equal(s.scenes[1].scene.id, 'sand');
});

test('broken JSON is skipped with a reason, never thrown', () => {
  expectSkip({ 'manifest.json': '{ "format": 1,', 'label.txt': LABEL }, /not valid JSON/);
  expectSkip({ 'manifest.json': '', 'label.txt': LABEL }, /not valid JSON/);
  expectSkip({ 'manifest.json': '[1,2]', 'label.txt': LABEL }, /must hold an object/);
});

test('a missing manifest or label is skipped with a reason', () => {
  expectSkip({ 'label.txt': LABEL }, /manifest\.json is missing/);
  expectSkip({ 'manifest.json': dataManifest('c1') }, /label\.txt is missing/);
});

test('a missing required field is named', () => {
  for (const k of ['format', 'id', 'title', 'version', 'author', 'blurb', 'runtime', 'scenes', 'programs', 'start']) {
    const m = dataManifest('c1');
    delete m[k];
    expectSkip({ 'manifest.json': m, 'label.txt': LABEL }, new RegExp(`missing required field '${k}'`));
  }
});

test("an unknown field is rejected by name: unknown field 'titel'", () => {
  expectSkip({ 'manifest.json': dataManifest('c1', { titel: 'x' }), 'label.txt': LABEL }, /unknown field 'titel'/);
});

test('format 3 needs a newer Drift; formats 1 and 2 are fine', () => {
  expectSkip({ 'manifest.json': dataManifest('c1', { format: 3 }), 'label.txt': LABEL }, /needs a newer Drift/);
  assert.equal(one(base('c1')).r.cartridges.length, 1);
  assert.equal(one({ 'manifest.json': dataManifest('c1', { format: 2 }), 'label.txt': LABEL }).r.cartridges.length, 1);
});

test('the folder name must equal the manifest id', () => {
  expectSkip({ 'manifest.json': dataManifest('other'), 'label.txt': LABEL }, /does not match the manifest id/, { id: 'c1' });
});

test('ids ../evil, a/b, C:x, con, last, Delza (and more) are refused as ids, not as folder names', () => {
  for (const bad of ['../evil', 'a/b', 'C:x', 'con', 'last', 'Delza', 'nul', 'com1', 'lpt9', 'prn', 'aux', '', 'a', '-ab', 'ab-', 'x'.repeat(33), 'a.b', 'a b']) {
    const reason = expectSkip({ 'manifest.json': dataManifest(bad), 'label.txt': LABEL }, /id/, { id: 'safe-folder' });
    assert.doesNotMatch(reason, /does not match/, `the id check comes first for ${JSON.stringify(bad)}`);
    assert.equal(validateManifest(dataManifest(bad), { trusted: true }).ok, false, JSON.stringify(bad));
  }
  assert.match(expectSkip({ 'manifest.json': dataManifest('last'), 'label.txt': LABEL }, /reserved/, { id: 'last-x' }), /'last'/);
  assert.equal(validateManifest(dataManifest('last-stop'), { trusted: false }).ok, true, 'last-stop is a fine id');
});

test('manifest holding file paths is rejected as an unknown field', () => {
  expectSkip({ 'manifest.json': dataManifest('c1', { label: 'label.txt' }), 'label.txt': LABEL }, /unknown field 'label'/);
  expectSkip({ 'manifest.json': dataManifest('c1', { skin: 'skin.json' }), 'label.txt': LABEL }, /unknown field 'skin'/);
  const m = dataManifest('c1');
  m.scenes[0].file = '../../etc/passwd';
  expectSkip({ 'manifest.json': m, 'label.txt': LABEL }, /unknown field 'file'/);
  const p = dataManifest('c1');
  p.programs[0].path = 'x';
  expectSkip({ 'manifest.json': p, 'label.txt': LABEL }, /unknown field 'path'/);
});

test('locked cartridge with scenes (or any open field) is rejected; a clean locked one loads', () => {
  expectSkip({ 'manifest.json': lockedManifest('c1', { scenes: dataManifest('c1').scenes }), 'label.txt': LABEL }, /locked cartridges cannot have 'scenes'/);
  expectSkip({ 'manifest.json': lockedManifest('c1', { runtime: 'cartridge' }), 'label.txt': LABEL }, /locked cartridges cannot have 'runtime'/);
  expectSkip({ 'manifest.json': lockedManifest('c1', { bogus: 1 }), 'label.txt': LABEL }, /unknown field 'bogus'/);
  const { r } = one({ 'manifest.json': lockedManifest('c1'), 'label.txt': LABEL });
  assert.deepEqual(r.errors, []);
  assert.equal(r.cartridges[0].locked, true);
});

test('builtin pointing at a chaos or contrast scene is rejected; calm (crossfade) and experimental (dissolve) are accepted', () => {
  for (const ref of ['glyphrain', 'swarm', 'life', 'tunnel']) {
    const m = dataManifest('c1', { scenes: [{ id: 'bi', kind: 'builtin', ref }], programs: [{ id: 'main', transition: 'dissolve', scenes: ['bi'] }] });
    expectSkip({ 'manifest.json': m, 'label.txt': LABEL }, /cartridges may only use calm or experimental/);
  }
  const unknown = dataManifest('c1', { scenes: [{ id: 'bi', kind: 'builtin', ref: 'nope' }] });
  expectSkip({ 'manifest.json': unknown, 'label.txt': LABEL }, /unknown builtin scene 'nope'/);
  for (const ref of ['bounce', 'sand', 'waves', 'pendulum', 'cloth', 'artist']) {
    const m = dataManifest('c1', { scenes: [{ id: 'bi', kind: 'builtin', ref }], programs: [{ id: 'main', transition: 'dissolve', scenes: ['bi'] }] });
    assert.equal(one({ 'manifest.json': m, 'label.txt': LABEL }).r.cartridges.length, 1, ref);
  }
  for (const ref of ['squiggle', 'sunburst', 'plasma', 'ripples', 'rain']) {
    const m = dataManifest('c1', { scenes: [{ id: 'bi', kind: 'builtin', ref }], programs: [{ id: 'main', transition: 'crossfade', scenes: ['bi'], sceneSeconds: 60, fadeSeconds: 10 }] });
    assert.equal(one({ 'manifest.json': m, 'label.txt': LABEL }).r.cartridges.length, 1, ref);
  }
});

test('program transition rules: a crossfade program holding a cells scene is rejected (and a dissolve holding a field scene)', () => {
  const cellsInCross = dataManifest('c1', {
    scenes: [{ id: 'tide', kind: 'cells' }, { id: 'pl', kind: 'builtin', ref: 'plasma' }],
    programs: [{ id: 'main', transition: 'crossfade', scenes: ['pl', 'tide'], sceneSeconds: 60, fadeSeconds: 10 }],
  });
  expectSkip({ 'manifest.json': cellsInCross, 'label.txt': LABEL }, /crossfade program holds only field scenes or calm builtins, but 'tide' is a cells scene/, { trusted: true });
  const textInCross = dataManifest('c1', { scenes: [{ id: 'note', kind: 'text' }], programs: [{ id: 'main', transition: 'crossfade', scenes: ['note'] }] });
  expectSkip({ 'manifest.json': textInCross, 'label.txt': LABEL }, /crossfade program holds only field scenes/);
  const calmInDissolve = dataManifest('c1', { scenes: [{ id: 'pl', kind: 'builtin', ref: 'plasma' }], programs: [{ id: 'main', transition: 'dissolve', scenes: ['pl'] }] });
  expectSkip({ 'manifest.json': calmInDissolve, 'label.txt': LABEL }, /dissolve program holds only cells, sim, text or experimental builtin/);
  const fieldInDissolve = dataManifest('c1', { scenes: [{ id: 'haze', kind: 'field' }], programs: [{ id: 'main', transition: 'dissolve', scenes: ['haze'] }] });
  expectSkip({ 'manifest.json': fieldInDissolve, 'label.txt': LABEL }, /dissolve program holds only cells/, { trusted: true });
});

// ---- skins

test('skin background: light #F0F0F0 is rejected ("background too light"), dark #0B140C is accepted', () => {
  const skin = (bg) => ({ palette: { hue: '#7FB069', bg } });
  const light = expectSkip({ 'manifest.json': dataManifest('c1'), 'label.txt': LABEL, 'skin.json': skin('#F0F0F0') }, /background too light/);
  assert.match(light, /skin\.json/);
  expectSkip({ 'manifest.json': dataManifest('c1'), 'label.txt': LABEL, 'skin.json': skin('#808080') }, /background too light/);
  const dark = one({ 'manifest.json': dataManifest('c1'), 'label.txt': LABEL, 'skin.json': skin('#0B140C') }).r;
  assert.deepEqual(dark.errors, []);
  assert.equal(dark.cartridges[0].skin.palette.bg, '#0B140C');
});

test('a bad skin is skipped with its file named: unknown field, bad json, ui index out of range', () => {
  expectSkip({ 'manifest.json': dataManifest('c1'), 'label.txt': LABEL, 'skin.json': { palette: { hue: '#7FB069' }, extra: 1 } }, /skin\.json: unknown field 'extra'/);
  expectSkip({ 'manifest.json': dataManifest('c1'), 'label.txt': LABEL, 'skin.json': '{nope' }, /skin\.json is not valid JSON/);
  expectSkip({ 'manifest.json': dataManifest('c1'), 'label.txt': LABEL, 'skin.json': { palette: { hue: '#7FB069', ui: { accent: 17 } } } }, /palette\.ui\.accent must be a palette index from 0 to 15/);
});

// ---- labels and text assets

test('label with U+2196 and label with an emoji are rejected', () => {
  const arrow = String.fromCodePoint(0x2196);
  const emoji = String.fromCodePoint(0x1f600);
  expectSkip({ 'manifest.json': dataManifest('c1'), 'label.txt': `ab${arrow}cd\n` }, /label\.txt: row 1 has U\+2196, which is not an allowed glyph/);
  expectSkip({ 'manifest.json': dataManifest('c1'), 'label.txt': `ab${emoji}cd\n` }, /label\.txt: row 1 has U\+1F600, which is not an allowed glyph/);
  expectSkip({ 'manifest.json': dataManifest('c1'), 'label.txt': 'a\tb\n' }, /U\+0009/);
});

test('oversize label: more than 10 rows, more than 24 columns, more than 4 KB', () => {
  expectSkip({ 'manifest.json': dataManifest('c1'), 'label.txt': Array(11).fill('x').join('\n') + '\n' }, /label\.txt: art is 11 rows, max 10/);
  expectSkip({ 'manifest.json': dataManifest('c1'), 'label.txt': 'x'.repeat(25) + '\n' }, /label\.txt: row 1 is 25 columns, max 24/);
  expectSkip({ 'manifest.json': dataManifest('c1'), 'label.txt': ('x'.repeat(20) + '\n').repeat(8) + ' '.repeat(5000) + '\n' }, /label\.txt is \d+ bytes, max 4096/);
  assert.equal(one({ 'manifest.json': dataManifest('c1'), 'label.txt': Array(10).fill('x'.repeat(24)).join('\n') + '\n' }).r.cartridges.length, 1, '10 x 24 is the largest label');
});

test('oversize boot art (76 x 18) is rejected; a boot.txt in range loads', () => {
  expectSkip({ 'manifest.json': dataManifest('c1'), 'label.txt': LABEL, 'boot.txt': Array(19).fill('x').join('\n') }, /boot\.txt: art is 19 rows, max 18/);
  expectSkip({ 'manifest.json': dataManifest('c1'), 'label.txt': LABEL, 'boot.txt': 'x'.repeat(77) }, /boot\.txt: row 1 is 77 columns, max 76/);
  const ok = one({ 'manifest.json': dataManifest('c1'), 'label.txt': LABEL, 'boot.txt': Array(18).fill('x'.repeat(76)).join('\n') }).r;
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.cartridges[0].boot.length, 18);
});

test('text scene limits: over 32 KB, over 12 cards, over 8 lines, over 60 characters, no cards, bad header', () => {
  const t = (txt) => ({ 'manifest.json': textManifest('c1'), 'label.txt': LABEL, 'scenes/note.txt': txt });
  expectSkip(t(textFile([['x'.repeat(60)]]) + ('y'.repeat(60) + '\n').repeat(600)), /scenes\/note\.txt is \d+ bytes, max 32768/);
  expectSkip(t(textFile(Array.from({ length: 13 }, (_, i) => ['card ' + i]))), /scenes\/note\.txt: the text scene has 13 cards, max 12/);
  expectSkip(t(textFile([Array.from({ length: 9 }, (_, i) => 'line ' + i)])), /scenes\/note\.txt: card 1 has more than 8 lines/);
  expectSkip(t(textFile([['x'.repeat(61)]])), /scenes\/note\.txt: line 3 is 61 characters, max 60/);
  expectSkip(t('title: T\n---\n\n\n'), /the text scene has no cards/);
  expectSkip(t('no title here\n---\nhi\n'), /line 1 must be 'title: <name>'/);
  expectSkip(t('title: T\nhi\n'), /line 2 must be '---'/);
  expectSkip(t(textFile([['arrow ' + String.fromCodePoint(0x2196)]])), /U\+2196/);
  expectSkip({ 'manifest.json': textManifest('c1'), 'label.txt': LABEL }, /scenes\/note\.txt is missing/);
  const edge = Array.from({ length: 12 }, () => Array.from({ length: 8 }, () => 'x'.repeat(60)));
  assert.equal(one(t(textFile(edge))).r.errors.length, 0, '12 cards of 8 lines of 60 is the largest text scene');
});

test('CRLF is accepted in label.txt, boot.txt and text scenes (and gives the same lines as LF)', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  const files = (conv) => ({ 'manifest.json': textManifest('c1'), 'label.txt': conv(LABEL), 'boot.txt': conv('one  \ntwo\n'), 'scenes/note.txt': conv(NOTE_TEXT) });
  const a = one(files((s) => s)).r, b = one(files(crlf)).r;
  assert.deepEqual(b.errors, []);
  assert.deepEqual(b.cartridges[0].label, a.cartridges[0].label);
  assert.deepEqual(b.cartridges[0].boot, ['one', 'two']);
  assert.deepEqual(b.cartridges[0].texts.note, a.cartridges[0].texts.note);
  assert.ok(b.cartridges[0].label.every((l) => !l.includes('\r')));
});

// ---- duplicates, Classic, the cap

test('same id in the install and user folders: the install one wins, the user one is skipped with a reason', () => {
  const install = tmpRoot(), user = tmpRoot();
  writeCart(install, 'dup', { 'manifest.json': dataManifest('dup', { title: 'Install copy' }), 'label.txt': LABEL });
  writeCart(user, 'dup', { 'manifest.json': dataManifest('dup', { title: 'User copy' }), 'label.txt': LABEL });
  writeCart(user, 'solo', { 'manifest.json': dataManifest('solo'), 'label.txt': LABEL });
  const r = discoverCartridges({ dirs: [{ dir: install, trusted: true }, { dir: user, trusted: false }] });
  assert.deepEqual(r.cartridges.map((c) => [c.id, c.title, c.trusted]), [['dup', 'Install copy', true], ['solo', 'Data solo', false]]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /duplicate id 'dup'/);
  assert.equal(r.errors[0].where, path.join(user, 'dup'));
});

test("'classic' in the user folder is skipped (in the install folder it is fine)", () => {
  const classic = { format: 1, id: 'classic', title: 'Fake classic', version: '1.0.0', author: 'x', blurb: 'y', runtime: 'classic' };
  expectSkip({ 'manifest.json': classic, 'label.txt': LABEL }, /runtime 'classic' is only for the install folder/, { id: 'classic' });
  expectSkip({ 'manifest.json': dataManifest('classic'), 'label.txt': LABEL }, /id 'classic' is reserved/, { id: 'classic' });
  expectSkip({ 'manifest.json': lockedManifest('classic'), 'label.txt': LABEL }, /id 'classic' is reserved/, { id: 'classic' });
  const ok = one({ 'manifest.json': classic, 'label.txt': LABEL }, { id: 'classic', trusted: true }).r;
  assert.deepEqual(ok.errors, []);
  expectSkip({ 'manifest.json': { ...classic, id: 'not-classic' }, 'label.txt': LABEL }, /belongs to the cartridge with id 'classic'/, { id: 'not-classic', trusted: true });
  expectSkip({ 'manifest.json': { ...classic, scenes: [] }, 'label.txt': LABEL }, /the classic cartridge cannot have 'scenes'/, { id: 'classic', trusted: true });
});

test('50-cartridge cap: the 51st and later are skipped with a reason, the install ones are never the ones dropped', () => {
  const install = tmpRoot(), user = tmpRoot();
  writeCart(install, 'inst', { 'manifest.json': lockedManifest('inst'), 'label.txt': LABEL });
  for (let i = 0; i < 52; i++) { const id = 'cart-' + String(i).padStart(2, '0'); writeCart(user, id, { 'manifest.json': lockedManifest(id), 'label.txt': LABEL }); }
  const r = discoverCartridges({ dirs: [{ dir: install, trusted: true }, { dir: user, trusted: false }] });
  assert.equal(r.cartridges.length, LIMITS.cartridges);
  assert.equal(LIMITS.cartridges, 50);
  assert.ok(r.cartridges.some((c) => c.id === 'inst'));
  assert.equal(r.errors.length, 3);
  assert.ok(r.errors.every((e) => /more than 50 cartridges/.test(e.reason)));
  assert.deepEqual(r.errors.map((e) => path.basename(e.where)), ['cart-49', 'cart-50', 'cart-51']);
});

// ---- links and junctions

function makeLink(target, link) {
  try { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); return null; } catch (e) {
    if (e && (e.code === 'EPERM' || e.code === 'EACCES')) return e;
    throw e;
  }
}

test('control: the same cartridge as a real folder loads (so the link tests below prove the link check, not a bad cartridge)', () => {
  const outside = tmpRoot();
  writeCart(outside, 'mylink', base('mylink'));
  const root = tmpRoot();
  fs.cpSync(path.join(outside, 'mylink'), path.join(root, 'mylink'), { recursive: true });
  const r = discover(root);
  assert.deepEqual(r.errors, []);
  assert.equal(r.cartridges.length, 1);
});

test('a junction or symlink cartridge folder is skipped with a stated reason', (t) => {
  const outside = tmpRoot();
  writeCart(outside, 'mylink', base('mylink'));
  const root = tmpRoot();
  const err = makeLink(path.join(outside, 'mylink'), path.join(root, 'mylink'));
  if (err) { t.skip(`cannot create a ${process.platform === 'win32' ? 'junction' : 'symlink'} here (${err.code}); the control test above still ran`); return; }
  const r = discover(root);
  assert.equal(r.cartridges.length, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /is a link or junction; links are not followed/);
});

test('a scenes folder that is a junction to somewhere else is refused: the real path leaves the cartridge', (t) => {
  const outside = tmpRoot();
  const marker = path.join(outside, 'ran.txt');
  fs.mkdirSync(path.join(outside, 'elsewhere'));
  fs.writeFileSync(path.join(outside, 'elsewhere', 'haze.js'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'ran'); export default function haze() {}`);
  const root = tmpRoot();
  writeCart(root, 'jx', {
    'manifest.json': dataManifest('jx', { scenes: [{ id: 'haze', kind: 'field' }], programs: [{ id: 'main', transition: 'crossfade', scenes: ['haze'], sceneSeconds: 60, fadeSeconds: 10 }] }),
    'label.txt': LABEL,
  });
  const err = makeLink(path.join(outside, 'elsewhere'), path.join(root, 'jx', 'scenes'));
  if (err) { t.skip(`cannot create a junction here (${err.code})`); return; }
  const r = discover(root, true);
  assert.equal(r.cartridges.length, 0);
  assert.match(r.errors[0].reason, /scenes\/haze\.js resolves outside the cartridge folder/);
  assert.equal(fs.existsSync(marker), false, 'the outside module was never imported');
  // a text scene reached through a junction is refused the same way
  const root2 = tmpRoot();
  fs.mkdirSync(path.join(outside, 'texts'));
  fs.writeFileSync(path.join(outside, 'texts', 'note.txt'), textFile([['outside']]));
  writeCart(root2, 'tx', { 'manifest.json': textManifest('tx'), 'label.txt': LABEL });
  assert.equal(makeLink(path.join(outside, 'texts'), path.join(root2, 'tx', 'scenes')), null);
  const r2 = discover(root2);
  assert.match(r2.errors[0].reason, /scenes\/note\.txt resolves outside the cartridge folder/);
});

// ---- trust: code runs only from the install folder

const markerSource = (marker) => `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, 'ran');\nexport default function bad(t, w, h) { return new Uint8Array(Math.max(0, w) * Math.max(0, h)); }\nbad.id = 'bad';\n`;

test('TRUST (a): a user cartridge whose scene .js would write a marker file is skipped, and the marker does not exist afterwards', async () => {
  const work = tmpRoot();
  const marker = path.join(work, 'marker.txt');
  const user = path.join(work, 'user');
  fs.mkdirSync(user);
  // 1. declares a code scene kind
  writeCart(user, 'declares', {
    'manifest.json': dataManifest('declares', { scenes: [{ id: 'bad', kind: 'field' }], programs: [{ id: 'main', transition: 'crossfade', scenes: ['bad'], sceneSeconds: 60, fadeSeconds: 10 }] }),
    'label.txt': LABEL, 'scenes/bad.js': markerSource(marker),
  });
  // 2. declares nothing, but ships a .js file next to its data
  writeCart(user, 'smuggles', { 'manifest.json': dataManifest('smuggles'), 'label.txt': LABEL, 'scenes/bad.js': markerSource(marker), 'extra/deep/x.mjs': 'export {}' });
  const r = discover(user, false);
  assert.equal(r.cartridges.length, 0);
  assert.equal(r.errors.length, 2);
  for (const e of r.errors) assert.match(e.reason, /user cartridges cannot contain code in this version/);
  assert.equal(reasonFor(r, 'smuggles'), CODE_REASON);
  for (const c of r.cartridges) await loadScenes(c);
  assert.equal(fs.existsSync(marker), false, 'discover + loadScenes never ran the user cartridge');

  // the second wall: even a hand-built cartridge object marked untrusted is never imported
  const fake = { id: 'declares', dir: path.join(user, 'declares'), trusted: false, skin: null, sceneFiles: { bad: path.join(user, 'declares', 'scenes', 'bad.js') }, texts: {},
    manifest: { scenes: [{ id: 'bad', kind: 'field', title: 'bad' }] } };
  const s = await loadScenes(fake);
  assert.deepEqual(s.scenes, []);
  assert.match(s.errors[0].reason, /user cartridges cannot contain code/);
  assert.equal(fs.existsSync(marker), false, 'loadScenes refuses to import for an untrusted cartridge');

  // the control: the same file from a TRUSTED folder does run, so the marker check is not vacuous
  const install = tmpRoot();
  writeCart(install, 'declares', {
    'manifest.json': dataManifest('declares', { scenes: [{ id: 'bad', kind: 'field' }], programs: [{ id: 'main', transition: 'crossfade', scenes: ['bad'], sceneSeconds: 60, fadeSeconds: 10 }] }),
    'label.txt': LABEL, 'scenes/bad.js': markerSource(marker),
  });
  const t = discover(install, true);
  assert.deepEqual(t.errors, []);
  const loaded = await loadScenes(t.cartridges[0]);
  assert.deepEqual(loaded.errors, [], JSON.stringify(loaded.errors));
  assert.equal(fs.existsSync(marker), true, 'trusted code is imported (marker written)');
});

test('TRUST (b): a data-only user cartridge in the same folder as a refused one loads fine', async () => {
  const work = tmpRoot();
  const marker = path.join(work, 'marker.txt');
  const user = path.join(work, 'user');
  fs.mkdirSync(user);
  writeCart(user, 'sneaky', { 'manifest.json': dataManifest('sneaky'), 'label.txt': LABEL, 'scenes/bad.js': markerSource(marker) });
  writeCart(user, 'honest', { 'manifest.json': textManifest('honest'), 'label.txt': LABEL, 'scenes/note.txt': textFile([['Plain data']]) });
  const r = discover(user, false);
  assert.deepEqual(r.cartridges.map((c) => c.id), ['honest']);
  assert.deepEqual(r.errors.map((e) => path.basename(e.where)), ['sneaky']);
  const s = await loadScenes(r.cartridges[0]);
  assert.deepEqual(s.errors, []);
  assert.equal(s.scenes.length, 2);
  assert.equal(fs.existsSync(marker), false);
});

// ---- the trusted fixture cartridge: every scene kind loads

test('trusted fixture cartridge: field, sim, cells, text and builtin scenes all load, in manifest order', async () => {
  const root = tmpRoot();
  makeFixtureCartridge(root);
  const r = discover(root, true);
  assert.deepEqual(r.errors, []);
  const cart = r.cartridges[0];
  assert.equal(cart.trusted, true);
  assert.equal(cart.skin.palette.bg, '#0B140C');
  assert.equal(cart.boot, null);
  const s = await loadScenes(cart);
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.scenes.map((x) => [x.id, x.kind, x.family]), [
    ['haze', 'field', 'field'], ['swell', 'field', 'field'], ['tide', 'cells', 'cells'], ['drops', 'sim', 'cells'],
    ['note', 'text', 'cells'], ['sandbox', 'builtin', 'cells'], ['plasma-ref', 'builtin', 'field'],
  ]);
  assert.equal(s.scenes[3].scene.kind, 'sim');
  assert.equal(s.scenes[2].scene.kind, 'cells');
  assert.equal(s.scenes[0].scene.kind, undefined);
  assert.equal(s.scenes[4].scene.kind, 'cells');
  assert.equal(s.scenes[5].ref, 'sand');
});

// ---- scene modules that are wrong (all in a trusted folder, found by loadScenes)

const fieldSrc = (id, extra = '') => `function f(t, w, h, p) { return new Uint8Array(Math.max(0, w) * Math.max(0, h)); }\nf.id = ${JSON.stringify(id)};\n${extra}\nexport default f;\n`;
const cellsSrc = (id, body, kind = 'cells') => `function c(t, w, h, p) { ${body} }\nc.id = ${JSON.stringify(id)};\nc.kind = ${JSON.stringify(kind)};\nexport default c;\n`;
function trustedWith(scenes, program, files, skin) {
  const m = dataManifest('c1', { scenes, programs: [program] });
  return { 'manifest.json': m, 'label.txt': LABEL, ...(skin ? { 'skin.json': skin } : {}), ...files };
}
const dissolve = (ids) => ({ id: 'main', transition: 'dissolve', scenes: ids });
const crossfade = (ids) => ({ id: 'main', transition: 'crossfade', scenes: ids, sceneSeconds: 60, fadeSeconds: 10 });

async function loadTrusted(files) {
  const { r } = one(files, { trusted: true });
  assert.deepEqual(r.errors, [], 'discovery ok');
  return loadScenes(r.cartridges[0]);
}

test('missing scenes/xx.js is skipped at discovery with the file named', () => {
  expectSkip(trustedWith([{ id: 'xx', kind: 'field' }], crossfade(['xx']), {}), /scenes\/xx\.js is missing/, { trusted: true });
});

test('export with the wrong id is refused by loadScenes', async () => {
  const s = await loadTrusted(trustedWith([{ id: 'xx', kind: 'field' }], crossfade(['xx']), { 'scenes/xx.js': fieldSrc('y') }));
  assert.deepEqual(s.scenes, []);
  assert.match(s.errors[0].reason, /scenes\/xx\.js: the scene's id is "y" but the manifest says 'xx'/);
});

test('export with the wrong kind is refused by loadScenes (cells vs sim vs field)', async () => {
  const a = await loadTrusted(trustedWith([{ id: 'xx', kind: 'sim' }], dissolve(['xx']), { 'scenes/xx.js': cellsSrc('xx', '') }));
  assert.match(a.errors[0].reason, /the manifest says 'sim' but the scene has kind "cells"/);
  const b = await loadTrusted(trustedWith([{ id: 'xx', kind: 'cells' }], dissolve(['xx']), { 'scenes/xx.js': fieldSrc('xx') }));
  assert.match(b.errors[0].reason, /the manifest says 'cells' but the scene has kind "ramp"/);
  const c = await loadTrusted(trustedWith([{ id: 'xx', kind: 'field' }], crossfade(['xx']), { 'scenes/xx.js': cellsSrc('xx', '') }));
  assert.match(c.errors[0].reason, /the manifest says 'field' but the scene has kind "cells"/);
  const d = await loadTrusted(trustedWith([{ id: 'xx', kind: 'sim' }], dissolve(['xx']), { 'scenes/xx.js': cellsSrc('xx', '', 'sim') }));
  assert.match(d.errors[0].reason, /a sim scene needs a 'init' function/);
  const e = await loadTrusted(trustedWith([{ id: 'xx', kind: 'cells' }], dissolve(['xx']), { 'scenes/xx.js': 'export const nope = 1;\n' }));
  assert.match(e.errors[0].reason, /the default export must be the scene/);
});

test('smoke render emitting U+2196 fails the cartridge (and 0x41 is fine)', async () => {
  const bad = await loadTrusted(trustedWith([{ id: 'xx', kind: 'cells' }], dissolve(['xx']), { 'scenes/xx.js': cellsSrc('xx', 'p.glyphs.fill(0x2196); p.colours.fill(0);') }));
  assert.deepEqual(bad.scenes, []);
  assert.match(bad.errors[0].reason, /scenes\/xx\.js: smoke render drew U\+2196, which is not an allowed glyph/);
  const good = await loadTrusted(trustedWith([{ id: 'xx', kind: 'cells' }], dissolve(['xx']), { 'scenes/xx.js': cellsSrc('xx', 'p.glyphs.fill(0x41); p.colours.fill(0);') }));
  assert.deepEqual(good.errors, []);
  assert.equal(good.scenes.length, 1);
});

test('smoke render with a colour at or past the palette length fails; one below it passes (16 without a skin, 18 with two extra colours)', async () => {
  const put = (n) => cellsSrc('xx', `p.glyphs.fill(0x41); p.colours.fill(${n});`);
  const at16 = await loadTrusted(trustedWith([{ id: 'xx', kind: 'cells' }], dissolve(['xx']), { 'scenes/xx.js': put(16) }));
  assert.match(at16.errors[0].reason, /used colour 16 but the palette has 16 entries/);
  const at15 = await loadTrusted(trustedWith([{ id: 'xx', kind: 'cells' }], dissolve(['xx']), { 'scenes/xx.js': put(15) }));
  assert.deepEqual(at15.errors, []);
  const skin = { palette: { hue: '#7FB069', colours: ['#FF0000', '#00FF00'] } };
  const at17 = await loadTrusted(trustedWith([{ id: 'xx', kind: 'cells' }], dissolve(['xx']), { 'scenes/xx.js': put(17) }, skin));
  assert.deepEqual(at17.errors, [], 'colour 17 is inside an 18-entry palette');
  const at18 = await loadTrusted(trustedWith([{ id: 'xx', kind: 'cells' }], dissolve(['xx']), { 'scenes/xx.js': put(18) }, skin));
  assert.match(at18.errors[0].reason, /used colour 18 but the palette has 18 entries/);
});

test('a scene that throws, has a syntax error, or returns the wrong thing fails with a reason (never an exception)', async () => {
  const thrower = await loadTrusted(trustedWith([{ id: 'xx', kind: 'cells' }], dissolve(['xx']), { 'scenes/xx.js': cellsSrc('xx', "throw new Error('boom');") }));
  assert.match(thrower.errors[0].reason, /smoke render threw: boom/);
  const syntax = await loadTrusted(trustedWith([{ id: 'xx', kind: 'cells' }], dissolve(['xx']), { 'scenes/xx.js': 'export default function ( {' }));
  assert.match(syntax.errors[0].reason, /scenes\/xx\.js cannot be loaded/);
  const wrong = await loadTrusted(trustedWith([{ id: 'xx', kind: 'field' }], crossfade(['xx']), { 'scenes/xx.js': 'function f() { return [1, 2, 3]; }\nf.id = "xx";\nexport default f;\n' }));
  assert.match(wrong.errors[0].reason, /smoke render did not return 160 values in a Uint8Array/);
});

test('one bad scene fails the whole cartridge: scenes is empty and every error is listed', async () => {
  const files = trustedWith([{ id: 'ok', kind: 'field' }, { id: 'bad', kind: 'field' }], crossfade(['ok', 'bad']), { 'scenes/ok.js': fieldSrc('ok'), 'scenes/bad.js': fieldSrc('nope') });
  const s = await loadTrusted(files);
  assert.deepEqual(s.scenes, []);
  assert.equal(s.errors.length, 1);
  assert.match(s.errors[0].reason, /scenes\/bad\.js/);
});

test('program rules: sceneSeconds range, fadeSeconds only on crossfade and shorter than the scene, unknown scene, unknown start, menu', () => {
  const m = (prog, extra = {}) => ({ 'manifest.json': dataManifest('c1', { scenes: [{ id: 'sandbox', kind: 'builtin', ref: 'sand' }, { id: 'pl', kind: 'builtin', ref: 'plasma' }], programs: [prog], ...extra }), 'label.txt': LABEL });
  expectSkip(m({ id: 'main', transition: 'dissolve', scenes: ['sandbox'], sceneSeconds: 19 }), /sceneSeconds must be 20 to 3600/);
  expectSkip(m({ id: 'main', transition: 'dissolve', scenes: ['sandbox'], sceneSeconds: 3601 }), /sceneSeconds must be 20 to 3600/);
  expectSkip(m({ id: 'main', transition: 'dissolve', scenes: ['sandbox'], fadeSeconds: 10 }), /fadeSeconds only applies to crossfade/);
  expectSkip(m({ id: 'main', transition: 'crossfade', scenes: ['pl'], sceneSeconds: 20, fadeSeconds: 4 }), /fadeSeconds must be 5 to 60/);
  expectSkip(m({ id: 'main', transition: 'crossfade', scenes: ['pl'], sceneSeconds: 20, fadeSeconds: 20 }), /fadeSeconds must be shorter than sceneSeconds/);
  expectSkip(m({ id: 'main', transition: 'dissolve', scenes: ['ghost'] }), /unknown scene "ghost"/);
  expectSkip(m({ id: 'main', transition: 'dissolve', scenes: ['sandbox'] }, { start: 'elsewhere' }), /'start' names no program/);
  expectSkip(m({ id: 'main', transition: 'wipe', scenes: ['sandbox'] }), /transition must be 'dissolve' or 'crossfade'/);
  expectSkip(m({ id: 'main', transition: 'dissolve', scenes: ['sandbox'] }, { menu: [{ label: 'Go', program: 'nope' }] }), /unknown program "nope"/);
  expectSkip(m({ id: 'main', transition: 'dissolve', scenes: ['sandbox'] }, { menu: [{ label: 'Go', action: 'format-disk' }] }), /action must be one of eject/);
  expectSkip(m({ id: 'main', transition: 'dissolve', scenes: ['sandbox'] }, { menu: Array(11).fill({ label: 'Go', program: 'main' }) }), /menu must list 1 to 10 entries/);
  const ok = one(m({ id: 'main', transition: 'dissolve', scenes: ['sandbox'] }, { menu: [{ label: 'Go', program: 'main' }, { label: 'Out', action: 'eject' }] })).r;
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.cartridges[0].manifest.programs[0].sceneSeconds, 180, 'default scene time');
});

test('menu entries (item 4): ten entries load; scene, note and desc rules', () => {
  const sc = [{ id: 'sandbox', kind: 'builtin', ref: 'sand' }, { id: 'pl', kind: 'builtin', ref: 'plasma' }];
  const progs = [
    { id: 'main', transition: 'dissolve', scenes: ['sandbox'] },
    { id: 'two', transition: 'crossfade', scenes: ['pl'], sceneSeconds: 40 },
  ];
  const m = (menu) => ({ 'manifest.json': dataManifest('c1', { scenes: sc, programs: progs, menu }), 'label.txt': LABEL });
  const ten = one(m(Array.from({ length: 10 }, (_, i) => ({ label: 'Go ' + i, program: 'main' })))).r;
  assert.deepEqual(ten.errors, []);
  assert.equal(ten.cartridges[0].manifest.menu.length, 10);
  const ok = one(m([
    { label: 'Sand', program: 'main', scene: 'sandbox', note: '16 chars exactly', desc: 'x'.repeat(76) },
    { label: 'Out', action: 'eject', note: 'bye' },
  ])).r;
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.cartridges[0].manifest.menu[0], { label: 'Sand', program: 'main', scene: 'sandbox', note: '16 chars exactly', desc: 'x'.repeat(76) });
  assert.deepEqual(ok.cartridges[0].manifest.menu[1], { label: 'Out', action: 'eject', note: 'bye' });
  expectSkip(m([{ label: 'Go', program: 'main', scene: 'pl' }]), /menu\[0\]: scene 'pl' is not in program 'main'/);
  expectSkip(m([{ label: 'Go', program: 'two', scene: 'sandbox' }]), /menu\[0\]: scene 'sandbox' is not in program 'two'/);
  expectSkip(m([{ label: 'Go', action: 'eject', scene: 'sandbox' }]), /menu\[0\]: 'scene' goes with 'program'/);
  expectSkip(m([{ label: 'Go', program: 'main', scene: 5 }]), /menu\[0\]\.scene/);
  expectSkip(m([{ label: 'Go', program: 'main', note: 'x'.repeat(17) }]), /menu\[0\]\.note/);
  expectSkip(m([{ label: 'Go', program: 'main', desc: 'x'.repeat(77) }]), /menu\[0\]\.desc/);
  expectSkip(m([{ label: 'Go', program: 'main', note: '' }]), /menu\[0\]\.note/);
  expectSkip(m([{ label: 'Go', program: 'main', colour: 1 }]), /menu\[0\]/);
});

test('caps: more than 16 scenes, more than 8 programs', () => {
  const scenes = Array.from({ length: 17 }, (_, i) => ({ id: 'b' + String(i).padStart(2, '0'), kind: 'builtin', ref: 'sand' }));
  expectSkip({ 'manifest.json': dataManifest('c1', { scenes, programs: [{ id: 'main', transition: 'dissolve', scenes: ['b00'] }] }), 'label.txt': LABEL }, /'scenes' must list 1 to 16 scenes/);
  const programs = Array.from({ length: 9 }, (_, i) => ({ id: 'p' + String(i).padStart(2, '0'), transition: 'dissolve', scenes: ['sandbox'] }));
  expectSkip({ 'manifest.json': dataManifest('c1', { programs, start: 'p00' }), 'label.txt': LABEL }, /'programs' must list 1 to 8 programs/);
  expectSkip({ 'manifest.json': 'x'.repeat(LIMITS.manifestBytes + 1), 'label.txt': LABEL }, /manifest\.json is \d+ bytes, max 16384/);
});

// ---- DRIFT-4 B6 (schema item 6): lib files for INSTALLED cartridges only

const libFiles = (id) => ({
  'manifest.json': {
    format: 1, id, title: 'Lib ' + id, version: '1.0.0', author: 'Test', blurb: 'A cells scene that imports its own lib.', runtime: 'cartridge',
    scenes: [{ id: 'dots', kind: 'cells', title: 'Dots' }],
    programs: [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: ['dots'] }],
    start: 'main',
  },
  'label.txt': LABEL,
  'lib/digits.js': "import { DOT } from './b.js';\nexport const digit = () => DOT;\n",
  'lib/b.js': 'export const DOT = 46;\n',
  'scenes/dots.js': [
    "import { digit } from '../lib/digits.js';",
    'function dots(t, w, h, params) {',
    '  params.glyphs.fill(digit());',
    '  params.colours.fill(8);',
    '}',
    "dots.id = 'dots';",
    "dots.kind = 'cells';",
    'export default dots;',
    '',
  ].join('\n'),
});

test('lib files: an installed cartridge whose scene imports ../lib/x.js (and a lib that imports ./y.js) loads and passes the smoke render', async () => {
  const { r } = one(libFiles('libcart'), { id: 'libcart', trusted: true });
  assert.deepEqual(r.errors, []);
  assert.equal(r.cartridges.length, 1);
  const s = await loadScenes(r.cartridges[0]);
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.scenes.map((x) => [x.id, x.kind]), [['dots', 'cells']]);
  assert.equal(typeof s.scenes[0].scene, 'function');
});

test('lib files: the same folder in the user folder is skipped - user cartridges cannot contain code', () => {
  const { r } = one(libFiles('libcart'), { id: 'libcart', trusted: false });
  assert.equal(r.cartridges.length, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /user cartridges cannot contain code/);
  // the lib alone is enough: a data-only manifest with only lib/x.js is refused too
  const files = { 'manifest.json': dataManifest('c1'), 'label.txt': LABEL, 'lib/x.js': 'export const X = 1;\n' };
  expectSkip(files, /user cartridges cannot contain code/);
});

test('code-file walk: a .js buried 8 folders deep is refused and reported', () => {
  const files = base('c1', { 'a/b/c/d/e/f/g/h/evil.js': 'export default 1;\n' });
  const reason = expectSkip(files, /user cartridges cannot contain code/);
  assert.equal(reason, CODE_REASON);
});

test('code-file walk: a .js one folder deep inside a hidden folder is refused', () => {
  expectSkip(base('c1', { '.hidden/evil.mjs': 'export default 1;\n' }), /user cartridges cannot contain code/);
  expectSkip(base('c2', { '.hidden/evil.cjs': 'module.exports = 1;\n' }), /user cartridges cannot contain code/, { id: 'c2' });
});

test('code-file walk: a data-only cartridge with 3 levels of non-code subfolders still loads', () => {
  const { r } = one(base('c1', { 'notes/a/b/readme.txt': 'plain text\n', 'notes/a/data.json': '{}' }));
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(r.cartridges.length, 1);
});

test('code-file walk: a folder that cannot be read is refused, not waved through', () => {
  // chmod does not make a folder unreadable on Windows, so the failure is injected into readdirSync.
  const root = tmpRoot();
  const cart = writeCart(root, 'c1', base('c1', { 'sub/x.txt': 'x\n' }));
  const bad = path.join(cart, 'sub');
  const real = fs.readdirSync;
  fs.readdirSync = (p, ...rest) => {
    if (path.resolve(String(p)) === bad) { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; }
    return real.call(fs, p, ...rest);
  };
  let r;
  try { r = discover(root, false); } finally { fs.readdirSync = real; }
  assert.equal(r.cartridges.length, 0);
  assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
  assert.equal(r.errors[0].reason, CODE_REASON);
});

test('code-file walk: more than 2000 entries is refused (budget case)', () => {
  const files = base('c1');
  for (let i = 0; i < 2100; i++) files[`many/f${i}.txt`] = '';
  expectSkip(files, /user cartridges cannot contain code/);
});
