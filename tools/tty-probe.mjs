// tty-probe: how fast does YOUR terminal take the worst frames drift can send, and how long does q take when it is behind?
//
//   node tools/tty-probe.mjs [--seconds 20] [--fps 18] [--cols N] [--rows N]
//
// Run it in the terminal you watch drift on, at the size you run it at (the size is read from the terminal; --cols and --rows override it, for testing).
// It does what the app does: the alternate screen and raw mode (ENTER and LEAVE from src/term.js), one write per frame inside the synchronised-output
// markers (SYNC_BEGIN and SYNC_END from src/renderer.js), and, like the app, it DROPS a tick's frame while the stream still reports writableNeedDrain.
//
// Every frame changes EVERY cell: a truecolor foreground and background in each cell (each channel moves every frame) and a different glyph, so the
// terminal has to parse and paint the whole screen 18 times a second. (8 such frames are built before the run starts and sent in turn, so making them
// costs the event loop nothing while it is being measured.) At 280x70 a frame is 600 to 700 KB. That is far worse than any scene
// (drift sends the cells that changed), on purpose: it finds the edge.
//
// While it runs the screen is the probe's, so the once-a-second lines are kept and printed AFTER the terminal is restored. Press q (or Ctrl+C) at any
// moment, or wait for --seconds: the time from that key (or the end of the run) to the moment the restore write is confirmed is "quitMs". Then the
// probe goes back into the alternate screen, writes 5 full frames back to back without waiting (a flood: about 3 MB queued) and quits again: "flood5 quitMs"
// is how long a q takes with that much picture ahead of it, and restored=no means the restore write was not confirmed in 15 s.
//
// Reading loopDelayMs: on Windows the timer ticks every 15.6 ms, so a quiet machine reads p50 near 16 and p99 a little above; what matters is a p99 or a max far over that.
//
// The terminal is restored on every way out: q, the end of the run, Ctrl+C, SIGINT, SIGTERM, SIGHUP, an uncaught error.
//
// Last lines (copy them back, they are all that is needed):
//   PROBE size=<cols>x<rows> frameBytes=<n>
//   PROBE seconds=<n> frames=<n> bytes=<n>
//   PROBE writeFalse=<n> needDrainTicks=<n> maxWritableLength=<n>
//   PROBE loopDelayMs p50=<x> p99=<x> max=<x>
//   PROBE quitMs=<n>
//   PROBE flood5 quitMs=<n> restored=yes|no
//
// run({ stdout, stdin, proc, now, setTimeout, clearTimeout, loopDelay, print, ... }) is the whole probe; the command line below is a thin wrapper. The tests
// (tests/tty-probe.test.js) call run() with a fake terminal and mock timers.
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { ENTER, LEAVE } from '../src/term.js';
import { SYNC_BEGIN, SYNC_END } from '../src/renderer.js';

export const GLYPHS = [0x2580, 0x2584, 0x2588, 0x258c, 0x2590, 0x2591, 0x2592, 0x2593].map((c) => String.fromCharCode(c));
export const FLOOD_FRAMES = 5;
export const RING = 8; // frames built before the run starts and sent in turn: building one costs ~16 ms at 280x70, which would colour the loop-delay reading
export const DEADLINE_MS = 15000; // how long the probe waits for a restore write to be confirmed before it says so and stops waiting

