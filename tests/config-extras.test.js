// DRIFT-4: config extras. The four core fields stay exactly as tests/config.test.js pins them;
// extra fields (lastCartridge) live beside them, survive updateConfig, and are validated on their own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, EXTRA_FIELDS, loadConfig, loadExtras, saveConfig, updateConfig, validateConfig } from '../src/config.js';
import { ID_RE } from '../src/cartridge/schema.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-cfgx-')); }
const read = (p) => fs.readFileSync(p, 'utf8');

test('config extras: lastCartridge is the only extra, validated with the cartridge id pattern', () => {
  assert.deepEqual(Object.keys(EXTRA_FIELDS), ['lastCartridge']);
  const ok = EXTRA_FIELDS.lastCartridge;
  for (const good of ['delza', 'night-drive', 'ab', 'a1b2']) assert.equal(ok(good), true, good);
  for (const bad of ['', 'a', 'Delza', '../x', 'a/b', 'C:x', '-ab', 'ab-', 5, null, undefined, {}, 'x'.repeat(33)]) assert.equal(ok(bad), false, String(bad));
  assert.ok(ID_RE.test('delza'));
});

test('config extras: the core shape does not grow (validateConfig, loadConfig and DEFAULT_CONFIG stay four fields)', () => {
  const dir = tmp();
  const p = path.join(dir, 'config.json');
  fs.writeFileSync(p, JSON.stringify({ colour: 'ice', lastCartridge: 'delza' }));
  assert.deepEqual(Object.keys(DEFAULT_CONFIG), ['colour', 'mode', 'chaosPalette', 'invert']);
  assert.deepEqual(Object.keys(loadConfig(p)), ['colour', 'mode', 'chaosPalette', 'invert']);
  assert.deepEqual(Object.keys(validateConfig({ lastCartridge: 'delza' })), ['colour', 'mode', 'chaosPalette', 'invert']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config extras: loadExtras returns only valid extras that are present', () => {
  const dir = tmp();
  const p = path.join(dir, 'config.json');
  assert.deepEqual(loadExtras(p), {}, 'missing file');
  fs.writeFileSync(p, '{not json');
  assert.deepEqual(loadExtras(p), {}, 'corrupt file');
  fs.writeFileSync(p, '[1,2]');
  assert.deepEqual(loadExtras(p), {}, 'array file');
  fs.writeFileSync(p, JSON.stringify({ colour: 'ice' }));
  assert.deepEqual(loadExtras(p), {}, 'absent');
  fs.writeFileSync(p, JSON.stringify({ colour: 'ice', lastCartridge: 'night-drive', other: 1 }));
  assert.deepEqual(loadExtras(p), { lastCartridge: 'night-drive' });
  fs.writeFileSync(p, JSON.stringify({ lastCartridge: 'Not Valid' }));
  assert.deepEqual(loadExtras(p), {}, 'invalid value');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config extras: a second window changing the colour (c) keeps lastCartridge', () => {
  const dir = tmp();
  const p = path.join(dir, 'drift', 'config.json');
  saveConfig(p, { colour: 'ice' });
  assert.equal(updateConfig(p, { lastCartridge: 'delza' }), true); // window one inserts a cartridge
  assert.equal(loadExtras(p).lastCartridge, 'delza');
  assert.equal(updateConfig(p, { colour: 'amber' }), true); // window two presses c
  assert.equal(loadConfig(p).colour, 'amber');
  assert.deepEqual(loadExtras(p), { lastCartridge: 'delza' }, 'the extra survived a core-field update');
  assert.deepEqual(JSON.parse(read(p)), { colour: 'amber', mode: 'calm', chaosPalette: 'neon', invert: false, lastCartridge: 'delza' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config extras: updateConfig applies an extra patch per field; an invalid extra value is ignored and the old one is kept', () => {
  const dir = tmp();
  const p = path.join(dir, 'config.json');
  updateConfig(p, { lastCartridge: 'delza' });
  updateConfig(p, { lastCartridge: '../evil' });
  assert.deepEqual(loadExtras(p), { lastCartridge: 'delza' });
  updateConfig(p, { lastCartridge: 'night-drive', mode: 'chaos' });
  assert.deepEqual(loadExtras(p), { lastCartridge: 'night-drive' });
  assert.equal(loadConfig(p).mode, 'chaos');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config extras: an invalid extra already in the file is dropped on the next write; unknown keys are still dropped', () => {
  const dir = tmp();
  const p = path.join(dir, 'config.json');
  fs.writeFileSync(p, JSON.stringify({ colour: 'ice', lastCartridge: 'NOPE!', stray: true }));
  assert.equal(updateConfig(p, { colour: 'green' }), true);
  assert.deepEqual(JSON.parse(read(p)), { colour: 'green', mode: 'calm', chaosPalette: 'neon', invert: false });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config extras: a file without extras is written byte for byte as before (the four fields, 2-space JSON, newline)', () => {
  const dir = tmp();
  const p = path.join(dir, 'config.json');
  saveConfig(p, { colour: 'ice', mode: 'chaos', chaosPalette: 'fire', invert: true });
  const before = read(p);
  updateConfig(p, { mode: 'contrast' });
  const expect = JSON.stringify({ colour: 'ice', mode: 'contrast', chaosPalette: 'fire', invert: true }, null, 2) + '\n';
  assert.equal(read(p), expect);
  assert.notEqual(before, expect);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config extras: the write is atomic (no temp file left, still one config.json)', () => {
  const dir = tmp();
  const p = path.join(dir, 'drift', 'config.json');
  updateConfig(p, { lastCartridge: 'delza' });
  assert.deepEqual(fs.readdirSync(path.dirname(p)), ['config.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});
