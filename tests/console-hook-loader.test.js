// DRIFT-7 C11: the console hook, cartridge side. Manifest field "console": "code" (format 2, install folder only), console.js with a
// default export { id, drawConsole }, the same trust wall as scene code, and the load-time smoke render at the two console sizes.
// All cartridges here are temp-folder fixtures (nothing is added under cartridges/).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateManifest, FORMAT_GATES, CODE_REASON } from '../src/cartridge/schema.js';
import { discoverCartridges, loadScenes } from '../src/cartridge/loader.js';
import { smokeConsole, checkConsoleExport, SMOKE_MS } from '../src/cartridge/consolehook.js';
import { tmpRoot, writeCart, LABEL } from './helpers-cartridge.js';
import {
  manifestOf, discoverConsoleCart, calmHookSource, harshHookSource, strobeHookSource, insertedShell, flush, DT, CART_SKIN, DARK_SCENE, writeConsoleCart,
} from './helpers-console-hook.js';
import { cartridgeCodeProblems } from './cartridges.test.js';

// scenes that are data (a builtin), so the only code in the folder is console.js
const DATA_ONLY = { manifest: { scenes: [{ id: 'sandbox', kind: 'builtin', ref: 'sand' }], programs: [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: ['sandbox'] }] }, files: { 'scenes/dark.js': null } };
const hookOf = (body, id = 'fx-console') => `export default { id: ${JSON.stringify(id)}, drawConsole(f, c) {\n${body}\n} };\n`;
const GOOD_BODY = '  const r = c.rect; for (let x = 0; x < r.w; x++) { const i = r.y * f.cols + r.x + x; f.glyphs[i] = 0x2500; f.shades[i] = 255; f.fg[i] = 0x808080; f.bg[i] = 0x1000000; }';

async function loaded(source, over = {}) {
  const d = discoverConsoleCart('fx', { source, ...over });
  assert.deepEqual(d.errors, [], 'discovery: ' + JSON.stringify(d.errors));
  return loadScenes(d.cartridges[0]);
}

// ---- 1. schema

const man = (over = {}) => manifestOf('fx', over);

test('CH1 schema: console "code" is accepted at format 2 (install folder) and kept; a manifest without it has no console key; FORMAT_GATES says format 2', () => {
  assert.equal(FORMAT_GATES.console, 2);
  const r = validateManifest(man(), { trusted: true });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.manifest.console, 'code');
  const plain = validateManifest(man({ console: undefined }), { trusted: true });
  assert.equal(plain.ok, true);
  assert.equal('console' in plain.manifest, false);
});

test('CH1 schema: format 1 with console is refused with the needs-a-newer-Drift wording (same as rgb); a value other than "code" is refused', () => {
  const old = validateManifest(man({ format: 1 }), { trusted: true });
  assert.equal(old.ok, false);
  assert.match(old.reason, /'console': needs a newer Drift \('console' is a format 2 field; this cartridge says format 1\)/);
  for (const bad of ['text', 'Code', true, 1, null, {}, [], '']) {
    const x = validateManifest(man({ console: bad }), { trusted: true });
    assert.equal(x.ok, false, JSON.stringify(bad));
    assert.match(x.reason, /'console' must be "code"/, JSON.stringify(bad));
  }
  // a locked card and the classic cartridge cannot carry the field
  const locked = validateManifest({ format: 2, id: 'lk', title: 'Lk', version: '1.0.0', author: 'T', blurb: 'b', locked: true, console: 'code' }, { trusted: true });
  assert.match(locked.reason, /locked cartridges cannot have 'console'/);
  const classic = validateManifest({ format: 2, id: 'classic', title: 'Classic', version: '1.0.0', author: 'T', blurb: 'b', runtime: 'classic', console: 'code' }, { trusted: true });
  assert.match(classic.reason, /the classic cartridge cannot have 'console'/);
});

test('CH1 schema: console "code" without a console.js file is a clear error at discovery', () => {
  const d = discoverConsoleCart('fx', { source: null });
  assert.equal(d.cartridges.length, 0);
  assert.equal(d.errors.length, 1);
  assert.match(d.errors[0].reason, /console\.js is missing \(the manifest says "console": "code"\)/);
});

