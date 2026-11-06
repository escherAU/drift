// The app loop: scenes -> composer -> renderer -> one stdout.write per frame.
// Every outside thing (streams, process, clock, config path, env) is injected
// so the same code runs against fakes in tests and in tools/measure.mjs.
import { SCENES, SCENE_IDS } from './scenes/index.js';
import { Scheduler, createComposer } from './compose.js';
import { createRenderer } from './renderer.js';
import { createTerminal, installGuards } from './term.js';
import { loadConfig, saveConfig, defaultConfigPath } from './config.js';
import { presetRGB, nextPreset, presetIndex, makePalette, detectColorMode, DEFAULT_PRESET } from './color.js';

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const DEFAULT_SPEED_INDEX = 3;
const DEFAULTS = { fps: 18, sceneSeconds: 180, fadeSeconds: 5, seed: 1 };

const HELP = `drift - calm ASCII visualiser for the terminal

usage: drift [options]

keys:  space next scene   + / - speed   p pause   c colour   q or Ctrl+C quit

options:
  --scene-seconds N   seconds per scene (default 180)
  --fade-seconds N    cross-fade length (default 5)
  --fps N             frames per second, 1-30 (default 18)
  --seed N            random seed for rain/ripples (default 1)
  --scene NAME|N      start on a scene (squiggle sunburst plasma ripples rain)
  --help              this text
`;

const num = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== null && v !== undefined ? Math.min(hi, Math.max(lo, n)) : dflt;
};

export function parseOptions(argv = [], env = {}) {
  const raw = {};
  const flags = ['scene-seconds', 'fade-seconds', 'fps', 'seed', 'scene'];
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { help = true; continue; }
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m && flags.includes(m[1])) raw[m[1]] = m[2] !== undefined ? m[2] : argv[++i];
  }
  const pick = (flag, envName) => (raw[flag] !== undefined ? raw[flag] : env[envName]);
  let startScene = 0;
  const sc = pick('scene', 'DRIFT_SCENE');
  if (sc !== undefined && sc !== '') {
    const byId = SCENE_IDS.indexOf(String(sc).toLowerCase());
    startScene = byId >= 0 ? byId : Math.max(0, Math.min(SCENE_IDS.length - 1, (Number(sc) | 0)));
  }
  return {
    help,
    fps: num(pick('fps', 'DRIFT_FPS'), 1, 30, DEFAULTS.fps),
    sceneSeconds: num(pick('scene-seconds', 'DRIFT_SCENE_SECONDS'), 0.5, 1e9, DEFAULTS.sceneSeconds),
    fadeSeconds: num(pick('fade-seconds', 'DRIFT_FADE_SECONDS'), 0.1, 600, DEFAULTS.fadeSeconds),
    seed: Math.floor(num(pick('seed', 'DRIFT_SEED'), -1e9, 1e9, DEFAULTS.seed)),
    startScene,
  };
}

