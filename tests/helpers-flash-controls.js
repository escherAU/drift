// Must-fail (and must-pass) scene generators for the full-colour flash meter (DRIFT-7 C4a).
//
// Every generator is `make(cols, rows, options) -> (t) => frame`, pure in t (seconds). The frame is the buffer set
// a full-colour scene fills: { cols, rows, glyphs: Uint16Array, shades: Uint8Array (all RGB_CELL = 255),
// fg: Uint32Array, bg: Uint32Array } (0xRRGGBB). The buffers are reused from call to call, as the engine reuses
// its pooled frames; the meter copies what it needs. `runControl` feeds 30 s at 18 fps into a meter.
//
// Only this fixture imports src/pixels.js (for safeHue, the colour function the safe kaleidoscope is made of),
// src/color.js (rgbTo256) and src/renderer.js (nearest256), for the 256-colour reduction. The meter imports nothing from src.
import { safeHue } from '../src/pixels.js';
import { rgbTo256 } from '../src/color.js';
import { nearest256 } from '../src/renderer.js';
import { createFlashMeter } from './helpers-flash.js';
import { createCellComposer } from '../src/cells.js';

export const CONTROL_COLS = 120;
export const CONTROL_ROWS = 40;
export const CONTROL_FPS = 18;
export const CONTROL_SECONDS = 30;

const UPPER = 0x2580;
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const pack = (r, g, b) => (clamp8(r) << 16) | (clamp8(g) << 8) | clamp8(b);

export function newFrame(cols, rows) {
  const n = cols * rows;
  return { cols, rows, glyphs: new Uint16Array(n).fill(32), shades: new Uint8Array(n).fill(255), fg: new Uint32Array(n), bg: new Uint32Array(n) };
}

// pix: Uint32Array(cols * 2rows), row major. Two stacked pixels per cell: equal halves are a space in that colour,
// otherwise the upper half block (top = fg, bottom = bg).
function pixelsToFrame(pix, f) {
  const { cols, rows, glyphs, fg, bg } = f;
  for (let y = 0; y < rows; y++) {
    const t0 = 2 * y * cols, b0 = t0 + cols;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, top = pix[t0 + x], bot = pix[b0 + x];
      if (top === bot) { glyphs[i] = 32; fg[i] = top; bg[i] = top; } else { glyphs[i] = UPPER; fg[i] = top; bg[i] = bot; }
    }
  }
}

function fillSolid(f, bgColour) {
  f.glyphs.fill(32); f.bg.fill(bgColour); f.fg.fill(bgColour);
}

export function hsv(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), fr = h * 6 - i, p = v * (1 - s), q = v * (1 - fr * s), u = v * (1 - (1 - fr) * s);
  const [r, g, b] = [[v, u, p], [q, v, p], [p, v, u], [p, q, v], [u, p, v], [v, p, q]][i % 6];
  return pack(r * 255, g * 255, b * 255);
}

// OKLCH at fixed lightness L and chroma C, hue in turns, chroma reduced until the colour is in gamut. NOT red-safe:
// this is the "same brightness" colour function a scene author would write without safeHue.
const enc = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export function oklch(L, C, hTurns) {
  const h = hTurns * 2 * Math.PI;
  for (let k = 0; k < 8; k++, C *= 0.8) {
    const a = C * Math.cos(h), b = C * Math.sin(h);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    if (r >= 0 && r <= 1 && g >= 0 && g <= 1 && bl >= 0 && bl <= 1) return pack(enc(r) * 255, enc(g) * 255, enc(bl) * 255);
  }
  const v = enc(L ** 3) * 255; return pack(v, v, v);
}

// ---- controls ----------------------------------------------------------------------------------------

// Whole field flips between a light and a dark grey `hz` times a second (two changes per cycle).
export function strobe(cols, rows, { hz = 4 } = {}) {
  const f = newFrame(cols, rows);
  return (t) => { fillSolid(f, Math.floor(t * hz * 2) % 2 === 0 ? 0xe0e0e0 : 0x101010); return f; };
}

