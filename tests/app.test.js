import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, SPEEDS, parseOptions } from '../src/app.js';
import { ENTER, LEAVE } from '../src/term.js';
import { SCENES } from '../src/scenes/index.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr, listenerTotal } from './helpers.js';

function mkApp(extra = {}) {
  const stdin = fakeStdin(), stdout = fakeStdout({ columns: 80, rows: 24 });
  const stderr = fakeStderr(), proc = fakeProc();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-app-'));
  const configPath = path.join(dir, 'drift', 'config.json');
  const app = createApp({
    stdin, stdout, stderr, proc, env: { COLORTERM: 'truecolor' }, configPath,
    autoLoop: false, seed: 1, sceneSeconds: 100, fadeSeconds: 4, ...extra,
  });
  return { app, stdin, stdout, stderr, proc, dir, configPath };
}
const cleanup = (c) => fs.rmSync(c.dir, { recursive: true, force: true });

test('T10 TTY arm: a TTY enters normally (alt screen + hidden cursor, raw mode)', () => {
  const c = mkApp();
  assert.equal(c.app.start(), true);
  assert.equal(c.stdout.writes[0], ENTER);
  assert.equal(c.stdin.rawMode, true);
  assert.deepEqual(c.proc.exits, []);
  c.app.quit(0);
  cleanup(c);
});

test('T10 non-TTY arm: message, exit 0, and no escape sequences at all', () => {
  for (const which of ['stdin', 'stdout']) {
    const stdin = fakeStdin({ isTTY: which !== 'stdin' }), stdout = fakeStdout({ isTTY: which !== 'stdout' });
    const proc = fakeProc();
    const app = createApp({ stdin, stdout, stderr: fakeStderr(), proc, env: {}, autoLoop: false });
    assert.equal(app.start(), false);
    const out = stdout.writes.join('');
    assert.ok(!out.includes('\x1b'), 'no escapes');
    assert.match(out, /terminal/i);
    assert.deepEqual(proc.exits, [0]);
    assert.equal(stdin.rawMode, null);
    assert.equal(listenerTotal(proc), 0);
  }
});

test('T4 q restores the terminal and exits 0', () => {
  const c = mkApp();
  c.app.start();
  c.app.tick(0.05);
  c.stdin.emit('data', 'q');
  assert.equal(c.stdout.writes.at(-1), LEAVE);
  assert.deepEqual(c.proc.exits, [0]);
  assert.equal(c.stdin.rawMode, false);
  cleanup(c);
});

test('T4 Q (upper case) also quits', () => {
  const c = mkApp();
  c.app.start();
  c.stdin.emit('data', 'Q');
  assert.equal(c.stdout.writes.at(-1), LEAVE);
  cleanup(c);
});

test('T5 byte 0x03 (Ctrl+C in raw mode) restores and exits', () => {
  const c = mkApp();
  c.app.start();
  c.stdin.emit('data', Buffer.from([0x03]));
  assert.equal(c.stdout.writes.at(-1), LEAVE);
  assert.deepEqual(c.proc.exits, [130]);
  cleanup(c);
});

test('T6 SIGINT and SIGTERM restore (both arms)', () => {
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const c = mkApp();
    c.app.start();
    c.proc.emit(sig);
    assert.equal(c.stdout.writes.at(-1), LEAVE, sig);
    assert.deepEqual(c.proc.exits, [code], sig);
    cleanup(c);
  }
});

test('T7 a scene that throws is caught, the terminal restored, exit code non-zero, error reported', () => {
  const bad = Object.assign(() => { throw new Error('scene exploded'); }, { id: 'bad' });
  const c = mkApp({ scenes: [bad, ...SCENES.slice(1)] });
  c.app.start();
  assert.doesNotThrow(() => c.app.tick(0.05));
  assert.equal(c.stdout.writes.at(-1), LEAVE);
  assert.deepEqual(c.proc.exits, [1]);
  assert.match(c.stderr.writes.join(''), /scene exploded/);
  cleanup(c);
});

test('T8 uncaughtException and unhandledRejection restore, exit 1, and report', () => {
  for (const ev of ['uncaughtException', 'unhandledRejection']) {
    const c = mkApp();
    c.app.start();
    c.proc.emit(ev, new Error('kaboom ' + ev));
    assert.equal(c.stdout.writes.at(-1), LEAVE, ev);
    assert.deepEqual(c.proc.exits, [1], ev);
    assert.match(c.stderr.writes.join(''), new RegExp('kaboom ' + ev));
    cleanup(c);
  }
});

test('T8 an unhandledRejection with a non-Error reason is still handled', () => {
  const c = mkApp();
  c.app.start();
  c.proc.emit('unhandledRejection', 'plain string');
  assert.equal(c.stdout.writes.at(-1), LEAVE);
  assert.match(c.stderr.writes.join(''), /plain string/);
  cleanup(c);
});

