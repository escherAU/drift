// DRIFT-8 C6: a terminal that has stopped reading. stuckStdout (tests/helpers.js) keeps every byte, never calls a write callback by itself, returns
// false from write once more than 16384 bytes are queued, and keeps writableNeedDrain true (it goes true on the write that takes the queue over the mark,
// and nothing emits 'drain' unless the test calls release()). Timers are node's mock timers: nothing waits for wall time. The app is the real createApp.
//
// What the app is meant to do (src/app.js, src/term.js): while writableNeedDrain is true it draws nothing (the frame is dropped, time still runs); q and
// Ctrl+C turn raw mode off, write the restore sequence (LEAVE, src/term.js) and exit when that write's callback fires, or after 750 ms whichever is first,
// and only once. Each arm below has its opposite next to it:
//   (a) the stream never drains            -> no frame after the stall; LEAVE is the last write; exit at 750 ms exactly (not 749), once; q is 0, Ctrl+C is 130
//   (b) the stream drains late (200 ms)    -> the exit is on the callback at 200 ms (not before, not waiting for the 750), and the backstop adds no second exit
//   (c) the callback comes at once         -> exit at once, once (the old fake)
//   (d) a large frame is queued, unflushed -> (a) and (b) again with 100 KB to 600 KB of picture ahead of the restore sequence; on both paths: Classic and
//                                              the console (a running cartridge)
//   and the error path with a stuck stderr -> exit 1 once at 750 ms.
import test, { mock, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { LEAVE, ENTER } from '../src/term.js';
import { SYNC_BEGIN } from '../src/renderer.js';
import { PLAYLISTS } from '../src/scenes/index.js';
import { discoverCartridges, loadScenes as realLoadScenes } from '../src/cartridge/loader.js';
import { fakeStdin, fakeStdout, stuckStdout, stuckStderr, fakeProc, fakeStderr } from './helpers.js';
import { mkShell, makeRoot, DT } from './helpers-shell.js';
import { writeCart, LABEL } from './helpers-cartridge.js';
import { makePlain } from './helpers-fullcolour.js';

const MARK = 16384; // the stall mark of stuckStdout (a tty stream's default high-water mark)
const BACKSTOP = 750; // src/app.js quit() and start(): the exit that does not wait for a stream (written out in both places)
const micro = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const cleanups = [];
after(() => { for (const f of cleanups.splice(0)) f(); });

// ---- the picture: every tick a different 1/7 of the cells updates (so a frame differs from the last in a few cells, and a full one is big)
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
  s.id = rgb ? 'stuck-rgb' : 'stuck-pal'; s.kind = 'cells';
  if (rgb) s.rgb = true;
  return s;
}
function cartSource() {
  return [body.toString(), 'function drifter(t, w, h, params) { body(t, w, h, params, true); }', "drifter.id = 'drifter';", "drifter.kind = 'cells';", 'drifter.rgb = true;', 'export default drifter;', ''].join('\n');
}
function addCart(root) {
  return writeCart(root, 'drifter', {
    'manifest.json': {
      format: 2, id: 'drifter', title: 'Drifter', version: '1.0.0', author: 'Test', blurb: 'Changes a few cells per frame.', runtime: 'cartridge', labelHue: '#7FB069',
      scenes: [{ id: 'drifter', kind: 'cells', rgb: true }],
      programs: [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: ['drifter'], sceneSeconds: 300 }],
      start: 'main',
    },
    'label.txt': LABEL,
    'skin.json': { palette: { hue: '#7FB069', colours: ['#FF6B6B', '#4ECDC4'], bg: '#0B140C' } },
    'scenes/drifter.js': cartSource(),
  });
}