// Whole field rises and falls once every `period` seconds (cosine), a tinted grey 20..200.
export function bloom(cols, rows, { period = 2 } = {}) {
  const f = newFrame(cols, rows);
  return (t) => { const k = (1 - Math.cos(2 * Math.PI * t / period)) / 2; const v = 20 + 180 * k; fillSolid(f, pack(v, v * 0.6, v * 0.9)); return f; };
}

// Whole field flips between saturated red and a dark red `hz` times a second.
export function redPulse(cols, rows, { hz = 2 } = {}) {
  const f = newFrame(cols, rows);
  return (t) => { fillSolid(f, Math.floor(t * hz * 2) % 2 === 0 ? 0xd01010 : 0x200808); return f; };
}

// Smooth full-screen moving gradient (every pixel moves a few colour units a frame).
export function gradient(cols, rows) {
  const f = newFrame(cols, rows), W = cols, H = rows * 2, pix = new Uint32Array(W * H);
  return (t) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      pix[y * W + x] = pack(128 + 100 * Math.sin(6.3 * u + 0.6 * t), 128 + 100 * Math.sin(5.1 * v + 0.45 * t + 2), 128 + 100 * Math.sin(4 * (u + v) + 0.3 * t + 4));
    }
    pixelsToFrame(pix, f);
    return f;
  };
}

// Six-fold rotating, breathing kaleidoscope. `colourOf(hueTurns, p)` picks each pixel's colour.
function kaleidoscope(cols, rows, colourOf, { rotHz, hueHz }) {
  const f = newFrame(cols, rows), W = cols, H = rows * 2, pix = new Uint32Array(W * H);
  const seg = Math.PI / 3, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2;
  const rr = new Float64Array(W * H), aa = new Float64Array(W * H); // static per pixel: radius and angle
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - cx, dy = y - cy;
    rr[y * W + x] = Math.sqrt(dx * dx + dy * dy) / R; aa[y * W + x] = Math.atan2(dy, dx);
  }
  return (t) => {
    const rot = t * rotHz * 2 * Math.PI;
    for (let i = 0; i < W * H; i++) {
      const r = rr[i];
      let a = aa[i] + rot;
      a = ((a % seg) + seg) % seg; a = Math.abs(a - seg / 2);
      const p = Math.sin(r * 14 - t * 1.4) + Math.sin(a * 9 + r * 6 + t * 0.7) + 0.6 * Math.sin((r * Math.cos(a * 3)) * 18 - t);
      pix[i] = colourOf(p * 0.18 + t * hueHz + r * 0.25, p);
    }
    pixelsToFrame(pix, f);
    return f;
  };
}

// Colour from hue quantised to 1/720 turn, memoised (the iso colour functions are slow).
function memo(fn) {
  const cache = new Uint32Array(720).fill(0xffffffff);
  return (h) => { const k = Math.round((((h % 1) + 1) % 1) * 720) % 720; let v = cache[k]; if (v === 0xffffffff) { v = fn(k / 720); cache[k] = v; } return v; };
}

// Brightness varies with hue and with the pattern (HSV, V swings 0.15..0.95): the classic bad kaleidoscope.
export function hsvKaleidoscope(cols, rows, { rotHz = 0.3, hueHz = 1.5 } = {}) {
  return kaleidoscope(cols, rows, (h, p) => hsv(h, 0.85, 0.55 + 0.4 * Math.sin(p * 1.7)), { rotHz, hueHz });
}
// Same motion and hue sweep at one fixed OKLab lightness (a same-brightness change) but NOT red-safe:
// the sweep passes through saturated red.
export function isoKaleidoscope(cols, rows, { rotHz = 0.3, hueHz = 1.5 } = {}) {
  const c = memo((h) => oklch(0.62, 0.16, h));
  return kaleidoscope(cols, rows, (h) => c(h), { rotHz, hueHz });
}
// The same pattern with src/pixels.js safeHue: same brightness, linear red share kept under 0.75.
export function safeKaleidoscope(cols, rows, { rotHz = 0.3, hueHz = 1.5 } = {}) {
  const c = memo((h) => safeHue(h * 360, 0.62));
  return kaleidoscope(cols, rows, (h) => c(h), { rotHz, hueHz });
}

