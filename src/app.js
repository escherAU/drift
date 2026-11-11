// The app loop: scenes -> composer -> renderer -> one stdout.write per frame.
// Every outside thing (streams, process, clock, config path, env) is injected
// so the same code runs against fakes in tests and in tools/measure.mjs.
//
// Four modes (src/modes.js). Calm is drift v1, untouched: field scenes, the calm
// composer and its slow cross-fade. The other three draw cell scenes (src/cells.js)
// and move between scenes with a 2 s per-cell dissolve.
import { SCENES, PLAYLISTS, findScene, allSceneIds } from './scenes/index.js';
import { Scheduler, createComposer } from './compose.js';
import { createCellComposer } from './cells.js';
import { createRenderer, SYNC_BEGIN, SYNC_END } from './renderer.js';
import { createTerminal, installGuards } from './term.js';
import { loadConfig, updateConfig, defaultConfigPath, loadExtras } from './config.js';
import {
  presetRGB, nextPreset, presetIndex, makePalette, detectColorMode, DEFAULT_PRESET,
  makeMultiPalette, makeTwoTone, nextChaosPalette,
} from './color.js';
import { KEY_TO_ENTRY, activeIn, HELP_OPEN_ACTIONS, cliKeysText, shellTokens } from './keymap.js';
import { drawHelp } from './overlay.js';
import { isMode, nextMode, MODE_LABELS } from './modes.js';
import { discoverCartridges, INSTALL_DIR, userDir } from './cartridge/loader.js';
import { createShell } from './shell/shell.js';

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const DEFAULT_SPEED_INDEX = 3;
// The cross-fade is long on purpose: at 5 s the busiest pairs changed 11-16% of
// the screen per frame; at 15 s the worst frame in the test sweep (seeds 1-3 x start
// times 8/40/100 s x the five adjacent pairs x 120x40 and 240x67) changes at most about
// 7.1% of cells, and the mean is about 1-3% (see tools/calm.mjs, tests/tools.test.js).
export const DEFAULT_FADE_SECONDS = 15;
// The other modes dissolve cell by cell over 2 s (never a whole-screen cut).
export const DISSOLVE_SECONDS = 2;
// Photosensitivity guard: the screen background flips between dark and light at most once
// per this many seconds (a flip asked for sooner is deferred, never dropped).
export const FLIP_WINDOW_SECONDS = 3;
const DEFAULTS = { fps: 18, sceneSeconds: 180, fadeSeconds: DEFAULT_FADE_SECONDS, seed: 1 };

// Palette entries the help panel uses in the single-hue palettes (calm, experimental).
const SINGLE_HUE_UI = { text: 15, dim: 6, head: 15 };

export function helpText() {
  return `drift - ASCII visualiser for the terminal (calm, chaos, high contrast, experimental)

usage: drift [options]

${cliKeysText()}
options:
  --scene-seconds N   seconds per scene (default 180)
  --fade-seconds N    calm cross-fade length (default ${DEFAULT_FADE_SECONDS}); other modes dissolve in ${DISSOLVE_SECONDS} s
  --fps N             frames per second, 1-30 (default 18)
  --seed N            random seed (default 1)
  --scene NAME|N      start on a scene, in its mode (${allSceneIds().join(' ')})
  --library           start in the cartridge library
  --cartridge ID      insert a cartridge at start ("last" = the one inserted last)
  --help              this text
`;
}

const num = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== null && v !== undefined ? Math.min(hi, Math.max(lo, n)) : dflt;
};