// ---- the scenarios. Each returns { app, stdout, stdin, proc, stderr, tick(), key(k), bytesQueued() }, with the stream UNSTUCK until stall() is called.
// `stall()` sticks the stream and ticks once, so one more frame is queued and unflushed; the frame is returned.
async function classic({ rgb = true, cols = 280, rows = 70, stdout = stuckStdout({ columns: cols, rows, stuck: false }), stderr = fakeStderr() } = {}) {
  const stdin = fakeStdin(), proc = fakeProc();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-stuck-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  mock.timers.enable({ apis: ['setTimeout'] });
  const app = createApp({
    stdin, stdout, stderr, proc, env: { COLORTERM: 'truecolor' }, configPath: path.join(dir, 'c', 'config.json'),
    dirs: [], autoLoop: false, seed: 1, sceneSeconds: 1000, fadeSeconds: 4, startMode: 'experimental',
    playlists: { ...PLAYLISTS, experimental: [classicScene(rgb), makePlain()] },
  });
  app.start();
  for (let i = 0; i < 4; i++) app.tick(DT);
  return {
    kind: 'classic', app, stdout, stdin, proc, stderr,
    tick: () => app.tick(DT), key: (k) => stdin.emit('data', k),
    stall() { stdout.stick(); const n = stdout.writes.length; app.tick(DT); return stdout.writes.length > n ? stdout.writes[stdout.writes.length - 1] : ''; },
  };
}

async function consoleRunning({ stdout = stuckStdout({ columns: 280, rows: 70, stuck: false }), stderr = fakeStderr() } = {}) {
  const root = makeRoot();
  addCart(root);
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const found = discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
  const loaded = await realLoadScenes(found.cartridges.find((c) => c.id === 'drifter')); // real I/O now, before any timer is mocked
  mock.timers.enable({ apis: ['setTimeout'] });
  const c = mkShell({ root, cols: 280, rows: 70, stdout, stderr, startScreen: { screen: 'library' }, loadScenes: async () => loaded });
  cleanups.push(() => fs.rmSync(c.dir, { recursive: true, force: true }));
  c.app.start();
  c.tick(0.5, 0.25);
  assert.ok(c.goto('drifter'), 'the cursor reaches the cartridge');
  c.key('\r');
  await micro();
  c.tick(8, 0.25);
  assert.equal(c.sh().screen, 'running');
  for (let i = 0; i < 4; i++) c.app.tick(DT);
  return {
    kind: 'console', app: c.app, stdout, stdin: c.stdin, proc: c.proc, stderr,
    tick: () => c.app.tick(DT), key: (k) => c.key(k),
    stall() { stdout.stick(); const n = stdout.writes.length; c.app.tick(DT); return stdout.writes.length > n ? stdout.writes[stdout.writes.length - 1] : ''; },
  };
}

const SCENARIOS = [
  ['Classic, full-colour 280x70', () => classic()],
  ['console (a running cartridge), full-colour 280x70', () => consoleRunning()],
];

// the app is stalled with a big frame in the queue (the same check in every arm)
function stalled(s, big) {
  assert.ok(big.length > MARK * 4, `a large frame was queued unflushed: ${big.length} chars`);
  assert.ok(big.startsWith(SYNC_BEGIN), 'it is a frame');
  assert.equal(s.stdout.writableNeedDrain, true);
  assert.ok(s.stdout.writableLength > MARK, `queued ${s.stdout.writableLength} bytes`);
  assert.deepEqual(s.proc.exits, []);
}
const lastWrite = (s) => s.stdout.writes[s.stdout.writes.length - 1];