// A patch of w x h cells (top-left corner at x0, y0) flips between light and dark `hz` times a second on a steady
// dark field. Free while the patch covers under 25% of any field.
export function pop(cols, rows, { w = 20, h = 6, x0 = 10, y0 = 5, hz = 4 } = {}) {
  const f = newFrame(cols, rows);
  return (t) => {
    fillSolid(f, 0x101010);
    const on = Math.floor(t * hz * 2) % 2 === 0;
    if (on) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { f.bg[y * cols + x] = 0xe0e0e0; f.fg[y * cols + x] = 0xe0e0e0; }
    return f;
  };
}

// Hue sweeps back and forth over greens, cyans and blues (no red) at 1.5 Hz, brightness held at OKLab L 0.62.
export function hueOnly(cols, rows, { hz = 1.5 } = {}) {
  const f = newFrame(cols, rows), cache = new Map();
  return (t) => {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const k = Math.round((0.55 + 0.2 * Math.sin(2 * Math.PI * hz * t + x * 0.05)) * 200);
      let c = cache.get(k); if (c === undefined) { c = oklch(0.62, 0.1, k / 200); cache.set(k, c); }
      f.bg[y * cols + x] = c; f.fg[y * cols + x] = c;
    }
    return f;
  };
}

// L3 controls. Before `at` seconds every cell is dark; from then on the first `count` cells (row-major) are light.
// `count` cells jump by dY ~0.74 in ONE frame step and then stay: one transition per cell, never a repeat.
export function oneStep(cols, rows, { count, at = 1 } = {}) {
  const f = newFrame(cols, rows);
  return (t) => {
    fillSolid(f, 0x101010);
    if (t >= at) for (let i = 0; i < count; i++) { f.bg[i] = 0xe0e0e0; f.fg[i] = 0xe0e0e0; }
    return f;
  };
}
// Every cell changes hue in one step at `at` seconds, brightness unchanged (two colours of equal relative luminance).
export function hueStep(cols, rows, { at = 1 } = {}) {
  const f = newFrame(cols, rows);
  const a = 0x3a7a3a, b = 0x4a6ab2; // not red; luminance checked in the test (|dY| well under 0.10)
  return (t) => { fillSolid(f, t >= at ? b : a); return f; };
}

// ---- running a control ---------------------------------------------------------------------------------

// Reduce a frame to the 256-colour cube/greys the way renderRgb does in mode '256': full-colour cells go through the
// renderer's own nearest256 (OKLab distance), palette tables use the palette's own fg256/bg256 indexes, both mapped
// back to the RGB that index shows. PALETTE_BG passes through (the meter resolves it to bgRgb[0], as the renderer
// resolves it to bg256[0]). Hand-made palettes with no 256 tables fall back to rgbTo256.
export function rgbOf256(i) {
  if (i >= 232) { const g = 8 + (i - 232) * 10; return (g << 16) | (g << 8) | g; }
  if (i < 16) throw new Error('rgbTo256 never returns the 16 system colours');
  const CUBE = [0, 95, 135, 175, 215, 255], k = i - 16;
  return (CUBE[Math.floor(k / 36)] << 16) | (CUBE[Math.floor(k / 6) % 6] << 8) | CUBE[k % 6];
}
const to256 = (c) => rgbOf256(nearest256(c));
const toTable = (p, rgb, idx) => (p[idx] ? Array.from(p[idx], rgbOf256) : Array.from(p[rgb], (c) => rgbOf256(rgbTo256([(c >> 16) & 255, (c >> 8) & 255, c & 255])))); // fallback: hand-made palettes without 256 tables
export function makeReducer256(cols, rows) {
  const out = newFrame(cols, rows), cache = new Map(), palettes = new WeakMap();
  const near = (c) => { let v = cache.get(c); if (v === undefined) { v = to256(c); cache.set(c, v); } return v; };
  return (frame, palette) => {
    const n = cols * rows;
    out.glyphs.set(frame.glyphs.subarray(0, n)); out.shades.set(frame.shades.subarray(0, n));
    for (let i = 0; i < n; i++) {
      out.fg[i] = near(frame.fg[i]);
      out.bg[i] = frame.bg[i] >= 0x1000000 ? frame.bg[i] : near(frame.bg[i]);
    }
    let pal = palette;
    if (palette) {
      pal = palettes.get(palette);
      if (!pal) { pal = { fgRgb: toTable(palette, 'fgRgb', 'fg256'), bgRgb: toTable(palette, 'bgRgb', 'bg256') }; palettes.set(palette, pal); }
    }
    return { frame: out, palette: pal };
  };
}

