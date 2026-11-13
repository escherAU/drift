// Harness for the console (library / cartridge) tests, DRIFT-4. A real createApp on fake streams with
// the loop switched off: the test is the clock (app.tick(dt)), so nothing here waits for real time except
// the cartridge scene import() promises, which settle() waits for.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadScenes as realLoadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';
import { tmpRoot, writeCart, makeFixtureCartridge, lockedManifest, LABEL } from './helpers-cartridge.js';
import { frameLines } from './helpers-help.js';

export const FPS = 18;
export const DT = 1 / FPS;

// A cartridge root: classic (copied from the install), fixture (every scene kind), locker (locked),
// seasonal (the fixture's scenes plus skin seasons) and broken (bad manifest). Sorted by the loader:
// classic, broken is skipped, fixture, locker, seasonal.
export function makeRoot() {
  const root = tmpRoot('drift-shell-root-');
  fs.cpSync(path.join(INSTALL_DIR, 'classic'), path.join(root, 'classic'), { recursive: true });
  makeFixtureCartridge(root, 'fixture');
  writeCart(root, 'locker', { 'manifest.json': lockedManifest('locker'), 'label.txt': LABEL });
  writeCart(root, 'broken', { 'manifest.json': '{ not json', 'label.txt': LABEL });
  return root;
}

// A second fixture with skin seasons (the same scenes, a different id).
export function addSeasonal(root) {
  const dir = makeFixtureCartridge(root, 'seasonal');
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  m.id = 'seasonal'; m.title = 'Seasonal';
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  const skin = JSON.parse(fs.readFileSync(path.join(dir, 'skin.json'), 'utf8'));
  skin.seasons = [{ name: 'Autumn', hue: '#B06F7F' }, { name: 'Winter', hue: '#7FA0D0' }];
  fs.writeFileSync(path.join(dir, 'skin.json'), JSON.stringify(skin, null, 2));
  return dir;
}

// A cartridge whose cells scene throws once the clock passes 1.5 s (the load smoke renders t = 0 and 1).
export function addBoom(root) {
  const scene = [
    'function boom(t, w, h, params) {',
    '  if (t > 1.5) throw new Error("boom at " + t);',
    '  params.glyphs.fill(46);',
    '  params.colours.fill(8);',
    '}',
    "boom.id = 'boom';",
    "boom.kind = 'cells';",
    'export default boom;',
    '',
  ].join('\n');
  return writeCart(root, 'boom', {
    'manifest.json': {
      format: 1, id: 'boom', title: 'Boom', version: '1.0.0', author: 'Test', blurb: 'Throws after a moment.', runtime: 'cartridge',
      scenes: [{ id: 'boom', kind: 'cells' }],
      programs: [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: ['boom'], sceneSeconds: 30 }],
      start: 'main',
    },
    'label.txt': LABEL,
    'scenes/boom.js': scene,
  });
}

export function mkShell(extra = {}) {
  const { cols = 80, rows = 24, config, root: rootIn, startScreen, dirs: dirsIn, ...rest } = extra;
  const stdin = fakeStdin(), stdout = extra.stdout || fakeStdout({ columns: cols, rows });
  const stderr = extra.stderr || fakeStderr(), proc = fakeProc();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-shell-'));
  const configPath = extra.configPath || path.join(dir, 'drift', 'config.json');
  if (config) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config));
  }
  const root = rootIn || makeRoot();
  const dirs = dirsIn || [{ dir: root, trusted: true }];
  const gate = { hold: false, release: null, fail: null, calls: 0 };
  const loadScenes = (cart) => {
    gate.calls++;
    const p = realLoadScenes(cart);
    if (!gate.hold) return p;
    return new Promise((res, rej) => {
      gate.release = () => p.then(res, rej);
      gate.fail = (e) => rej(e);
    });
  };
  const app = createApp({
    stdin, stdout, stderr, proc, env: { COLORTERM: 'truecolor' }, configPath, dirs, loadScenes, startScreen,
    autoLoop: false, seed: 1, sceneSeconds: 1000, fadeSeconds: 4, ...rest,
  });
  const c = { app, stdin, stdout, stderr, proc, dir, configPath, root, gate };
  c.key = (k) => stdin.emit('data', k);
  c.cfg = () => JSON.parse(fs.readFileSync(configPath, 'utf8'));
  c.has = () => fs.existsSync(configPath);
  c.sh = () => app.getState().shell;
  c.tick = (seconds, step = DT) => { if (seconds <= 0) { app.tick(0); return; } for (let t = 0; t < seconds - 1e-9; t += step) app.tick(Math.min(step, seconds - t)); };
  // let pending import() promises settle (real macrotasks), a bounded wait
  c.settle = async (ms = 40) => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, ms)); };
  c.text = () => frameLines(app.screenshot()).join('\n');
  c.writes = () => stdout.writes.length;
  // move the cursor until it is on the cartridge id (at most one lap)
  c.goto = (id) => { for (let i = 0; i < 12 && c.sh().cartridge !== id; i++) { c.key('\x1b[C'); c.tick(0.4); } return c.sh().cartridge === id; };
  c.done = () => { app.quit(0); fs.rmSync(dir, { recursive: true, force: true }); };
  return c;
}

// library -> Enter on the cartridge -> through insert and boot until running (menu open)
export async function runCartridge(c, id) {
  c.goto(id);
  c.key('\r');
  c.tick(1.6);
  await c.settle();
  c.tick(5);
  await c.settle();
  c.tick(1);
  return c.sh();
}