// Per-cell starting values (a fixed pseudo-random fill) so that frame n and frame n + 1 differ in EVERY cell: each colour channel moves by an odd
// step (which is never 0 modulo 256) and the glyph moves one place in a list of 8.
export function makeFrames(cols, rows) {
  const n = cols * rows;
  const base = new Uint8Array(n * 6);
  let x = 0x9e3779b1;
  for (let i = 0; i < base.length; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; base[i] = x >>> 24; }
  const STEP = [37, 59, 83, 41, 67, 97]; // fg r g b, bg r g b
  return function frame(k) {
    const parts = new Array(rows);
    for (let y = 0; y < rows; y++) {
      let s = `\x1b[${y + 1};1H`;
      for (let col = 0; col < cols; col++) {
        const i = y * cols + col, b = i * 6;
        const c = (j) => (base[b + j] + k * STEP[j]) & 255;
        s += `\x1b[38;2;${c(0)};${c(1)};${c(2)};48;2;${c(3)};${c(4)};${c(5)}m${GLYPHS[(i + k) & 7]}`;
      }
      parts[y] = s;
    }
    return SYNC_BEGIN + parts.join('') + '\x1b[0m' + SYNC_END;
  };
}

const ms = (ns) => (Number.isFinite(ns) && ns > 0 && ns < 1e15 ? ns / 1e6 : 0);
const fix = (v, d = 1) => Number(v).toFixed(d);

