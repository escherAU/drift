// DRIFT-7 C5: backpressure, both arms, on both app paths (Classic, and the console: library and a running cartridge),
// for a palette frame sequence and an rgb (full-colour) one.
//   Arm 1 (stream needs drain): no write at all, the renderer is not called, time still advances.
//   Arm 2 (drain clears): exactly one write, and its bytes are the diff from the LAST WRITTEN frame, so the skipped
//         frames must not have moved the renderer's diff state. Proved three ways: the bytes equal a standalone real
//         renderer fed [last written, current]; the mini terminal ends up showing what a fresh full render of the
//         current frame shows; and a control app that was never drained reaches the same current frame (time advanced).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createRenderer, SYNC_BEGIN, SYNC_END } from '../src/renderer.js';
import { LEAVE } from '../src/term.js';
import { PLAYLISTS } from '../src/scenes/index.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';
import { mkShell as mkConsole, makeRoot, DT } from './helpers-shell.js';
import { writeCart, LABEL } from './helpers-cartridge.js';
import { makePlain, makeScreen } from './helpers-fullcolour.js';

const W = 80, H = 24;

// ---- the frame sequence: every tick a different 1/7 of the cells updates, each cell holds its value for 7 ticks, so a
// frame differs from its predecessor in few cells but from one 7+ ticks older in all of them. Glyphs are never a space.
function body(t, w, h, params, rgb) {
  const k = Math.floor(t * 18 + 0.5), n = w * h;
  for (let i = 0; i < n; i++) {
    const j = k - ((k + i) % 7);
    let x = Math.imul(i + 1, 0x9E3779B1) ^ Math.imul(j + 7, 0x85EBCA6B);
    x ^= x >>> 15; x = Math.imul(x, 0x2C1B3C6D); x ^= x >>> 13; x >>>= 0;
    params.glyphs[i] = 65 + (x % 20);
    if (!rgb) { params.colours[i] = 1 + ((x >>> 8) % 8); continue; }
    if (i % 7 === 3) { params.colours[i] = 9; continue; }
    params.fg[i] = (x & 0xfcfcfc) >>> 0;
    params.bg[i] = ((x >>> 5) & 0x1c1c1c) >>> 0;
  }
}
function classicScene(rgb) {
  const s = (t, w, h, params) => body(t, w, h, params, rgb);
  s.id = rgb ? 'drift-rgb' : 'drift-pal'; s.kind = 'cells';
  if (rgb) s.rgb = true;
  return s;
}
function cartSource(rgb) {
  return [
    body.toString(),
    `function drifter(t, w, h, params) { body(t, w, h, params, ${rgb}); }`,
    "drifter.id = 'drifter';", "drifter.kind = 'cells';", rgb ? 'drifter.rgb = true;' : '',
    'export default drifter;', '',
  ].join('\n');
}
function addCart(root, rgb) {
  return writeCart(root, 'drifter', {
    'manifest.json': {
      format: 2, id: 'drifter', title: 'Drifter', version: '1.0.0', author: 'Test', blurb: 'Changes a few cells per frame.', runtime: 'cartridge', labelHue: '#7FB069',
      scenes: [{ id: 'drifter', kind: 'cells', ...(rgb ? { rgb: true } : {}) }],
      programs: [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: ['drifter'], sceneSeconds: 300 }],
      start: 'main',
    },
    'label.txt': LABEL,
    'skin.json': { palette: { hue: '#7FB069', colours: ['#FF6B6B', '#4ECDC4'], bg: '#0B140C' } },
    'scenes/drifter.js': cartSource(rgb),
  });
}

// ---- a renderer that is the real one, recording a COPY of every frame it is handed (the app reuses its buffers)
function snap(a) {
  const o = { cols: a.cols, rows: a.rows, palette: a.palette };
  if (a.mode) o.mode = a.mode;
  for (const k of ['glyphs', 'shades', 'fg', 'bg']) if (a[k]) o[k] = a[k].slice();
  return o;
}
function recorder() {
  const real = createRenderer();
  const r = { calls: [], outs: [], log: [], invalidations: 0 };
  r.render = (a) => { const out = real.render(a); r.calls.push(snap(a)); r.outs.push(out); r.log.push(r.calls.length - 1); return out; };
  r.invalidate = () => { r.invalidations++; r.log.push('invalidate'); real.invalidate(); };
  return r;
}

