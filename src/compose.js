// Cross-fade, scene scheduler, and the field -> cells composer.
import { RAMP_CODES, BANDS, LEVELS, createHysteresis } from './ramp.js';

export function smoothstep(x) {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

// out[i] = a[i] + (b[i]-a[i]) * p. p=0 gives exactly a, p=1 exactly b.
export function blend(a, b, p, out) {
  const n = out.length;
  if (p <= 0) { out.set(a.length === n ? a : a.subarray(0, n)); return out; }
  if (p >= 1) { out.set(b.length === n ? b : b.subarray(0, n)); return out; }
  for (let i = 0; i < n; i++) out[i] = a[i] + (b[i] - a[i]) * p + 0.5;
  return out;
}

// Which scene is showing, and how far into the cross-fade to the next one.
// Time is whatever the caller advances it by (the app passes scene seconds).
export class Scheduler {
  constructor({ count, durationSec = 180, fadeSec = 5, start = 0 }) {
    this.count = count;
    this.duration = durationSec;
    this.fade = Math.max(fadeSec, 1e-6);
    this.cur = ((start % count) + count) % count;
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
  let bufA, bufB, maskA, maskB, mask, bandH, levelH;
  const params = { seed, out: null, glyphs: null };

  function resize(w, h) {
    const n = Math.max(0, w) * Math.max(0, h);
    c.cols = w; c.rows = h;
    bufA = new Uint8Array(n); bufB = new Uint8Array(n);
    maskA = new Uint8Array(n); maskB = new Uint8Array(n); mask = new Uint8Array(n);
    c.field = new Uint8Array(n);
    c.glyphs = new Uint16Array(n);
    c.shades = new Uint8Array(n);
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
      blend(bufA, bufB, st.p, c.field);
      field = c.field;
      if (hasA || hasB) {
        // each cell takes the braille mask of whichever scene contributes more there
        const p = st.p;
        for (let i = 0; i < n; i++) {
          const ma = hasA ? maskA[i] : 0, mb = hasB ? maskB[i] : 0;
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