for (const [name, make] of SCENARIOS) {
  // ---- (a) never drains, with a large frame ahead of the restore sequence ((d) for (a))
  for (const [keyName, key, code] of [['q', 'q', 0], ['Ctrl+C', '\x03', 130]]) {
    test(`stuck stdout (a)+(d) ${name}: no frame after the stall; ${keyName} turns raw mode off, writes LEAVE last, and exits ${code} once, at ${BACKSTOP} ms and not at ${BACKSTOP - 1}`, async () => {
      const s = await make();
      try {
        const big = s.stall();
        stalled(s, big);
        // several seconds: nothing more is written, and the queue does not grow
        const w = s.stdout.writes.length, len = s.stdout.writableLength;
        for (let i = 0; i < 90; i++) s.tick();
        assert.equal(s.stdout.writes.length, w, 'no frame is written while the stream is stuck (5 s of ticks)');
        assert.equal(s.stdout.writableLength, len);

        s.key(key);
        assert.equal(s.stdin.rawCalls[s.stdin.rawCalls.length - 1], false, 'raw mode is turned off');
        assert.equal(lastWrite(s), LEAVE, 'the restore sequence is the last write');
        assert.equal(s.stdout.writes.length, w + 1, 'and the only one');
        assert.deepEqual(s.proc.exits, [], 'the exit waits: the write has not been flushed');
        mock.timers.tick(BACKSTOP - 1);
        assert.deepEqual(s.proc.exits, [], `not at ${BACKSTOP - 1} ms`);
        mock.timers.tick(1);
        assert.deepEqual(s.proc.exits, [code], `exit ${code} at ${BACKSTOP} ms`);
        mock.timers.tick(2000);
        assert.deepEqual(s.proc.exits, [code], 'exactly once');
        for (let i = 0; i < 5; i++) s.tick();
        assert.equal(s.stdout.writes.length, w + 1, 'nothing is drawn after the quit');
        assert.equal(lastWrite(s), LEAVE);
      } finally { mock.timers.reset(); }
    });
  }

  // ---- (b) drains late: the callbacks come at 200 ms
  for (const [keyName, key, code] of [['q', 'q', 0], ['Ctrl+C', '\x03', 130]]) {
    test(`stuck stdout (b)+(d) ${name}: the stream drains at 200 ms after ${keyName} -> exit ${code} on the callback at 200 ms (not before, not at ${BACKSTOP}), and the backstop adds no second exit`, async () => {
      const s = await make();
      try {
        stalled(s, s.stall());
        s.key(key);
        assert.equal(lastWrite(s), LEAVE);
        mock.timers.tick(199);
        assert.deepEqual(s.proc.exits, [], 'not before the callback (199 ms)');
        mock.timers.tick(1);
        assert.deepEqual(s.proc.exits, [], 'the stream has not called back yet at 200 ms either');
        assert.ok(s.stdout.pending.length >= 1, 'the restore write is waiting for its callback');
        s.stdout.release(); // the terminal catches up at 200 ms
        assert.deepEqual(s.proc.exits, [code], 'the exit is on the callback, not on the backstop');
        mock.timers.tick(BACKSTOP - 200 + 50);
        mock.timers.tick(2000);
        assert.equal(s.proc.exits.length, 1, 'the 750 ms backstop does not exit a second time');
        assert.deepEqual(s.proc.exits, [code]);
      } finally { mock.timers.reset(); }
    });
  }

  // ---- (c) the callback comes at once (the old fake)
  test(`stuck stdout (c) ${name}: a stream that calls back at once exits at once, once (the old fake), and the backstop adds no second exit`, async () => {
    const stdout = fakeStdout({ columns: 280, rows: 70 });
    const s = await (name.startsWith('Classic') ? classic({ stdout }) : consoleRunning({ stdout }));
    try {
      s.key('q');
      assert.deepEqual(s.proc.exits, [0], 'exit(0) at once');
      assert.equal(lastWrite(s), LEAVE);
      mock.timers.tick(2000);
      assert.deepEqual(s.proc.exits, [0], 'exactly once');
    } finally { mock.timers.reset(); }
  });
}

// ---- the stream was stuck from the very first byte (not even the enter sequence was flushed): the app draws until the queue passes the mark, then stops
test('stuck stdout (a) Classic, palette 40x12, stuck from the first byte: frames are written until 16 KB are queued and not one more; then q exits at 750 ms, LEAVE last', async () => {
  const stdout = stuckStdout({ columns: 40, rows: 12 });
  const s = await classic({ rgb: false, cols: 40, rows: 12, stdout });
  try {
    assert.equal(stdout.writes[0], ENTER);
    let frames = stdout.writes.filter((w) => w.startsWith(SYNC_BEGIN)).length;
    for (let i = 0; i < 200 && !stdout.writableNeedDrain; i++) { s.tick(); frames = stdout.writes.filter((w) => w.startsWith(SYNC_BEGIN)).length; }
    assert.equal(stdout.writableNeedDrain, true, 'the queue passed the mark');
    assert.ok(frames >= 4, `several frames were written before the stall (${frames})`);
    const w = stdout.writes.length;
    for (let i = 0; i < 90; i++) s.tick();
    assert.equal(stdout.writes.length, w, 'no frame after the stall');
    s.key('q');
    assert.equal(lastWrite(s), LEAVE);
    mock.timers.tick(BACKSTOP - 1);
    assert.deepEqual(s.proc.exits, []);
    mock.timers.tick(1);
    assert.deepEqual(s.proc.exits, [0]);
    mock.timers.tick(5000);
    assert.deepEqual(s.proc.exits, [0]);
  } finally { mock.timers.reset(); }
});