// ---- the two app paths, as one small driver: { app, stdout, stdin, proc, rec, screen, step(), key(k), done() }
function wrapScreen(stdout) {
  const screen = makeScreen(W, H);
  const orig = stdout.write;
  stdout.write = (s, cb) => { screen.write(s); return orig(s, cb); };
  return screen;
}

function mkClassic(rgb, { bare = false } = {}) {
  const stdin = fakeStdin(), stdout = fakeStdout({ columns: W, rows: H }), proc = fakeProc();
  const rec = bare ? null : recorder();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-bp-'));
  const app = createApp({
    stdin, stdout, stderr: fakeStderr(), proc, env: { COLORTERM: 'truecolor' }, configPath: path.join(dir, 'c', 'config.json'),
    dirs: [], autoLoop: false, seed: 1, sceneSeconds: 1000, fadeSeconds: 4, startMode: 'experimental',
    playlists: { ...PLAYLISTS, experimental: [classicScene(rgb), makePlain()] }, ...(rec ? { renderer: rec } : {}),
  });
  app.start();
  const screen = wrapScreen(stdout);
  const d = {
    app, stdout, stdin, proc, rec, screen, kind: 'classic',
    step: () => app.tick(DT), key: (k) => stdin.emit('data', k),
    done: () => { app.quit(0); fs.rmSync(dir, { recursive: true, force: true }); },
  };
  for (let i = 0; i < 4; i++) d.step();
  return d;
}

async function mkRunning(rgb, { bare = false } = {}) {
  const root = makeRoot();
  addCart(root, rgb);
  const rec = bare ? null : recorder();
  const c = mkConsole({ root, startScreen: { screen: 'library' }, ...(rec ? { renderer: rec } : {}) });
  c.app.start();
  const screen = wrapScreen(c.stdout);
  c.tick(0.5);
  assert.ok(c.goto('drifter'), 'cursor reaches the cartridge');
  c.key('\r');
  c.tick(1.6); await c.settle(); c.tick(5); await c.settle(); c.tick(1);
  assert.equal(c.sh().screen, 'running');
  const d = {
    app: c.app, stdout: c.stdout, stdin: c.stdin, proc: c.proc, rec, screen, kind: 'running',
    step: () => c.app.tick(DT), key: (k) => c.key(k), done: () => c.done(),
  };
  for (let i = 0; i < 4; i++) d.step();
  return d;
}

// the library screen: the cursor moves on every step, so the console has something to redraw
async function mkLibrary({ bare = false } = {}) {
  const root = makeRoot();
  addCart(root, false);
  const rec = bare ? null : recorder();
  const c = mkConsole({ root, startScreen: { screen: 'library' }, ...(rec ? { renderer: rec } : {}) });
  c.app.start();
  const screen = wrapScreen(c.stdout);
  c.tick(0.5);
  assert.equal(c.sh().screen, 'library');
  const d = {
    app: c.app, stdout: c.stdout, stdin: c.stdin, proc: c.proc, rec, screen, kind: 'library',
    step: () => { c.key('\x1b[C'); c.app.tick(1.2); }, key: (k) => c.key(k), done: () => c.done(),
  };
  for (let i = 0; i < 4; i++) d.step();
  return d;
}

const PATHS = [
  ['Classic palette', () => mkClassic(false)],
  ['Classic rgb', () => mkClassic(true)],
  ['console running palette', () => mkRunning(false)],
  ['console running rgb', () => mkRunning(true)],
];
const ALL_PATHS = [...PATHS, ['console library', () => mkLibrary()]];

// ---- checks shared by the scenarios

const copyScreen = (s) => ({ ch: s.ch.slice(), fg: s.fg.slice(), bg: s.bg.slice() });

// what a fresh terminal shows for a fresh full render of `frame`
function freshScreen(frame) {
  const s = makeScreen(W, H);
  s.write(createRenderer().render(frame));
  return s;
}

// the terminal that has been fed only what the app wrote shows exactly `frame`
function assertShows(screen, frame, label) {
  const ref = freshScreen(frame);
  let bad = 0, first = -1;
  for (let i = 0; i < W * H - 1; i++) {
    let ok = screen.ch[i] === ref.ch[i];
    if (ok && ref.ch[i] !== 32) {
      ok = screen.fg[i] === ref.fg[i] && (ref.ch[i] === 0x2588 || screen.bg[i] === ref.bg[i]);
    }
    if (!ok) { bad++; if (first < 0) first = i; }
  }
  assert.equal(bad, 0, `${label}: ${bad} cells differ from a fresh render of the current frame (first ${first})`);
}

