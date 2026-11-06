// DRIFT-2: modes, keys, help overlay, config persistence and the flip guard, at app level.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, parseOptions, SPEEDS } from '../src/app.js';
import { SYNC_BEGIN } from '../src/renderer.js';
import { LEAVE } from '../src/term.js';
import { PLAYLISTS, SCENES } from '../src/scenes/index.js';
import glyphrain from '../src/scenes/glyphrain.js';
import life from '../src/scenes/life.js';
import bounce from '../src/scenes/bounce.js';
import { KEYMAP, KEY_TO_ENTRY, rowFor, cliKeysText } from '../src/keymap.js';
import { makeTwoTone } from '../src/color.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';
import { frameLines } from './helpers-help.js';

const clone = (s, id) => Object.assign((...a) => s(...a), { id, kind: s.kind });
const twoEach = {
  calm: SCENES,
  chaos: [glyphrain, clone(glyphrain, 'glyphrain-b')],
  contrast: [life, { ...life, id: 'life-b' }],
  experimental: [bounce, { ...bounce, id: 'bounce-b' }],
};
const LIGHT = makeTwoTone(true, 'truecolor');
const DARK = makeTwoTone(false, 'truecolor');

function mk(extra = {}) {
  const stdin = fakeStdin(), stdout = fakeStdout({ columns: extra.cols || 80, rows: extra.rows || 24 });
  const stderr = fakeStderr(), proc = fakeProc();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-modes-'));
  const configPath = extra.configPath || path.join(dir, 'drift', 'config.json');
  if (extra.config) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(extra.config));
  }
  const { config, cols, rows, ...rest } = extra;
  const app = createApp({
    stdin, stdout, stderr, proc, env: { COLORTERM: 'truecolor' }, configPath,
    autoLoop: false, seed: 1, sceneSeconds: 1000, fadeSeconds: 4, playlists: twoEach, ...rest,
  });
  const c = { app, stdin, stdout, stderr, proc, dir, configPath };
  c.key = (k) => stdin.emit('data', k);
  c.cfg = () => JSON.parse(fs.readFileSync(configPath, 'utf8'));
  c.done = () => { app.quit(0); fs.rmSync(dir, { recursive: true, force: true }); };
  return c;
}
const wr = (c) => c.stdout.writes.length;

// ---- modes
test('modes: m cycles calm > chaos > high contrast > experimental > calm', () => {
  const c = mk();
  c.app.start();
  assert.equal(c.app.getState().mode, 'calm');
  for (const want of ['chaos', 'contrast', 'experimental', 'calm', 'chaos']) {
    c.key('m');
    c.app.tick(1 / 18);
    assert.equal(c.app.getState().mode, want);
  }
  c.key('M');
  assert.equal(c.app.getState().mode, 'contrast');
  c.done();
});

test('modes: 1-4 jump straight to calm, chaos, high contrast, experimental', () => {
  const c = mk();
  c.app.start();
  for (const [k, want] of [['3', 'contrast'], ['2', 'chaos'], ['4', 'experimental'], ['1', 'calm'], ['4', 'experimental']]) {
    c.key(k);
    assert.equal(c.app.getState().mode, want, k);
  }
  c.done();
});

test('modes: jumping to the current mode does nothing and writes nothing (1 in calm)', () => {
  const c = mk();
  c.app.start();
  c.app.tick(0.05);
  const n = wr(c), before = JSON.stringify(c.app.getState());
  c.key('1');
  c.app.tick(0);
  assert.equal(wr(c), n);
  assert.equal(JSON.stringify(c.app.getState()), before);
  c.done();
});

test('modes: a mode switch is one full repaint (clear) in the new mode', () => {
  const c = mk();
  c.app.start();
  c.app.tick(0.05);
  c.key('2');
  const n = wr(c);
  c.app.tick(0);
  assert.equal(wr(c), n + 1);
  assert.ok(c.stdout.writes.at(-1).startsWith(SYNC_BEGIN + '\x1b[2J'));
  assert.equal(c.app.getState().sceneId, 'glyphrain');
  c.done();
});