test('T9 no handlers leak after leaving; a second signal does nothing', () => {
  const c = mkApp();
  assert.equal(listenerTotal(c.proc), 0);
  c.app.start();
  assert.ok(listenerTotal(c.proc) > 0);
  c.app.quit(0);
  assert.equal(listenerTotal(c.proc), 0);
  assert.equal(c.stdin.listenerCount('data'), 0);
  assert.equal(c.stdout.listenerCount('resize'), 0);
  const n = c.stdout.writes.length;
  c.proc.emit('SIGINT');
  c.app.quit(0);
  assert.equal(c.stdout.writes.length, n);
  assert.equal(c.proc.exits.length, 1);
  cleanup(c);
});

test('R5 exactly one stdout.write per changed frame, none for an unchanged frame', () => {
  const c = mkApp();
  c.app.start();
  const base = c.stdout.writes.length; // ENTER
  c.app.tick(0.05);
  assert.equal(c.stdout.writes.length, base + 1, 'first frame: one write');
  assert.ok(c.stdout.writes.at(-1).startsWith('\x1b[2J'));
  c.app.tick(0.5);
  assert.equal(c.stdout.writes.length, base + 2, 'a moving frame: still one write');
  c.app.tick(0);
  assert.equal(c.stdout.writes.length, base + 2, 'dt 0 gives an identical frame: zero writes');
  c.app.quit(0);
  cleanup(c);
});

