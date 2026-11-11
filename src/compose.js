// Cross-fade, scene scheduler, and the field -> cells composer.
import { RAMP_CODES, BANDS, LEVELS, createHysteresis } from './ramp.js';

export function smoothstep(x) {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

// How far each cell's own cross-fade is staggered from its neighbours (fraction
// of the fade). Without it, big flat areas of the same intensity cross a ramp
// band all in one frame and the screen flickers in bursts (10% of cells in one
// frame against a 3% average, measured). Staggered, the same crossings spread
// over the whole fade.
export const FADE_SPREAD = 0.25;

// Fixed per-cell offsets in [0, spread): a deterministic integer hash of the
// cell index, so captures and tests stay reproducible.
export function fadeOffsets(n, spread = FADE_SPREAD) {
  const off = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let h = Math.imul(i + 1, 0x9e3779b1);
    h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
    off[i] = ((h >>> 0) / 4294967296) * spread;
  }
  return off;
}

// out[i] = a[i] + (b[i]-a[i]) * p. p=0 gives exactly a, p=1 exactly b.
// With offsets (and their spread), cell i's own progress is
// clamp(p*(1+spread) - off[i]): still exactly a at p=0 and exactly b at p=1.
export function blend(a, b, p, out, off, spread = 0) {
  const n = out.length;
  if (p <= 0) { out.set(a.length === n ? a : a.subarray(0, n)); return out; }
  if (p >= 1) { out.set(b.length === n ? b : b.subarray(0, n)); return out; }
  if (off) {
    const q = p * (1 + spread);
    for (let i = 0; i < n; i++) {
      let pi = q - off[i];
      pi = pi < 0 ? 0 : pi > 1 ? 1 : pi;
      out[i] = a[i] + (b[i] - a[i]) * pi + 0.5;
    }
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = a[i] + (b[i] - a[i]) * p + 0.5;
  return out;
}

// Which scene is showing, and how far into the cross-fade to the next one.
// Time is whatever the caller advances it by (the app passes scene seconds).
export class Scheduler {
  constructor({ count, durationSec = 180, fadeSec = 5, start = 0, durations = null }) {
    this.count = count;
    this.durations = durations;
    this.duration = durationSec;
    this.fade = Math.max(fadeSec, 1e-6);
    this.cur = ((start % count) + count) % count;
    if (this.durations) this.duration = this.durations[this.cur];
    this.hold = 0;
    this.fadeT = 0;
    this.fading = false;
    this.pending = false;
  }

  advance(dt) {
    let rem = dt;
    let guard = 0;
    while (rem > 0 && guard++ < 10000) {
      if (!this.fading) {
        const left = this.duration - this.hold;
        if (rem < left) { this.hold += rem; rem = 0; }
        else { rem -= left; this.fading = true; this.fadeT = 0; this.hold = this.duration; }
      } else {
        const left = this.fade - this.fadeT;
        if (rem < left) { this.fadeT += rem; rem = 0; }
        else {
          rem -= left;
          this.cur = (this.cur + 1) % this.count;
          if (this.durations) this.duration = this.durations[this.cur];
          this.fading = false; this.fadeT = 0; this.hold = 0;
          if (this.pending) { this.pending = false; this.fading = true; this.hold = this.duration; }
        }
      }
    }
  }

  // Space: start the next cross-fade now; during a fade, queue exactly one.
  skip() {
    if (!this.fading) { this.fading = true; this.fadeT = 0; this.hold = this.duration; }
    else this.pending = true;
  }

  state() {
    return {
      a: this.cur,
      b: (this.cur + 1) % this.count,
      p: this.fading ? smoothstep(this.fadeT / this.fade) : 0,
      fading: this.fading,
    };
  }
}

// Builds glyph + shade arrays from scenes. All buffers are reused.
export function createComposer({ scenes, cols, rows, seed = 1, bandMargin = 7, levelMargin = 6 }) {
  const c = {
    cols: 0, rows: 0, field: null, glyphs: null, shades: null,
    resize, frame,
  };
  let bufA, bufB, maskA, maskB, mask, bandH, levelH, fadeOff;
  const params = { seed, out: null, glyphs: null };

  function resize(w, h) {
    const n = Math.max(0, w) * Math.max(0, h);
    c.cols = w; c.rows = h;
    bufA = new Uint8Array(n); bufB = new Uint8Array(n);
    maskA = new Uint8Array(n); maskB = new Uint8Array(n); mask = new Uint8Array(n);
    c.field = new Uint8Array(n);
    c.glyphs = new Uint16Array(n);
    c.shades = new Uint8Array(n);
    fadeOff = fadeOffsets(n);
    bandH = createHysteresis(n, BANDS, bandMargin);
    levelH = createHysteresis(n, LEVELS, levelMargin);
  }

  function draw(scene, t, buf, m) {
    params.out = buf;
    params.glyphs = scene.glyphs ? m : null;
    scene(t, c.cols, c.rows, params);
    return scene.glyphs;
  }

  // st = {a, b, p}; returns {cols, rows, field, glyphs, shades}
  function frame(st, t) {
    const n = c.cols * c.rows;
    const A = scenes[st.a];
    const hasA = draw(A, t, bufA, maskA);
    let field = bufA, m = hasA ? maskA : null;
    if (st.p > 0 && st.b !== st.a) {
      const B = scenes[st.b];
      const hasB = draw(B, t, bufB, maskB);
      blend(bufA, bufB, st.p, c.field, fadeOff, FADE_SPREAD);
      field = c.field;
      if (hasA || hasB) {
        // each cell takes the braille mask of whichever scene contributes more there
        const q = st.p * (1 + FADE_SPREAD);
        for (let i = 0; i < n; i++) {
          const ma = hasA ? maskA[i] : 0, mb = hasB ? maskB[i] : 0;
          let p = q - fadeOff[i];
          p = p < 0 ? 0 : p > 1 ? 1 : p;
          mask[i] = (bufA[i] * (1 - p) > bufB[i] * p) ? ma : mb;
        }
        m = mask;
      } else m = null;
    } else if (field !== c.field) {
      c.field.set(bufA);
      field = c.field;
    }
    const bands = bandH.update(field);
    const levels = levelH.update(field);
    const glyphs = c.glyphs, shades = c.shades;
    if (m) {
      for (let i = 0; i < n; i++) {
        const mk = m[i];
        glyphs[i] = mk ? 0x2800 | mk : RAMP_CODES[bands[i]];
        shades[i] = levels[i];
      }
    } else {
      for (let i = 0; i < n; i++) { glyphs[i] = RAMP_CODES[bands[i]]; shades[i] = levels[i]; }
    }
    return c;
  }

  resize(cols, rows);
  return c;
}