// DRIFT-8 C1: the one way a flash test gets a cell composer and the reducer that goes with it. A scene can draw differently per
// colour mode (params.cmode, set by the composer), so a test that judges 256-colour output must run a composer built for 256
// colours: flashRig builds both from one `mode`, and reducerFor refuses a composer of the other mode (it cannot be misused to
// feed a truecolor composer's frames through the 256-colour reducer and call that a 256-colour test).
export function composerFor(scenes, cols, rows, { seed = 1, mode = 'truecolor' } = {}) {
  if (mode !== 'truecolor' && mode !== '256') throw new Error(`composerFor: unknown colour mode '${mode}'`);
  return createCellComposer({ scenes, cols, rows, seed, cmode: mode });
}
export function reducerFor(cc, mode, cols, rows) {
  if (cc.cmode !== mode) throw new Error(`reducerFor: a ${mode} test was handed a ${cc.cmode} composer`);
  return mode === '256' ? makeReducer256(cols, rows) : null;
}
// { cc, mode, show(frame) -> { frame, palette } as that mode shows it }. Push `s.frame, s.palette` into the meter.
export function flashRig(scenes, cols, rows, { seed = 1, mode = 'truecolor' } = {}) {
  const cc = composerFor(scenes, cols, rows, { seed, mode });
  const reduce = reducerFor(cc, mode, cols, rows);
  return { cc, mode, reduce, show: (f) => (reduce ? reduce(f, null) : { frame: f, palette: undefined }) };
}

// DRIFT-8 C4: the colour clock the runtime would hold when a replay stands at scene time t with the speed key at `speed` all along. src/shell/runtime.js advances the scene
// clock by dt * speed and the colour clock by dt * min(speed, 1) (so hue turns at its 1x rate at every speed: C3), hence tc = t * min(speed, 1) / speed. Every flash
// replay at a speed above 1x drives its frames through frameAtSpeed (one helper, so no test can forget the clock, which is the bug the 4x replays had before C4:
// they passed tc = nothing, the scene read its hue off the fast scene clock, and Rosette at 4x turned hue four times too fast for rule C).
export const colourClockAt = (t, speed = 1) => (t * Math.min(speed, 1)) / speed;
export function frameAtSpeed(cc, st, t, speed = 1) { return cc.frame(st, t, colourClockAt(t, speed)); }

// Feeds `seconds` of the generator (frame k at t = k / fps) into a fresh meter and returns report().
export function runControl(gen, { cols = CONTROL_COLS, rows = CONTROL_ROWS, fps = CONTROL_FPS, seconds = CONTROL_SECONDS, palette = null, reduce256 = false } = {}) {
  const meter = createFlashMeter(cols, rows, fps);
  const reduce = reduce256 ? makeReducer256(cols, rows) : null;
  const N = Math.round(seconds * fps);
  for (let k = 0; k <= N; k++) {
    const frame = gen(k / fps);
    if (reduce) { const r = reduce(frame, palette); meter.push(r.frame, r.palette); } else meter.push(frame, palette);
  }
  return meter.report();
}