test('CH1 schema: console.js default export shape - id must be a non-empty string, drawConsole a function', async () => {
  const cases = [
    ['export default null;', /default export must be an object/],
    ['export default function drawConsole() {}', /default export must be an object/],
    ['export default [];', /default export must be an object/],
    ['export default { drawConsole() {} };', /needs an id/],
    ['export default { id: 7, drawConsole() {} };', /needs an id/],
    ['export default { id: "", drawConsole() {} };', /needs an id/],
    ['export default { id: "x" };', /needs a drawConsole function/],
    ['export default { id: "x", drawConsole: 3 };', /needs a drawConsole function/],
    ['export const x = 1;', /default export must be an object/],
    ['throw new Error("at import");', /console\.js cannot be loaded: at import/],
  ];
  for (const [source, re] of cases) {
    const r = await loaded(source);
    assert.deepEqual(r.scenes, [], source);
    assert.equal(r.errors.length, 1, source);
    assert.match(r.errors[0].reason, re, source);
    assert.equal(r.console, undefined, source);
  }
  assert.equal(checkConsoleExport({ default: { id: 'x', drawConsole() {} } }), null);
});

// ---- 2. trust: the same wall as scene code

test('CH2 trust, install arm: an install-folder cartridge with a hook loads it, keeps its scenes, and reports it as r.console', async () => {
  const r = await loaded(calmHookSource('calm-console'));
  assert.deepEqual(r.errors, []);
  assert.equal(r.scenes.length, 1);
  assert.equal(r.console.id, 'calm-console');
  assert.equal(typeof r.console.drawConsole, 'function');
});

test('CH2 trust, user arm: the same cartridge in the user folder is refused at discovery with the code reason; nothing is imported', () => {
  const marker = path.join(tmpRoot('drift-hook-marker-'), 'ran.txt');
  const source = `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, 'ran');\n${hookOf(GOOD_BODY)}`;
  const d = discoverConsoleCart('fx', { source, ...DATA_ONLY }, false);
  assert.equal(d.cartridges.length, 0);
  assert.equal(d.errors.length, 1);
  assert.equal(d.errors[0].reason, `'console': ${CODE_REASON}`);
  assert.equal(fs.existsSync(marker), false, 'nothing was imported');
  // the install folder takes the very same folder
  const inst = discoverCartridges({ dirs: [{ dir: d.root, trusted: true }] });
  assert.deepEqual(inst.errors, []);
  assert.equal(inst.cartridges.length, 1);
});

test('CH2 trust: a user cartridge that holds console.js but does not say "console" is refused by the code-file walk, as any code file is', () => {
  const root = tmpRoot('drift-hook-');
  writeConsoleCart(root, 'fx', { source: hookOf(GOOD_BODY), ...DATA_ONLY, manifest: { ...DATA_ONLY.manifest, console: undefined, format: 1 } });
  const d = discoverCartridges({ dirs: [{ dir: root, trusted: false }] });
  assert.equal(d.cartridges.length, 0);
  assert.equal(d.errors[0].reason, CODE_REASON);
});

test('CH2 trust, second wall: loadScenes refuses an untrusted cartridge object (never imports console.js), even with the file in place', async () => {
  const marker = path.join(tmpRoot('drift-hook-marker-'), 'ran2.txt');
  const source = `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, 'ran');\n${hookOf(GOOD_BODY)}`;
  const d = discoverConsoleCart('fx', { source });
  const cart = { ...d.cartridges[0], trusted: false };
  const r = await loadScenes(cart);
  assert.deepEqual(r.scenes, []);
  assert.ok(r.errors.some((e) => e.reason === CODE_REASON), JSON.stringify(r.errors));
  assert.equal(fs.existsSync(marker), false, 'the second wall stops the import');
  // control: the trusted object does import it
  const ok = await loadScenes(d.cartridges[0]);
  assert.deepEqual(ok.errors, []);
  assert.equal(fs.existsSync(marker), true, 'the control imports console.js (the marker is written)');
});

