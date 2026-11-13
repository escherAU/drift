// Non-calm scenes feed the SAME {glyphs: Uint16Array, shades: Uint8Array} frame the
// renderer draws; here "shades" is a colour index into the mode's palette.
//
// Two scene kinds (calm scenes are neither: they stay field scenes, see compose.js):
//
//   kind 'cells'   scene(t, w, h, params) fills params.glyphs (Uint16Array w*h, code points
//                  from src/glyphs.js) and params.colours (Uint8Array w*h). Pure in t.
//                  Every cell must be written (blank = 32, colour 0). params.t0, when the
//                  composer supplies it, is the clock value when this scene became active, so
//                  a scene may run on t - t0 (the artist does: a visit starts at the first stroke).
//                  A scene with `rgb: true` (DRIFT-7, cells and sim only; see src/pixels.js) also gets params.fg and
//                  params.bg (Uint32Array w*h, 0xRRGGBB). The composer pre-fills its colours with RGB_CELL (255), which
//                  means "this cell's colours are in fg/bg"; the scene may still write a palette index into any cell.
//                  DRIFT-8: params.cmode is the colour mode the frame will be shown in, 'truecolor' or '256' (the names of
//                  detectColorMode in color.js), so a scene can pick colours that stay safe once snapped to the 256-colour cube.
//                  DRIFT-8 C3, the colour clock: the scene is pure in t and tc. params.tc is the colour clock, a second clock the shell's runtime
//                  keeps that runs at min(speed, 1) of real time (it stops with t when paused or when help is open), and params.tc0 is its
//                  value when this scene became active, just as t0 is for t, so a vision entered mid-program starts its colour time at 0 in
//                  its own frame. Every GLOBAL hue drift (a hue turning with the clock, whatever carries it) reads colourTime(t, params) from
//                  the cartridge's lib/clock.js (tc - tc0, or the scene time when no tc is given); motion (geometry, positions, rotation) keeps
//                  sceneTime. At 1x tc equals t, so a 1x frame is the same bytes with or without tc. The reason: at 4x a hue that turns with the
//                  scene clock turns four times as fast, a colour-only flicker the flash rules do not see. A caller that has no colour clock
//                  (a capture tool, a test) omits tc and params.tc is undefined. renderScene takes tc as its last argument.
//                  A palette scene gets the same buffers but no pre-fill, and its colours never reach the renderer's rgb branch.
//   kind 'sim'     { id, kind: 'sim', init(w, h, seed) -> state, step(state), draw(state, params) }
//                  step runs at a fixed 1/30 s. Same seed + same step count gives the same frame.
//                  draw fills params.glyphs / params.colours in full and never mutates state.
//
// createCellComposer owns the sim states, steps them from a time accumulator (at most MAX_STEPS = 8
// steps per frame: enough for 4x speed at 18 fps, never a spiral after a stall), and runs the
// transition between two scenes: a per-cell dissolve, never a whole-screen cut.
import { fadeOffsets } from './compose.js';
import { RGB_CELL } from './renderer.js';

export const STEP_HZ = 30;
export const STEP_DT = 1 / STEP_HZ;
export const MAX_STEPS = 8; // 4x speed at 18 fps wants 6.7 steps a frame; a stall (the app clamps dt to 0.25 s) is cut to this

export function sceneKind(scene) {
  return scene && scene.kind ? scene.kind : 'ramp';
}

function dims(w, h) {
  return [w > 0 ? Math.floor(w) : 0, h > 0 ? Math.floor(h) : 0];
}

// One frame of a scene from a fresh state (used by captures and the shared tests).
// Sims are stepped round(t * 30) times from init. Pass glyphs/colours/fg/bg to reuse buffers.
export function renderScene(scene, t, w, h, seed = 1, glyphs = null, colours = null, fg = null, bg = null, cmode = 'truecolor', tc) {
  const [W, H] = dims(w, h);
  const n = W * H;
  const g = glyphs && glyphs.length === n ? glyphs : new Uint16Array(n);
  const c = colours && colours.length === n ? colours : new Uint8Array(n);
  const F = fg && fg.length === n ? fg : new Uint32Array(n);
  const B = bg && bg.length === n ? bg : new Uint32Array(n);
  if (scene && scene.rgb === true) c.fill(RGB_CELL);
  const params = { seed, glyphs: g, colours: c, fg: F, bg: B, cmode: cmode === '256' ? '256' : 'truecolor' };
  if (Number.isFinite(tc)) params.tc = tc; // the colour clock (DRIFT-8 C3); no tc0, like no t0: it counts from 0
  const T = Number.isFinite(t) ? t : 0;
  if (sceneKind(scene) === 'sim') {
    const state = scene.init(W, H, seed);
    const steps = Math.min(100000, Math.max(0, Math.round(T * STEP_HZ)));
    for (let i = 0; i < steps; i++) scene.step(state);
    scene.draw(state, params);
  } else {
    scene(T, W, H, params);
  }
  return { glyphs: g, colours: c, fg: F, bg: B, cols: W, rows: H };
}