export function parseOptions(argv = [], env = {}) {
  const raw = {};
  const flags = ['scene-seconds', 'fade-seconds', 'fps', 'seed', 'scene', 'cartridge'];
  let help = false, library = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { help = true; continue; }
    if (a === '--library') { library = true; continue; }
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m && flags.includes(m[1])) raw[m[1]] = m[2] !== undefined ? m[2] : argv[++i];
  }
  const pick = (flag, envName) => (raw[flag] !== undefined ? raw[flag] : env[envName]);
  let startScene = 0, startMode;
  const sc = pick('scene', 'DRIFT_SCENE');
  if (sc !== undefined && sc !== '') {
    const found = findScene(String(sc));
    if (found) {
      startMode = found.mode; startScene = found.index;
    } else {
      const n = Number(sc);
      startScene = Math.max(0, Math.min(SCENES.length - 1, (n | 0)));
      if (Number.isFinite(n)) startMode = 'calm'; // a bare number counts calm scenes, as in v1
    }
  }
  return {
    help,
    fps: num(pick('fps', 'DRIFT_FPS'), 1, 30, DEFAULTS.fps),
    sceneSeconds: num(pick('scene-seconds', 'DRIFT_SCENE_SECONDS'), 0.5, 1e9, DEFAULTS.sceneSeconds),
    fadeSeconds: num(pick('fade-seconds', 'DRIFT_FADE_SECONDS'), 0.1, 600, DEFAULTS.fadeSeconds),
    seed: Math.floor(num(pick('seed', 'DRIFT_SEED'), -1e9, 1e9, DEFAULTS.seed)),
    startScene,
    startMode,
    // only present when asked for, so a plain launch's options are exactly what they were
    ...(library ? { library: true } : {}),
    ...(raw.cartridge !== undefined || argv.includes('--cartridge') ? { cartridge: raw.cartridge === undefined ? '' : String(raw.cartridge) } : {}),
  };
}

// ---- start screen: --library / --cartridge

export function defaultDirs(configPath) {
  const dirs = [{ dir: INSTALL_DIR, trusted: true }];
  if (typeof configPath === 'string' && configPath) dirs.push({ dir: userDir(configPath), trusted: false });
  return dirs;
}

// Text that came from the command line, safe to print: control characters (escape included) become '?'.
const printable = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 60);

// Decide the start screen BEFORE the terminal is touched. Sync, reads manifests only. Returns
// { ok: true, startScreen: null | { screen: 'library' } | { screen: 'cartridge', cartridge, skipBoot } }
// or { ok: false, message } (the caller prints it to stderr and exits 2, with no escape bytes).
// `--cartridge` wins over `--library`. A plain launch has neither and always starts Classic.
export function planStartup(opts, { dirs, configPath }) {
  const wantsCart = typeof opts.cartridge === 'string';
  if (!opts.library && !wantsCart) return { ok: true, startScreen: null };
  if (!wantsCart) return { ok: true, startScreen: { screen: 'library' } };
  let id = opts.cartridge;
  if (id === '') return { ok: false, message: 'drift: --cartridge needs a cartridge id (drift --library lists them)' };
  if (id === 'last') {
    const last = typeof configPath === 'string' && configPath ? loadExtras(configPath).lastCartridge : undefined;
    id = last || 'classic'; // nothing inserted yet: the library's own default, Classic
  }
  const { cartridges, errors } = discoverCartridges({ dirs });
  const cart = cartridges.find((c) => c.id === id);
  if (!cart) {
    const bad = errors.find((e) => String(e.where).split(/[\\/]/).pop() === id);
    if (bad) return { ok: false, message: `drift: cartridge '${printable(id)}' cannot be loaded: ${printable(bad.reason)}` };
    return { ok: false, message: `drift: no cartridge called '${printable(id)}' (drift --library lists them)` };
  }
  if (cart.locked) return { ok: false, message: `drift: cartridge '${printable(id)}' is locked: it is not ready yet` };
  return { ok: true, startScreen: { screen: 'cartridge', cartridge: id, skipBoot: false } };
}

