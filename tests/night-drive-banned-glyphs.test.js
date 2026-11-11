// DRIFT-5: two repository-wide tripwires for the cartridges folder.
//   (1) Banned glyphs. No file under cartridges/ (all five cartridges, read as utf8) contains any of the ten banned code points
//       U+25CD U+25CE U+25D1 U+25E2 U+25E3 U+222B U+2261 U+25D0 U+25D3 U+25D2. The older C8 test in night-drive-cartridge.test.js scans
//       only seven of the ten and only night-drive; this one scans every cartridge file, scenes and lib and skin and manifest and labels alike.
//   (2) Original content. No file under cartridges/night-drive/ (text and code) names one of a list of third-party titles, makes or places,
//       case-insensitive. This is a tripwire for NAMED third-party material, not proof of originality: a copied idea with another name passes.
// Each part has a control: the same scanner flags a temp folder holding a file with a banned glyph, and flags planted text with 'Out Run'.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INSTALL_DIR } from '../src/cartridge/loader.js';
import { BANNED } from './helpers-night-drive.js';

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}
const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');

// Returns [{ file, glyph }] for every banned code point in every file under root.
function scanBanned(root) {
  const hits = [];
  for (const f of walk(root)) {
    const text = fs.readFileSync(f, 'utf8');
    for (const ch of text) if (BANNED.includes(ch.codePointAt(0))) hits.push({ file: rel(root, f), glyph: `U+${ch.codePointAt(0).toString(16).toUpperCase()}` });
  }
  return hits;
}

const NAMES = [
  'San Junipero', 'Outrun', 'Out Run', 'Testarossa', 'Ferrari', 'Lamborghini', 'DeLorean', 'Miami Vice', 'Blade Runner', 'Kavinsky',
  'Knight Rider', 'Black Mirror', 'Hotline Miami', 'Porsche', 'Corvette',
];
// Returns [{ file, name }] for every third-party name found (case-insensitive) in any file under root.
function scanNames(root) {
  const hits = [];
  for (const f of walk(root)) {
    const text = fs.readFileSync(f, 'utf8').toLowerCase();
    for (const n of NAMES) if (text.includes(n.toLowerCase())) hits.push({ file: rel(root, f), name: n });
  }
  return hits;
}

test('banned glyphs (1): no file under cartridges/ (every cartridge) holds any of the ten banned code points; the walk reaches night-drive scenes, delza and classic', () => {
  assert.equal(BANNED.length, 10);
  assert.deepEqual([...BANNED].sort((a, b) => a - b), [0x222b, 0x2261, 0x25cd, 0x25ce, 0x25d0, 0x25d1, 0x25d2, 0x25d3, 0x25e2, 0x25e3]);
  const files = walk(INSTALL_DIR).map((f) => rel(INSTALL_DIR, f));
  console.log(`TABLE banned glyphs: ${files.length} files under cartridges/`);
  assert.ok(files.length >= 40, `at least 40 files scanned (found ${files.length})`);
  assert.ok(files.some((f) => f.startsWith('night-drive/scenes/')), 'the walk reaches night-drive/scenes');
  assert.ok(files.some((f) => f.startsWith('delza/')), 'the walk reaches delza');
  assert.ok(files.some((f) => f.startsWith('classic/')), 'the walk reaches classic');
  assert.deepEqual(scanBanned(INSTALL_DIR), [], 'banned glyphs in the cartridges');
});

test('banned glyphs (1) control: a temp folder with a file holding a banned glyph (U+25D0) is flagged by the same scanner, and a clean file beside it is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-banned-'));
  try {
    fs.mkdirSync(path.join(dir, 'scenes'));
    fs.writeFileSync(path.join(dir, 'scenes', 'bad.js'), '// a half circle: ◐\n');
    fs.writeFileSync(path.join(dir, 'scenes', 'good.js'), '// plain ┃ ╲ glyphs only\n');
    const hits = scanBanned(dir);
    assert.deepEqual(hits, [{ file: 'scenes/bad.js', glyph: 'U+25D0' }]);
    for (const cp of BANNED) {
      fs.writeFileSync(path.join(dir, 'scenes', 'bad.js'), `x${String.fromCodePoint(cp)}y`);
      assert.equal(scanBanned(dir).length, 1, `U+${cp.toString(16)} is flagged`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('original content (2): no file under cartridges/night-drive/ names a third-party title or make (case-insensitive tripwire; not proof of originality)', () => {
  const root = path.join(INSTALL_DIR, 'night-drive');
  const files = walk(root);
  assert.ok(files.length >= 25, `night-drive has ${files.length} files`);
  for (const f of ['manifest.json', 'skin.json', 'label.txt', 'scenes/caller.js', 'lib/palette.js']) assert.ok(files.some((p) => rel(root, p) === f), `the walk reaches ${f}`);
  assert.deepEqual(scanNames(root), [], 'third-party names in Night Drive');
});

test('original content (2) control: planted text with \'Out Run\' (and in another case) is flagged by the same scanner; text without a name is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-names-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a night drive, a lot like Out Run\n');
    fs.writeFileSync(path.join(dir, 'b.js'), '// BLADE RUNNER rain\n');
    fs.writeFileSync(path.join(dir, 'c.txt'), 'neon, rain and a red light\n');
    const hits = scanNames(dir);
    assert.deepEqual(hits.map((h) => `${h.file}:${h.name}`).sort(), ['a.txt:Out Run', 'b.js:Blade Runner']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