// every write the app made equals the output of a standalone real renderer fed ONLY the frames the app really rendered
function assertWritesMatchRef(d) {
  const ref = createRenderer();
  const expected = [];
  // replay what the app asked of its renderer, in order (it invalidates on a screen or background change); an empty diff is not written
  for (const e of d.rec.log) {
    if (e === 'invalidate') { ref.invalidate(); continue; }
    const out = ref.render(d.rec.calls[e]);
    if (out) expected.push(SYNC_BEGIN + out + SYNC_END);
  }
  assert.deepEqual(frameWrites(d), expected, 'every write is the diff from the previous WRITTEN frame');
}

const sameFrame = (a, b) => {
  assert.equal(a.cols, b.cols); assert.equal(a.rows, b.rows);
  assert.equal(a.palette.key, b.palette.key);
  for (const k of ['glyphs', 'shades', 'fg', 'bg']) assert.deepEqual(a[k], b[k], k);
};

const frameWrites = (d) => d.stdout.writes.filter((w) => w.startsWith(SYNC_BEGIN));

// ---- arm 1 and arm 2, for several skip counts

for (const [name, make] of ALL_PATHS) {
  for (const skips of [1, 3, 10]) {
    test(`BP ${name}: ${skips} frame(s) skipped while draining -> no write, no render, time advances; on clear ONE write that is the diff from the last written frame`, async () => {
      const d = await make();
      const ctl = await make(); // the control: same steps, never drained
      assert.ok(d.rec.calls.length >= 3, 'frames were written before the drain');
      assert.equal(ctl.rec.calls.length, d.rec.calls.length, 'control and subject warmed up identically');
      const n0 = d.rec.calls.length, w0 = d.stdout.writes.length, last = d.rec.calls[n0 - 1];
      const before = copyScreen(d.screen);
      const t0 = d.app.getState().t;
      assertShows(d.screen, last, 'before the drain');

      d.stdout.writableNeedDrain = true;
      for (let i = 0; i < skips; i++) { d.step(); ctl.step(); }
      assert.equal(d.stdout.writes.length, w0, 'no write at all while draining');
      assert.equal(d.rec.calls.length, n0, 'render() not called while draining');
      assert.equal(d.rec.outs.length, n0, 'no renderer output produced while draining');
      assert.deepEqual(copyScreen(d.screen), before, 'the terminal did not change');
      if (name.startsWith('Classic')) assert.ok(Math.abs(d.app.getState().t - (t0 + skips * DT)) < 1e-9, 'the Classic clock kept running');

      d.stdout.writableNeedDrain = false;
      d.step(); ctl.step();
      assert.equal(d.stdout.writes.length, w0 + 1, 'exactly one write once the drain clears');
      assert.equal(d.rec.calls.length, n0 + 1, 'exactly one render() call once the drain clears');
      const cur = d.rec.calls[n0];

      // time advanced while skipping: the drained app's frame is the control's frame for the same tick
      assert.equal(ctl.rec.calls.length, n0 + skips + 1, 'control rendered every tick');
      sameFrame(cur, ctl.rec.calls[n0 + skips]);

      // the bytes are the diff from the LAST WRITTEN frame
      const ref = createRenderer();
      ref.render(last);
      const expected = ref.render(cur);
      assert.ok(expected.length > 0, 'the frame changed');
      assert.equal(d.stdout.writes[w0], SYNC_BEGIN + expected + SYNC_END, 'bytes = standalone renderer fed [last written, current]');
      // and not the diff from the previous (skipped) frame
      const wrongRef = createRenderer();
      wrongRef.render(ctl.rec.calls[n0 + skips - 1]);
      const wrong = wrongRef.render(cur);
      assert.notEqual(wrong, expected, 'control for the test: the skipped frame is a different baseline');
      assert.notEqual(d.stdout.writes[w0], SYNC_BEGIN + wrong + SYNC_END);

      // the screen those bytes build is the screen a fresh render of the current frame gives
      assertShows(d.screen, cur, 'after the clear');
      assertWritesMatchRef(d);
      d.done(); ctl.done();
    });
  }
}

// ---- the real renderer (no seam): same arms, judged on stdout alone