test('CH2 import scan: the repo scan (cartridges.test.js) applies to console.js at cartridges/<id>/console.js - fs, node:, a non-allow-listed module and others are refused', () => {
  const FILE = 'cartridges/hookcart/console.js';
  const imp = (spec) => `import { x } from '${spec}';\nexport default { id: 'a', drawConsole() {} };\n`;
  assert.deepEqual(cartridgeCodeProblems(imp('../../src/glyphs.js'), FILE), []);
  assert.deepEqual(cartridgeCodeProblems(imp('../../src/pixels.js'), FILE), []);
  assert.deepEqual(cartridgeCodeProblems(imp('./lib/paint.js'), FILE), [], 'its own flat lib file');
  const bad = (src, re) => { const p = cartridgeCodeProblems(src, FILE); assert.ok(p.some((x) => re.test(x)), `${src} -> ${JSON.stringify(p)}`); };
  bad("import fs from 'node:fs';\nexport default { id: 'a', drawConsole() {} };\n", /node:/);
  bad("import fs from 'fs';\nexport default { id: 'a', drawConsole() {} };\n", /imports 'fs'/);
  bad(imp('../../src/renderer.js'), /resolves to src\/renderer\.js/);
  bad(imp('../../src/shell/library.js'), /resolves to src\/shell\/library\.js/);
  bad(imp('../other/lib/paint.js'), /resolves to/);
  bad("export default { id: 'a', drawConsole() { return process.env.HOME; } };\n", /process/);
  bad("export default { id: 'a', drawConsole() { return globalThis.x; } };\n", /globalThis/);
  bad("const m = await import('../../src/glyphs.js');\nexport default { id: 'a', drawConsole() {} };\n", /dynamic import/);
});

// ---- 3. smoke render

async function smokeOf(body) {
  const r = await loaded(hookOf(body));
  return r.errors.length ? r.errors[0].reason : null;
}

test('CH3 smoke: a good hook passes (the control), and the smoke covers both sizes', async () => {
  assert.equal(await smokeOf(GOOD_BODY), null);
  for (const src of [calmHookSource(), harshHookSource(), strobeHookSource()]) {
    const r = await loaded(src);
    assert.deepEqual(r.errors, []);
    assert.equal(smokeConsole(r.console), null);
  }
  // the sizes: a hook that only draws properly at one tier is caught at the other
  const seen = new Set();
  const spy = { id: 'spy', drawConsole(f, c) { seen.add(`${c.tier}:${c.rect.w}x${c.rect.h}:${c.screen ? c.screen.w + 'x' + c.screen.h : 'none'}`); } };
  assert.equal(smokeConsole(spy), null);
  assert.deepEqual([...seen].sort(), ['full:84x18:46x9', 'mini:38x4:none']);
});

test('CH3 smoke: a hook that throws goes to an error on the cartridge - at 84x18, and (separately) only at 38x4', async () => {
  assert.match(await smokeOf('  throw new Error("boom");'), /console\.js: smoke render at 84x18 threw: boom/);
  assert.match(await smokeOf('  if (c.tier === "mini") throw new Error("mini boom");'), /console\.js: smoke render at 38x4 threw: mini boom/);
});

