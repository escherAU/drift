// Skin palette for a cartridge (DRIFT-4). Entries 0-15 are the skin's hue at the same 16 brightness
// levels Classic uses (shadeRGB / sgrFor), entries 16 and up are the skin's own fixed colours. With a
// background, every entry is its foreground plus the background SGR and `base` is the background
// SGR alone, which is exactly what the renderer's existing bg path expects.
import { parseHex, sgrFor, rgbTo256 } from '../color.js';
import { LEVELS } from '../ramp.js';

export const DEFAULT_UI = Object.freeze({ text: 15, dim: 7, head: 15, accent: 15 });

// WCAG relative luminance of an [r, g, b] colour (0 = black, 1 = white).
export function relLuminance(rgb) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

// Number of palette entries a skin gives (16 without a skin, or without extra colours).
export function paletteLength(skin) {
  const extra = skin && skin.palette && Array.isArray(skin.palette.colours) ? skin.palette.colours.length : 0;
  return LEVELS + extra;
}

const fgFixed = (rgb, mode) => (mode === 'truecolor' ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m` : `\x1b[38;5;${rgbTo256(rgb)}m`);
const bgFixed = (rgb, mode) => (mode === 'truecolor' ? `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m` : `\x1b[48;5;${rgbTo256(rgb)}m`);

// skin: a validated skin object (see validateSkin). cmode: 'truecolor' or '256'. key: the cartridge
// or skin id, which goes into the palette key so the renderer repaints when the palette changes.
export function makeSkinPalette(skin, cmode, key) {
  const p = skin.palette;
  const hue = parseHex(p.hue);
  const bgRgb = p.bg ? parseHex(p.bg) : null;
  const bgSgr = bgRgb ? bgFixed(bgRgb, cmode) : '';
  const sgr = [];
  for (let l = 0; l < LEVELS; l++) sgr.push(sgrFor(hue, l, cmode) + bgSgr);
  for (const c of p.colours || []) sgr.push(fgFixed(parseHex(c), cmode) + bgSgr);
  const pal = { key: `skin:${key}:${cmode}`, sgr, ui: { ...DEFAULT_UI, ...(p.ui || {}) } };
  if (bgRgb) { pal.bg = true; pal.base = bgSgr; }
  return pal;
}