export function run(o = {}) {
  const stdout = o.stdout || process.stdout, stdin = o.stdin || process.stdin, proc = o.proc || process;
  const now = o.now || (() => performance.now());
  const setT = o.setTimeout || ((fn, d) => globalThis.setTimeout(fn, d));
  const clearT = o.clearTimeout || ((t) => globalThis.clearTimeout(t));
  const seconds = Number.isFinite(o.seconds) && o.seconds > 0 ? o.seconds : 20;
  const fps = Number.isFinite(o.fps) && o.fps >= 1 && o.fps <= 120 ? o.fps : 18;
  const cols = o.cols > 0 ? Math.floor(o.cols) : Number(stdout.columns) > 0 ? Math.floor(stdout.columns) : 80;
  const rows = o.rows > 0 ? Math.floor(o.rows) : Number(stdout.rows) > 0 ? Math.floor(stdout.rows) : 24;
  const deadline = o.deadlineMs || DEADLINE_MS;
  const makeLoop = o.loopDelay || (() => monitorEventLoopDelay({ resolution: 10 }));
  const lines = []; // the per-second lines and the summary, printed after the restore
  const print = o.print || ((line) => stdout.write(line + '\n'));
  const gen = makeFrames(cols, rows);
  const ring = Array.from({ length: RING }, (_, i) => gen(i));
  const frameAt = (n) => ring[n % RING]; // consecutive frames still differ in every cell, the wrap included
  const interval = 1000 / fps;

  return new Promise((resolve) => {
    const sec = makeLoop(), all = makeLoop();
    const T = { frames: 0, bytes: 0, writeFalse: 0, needDrain: 0, maxWL: 0 }; // totals
    let S = { bytes: 0, writeFalse: 0, needDrain: 0, maxWL: 0 }; // this second
    let phase = 'run', k = 0, timer = null, finished = false, inAlt = false, rawOn = false;
    let startedAt = 0, secondsDone = 0, steadySeconds = 0, frameBytes = 0;
    let quitMs = null, quitConfirmed = false, quitFrom = 'a key', floodMs = null, floodRestored = false;
    const timers = new Set();
    const after = (d, fn) => { const t = setT(() => { timers.delete(t); fn(); }, d); timers.add(t); return t; };
    const cancel = (t) => { clearT(t); timers.delete(t); };

    const onData = (d) => {
      if (phase !== 'run') return;
      const s = typeof d === 'string' ? d : String(d);
      if (/[qQ\x03]/.test(s)) { quitFrom = 'a key'; endRun(now()); }
    };
    const onEnd = () => { if (phase === 'run') { quitFrom = 'the input closing'; endRun(now()); } };

    function enter() {
      stdout.write(ENTER);
      inAlt = true;
      if (typeof stdin.setRawMode === 'function') { stdin.setRawMode(true); rawOn = true; }
      if (typeof stdin.setEncoding === 'function') stdin.setEncoding('utf8');
      stdin.on('data', onData);
      stdin.on('end', onEnd);
      if (typeof stdin.resume === 'function') stdin.resume();
    }
    // The restore path (the app's: listeners off, raw mode off, input paused, then LEAVE with a callback). cb(confirmed) fires on the write's callback,
    // or with false after the deadline if the stream never calls back.
    function restore(cb) {
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      if (typeof stdin.setRawMode === 'function' && rawOn) { stdin.setRawMode(false); rawOn = false; }
      if (typeof stdin.pause === 'function') stdin.pause();
      inAlt = false;
      let done = false;
      const fin = (confirmed) => { if (done) return; done = true; cancel(wd); cb(confirmed); };
      const wd = after(deadline, () => fin(false));
      stdout.write(LEAVE, () => fin(true));
    }

    function pushSecond(label) {
      const line = `[${String(label).padStart(3)} s] bytes=${S.bytes} writeFalse=${S.writeFalse} needDrainTicks=${S.needDrain} maxWritableLength=${S.maxWL} loopDelayMs p50=${fix(ms(sec.percentile(50)))} p99=${fix(ms(sec.percentile(99)))} max=${fix(ms(sec.max))}`;
      lines.push(line);
      S = { bytes: 0, writeFalse: 0, needDrain: 0, maxWL: 0 };
      if (typeof sec.reset === 'function') sec.reset();
    }

    function writeFrame(n) {
      const text = frameAt(n);
      const len = Buffer.byteLength(text);
      if (!frameBytes) frameBytes = len;
      const ok = stdout.write(text);
      T.frames++; T.bytes += len; S.bytes += len;
      if (ok === false) { T.writeFalse++; S.writeFalse++; }
      const wl = Number(stdout.writableLength) || 0;
      if (wl > T.maxWL) T.maxWL = wl;
      if (wl > S.maxWL) S.maxWL = wl;
    }

    function tick() {
      timer = null;
      if (phase !== 'run') return;
      const t = now();
      if (stdout.writableNeedDrain) { T.needDrain++; S.needDrain++; } else writeFrame(k++);
      const wl = Number(stdout.writableLength) || 0;
      if (wl > T.maxWL) T.maxWL = wl;
      if (wl > S.maxWL) S.maxWL = wl;
      const elapsed = (t - startedAt) / 1000;
      while (secondsDone + 1 <= elapsed && secondsDone + 1 <= seconds) { secondsDone++; pushSecond(secondsDone); }
      if (elapsed >= seconds) { quitFrom = 'the end of the run'; endRun(t); return; }
      nextAt += interval;
      if (nextAt < t) nextAt = t + interval;
      timer = after(Math.max(1, nextAt - now()), tick);
    }
    let nextAt = 0;

    // the end of the steady phase (a key, the end of the run): time the restore from here, then flood
    function endRun(t0) {
      if (phase !== 'run') return;
      phase = 'quit';
      steadySeconds = (t0 - startedAt) / 1000;
      if (timer) { cancel(timer); timer = null; }
      while (secondsDone < Math.floor(steadySeconds)) { secondsDone++; pushSecond(secondsDone); }
      restore((confirmed) => {
        if (finished) return;
        quitMs = Math.round(now() - t0);
        quitConfirmed = confirmed;
        flood();
      });
    }

    function flood() {
      phase = 'flood';
      enter();
      for (let i = 0; i < FLOOD_FRAMES; i++) writeFrame(k++); // back to back: nothing between the writes
      const t1 = now();
      restore((confirmed) => {
        if (finished) return;
        floodMs = Math.round(now() - t1);
        floodRestored = confirmed;
        finish(0);
      });
    }

    function summary() {
      const out = [];
      out.push(`PROBE size=${cols}x${rows} frameBytes=${frameBytes}`);
      out.push(`PROBE seconds=${fix(steadySeconds)} frames=${T.frames} bytes=${T.bytes}`);
      out.push(`PROBE writeFalse=${T.writeFalse} needDrainTicks=${T.needDrain} maxWritableLength=${T.maxWL}`);
      out.push(`PROBE loopDelayMs p50=${fix(ms(all.percentile(50)))} p99=${fix(ms(all.percentile(99)))} max=${fix(ms(all.max))}`);
      out.push(`PROBE quitMs=${quitMs === null ? 'none' : quitMs}`);
      out.push(`PROBE flood5 quitMs=${floodMs === null ? 'none' : floodMs} restored=${floodRestored ? 'yes' : 'no'}`);
      return out;
    }

    function finish(code, errText) {
      if (finished) return;
      finished = true;
      for (const t of [...timers]) cancel(t);
      if (timer) { clearT(timer); timer = null; }
      sec.disable(); all.disable();
      for (const [ev, fn] of guards) proc.removeListener(ev, fn);
      if (errText) lines.push(errText);
      if (phase === 'run' && !quitConfirmed && quitMs === null) lines.push('NOTE the run was cut short before the quit was timed');
      if (quitMs !== null && !quitConfirmed) lines.push(`NOTE the restore write was not confirmed within ${deadline} ms; quitMs is the wait, not a measurement`);
      if (floodMs !== null && !floodRestored) lines.push(`NOTE the flood restore was not confirmed within ${deadline} ms`);
      if (quitMs !== null) lines.push(`NOTE quitMs is timed from ${quitFrom}`);
      const sum = summary();
      for (const l of lines) print(l);
      for (const l of sum) print(l);
      resolve({ code, lines: [...lines], summary: sum, totals: { ...T }, quitMs, floodMs, floodRestored, frameBytes });
    }

    // every way out restores the terminal first
    function bail(reason, code, errText) {
      if (finished) return;
      if (timer) { cancel(timer); timer = null; }
      phase = 'bail';
      if (inAlt) {
        stdin.removeListener('data', onData);
        stdin.removeListener('end', onEnd);
        if (typeof stdin.setRawMode === 'function' && rawOn) { stdin.setRawMode(false); rawOn = false; }
        inAlt = false;
        let done = false;
        const go = () => { if (done) return; done = true; finish(code, errText); };
        stdout.write(LEAVE, go);
        after(Math.min(deadline, 750), go);
      } else finish(code, errText);
      void reason;
    }
    const guards = new Map();
    for (const [ev, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129], ['uncaughtException', 1], ['unhandledRejection', 1]]) {
      const fn = (arg) => bail(ev, code, code === 1 ? `PROBE error: ${arg && arg.stack ? arg.stack : arg}` : undefined);
      guards.set(ev, fn);
      proc.on(ev, fn);
    }

    sec.enable(); all.enable();
    startedAt = now();
    nextAt = startedAt;
    enter();
    timer = after(1, tick);
  });
}