// ---- the error path: quit(1, text) writes LEAVE, then the text to stderr, and exits when stderr calls back; a stuck stderr must not hold the exit
test('stuck stdout, error path: an uncaught error with a stuck stderr exits 1 once at 750 ms (not at 749); the terminal is restored first and the text reaches stderr', async () => {
  const stderr = stuckStderr();
  const s = await classic({ rgb: false, cols: 80, rows: 24, stdout: fakeStdout({ columns: 80, rows: 24 }), stderr });
  try {
    s.proc.emit('uncaughtException', new Error('probe failure'));
    assert.equal(lastWrite(s), LEAVE, 'the terminal is restored before the text is written');
    assert.equal(stderr.writes.length, 1);
    assert.ok(stderr.writes[0].includes('probe failure'), stderr.writes[0]);
    assert.deepEqual(s.proc.exits, [], 'stderr has not called back');
    mock.timers.tick(BACKSTOP - 1);
    assert.deepEqual(s.proc.exits, []);
    mock.timers.tick(1);
    assert.deepEqual(s.proc.exits, [1], 'exit 1 at 750 ms');
    stderr.release(); // the late callback must not exit a second time
    mock.timers.tick(5000);
    assert.deepEqual(s.proc.exits, [1], 'exactly once');
  } finally { mock.timers.reset(); }
});

test('stuck stdout, error path: stderr that calls back late (300 ms) exits 1 on that callback, once', async () => {
  const stderr = stuckStderr();
  const s = await classic({ rgb: false, cols: 80, rows: 24, stdout: fakeStdout({ columns: 80, rows: 24 }), stderr });
  try {
    s.proc.emit('uncaughtException', new Error('late'));
    mock.timers.tick(299);
    assert.deepEqual(s.proc.exits, []);
    mock.timers.tick(1);
    stderr.release();
    assert.deepEqual(s.proc.exits, [1], 'exit 1 on the callback');
    mock.timers.tick(5000);
    assert.deepEqual(s.proc.exits, [1], 'the backstop adds no second exit');
  } finally { mock.timers.reset(); }
});

test('stuck stdout, error path with BOTH streams stuck: exit 1 once at 750 ms (the restore write never calls back, so the error text is not written at all)', async () => {
  const stdout = stuckStdout({ columns: 80, rows: 24 }), stderr = stuckStderr();
  const s = await classic({ rgb: false, cols: 80, rows: 24, stdout, stderr });
  try {
    s.proc.emit('uncaughtException', new Error('both stuck'));
    assert.equal(lastWrite(s), LEAVE);
    mock.timers.tick(BACKSTOP - 1);
    assert.deepEqual(s.proc.exits, []);
    mock.timers.tick(1);
    assert.deepEqual(s.proc.exits, [1]);
    mock.timers.tick(5000);
    assert.deepEqual(s.proc.exits, [1], 'exactly once');
  } finally { mock.timers.reset(); }
});

// ---- the non-TTY start path has its own 750 ms backstop (src/app.js start())
test('stuck stdout: the non-TTY refusal message exits 0 at 750 ms when stdout never calls back, and at once when it does', async () => {
  for (const [label, stdout, at] of [['stuck', stuckStdout({ isTTY: false }), BACKSTOP], ['at once', fakeStdout({ isTTY: false }), 0]]) {
    const proc = fakeProc();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const app = createApp({ stdin: fakeStdin({ isTTY: false }), stdout, stderr: fakeStderr(), proc, env: {}, configPath: path.join(os.tmpdir(), 'drift-stuck-none', 'c.json'), dirs: [], autoLoop: false });
      assert.equal(app.start(), false);
      if (at > 0) {
        mock.timers.tick(at - 1);
        assert.deepEqual(proc.exits, [], `${label}: not at ${at - 1} ms`);
        mock.timers.tick(1);
      }
      assert.deepEqual(proc.exits, [0], `${label}: exit 0`);
      mock.timers.tick(3000);
      assert.deepEqual(proc.exits, [0], `${label}: once`);
    } finally { mock.timers.reset(); }
  }
});
