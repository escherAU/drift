import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminal, installGuards, ENTER, LEAVE } from '../src/term.js';
import { fakeStdin, fakeStdout, fakeProc, listenerTotal } from './helpers.js';

test('T1 enter emits alt-screen and hide-cursor and sets raw mode', () => {
  const stdin = fakeStdin(), stdout = fakeStdout();
  const term = createTerminal({ stdin, stdout });
  term.enter();
  const all = stdout.writes.join('');
  assert.ok(all.includes('\x1b[?1049h'));
  assert.ok(all.includes('\x1b[?25l'));
  assert.ok(all.indexOf('?1049h') < all.indexOf('?25l'));
  assert.equal(all, ENTER);
  assert.equal(stdin.rawMode, true);
  assert.equal(stdin.paused, false);
});

test('T2 leave emits exactly show-cursor, leave-alt-screen, SGR reset in that order; raw off; stdin paused+unref', () => {
  const stdin = fakeStdin(), stdout = fakeStdout();
  const term = createTerminal({ stdin, stdout });
  term.enter();
  const before = stdout.writes.length;
  term.leave();
  assert.deepEqual(stdout.writes.slice(before), ['\x1b[?25h\x1b[?1049l\x1b[0m']);
  assert.equal(LEAVE, '\x1b[?25h\x1b[?1049l\x1b[0m');
  assert.equal(stdin.rawMode, false);
  assert.equal(stdin.paused, true);
  assert.equal(stdin.unrefd, true);
});

test('T3 leave is idempotent and leave without enter emits nothing', () => {
  const stdin = fakeStdin(), stdout = fakeStdout();
  const term = createTerminal({ stdin, stdout });
  term.leave();
  assert.deepEqual(stdout.writes, []);
  term.enter();
  term.leave();
  const n = stdout.writes.length;
  let called = 0;
  term.leave(() => { called++; });
  term.leave();
  assert.equal(stdout.writes.length, n);
  assert.equal(called, 1, 'callback still fires so exit can proceed');
});

test('terminal wires and unwires key + resize listeners; keys arrive as strings', () => {
  const stdin = fakeStdin(), stdout = fakeStdout({ columns: 90, rows: 30 });
  const term = createTerminal({ stdin, stdout });
  const keys = [], sizes = [];
  term.onKey((k) => keys.push(k));
  term.onResize((c, r) => sizes.push([c, r]));
  term.enter();
  stdin.emit('data', Buffer.from('q'));
  stdin.emit('data', ' ');
  assert.deepEqual(keys, ['q', ' ']);
  stdout.columns = 100; stdout.rows = 40;
  stdout.emit('resize');
  assert.deepEqual(sizes, [[100, 40]]);
  assert.deepEqual(term.size(), { cols: 100, rows: 40 });
  term.leave();
  assert.equal(stdin.listenerCount('data'), 0);
  assert.equal(stdout.listenerCount('resize'), 0);
  stdin.emit('data', 'q');
  assert.equal(keys.length, 2);
});

test('size falls back to defaults when the stream has no dimensions', () => {
  const stdout = fakeStdout(); stdout.columns = undefined; stdout.rows = undefined;
  const term = createTerminal({ stdin: fakeStdin(), stdout });
  assert.deepEqual(term.size(), { cols: 80, rows: 24 });
});

test('T6/T8/T9 guards route signals and fatal errors, and are removed afterwards', () => {
  const proc = fakeProc();
  const seen = [];
  const off = installGuards(proc, (reason, arg) => seen.push([reason, arg && arg.message]));
  proc.emit('SIGINT');
  proc.emit('SIGTERM');
  proc.emit('uncaughtException', new Error('boom'));
  proc.emit('unhandledRejection', new Error('nope'));
  proc.emit('exit');
  assert.deepEqual(seen.map((s) => s[0]), ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection', 'exit']);
  assert.equal(seen[2][1], 'boom');
  assert.ok(listenerTotal(proc) >= 6);
  off();
  assert.equal(listenerTotal(proc), 0);
  proc.emit('SIGINT');
  assert.equal(seen.length, 5);
});
