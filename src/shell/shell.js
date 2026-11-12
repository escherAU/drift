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
//   eject      the running picture dissolves to blank (EJECT_FADE_SECONDS, in the cartridge's palette), then blank dissolves into the insert
//              animation played backwards (EJECT_ANIM_SECONDS, clock from the end of the fade, in the library palette); EJECT_SECONDS in all
//   running    the cartridge runtime (menu, programs, help)
//
// A late or failed load never writes after dispose(): every promise checks `disposed` first and has a catch.
import { SHELL_KEYS, SHELL_HELP_OPEN_ACTIONS, shellHelpLines } from '../keymap.js';
import { drawHelp } from '../overlay.js';
import { makeSkinPalette } from '../cartridge/palette.js';
import { loadScenes as defaultLoadScenes } from '../cartridge/loader.js';
import { parseHex, sgrFor, shadeRGB, colourTables, unpackRgb } from '../color.js';
import { driftmanSkin, classicBootSkin, plainBootSkin } from './driftman.js';
import { drawLibrary, answerAreas, idleSignature, dipAt, DIP_SECONDS, makeLibraryMemo } from './library.js';
import { makeFoil } from './foil.js';
import { scrubTwins, dimFrame, dissolveScrub, shadeLstars, SCRUB_STRIP_SECONDS, SCRUB_GATE_SECONDS, SCRUB_IN_SECONDS, SCRUB_HOLD_SECONDS, SCRUB_OUT_SECONDS } from './scrub.js';
import { drawInsert, INSERT_END, INSERT_CLICK_END } from './insert.js';
import { drawBoot, bootPhases, mergeBootPalette, FIRST_INSERT_HINT } from './boot.js';
import { createCartridgeRuntime, dissolveFrames } from './runtime.js';
import { newFrame, clearFrame, ramp, sizeTier, dissolveThresholds } from './ui.js';
import { RGB_CELL } from '../renderer.js';

export const ERROR_SECONDS = 4;
export const EJECT_FADE_SECONDS = 0.3; // eject phase 1: the frozen running frame dissolves to blank (linear)
export const EJECT_ANIM_SECONDS = 1.6; // eject phase 2: the insert animation backwards; its clock starts when phase 1 ends
export const EJECT_SECONDS = 1.9; // EJECT_FADE_SECONDS + EJECT_ANIM_SECONDS (written out: 0.3 + 1.6 is 1.9000000000000001)
export const LOCKED_MESSAGE = 'This cartridge isn\'t ready yet. Pick another with ◀ ▶.';
export const SLIDE_SECONDS = 0.36; // the carousel slide (34 columns, ease-out)
export const TYPE_SECONDS = 0.3; // the console screen retypes left to right
export { DIP_SECONDS };
export const LIBRARY_FADE_SECONDS = 0.3; // the library dissolves in when opened from Classic (a hard cut would flash)
export const INSERT_DISSOLVE_SECONDS = 0.3; // Enter on the card at the list and tiny tiers dissolves from the library frame into the insert picture (a cut changed half of a 41 x 11 screen)
export const MESSAGE_SECONDS = 2.5; // the locked-cartridge message (it also clears on the next key)
const TINT_LEVELS = [4, 8, 12, 15];
const DEFAULT_HUE = '#9DB8A8';
const labelHueOf = (c) => parseHex((c.manifest && c.manifest.labelHue) || DEFAULT_HUE) || parseHex(DEFAULT_HUE);

// The first insert of the process shows the eject/help hint on the boot's bar row (per process, not saved anywhere).
let firstInsertPending = true;
export function resetFirstInsertHint() { firstInsertPending = true; }