for (const [name, make] of [['Classic palette', () => mkClassic(false, { bare: true })], ['Classic rgb', () => mkClassic(true, { bare: true })],
  ['console running palette', () => mkRunning(false, { bare: true })], ['console running rgb', () => mkRunning(true, { bare: true })]]) {
  test(`BP ${name}: with the app's own renderer (no seam) 10 skipped frames write nothing, then one write that repaints correctly`, async () => {
    const d = await make();
    const w0 = d.stdout.writes.length;
    assert.ok(w0 > 3);
    d.stdout.writableNeedDrain = true;
    for (let i = 0; i < 10; i++) d.step();
    assert.equal(d.stdout.writes.length, w0);
    d.stdout.writableNeedDrain = false;
    d.step();
    assert.equal(d.stdout.writes.length, w0 + 1);
    const w = d.stdout.writes[w0];
    assert.ok(w.startsWith(SYNC_BEGIN) && w.endsWith(SYNC_END) && w.length > SYNC_BEGIN.length + SYNC_END.length);
    assert.ok(!w.includes('\x1b[2J'), 'a diff, not a full repaint');
    d.done();
  });
}

// ---- the drain clears and sets again, alternately

for (const [name, make] of ALL_PATHS) {
  test(`BP ${name}: drain alternating on and off -> one write per clear, never a write while set, every write a diff from the last written frame`, async () => {
    const d = await make();
    const base = d.rec.calls.length;
    let writes = d.stdout.writes.length, expectedRenders = base, nonEmpty = 0;
    const pattern = [[true, 2], [false, 1], [true, 1], [false, 1], [true, 4], [false, 1], [false, 1], [true, 3], [false, 1]];
    for (const [need, ticks] of pattern) {
      d.stdout.writableNeedDrain = need;
      for (let i = 0; i < ticks; i++) {
        d.step();
        if (need) assert.equal(d.stdout.writes.length, writes, 'nothing written while the stream needs drain');
        else {
          expectedRenders++;
          assert.equal(d.rec.calls.length, expectedRenders, 'one render per undrained tick');
          if (d.rec.outs[expectedRenders - 1]) { writes++; nonEmpty++; } // an empty diff is not written
          assert.equal(d.stdout.writes.length, writes, 'one write per undrained tick that changed something');
        }
      }
      assert.equal(d.rec.calls.length, expectedRenders);
    }
    assertWritesMatchRef(d);
    assert.ok(nonEmpty >= 3, 'the run really wrote frames (' + nonEmpty + ')');
    assertShows(d.screen, d.rec.calls[d.rec.calls.length - 1], 'end of the alternating run');
    d.done();
  });
}

// ---- the gate is writableNeedDrain, not a size

for (const [name, make] of PATHS) {
  test(`BP ${name}: a large writableLength alone does not skip a frame (writableNeedDrain is the only gate)`, async () => {
    const d = await make();
    const n0 = d.rec.calls.length, w0 = d.stdout.writes.length;
    d.stdout.writableLength = 10 * 1024 * 1024;
    d.step();
    assert.equal(d.rec.calls.length, n0 + 1, 'the frame was rendered');
    assert.equal(d.stdout.writes.length, w0 + (d.rec.outs[n0] ? 1 : 0), 'and written');
    d.done();
  });
}

// ---- q quits promptly while draining, on every path

for (const [name, make] of ALL_PATHS) {
  test(`BP ${name}: q while the stream needs drain exits at once (the leave bytes are written, no waiting for drain), and nothing more is drawn`, async () => {
    const d = await make();
    d.stdout.writableNeedDrain = true;
    d.step();
    const w = d.stdout.writes.length;
    d.key('q');
    assert.deepEqual(d.proc.exits, [0], 'exit(0) called synchronously');
    assert.equal(d.stdout.writes.length, w + 1);
    assert.equal(d.stdout.writes[w], LEAVE);
    d.stdout.writableNeedDrain = false;
    d.step();
    assert.equal(d.stdout.writes.length, w + 1, 'nothing drawn after quit');
    d.done();
  });

  test(`BP ${name}: q while draining, with a stream that never calls back, still exits by the 750 ms backstop`, async () => {
    const d = await make();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      d.stdout.writableNeedDrain = true;
      const orig = d.stdout.write;
      d.stdout.write = (s) => { orig(s); return false; }; // the callback is never invoked
      d.key('q');
      assert.deepEqual(d.proc.exits, [], 'the exit waits for the flush callback');
      mock.timers.tick(749);
      assert.deepEqual(d.proc.exits, []);
      mock.timers.tick(1);
      assert.deepEqual(d.proc.exits, [0], 'the 750 ms backstop exits without a drain');
    } finally {
      mock.timers.reset();
      d.done();
    }
  });
}
