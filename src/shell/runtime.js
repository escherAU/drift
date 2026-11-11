// The cartridge runtime (DRIFT-4): plays one inserted cartridge's programs on the existing composers.
//
//   createCartridgeRuntime(cart, scenes, palette, opts) -> runtime
//
//   cart     a discovered cartridge (cart.manifest has the programs and the menu)
//   scenes   loadScenes(cart).scenes: [{ id, kind, family: 'cells' | 'field', scene }] in manifest order
//   palette  the skin palette (makeSkinPalette); the runtime swaps it for the c (seasons) key
//   opts     { cols, rows, seed, skin, cmode, SPEEDS, DISSOLVE_SECONDS, DEFAULT_FADE_SECONDS }
//            (the three constants come from app.js so this module never imports it)
//
// One cell composer runs the union of the cartridge's cells, sim, text and experimental builtin scenes
// (in manifest order) and one field composer runs its field scenes. Each program has its own Scheduler
// (count = program length; fade = the dissolve, or the program's crossfade). Switching programs from the
// menu dissolves from the last frame to the new program's frame with dissolveFrames, which uses the same
// per-cell thresholds the cell composer does. The runtime has its own time, speed and pause.
//
// A scene that throws is not caught here: the app reports it and quits, as it does for Classic.
import { Scheduler, createComposer, smoothstep } from '../compose.js';
import { createCellComposer } from '../cells.js';
import { parseHex, lerpRGB } from '../color.js';
import { makeSkinPalette } from '../cartridge/palette.js';
import { drawMenu } from './menu.js';
import { drawChrome } from './chrome.js';
import { dissolveThresholds } from './ui.js';

export const MENU_RAMP_SECONDS = 0.25;
export const MENU_IDLE_SECONDS = 20;
export const SEASON_SECONDS = 0.6;
export const SEASON_STEPS = 6;

// out = A where p < thr, B where p >= thr (p = 0 is exactly A, p = 1 exactly B). out may be A.
export function dissolveFrames(A, B, p, thr, out) {
  const g = out.glyphs, s = out.shades;
  const n = g.length;
  if (p <= 0) { if (out !== A) { g.set(A.glyphs); s.set(A.shades); } return out; }
  if (p >= 1) { g.set(B.glyphs); s.set(B.shades); return out; }
  for (let i = 0; i < n; i++) {
    if (p >= thr[i]) { g[i] = B.glyphs[i]; s[i] = B.shades[i]; } else if (out !== A) { g[i] = A.glyphs[i]; s[i] = A.shades[i]; }
  }
  return out;
}

const toHex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

