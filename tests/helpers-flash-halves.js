// DRIFT-8 C2: must-fail controls that only a meter reading the two halves of a cell separately can see. Same shape as
// tests/helpers-flash-controls.js: `make(cols, rows, options) -> (t) => frame`, pure in t (seconds), the buffers reused.
//
// Every cell of these frames is an upper half block: the top pixel is the foreground, the bottom pixel is the background. A meter that
// blends the two halves into one value per cell reads the swap as "no change" (the average never moves).
import { safeHue } from '../src/pixels.js';
import { newFrame, runControl } from './helpers-flash-controls.js';
import { luminanceOf } from './helpers-flash.js';

const UPPER = 0x2580;

// The halves of every cell swap colours `hz` times a second (hz swaps' worth of cycles: two swaps per cycle). At 18 fps, hz = 9 is a swap on every frame.
export function halvesSwap(cols, rows, { hz = 4, a = 0xe0e0e0, b = 0x101010 } = {}) {
  const f = newFrame(cols, rows);
  f.glyphs.fill(UPPER);
  return (t) => { const on = Math.floor(t * hz * 2) % 2 === 0; f.fg.fill(on ? a : b); f.bg.fill(on ? b : a); return f; };
}

// The same swap through palette cells (shades 1 and 2 of a two-entry palette: white over black, black over white).
export const SWAP_PALETTE = { fgRgb: Uint32Array.of(0x000000, 0xffffff, 0x000000), bgRgb: Uint32Array.of(0x000000, 0x000000, 0xffffff) };
export function halvesSwapPalette(cols, rows, { hz = 4 } = {}) {
  const f = newFrame(cols, rows);
  f.glyphs.fill(UPPER);
  return (t) => { f.shades.fill(Math.floor(t * hz * 2) % 2 === 0 ? 1 : 2); return f; };
}

// A patch of w x h cells (corner x0, y0) whose TOP pixel flickers between light and dark `hz` times a second; the bottom pixel stays dark.
// The rest of the screen is dark. The cell average moves by half as much as the pixel does.
export function topFlicker(cols, rows, { w = 24, h = 6, x0 = 10, y0 = 5, hz = 4, hi = 0xe0e0e0, lo = 0x101010 } = {}) {
  const f = newFrame(cols, rows);
  return (t) => {
    f.glyphs.fill(32); f.fg.fill(lo); f.bg.fill(lo);
    const on = Math.floor(t * hz * 2) % 2 === 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = y * cols + x; f.glyphs[i] = UPPER; f.fg[i] = on ? hi : lo; }
    return f;
  };
}

// The two colours of the colour-only control: a teal and an amber at one lightness (safeHue holds the luminance within 0.011 of the other).
export const TEAL = safeHue(200, 0.66), AMBER = safeHue(60, 0.66);
export const TEAL_AMBER_DY = Math.abs(luminanceOf(TEAL) - luminanceOf(AMBER));

// 30 s (or `seconds`) of a generator through a fresh meter: the report.
export const runAt = (gen, cols, rows, { fps = 18, seconds = 10, palette = null, reduce256 = false } = {}) => runControl(gen, { cols, rows, fps, seconds, palette, reduce256 });

export const RULE_IDS = ['l1.x1', 'l1.x4', 'l2.x1', 'l2.x4', 'l3', 'r.x1', 'r.x4'];
export const ruleOf = (rep, id) => { const [a, b] = id.split('.'); return b ? rep[a][b] : rep[a]; };