export function createCellComposer({ scenes, cols, rows, seed = 1, cmode = 'truecolor' }) {
  const c = {
    cmode: cmode === '256' ? '256' : 'truecolor', // handed to every scene as params.cmode
    cols: 0, rows: 0, glyphs: null, shades: null, fg: null, bg: null,
    resize, reset, frame,
    stepsLastFrame: 0, stepsTotal: 0,
  };
  let gA, cA, gB, cB, fA, bA, fB, bB, thr;
  let states = scenes.map(() => null);
  let since = scenes.map(() => null); // clock value when each scene became active (its visit started)
  let sinceC = scenes.map(() => null); // the colour clock's value at the same moment (DRIFT-8 C3), so a vision's colour time is scene-local too
  let acc = 0, lastT = null;
  const params = { seed, glyphs: null, colours: null, fg: null, bg: null, cmode: c.cmode, tc: undefined, tc0: undefined };
  let TC = null; // the colour clock of the frame being drawn, or null when the caller gave none

  function resize(w, h) {
    const [W, H] = dims(w, h);
    const n = W * H;
    c.cols = W; c.rows = H;
    c.glyphs = new Uint16Array(n); c.shades = new Uint8Array(n);
    c.fg = new Uint32Array(n); c.bg = new Uint32Array(n);
    gA = new Uint16Array(n); cA = new Uint8Array(n); fA = new Uint32Array(n); bA = new Uint32Array(n);
    gB = new Uint16Array(n); cB = new Uint8Array(n); fB = new Uint32Array(n); bB = new Uint32Array(n);
    // per-cell flip thresholds in (0, 1): at p = 0 no cell has flipped, at p = 1 all have
    thr = fadeOffsets(n, 0.98);
    for (let i = 0; i < n; i++) thr[i] += 0.01;
    states = scenes.map(() => null);
    since = scenes.map(() => null);
    sinceC = scenes.map(() => null);
    acc = 0;
  }

  function reset(t) {
    states = scenes.map(() => null);
    since = scenes.map(() => null);
    sinceC = scenes.map(() => null);
    acc = 0;
    lastT = Number.isFinite(t) ? t : null;
  }

  function stateOf(idx) {
    if (states[idx] === null && sceneKind(scenes[idx]) === 'sim') states[idx] = scenes[idx].init(c.cols, c.rows, seed);
    return states[idx];
  }

  function drawInto(idx, t, g, col, fg, bg) {
    const scene = scenes[idx];
    params.glyphs = g; params.colours = col; params.fg = fg; params.bg = bg;
    if (scene.rgb === true) col.fill(RGB_CELL); // full-colour cells say so by default; the scene may overwrite any with a palette index
    params.t0 = since[idx] === null ? t : since[idx]; // scene-local time: cells scenes may use t - t0
    params.tc = TC === null ? undefined : TC; // the colour clock and its scene-local zero (colourTime in a cartridge's lib/clock.js)
    params.tc0 = TC === null ? undefined : (sinceC[idx] === null ? TC : sinceC[idx]);
    if (sceneKind(scene) === 'sim') scene.draw(stateOf(idx), params);
    else scene(t, c.cols, c.rows, params);
  }

  // st = {a, b, p}; t = scene seconds; tc = colour seconds (optional: at 1x it is t, and a caller that gives none draws as if it were).
  // Returns c ({cols, rows, glyphs, shades, fg, bg}).
  function frame(st, t, tc) {
    const T = Number.isFinite(t) ? t : 0;
    TC = Number.isFinite(tc) ? tc : null;
    const dissolving = st.p > 0 && st.b !== st.a;
    for (let i = 0; i < states.length; i++) {
      if (i !== st.a && !(dissolving && i === st.b)) { states[i] = null; since[i] = null; sinceC[i] = null; } // inactive scenes start fresh next time
    }
    if (since[st.a] === null) { since[st.a] = T; sinceC[st.a] = TC === null ? T : TC; }
    if (dissolving && since[st.b] === null) { since[st.b] = T; sinceC[st.b] = TC === null ? T : TC; }
    // time -> fixed steps, capped
    if (lastT === null) lastT = T;
    let dt = T - lastT;
    lastT = T;
    if (!(dt > 0)) dt = 0;
    acc += dt;
    let n = Math.floor(acc * STEP_HZ + 1e-9);
    if (n > MAX_STEPS) { n = MAX_STEPS; acc = 0; } else acc -= n * STEP_DT;
    stateOf(st.a);
    if (dissolving) stateOf(st.b);
    for (let k = 0; k < n; k++) {
      if (states[st.a]) scenes[st.a].step(states[st.a]);
      if (dissolving && states[st.b]) scenes[st.b].step(states[st.b]);
    }
    c.stepsLastFrame = n;
    c.stepsTotal += n;

    if (!dissolving) {
      drawInto(st.a, T, c.glyphs, c.shades, c.fg, c.bg);
      return c;
    }
    drawInto(st.a, T, gA, cA, fA, bA);
    drawInto(st.b, T, gB, cB, fB, bB);
    const p = st.p, len = c.glyphs.length;
    const g = c.glyphs, s = c.shades;
    if (scenes[st.a].rgb === true || scenes[st.b].rgb === true) {
      // a full-colour scene is in the mix: each cell takes its colours with its glyph and shade
      const f = c.fg, b = c.bg;
      for (let i = 0; i < len; i++) {
        if (p >= thr[i]) { g[i] = gB[i]; s[i] = cB[i]; f[i] = fB[i]; b[i] = bB[i]; } else { g[i] = gA[i]; s[i] = cA[i]; f[i] = fA[i]; b[i] = bA[i]; }
      }
      return c;
    }
    for (let i = 0; i < len; i++) {
      if (p >= thr[i]) { g[i] = gB[i]; s[i] = cB[i]; } else { g[i] = gA[i]; s[i] = cA[i]; }
    }
    return c;
  }

  resize(cols, rows);
  return c;
}