test('T11 live resize updates dimensions and forces a full repaint', () => {
  const c = mkApp();
  c.app.start();
  c.app.tick(0.05);
  c.app.tick(0.05);
  assert.deepEqual([c.app.getState().cols, c.app.getState().rows], [80, 24]);
  const n = c.stdout.writes.length;
  c.stdout.columns = 100; c.stdout.rows = 30;
  c.stdout.emit('resize');
  assert.equal(c.stdout.writes.length, n + 1);
  assert.ok(c.stdout.writes.at(-1).startsWith('\x1b[2J'));
  assert.deepEqual([c.app.getState().cols, c.app.getState().rows], [100, 30]);
  for (const m of c.stdout.writes.at(-1).matchAll(/\x1b\[(\d+);(\d+)H/g)) {
    assert.ok(Number(m[1]) <= 30 && Number(m[2]) <= 100);
  }
  c.app.quit(0);
  cleanup(c);
});

test('T12 space asks for the next scene; unknown keys are ignored', () => {
  const c = mkApp();
  c.app.start();
  c.app.tick(0.05);
  const n = c.stdout.writes.length;
  const before = JSON.stringify(c.app.getState());
  for (const k of ['x', 'z', '1', '\x1b[A', '\r', '\x1b']) c.stdin.emit('data', k);
  assert.equal(JSON.stringify(c.app.getState()), before);
  assert.equal(c.stdout.writes.length, n);
  c.stdin.emit('data', ' ');
  assert.equal(c.app.getState().fading, true);
  for (let i = 0; i < 90; i++) c.app.tick(1 / 18);
  assert.equal(c.app.getState().sceneIndex, 1);
  c.app.quit(0);
  cleanup(c);
});

test('T12 +/- change speed, clamp at both ends', () => {
  const c = mkApp();
  c.app.start();
  const s0 = c.app.getState().speed;
  assert.equal(s0, 1);
  c.stdin.emit('data', '+');
  assert.ok(c.app.getState().speed > s0);
  for (let i = 0; i < 40; i++) c.stdin.emit('data', '+');
  assert.equal(c.app.getState().speed, SPEEDS[SPEEDS.length - 1]);
  for (let i = 0; i < 80; i++) c.stdin.emit('data', '-');
  assert.equal(c.app.getState().speed, SPEEDS[0]);
  c.stdin.emit('data', '=');
  assert.ok(c.app.getState().speed > SPEEDS[0]);
  c.app.quit(0);
  cleanup(c);
});

test('T12 speed scales how fast scene time advances', () => {
  const c = mkApp();
  c.app.start();
  c.app.tick(1);
  assert.equal(c.app.getState().t, 1);
  c.stdin.emit('data', '+');
  const sp = c.app.getState().speed;
  c.app.tick(1);
  assert.ok(Math.abs(c.app.getState().t - (1 + sp)) < 1e-9);
  c.app.quit(0);
  cleanup(c);
});

test('T12 p pauses (time and writes freeze) and unpausing resumes without a jump', () => {
  const c = mkApp();
  c.app.start();
  c.app.tick(1 / 18);
  c.stdin.emit('data', 'p');
  assert.equal(c.app.getState().paused, true);
  const t0 = c.app.getState().t, n = c.stdout.writes.length;
  for (let i = 0; i < 50; i++) c.app.tick(1 / 18);
  assert.equal(c.app.getState().t, t0, 'time frozen');
  assert.equal(c.stdout.writes.length, n, 'no writes while paused');
  c.stdin.emit('data', 'P');
  assert.equal(c.app.getState().paused, false);
  c.app.tick(1 / 18);
  assert.ok(Math.abs(c.app.getState().t - (t0 + 1 / 18)) < 1e-9, 'one frame of progress, no catch-up jump');
  c.app.quit(0);
  cleanup(c);
});

test('T12 c cycles colours in order, wraps, repaints, and persists the choice', () => {
  const c = mkApp();
  c.app.start();
  c.app.tick(0.05);
  assert.equal(c.app.getState().colour, 'claude');
  const order = ['amber', 'green', 'ice', 'violet', 'white', 'blend', 'claude'];
  for (const name of order) {
    const n = c.stdout.writes.length;
    c.stdin.emit('data', 'c');
    assert.equal(c.app.getState().colour, name);
    c.app.tick(0);
    assert.ok(c.stdout.writes.length >= n, 'tick after colour change is safe');
  }
  c.stdin.emit('data', 'c');
  assert.equal(JSON.parse(fs.readFileSync(c.configPath, 'utf8')).colour, 'amber');
  assert.match(c.stdout.writes.join(''), /\x1b\[38;2;\d+;\d+;0m/, 'amber (blue channel 0) truecolor was emitted');
  c.app.quit(0);
  cleanup(c);
});

test('colour is restored from config on start, bad config falls back to claude', () => {
  const c = mkApp();
  fs.mkdirSync(path.dirname(c.configPath), { recursive: true });
  fs.writeFileSync(c.configPath, JSON.stringify({ colour: 'violet' }));
  const stdin = fakeStdin(), stdout = fakeStdout(), proc = fakeProc();
  const app = createApp({ stdin, stdout, stderr: fakeStderr(), proc, env: {}, configPath: c.configPath, autoLoop: false });
  assert.equal(app.getState().colour, 'violet');
  fs.writeFileSync(c.configPath, '{{{{');
  const app2 = createApp({ stdin: fakeStdin(), stdout: fakeStdout(), stderr: fakeStderr(), proc: fakeProc(), env: {}, configPath: c.configPath, autoLoop: false });
  assert.equal(app2.getState().colour, 'claude');
  cleanup(c);
});

test('F6 (app level) an unwritable config path never crashes the app', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-app-'));
  const blocker = path.join(root, 'file');
  fs.writeFileSync(blocker, 'x');
  const c = mkApp({ configPath: path.join(blocker, 'config.json') });
  c.app.start();
  assert.doesNotThrow(() => c.stdin.emit('data', 'c'));
  assert.equal(c.app.getState().colour, 'amber');
  assert.deepEqual(c.proc.exits, []);
  c.app.quit(0);
  cleanup(c);
  fs.rmSync(root, { recursive: true, force: true });
});

test('colour mode follows the injected env: truecolor vs 256 (both arms)', () => {
  const run = (env) => {
    const c = mkApp({ env });
    c.app.start();
    c.app.tick(0.1);
    const out = c.stdout.writes.join('');
    c.app.quit(0);
    cleanup(c);
    return out;
  };
  assert.match(run({ WT_SESSION: 'x' }), /\x1b\[38;2;/);
  assert.doesNotMatch(run({ WT_SESSION: 'x' }), /\x1b\[38;5;/);
  assert.match(run({}), /\x1b\[38;5;\d+m/);
  assert.doesNotMatch(run({}), /\x1b\[38;2;/);
});

test('scheduler is driven by the app: scene changes after sceneSeconds then fades', () => {
  const c = mkApp({ sceneSeconds: 2, fadeSeconds: 1 });
  c.app.start();
  for (let i = 0; i < 18 * 2 + 2; i++) c.app.tick(1 / 18);
  assert.equal(c.app.getState().fading, true);
  for (let i = 0; i < 20; i++) c.app.tick(1 / 18);
  assert.equal(c.app.getState().sceneIndex, 1);
  c.app.quit(0);
  cleanup(c);
});

test('parseOptions reads flags and DRIFT_* env', () => {
  const o = parseOptions(['--scene-seconds', '30', '--fade-seconds=2', '--fps', '12', '--seed', '9', '--scene', 'rain'], {});
  assert.equal(o.sceneSeconds, 30);
  assert.equal(o.fadeSeconds, 2);
  assert.equal(o.fps, 12);
  assert.equal(o.seed, 9);
  assert.equal(o.startScene, 4);
  const e = parseOptions([], { DRIFT_SCENE_SECONDS: '15', DRIFT_FPS: '10' });
  assert.equal(e.sceneSeconds, 15);
  assert.equal(e.fps, 10);
  const d = parseOptions([], {});
  assert.equal(d.sceneSeconds, 180);
  assert.equal(d.fps, 18);
  assert.equal(d.fadeSeconds, 5);
  assert.equal(parseOptions(['--help'], {}).help, true);
  assert.equal(parseOptions(['--fps', 'banana'], {}).fps, 18);
  assert.equal(parseOptions(['--fps', '500'], {}).fps, 30);
});
