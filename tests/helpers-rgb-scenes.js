// Fixture scenes for the full-colour branches of the scene checks (DRIFT-7 C4b). Each is a cells scene
// scene(t, w, h, params), pure in t unless it says otherwise. The "good" ones must pass every check in
// tests/helpers-scene-checks.js; each "bad" one breaks exactly one rule and a test asserts that check throws.
import { safeKaleidoscope, hueOnly, pack } from './helpers-flash-controls.js';
import { PALETTE_BG } from '../src/renderer.js';

const X = 88; // 'X'

function make(id, fn, rgb = true) {
  fn.id = id; fn.kind = 'cells';
  if (rgb) fn.rgb = true;
  return fn;
}

// A generator `make(cols, rows) -> (t) => frame` (tests/helpers-flash-controls.js) as a full-colour scene.
export function sceneFromGenerator(id, gen) {
  const cache = new Map();
  return make(id, (t, w, h, params) => {
    const key = w + 'x' + h;
    let g = cache.get(key);
    if (!g) { g = gen(w, h); cache.set(key, g); }
    const f = g(t);
    params.glyphs.set(f.glyphs); params.fg.set(f.fg); params.bg.set(f.bg);
  });
}

// ---- good scenes
export const kaleidoscope = () => sceneFromGenerator('rgb-kaleidoscope', safeKaleidoscope);
export const hueSweep = () => sceneFromGenerator('rgb-hue-sweep', hueOnly);

// A sparse fixed glyph pattern every scene below shares: 1 cell in 3 draws an X, the rest are blank.
const inked = (i, w) => (i + Math.floor(i / w)) % 3 === 0;

// Glyphs never change; fg and bg change with time (a slow hue drift). NOT frozen.
export function colourDrift() {
  return make('rgb-colour-drift', (t, w, h, params) => {
    const n = w * h, k = Math.floor(t * 4) % 200;
    for (let i = 0; i < n; i++) {
      params.glyphs[i] = inked(i, w) ? X : 32;
      params.fg[i] = pack(60 + k, 120, 255 - k);
      params.bg[i] = pack(16, 16 + (k >> 2), 32);
    }
  });
}

// ---- bad scenes
// Glyphs, fg and bg all constant: frozen.
export function frozenRgb() {
  return make('rgb-frozen', (t, w, h, params) => {
    const n = w * h;
    for (let i = 0; i < n; i++) { params.glyphs[i] = inked(i, w) ? X : 32; params.fg[i] = 0x80c0ff; params.bg[i] = 0x101010; }
  });
}

// fg depends on how many times the scene was called: not deterministic.
export function nondeterministicFg() {
  let calls = 0;
  return make('rgb-nondeterministic', (t, w, h, params) => {
    calls++;
    const n = w * h;
    for (let i = 0; i < n; i++) { params.glyphs[i] = inked(i, w) ? X : 32; params.fg[i] = pack(40 + (calls * 7) % 200, 100, 200); params.bg[i] = 0x101010; }
  });
}

// The whole field flips between light and dark four times a second.
export function strobingRgb() {
  return make('rgb-strobe', (t, w, h, params) => {
    const n = w * h, lit = Math.floor(t * 8) % 2 === 0;
    for (let i = 0; i < n; i++) { params.glyphs[i] = inked(i, w) ? X : 32; params.fg[i] = 0x808080; params.bg[i] = lit ? 0xe0e0e0 : 0x101010; }
  });
}

// Writes the colour 255 into every cell. With rgb: true that means "my colours are in fg/bg"; without it, it is a
// palette index past the end of any palette.
export function writes255(rgb) {
  return make(rgb ? 'rgb-255-flagged' : 'palette-255', (t, w, h, params) => {
    const n = w * h;
    for (let i = 0; i < n; i++) {
      params.glyphs[i] = inked(i, w) ? X : 32; params.colours[i] = 255;
      if (rgb) { params.fg[i] = 0x80c0ff; params.bg[i] = 0x101010; }
    }
  }, rgb);
}

