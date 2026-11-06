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
