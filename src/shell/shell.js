// The console shell (DRIFT-4): the screen state machine for the cartridge library and running
// cartridges. It owns no terminal, no timer and no process exit: createApp owns those and calls
// tick(dt), key(token), resize(c, r) and frame(), so every exit path restores the terminal exactly.
//
//   screens    library -> insert -> boot -> running      (error from boot; eject back to library)
//   library    Enter inserts (locked cartridges dip and spring back); Esc / l go back to the screen
//              that opened the library (Classic), or do nothing when the library was the start screen
//   insert     INSERT_END seconds; the scenes start loading when it begins
//   boot       waits at the end of the progress bar until the load finishes; any key but q skips
//   error      a load failure: 4 s card, then the library
//   eject      the insert animation played backwards in 1.6 s
//   running    the cartridge runtime (menu, programs, help)
//
// A late or failed load never writes after dispose(): every promise checks `disposed` first and has a catch.
import { SHELL_KEYS, SHELL_HELP_OPEN_ACTIONS, shellHelpLines } from '../keymap.js';
import { drawHelp } from '../overlay.js';
import { makeSkinPalette } from '../cartridge/palette.js';
import { loadScenes as defaultLoadScenes } from '../cartridge/loader.js';
import { parseHex, sgrFor } from '../color.js';
import { driftmanSkin, classicBootSkin } from './driftman.js';
import { drawLibrary } from './library.js';
import { drawInsert, INSERT_END } from './insert.js';
import { drawBoot, bootPhases } from './boot.js';
import { createCartridgeRuntime, dissolveFrames } from './runtime.js';
import { newFrame, clearFrame, ramp, sizeTier, dissolveThresholds } from './ui.js';

export const ERROR_SECONDS = 4;
export const EJECT_SECONDS = 1.6;
export const LOCKED_MESSAGE = 'This cartridge isn\'t ready yet. Pick another with ◀ ▶.';
export const SLIDE_SECONDS = 0.3;
export const DIP_SECONDS = 0.3;
export const LIBRARY_FADE_SECONDS = 0.3; // the library dissolves in when opened from Classic (a hard cut would flash)
export const MESSAGE_SECONDS = 5;
const TINT_LEVELS = [4, 8, 12, 15];
const DEFAULT_HUE = '#9DB8A8';

export function libraryPalette(carts, cmode) {
  const base = makeSkinPalette(driftmanSkin, cmode, 'driftman');
  const sgr = base.sgr.slice();
  const tints = [];
  for (const c of carts) {
    const hue = parseHex((c.manifest && c.manifest.labelHue) || DEFAULT_HUE) || parseHex(DEFAULT_HUE);
    tints.push(sgr.length);
    for (const lv of TINT_LEVELS) sgr.push(sgrFor(hue, lv, cmode) + base.base);
  }
  return { pal: { ...base, key: `lib:${cmode}:${carts.length}`, sgr }, tints };
}