// Colour fields out of range: value is written to fg (or bg) of every cell.
export function wideField(field, value) {
  return make(`rgb-${field}-${value.toString(16)}`, (t, w, h, params) => {
    const n = w * h;
    for (let i = 0; i < n; i++) { params.glyphs[i] = inked(i, w) ? X : 32; params.fg[i] = 0x80c0ff; params.bg[i] = 0x101010; params[field][i] = value; }
  });
}
export const paletteBgScene = () => wideField('bg', PALETTE_BG);

// Leaves one buffer unwritten for every second cell: stale data in a reused buffer shows through.
export function partialWriter(field) {
  return make(`rgb-partial-${field}`, (t, w, h, params) => {
    const n = w * h;
    for (let i = 0; i < n; i++) {
      params.glyphs[i] = inked(i, w) ? X : 32;
      if (field !== 'fg' || i % 2 === 0) params.fg[i] = 0x80c0ff;
      if (field !== 'bg' || i % 2 === 0) params.bg[i] = 0x101010;
    }
  });
}

// Written for a landscape screen: it only writes the first 20 rows' worth of cells (w * 20), so on a 60x20 screen it writes
// everything and on a 30x40 screen (same cell count) the lower half keeps whatever the buffers held.
export function landscapeOnly() {
  return make('rgb-landscape-only', (t, w, h, params) => {
    const n = Math.min(w * h, w * 20);
    for (let i = 0; i < n; i++) { params.glyphs[i] = inked(i, w) ? X : 32; params.fg[i] = 0x80c0ff; params.bg[i] = 0x101010; }
    for (let i = n; i < w * h; i++) params.glyphs[i] = 32;
  });
}

// The mirror of landscapeOnly: writes fg/bg only when the screen is at least as tall as wide, so it is stale at 60x20.
export function portraitOnly() {
  return make('rgb-portrait-only', (t, w, h, params) => {
    for (let i = 0; i < w * h; i++) { params.glyphs[i] = inked(i, w) ? X : 32; if (h >= w) { params.fg[i] = 0x80c0ff; params.bg[i] = 0x101010; } }
  });
}

// fg depends on the seed (and on nothing else): deterministic, but not seed independent.
export function seedFg() {
  return make('rgb-seed-fg', (t, w, h, params) => {
    const n = w * h;
    for (let i = 0; i < n; i++) { params.glyphs[i] = inked(i, w) ? X : 32; params.fg[i] = pack(40 + (params.seed * 31) % 200, 100, 200); params.bg[i] = 0x101010; }
  });
}

// fg depends on the seed AND on how often the scene was called: not deterministic, and the seed moves only the colours.
export function nondeterministicSeedFg() {
  let calls = 0;
  return make('rgb-nondeterministic-seed-fg', (t, w, h, params) => {
    calls++;
    const n = w * h;
    for (let i = 0; i < n; i++) { params.glyphs[i] = inked(i, w) ? X : 32; params.fg[i] = pack(40 + (params.seed * 31 + calls * 7) % 200, 100, 200); params.bg[i] = 0x101010; }
  });
}

// The whole screen is one flat look (same glyph, fg and bg in every cell), changing colour with time so it is not frozen.
export function flatRgb() {
  return make('rgb-flat', (t, w, h, params) => {
    const n = w * h, v = 64 + (Math.floor(t) % 100);
    for (let i = 0; i < n; i++) { params.glyphs[i] = X; params.fg[i] = pack(v, v, v); params.bg[i] = 0x101010; }
  });
}

// A palette scene that (needlessly) scribbles over fg/bg: with no rgb flag the checks must not look at them.
export function paletteScribbler() {
  return make('palette-scribbler', (t, w, h, params) => {
    const n = w * h;
    for (let i = 0; i < n; i++) { params.glyphs[i] = inked(i, w) ? X : 32; params.colours[i] = 3; params.fg[i] = 0x7fffffff; params.bg[i] = 0x7fffffff; }
  }, false);
}

// A palette scene that strobes: lit <-> blank every quarter second.
export function paletteStrobe() {
  return make('palette-strobe', (t, w, h, params) => {
    const n = w * h, on = Math.floor(t * 8) % 2 === 0;
    for (let i = 0; i < n; i++) { params.glyphs[i] = on ? X : 32; params.colours[i] = on ? 7 : 0; }
  }, false);
}
