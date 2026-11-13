// DRIFT-8 C1: the colour mode reaches the scenes. A scene that draws differently on 256 colours (the Rosette's contour) reads it from
// params.cmode ('truecolor' or '256', the names src/color.js detectColorMode returns), which the cell composer sets on every draw.
// Where the composer is built (the Classic app, the cartridge runtime) the mode is the app's own; the flash tests get a composer and
// the matching reducer from one helper (flashRig in helpers-flash-controls.js) so they cannot be mismatched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCellComposer, renderScene } from '../src/cells.js';
import { createApp } from '../src/app.js';
import { PLAYLISTS } from '../src/scenes/index.js';
import { createCartridgeRuntime } from '../src/shell/runtime.js';
import { newFrame } from '../src/shell/ui.js';
import { driftmanSkin } from '../src/shell/driftman.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { composerFor, reducerFor, flashRig } from './helpers-flash-controls.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';
import { DT } from './helpers-shell.js';

// a full-colour cells scene that records the cmode of every draw
function recorder(id = 'rec') {
  const seen = [];
  const s = (t, w, h, params) => {
    seen.push(params.cmode);
    for (let i = 0; i < w * h; i++) { params.glyphs[i] = 32; params.colours[i] = 255; params.fg[i] = 0x202020; params.bg[i] = 0x202020; }
  };
  s.id = id; s.kind = 'cells'; s.rgb = true; s.seen = seen;
  return s;
}

test('T1.3 composer: params.cmode is "truecolor" by default and "256" when the composer is built for 256 colours; the composer says which', () => {
  const a = recorder(), b = recorder('rec2');
  const def = createCellComposer({ scenes: [a], cols: 20, rows: 6, seed: 1 });
  def.frame({ a: 0, b: 0, p: 0 }, 0);
  assert.deepEqual(a.seen, ['truecolor']);
  assert.equal(def.cmode, 'truecolor');
  const c256 = createCellComposer({ scenes: [b], cols: 20, rows: 6, seed: 1, cmode: '256' });
  c256.frame({ a: 0, b: 0, p: 0 }, 0);
  assert.deepEqual(b.seen, ['256']);
  assert.equal(c256.cmode, '256');
  const t = createCellComposer({ scenes: [recorder('x')], cols: 20, rows: 6, seed: 1, cmode: 'truecolor' });
  assert.equal(t.cmode, 'truecolor');
});

test('T1.3 composer: both scenes of a dissolve see the mode, and a resize keeps it', () => {
  const a = recorder('a'), b = recorder('b');
  const cc = createCellComposer({ scenes: [a, b], cols: 20, rows: 6, seed: 1, cmode: '256' });
  cc.frame({ a: 0, b: 1, p: 0.5 }, 1);
  assert.deepEqual(a.seen, ['256']); assert.deepEqual(b.seen, ['256']);
  cc.resize(30, 8);
  cc.frame({ a: 0, b: 1, p: 0.5 }, 2);
  assert.deepEqual(a.seen, ['256', '256']); assert.deepEqual(b.seen, ['256', '256']);
});

test('T1.3 renderScene: truecolor by default, the mode when given', () => {
  const a = recorder();
  renderScene(a, 1, 20, 6, 1);
  renderScene(a, 1, 20, 6, 1, null, null, null, null, '256');
  assert.deepEqual(a.seen, ['truecolor', '256']);
});

test('T1.3 Classic app: the app\'s colour mode (colorMode, else detected from the environment) is the composer\'s', () => {
  for (const [extra, env, want] of [[{ colorMode: '256' }, { COLORTERM: 'truecolor' }, '256'], [{ colorMode: 'truecolor' }, {}, 'truecolor'], [{}, {}, '256'], [{}, { COLORTERM: 'truecolor' }, 'truecolor']]) {
    const rec = recorder('r');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-cm-'));
    const app = createApp({
      stdin: fakeStdin(), stdout: fakeStdout({ columns: 40, rows: 12 }), stderr: fakeStderr(), proc: fakeProc(), env, configPath: path.join(dir, 'c', 'config.json'),
      dirs: [], autoLoop: false, seed: 1, sceneSeconds: 1000, fadeSeconds: 4, startMode: 'experimental', playlists: { ...PLAYLISTS, experimental: [rec] }, ...extra,
    });
    app.start();
    app.tick(DT);
    app.quit(0);
    fs.rmSync(dir, { recursive: true, force: true });
    assert.ok(rec.seen.length > 0, 'the scene was drawn');
    assert.ok(rec.seen.every((m) => m === want), `${JSON.stringify(extra)} ${JSON.stringify(env)}: ${rec.seen} want ${want}`);
  }
});

test('T1.3 cartridge runtime: opts.cmode is the cell composer\'s mode', () => {
  for (const cmode of ['truecolor', '256']) {
    const rec = recorder('r1');
    const progs = [{ id: 'a', title: 'A', transition: 'dissolve', scenes: ['r1'], sceneSeconds: 20 }];
    const cart = { id: 'fx', manifest: { programs: progs, start: 'a', scenes: [] } };
    const scenes = [{ id: 'r1', kind: 'cells', family: 'cells', scene: rec }];
    const skin = { ...driftmanSkin, frame: { ...driftmanSkin.frame, show: 'never' } };
    const rt = createCartridgeRuntime(cart, scenes, makeSkinPalette(skin, cmode, 'fx'), { cols: 40, rows: 12, seed: 1, skin, cmode, SPEEDS: [1], DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 });
    rt.frame(newFrame(40, 12));
    assert.ok(rec.seen.length > 0 && rec.seen.every((m) => m === cmode), `${cmode}: ${rec.seen}`);
  }
});

test('T1.3 helper: flashRig builds the composer and the reducer from one mode; reducerFor refuses a composer of the other mode', () => {
  const r256 = flashRig([recorder()], 20, 6, { mode: '256' });
  assert.equal(r256.cc.cmode, '256'); assert.equal(typeof r256.reduce, 'function');
  const rtc = flashRig([recorder()], 20, 6, { mode: 'truecolor' });
  assert.equal(rtc.cc.cmode, 'truecolor'); assert.equal(rtc.reduce, null);
  assert.equal(flashRig([recorder()], 20, 6).mode, 'truecolor', 'truecolor is the default');
  // the rig really draws in its mode
  const s = recorder('s');
  flashRig([s], 20, 6, { mode: '256' }).cc.frame({ a: 0, b: 0, p: 0 }, 0);
  assert.deepEqual(s.seen, ['256']);
  // the refusal, both ways round
  const tcComposer = composerFor([recorder()], 20, 6, { mode: 'truecolor' });
  const c256Composer = composerFor([recorder()], 20, 6, { mode: '256' });
  assert.throws(() => reducerFor(tcComposer, '256', 20, 6), /256 test was handed a truecolor composer/);
  assert.throws(() => reducerFor(c256Composer, 'truecolor', 20, 6), /truecolor test was handed a 256 composer/);
  assert.equal(typeof reducerFor(c256Composer, '256', 20, 6), 'function');
  assert.throws(() => composerFor([recorder()], 20, 6, { mode: '16' }), /unknown colour mode/);
});