export function libraryPalette(carts, cmode) {
  const base = makeSkinPalette(driftmanSkin, cmode, 'driftman');
  const sgr = base.sgr.slice();
  const fgs = []; // the tint colours, in step with the sgr entries added after the skin's own
  const tints = [];
  for (const c of carts) {
    const hue = labelHueOf(c);
    tints.push(sgr.length);
    for (const lv of TINT_LEVELS) { sgr.push(sgrFor(hue, lv, cmode) + base.base); fgs.push(shadeRGB(hue, lv)); }
  }
  // Tables: the skin's own entries, then the tints on the skin's background (base.bgRgb is the same for every entry).
  const tint = colourTables(fgs, unpackRgb(base.bgRgb[0]));
  const cat = (A, B) => { const o = new A.constructor(A.length + B.length); o.set(A); o.set(B, A.length); return o; };
  const tables = {};
  for (const k of ['fgRgb', 'bgRgb', 'fg256', 'bg256']) tables[k] = cat(base[k], tint[k]);
  // The dim twins the shelf scrub draws with (scrub.js), appended after the tints so every existing shade keeps its number.
  // Two shared greys plus two per cartridge in its hue; when those would not stay under RGB_CELL (255), the cartridges share the greys.
  const start = sgr.length;
  const skinFgs = Array.from(base.fgRgb, unpackRgb);
  const ownHues = start + 2 + 2 * carts.length < RGB_CELL;
  const tw = scrubTwins({ start, skinFgs, tintHues: carts.map((c) => (ownHues ? labelHueOf(c) : null)), tints, cmode, base: base.base });
  const twT = colourTables(tw.fgs, unpackRgb(base.bgRgb[0]));
  for (const k of ['fgRgb', 'bgRgb', 'fg256', 'bg256']) tables[k] = cat(tables[k], twT[k]);
  return { pal: { ...base, key: `lib:${cmode}:${carts.length}`, sgr: sgr.concat(tw.sgr), ...tables }, tints, scrub: { text: tw.text, block: tw.block } };
}