test('modes: space moves to the next scene within the mode playlist and wraps (chaos and calm)', () => {
  const c = mk();
  c.app.start();
  c.key('2');
  assert.equal(c.app.getState().sceneIndex, 0);
  c.key(' ');
  for (let i = 0; i < 40; i++) c.app.tick(0.1); // 2 s dissolve
  assert.equal(c.app.getState().sceneIndex, 1);
  assert.equal(c.app.getState().sceneId, 'glyphrain-b');
  c.key(' ');
  for (let i = 0; i < 40; i++) c.app.tick(0.1);
  assert.equal(c.app.getState().sceneIndex, 0, 'wraps');
  c.key('1');
  c.key(' ');
  for (let i = 0; i < 200; i++) c.app.tick(0.1); // calm fade is 4 s here
  assert.equal(c.app.getState().sceneIndex, 1, 'calm still moves through its own five');
  c.done();
});

test('modes: non-calm transitions are a 2 s dissolve whatever --fade-seconds says', () => {
  const c = mk({ fadeSeconds: 15 });
  c.app.start();
  c.key('2');
  c.key(' ');
  for (let i = 0; i < 19; i++) c.app.tick(0.1);
  assert.equal(c.app.getState().fading, true);
  for (let i = 0; i < 4; i++) c.app.tick(0.1);
  assert.equal(c.app.getState().fading, false);
  assert.equal(c.app.getState().sceneIndex, 1);
  c.done();
});

test('modes: the mode persists in config and is restored on restart; saved mode wins; calm when none saved', () => {
  const c = mk();
  assert.equal(c.app.getState().mode, 'calm', 'nothing saved: calm');
  c.app.start();
  c.key('4');
  assert.equal(c.cfg().mode, 'experimental');
  c.app.quit(0);
  const again = mk({ configPath: c.configPath });
  assert.equal(again.app.getState().mode, 'experimental', 'saved mode wins at launch');
  again.app.start();
  again.app.tick(0.05);
  assert.equal(again.app.getState().sceneId, 'bounce');
  again.app.quit(0);
  // an explicit --scene starts in that scene's mode (and does not rewrite the saved mode)
  const o = parseOptions(['--scene', 'glyphrain'], {});
  assert.equal(o.startMode, 'chaos');
  assert.equal(o.startScene, 0);
  const viaOpt = mk({ configPath: c.configPath, startMode: o.startMode, startScene: o.startScene });
  assert.equal(viaOpt.app.getState().mode, 'chaos');
  assert.equal(JSON.parse(fs.readFileSync(c.configPath, 'utf8')).mode, 'experimental');
  fs.rmSync(c.dir, { recursive: true, force: true });
  fs.rmSync(viaOpt.dir, { recursive: true, force: true });
  fs.rmSync(again.dir, { recursive: true, force: true });
});

test('parseOptions: --scene NAME finds a non-calm scene and its mode; calm names and numbers still work', () => {
  assert.deepEqual(['glyphrain', 'life', 'bounce'].map((n) => parseOptions(['--scene', n], {}).startMode), ['chaos', 'contrast', 'experimental']);
  const r = parseOptions(['--scene', 'rain'], {});
  assert.equal(r.startMode, 'calm');
  assert.equal(r.startScene, 4);
  assert.equal(parseOptions(['--scene', '2'], {}).startScene, 2);
  assert.equal(parseOptions([], { DRIFT_SCENE: 'life' }).startMode, 'contrast');
  assert.equal(parseOptions([], {}).startMode, undefined);
  assert.equal(parseOptions(['--scene', 'nonsense'], {}).startMode, undefined);
});

// ---- c per mode
test('c: calm cycles the single-hue presets exactly as before', () => {
  const c = mk();
  c.app.start();
  c.app.tick(0.05);
  c.key('c');
  assert.equal(c.app.getState().colour, 'amber');
  assert.equal(c.cfg().colour, 'amber');
  assert.equal(c.cfg().mode, 'calm', 'saving the colour keeps the mode');
  c.done();
});

test('c: chaos cycles neon > candy > ocean > fire > neon, repaints, and persists', () => {
  const c = mk();
  c.app.start();
  c.key('2');
  c.app.tick(0.05);
  for (const want of ['candy', 'ocean', 'fire', 'neon']) {
    c.key('c');
    assert.equal(c.app.getState().chaosPalette, want);
    const n = wr(c);
    c.app.tick(0);
    assert.equal(wr(c), n + 1, 'a colour change repaints');
  }
  c.key('C');
  assert.equal(c.cfg().chaosPalette, 'candy');
  assert.equal(c.cfg().colour, 'claude', 'the calm colour is untouched');
  assert.equal(c.cfg().mode, 'chaos');
  c.done();
});

