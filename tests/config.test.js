import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, saveConfig, defaultConfigPath, DEFAULT_CONFIG } from '../src/config.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-cfg-')); }

test('F1 round-trip save/load', () => {
  const dir = tmp();
  const p = path.join(dir, 'drift', 'config.json');
  assert.equal(saveConfig(p, { colour: 'violet' }), true);
  assert.deepEqual(loadConfig(p), { ...DEFAULT_CONFIG, colour: 'violet' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('F2 corrupt JSON gives defaults and does not throw', () => {
  const dir = tmp();
  const p = path.join(dir, 'config.json');
  for (const bad of ['{not json', '', '[1,2]', 'null', '"str"', '{"colour": 5}']) {
    fs.writeFileSync(p, bad);
    assert.deepEqual(loadConfig(p), DEFAULT_CONFIG, JSON.stringify(bad));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('F3 missing file and missing directory give defaults; save creates the directory', () => {
  const dir = tmp();
  assert.deepEqual(loadConfig(path.join(dir, 'nope.json')), DEFAULT_CONFIG);
  assert.deepEqual(loadConfig(path.join(dir, 'no', 'such', 'dir', 'c.json')), DEFAULT_CONFIG);
  const p = path.join(dir, 'a', 'b', 'config.json');
  assert.equal(saveConfig(p, { colour: 'ice' }), true);
  assert.ok(fs.existsSync(p));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('F4 unknown or invalid colour name falls back to the default (and a valid one is kept)', () => {
  const dir = tmp();
  const p = path.join(dir, 'config.json');
  fs.writeFileSync(p, JSON.stringify({ colour: 'chartreuse' }));
  assert.equal(loadConfig(p).colour, DEFAULT_CONFIG.colour);
  fs.writeFileSync(p, JSON.stringify({ colour: 'green', extra: 1 }));
  assert.deepEqual(loadConfig(p), { ...DEFAULT_CONFIG, colour: 'green' });
  assert.equal(DEFAULT_CONFIG.colour, 'claude');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('F5 only writes inside the injected path (directory listing before/after)', () => {
  const root = tmp();
  const sibling = path.join(root, 'other.txt');
  fs.writeFileSync(sibling, 'keep');
  const before = fs.readdirSync(root).sort();
  const p = path.join(root, 'drift', 'config.json');
  saveConfig(p, { colour: 'amber' });
  const after = fs.readdirSync(root).sort();
  assert.deepEqual(after, [...before, 'drift'].sort());
  assert.deepEqual(fs.readdirSync(path.join(root, 'drift')), ['config.json']);
  assert.equal(fs.readFileSync(sibling, 'utf8'), 'keep');
  fs.rmSync(root, { recursive: true, force: true });
});

test('F6 write failure (target dir is a file; path is a directory) does not throw', () => {
  const root = tmp();
  const blocker = path.join(root, 'blocker');
  fs.writeFileSync(blocker, 'i am a file');
  assert.equal(saveConfig(path.join(blocker, 'config.json'), { colour: 'ice' }), false);
  const dirAsFile = path.join(root, 'cfgdir');
  fs.mkdirSync(dirAsFile);
  assert.equal(saveConfig(dirAsFile, { colour: 'ice' }), false);
  assert.deepEqual(loadConfig(dirAsFile), DEFAULT_CONFIG);
  fs.rmSync(root, { recursive: true, force: true });
});

test('default path is %APPDATA%\\drift\\config.json when APPDATA is set', () => {
  const p = defaultConfigPath({ APPDATA: 'C:\\Users\\x\\AppData\\Roaming' });
  assert.equal(path.normalize(p), path.normalize('C:\\Users\\x\\AppData\\Roaming\\drift\\config.json'));
  assert.ok(defaultConfigPath({}).endsWith('config.json'));
  assert.ok(defaultConfigPath({ DRIFT_CONFIG: 'X:\\y\\z.json' }) === 'X:\\y\\z.json');
});

// ---- DRIFT-2: mode, chaosPalette, invert

test('config: the default is calm / neon / not inverted, in the documented shape', () => {
  assert.deepEqual({ ...DEFAULT_CONFIG }, { colour: 'claude', mode: 'calm', chaosPalette: 'neon', invert: false });
});

test('config: a v1 file ({colour} only) loads as calm', () => {
  const dir = tmp();
  const p = path.join(dir, 'config.json');
  fs.writeFileSync(p, JSON.stringify({ colour: 'violet' }));
  assert.deepEqual(loadConfig(p), { colour: 'violet', mode: 'calm', chaosPalette: 'neon', invert: false });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config: each bad field falls back on its own, leaving the good ones alone', () => {
  const dir = tmp();
  const p = path.join(dir, 'config.json');
  const good = { colour: 'ice', mode: 'chaos', chaosPalette: 'fire', invert: true };
  const cases = [
    ['colour', 'chartreuse', 'claude'], ['colour', 5, 'claude'], ['colour', null, 'claude'],
    ['mode', 'disco', 'calm'], ['mode', 3, 'calm'], ['mode', null, 'calm'],
    ['chaosPalette', 'rainbow', 'neon'], ['chaosPalette', 7, 'neon'],
    ['invert', 'yes', false], ['invert', 1, false], ['invert', null, false],
  ];
  for (const [field, bad, fallback] of cases) {
    fs.writeFileSync(p, JSON.stringify({ ...good, [field]: bad }));
    const got = loadConfig(p);
    assert.equal(got[field], fallback, `${field}=${JSON.stringify(bad)}`);
    for (const k of Object.keys(good)) if (k !== field) assert.equal(got[k], good[k], `${k} kept when ${field} is bad`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config: all four modes and all chaos palettes round-trip; saveConfig writes the full validated object', () => {
  const dir = tmp();
  const p = path.join(dir, 'drift', 'config.json');
  for (const mode of ['calm', 'chaos', 'contrast', 'experimental']) {
    assert.equal(saveConfig(p, { colour: 'green', mode, chaosPalette: 'ocean', invert: true }), true);
    assert.deepEqual(loadConfig(p), { colour: 'green', mode, chaosPalette: 'ocean', invert: true });
  }
  saveConfig(p, { colour: 'amber', mode: 'nonsense', extra: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), { colour: 'amber', mode: 'calm', chaosPalette: 'neon', invert: false });
  fs.rmSync(dir, { recursive: true, force: true });
});
