// DRIFT-4: the "how to make a cartridge" example in README.md must load. The four files are pulled out of the
// README itself (a bold path line, then a fenced block) and put through the real loader as a USER cartridge
// (untrusted: data only), so the documented example cannot go stale.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverCartridges, loadScenes } from '../src/cartridge/loader.js';
import { tmpRoot } from './helpers-cartridge.js';

const README = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');

function exampleFiles() {
  const files = {};
  const re = /\*\*(hello\/[A-Za-z0-9_./-]+)\*\*\r?\n\r?\n```[a-z]*\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(README))) files[m[1]] = m[2];
  return files;
}

function build(files) {
  const root = tmpRoot('drift-readme-');
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return root;
}

test('README example: the four files are there, and they load as a data-only user cartridge', async () => {
  const files = exampleFiles();
  assert.deepEqual(Object.keys(files).sort(), ['hello/label.txt', 'hello/manifest.json', 'hello/scenes/note.txt', 'hello/skin.json']);
  const root = build(files);
  const r = discoverCartridges({ dirs: [{ dir: root, trusted: false }] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.cartridges.length, 1);
  const c = r.cartridges[0];
  assert.equal(c.id, 'hello');
  assert.equal(c.trusted, false);
  assert.equal(c.locked, false);
  assert.equal(c.manifest.start, 'main');
  assert.ok(c.skin && c.skin.palette.bg === '#0B140C');
  const ls = await loadScenes(c);
  assert.deepEqual(ls.errors, []);
  assert.deepEqual(ls.scenes.map((s) => `${s.id}:${s.kind}`), ['note:text', 'grains:builtin']);
});

test('README example, control: a broken copy of it is refused (the check bites), and a .js file makes it a code cartridge', () => {
  const files = exampleFiles();
  const broken = build({ ...files, 'hello/manifest.json': files['hello/manifest.json'].replace('"id": "hello"', '"id": "other"') });
  const r = discoverCartridges({ dirs: [{ dir: broken, trusted: false }] });
  assert.equal(r.cartridges.length, 0);
  assert.match(r.errors[0].reason, /does not match the manifest id/);
  const withCode = build({ ...files, 'hello/scenes/extra.js': 'export default 1;\n' });
  const c = discoverCartridges({ dirs: [{ dir: withCode, trusted: false }] });
  assert.equal(c.cartridges.length, 0);
  assert.match(c.errors[0].reason, /user cartridges cannot contain code/);
});
