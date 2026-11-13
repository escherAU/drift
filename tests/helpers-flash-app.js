// DRIFT-8 r2: the flash meter watching the REAL app. Everything the dissolve tests did before this replayed a pair of scenes from a fresh composer at seed 1;
// that does not reproduce what the app holds when a dissolve arrives (the cell composer's per-scene start times, the scene clock t, the colour clock tc, the seed,
// the renderer's diffing and the 256-colour reduction). This drives createApp itself: a fake terminal, a fake clock (one app.tick(1/18) per frame, as the loop
// would), real key presses (the `+` key to reach 4x), the bytes the renderer writes read back through an independent terminal reader (tests/helpers-ansi.js), and
// those screens fed to the flash meter with the full rule set (L1, L2, L3, R, C). 256-colour runs read the index the terminal was told to show.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp as realCreateApp } from '../src/app.js';
import { INSTALL_DIR as REAL_INSTALL_DIR } from '../src/cartridge/loader.js';
import { pathToFileURL } from 'node:url';
import { mock } from 'node:test';
import { createScreen, COLOUR_256, COLOUR_BASIC } from './helpers-ansi.js';
import { createFlashMeter } from './helpers-flash.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';

export const APP_FPS = 18;
const DEF_FG = 0xcccccc, DEF_BG = 0x0c0c0c;
const CAMPBELL = [0x0c0c0c, 0xc50f1f, 0x13a10e, 0xc19c00, 0x0037da, 0x881798, 0x3a96dd, 0xcccccc, 0x767676, 0xe74856, 0x16c60c, 0xf9f1a5, 0x3b78ff, 0xb4009e, 0x61d6d6, 0xf2f2f2];
const XC = [0, 95, 135, 175, 215, 255];
// the xterm-256 palette an emulator draws for an index (0-15 as Windows Terminal's default scheme)
export function xterm256(i) {
  if (i < 16) return CAMPBELL[i];
  if (i < 232) { const k = i - 16; return (XC[Math.floor(k / 36)] << 16) | (XC[Math.floor(k / 6) % 6] << 8) | XC[k % 6]; }
  const g = 8 + (i - 232) * 10; return (g << 16) | (g << 8) | g;
}
const rgbOf = (v, dflt) => (v === -1 ? dflt : (v & COLOUR_256) === COLOUR_256 && v < 0x2000000 ? xterm256(v & 255) : (v & COLOUR_BASIC) === COLOUR_BASIC ? CAMPBELL[(v & 255) % 16] : v);

// DRIFT-8 r5: how a run advances the app one frame of the requested rate. By default app.tick(1 / fps), as the earlier arms did. With viaLoop the app's own timer loop runs
// (autoLoop on, a fake clock the helper advances 1 ms at a time, setTimeout mocked), which is how the real app is driven: its schedule, its cap on the paint rate and its
// dt are the shipped ones, and the meter still reads one screen per 1 / fps of the fake clock (a screen that was not repainted is read again, as a viewer sees it).
function makeDriver({ viaLoop, fps, stepMs = 0.05 }) {
  const state = { ms: 0 };
  if (viaLoop) mock.timers.enable({ apis: ['setTimeout'] });
  return {
    now: () => state.ms,
    advance(app, k) {
      if (!viaLoop) { app.tick(1 / fps); return; }
      const target = ((k + 1) * 1000) / fps;
      while (state.ms < target - 1e-9) { const d = Math.min(stepMs, target - state.ms); state.ms += d; mock.timers.tick(d); }
    },
    done() { if (viaLoop) mock.timers.reset(); },
  };
}

// The keys a user presses: `+` four times (speed 1x -> 4x, SPEEDS has 1, 2, 4... see src/shell), 0.2 s apart, one second into the running program.
export const PLAN_4X = [{ atRunning: 1, key: '+' }, { atRunning: 1.2, key: '+' }, { atRunning: 1.4, key: '+' }, { atRunning: 1.6, key: '+' }];
export const PLAN_1X = [];