export function createCartridgeRuntime(cart, scenes, palette, opts) {
  const { SPEEDS, DISSOLVE_SECONDS, DEFAULT_FADE_SECONDS, seed = 1, cmode = 'truecolor' } = opts;
  const skin = opts.skin;
  let { cols, rows } = opts;
  const m = cart.manifest;
const chapters = new Map((m.chapters || []).map((c) => [c.id, c]));

  const cellList = scenes.filter((s) => s.family === 'cells');
  const fieldList = scenes.filter((s) => s.family === 'field');
  let cellComp = cellList.length ? createCellComposer({ scenes: cellList.map((s) => s.scene), cols, rows, seed }) : null;
  let fieldComp = fieldList.length ? createComposer({ scenes: fieldList.map((s) => s.scene), cols, rows, seed }) : null;

  const programs = new Map();
  const mkSched = (def, start = 0) => new Scheduler({
    count: def.scenes.length,
    durationSec: def.sceneSeconds,
    fadeSec: def.transition === 'crossfade' ? (def.fadeSeconds ?? DEFAULT_FADE_SECONDS) : DISSOLVE_SECONDS,
    start,
    ...(def.seconds ? { durations: def.scenes.map((id) => def.seconds[id] ?? def.sceneSeconds) } : {}),
  });
  for (const def of m.programs) {
    const family = def.transition === 'crossfade' ? 'field' : 'cells';
    const list = family === 'field' ? fieldList : cellList;
    programs.set(def.id, { def, family, list, indexes: def.scenes.map((sid) => list.findIndex((s) => s.id === sid)), sched: mkSched(def) });
  }

  let cur = m.start;
  let t = 0, speedIdx = 3, paused = false, helpOpen = false;
  const menu = { open: false, index: 0, idle: 0, p: 0 };
  let auto = null; // seconds left on the menu's start-by-itself countdown (skin.menu.autostartSeconds), or null
  let autoShown = null; // the whole second last drawn, so a redraw is asked for once a second
  let xfade = null; // { glyphs, shades, t } the frame we dissolve away from after a program switch
  let last = null; // copy of the last scene frame (before overlays)
  let forced = true;

  // seasons: state 0 is the skin's own hue, then the skin's seasons in order
  const seasons = (skin && skin.seasons) || [];
  let season = 0;
  let seasonRamp = null; // { from, to, t }
  let pal = palette;
  const palCache = new Map();
  const palFor = (hex) => {
    let p = palCache.get(hex);
    if (!p) { p = makeSkinPalette({ ...skin, palette: { ...skin.palette, hue: hex } }, cmode, `${cart.id}:${hex}`); palCache.set(hex, p); }
    return p;
  };
  const hueOf = (i) => parseHex(i === 0 ? skin.palette.hue : seasons[i - 1].hue);

  function entries() {
    const list = m.menu || [
      ...m.programs.map((p) => ({ label: p.title, program: p.id })),
      { label: 'Eject', action: 'eject' },
    ];
    const playing = programs.get(cur).list[programs.get(cur).indexes[programs.get(cur).sched.state().a]];
    const playingId = playing ? playing.id : null;
    return list.map((e) => {
      const o = { label: e.label, program: e.program, scene: e.scene, action: e.action, current: e.program === cur && (e.scene === undefined || e.scene === playingId) };
      if (e.note !== undefined) o.note = e.note;
      if (e.desc !== undefined) o.desc = e.desc;
      if (e.scene !== undefined && chapters.has(e.scene)) { const c = chapters.get(e.scene); o.chapter = { numeral: c.numeral, place: c.place, line: c.line, icon: c.icon }; }
      return o;
    });
  }

  function openMenu() { menu.open = true; menu.idle = 0; forced = true; }
  function closeMenu() { menu.open = false; auto = null; forced = true; }

  // Switch to a program, optionally starting at one of its scenes. Nothing happens for an unknown program,
  // for the playing program when no scene is given, or for the scene that is already playing.
  function switchProgram(id, sceneId) {
    const prog = programs.get(id);
    if (!prog) return;
    if (sceneId === undefined && id === cur) return;
    const start = sceneId === undefined ? 0 : prog.def.scenes.indexOf(sceneId);
    if (start < 0) return;
    if (id === cur && sceneId !== undefined) {
      const st = prog.sched.state();
      if (st.a === start) return;
    }
    if (last) xfade = { glyphs: last.glyphs.slice(), shades: last.shades.slice(), t: 0 };
    cur = id;
    prog.sched = mkSched(prog.def, start);
    forced = true;
  }

  const actions = {
    menuEnter() {
      if (!menu.open) { openMenu(); return null; }
      const e = entries()[menu.index];
      closeMenu();
      if (!e) return null;
      if (e.action === 'eject') return 'eject';
      if (e.program) switchProgram(e.program, e.scene);
      return null;
    },
    menuPrev() { if (menu.open) { const n = entries().length; menu.index = (menu.index + n - 1) % n; menu.idle = 0; forced = true; } return null; },
    menuNext() { if (menu.open) { const n = entries().length; menu.index = (menu.index + 1) % n; menu.idle = 0; forced = true; } return null; },
    closeTop() { if (helpOpen) { helpOpen = false; forced = true; } else if (menu.open) closeMenu(); return null; },
    sceneNext() { programs.get(cur).sched.skip(); forced = true; return null; },
    pauseToggle() { paused = !paused; forced = true; return null; },
    speedUp() { speedIdx = Math.min(SPEEDS.length - 1, speedIdx + 1); return null; },
    speedDown() { speedIdx = Math.max(0, speedIdx - 1); return null; },
    seasonsNext() {
      if (seasons.length === 0) return null;
      const from = hueOf(season);
      season = (season + 1) % (seasons.length + 1);
      seasonRamp = { from, to: hueOf(season), t: 0 };
      forced = true;
      return null;
    },
    helpToggle() { helpOpen = !helpOpen; forced = true; return null; },
  };

  function advance(dt) {
    if (!(dt > 0) || helpOpen) return;
    const target = menu.open ? 1 : 0;
    // anything that is mid-ramp changes this frame, so the frame that finishes the ramp is drawn too
    if (menu.p !== target || xfade || seasonRamp) forced = true;
    if (menu.p !== target) {
      const step = dt / MENU_RAMP_SECONDS;
      menu.p = target > menu.p ? Math.min(1, menu.p + step) : Math.max(0, menu.p - step);
    }
    if (menu.open && auto !== null) {
      auto -= dt;
      if (auto <= 0) closeMenu(); // the tale starts: the program has been playing behind the menu
      else if (Math.ceil(auto) !== autoShown) forced = true;
    }
    if (menu.open) {
      menu.idle += dt;
      if (menu.idle >= MENU_IDLE_SECONDS) closeMenu();
    }
    if (xfade) { xfade.t += dt; if (xfade.t >= DISSOLVE_SECONDS) xfade = null; }
    if (seasonRamp) {
      seasonRamp.t += dt;
      const u = Math.min(1, seasonRamp.t / SEASON_SECONDS);
      const step = Math.round(u * SEASON_STEPS) / SEASON_STEPS;
      pal = step >= 1 ? palFor(toHex(seasonRamp.to)) : palFor(toHex(lerpRGB(seasonRamp.from, seasonRamp.to, step)));
      if (u >= 1) seasonRamp = null;
    }
    if (!paused) {
      const d = dt * SPEEDS[speedIdx];
      t += d;
      programs.get(cur).sched.advance(d);
    }
  }

  function sceneFrame() {
    const prog = programs.get(cur);
    const st = prog.sched.state();
    const mapped = { a: prog.indexes[st.a], b: prog.indexes[st.b], p: st.p };
    return prog.family === 'field' ? fieldComp.frame(mapped, t) : cellComp.frame(mapped, t);
  }

  // Fill out ({ glyphs, shades, cols, rows }) with the scene, the dissolve after a program switch, and
  // the chrome and menu overlays (which ramp in and out as a dissolve, never a pop).
  function frame(out) {
    const f = sceneFrame();
    out.glyphs.set(f.glyphs);
    out.shades.set(f.shades);
    if (!last || last.glyphs.length !== out.glyphs.length) last = { glyphs: new Uint16Array(out.glyphs.length), shades: new Uint8Array(out.glyphs.length) };
    last.glyphs.set(out.glyphs); last.shades.set(out.shades);
    if (xfade) {
      const thr = dissolveThresholds(out.glyphs.length);
      dissolveFrames(xfade, { glyphs: last.glyphs, shades: last.shades }, smoothstep(xfade.t / DISSOLVE_SECONDS), thr, out);
    }
    const show = skin.frame && skin.frame.show;
    if (show === 'always') drawChrome(out, skin);
    const overlay = (o) => {
      if (show === 'menu') drawChrome(o, skin);
      autoShown = auto === null ? null : Math.ceil(auto);
      drawMenu(o, { entries: entries(), index: menu.index, title: skin.menu && skin.menu.title, prompt: skin.menu && skin.menu.prompt, countdown: auto === null ? null : `starts by itself in ${autoShown} s` }, skin);
    };
    if (menu.p >= 1) overlay(out);
    else if (menu.p > 0) {
      const tmp = { glyphs: out.glyphs.slice(), shades: out.shades.slice(), cols: out.cols, rows: out.rows };
      overlay(tmp);
      dissolveFrames(out, tmp, menu.p, dissolveThresholds(out.glyphs.length), out);
    }
    forced = false;
    return out;
  }

  function resize(c, r) {
    cols = c; rows = r;
    if (cellComp) cellComp.resize(c, r);
    if (fieldComp) fieldComp.resize(c, r);
    xfade = null; last = null; forced = true;
  }

  return {
    actions, advance, frame, resize,
    palette: () => pal,
    entries,
    open: openMenu,
    touch() { menu.idle = 0; },
    // the countdown to the start of the program: begins when the menu opens on arrival, any key cancels it
    startAuto() { const n = skin.menu && skin.menu.autostartSeconds; if (menu.open && Number.isFinite(n)) { auto = n; autoShown = null; forced = true; } },
    cancelAuto() { if (auto !== null) { auto = null; forced = true; } },
    get autoLeft() { return auto; },
    // true when the next frame can differ from the last one
    needsFrame: () => forced || (!paused && !helpOpen) || (!helpOpen && (menu.p !== (menu.open ? 1 : 0) || !!xfade || !!seasonRamp)),
    state() {
      const prog = programs.get(cur);
      const st = prog.sched.state();
      const sc = prog.list[prog.indexes[st.a]];
      return { program: cur, sceneId: sc ? sc.id : null, menu: menu.open, help: helpOpen, paused, speed: SPEEDS[speedIdx], season, t };
    },
    get helpOpen() { return helpOpen; },
    get menuOpen() { return menu.open; },
  };
}