export function parseArgs(argv) {
  const o = {};
  const take = (name) => argv.findIndex((a) => a === name || a.startsWith(name + '='));
  for (const [flag, key] of [['--seconds', 'seconds'], ['--fps', 'fps'], ['--cols', 'cols'], ['--rows', 'rows']]) {
    const i = take(flag);
    if (i < 0) continue;
    const a = argv[i];
    const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[i + 1];
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) o[key] = n;
  }
  o.help = argv.includes('--help') || argv.includes('-h');
  return o;
}

export const HELP = `tty-probe - how fast does this terminal take full-colour frames, and how long does q take when it is behind?

usage: node tools/tty-probe.mjs [--seconds 20] [--fps 18] [--cols N] [--rows N]

Press q (or Ctrl+C) at any moment, or wait. The lines to send back are the PROBE lines at the end.
`;

async function cli() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { process.stdout.write(HELP); return; }
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write('tty-probe needs an interactive terminal (stdin and stdout must be a TTY).\n');
    process.exit(2);
  }
  const r = await run(o);
  // leave through the stream's own callback, with the same backstop the app uses
  let done = false;
  const exit = () => { if (!done) { done = true; process.exit(r.code); } };
  process.stdout.write('', exit);
  setTimeout(exit, 750).unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli();
