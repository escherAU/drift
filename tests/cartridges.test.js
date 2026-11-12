// DRIFT-4: scans over the committed cartridges/ folder and over src/.
//  - cartridges/** holds no removed glyph, and every character of every .txt and .json file (and every
//    string a .json file decodes to) is on the glyph allow-list;
//  - cartridge scene code imports only the allowed modules and never touches node:, process, fetch or
//    globalThis;
//  - no module under src/ imports a network module.
// Each scanner is proven on in-memory samples first, so a scan that finds nothing cannot pass vacuously.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAllowedGlyph, REMOVED_FOR_FONT } from '../src/glyphs.js';
import { INSTALL_DIR, discoverCartridges } from '../src/cartridge/loader.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const hex4 = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

// ---- glyph scans -----------------------------------------------------------------------------------

// Characters outside the allow-list in a text (newlines and carriage returns excepted).
export function badChars(text) {
  const bad = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 10 || cp === 13) continue;
    if (!isAllowedGlyph(cp)) bad.push(cp);
  }
  return bad;
}

// Every string a JSON text decodes to (keys and values): escapes like backslash-u2196 are caught here.
export function jsonBadChars(text) {
  const bad = [];
  const visit = (v) => {
    if (typeof v === 'string') bad.push(...badChars(v));
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { visit(k); visit(x); }
  };
  visit(JSON.parse(text));
  return bad;
}

// Code points of REMOVED_FOR_FONT written literally or as an escape sequence.
export function removedGlyphHits(text) {
  const hits = [];
  for (const ch of text) if (REMOVED_FOR_FONT.includes(ch.codePointAt(0))) hits.push(hex4(ch.codePointAt(0)));
  for (const cp of REMOVED_FOR_FONT) {
    const h = cp.toString(16);
    if (new RegExp('\\\\u\\{?0*' + h, 'i').test(text)) hits.push(hex4(cp) + ' (escaped)');
  }
  return hits;
}

test('glyph scanners: proven on in-memory samples (a clean text passes; U+2196, an emoji, a tab and an escaped U+2196 are caught)', () => {
  assert.deepEqual(badChars('plain text\r\nand box ' + String.fromCodePoint(0x2500, 0x2588) + '\n'), []);
  assert.deepEqual(badChars('a' + String.fromCodePoint(0x2196) + 'b'), [0x2196]);
  assert.deepEqual(badChars(String.fromCodePoint(0x1f600)), [0x1f600]);
  assert.deepEqual(badChars('a\tb'), [9]);
  assert.deepEqual(jsonBadChars('{"a":"fine","b":["x"]}'), []);
  assert.deepEqual(jsonBadChars('{"a":"\\u2196"}'), [0x2196], 'a JSON escape decodes to the banned character');
  assert.deepEqual(jsonBadChars('{"\\u2197k":"v"}'), [0x2197], 'keys too');
  assert.deepEqual(removedGlyphHits('clean'), []);
  assert.deepEqual(removedGlyphHits('x' + String.fromCodePoint(0x2196)), ['U+2196']);
  assert.deepEqual(removedGlyphHits('"\\u2196"'), ['U+2196 (escaped)']);
  assert.deepEqual(removedGlyphHits('"\\u{2197}"'), ['U+2197 (escaped)']);
  for (const cp of REMOVED_FOR_FONT) assert.ok(removedGlyphHits(String.fromCodePoint(cp)).length >= 1, hex4(cp));
});

const cartFiles = walk(INSTALL_DIR);

test('font: no file under cartridges/ contains a removed character, literally or as an escape sequence', () => {
  const rels = cartFiles.map(rel);
  assert.ok(cartFiles.length >= 8, `found ${cartFiles.length} files`);
  assert.ok(rels.includes('cartridges/classic/label.txt'), 'the scan reaches classic/label.txt: ' + rels.join());
  for (const f of cartFiles) assert.deepEqual(removedGlyphHits(fs.readFileSync(f, 'utf8')), [], rel(f));
});

test('glyphs: every character of every .txt and .json under cartridges/ is on the allow-list (newlines excepted)', () => {
  const texts = cartFiles.filter((f) => /\.(txt|json)$/.test(f));
  assert.ok(texts.length >= 8, `found ${texts.length} text and json files`);
  for (const f of texts) {
    const s = fs.readFileSync(f, 'utf8');
    assert.deepEqual(badChars(s).map(hex4), [], rel(f));
    if (f.endsWith('.json')) assert.deepEqual(jsonBadChars(s).map(hex4), [], rel(f) + ' (decoded strings)');
  }
});