export function createApp(o) {
  const { stdin, stdout } = o;
  const stderr = o.stderr || process.stderr;
  const proc = o.proc || process;
  const env = o.env || process.env;
  const playlists = o.playlists || PLAYLISTS;
  const scenes = o.scenes || playlists.calm;
  const fps = o.fps || DEFAULTS.fps;
  const interval = 1000 / fps;
  const now = o.now || (() => performance.now());
  const configPath = o.configPath !== undefined ? o.configPath : defaultConfigPath(env);
  const cmode = o.colorMode || detectColorMode(env); // truecolor | 256
  const autoLoop = o.autoLoop !== false;
  const seed = o.seed ?? DEFAULTS.seed;

  const term = createTerminal({ stdin, stdout });
  const renderer = createRenderer();
  let { cols, rows } = term.size();
  const composer = createComposer({ scenes, cols, rows, seed });
  const cellComps = {};

  // ONE config object for the whole run, so changing one setting never drops another.
  const cfg = loadConfig(configPath);
  if (presetIndex(cfg.colour) < 0) cfg.colour = DEFAULT_PRESET;
  // `want` is what the owner asked for; `shown` is what is on screen. They differ only while
  // a background flip is deferred by the photosensitivity guard.
  // `shell` is the console screen (cartridge library / running cartridge): false/null = Classic.
  const startScreen = o.startScreen || null;
  const want = { mode: isMode(o.startMode) ? o.startMode : cfg.mode, invert: cfg.invert, shell: startScreen ? startScreen.screen : null };
  const lightOf = (s) => !s.shell && s.mode === 'contrast' && s.invert;
  const shown = { mode: want.mode, light: lightOf(want), shell: !!startScreen };
  let wall = 0; // real seconds since start (not scaled by speed, not stopped by pause)
  let lastFlip = shown.light ? 0 : -Infinity;

  const scheds = {};
  function sched(mode) {
    if (!scheds[mode]) {
      const calm = mode === 'calm';
      const startsHere = (o.startMode || 'calm') === mode;
      scheds[mode] = new Scheduler({
        count: (calm ? scenes : playlists[mode]).length,
        durationSec: o.sceneSeconds ?? DEFAULTS.sceneSeconds,
        fadeSec: calm ? (o.fadeSeconds ?? DEFAULTS.fadeSeconds) : DISSOLVE_SECONDS,
        start: startsHere ? (o.startScene || 0) : 0,
      });
    }
    return scheds[mode];
  }
  function cells(mode) {
    if (!cellComps[mode]) cellComps[mode] = createCellComposer({ scenes: playlists[mode], cols, rows, seed });
    return cellComps[mode];
  }
  const listOf = (mode) => (mode === 'calm' ? scenes : playlists[mode]);
  sched(shown.mode);

  let t = 0, speedIdx = DEFAULT_SPEED_INDEX, paused = false, helpOpen = false;
  let dirty = true, running = false, exited = false, timer = null, uninstall = null;
  let lastNow = 0, nextAt = 0, palette = null, exitDone = false;
  let chaosPal = null, twoTone = null, lastFrame = null;
  // the console shell: created the first time it is needed (the library or a start screen)
  let shell = null, shellPal = null, runningResolve = null, runningPromise = null;
  const discoverDirs = o.dirs || defaultDirs(configPath);

  function paletteNow() {
    if (shown.mode === 'chaos') {
      if (!chaosPal || chaosPal.id !== cfg.chaosPalette) chaosPal = { id: cfg.chaosPalette, pal: makeMultiPalette(cfg.chaosPalette, cmode) };
      return chaosPal.pal;
    }
    if (shown.mode === 'contrast') {
      if (!twoTone || twoTone.light !== shown.light) twoTone = { light: shown.light, pal: makeTwoTone(shown.light, cmode) };
      return twoTone.pal;
    }
    const rgb = presetRGB(cfg.colour, t);
    const key = `${cmode}:${rgb[0]},${rgb[1]},${rgb[2]}`;
    if (!palette || palette.key !== key) palette = makePalette(rgb, cmode);
    return palette;
  }

  function sceneName() {
    const list = listOf(shown.mode);
    return list[sched(shown.mode).cur].id;
  }

  function renderFrame() {
    if (shown.shell && shell) return renderShellFrame();
    const sc = sched(shown.mode);
    const f = shown.mode === 'calm' ? composer.frame(sc.state(), t) : cells(shown.mode).frame(sc.state(), t);
    const pal = paletteNow();
    if (helpOpen) {
      drawHelp(f.glyphs, f.shades, cols, rows, {
        mode: shown.mode, modeName: MODE_LABELS[shown.mode], sceneName: sceneName(), ui: pal.ui || SINGLE_HUE_UI,
      });
    }
    lastFrame = f;
    const out = renderer.render({ cols, rows, glyphs: f.glyphs, shades: f.shades, palette: pal });
    // one write per frame; synchronized output (DEC 2026) so the terminal paints it atomically
    if (out) stdout.write(SYNC_BEGIN + out + SYNC_END);
    dirty = false;
  }

  // One console frame through the same renderer and the same synchronized write.
  function renderShellFrame() {
    const f = shell.frame();
    // a new palette with a different background needs a clean slate (the renderer's key change alone
    // would leave the old background in cells it does not redraw)
    if (shellPal && shellPal.key !== f.palette.key && (!!shellPal.bg !== !!f.palette.bg || shellPal.base !== f.palette.base)) renderer.invalidate();
    shellPal = f.palette;
    lastFrame = f;
    const out = renderer.render({ cols, rows, glyphs: f.glyphs, shades: f.shades, palette: f.palette });
    if (out) stdout.write(SYNC_BEGIN + out + SYNC_END);
    dirty = false;
  }

  function ensureShell(from) {
    if (shell) { shell.openLibrary(from); return; }
    const found = discoverCartridges({ dirs: discoverDirs });
    const extras = typeof configPath === 'string' && configPath ? loadExtras(configPath) : {};
    shell = createShell({
      cols, rows, cmode, seed, cartridges: found.cartridges, errors: found.errors, lastCartridge: extras.lastCartridge,
      from, start: startScreen && startScreen.screen === 'cartridge' ? startScreen : null, loadScenes: o.loadScenes,
      consts: { SPEEDS, DISSOLVE_SECONDS, DEFAULT_FADE_SECONDS },
      host: {
        quit: (code) => quit(code),
        persist: (patch) => persist(patch),
        leaveToClassic: () => { want.shell = null; settle(); },
      },
    });
    shell.whenRunning().then((v) => { if (runningResolve) runningResolve(v); }).catch(() => {});
  }

  // Put `want` on screen if the guard allows. A mode change that does not flip the background
  // happens at once; one that does (into or out of inverted high contrast, or `i`) waits for
  // the window and then lands exactly once.
  function settle() {
    const wantLight = lightOf(want);
    const wantShell = !!want.shell;
    if (shown.mode === want.mode && shown.light === wantLight && shown.shell === wantShell) return;
    if (wantLight !== shown.light) {
      if (wall - lastFlip < FLIP_WINDOW_SECONDS) return;
      lastFlip = wall;
    }
    const changedMode = shown.mode !== want.mode;
    const leavingShell = shown.shell && !wantShell;
    shown.mode = want.mode;
    shown.light = wantLight;
    shown.shell = wantShell;
    shellPal = null;
    sched(shown.mode);
    renderer.invalidate();
    if (changedMode || leavingShell) { // back from the console: fresh band memory / sim state, same mode and scene
      if (shown.mode === 'calm') composer.resize(cols, rows); // fresh band memory
      else cells(shown.mode).reset(t);
    }
    dirty = true;
  }

  // Save ONLY the field that changed, re-reading the file first: two windows sharing a config
  // file never overwrite each other's colour, mode, palette or polarity.
  function persist(patch) {
    updateConfig(configPath, patch);
  }

  function setMode(m) {
    if (!isMode(m) || m === want.mode) return;
    want.mode = m;
    persist({ mode: m });
    settle();
  }

  const ACTIONS = {
    quit: (_arg, key) => quit(key === '\x03' ? 130 : 0),
    modeNext: () => setMode(nextMode(want.mode)),
    modeJump: (arg) => setMode(arg),
    sceneNext: () => { sched(shown.mode).skip(); dirty = true; },
    colourNext: () => {
      if (want.mode === 'chaos') { cfg.chaosPalette = nextChaosPalette(cfg.chaosPalette); persist({ chaosPalette: cfg.chaosPalette }); }
      else { cfg.colour = nextPreset(cfg.colour); persist({ colour: cfg.colour }); }
      dirty = true;
    },
    invertToggle: () => { want.invert = !want.invert; persist({ invert: want.invert }); settle(); },
    speedUp: () => { speedIdx = Math.min(SPEEDS.length - 1, speedIdx + 1); },
    speedDown: () => { speedIdx = Math.max(0, speedIdx - 1); },
    pauseToggle: () => { paused = !paused; },
    helpToggle: () => { helpOpen = !helpOpen; dirty = true; },
    helpClose: () => { if (helpOpen) { helpOpen = false; dirty = true; } },
    libraryOpen: () => { ensureShell('classic'); want.shell = 'library'; settle(); },
  };

  function tick(dt) {
    if (!running) return;
    try {
      if (dt > 0) wall += dt;
      if (!helpOpen) settle();
      if (shown.shell && shell) {
        // the console owns the screen: Classic time does not advance while it does
        shell.tick(dt);
        if (shown.shell) {
          if (stdout.writableNeedDrain) return;
          if (dirty || shell.dirty()) renderFrame();
          return;
        }
      }
      if (!paused && !helpOpen && dt > 0) {
        const d = dt * SPEEDS[speedIdx];
        t += d;
        sched(shown.mode).advance(d);
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
    if (shell) shell.dispose();
    if (runningResolve) runningResolve(false);
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

  // Every key goes through the one KEYMAP table.
  function handleKey(s) {
    if (!running || !s) return;
    if (shown.shell && shell) {
      // the console reads arrows and Enter as tokens; this runs BEFORE Classic drops escape sequences
      try {
        for (const tok of shellTokens(s)) {
          if (!running || !(shown.shell && shell)) return;
          shell.key(tok);
        }
      } catch (err) {
        quit(1, `drift: ${err && err.stack ? err.stack : err}\n`);
      }
      return;
    }
    if (s.charCodeAt(0) === 0x1b && s.length > 1) return; // arrows and other escape sequences
    try {
      for (const ch of s) {
        if (!running) return;
        const e = KEY_TO_ENTRY.get(ch);
        if (!e) continue; // unknown keys are ignored
        if (helpOpen && !HELP_OPEN_ACTIONS.includes(e.action)) continue; // help open: only h / Esc / q
        if (!activeIn(e, want.mode)) continue; // not a key in this mode (c in high contrast, i elsewhere)
        ACTIONS[e.action](e.arg, ch);
      }
    } catch (err) {
      quit(1, `drift: ${err && err.stack ? err.stack : err}\n`);
    }
  }

  function onResize(c, r) {
    if (!running) return;
    try {
      cols = c; rows = r;
      composer.resize(c, r);
      for (const m of Object.keys(cellComps)) cellComps[m].resize(c, r);
      if (shell) shell.resize(c, r);
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
    for (const m of Object.keys(cellComps)) cellComps[m].resize(cols, rows);
    if (startScreen) ensureShell(null);
    term.onKey(handleKey);
    term.onResize(onResize);
    term.onEnd(() => quit(0)); // input closed: nobody can press q any more
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
    actions: ACTIONS,
    // a copy of the last frame drawn (help panel included), for tests and captures
    screenshot: () => (lastFrame ? { cols, rows, glyphs: lastFrame.glyphs.slice(), shades: lastFrame.shades.slice() } : null),
    getState: () => ({
      t, speed: SPEEDS[speedIdx], paused, colour: cfg.colour, cols, rows,
      sceneIndex: sched(shown.mode).cur, fading: sched(shown.mode).fading, running,
      mode: shown.mode, sceneId: sceneName(), help: helpOpen, invert: want.invert, light: shown.light,
      chaosPalette: cfg.chaosPalette,
      shell: shown.shell && shell ? shell.state() : null,
    }),
    // resolves true when a cartridge is running (menu or not), false if the app quits first
    whenRunning: () => {
      if (!runningPromise) runningPromise = new Promise((res) => { runningResolve = res; if (exited) res(false); });
      return runningPromise;
    },
  };
}

// Real entry point used by bin/drift.js.
// `io` is for tests: stderr, exit, configPath and dirs can be injected; the real entry passes nothing.
export function main(argv = process.argv.slice(2), env = process.env, io = {}) {
  const opts = parseOptions(argv, env);
  if (opts.help) { process.stdout.write(helpText()); return; }
  // --library / --cartridge: decide BEFORE the terminal is touched; a bad id is exit 2 with plain text
  const configPath = io.configPath !== undefined ? io.configPath : defaultConfigPath(env);
  const dirs = io.dirs || defaultDirs(configPath);
  const plan = planStartup(opts, { dirs, configPath });
  if (!plan.ok) {
    const err = io.stderr || process.stderr;
    const exit = io.exit || ((c) => process.exit(c));
    let done = false;
    const fin = () => { if (!done) { done = true; exit(2); } };
    err.write(plan.message + '\n', fin);
    setTimeout(fin, 500).unref();
    return;
  }
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
    forceTTY: force, ...opts, configPath, dirs, startScreen: plan.startScreen,
  });
  app.start();
}