export function createShell(o) {
  const { cmode = 'truecolor', seed = 1, host, consts } = o;
  const loadScenes = o.loadScenes || defaultLoadScenes;
  const carts = o.cartridges || [];
  let { cols, rows } = o;
  let disposed = false;

  const lib = libraryPalette(carts, cmode);
  const libPal = lib.pal;
  const libCarts = carts.map((c, i) => ({
    id: c.id, title: c.title, code: (c.manifest && c.manifest.code) || '', blurb: c.manifest.blurb, facts: c.manifest.facts || [],
    locked: c.locked, label: c.label, ink: null, tint: lib.tints[i],
  }));

  let screen = 'library';
  let st = 0; // seconds in the current screen
  let index = Math.max(0, carts.findIndex((c) => c.id === o.lastCartridge));
  let prev = index, slideT = SLIDE_SECONDS, message = '', msgT = 0, dipT = DIP_SECONDS;
  let helpOpen = false; // library help (the runtime keeps its own)
  let enterT = o.from === 'classic' ? 0 : LIBRARY_FADE_SECONDS; // seconds since the library was opened from Classic
  let from = o.from === undefined ? null : o.from;
  let forced = true;

  // the inserted cartridge
  let cart = null, entry = null, classic = false, skipped = false, menuOnArrive = true;
  let load = { status: 'none', scenes: null, error: null };
  let bootSkin = driftmanSkin, bootPal = libPal, errorText = '';
  let runtime = null;
  let bt = 0; // boot-local seconds

  let resolveRunning = null;
  let runningPromise = null;
  const whenRunning = () => {
    if (!runningPromise) runningPromise = new Promise((res) => { resolveRunning = res; });
    if (screen === 'running') resolveRunning(true);
    return runningPromise;
  };
  const settleRunning = (v) => { if (resolveRunning) { resolveRunning(v); resolveRunning = () => {}; } };

  let fb = newFrame(cols, rows), fb2 = newFrame(cols, rows), blank = newFrame(cols, rows);
  const palette = () => (screen === 'boot' || screen === 'error' || (screen === 'running') ? bootPal : libPal);

  const view = () => ({
    cartridges: libCarts, index, prev, slide: Math.min(1, slideT / SLIDE_SECONDS), message,
    dip: dipT < DIP_SECONDS / 2 ? 1 : 0, tier: sizeTier(cols, rows),
  });

  function resetLibrary(newFrom) {
    screen = 'library'; st = 0; helpOpen = false; message = ''; slideT = SLIDE_SECONDS; dipT = DIP_SECONDS; prev = index;
    runtime = null; load = { status: 'none', scenes: null, error: null }; cart = null; entry = null; skipped = false;
    if (newFrom !== undefined) from = newFrom;
    forced = true;
  }

  // ---- screen changes

  function enterInsert(i) {
    index = i; prev = i;
    cart = carts[i]; entry = libCarts[i];
    classic = cart.runtime === 'classic';
    skipped = false; menuOnArrive = true;
    host.persist({ lastCartridge: cart.id });
    screen = 'insert'; st = 0; forced = true;
    helpOpen = false; message = '';
    if (classic) { load = { status: 'ok', scenes: [], error: null }; return; }
    load = { status: 'pending', scenes: null, error: null };
    const mine = load;
    Promise.resolve().then(() => loadScenes(cart)).then((r) => {
      if (disposed || load !== mine) return;
      if (!r || (r.errors && r.errors.length) || !r.scenes) {
        const why = r && r.errors && r.errors[0] ? r.errors[0].reason : 'the cartridge has no scenes';
        mine.status = 'fail'; mine.error = String(why);
      } else { mine.status = 'ok'; mine.scenes = r.scenes; }
      forced = true;
    }).catch((err) => {
      if (disposed || load !== mine) return;
      mine.status = 'fail'; mine.error = String(err && err.message ? err.message : err);
      forced = true;
    });
  }

  function toBoot() {
    screen = 'boot'; st = 0; bt = 0; forced = true;
    bootSkin = classic ? classicBootSkin : (cart.skin || driftmanSkin);
    bootPal = classic || !cart.skin ? libPal : makeSkinPalette(cart.skin, cmode, cart.id);
  }

  function ensureRuntime() {
    if (runtime || load.status !== 'ok' || classic) return;
    runtime = createCartridgeRuntime(cart, load.scenes, bootPal, {
      cols, rows, seed, skin: cart.skin || driftmanSkin, cmode, ...consts,
    });
    if (menuOnArrive) runtime.open();
  }

  function arrive() {
    if (classic) { const h = host; resetLibrary(); h.leaveToClassic(); return; }
    ensureRuntime();
    if (!runtime) return;
    screen = 'running'; st = 0; forced = true;
    settleRunning(true);
  }

  function startEject() {
    screen = 'eject'; st = 0; forced = true;
    runtime = null;
  }

  function skip() {
    if (screen === 'insert') {
      skipped = true;
      toBoot();
      bt = bootPhases(bootSkin).barEnd;
    } else if (screen === 'boot') {
      skipped = true;
    } else if (screen === 'error') {
      resetLibrary();
      return;
    } else if (screen === 'eject') {
      resetLibrary();
      return;
    }
    if (load.status === 'ok') arrive();
    forced = true;
  }

  // ---- key handlers (names match SHELL_KEYMAP actions)

  const actions = {
    libPrev() { if (carts.length > 1) { prev = index; index = (index + carts.length - 1) % carts.length; slideT = 0; message = ''; } },
    libNext() { if (carts.length > 1) { prev = index; index = (index + 1) % carts.length; slideT = 0; message = ''; } },
    libInsert() {
      if (!carts.length) return;
      if (carts[index].locked) { dipT = 0; message = LOCKED_MESSAGE; msgT = 0; return; }
      enterInsert(index);
    },
    libBack() {
      if (helpOpen) { helpOpen = false; return; }
      if (from === 'classic') host.leaveToClassic();
    },
    helpToggle() {
      if (screen === 'running' && runtime) runtime.actions.helpToggle();
      else helpOpen = !helpOpen;
    },
    quit(token) { host.quit(token === '\x03' ? 130 : 0); },
    menuEnter() { if (runtime && runtime.actions.menuEnter() === 'eject') startEject(); },
    menuPrev() { if (runtime) runtime.actions.menuPrev(); },
    menuNext() { if (runtime) runtime.actions.menuNext(); },
    closeTop() { if (runtime) runtime.actions.closeTop(); },
    eject() { if (runtime) startEject(); },
    sceneNext() { if (runtime) runtime.actions.sceneNext(); },
    pauseToggle() { if (runtime) runtime.actions.pauseToggle(); },
    speedUp() { if (runtime) runtime.actions.speedUp(); },
    speedDown() { if (runtime) runtime.actions.speedDown(); },
    seasonsNext() { if (runtime) runtime.actions.seasonsNext(); },
  };

  function key(token) {
    if (disposed) return;
    forced = true;
    const map = SHELL_KEYS[screen];
    const e = map && map.get(token);
    if (e && e.action === 'quit') { actions.quit(token); return; }
    if (screen === 'insert' || screen === 'boot' || screen === 'error' || screen === 'eject') { skip(); return; }
    if (!e) return;
    const open = screen === 'running' ? (runtime && runtime.helpOpen) : helpOpen;
    if (open && !SHELL_HELP_OPEN_ACTIONS.includes(e.action)) return;
    if (screen === 'running' && runtime) runtime.touch();
    actions[e.action](token);
  }

  // ---- time

  function tick(dt) {
    if (disposed) return;
    const d = dt > 0 ? dt : 0;
    switch (screen) {
      case 'library':
        if (enterT < LIBRARY_FADE_SECONDS) { enterT += d; forced = true; }
        if (helpOpen) break;
        if (slideT < SLIDE_SECONDS) { slideT += d; forced = true; }
        if (dipT < DIP_SECONDS) { dipT += d; forced = true; }
        if (message) { msgT += d; if (msgT >= MESSAGE_SECONDS) { message = ''; forced = true; } }
        break;
      case 'insert':
        st += d; forced = true;
        if (st >= INSERT_END) toBoot();
        break;
      case 'boot': {
        if (load.status === 'fail') { errorText = load.error; screen = 'error'; st = 0; forced = true; break; }
        const P = bootPhases(bootSkin);
        const ready = load.status === 'ok';
        bt = ready ? bt + d : Math.min(bt + d, P.barEnd);
        if (ready && !classic && bt >= P.titleEnd - 0.01) { ensureRuntime(); if (runtime) runtime.advance(d); }
        forced = true;
        if (ready && (skipped || bt >= P.end)) arrive();
        break;
      }
      case 'error':
        st += d; forced = true;
        if (st >= ERROR_SECONDS) resetLibrary();
        break;
      case 'eject':
        st += d; forced = true;
        if (st >= EJECT_SECONDS) resetLibrary();
        break;
      case 'running':
        if (runtime) runtime.advance(d);
        break;
      default: break;
    }
  }

  function dirty() {
    if (screen === 'running') return forced || (runtime ? runtime.needsFrame() : false);
    return forced;
  }

  // ---- drawing

  function insertItem() {
    return { cartridge: entry, view: { ...view(), index: libCarts.indexOf(entry), prev: libCarts.indexOf(entry), slide: 1, dip: 0, message: '' }, cartSkin: cart.skin, classic };
  }

  function helpInfo(forScreen) {
    const sk = forScreen === 'running' && cart && cart.skin ? cart.skin : driftmanSkin;
    const pal = forScreen === 'running' ? bootPal : libPal;
    const sc = runtime ? runtime.state().sceneId : '';
    return {
      mode: forScreen, modeName: forScreen, sceneName: sc || '', ui: pal.ui,
      title: (sk.help && sk.help.title) || 'DRIFTMAN 2000  keys', box: sk.help && sk.help.box,
      lines: shellHelpLines(forScreen, sk),
      modeLine: forScreen === 'running' && cart ? `cartridge: ${cart.title}    scene: ${sc || ''}` : '',
    };
  }

  function frame() {
    const f = fb;
    switch (screen) {
      case 'library':
        drawLibrary(f, view(), driftmanSkin);
        if (enterT < LIBRARY_FADE_SECONDS) {
          const p = ramp(enterT, 0, LIBRARY_FADE_SECONDS), thr = dissolveThresholds(cols * rows);
          for (let i = 0; i < f.glyphs.length; i++) if (p < thr[i]) { f.glyphs[i] = 32; f.shades[i] = 0; }
        }
        if (helpOpen) drawHelp(f.glyphs, f.shades, cols, rows, helpInfo('library'));
        break;
      case 'insert':
        drawInsert(f, { item: insertItem(), t: st }, driftmanSkin);
        break;
      case 'eject':
        drawInsert(f, { item: insertItem(), t: INSERT_END * (1 - ramp(st, 0, EJECT_SECONDS)) }, driftmanSkin);
        break;
      case 'error':
        drawBoot(f, { skin: bootSkin, t: 0, error: errorText, title: cart && cart.title }, driftmanSkin);
        break;
      case 'boot': {
        const P = bootPhases(bootSkin);
        drawBoot(f, {
          skin: bootSkin, labelArt: cart.label, bootArt: cart.boot, t: bt, loading: load.status !== 'ok', title: cart.title,
        }, driftmanSkin);
        if (bt > P.titleEnd) {
          const p = ramp(bt, P.titleEnd, P.end);
          const thr = dissolveThresholds(cols * rows);
          if (runtime) {
            runtime.frame(fb2);
            dissolveFrames(f, fb2, p, thr, f);
          } else {
            clearFrame(blank);
            dissolveFrames(f, blank, p, thr, f);
          }
        }
        break;
      }
      case 'running':
        clearFrame(f);
        if (runtime) {
          runtime.frame(f);
          if (runtime.helpOpen) drawHelp(f.glyphs, f.shades, cols, rows, helpInfo('running'));
        }
        break;
      default: clearFrame(f);
    }
    forced = false;
    return { glyphs: f.glyphs, shades: f.shades, cols, rows, palette: screen === 'running' && runtime ? runtime.palette() : palette() };
  }

  function resize(c, r) {
    cols = c; rows = r;
    fb = newFrame(c, r); fb2 = newFrame(c, r); blank = newFrame(c, r);
    if (runtime) runtime.resize(c, r);
    forced = true;
  }

  function dispose() {
    disposed = true;
    settleRunning(false);
  }

  // ---- start
  if (o.start && o.start.cartridge) {
    const i = carts.findIndex((c) => c.id === o.start.cartridge);
    if (i >= 0) {
      enterInsert(i);
      if (o.start.skipBoot) { menuOnArrive = false; toBoot(); skipped = true; bt = bootPhases(bootSkin).barEnd; }
    }
  }

  return {
    tick, key, frame, resize, dirty, dispose, whenRunning, actions,
    openLibrary: (f) => { resetLibrary(f === undefined ? null : f); enterT = f === 'classic' ? 0 : LIBRARY_FADE_SECONDS; },
    state: () => ({
      screen,
      cartridge: cart ? cart.id : (libCarts[index] ? libCarts[index].id : null),
      program: runtime ? runtime.state().program : null,
      sceneId: runtime ? runtime.state().sceneId : null,
      menu: runtime ? runtime.menuOpen : false,
      help: screen === 'running' ? !!(runtime && runtime.helpOpen) : helpOpen,
    }),
    get screen() { return screen; },
    get from() { return from; },
    runtime: () => runtime,
  };
}