// Runs the 9000 in the app for `seconds` of fake clock and returns one entry per dissolve between scenes. The shell does not publish its scene clock, so a
// dissolve is found by the scene it shows changing (sceneId is the scene dissolving AWAY, so it changes the frame the dissolve ends). The meter is fed, from a ring
// of the screens just shown, from `lead` real seconds before the dissolve starts (the dissolve lasts `fade` real seconds from 1x up) to `tail` real seconds after it
// ends, a fresh meter per dissolve. `speed` is the speed the plan reaches; it only sizes the ring: whether the app really ran at that speed is MEASURED from the
// real time between switches ((hold + fade) / speed), returned as `sinceLast`.
export async function runAppDissolves({ cols = 80, rows = 24, mode = 'truecolor', seed = 1, seconds = 100, plan = PLAN_4X, speed = 4, lead = 4, tail = 4, fade = 2, count = Infinity, root = null, fps = APP_FPS, viaLoop = false, stepMs = 0.05 } = {}) {
  // fps: the frame rate the user asked for (--fps); the app is told it and ticked at it, and the meter reads every tick (DRIFT-8 r5)
  const drv = makeDriver({ viaLoop, fps, stepMs });
  // root: a copy of the tree (src/ and cartridges/) to run instead of this one; the mutation test runs the app with the fix taken out
  const createApp = root ? (await import(pathToFileURL(path.join(root, "src", "app.js")).href)).createApp : realCreateApp;
  const INSTALL_DIR = root ? path.join(root, "cartridges") : REAL_INSTALL_DIR;
  const stdout = fakeStdout({ columns: cols, rows });
  const stdin = fakeStdin(), stderr = fakeStderr(), proc = fakeProc();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-flash-app-'));
  const env = mode === 'truecolor' ? { COLORTERM: 'truecolor' } : {};
  const app = createApp({
    stdin, stdout, stderr, proc, env, configPath: path.join(tmp, 'config.json'), dirs: [{ dir: INSTALL_DIR, trusted: true }],
    autoLoop: viaLoop, now: drv.now, seed, fps, startScreen: { screen: 'cartridge', cartridge: 'driftman-9000', skipBoot: false },
  });
  const out = [];
  try {
    app.start();
    const screen = createScreen(cols, rows);
    const n = cols * rows;
    const total = Math.round(seconds * fps);
    const dissolveFrames = Math.ceil((fade / Math.min(speed, 1)) * fps); // a dissolve lasts its fade seconds of real time from 1x up (src/shell/runtime.js)
    const cap = Math.round(lead * fps) + dissolveFrames;
    const ring = [];
    const grab = () => {
      const f = ring.length >= cap ? ring.shift() : { glyphs: new Uint32Array(n), fg: new Uint32Array(n), bg: new Uint32Array(n) };
      for (let j = 0; j < n; j++) { f.glyphs[j] = screen.glyphs[j]; f.fg[j] = rgbOf(screen.fg[j], DEF_FG); f.bg[j] = rgbOf(screen.bg[j], DEF_BG); }
      ring.push(f);
      return f;
    };
    const shot = (f) => ({ cols, rows, glyphs: f.glyphs, fg: f.fg, bg: f.bg });
    const mean = (f) => { let r = 0, g = 0, b = 0; for (let j = 0; j < n; j++) { const c = f.bg[j]; r += c >> 16; g += (c >> 8) & 255; b += c & 255; } return [r / n, g / n, b / n].map((v) => Math.round(v * 10) / 10); };
    let runningAt = null, prevId = null, lastSwitch = null, open = null, k = 0, speedMax = 0;
    for (; k < total && !proc.exits.length && out.length < count; k++) {
      for (const p of plan) {
        const at = runningAt !== null ? runningAt + Math.round(p.atRunning * fps) : -1;
        if (at === k) stdin.emit('data', p.key);
      }
      drv.advance(app, k);
      for (const w of stdout.writes.splice(0)) screen.feed(w);
      if (k % 8 === 0) await new Promise((r) => setImmediate(r)); // the cartridge's scenes load on a promise
      const st = app.getState();
      const sh = st.shell;
      if (!sh || sh.screen !== 'running') continue;
      if (runningAt === null) runningAt = k;
      const f = grab();
      if (open) {
        open.meter.push(shot(f), undefined);
        open.frames++;
        if (++open.after >= Math.round(tail * fps)) { open.sigAfter = mean(f); out.push(finish(open)); open = null; }
      }
      const id = sh.sceneId;
      if (prevId !== null && id && id !== prevId) {
        const meter = createFlashMeter(cols, rows, fps);
        for (const r of ring) meter.push(shot(r), undefined); // the lead, the dissolve and (this frame) its last frame
        open = { from: prevId, to: id, switchFrame: k, sinceLast: lastSwitch === null ? null : (k - lastSwitch) / fps, meter, frames: ring.length, after: 0, sigBefore: mean(ring[0]), sigAt: mean(f), dissolveFrames, leadFrames: ring.length - dissolveFrames, runningFor: (k - runningAt) / fps };
        lastSwitch = k;
      } else if (prevId === null && id) lastSwitch = k; // the first scene: switches are timed from here only for the interval of the NEXT one, which includes the speed ramp
      if (id) prevId = id;
    }
    return { dissolves: out, frames: k, runningAt, finalState: app.getState().shell };
  } finally {
    try { proc.emit('exit'); } catch { /* ignore */ }
    drv.done();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function finish(o) {
  return { from: o.from, to: o.to, switchFrame: o.switchFrame, sinceLast: o.sinceLast, frames: o.frames, leadFrames: o.leadFrames, dissolveFrames: o.dissolveFrames, sigBefore: o.sigBefore, sigAt: o.sigAt, sigAfter: o.sigAfter, report: o.meter.report() };
}

// DRIFT-8 r4: the same app, but a window around a moment you choose instead of around a dissolve. `keys` are { atRunning, key } presses (seconds into the running program,
// as in `plan`); the window is [pickAt - before, pickAt + after] seconds into the running program; the scene shown is read every frame (ids[k] is the sceneId at frame k since
// running began, null while there is none). Used for the menu jump, where the dissolve is the program-switch one and does not show up as a scene change on its own schedule.
export async function runAppWindow({ cols = 80, rows = 24, mode = 'truecolor', seed = 1, keys = [], pickAt, before = 6, after = 4, fps = APP_FPS, viaLoop = false, stepMs = 0.05 } = {}) {
  const drv = makeDriver({ viaLoop, fps, stepMs });
  const stdout = fakeStdout({ columns: cols, rows });
  const stdin = fakeStdin(), stderr = fakeStderr(), proc = fakeProc();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-flash-app-'));
  const env = mode === 'truecolor' ? { COLORTERM: 'truecolor' } : {};
  const app = realCreateApp({
    stdin, stdout, stderr, proc, env, configPath: path.join(tmp, 'config.json'), dirs: [{ dir: REAL_INSTALL_DIR, trusted: true }],
    autoLoop: viaLoop, now: drv.now, seed, fps, startScreen: { screen: 'cartridge', cartridge: 'driftman-9000', skipBoot: false },
  });
  const ids = [];
  try {
    app.start();
    const screen = createScreen(cols, rows);
    const n = cols * rows;
    const total = Math.round((pickAt + after) * fps) + 1;
    const lo = Math.round((pickAt - before) * fps);
    let runningAt = null, meter = null, shown = 0;
    for (let k = 0; k < 1e6 && !proc.exits.length; k++) {
      const rel = runningAt === null ? -1 : k - runningAt;
      if (rel >= 0) for (const p of keys) if (rel === Math.round(p.atRunning * fps)) stdin.emit('data', p.key);
      drv.advance(app, k);
      for (const w of stdout.writes.splice(0)) screen.feed(w);
      if (k % 8 === 0) await new Promise((r) => setImmediate(r));
      const sh = app.getState().shell;
      if (!sh || sh.screen !== 'running') continue;
      if (runningAt === null) runningAt = k;
      const j = k - runningAt;
      ids[j] = sh.sceneId || null;
      if (j >= lo) {
        if (!meter) meter = createFlashMeter(cols, rows, fps);
        const f = { cols, rows, glyphs: new Uint32Array(n), fg: new Uint32Array(n), bg: new Uint32Array(n) };
        for (let q = 0; q < n; q++) { f.glyphs[q] = screen.glyphs[q]; f.fg[q] = rgbOf(screen.fg[q], DEF_FG); f.bg[q] = rgbOf(screen.bg[q], DEF_BG); }
        meter.push(f, undefined); shown++;
      }
      if (j + 1 >= total) break;
    }
    return { report: meter.report(), frames: shown, ids, runningAt };
  } finally {
    try { proc.emit('exit'); } catch { /* ignore */ }
    drv.done();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