test('c: experimental uses the calm preset colours and c works as in calm', () => {
  const c = mk();
  c.app.start();
  c.key('4');
  c.app.tick(0.05);
  c.key('c');
  assert.equal(c.app.getState().colour, 'amber');
  assert.equal(c.cfg().mode, 'experimental');
  assert.match(c.stdout.writes.join(''), /\x1b\[38;2;\d+;\d+;\d+m/);
  c.done();
});

test('c: high contrast changes nothing AND writes nothing (and the other modes do write: both arms)', () => {
  const c = mk();
  c.app.start();
  c.key('3');
  c.app.tick(0.05);
  c.app.tick(0.05);
  const n = wr(c), st = JSON.stringify(c.app.getState()), file = fs.existsSync(c.configPath) ? fs.readFileSync(c.configPath, 'utf8') : null;
  c.key('c'); c.key('C');
  c.app.tick(0);
  assert.equal(wr(c), n, 'no write');
  assert.equal(JSON.stringify(c.app.getState()), st, 'no state change');
  assert.equal(fs.readFileSync(c.configPath, 'utf8'), file, 'config untouched');
  // other arm
  for (const k of ['1', '2', '4']) {
    c.key(k);
    c.app.tick(0.05);
    const m = wr(c);
    c.key('c');
    c.app.tick(0);
    assert.equal(wr(c), m + 1, `c in mode key ${k} repaints`);
  }
  c.done();
});

// ---- i
test('i: in high contrast it inverts and saves; in every other mode it is ignored and writes nothing', () => {
  const c = mk();
  c.app.start();
  c.key('3');
  c.app.tick(0.05);
  assert.equal(c.app.getState().invert, false);
  c.key('i');
  assert.equal(c.app.getState().invert, true);
  assert.equal(c.cfg().invert, true);
  c.key('I');
  assert.equal(c.app.getState().invert, false);
  assert.equal(c.cfg().invert, false);
  for (const k of ['1', '2', '4']) {
    c.key(k);
    c.app.tick(0.05);
    c.app.tick(0.05);
    const n = wr(c), st = JSON.stringify(c.app.getState()), file = fs.readFileSync(c.configPath, 'utf8');
    c.key('i');
    c.app.tick(0);
    assert.equal(wr(c), n, `mode ${k}: no write`);
    assert.equal(JSON.stringify(c.app.getState()), st);
    assert.equal(fs.readFileSync(c.configPath, 'utf8'), file, 'config untouched');
  }
  c.done();
});

test('i: the saved invert is applied at launch, and high contrast frames are two-tone only', () => {
  const c = mk({ config: { mode: 'contrast', invert: true } });
  c.app.start();
  c.app.tick(0.05);
  const first = c.stdout.writes.find((w) => w.startsWith(SYNC_BEGIN));
  assert.ok(first.startsWith(SYNC_BEGIN + LIGHT.base + '\x1b[2J'), JSON.stringify(first.slice(0, 60)));
  const all = c.stdout.writes.join('');
  const colours = new Set([...all.matchAll(/\x1b\[(?:38|48);2;(\d+);(\d+);(\d+)m/g)].map((m) => m.slice(1).join(',')));
  assert.deepEqual([...colours].sort(), ['0,0,0', '255,255,255'], 'strictly two-tone');
  c.done();
});

test('high contrast: entering writes the base + clear; leaving resets with ESC[0m before the clear', () => {
  const c = mk();
  c.app.start();
  c.app.tick(0.05);
  c.key('3');
  c.app.tick(0);
  assert.ok(c.stdout.writes.at(-1).startsWith(SYNC_BEGIN + DARK.base + '\x1b[2J'));
  c.key('1');
  c.app.tick(0);
  assert.ok(c.stdout.writes.at(-1).startsWith(SYNC_BEGIN + '\x1b[0m\x1b[2J'), JSON.stringify(c.stdout.writes.at(-1).slice(0, 40)));
  c.key('2');
  c.app.tick(0);
  assert.ok(!c.stdout.writes.at(-1).startsWith(SYNC_BEGIN + '\x1b[0m'), 'only sent when leaving a bg palette');
  c.done();
});

// ---- help
test('help: h opens the panel, then the animation behind it is frozen and nothing more is written', () => {
  const c = mk();
  c.app.start();
  c.app.tick(0.05);
  c.key('2');
  c.app.tick(0.05);
  const t0 = c.app.getState().t;
  c.key('h');
  assert.equal(c.app.getState().help, true);
  const n = wr(c);
  c.app.tick(0);
  assert.equal(wr(c), n + 1, 'the box is drawn once');
  for (let i = 0; i < 60; i++) c.app.tick(1 / 18);
  assert.equal(wr(c), n + 1, 'then nothing at all while it is open');
  assert.equal(c.app.getState().t, t0, 'time frozen');
  c.key('H');
  assert.equal(c.app.getState().help, false);
  c.done();
});

for (const pausedBefore of [false, true]) {
  test(`help: closing restores the prior pause state (was ${pausedBefore ? '' : 'not '}paused), with Esc or h`, () => {
    for (const closer of ['\x1b', 'h']) {
      const c = mk();
      c.app.start();
      c.app.tick(1 / 18);
      if (pausedBefore) c.key('p');
      c.app.tick(1 / 18);
      const t0 = c.app.getState().t;
      c.key('h');
      c.app.tick(0);
      for (let i = 0; i < 10; i++) c.app.tick(1 / 18);
      assert.equal(c.app.getState().t, t0, 'frozen while open');
      assert.equal(c.app.getState().paused, pausedBefore, 'p state untouched by opening');
      c.key(closer);
      assert.equal(c.app.getState().help, false);
      assert.equal(c.app.getState().paused, pausedBefore);
      c.app.tick(1 / 18);
      if (pausedBefore) assert.equal(c.app.getState().t, t0, 'still paused after closing');
      else assert.ok(Math.abs(c.app.getState().t - (t0 + 1 / 18)) < 1e-9, 'resumes with one frame of progress, no jump');
      c.done();
    }
  });
}

test('help: while open only h, Esc, q and Ctrl+C act (m 1-4 space c i p + - are all ignored)', () => {
  const c = mk();
  c.app.start();
  c.key('3');
  c.app.tick(0.05);
  c.key('h');
  c.app.tick(0);
  const n = wr(c), st = JSON.stringify(c.app.getState()), file = fs.readFileSync(c.configPath, 'utf8');
  for (const k of ['m', 'M', '1', '2', '3', '4', ' ', 'c', 'i', 'p', '+', '-', 'x']) c.key(k);
  c.app.tick(0);
  c.app.tick(1);
  assert.equal(wr(c), n);
  assert.equal(JSON.stringify(c.app.getState()), st);
  assert.equal(fs.readFileSync(c.configPath, 'utf8'), file);
  c.key('q');
  assert.equal(c.stdout.writes.at(-1), LEAVE, 'q still quits');
  assert.deepEqual(c.proc.exits, [0]);
  fs.rmSync(c.dir, { recursive: true, force: true });
  const d = mk();
  d.app.start();
  d.key('h');
  d.key('\x03');
  assert.deepEqual(d.proc.exits, [130], 'Ctrl+C still quits');
  fs.rmSync(d.dir, { recursive: true, force: true });
});

test('help: Esc does nothing when help is closed', () => {
  const c = mk();
  c.app.start();
  c.app.tick(0.05);
  const n = wr(c), st = JSON.stringify(c.app.getState());
  c.key('\x1b');
  c.app.tick(0);
  assert.equal(wr(c), n);
  assert.equal(JSON.stringify(c.app.getState()), st);
  c.done();
});

test('help: a 30x10 terminal does not crash, in every mode, and live resize while open redraws', () => {
  for (const k of ['1', '2', '3', '4']) {
    const c = mk({ cols: 30, rows: 10 });
    c.app.start();
    c.key(k);
    c.app.tick(0.05);
    assert.doesNotThrow(() => { c.key('h'); c.app.tick(0); });
    assert.deepEqual(c.proc.exits, []);
    c.stdout.columns = 12; c.stdout.rows = 4;
    assert.doesNotThrow(() => c.stdout.emit('resize'));
    c.stdout.columns = 120; c.stdout.rows = 40;
    assert.doesNotThrow(() => c.stdout.emit('resize'));
    assert.deepEqual(c.proc.exits, []);
    c.done();
  }
});

test('keymap: every action in the table has a handler and every handler is reachable from the table', () => {
  const c = mk();
  const handlers = Object.keys(c.app.actions).sort();
  const used = [...new Set(KEYMAP.map((e) => e.action))].sort();
  assert.deepEqual(handlers, used);
  for (const h of handlers) assert.equal(typeof c.app.actions[h], 'function', h);
  c.done();
});

test('keymap: the app dispatches from KEY_TO_ENTRY (every table key is live)', () => {
  assert.ok(KEY_TO_ENTRY.get('m').action === 'modeNext');
  const c = mk();
  c.app.start();
  c.key('c'); // calm colour
  assert.equal(c.app.getState().colour, 'amber');
  for (let i = 0; i < 50; i++) c.key('+');
  assert.equal(c.app.getState().speed, SPEEDS.at(-1));
  c.done();
});

// ---- the help text itself
function helpAt(mode, cols, rows) {
  const c = mk({ cols, rows });
  c.app.start();
  c.key({ calm: '1', chaos: '2', contrast: '3', experimental: '4' }[mode]);
  c.app.tick(0.05);
  c.key('h');
  c.app.tick(0);
  const shot = c.app.screenshot();
  c.done();
  return shot;
}

test('help panel at 120x40: each KEYMAP entry exactly once, centred, with the mode and scene names, in every mode', () => {
  for (const mode of ['calm', 'chaos', 'contrast', 'experimental']) {
    const f = helpAt(mode, 120, 40);
    const text = frameLines(f).join('\n');
    for (const e of KEYMAP) {
      const row = rowFor(e, mode).text;
      assert.equal(text.split(row).length - 1, 1, `${mode}: ${e.id}`);
    }
    assert.match(text, new RegExp(`mode: ${mode === 'contrast' ? 'high contrast' : mode}`));
    assert.match(text, /scene: (squiggle|glyphrain|life|bounce)/);
    // box geometry
    const lines = frameLines(f);
    const rowsWithBox = lines.map((l, y) => [y, l.indexOf('┌'), l.lastIndexOf('┐')]).filter((r) => r[1] >= 0);
    assert.equal(rowsWithBox.length, 1, 'one top-left corner');
    const [top, x0, x1] = rowsWithBox[0];
    const bottom = lines.findIndex((l) => l.includes('└'));
    assert.ok(Math.abs((x0 + x1 + 1) / 2 - 60) <= 1, `${mode}: centred horizontally (${x0}..${x1})`);
    assert.ok(Math.abs((top + bottom + 1) / 2 - 20) <= 1, `${mode}: centred vertically (${top}..${bottom})`);
    for (let y = top + 1; y < bottom; y++) {
      assert.equal(lines[y][x0], '│');
      assert.equal(lines[y][x1], '│');
    }
    for (const group of ['Modes', 'Scenes', 'Colour', 'Speed', 'Other']) assert.ok(text.includes(group), group);
  }
});

test('help panel: inactive rows are marked per mode (two-tone gets the suffix, others dim, which is a shade)', () => {
  const hc = frameLines(helpAt('contrast', 120, 40)).join('\n');
  assert.ok(/next colour \(not in this mode\)/.test(hc));
  assert.ok(!/invert black and white \(not in this mode\)/.test(hc));
  const ch = helpAt('chaos', 120, 40);
  const lines = frameLines(ch);
  const y = lines.findIndex((l) => l.includes('invert black and white'));
  const x = lines[y].indexOf('invert');
  const yc = lines.findIndex((l) => l.includes('next colour'));
  assert.ok(!lines[y].includes('not in this mode'));
  assert.notEqual(ch.shades[y * 120 + x], ch.shades[yc * 120 + lines[yc].indexOf('next')], 'inactive row has a dimmer palette entry than an active one');
});

test('--help text: the keys block is generated from KEYMAP and the README no-overlay line is gone', async () => {
  const { helpText } = await import('../src/app.js');
  const txt = helpText();
  assert.ok(txt.includes(cliKeysText()));
  for (const e of KEYMAP) assert.ok(txt.includes(e.label), e.id);
  assert.ok(txt.includes('--scene NAME'));
  assert.ok(/glyphrain/.test(txt) && /life/.test(txt) && /bounce/.test(txt), 'lists every scene');
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(!/no hint overlay/i.test(readme));
});

// ---- flip guard
const lands = (c, from) => c.stdout.writes.slice(from).filter((w) => w.includes(LIGHT.base + '\x1b[2J') || w.includes(DARK.base + '\x1b[2J')).length;

test('flip guard: a flip asked for after the 3 s window is allowed at once', () => {
  const c = mk({ config: { mode: 'contrast' } });
  c.app.start();
  c.app.tick(0.05);
  c.key('i'); // first flip: allowed (nothing before it)
  c.app.tick(0);
  assert.equal(c.app.getState().light, true);
  for (let i = 0; i < 62; i++) c.app.tick(0.05); // just over 3 s
  const n = wr(c);
  c.key('i');
  c.app.tick(0);
  assert.equal(c.app.getState().light, false, 'allowed after the window');
  assert.equal(lands(c, n), 1);
  c.done();
});

test('flip guard: a flip asked for inside the window is deferred, not dropped, and lands exactly once', () => {
  const c = mk({ config: { mode: 'contrast' } });
  c.app.start();
  c.app.tick(0.05);
  c.key('i');
  c.app.tick(0);
  assert.equal(c.app.getState().light, true);
  c.app.tick(1);
  const n = wr(c);
  c.key('i'); // 1 s after the last flip
  c.app.tick(0);
  assert.equal(c.app.getState().light, true, 'still showing the old polarity');
  assert.equal(c.app.getState().invert, false, 'but the wish is recorded and saved');
  assert.equal(c.cfg().invert, false);
  assert.equal(lands(c, n), 0);
  let landedAt = null;
  for (let i = 0; i < 80; i++) {
    c.app.tick(0.05);
    if (landedAt === null && c.app.getState().light === false) landedAt = (i + 1) * 0.05;
  }
  assert.ok(landedAt !== null, 'deferred flip landed');
  assert.ok(landedAt >= 1.9 && landedAt <= 2.1, `landed ${landedAt} s after the ask (the window ends 3 s after the first flip)`);
  assert.equal(lands(c, n), 1, 'exactly one repaint for it');
  c.done();
});

test('flip guard: a mode switch out of inverted high contrast is deferred the same way and lands once', () => {
  const c = mk({ config: { mode: 'contrast', invert: true } });
  c.app.start();
  c.app.tick(0.05); // launched inverted: counts as a flip at time 0
  const n = wr(c);
  c.key('1');
  c.app.tick(0.5);
  assert.equal(c.app.getState().mode, 'contrast', 'switch deferred');
  assert.equal(c.cfg().mode, 'calm', 'but remembered');
  for (let i = 0; i < 80; i++) c.app.tick(0.05);
  assert.equal(c.app.getState().mode, 'calm');
  assert.equal(c.stdout.writes.slice(n).filter((w) => w.startsWith(SYNC_BEGIN + '\x1b[0m\x1b[2J')).length, 1);
  c.done();
});

test('flip guard: asking twice inside the window nets out (on then off) and never flashes', () => {
  const c = mk({ config: { mode: 'contrast' } });
  c.app.start();
  c.app.tick(0.05);
  c.key('i'); c.app.tick(0);
  c.app.tick(0.5);
  const n = wr(c);
  c.key('i'); c.key('i'); // off then on again, inside the window
  for (let i = 0; i < 80; i++) c.app.tick(0.05);
  assert.equal(c.app.getState().light, true);
  assert.equal(lands(c, n), 0, 'no repaint: the wish ended where the screen already was');
  c.done();
});

test('flip guard: nothing is written while help is open, even if a flip is due; it lands after closing', () => {
  const c = mk({ config: { mode: 'contrast' } });
  c.app.start();
  c.app.tick(0.05);
  c.key('i'); c.app.tick(0);
  c.app.tick(0.5);
  c.key('i'); // deferred
  c.key('h'); c.app.tick(0);
  const n = wr(c);
  for (let i = 0; i < 100; i++) c.app.tick(0.05); // 5 s
  assert.equal(wr(c), n, 'frozen');
  c.key('h');
  c.app.tick(0);
  assert.equal(c.app.getState().light, false, 'lands once help is closed');
  c.done();
});