test('CH3 smoke: a hook that draws garbage is refused (glyph, fg, bg, shade, blank cell with a shade, replaced buffers)', async () => {
  const at = '  const i = c.rect.y * f.cols + c.rect.x;\n';
  assert.match(await smokeOf(at + '  f.glyphs[i] = 0x2196; f.shades[i] = 255;'), /U\+2196, which is not an allowed glyph/);
  assert.match(await smokeOf(at + '  f.glyphs[i] = 65; f.shades[i] = 255; f.fg[i] = 0x1000001;'), /full-colour cell with fg 0x1000001/);
  assert.match(await smokeOf(at + '  f.glyphs[i] = 65; f.shades[i] = 255; f.bg[i] = 0x1000001;'), /full-colour cell with bg 0x1000001/);
  assert.equal(await smokeOf(at + '  f.glyphs[i] = 65; f.shades[i] = 255; f.fg[i] = 0xFFFFFF; f.bg[i] = 0x1000000;'), null, 'PALETTE_BG is a legal bg');
  assert.match(await smokeOf(at + '  f.glyphs[i] = 65; f.shades[i] = 77;'), /drew shade 77/);
  assert.match(await smokeOf(at + '  f.glyphs[i] = 32; f.shades[i] = 5;'), /blank cell with shade 5/);
  assert.match(await smokeOf('  f.glyphs = new Uint16Array(4);'), /replaced the frame's buffers/);
  assert.equal(await smokeOf(at + '  f.glyphs[i] = 65; f.shades[i] = 7;'), null, 'a console palette shade (below 20) is legal');
});

test('CH3 smoke: a hook that writes outside its rect is refused (above, left, below, and only at the mini size)', async () => {
  const w = (dx, dy) => `  const i = (c.rect.y + ${dy}) * f.cols + c.rect.x + ${dx}; f.glyphs[i] = 65; f.shades[i] = 255;`;
  assert.match(await smokeOf(w(-1, 0)), /wrote outside its rect, at column 3, row 4/);
  assert.match(await smokeOf(w(0, -1)), /wrote outside its rect/);
  assert.match(await smokeOf('  const i = (c.rect.y + c.rect.h) * f.cols + c.rect.x; f.glyphs[i] = 65; f.shades[i] = 255;'), /wrote outside its rect/);
  assert.match(await smokeOf('  if (c.tier === "mini") { const i = (c.rect.y + c.rect.h) * f.cols + c.rect.x; f.glyphs[i] = 65; f.shades[i] = 255; }'), /smoke render at 38x4 wrote outside/);
  assert.equal(await smokeOf('  const i = c.rect.y * f.cols + (c.rect.x + c.rect.w - 1); f.glyphs[i] = 65; f.shades[i] = 255;'), null, 'the last cell inside is fine');
});

test('CH3 smoke: a hook that is too slow at one size is refused (an in-process loop cannot be interrupted, so the time is checked after it returns)', async () => {
  const slow = `  if (c.tier === "mini") { const end = Date.now() + ${SMOKE_MS + 150}; while (Date.now() < end); }`;
  assert.match(await smokeOf(slow), /smoke render at 38x4 took \d+ ms/);
  assert.equal(await smokeOf('  const end = Date.now() + 5; while (Date.now() < end);'), null, 'a few milliseconds is fine');
});

test('CH3 smoke: a hook that is not pure (random cells) is refused', async () => {
  assert.match(await smokeOf('  const i = c.rect.y * f.cols + c.rect.x; f.glyphs[i] = 65 + Math.floor(Math.random() * 20); f.shades[i] = 255;'), /is not pure/);
});

test('CH3 error card: a hook that fails its load lands on the existing error card; the cartridge never reaches running', async () => {
  for (const body of ['  throw new Error("boom");', '  const i = (c.rect.y - 1) * f.cols + c.rect.x; f.glyphs[i] = 65; f.shades[i] = 255;']) {
    const { sh } = insertedShell(120, 40, { source: hookOf(body) });
    await flush();
    const seen = new Set();
    let card = '';
    for (let t = 0; t < 6 && sh.state().screen !== 'library'; t += DT) {
      const f = sh.frame();
      seen.add(sh.state().screen);
      if (sh.state().screen === 'error') card = Array.from({ length: f.rows }, (_, y) => String.fromCharCode(...f.glyphs.subarray(y * f.cols, (y + 1) * f.cols))).join('\n');
      sh.tick(DT);
    }
    assert.ok(seen.has('error'), 'the error card showed');
    assert.equal(seen.has('running'), false, 'it never ran');
    assert.match(card, /Cartridge problem/);
    assert.match(card, /console\.js/);
    assert.equal(sh.state().screen, 'library', 'then the library');
  }
  // the control: the good hook reaches running
  const ok = insertedShell(120, 40, { source: hookOf(GOOD_BODY) });
  await flush();
  for (let t = 0; t < 7 && ok.sh.state().screen !== 'running'; t += DT) { ok.sh.frame(); ok.sh.tick(DT); }
  assert.equal(ok.sh.state().screen, 'running');
});

test('CH3 the loader still returns exactly { scenes, errors } for a cartridge without a hook (no console key)', async () => {
  const root = tmpRoot('drift-hook-');
  writeCart(root, 'plain', {
    'manifest.json': { format: 1, id: 'plain', title: 'Plain', version: '1.0.0', author: 'T', blurb: 'b', runtime: 'cartridge', scenes: [{ id: 'dark', kind: 'cells' }], programs: [{ id: 'main', transition: 'dissolve', scenes: ['dark'], sceneSeconds: 30 }], start: 'main' },
    'label.txt': LABEL, 'scenes/dark.js': DARK_SCENE,
  });
  const d = discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
  const r = await loadScenes(d.cartridges[0]);
  assert.deepEqual(Object.keys(r).sort(), ['errors', 'scenes']);
  assert.equal(d.cartridges[0].consoleFile, undefined);
  void CART_SKIN;
});