test('cartridges/ holds only the file types a cartridge may have (.json, .txt, .js)', () => {
  for (const f of cartFiles) assert.match(f, /\.(json|txt|js)$/, rel(f));
});

// ---- import scanner --------------------------------------------------------------------------------

// Strip comments without touching string contents.
export function stripComments(src) {
  return src.replace(/("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => (str ? str : ' '));
}

// The module specifiers a source imports (static, export-from, dynamic with a literal) and whether any
// import is not a plain string literal.
// String contents replaced by x (quotes kept), so keywords inside strings are not seen as code.
function maskStrings(code) {
  return code.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, (m) => m[0] + 'x'.repeat(m.length - 2) + m[m.length - 1]);
}

export function importsOf(src) {
  const s = stripComments(src);
  const masked = maskStrings(s);
  const specs = [];
  const grab = (re) => { for (const m of masked.matchAll(re)) specs.push(s.slice(m.indices[2][0], m.indices[2][1])); };
  grab(/\b(?:import|export)\b[^'"`;()]*?\bfrom\s*(['"])(.*?)\1/gd);
  grab(/\bimport\s*(['"])(.*?)\1/gd);
  grab(/\bimport\s*\(\s*(['"])(.*?)\1\s*\)/gd);
  grab(/\brequire\s*\(\s*(['"])(.*?)\1\s*\)/gd);
  return { specs, dynamic: /\bimport\s*\(/.test(masked), hasRequire: /\brequire\s*\(/.test(masked) };
}

// What a cartridge scene module may import: these five files in src/, by relative path.
export const ALLOWED_IMPORTS = ['src/scenes/util.js', 'src/scenes/simrng.js', 'src/glyphs.js', 'src/cells.js', 'src/pixels.js'];
const BANNED_WORDS = [[/\bprocess\b/, 'process'], [/\bfetch\b/, 'fetch'], [/\bglobalThis\b/, 'globalThis'], [/node:/, 'node:'], [/\beval\b/, 'eval'], [/\bFunction\b/, 'Function'], [/\bWebSocket\b/, 'WebSocket'], [/\bXMLHttpRequest\b/, 'XMLHttpRequest']];

// Problems in one cartridge scene module (empty = clean). `file` is its repo-relative path.
export function cartridgeCodeProblems(src, file) {
  const problems = [];
  const code = stripComments(src);
  for (const [re, name] of BANNED_WORDS) if (re.test(code)) problems.push(`uses '${name}'`);
  const { specs, dynamic, hasRequire } = importsOf(src);
  if (dynamic) problems.push('dynamic import()');
  if (hasRequire) problems.push('require()');
  for (const spec of specs) {
    if (!spec.startsWith('./') && !spec.startsWith('../')) { problems.push(`imports '${spec}' (only relative paths to the allowed modules)`); continue; }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    // a flat lib file of the SAME cartridge (cartridges/<id>/lib/<name>.js) is allowed from its scenes and from its other lib files
    const lib = /^cartridges\/([a-z0-9-]+)\/lib\/[a-z0-9-]+\.js$/.exec(target);
    const own = /^cartridges\/([a-z0-9-]+)\//.exec(file);
    if (lib && own && lib[1] === own[1]) continue;
    if (!ALLOWED_IMPORTS.includes(target)) problems.push(`imports '${spec}' which resolves to ${target}`);
  }
  return problems;
}

test('import scanner: a cartridge may import its own flat lib files (scene to ../lib/x.js, lib to ./y.js) and nothing else of the kind', () => {
  const imp = (spec) => `import { x } from '${spec}';\n`;
  const LIBFILE = 'cartridges/delza/lib/a.js';
  assert.deepEqual(cartridgeCodeProblems(imp('../lib/digits.js'), 'cartridges/delza/scenes/glade.js'), []);
  assert.deepEqual(cartridgeCodeProblems(imp('./b.js') + imp('../../../src/glyphs.js') + imp('../../../src/cells.js'), LIBFILE), []);
  const bad = (src, file, re) => { const p = cartridgeCodeProblems(src, file); assert.ok(p.some((x) => re.test(x)), `${src} -> ${JSON.stringify(p)}`); };
  bad(imp('../../arcade/lib/digits.js'), 'cartridges/delza/scenes/glade.js', /resolves to cartridges\/arcade\/lib\/digits\.js/);
  bad(imp('../lib/sub/x.js'), 'cartridges/delza/scenes/glade.js', /resolves to cartridges\/delza\/lib\/sub\/x\.js/);
  bad(imp('../scenes/glade.js'), LIBFILE, /resolves to cartridges\/delza\/scenes\/glade\.js/);
  bad(imp('./other.js'), 'cartridges/delza/scenes/glade.js', /resolves to cartridges\/delza\/scenes\/other\.js/);
  bad(imp('../../arcade/lib/digits.js'), LIBFILE, /resolves to cartridges\/arcade\/lib\/digits\.js/);
  bad(imp('../lib/Digits.js'), 'cartridges/delza/scenes/glade.js', /resolves to/);
});

const SCENE = 'cartridges/delza/scenes/glade.js';

test('import scanner: proven on in-memory samples (clean passes; each ban is caught)', () => {
  const good = "import { rand } from '../../../src/scenes/util.js';\nimport { rnd } from '../../../src/scenes/simrng.js';\nimport { isAllowedGlyph } from '../../../src/glyphs.js';\nimport { STEP_HZ } from '../../../src/cells.js';\n// a comment may say process, fetch, globalThis or node:fs\n/* and so may a block comment: eval */\nexport default function glade() {}\n";
  assert.deepEqual(cartridgeCodeProblems(good, SCENE), []);
  assert.deepEqual(cartridgeCodeProblems("import './../../../src/glyphs.js';\n", SCENE), []);
  assert.deepEqual(importsOf(good).specs, ['../../../src/scenes/util.js', '../../../src/scenes/simrng.js', '../../../src/glyphs.js', '../../../src/cells.js']);
  const bad = (src, re) => { const p = cartridgeCodeProblems(src, SCENE); assert.ok(p.some((x) => re.test(x)), `${JSON.stringify(src)} -> ${JSON.stringify(p)}`); };
  bad("import fs from 'node:fs';\n", /node:/);
  bad("import fs from 'fs';\n", /imports 'fs'/);
  bad("import https from 'https';\n", /imports 'https'/);
  bad("const x = process.env.HOME;\n", /process/);
  bad("fetch('http://example.test/x');\n", /fetch/);
  bad("globalThis.thing = 1;\n", /globalThis/);
  bad("const m = await import('../../../src/scenes/util.js');\n", /dynamic import/);
  bad("const m = import(name);\n", /dynamic import/);
  bad("const fs = require('fs');\n", /require/);
  bad("eval('1');\n", /eval/);
  bad("new Function('return 1');\n", /Function/);
  bad("import { App } from '../../../src/app.js';\n", /resolves to src\/app\.js/);
  bad("import { x } from '../../../src/scenes/plasma.js';\n", /resolves to src\/scenes\/plasma\.js/);
  bad("import { x } from './other.js';\n", /resolves to cartridges\/delza\/scenes\/other\.js/);
  bad("import { x } from '../../../../outside.js';\n", /resolves to/);
  bad("import { x } from '/abs/path.js';\n", /imports '\/abs\/path\.js'/);
  bad("import { x } from 'https://example.test/x.js';\n", /imports 'https:\/\/example\.test\/x\.js'/);
  bad("export * from '../../../src/app.js';\n", /resolves to src\/app\.js/);
  bad("export { x } from '../../../src/term.js';\n", /resolves to src\/term\.js/);
  assert.deepEqual(importsOf("const s = 'import x from \"y\"';").specs, [], 'an import inside a string is not an import');
});

test('import scanner: src/pixels.js is allowed (scene and lib file); user-folder cartridges still cannot hold code', async () => {
  const imp = "import { safeHue, pixelsToCells } from '../../../src/pixels.js';\nexport default function s() { return safeHue(0, 0.5); }\n";
  assert.ok(ALLOWED_IMPORTS.includes('src/pixels.js'));
  assert.deepEqual(cartridgeCodeProblems(imp, SCENE), []);
  assert.deepEqual(cartridgeCodeProblems("import { relY } from '../../../src/pixels.js';\n", 'cartridges/delza/lib/a.js'), []);
  // neighbours are still refused: the allow-list is exact, not a prefix
  const bad = (src) => assert.ok(cartridgeCodeProblems(src, SCENE).length > 0, src);
  bad("import { x } from '../../../src/pixels2.js';\n");
  bad("import { x } from '../../../src/Pixels.js';\n");
  bad("import { x } from '../../../src/renderer.js';\n");
  // negative arm: the same scene in a USER-folder cartridge is refused before anything is imported
  const { tmpRoot, writeCart, dataManifest, LABEL } = await import('./helpers-cartridge.js');
  const files = { 'manifest.json': dataManifest('pix'), 'label.txt': LABEL, 'scenes/s.js': imp };
  const user = tmpRoot(); writeCart(user, 'pix', files);
  const ru = discoverCartridges({ dirs: [{ dir: user, trusted: false }] });
  assert.equal(ru.cartridges.length, 0);
  assert.equal(ru.errors.length, 1);
  assert.match(ru.errors[0].reason, /user cartridges cannot contain code/);
  // and the install folder accepts that cartridge folder (code files allowed there)
  const inst = tmpRoot(); writeCart(inst, 'pix', files);
  const ri = discoverCartridges({ dirs: [{ dir: inst, trusted: true }] });
  assert.deepEqual(ri.errors, []);
  assert.equal(ri.cartridges.length, 1);
});

test('import scanner: the trusted fixture scenes (self-contained code) are clean', async () => {
  const { tmpRoot, makeFixtureCartridge } = await import('./helpers-cartridge.js');
  const root = tmpRoot();
  const dir = makeFixtureCartridge(root);
  const files = walk(path.join(dir, 'scenes')).filter((f) => f.endsWith('.js'));
  assert.equal(files.length, 4);
  for (const f of files) assert.deepEqual(cartridgeCodeProblems(fs.readFileSync(f, 'utf8'), 'cartridges/fixture/scenes/' + path.basename(f)), [], f);
});

test('cartridge code: every .js under cartridges/ imports only the allowed modules and avoids node:, process, fetch and globalThis', () => {
  const codeFiles = cartFiles.filter((f) => f.endsWith('.js'));
  for (const f of codeFiles) assert.deepEqual(cartridgeCodeProblems(fs.readFileSync(f, 'utf8'), rel(f)), [], rel(f));
  // today the install folder holds no scene code (Delza arrives in slice 3); the scan above is
  // proven by the samples, and picks the files up the moment they exist
  assert.ok(codeFiles.length >= 0);
});

// ---- no network code in src/ ---------------------------------------------------------------------------

const NETWORK = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'child_process', 'cluster', 'worker_threads'];
export function networkImports(src) {
  const { specs } = importsOf(src);
  const hits = [];
  for (const spec of specs) {
    const name = spec.startsWith('node:') ? spec.slice(5) : spec;
    if (NETWORK.includes(name.split('/')[0])) hits.push(spec);
  }
  return hits;
}

test('network scanner: proven on in-memory samples (node:https, node:net, node:http, bare https and net, dynamic and require forms)', () => {
  assert.deepEqual(networkImports("import fs from 'node:fs';\nimport os from 'node:os';\n"), []);
  for (const spec of ['node:https', 'node:net', 'node:http', 'https', 'http', 'net', 'node:tls', 'node:dgram', 'node:http2', 'node:dns', 'node:dns/promises', 'node:child_process']) {
    assert.deepEqual(networkImports(`import x from '${spec}';`), [spec], spec);
  }
  assert.deepEqual(networkImports("const m = await import('node:https');"), ['node:https']);
  assert.deepEqual(networkImports("const m = require('net');"), ['net']);
  assert.deepEqual(networkImports("export { get } from 'node:http';"), ['node:http']);
  assert.deepEqual(networkImports("// import https from 'https';\n"), [], 'comments do not count');
});

test('no module under src/ (or bin/) imports node:https, node:net, node:http or another network module', () => {
  const files = [...walk(SRC), ...walk(path.join(ROOT, 'bin'))].filter((f) => /\.(js|mjs)$/.test(f));
  assert.ok(files.length > 30, `scanned ${files.length} files`);
  assert.ok(files.some((f) => rel(f) === 'src/cartridge/loader.js') && files.some((f) => rel(f) === 'src/app.js'), 'the scan reaches the new and the old modules');
  for (const f of files) assert.deepEqual(networkImports(fs.readFileSync(f, 'utf8')), [], rel(f));
});

test('every installed cartridge has a unique shelf code of the form DM-nn (the Driftman 9000 is the one deliberate outlier, DM-9K)', () => {
  const found = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges;
  assert.ok(found.length >= 4);
  const codes = found.map((c) => c.manifest.code);
  for (const [i, code] of codes.entries()) assert.match(String(code), found[i].id === 'driftman-9000' ? /^DM-9K$/ : /^DM-\d\d$/, found[i].id);
  assert.equal(new Set(codes).size, codes.length, `codes are unique: ${codes.join(' ')}`);
});
