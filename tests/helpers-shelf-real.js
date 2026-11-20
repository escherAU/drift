// DRIFT-9 S2: the REAL app on the library shelf, on a chosen clock, with a tap schedule, metered on the viewer's 18 Hz grid. This is what Ingrid's shelf.mjs did by hand, as a helper:
// createApp itself (startScreen library, the shipped cartridges, its own timer loop on the clock through the `timer` seam, the real renderer, a fake terminal, the bytes read back by an
// independent terminal reader, 256-colour output through the index the terminal was told to show), the right-arrow key pressed by schedule, and the screen read on the 18 Hz grid whatever
// the clock does. The first second (the library's fade-in) is not metered. Used by tests/shelf-clocks.test.js and tools/shelf-matrix.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { INSTALL_DIR } from '../src/cartridge/loader.js';
import { createScreen } from './helpers-ansi.js';
import { createFlashMeter, failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { rgbOf } from './helpers-flash-app.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';
import { createClock, VIEWER_HZ } from './helpers-clock.js';

export const SHELF_CLOCKS = ['grid', 'q156', 'jitter'];
export const SHELF_MODES = ['truecolor', '256'];
export const SHELF_SIZES = [[40, 10], [81, 24], [79, 25], [89, 40]];
export const SHELF_TAPS = ['held', 0.3, 0.44, 0.48, 0.7];
const RIGHT = '\x1b[C';
const DEF_FG = 0xcccccc, DEF_BG = 0x0c0c0c;

// press times in ms: 'held' is a key held down (the first press, then repeats every 33 ms from 0.5 s later for 3 s); a number is 14 taps that many seconds apart. All from 2 s.
export function shelfKeys(gap, { start = 2000, taps = 14 } = {}) {
  const keys = [];
  if (gap === 'held') { keys.push(start); for (let t = start + 500; t < start + 3500; t += 33) keys.push(t); } else for (let k = 0; k < taps; k++) keys.push(start + k * 1000 * Number(gap));
  return keys;
}

// -> { rep, nums (the five rules' worst, in per cent), fail (the rules that fail), paints (samples on which the app had written something), frames (metered), cursors (how many
// cartridges the cursor stood on), screen (the shell's screen at the end), first, last, keys }
export async function runShelf({ clock = 'grid', clockSeed = 1, mode = '256', cols = 81, rows = 24, gap = 'held', seed = 1, fps = VIEWER_HZ, start = 2000, taps = 14 } = {}) {
  const c = createClock({ mode: clock, seed: clockSeed });
  const stdout = fakeStdout({ columns: cols, rows }), stdin = fakeStdin(), proc = fakeProc();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-shelf-real-'));
  try {
    const app = createApp({
      stdin, stdout, stderr: fakeStderr(), proc, env: mode === 'truecolor' ? { COLORTERM: 'truecolor' } : {}, configPath: path.join(tmp, 'config.json'),
      dirs: [{ dir: INSTALL_DIR, trusted: true }], autoLoop: true, now: c.now, timer: c.timer, seed, fps, startScreen: { screen: 'library' },
    });
    app.start();
    const screen = createScreen(cols, rows), n = cols * rows;
    const meter = createFlashMeter(cols, rows, VIEWER_HZ);
    const keys = shelfKeys(gap, { start, taps });
    const first = app.getState().shell && app.getState().shell.cartridge;
    let paints = 0, frames = 0;
    const cursors = new Set(); // the cartridges the cursor has stood on (the shell's own state, read at every sample)
    await c.runUntil(keys[keys.length - 1] + 4000, {
      keys: keys.map((at) => ({ at, fn: () => stdin.emit('data', RIGHT) })),
      onSample: ({ k }) => {
        if (stdout.writes.length) paints++;
        const st = app.getState().shell;
        if (st && st.cartridge) cursors.add(st.cartridge);
        for (const w of stdout.writes.splice(0)) screen.feed(w);
        if (k < VIEWER_HZ) return;
        const f = { cols, rows, glyphs: new Uint32Array(n), fg: new Uint32Array(n), bg: new Uint32Array(n) };
        for (let q = 0; q < n; q++) { f.glyphs[q] = screen.glyphs[q]; f.fg[q] = rgbOf(screen.fg[q], DEF_FG); f.bg[q] = rgbOf(screen.bg[q], DEF_BG); }
        meter.push(f, undefined);
        frames++;
      },
    });
    const sh = app.getState().shell;
    const rep = meter.report();
    const pc = (x) => Math.round(x * 10000) / 100;
    const nums = { l1: pc(rep.l1.x1.worstFraction), l2: pc(rep.l2.x1.worstFraction), l3: pc(rep.l3.worstFraction), r: pc(rep.r.x1.worstFraction), c: pc(rep.c.worstFraction) };
    return { rep, nums, fail: failedRules(rep, { only: X1_RULE_IDS }), paints, frames, cursors: cursors.size, screen: sh && sh.screen, first, last: sh && sh.cartridge, keys: keys.length };
  } finally {
    try { proc.emit('exit'); } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// the seeds of case (size index si, tap index ti): the app's seed and the jitter clock's seed change from case to case
export const caseSeeds = (si, ti) => ({ seed: 1 + ((si + ti) % 3), clockSeed: 1 + ti + 5 * si });
export const caseKey = (clock, mode, cols, rows, tap) => `${clock} ${mode} ${cols}x${rows} tap ${tap}`;
export const showNums = (n) => `L1 ${n.l1.toFixed(2)} L2 ${n.l2.toFixed(2)} L3 ${n.l3.toFixed(2)} R ${n.r.toFixed(2)} C ${n.c.toFixed(2)}`;