export function createApp(o) {
  const { stdin, stdout } = o;
  const stderr = o.stderr || process.stderr;
  const proc = o.proc || process;
  const env = o.env || process.env;
  const scenes = o.scenes || SCENES;
  const fps = o.fps || DEFAULTS.fps;
  const interval = 1000 / fps;
  const now = o.now || (() => performance.now());
  const configPath = o.configPath !== undefined ? o.configPath : defaultConfigPath(env);
  const mode = o.colorMode || detectColorMode(env);
  const autoLoop = o.autoLoop !== false;

  const term = createTerminal({ stdin, stdout });
  const sched = new Scheduler({
    count: scenes.length,
    durationSec: o.sceneSeconds ?? DEFAULTS.sceneSeconds,
    fadeSec: o.fadeSeconds ?? DEFAULTS.fadeSeconds,
    start: o.startScene || 0,
  });
  const renderer = createRenderer();
  let { cols, rows } = term.size();
  const composer = createComposer({ scenes, cols, rows, seed: o.seed ?? DEFAULTS.seed });

  let colour = loadConfig(configPath).colour;
  if (presetIndex(colour) < 0) colour = DEFAULT_PRESET;
  let t = 0, speedIdx = DEFAULT_SPEED_INDEX, paused = false;
  let dirty = true, running = false, exited = false, timer = null, uninstall = null;
  let lastNow = 0, nextAt = 0, palette = null, exitDone = false;

  function paletteNow() {
    const rgb = presetRGB(colour, t);
    const key = `${mode}:${rgb[0]},${rgb[1]},${rgb[2]}`;
    if (!palette || palette.key !== key) palette = makePalette(rgb, mode);
    return palette;
  }

  function renderFrame() {
    const f = composer.frame(sched.state(), t);
    const out = renderer.render({ cols, rows, glyphs: f.glyphs, shades: f.shades, palette: paletteNow() });
    if (out) stdout.write(out);
    dirty = false;
  }

  function tick(dt) {
    if (!running) return;
    try {
      if (!paused && dt > 0) {
        const d = dt * SPEEDS[speedIdx];
        t += d;
        sched.advance(d);
      } else if (!dirty) {
        return; // frozen or no time passed: nothing to draw
      }
      if (stdout.writableNeedDrain) return; // terminal is behind: drop this frame, keep the diff state honest
      renderFrame();
    } catch (err) {
      quit(1, `drift: ${err && err.stack ? err.stack : err}\n`);
    }
  }

  function exitOnce(code) {
    if (exitDone) return;
    exitDone = true;
    proc.exit(code);
  }

  function quit(code = 0, errText) {
    if (exited) return;
    exited = true;
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
    if (uninstall) { uninstall(); uninstall = null; }
    term.leave(() => {
      if (errText) stderr.write(errText, () => exitOnce(code));
      else exitOnce(code);
    });
    // never hang on a stuck stream
    setTimeout(() => exitOnce(code), 750).unref();
  }

  function guard(reason, arg) {
    const text = () => `drift: ${reason}: ${arg && arg.stack ? arg.stack : arg}\n`;
    switch (reason) {
      case 'SIGINT': return quit(130);
      case 'SIGTERM': return quit(143);
      case 'SIGHUP': return quit(129);
      case 'SIGBREAK': return quit(131);
      case 'exit': term.leave(); return undefined;
      default: return quit(1, text());
    }
  }

  function handleKey(s) {
    if (!running || !s) return;
    if (s.charCodeAt(0) === 0x1b) return; // arrows and other escape sequences
    for (const ch of s) {
      if (!running) return;
      switch (ch) {
        case 'q': case 'Q': quit(0); return;
        case '\x03': quit(130); return;
        case ' ': sched.skip(); dirty = true; break;
        case '+': case '=': speedIdx = Math.min(SPEEDS.length - 1, speedIdx + 1); break;
        case '-': case '_': speedIdx = Math.max(0, speedIdx - 1); break;
        case 'p': case 'P': paused = !paused; break;
        case 'c': case 'C':
          colour = nextPreset(colour);
          saveConfig(configPath, { colour });
          dirty = true;
          break;
        default: break; // unknown keys are ignored
      }
    }
  }

  function onResize(c, r) {
    if (!running) return;
    try {
      cols = c; rows = r;
      composer.resize(c, r);
      renderer.invalidate();
      renderFrame();
    } catch (err) {
      quit(1, `drift: ${err && err.stack ? err.stack : err}\n`);
    }
  }

  function loop() {
    timer = null;
    if (!running) return;
    const n = now();
    let dt = (n - lastNow) / 1000;
    lastNow = n;
    if (dt > 0.25) dt = 0.25; // after a stall, do not leap
    tick(dt);
    if (!running) return;
    nextAt += interval;
    if (nextAt < n) nextAt = n + interval;
    timer = setTimeout(loop, Math.max(1, nextAt - now()));
  }

  function start() {
    if (!o.forceTTY && (!stdin.isTTY || !stdout.isTTY)) {
      stdout.write('drift needs an interactive terminal (stdin and stdout must be a TTY). Run it from Windows Terminal or a console window.\n', () => exitOnce(0));
      setTimeout(() => exitOnce(0), 750).unref();
      return false;
    }
    ({ cols, rows } = term.size());
    composer.resize(cols, rows);
    term.onKey(handleKey);
    term.onResize(onResize);
    uninstall = installGuards(proc, guard);
    term.enter();
    running = true;
    lastNow = now();
    nextAt = lastNow;
    if (autoLoop) timer = setTimeout(loop, 1);
    return true;
  }

  return {
    start, tick, quit,
    handleKey,
    getState: () => ({
      t, speed: SPEEDS[speedIdx], paused, colour, cols, rows,
      sceneIndex: sched.cur, fading: sched.fading, running,
    }),
  };
}

// Real entry point used by bin/drift.js.
export function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseOptions(argv, env);
  if (opts.help) { process.stdout.write(HELP); return; }
  const force = env.DRIFT_TEST_FORCE_TTY === '1'; // test hook, inert unless exactly "1"
  if (force) {
    // piped stdio has no size; give it one (and raw mode is simply skipped)
    if (!process.stdout.columns) process.stdout.columns = num(env.DRIFT_TEST_COLS, 10, 1000, 80);
    if (!process.stdout.rows) process.stdout.rows = num(env.DRIFT_TEST_ROWS, 5, 500, 24);
    const ms = Number(env.DRIFT_TEST_THROW_AFTER_MS);
    if (Number.isFinite(ms) && ms > 0) {
      setTimeout(() => { throw new Error(`DRIFT_TEST_THROW after ${ms} ms`); }, ms);
    }
  }
  const app = createApp({
    stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, proc: process, env,
    forceTTY: force, ...opts,
  });
  app.start();
}
