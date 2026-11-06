// Thin terminal layer: enter / leave the alternate screen, raw keys, resize,
// and process-level guards. Knows nothing about scenes.
//
// Sequence order (documented, tested):
//   ENTER  = alt screen on, cursor hidden
//   LEAVE  = cursor shown, alt screen off, SGR reset
// Each is a single stdout.write.

export const ENTER = '\x1b[?1049h\x1b[?25l';
export const LEAVE = '\x1b[?25h\x1b[?1049l\x1b[0m';

export function createTerminal({ stdin, stdout }) {
  let active = false;
  let keyCb = null, resizeCb = null;

  const onData = (d) => { if (keyCb) keyCb(typeof d === 'string' ? d : d.toString('utf8')); };
  const onResizeEv = () => { if (resizeCb) { const s = size(); resizeCb(s.cols, s.rows); } };

  function size() {
    const cols = Number(stdout.columns) > 0 ? Math.floor(stdout.columns) : 80;
    const rows = Number(stdout.rows) > 0 ? Math.floor(stdout.rows) : 24;
    return { cols, rows };
  }

  function enter() {
    if (active) return;
    active = true;
    stdout.write(ENTER);
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
    if (typeof stdin.setEncoding === 'function') stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdout.on('resize', onResizeEv);
    stdin.resume();
    if (typeof stdin.ref === 'function') stdin.ref();
  }

  // Idempotent. `cb` always fires (after the leave bytes are flushed when we
  // actually wrote them) so callers can exit safely.
  function leave(cb) {
    if (!active) { if (cb) cb(); return false; }
    active = false;
    stdin.removeListener('data', onData);
    stdout.removeListener('resize', onResizeEv);
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(false);
    stdin.pause();
    if (typeof stdin.unref === 'function') stdin.unref();
    stdout.write(LEAVE, cb);
    return true;
  }

  return {
    enter, leave, size,
    get active() { return active; },
    onKey(cb) { keyCb = cb; },
    onResize(cb) { resizeCb = cb; },
  };
}

const GUARD_EVENTS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK', 'uncaughtException', 'unhandledRejection', 'exit'];

// Calls handler(reason, arg) for signals, fatal errors and process exit.
// Returns a function that removes every listener it added.
export function installGuards(proc, handler) {
  const fns = new Map();
  for (const ev of GUARD_EVENTS) {
    const fn = (arg) => handler(ev, arg);
    fns.set(ev, fn);
    proc.on(ev, fn);
  }
  return () => {
    for (const [ev, fn] of fns) proc.removeListener(ev, fn);
    fns.clear();
  };
}
