// DRIFT-7 C3b: app.js hands fg/bg (and the colour mode) to the renderer on both paths (Classic and the console), copies them
// in screenshot(), skips a backpressured frame BEFORE rendering, and survives the renderer being invalidated mid-stream.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createRenderer } from '../src/renderer.js';
import { PLAYLISTS } from '../src/scenes/index.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';
import { mkShell as mkConsole, makeRoot, DT } from './helpers-shell.js';
import { writeCart, LABEL } from './helpers-cartridge.js';
import { RGB_CELL, makeGlow, makePlain, sceneFrame, makeScreen } from './helpers-fullcolour.js';

const W = 80, H = 24;

// a renderer that is the real one, with every call recorded
function spyRenderer() {
  const real = createRenderer();
  const spy = { calls: [], outs: [], invalidations: 0, order: [] };
  spy.render = (a) => { spy.calls.push(a); spy.order.push('render'); const o = real.render(a); spy.outs.push(o); return o; };
  spy.invalidate = () => { spy.invalidations++; spy.order.push('invalidate'); real.invalidate(); };
  return spy;
}

// Classic path: an app whose experimental playlist holds the fixture scenes (the Classic app builds frames with the cell composer)
function mkClassic(scenes, extra = {}) {
  const stdin = fakeStdin(), stdout = fakeStdout({ columns: W, rows: H });
  const renderer = spyRenderer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-fc-'));
  const app = createApp({
    stdin, stdout, stderr: fakeStderr(), proc: fakeProc(), env: { COLORTERM: 'truecolor' }, configPath: path.join(dir, 'c', 'config.json'),
    dirs: [], autoLoop: false, seed: 1, sceneSeconds: 1000, fadeSeconds: 4, startMode: 'experimental', renderer,
    playlists: { ...PLAYLISTS, experimental: scenes }, ...extra,
  });
  app.start();
  return { app, stdout, renderer, done: () => { app.quit(0); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('FA1 Classic path: a frame with a full-colour cell reaches render() with fg, bg and the colour mode; truecolor and 256 both (and the frame copies are the composer\'s)', () => {
  for (const mode of ['truecolor', '256']) {
    const c = mkClassic([makeGlow(), makePlain()], { colorMode: mode });
    c.app.tick(DT);
    const a = c.renderer.calls[c.renderer.calls.length - 1];
    assert.ok(a.fg instanceof Uint32Array && a.bg instanceof Uint32Array, mode);
    assert.equal(a.mode, mode);
    const ref = sceneFrame(makeGlow(), W, H);
    for (let i = 0; i < W * H; i++) {
      if (a.shades[i] !== RGB_CELL) continue;
      assert.equal(a.fg[i], ref.fg[i]); assert.equal(a.bg[i], ref.bg[i]);
    }
    assert.ok(a.shades.indexOf(RGB_CELL) !== -1);
    c.done();
  }
});

test('FA2 Classic path: a palette-only frame reaches render() with exactly today\'s keys (no fg, bg or mode)', () => {
  const c = mkClassic([makePlain(), makeGlow()]);
  c.app.tick(DT);
  const a = c.renderer.calls[0];
  assert.deepEqual(Object.keys(a).sort(), ['cols', 'glyphs', 'palette', 'rows', 'shades']);
  c.done();
});

test('FA3 screenshot() copies fg/bg (and mode) when the last frame had them; not otherwise; and they are copies', () => {
  const c = mkClassic([makeGlow(), makePlain()]);
  c.app.tick(DT);
  const a = c.renderer.calls[0], s = c.app.screenshot();
  assert.ok(s.fg instanceof Uint32Array && s.bg instanceof Uint32Array);
  assert.notEqual(s.fg, a.fg); assert.notEqual(s.bg, a.bg);
  assert.deepEqual(s.fg, a.fg); assert.deepEqual(s.bg, a.bg);
  assert.equal(s.mode, a.mode);
  assert.notEqual(s.glyphs, a.glyphs);
  c.done();
  const p = mkClassic([makePlain(), makeGlow()]);
  p.app.tick(DT);
  const ps = p.app.screenshot();
  assert.equal('fg' in ps, false);
  assert.equal('bg' in ps, false);
  assert.deepEqual(Object.keys(ps).sort(), ['cols', 'glyphs', 'palette', 'rows', 'shades']);
  p.done();
});

// ---- the console path, through a real full-colour cartridge folder (format 2, rgb scene, skin with a background)

// time-dependent so every second frame differs; self-contained so it needs no imports
const GLOW_SRC = [
  'function glow(t, w, h, params) {',
  '  const n = w * h, k = Math.floor(t * 4) & 7;',
  '  for (let i = 0; i < n; i++) {',
  '    params.glyphs[i] = 88;',
  '    if (i % 7 === 3) { params.colours[i] = 9; continue; }',
  '    params.fg[i] = (((i * 37 + k * 24) & 0xfc) << 16) | (((i * 91 + 40) & 0xfc) << 8) | 0x40;',
  '    params.bg[i] = (((i * 13) & 0x3c) << 16) | 0x101010;',
  '  }',
  '}',
  "glow.id = 'glow';",
  "glow.kind = 'cells';",
  'glow.rgb = true;',
  'export default glow;',
  '',
].join('\n');

function addGlowCart(root, id = 'glowfx') {
  return writeCart(root, id, {
    'manifest.json': {
      format: 2, id, title: 'Glow', version: '1.0.0', author: 'Test', blurb: 'One full-colour scene.', runtime: 'cartridge', labelHue: '#7FB069',
      scenes: [{ id: 'glow', kind: 'cells', rgb: true }],
      programs: [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: ['glow'], sceneSeconds: 30 }],
      start: 'main',
    },
    'label.txt': LABEL,
    'skin.json': { palette: { hue: '#7FB069', colours: ['#FF6B6B', '#4ECDC4'], bg: '#0B140C' } },
    'scenes/glow.js': GLOW_SRC,
  });
}

async function runGlow(extra = {}) {
  const root = makeRoot();
  addGlowCart(root);
  const renderer = spyRenderer();
  const c = mkConsole({ root, renderer, startScreen: { screen: 'library' }, ...extra });
  c.app.start();
  const screen = makeScreen(80, 24);
  const origWrite = c.stdout.write;
  c.stdout.write = (s, cb) => { screen.write(s); return origWrite(s, cb); };
  c.tick(0.5);
  assert.ok(c.goto('glowfx'), 'cursor reaches the glow cartridge');
  c.key('\r');
  c.tick(1.6);
  await c.settle();
  c.tick(5);
  await c.settle();
  c.tick(1);
  assert.equal(c.sh().screen, 'running');
  return { c, renderer, screen };
}

test('FA4 console path: a running full-colour cartridge reaches render() with fg/bg/mode; the screen the bytes build equals the frame (fresh start)', async () => {
  const { c, renderer, screen } = await runGlow();
  const withFg = renderer.calls.filter((a) => a.fg);
  assert.ok(withFg.length > 5, `rgb frames rendered (${withFg.length})`);
  for (const a of withFg) { assert.ok(a.bg instanceof Uint32Array); assert.equal(a.mode, 'truecolor'); }
  // the frames before the cartridge draws are palette-only: no fg key at all
  const before = renderer.calls[0];
  assert.equal('fg' in before, false);
  // the bytes, replayed on a mini terminal, show the last frame's full-colour cells exactly (low 2 bits dropped)
  const last = renderer.calls[renderer.calls.length - 1];
  assert.ok(last.fg, 'the last frame is a full-colour frame');
  let checked = 0;
  for (let i = 0; i < last.shades.length - 1; i++) {
    if (last.shades[i] !== RGB_CELL) continue;
    checked++;
    assert.equal(screen.ch[i], last.glyphs[i], `glyph ${i}`);
    assert.equal(screen.fg[i], (last.fg[i] & 0xfcfcfc) >>> 0, `fg ${i}`);
    assert.equal(screen.bg[i], (last.bg[i] & 0xfcfcfc) >>> 0, `bg ${i}`);
  }
  assert.ok(checked > 1000, `checked ${checked} cells`);
  const shot = c.app.screenshot();
  assert.deepEqual(shot.fg, last.fg);
  c.done();
});

test('FA5 invalidate with rgb frames: the app invalidates on the move into the cartridge, and on a resize in the middle of rgb frames the next rgb frame is a full repaint that lands right', async () => {
  const { c, renderer, screen } = await runGlow();
  const first = renderer.calls.findIndex((a) => a.fg);
  assert.ok(first > 0);
  assert.ok(renderer.order.slice(0, renderer.order.indexOf('render', first)).includes('invalidate'), 'the library -> cartridge background change invalidated before the first rgb frame');
  // a window resize while the cartridge runs: the app invalidates the renderer and draws at once
  const inv0 = renderer.invalidations, n0 = renderer.calls.length;
  c.stdout.columns = 60; c.stdout.rows = 20;
  c.stdout.emit('resize');
  assert.equal(renderer.invalidations, inv0 + 1);
  assert.ok(renderer.calls.length > n0, 'the resize drew a frame');
  const after = renderer.calls[n0];
  assert.ok(after.fg, 'that frame is a full-colour frame');
  assert.equal(after.cols, 60);
  assert.ok(renderer.outs[n0].includes('\x1b[2J'), 'a full repaint after the invalidate');
  c.tick(DT); c.tick(DT);
  const screen2 = screen; // the mini terminal was sized 80x24; the new frames address a 60x20 grid inside it
  const last = renderer.calls[renderer.calls.length - 1];
  let bad = 0, checked = 0;
  for (let y = 0; y < last.rows; y++) for (let x = 0; x < last.cols; x++) {
    const i = y * last.cols + x;
    if (i === last.shades.length - 1 || last.shades[i] !== RGB_CELL) continue;
    checked++;
    const j = y * 80 + x;
    if (screen2.fg[j] !== (last.fg[i] & 0xfcfcfc) >>> 0 || screen2.bg[j] !== (last.bg[i] & 0xfcfcfc) >>> 0) bad++;
  }
  assert.ok(checked > 500, 'checked ' + checked);
  assert.equal(bad, 0);
  c.done();
});

test('FA6 backpressure: a frame skipped while the stream needs drain never reaches render(), and the screen is right after it clears', async () => {
  const { c, renderer, screen } = await runGlow();
  const n0 = renderer.calls.length;
  c.stdout.writableNeedDrain = true;
  c.tick(2); // the scene changes every 0.25 s; nothing may be rendered
  assert.equal(renderer.calls.length, n0, 'no render() call while draining');
  c.stdout.writableNeedDrain = false;
  c.tick(DT);
  c.tick(DT);
  assert.ok(renderer.calls.length > n0);
  const last = renderer.calls[renderer.calls.length - 1];
  let bad = 0, checked = 0;
  for (let i = 0; i < last.shades.length - 1; i++) {
    if (last.shades[i] !== RGB_CELL) continue;
    checked++;
    if (screen.fg[i] !== (last.fg[i] & 0xfcfcfc) >>> 0 || screen.bg[i] !== (last.bg[i] & 0xfcfcfc) >>> 0 || screen.ch[i] !== last.glyphs[i]) bad++;
  }
  assert.ok(checked > 1000);
  assert.equal(bad, 0, `${bad} of ${checked} cells wrong on the screen after the skipped frames`);
  c.done();
});

test('FA7 a seasons change (new palette hue) with an invalidate between two rgb frames keeps the screen right', async () => {
  const root = makeRoot();
  const dir = addGlowCart(root, 'glowfx');
  const skin = JSON.parse(fs.readFileSync(path.join(dir, 'skin.json'), 'utf8'));
  skin.seasons = [{ name: 'Autumn', hue: '#B06F7F' }];
  fs.writeFileSync(path.join(dir, 'skin.json'), JSON.stringify(skin));
  const renderer = spyRenderer();
  const c = mkConsole({ root, renderer, startScreen: { screen: 'library' } });
  c.app.start();
  const screen = makeScreen(80, 24);
  const origWrite = c.stdout.write;
  c.stdout.write = (s, cb) => { screen.write(s); return origWrite(s, cb); };
  c.tick(0.5);
  assert.ok(c.goto('glowfx'));
  c.key('\r'); c.tick(1.6); await c.settle(); c.tick(5); await c.settle(); c.tick(1);
  assert.equal(c.sh().screen, 'running');
  const inv0 = renderer.invalidations;
  c.key('c'); // seasons: palette key changes
  c.tick(1);
  renderer.invalidate(); // what the app does on a background change, here between two rgb frames
  c.tick(DT); c.tick(DT);
  assert.ok(renderer.invalidations > inv0);
  const last = renderer.calls[renderer.calls.length - 1];
  assert.ok(last.fg);
  let bad = 0;
  for (let i = 0; i < last.shades.length - 1; i++) {
    if (last.shades[i] === RGB_CELL && (screen.fg[i] !== (last.fg[i] & 0xfcfcfc) >>> 0 || screen.bg[i] !== (last.bg[i] & 0xfcfcfc) >>> 0)) bad++;
  }
  assert.equal(bad, 0);
  c.done();
});
