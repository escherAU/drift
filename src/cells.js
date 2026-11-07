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
//   kind 'sim'     { id, kind: 'sim', init(w, h, seed) -> state, step(state), draw(state, params) }
//                  step runs at a fixed 1/30 s. Same seed + same step count gives the same frame.
//                  draw fills params.glyphs / params.colours in full and never mutates state.
//
// createCellComposer owns the sim states, steps them from a time accumulator (at most MAX_STEPS = 8
// steps per frame: enough for 4x speed at 18 fps, never a spiral after a stall), and runs the
// transition between two scenes: a per-cell dissolve, never a whole-screen cut.
import { fadeOffsets } from './compose.js';

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
// Sims are stepped round(t * 30) times from init. Pass glyphs/colours to reuse buffers.
export function renderScene(scene, t, w, h, seed = 1, glyphs = null, colours = null) {
  const [W, H] = dims(w, h);
  const n = W * H;
  const g = glyphs && glyphs.length === n ? glyphs : new Uint16Array(n);
  const c = colours && colours.length === n ? colours : new Uint8Array(n);
  const params = { seed, glyphs: g, colours: c };
  const T = Number.isFinite(t) ? t : 0;
  if (sceneKind(scene) === 'sim') {
    const state = scene.init(W, H, seed);
    const steps = Math.min(100000, Math.max(0, Math.round(T * STEP_HZ)));
    for (let i = 0; i < steps; i++) scene.step(state);
    scene.draw(state, params);
  } else {
    scene(T, W, H, params);
  }
  return { glyphs: g, colours: c, cols: W, rows: H };
}

export function createCellComposer({ scenes, cols, rows, seed = 1 }) {
  const c = {
    cols: 0, rows: 0, glyphs: null, shades: null,
    resize, reset, frame,
    stepsLastFrame: 0, stepsTotal: 0,
  };
  let gA, cA, gB, cB, thr;
  let states = scenes.map(() => null);
  let since = scenes.map(() => null); // clock value when each scene became active (its visit started)
  let acc = 0, lastT = null;
  const params = { seed, glyphs: null, colours: null };

  function resize(w, h) {
    const [W, H] = dims(w, h);
    const n = W * H;
    c.cols = W; c.rows = H;
    c.glyphs = new Uint16Array(n); c.shades = new Uint8Array(n);
    gA = new Uint16Array(n); cA = new Uint8Array(n);
    gB = new Uint16Array(n); cB = new Uint8Array(n);
    // per-cell flip thresholds in (0, 1): at p = 0 no cell has flipped, at p = 1 all have
    thr = fadeOffsets(n, 0.98);
    for (let i = 0; i < n; i++) thr[i] += 0.01;
    states = scenes.map(() => null);
    since = scenes.map(() => null);
    acc = 0;
  }

  function reset(t) {
    states = scenes.map(() => null);
    since = scenes.map(() => null);
    acc = 0;
    lastT = Number.isFinite(t) ? t : null;
  }

  function stateOf(idx) {
    if (states[idx] === null && sceneKind(scenes[idx]) === 'sim') states[idx] = scenes[idx].init(c.cols, c.rows, seed);
    return states[idx];
  }

  function drawInto(idx, t, g, col) {
    const scene = scenes[idx];
    params.glyphs = g; params.colours = col;
    params.t0 = since[idx] === null ? t : since[idx]; // scene-local time: cells scenes may use t - t0
    if (sceneKind(scene) === 'sim') scene.draw(stateOf(idx), params);
    else scene(t, c.cols, c.rows, params);
  }

  // st = {a, b, p}; t = scene seconds. Returns c ({cols, rows, glyphs, shades}).
  function frame(st, t) {
    const T = Number.isFinite(t) ? t : 0;
    const dissolving = st.p > 0 && st.b !== st.a;
    for (let i = 0; i < states.length; i++) {
      if (i !== st.a && !(dissolving && i === st.b)) { states[i] = null; since[i] = null; } // inactive scenes start fresh next time
    }
    if (since[st.a] === null) since[st.a] = T;
    if (dissolving && since[st.b] === null) since[st.b] = T;
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
      drawInto(st.a, T, c.glyphs, c.shades);
      return c;
    }
    drawInto(st.a, T, gA, cA);
    drawInto(st.b, T, gB, cB);
    const p = st.p, len = c.glyphs.length;
    const g = c.glyphs, s = c.shades;
    for (let i = 0; i < len; i++) {
      if (p >= thr[i]) { g[i] = gB[i]; s[i] = cB[i]; } else { g[i] = gA[i]; s[i] = cA[i]; }
    }
    return c;
  }

  resize(cols, rows);
  return c;
}
