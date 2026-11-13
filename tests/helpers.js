import { EventEmitter } from 'node:events';

export function fakeStdout({ columns = 80, rows = 24, isTTY = true } = {}) {
  const e = new EventEmitter();
  e.columns = columns;
  e.rows = rows;
  e.isTTY = isTTY;
  e.writes = [];
  e.write = (s, cb) => {
    e.writes.push(String(s));
    if (typeof cb === 'function') cb();
    return true;
  };
  return e;
}

// A terminal that has stopped reading (DRIFT-8 C6), the opposite of fakeStdout (which calls every callback at once).
//   write(s, cb)        keeps the bytes in `writes` and in the queue; the callback is NEVER called by itself (it waits in `pending`), and
//                       write returns false once the queued bytes pass `highWaterMark` (16384, a tty stream's default) - and stays false.
//   writableLength      the bytes queued and not yet flushed.
//   writableNeedDrain   false at first; true from the write that takes the queue over `highWaterMark`, and it stays true: no 'drain' is
//                       emitted unless the test calls release(). (needDrainFromStart: true makes it true before the first write.)
//   release()           the terminal catches up: every pending callback is called in order, the queue empties, writableNeedDrain
//                       goes false and 'drain' is emitted.
//   stick() / unstick() switch the stall off and on: unstuck, write behaves exactly like fakeStdout (callback at once, true).
export function stuckStdout({ columns = 80, rows = 24, isTTY = true, highWaterMark = 16384, needDrainFromStart = false, stuck = true } = {}) {
  const e = new EventEmitter();
  e.columns = columns;
  e.rows = rows;
  e.isTTY = isTTY;
  e.writes = [];
  e.pending = [];
  e.stuck = stuck;
  e.writableLength = 0;
  e.writableNeedDrain = needDrainFromStart;
  e.write = (s, cb) => {
    const text = String(s);
    e.writes.push(text);
    if (!e.stuck) { if (typeof cb === 'function') cb(); return true; }
    e.writableLength += Buffer.byteLength(text);
    if (typeof cb === 'function') e.pending.push(cb);
    if (e.writableLength > highWaterMark) e.writableNeedDrain = true;
    return e.writableLength <= highWaterMark;
  };
  e.release = () => {
    const cbs = e.pending.splice(0);
    e.writableLength = 0;
    e.writableNeedDrain = false;
    for (const cb of cbs) cb();
    e.emit('drain');
  };
  e.stick = () => { e.stuck = true; };
  e.unstick = () => { e.stuck = false; };
  return e;
}

export function fakeStdin({ isTTY = true } = {}) {
  const e = new EventEmitter();
  e.isTTY = isTTY;
  e.rawMode = null;
  e.rawCalls = [];
  e.paused = true;
  e.unrefd = false;
  e.setRawMode = (v) => { e.rawMode = v; e.rawCalls.push(v); return e; };
  e.resume = () => { e.paused = false; return e; };
  e.pause = () => { e.paused = true; return e; };
  e.unref = () => { e.unrefd = true; };
  e.ref = () => { e.unrefd = false; };
  e.setEncoding = () => e;
  return e;
}

export function fakeProc() {
  const e = new EventEmitter();
  e.exits = [];
  e.exit = (c) => { e.exits.push(c); };
  return e;
}

// stderr that never calls back (the same stall, for the error path); release() lets the callbacks go.
export function stuckStderr() {
  const e = new EventEmitter();
  e.writes = [];
  e.pending = [];
  e.write = (s, cb) => { e.writes.push(String(s)); if (typeof cb === 'function') e.pending.push(cb); return false; };
  e.release = () => { for (const cb of e.pending.splice(0)) cb(); };
  return e;
}

export function fakeStderr() {
  const e = new EventEmitter();
  e.writes = [];
  e.write = (s, cb) => { e.writes.push(String(s)); if (typeof cb === 'function') cb(); return true; };
  return e;
}

export const PROC_EVENTS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK', 'uncaughtException', 'unhandledRejection', 'exit'];

export function listenerTotal(proc) {
  return PROC_EVENTS.reduce((n, ev) => n + proc.listenerCount(ev), 0);
}

// A manual clock for the app: the app asks now() for ms.
export function fakeClock(start = 1000) {
  let ms = start;
  return { now: () => ms, advance: (d) => { ms += d; } };
}