export function createShell(o) {
  const { cmode = 'truecolor', seed = 1, host, consts } = o;
  const loadScenes = o.loadScenes || defaultLoadScenes;
  const drawInsertFn = o.drawInsert || drawInsert; // tests may swap the insert/eject picture (to put full-colour cells in a hand-over frame)
  const carts = o.cartridges || [];
  let { cols, rows } = o;
  let tier = sizeTier(cols, rows);
  let disposed = false;

  const lib = libraryPalette(carts, cmode);
  const libPal = lib.pal;
  const scrubOn = o.scrub !== false && !!lib.scrub; // (a test seam: o.scrub false is the hard-sliding shelf, which the flash tests show is not safe)
  const lstar = shadeLstars(libPal.fgRgb); // L* of every library shade (the scrub dissolves read it)
  const memo = makeLibraryMemo(); // the art grids the library keeps between ticks (library.js, F3)
  const libCarts = carts.map((c, i) => ({
    id: c.id, title: c.title, code: (c.manifest && c.manifest.code) || '', blurb: c.manifest.blurb, facts: c.manifest.facts || [],
    locked: c.locked, label: c.label, ink: c.labelInk || null, tint: lib.tints[i],
    // the foil label (manifest "foil", DRIFT-7 C12): hues as angles and the lightness of each ink level, read from the tint colours the palette holds
    foil: !c.locked && c.manifest.foil ? makeFoil(c.manifest.foil, TINT_LEVELS.map((lv) => shadeRGB(labelHueOf(c), lv))) : undefined,
  }));

  let screen = 'library';
  let st = 0; // seconds in the current screen
  let index = Math.max(0, carts.findIndex((c) => c.id === o.lastCartridge));
  let prev = index, slideT = SLIDE_SECONDS, message = '', msgT = 0, dipT = DIP_SECONDS;
  let idleT = 0, drawnSig = ''; // the library's idle clock (runs while it is settled and in view) and the idle picture last drawn
  let lastDir = 1, dial = index; // the way the last move went, the TUNE dial's step count
  // The shelf scrub (scrub.js). index/dial are the cursor, which moves at once on every press; artIndex/artDial are what the art layer
  // shows (the same, except while the shelf scrubs). phase: 'rest' (art = cursor), 'stale' (the art waits, the dots and the console
  // screen follow the cursor), 'in' (dissolving into the dim strip, which follows the cursor), 'dim' (the strip), 'out' (dissolving
  // back to the full picture of outIndex). sincePress = seconds since the last arrow press; evAge1/evAge2 = seconds since the last
  // two full-contrast changes (a slide counts as two, a dissolve as one); scrubFrom = the frame on screen when the dissolve in began.
  let artIndex = index, artDial = dial, phase = 'rest', inT = SCRUB_IN_SECONDS, outT = 0, outIndex = index, outDial = dial, outFrom = 'dim', scrubFrom = null;
  let stripIndex = index, stripDial = dial, stripAge = 0; // the cartridge the dim strip shows (it follows the cursor at most every SCRUB_STRIP_SECONDS: each redraw rewrites the whole shelf)
  let sincePress = 1e9, evAge1 = 1e9, evAge2 = 1e9;
  let helpOpen = false; // library help (the runtime keeps its own)
  let enterT = o.from === 'classic' ? 0 : LIBRARY_FADE_SECONDS; // seconds since the library was opened from Classic
  // The library takes over from the eject animation (or the error card) by dissolve: at the list tier those are text
  // screens and the library a different picture, and a cut between them changed up to 55% of a 40 x 10 screen. The
  // last frame the eject/error drew is kept, and the library's first LIBRARY_FADE_SECONDS dissolve from it.
  let handT = LIBRARY_FADE_SECONDS, handFrom = null;
  // The same hand-over for Enter on the card: at the list and tiny tiers the library and the insert picture are different text screens, so
  // the library frame as last drawn is kept and the insert's first INSERT_DISSOLVE_SECONDS dissolve from it (st is the insert's own clock, so the
  // timeline does not move). Both pictures use the library palette, so there is no palette change in the dissolve; the switch to the cartridge's
  // palette comes with the boot, long after. The compact and full tiers keep the cut.
  let insFrom = null, libShown = false;
  let from = o.from === undefined ? null : o.from;
  let forced = true;

  // the inserted cartridge
  let cart = null, entry = null, classic = false, skipped = false, menuOnArrive = true;
  let load = { status: 'none', scenes: null, error: null };
  let bootSkin = driftmanSkin, bootPal = libPal, errorText = '';
  let ejectFrom = null, ejectPal = libPal, runShown = false; // the running frame as last drawn (kept at eject) and the palette it was drawn in
  let cartPal = libPal, bootMap = null; // the cartridge's own palette (the runtime's) and, for a skinned one, where the console's colours sit in bootPal
  let runtime = null;
  let bt = 0; // boot-local seconds
  let hintNow = false; // this insert is the process's first: the boot shows the hint
  // The cartridge's console hook (manifest "console": "code"), decided ONCE per insert: null = not decided yet, true = the hook
  // draws the console from step 5 of the insert to the end of the boot (and the eject plays it back), false = the standard
  // sweep and console for the whole insert. Decided at the first frame with t >= INSERT_CLICK_END (1.0 s): the hook is used only
  // if its module had loaded by then, and a late arrival never switches a console that is already on screen.
  let hookUse = null;
  const decideHook = () => { if (hookUse === null) hookUse = !classic && load.status === 'ok' && !!load.console; };
  const hookNow = () => (hookUse ? load.console : null);

  let resolveRunning = null;
  let runningPromise = null;
  const whenRunning = () => {
    if (!runningPromise) runningPromise = new Promise((res) => { resolveRunning = res; });
    if (screen === 'running') resolveRunning(true);
    return runningPromise;
  };
  const settleRunning = (v) => { if (resolveRunning) { resolveRunning(v); resolveRunning = () => {}; } };

  let fb = newFrame(cols, rows), fb2 = newFrame(cols, rows), fbh = newFrame(cols, rows), blank = newFrame(cols, rows);
  const palette = () => (screen === 'boot' || screen === 'error' || (screen === 'running') ? bootPal : libPal);

  const view = () => ({
    cartridges: libCarts, index: artIndex, prev, slide: Math.min(1, slideT / SLIDE_SECONDS), dir: lastDir, dial: artDial, type: Math.min(1, slideT / TYPE_SECONDS), idle: idleT, message,
    dip: dipAt(dipT), tier: sizeTier(cols, rows),
  });

  function resetLibrary(newFrom) {
    screen = 'library'; st = 0; helpOpen = false; message = ''; slideT = SLIDE_SECONDS; dipT = DIP_SECONDS; prev = index; artIndex = index; artDial = dial; sincePress = evAge1 = evAge2 = 1e9; phase = 'rest'; idleT = 0; drawnSig = '';
    runtime = null; load = { status: 'none', scenes: null, error: null }; cart = null; entry = null; skipped = false; hookUse = null;
    if (newFrom !== undefined) from = newFrom;
    forced = true;
  }

  // ---- screen changes

  function enterInsert(i) {
    index = i; prev = i; artIndex = i; artDial = dial; phase = 'rest';
    cart = carts[i]; entry = libCarts[i];
    classic = cart.runtime === 'classic';
    skipped = false; menuOnArrive = true; hookUse = null;
    hintNow = firstInsertPending; firstInsertPending = false;
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
      } else { mine.status = 'ok'; mine.scenes = r.scenes; mine.console = r.console || null; }
      forced = true;
    }).catch((err) => {
      if (disposed || load !== mine) return;
      mine.status = 'fail'; mine.error = String(err && err.message ? err.message : err);
      forced = true;
    });
  }

  function toBoot() {
    decideHook(); // an insert skipped or stepped past 1.0 s without a frame is decided here, by whether the hook is loaded now
    screen = 'boot'; st = 0; bt = 0; forced = true;
    bootSkin = classic ? classicBootSkin : (cart.skin || plainBootSkin(cart.title));
    bootMap = null;
    if (classic || !cart.skin) { cartPal = libPal; bootPal = libPal; return; }
    // a skinned boot draws the console (library colours) and the cartridge's screen (skin colours) in one frame
    cartPal = makeSkinPalette(cart.skin, cmode, cart.id);
    const m = mergeBootPalette(cartPal, libPal, entry.tint);
    bootPal = m.pal; bootMap = m.map;
  }

  function ensureRuntime() {
    if (runtime || load.status !== 'ok' || classic) return;
    runtime = createCartridgeRuntime(cart, load.scenes, cartPal, {
      cols, rows, seed, skin: cart.skin || driftmanSkin, cmode, ...consts,
    });
    if (menuOnArrive) runtime.open();
  }

  function arrive() {
    if (classic) { const h = host; resetLibrary(); h.leaveToClassic(); return; }
    ensureRuntime();
    if (!runtime) return;
    screen = 'running'; st = 0; forced = true; runShown = false;
    if (menuOnArrive) runtime.startAuto();
    settleRunning(true);
  }

  // The eject starts from the running picture the player was looking at, WITH its fg/bg, and its palette; it
  // dissolves to blank before the palette changes to the library's, so no frame mixes the two.
  function startEject() {
    if (!ejectFrom || ejectFrom.cols !== cols || ejectFrom.rows !== rows) ejectFrom = newFrame(cols, rows);
    if (runShown) { ejectFrom.glyphs.set(fb.glyphs); ejectFrom.shades.set(fb.shades); ejectFrom.fg.set(fb.fg); ejectFrom.bg.set(fb.bg); }
    else { clearFrame(ejectFrom); if (runtime) runtime.frame(ejectFrom); } // no running frame was drawn since the last resize
    ejectFrom.cols = cols; ejectFrom.rows = rows;
    ejectPal = runtime ? runtime.palette() : libPal;
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

  // One step of the cursor, at once, whatever came before (no press is ever dropped or delayed): the dots, the console screen and
  // Enter follow it. A lone press (nothing scrubbing, and no full-contrast change within SCRUB_GATE_SECONDS) is the normal slide.
  // Any other press leaves the art to the scrub (scrub.js), which changes it at most twice a second and never at full contrast
  // faster than the flash rules allow.
  function moveCursor(dir) {
    if (carts.length < 2) return;
    const lone = phase === 'rest' && evAge1 >= SCRUB_GATE_SECONDS;
    sincePress = 0;
    if (lone || !scrubOn || tier === 'tiny') {
      if (phase !== 'rest') { phase = 'rest'; artIndex = index; artDial = dial; } // (no scrub palette: the art always follows)
      startMove(dir, 0); evAge1 = evAge2 = 0;
      return;
    }
    index = (index + carts.length + dir) % carts.length; dial += dir; message = '';
    if (phase === 'rest') phase = 'stale';
  }
  function startMove(dir, carry) {
    prev = index; index = (index + carts.length + dir) % carts.length; artIndex = index;
    lastDir = dir; dial += dir; artDial = dial; slideT = carry; message = '';
  }
  const fire = () => { evAge2 = evAge1; evAge1 = 0; forced = true; };
  // Keep the frame on screen (if it is a library frame of this size) as the picture the dissolve into the strip starts from.
  function beginIn() {
    const ok = libShown && fb.cols === cols && fb.rows === rows;
    if (ok) {
      if (!scrubFrom || scrubFrom.cols !== cols || scrubFrom.rows !== rows) scrubFrom = newFrame(cols, rows);
      scrubFrom.glyphs.set(fb.glyphs); scrubFrom.shades.set(fb.shades); scrubFrom.fg.set(fb.fg); scrubFrom.bg.set(fb.bg);
      scrubFrom.cols = cols; scrubFrom.rows = rows;
    }
    phase = 'in'; inT = ok ? 0 : SCRUB_IN_SECONDS; stripIndex = index; stripDial = dial; stripAge = 0; idleT = 0; drawnSig = ''; fire();
  }
  function beginOut() {
    outFrom = phase === 'stale' ? 'stale' : 'dim';
    phase = 'out'; outT = 0; outIndex = index; outDial = dial; idleT = 0; drawnSig = ''; fire();
  }
  function endOut() {
    artIndex = outIndex; artDial = outDial; prev = artIndex; slideT = SLIDE_SECONDS; idleT = 0; drawnSig = '';
    phase = index === outIndex ? 'rest' : 'stale';
    forced = true;
  }

  const actions = {
    libPrev() { moveCursor(-1); },
    libNext() { moveCursor(1); },
    libInsert() {
      if (!carts.length) return;
      if (carts[index].locked) { dipT = 0; message = LOCKED_MESSAGE; msgT = 0; return; }
      keepForInsert();
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
    if (screen === 'library') message = ''; // the locked-cartridge message goes on the next key
    const map = SHELL_KEYS[screen];
    const e = map && map.get(token);
    if (e && e.action === 'quit') { actions.quit(token); return; }
    if (screen === 'insert' || screen === 'boot' || screen === 'error' || screen === 'eject') { skip(); return; }
    if (screen === 'running' && runtime) runtime.cancelAuto(); // any key (even one that does nothing) cancels the start-by-itself countdown
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
        if (handT < LIBRARY_FADE_SECONDS) { handT += d; forced = true; }
        if (helpOpen) break;
        if (slideT < SLIDE_SECONDS) {
          slideT += d; forced = true;
        }
        sincePress = Math.min(sincePress + d, 1e9); evAge1 = Math.min(evAge1 + d, 1e9); evAge2 = Math.min(evAge2 + d, 1e9);
        if (phase !== 'rest') {
          // the art waits for the flash gate (a third full-contrast change within a second would flash), then dissolves into the
          // dim strip while presses keep coming, or back to the full picture once they have stopped
          const open = evAge2 >= SCRUB_GATE_SECONDS;
          if (phase === 'stale') { if (open) { if (sincePress < SCRUB_HOLD_SECONDS) beginIn(); else beginOut(); } }
          else if (phase === 'in' || phase === 'dim') {
            if (phase === 'in') { inT += d; forced = true; if (inT >= SCRUB_IN_SECONDS) phase = 'dim'; }
            stripAge += d;
            if (stripAge >= SCRUB_STRIP_SECONDS && stripIndex !== index) { stripIndex = index; stripDial = dial; stripAge = 0; forced = true; }
            if (phase === 'dim' && open && sincePress >= SCRUB_HOLD_SECONDS) beginOut();
          }
          else { outT += d; forced = true; if (outT >= SCRUB_OUT_SECONDS) endOut(); }
        }
        if (dipT < DIP_SECONDS) { dipT += d; forced = true; }
        if (slideT >= SLIDE_SECONDS && dipT >= DIP_SECONDS && (phase === 'rest' || phase === 'stale')) {
          // at rest: the idle clock runs, and a redraw is asked for only when what it draws has changed
          idleT += d;
          if (idleSignature(idleT, libCarts[artIndex], tier, memo) !== drawnSig) forced = true;
        }
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
        if (st >= ERROR_SECONDS) { resetLibrary(); handT = 0; }
        break;
      case 'eject':
        st += d; forced = true;
        if (st >= EJECT_SECONDS) { resetLibrary(); handT = 0; }
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
    return { cartridge: entry, view: { ...view(), index: libCarts.indexOf(entry), prev: libCarts.indexOf(entry), slide: 1, type: 1, idle: 0, dip: 0, message: '' }, cartSkin: cart.skin, classic };
  }

  function helpInfo(forScreen) {
    const sk = forScreen === 'running' && cart && cart.skin ? cart.skin : driftmanSkin;
    const pal = forScreen === 'running' ? cartPal : libPal;
    const sc = runtime ? runtime.state().sceneId : '';
    const found = sc && load.scenes ? load.scenes.find((x) => x.id === sc) : null;
    const sceneTitle = (found && found.title) || sc || '';
    return {
      mode: forScreen, modeName: forScreen, sceneName: sc || '', ui: pal.ui,
      title: (sk.help && sk.help.title) || 'DRIFTMAN 2000  keys', box: sk.help && sk.help.box,
      lines: shellHelpLines(forScreen, sk),
      modeLine: forScreen === 'running' && cart ? `${(sk.help && sk.help.modeLabel) || 'cartridge'}: ${cart.title}    ${(sk.help && sk.help.sceneLabel) || 'scene'}: ${sceneTitle}` : '',
    };
  }

  function keepForHandover(f) {
    if (!handFrom || handFrom.cols !== cols || handFrom.rows !== rows) handFrom = { glyphs: new Uint16Array(cols * rows), shades: new Uint8Array(cols * rows), fg: new Uint32Array(cols * rows), bg: new Uint32Array(cols * rows), cols, rows };
    handFrom.glyphs.set(f.glyphs); handFrom.shades.set(f.shades); handFrom.fg.set(f.fg); handFrom.bg.set(f.bg);
  }

  function keepForInsert() {
    insFrom = null;
    const t = sizeTier(cols, rows);
    if (screen !== 'library' || !libShown || (t !== 'list' && t !== 'tiny')) return;
    insFrom = { glyphs: fb.glyphs.slice(), shades: fb.shades.slice(), fg: fb.fg.slice(), bg: fb.bg.slice(), cols, rows };
  }

  // The library while the shelf scrubs (scrub.js). The dim strip is the library drawn at rest (no slide, no idle, no foil, the console
  // screen fully typed) for the CURSOR, passed through the dim cap. Its answer parts (the dots, the console screen / blurb / list) show
  // the cursor at once in every phase: over the waiting art ('stale'), over the dissolve into the strip ('in') and the strip itself.
  const fullView = (i, dl) => ({ ...view(), index: i, dial: dl, prev: i, slide: 1, type: 1, idle: 0, memo });
  function drawDim(dst, i = index, dl = dial) {
    drawLibrary(dst, { ...view(), index: i, dial: dl, prev: i, slide: 1, type: 1, idle: 0, memo, scrub: true }, driftmanSkin);
    dimFrame(dst, lib.scrub, answerAreas(cols, rows, sizeTier(cols, rows)).dotsY);
  }
  function copyAnswers(dst, src) {
    for (const r of answerAreas(cols, rows, sizeTier(cols, rows)).rects) {
      for (let y = Math.max(0, r.y); y < Math.min(rows, r.y + r.h); y++) {
        for (let x = Math.max(0, r.x); x < Math.min(cols, r.x + r.w); x++) {
          const i = y * cols + x;
          dst.glyphs[i] = src.glyphs[i]; dst.shades[i] = src.shades[i]; dst.fg[i] = src.fg[i]; dst.bg[i] = src.bg[i];
        }
      }
    }
    const dy = answerAreas(cols, rows, sizeTier(cols, rows)).dotsY;
    if (dy >= 0 && dy < rows) for (let x = 0; x < cols; x++) { const i = dy * cols + x; dst.glyphs[i] = src.glyphs[i]; dst.shades[i] = src.shades[i]; dst.fg[i] = src.fg[i]; dst.bg[i] = src.bg[i]; }
  }
  // the waiting art (drawn from artIndex as it would be at rest or mid-slide) with the cursor's answer parts over it; uses fbh as scratch
  function drawStale(dst) {
    drawLibrary(dst, { ...view(), memo }, driftmanSkin);
    drawDim(fbh);
    copyAnswers(dst, fbh);
  }
  // the dim strip (of stripIndex) with the cursor's answer parts over it; uses fbh as scratch
  function drawStrip(dst) {
    drawDim(dst, stripIndex, stripDial);
    if (stripIndex !== index) { drawDim(fbh); copyAnswers(dst, fbh); }
  }
  function drawScrub(f) {
    const thr = dissolveThresholds(cols * rows);
    if (phase === 'stale') { drawStale(f); drawnSig = libCarts[artIndex] ? idleSignature(idleT, libCarts[artIndex], sizeTier(cols, rows), memo) : ''; return; }
    drawnSig = '';
    if (phase === 'out') {
      if (outFrom === 'stale') drawStale(fb2); else drawStrip(fb2);
      drawLibrary(fbh, fullView(outIndex, outDial), driftmanSkin);
      dissolveScrub(fb2, fbh, ramp(outT, 0, SCRUB_OUT_SECONDS), thr, f, lib.scrub, lstar);
      return;
    }
    drawStrip(fb2);
    if (phase === 'in' && scrubFrom && scrubFrom.cols === cols && scrubFrom.rows === rows) {
      dissolveScrub(scrubFrom, fb2, ramp(inT, 0, SCRUB_IN_SECONDS), thr, f, lib.scrub, lstar);
      copyAnswers(f, fb2);
    } else { f.glyphs.set(fb2.glyphs); f.shades.set(fb2.shades); f.fg.set(fb2.fg); f.bg.set(fb2.bg); }
  }

  function frame() {
    const f = fb;
    libShown = screen === 'library';
    switch (screen) {
      case 'library':
        if (phase !== 'rest') drawScrub(f);
        else {
          drawLibrary(f, { ...view(), memo }, driftmanSkin);
          drawnSig = libCarts[artIndex] ? idleSignature(idleT, libCarts[artIndex], sizeTier(cols, rows), memo) : '';
        }
        if (enterT < LIBRARY_FADE_SECONDS) {
          const p = ramp(enterT, 0, LIBRARY_FADE_SECONDS), thr = dissolveThresholds(cols * rows);
          for (let i = 0; i < f.glyphs.length; i++) if (p < thr[i]) { f.glyphs[i] = 32; f.shades[i] = 0; }
        }
        if (handT < LIBRARY_FADE_SECONDS && handFrom && handFrom.cols === cols && handFrom.rows === rows) {
          const p = ramp(handT, 0, LIBRARY_FADE_SECONDS), thr = dissolveThresholds(cols * rows);
          for (let i = 0; i < f.glyphs.length; i++) if (p < thr[i]) { f.glyphs[i] = handFrom.glyphs[i]; f.shades[i] = handFrom.shades[i]; f.fg[i] = handFrom.fg[i]; f.bg[i] = handFrom.bg[i]; }
        }
        if (helpOpen) drawHelp(f.glyphs, f.shades, cols, rows, helpInfo('library'));
        break;
      case 'insert':
        if (st >= INSERT_CLICK_END) decideHook();
        drawInsertFn(f, { item: insertItem(), t: st, hook: hookNow() }, driftmanSkin);
        if (insFrom && st < INSERT_DISSOLVE_SECONDS && insFrom.cols === cols && insFrom.rows === rows) {
          dissolveFrames(insFrom, f, ramp(st, 0, INSERT_DISSOLVE_SECONDS), dissolveThresholds(cols * rows), f);
        }
        break;
      case 'eject': {
        const thr = dissolveThresholds(cols * rows);
        clearFrame(blank);
        if (st < EJECT_FADE_SECONDS) {
          if (ejectFrom && ejectFrom.cols === cols && ejectFrom.rows === rows) dissolveFrames(ejectFrom, blank, ramp(st, 0, EJECT_FADE_SECONDS), thr, f);
          else clearFrame(f);
          break;
        }
        const a = st - EJECT_FADE_SECONDS; // the animation's own clock
        drawInsertFn(f, { item: insertItem(), t: INSERT_END * (1 - ramp(a, 0, EJECT_ANIM_SECONDS)), hook: hookNow(), phase: 'eject' }, driftmanSkin);
        if (a < EJECT_FADE_SECONDS) dissolveFrames(blank, f, ramp(a, 0, EJECT_FADE_SECONDS), thr, f);
        keepForHandover(f);
        break;
      }
      case 'error':
        drawBoot(f, { skin: bootSkin, t: 0, error: errorText, title: cart && cart.title }, driftmanSkin);
        keepForHandover(f);
        break;
      case 'boot': {
        const P = bootPhases(bootSkin);
        drawBoot(f, {
          skin: bootSkin, labelArt: cart.label, bootArt: cart.boot, t: bt, loading: load.status !== 'ok', title: cart.title,
          item: insertItem(), consoleMap: bootMap || undefined, hint: hintNow ? FIRST_INSERT_HINT : undefined, hook: hookNow(),
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
        runShown = !!runtime;
        clearFrame(f);
        if (runtime) {
          runtime.frame(f);
          // the help panel ramps in and out over MENU_RAMP_SECONDS as a dissolve, as the menu does: the panel is drawn into a copy
          // of the frame and the copy's cells flip in by the same per-cell thresholds. A flipped cell is a whole panel cell
          // (a palette shade, never RGB_CELL), so the renderer takes no fg/bg for it.
          const hp = runtime.helpP;
          if (hp >= 1) drawHelp(f.glyphs, f.shades, cols, rows, helpInfo('running'));
          else if (hp > 0) {
            fbh.glyphs.set(f.glyphs); fbh.shades.set(f.shades); fbh.fg.set(f.fg); fbh.bg.set(f.bg);
            drawHelp(fbh.glyphs, fbh.shades, cols, rows, helpInfo('running'));
            dissolveFrames(f, fbh, hp, dissolveThresholds(cols * rows), f);
          }
        }
        break;
      default: clearFrame(f);
    }
    forced = false;
    const out = { glyphs: f.glyphs, shades: f.shades, cols, rows, palette: screen === 'running' && runtime ? runtime.palette() : screen === 'eject' && st < EJECT_FADE_SECONDS ? ejectPal : palette() };
    // fg/bg ride along only when a full-colour cell is on screen, so every palette-only frame is exactly what it was before
    // and the renderer never takes its full-colour branch for it
    if (f.shades.indexOf(RGB_CELL) !== -1) { out.fg = f.fg; out.bg = f.bg; }
    return out;
  }

  function resize(c, r) {
    cols = c; rows = r; tier = sizeTier(c, r);
    fb = newFrame(c, r); fb2 = newFrame(c, r); fbh = newFrame(c, r); blank = newFrame(c, r); runShown = false; scrubFrom = null;
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
