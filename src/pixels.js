// Full-colour helpers for scenes that set rgb: true (DRIFT-7). Imported by cartridge scene code, so it
// stays pure: no I/O, no globals beyond its own tables, no per-call allocation in the hot calls.
//
// A full-colour scene fills params.glyphs (Uint16Array), params.colours (Uint8Array), params.fg and
// params.bg (Uint32Array, 0xRRGGBB). A cell whose colours entry is RGB_CELL (255) takes its colour from
// fg/bg; any other value is a palette index as before.
//
//   RGB_CELL, PALETTE_BG                       re-exported from renderer.js (one definition)
//
//   pixelsToCells(params, cols, rows, pixels, pw, ph, ox = 0, oy = 0)
//       pixels: Uint32Array pw*ph of 0xRRGGBB, row-major. Pixel (x, y) lands in cell (ox + x, oy + floor(y / 2)):
//       ox and oy are CELL offsets (may be negative); cells outside cols x rows are skipped. Each cell is
//       U+2580 (upper half block) with fg = top pixel, bg = bottom pixel. Equal halves become a space with
//       bg = that colour (fg set to the same value, irrelevant). With an odd ph the last cell row has no
//       bottom pixel: its top half is drawn and bg is left as the cell already has it. Drawn cells get
//       colours = RGB_CELL; untouched cells are not written.
//
//   brailleToCells(params, cols, rows, dots, dw, dh, fg, bg, ox = 0, oy = 0)
//       dots: Uint8Array dw*dh (non-zero = dot on), row-major; a cell covers 2 dots across x 4 down, so the
//       grid is ceil(dw / 2) x ceil(dh / 4) cells (dots past the edge of a partial cell are off). fg and bg are
//       each a number (the whole shape) or a Uint32Array of ceil(dw / 2) * ceil(dh / 4) per-cell colours.
//       One dot colour and one background per cell. Glyph is U+2800 + bits, bits being the standard braille
//       dots: dot 1 (x0,y0) 0x01, dot 2 (x0,y1) 0x02, dot 3 (x0,y2) 0x04, dot 4 (x1,y0) 0x08, dot 5 (x1,y1) 0x10,
//       dot 6 (x1,y2) 0x20, dot 7 (x0,y3) 0x40, dot 8 (x1,y3) 0x80. A cell with no dots is a space (glyph 32)
//       with bg only. cell offsets ox, oy as above; colours = RGB_CELL on every cell written.
//
//   safeHue(h, L) -> 0xRRGGBB
//       A colour of hue h (degrees, any real, wrapped, rounded to 360 columns) at OKLab lightness L (clamped to
//       0.05..0.92, rounded to 64 rows: row = round(L * 63)), whose relative luminance is L^3 whatever the hue,
//       and whose linear red share r / (r + g + b) is at most 0.75 (WCAG's saturated red is 0.8 or more). So a
//       hue sweep at one L is a same-brightness change and never passes through a saturated red. Chroma starts
//       at 0.20 and halves up to 10 times until the colour is in gamut and not too red (chroma 0 at the
//       end); channels are never clamped. The result is on the renderer's 6-bit grid (low 2 bits of each channel
//       clear, so its drop changes nothing) and the red share is checked on that grid colour. Backed by a
//       Uint32Array(64 * 360), each row built on first use.
//   safeHueExact(h, L)        the same value computed without the table (tests assert table == exact).
//   safeHueLinear(h, L)       the unrounded linear-light channels and the chroma chosen, for tests.
//
//   staggerTime(t, y, fps = 18)
//       The time at which row y was last updated when even rows update on even ticks and odd rows on odd
//       ticks (tick = floor(t * fps)): half the rows change per tick, each row every second tick. Pure in t.
//       A scene that draws row y from staggerTime(t, y) instead of t gets that for free.
//
//   relY(rgb)                 relative luminance 0..1 of 0xRRGGBB (sRGB transfer, Rec.709 weights).
import { RGB_CELL, PALETTE_BG } from './renderer.js';

export { RGB_CELL, PALETTE_BG };
export const HUE_COLS = 360;
export const L_ROWS = 64;

// ---- relative luminance ---------------------------------------------------------------------------

const SRGB_LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const s = i / 255;
  SRGB_LIN[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relY(rgb) {
  return 0.2126 * SRGB_LIN[(rgb >>> 16) & 255] + 0.7152 * SRGB_LIN[(rgb >>> 8) & 255] + 0.0722 * SRGB_LIN[rgb & 255];
}

// ---- pixels and braille -> cells ------------------------------------------------------------------

export function pixelsToCells(params, cols, rows, pixels, pw, ph, ox = 0, oy = 0) {
  const { glyphs, colours, fg, bg } = params;
  if (!(cols > 0 && rows > 0 && pw > 0 && ph > 0)) return;
  const cellRows = (ph + 1) >> 1;
  for (let ky = 0; ky < cellRows; ky++) {
    const cy = oy + ky;
    if (cy < 0 || cy >= rows) continue;
    const hasBottom = 2 * ky + 1 < ph;
    const topRow = 2 * ky * pw, botRow = topRow + pw;
    for (let x = 0; x < pw; x++) {
      const cx = ox + x;
      if (cx < 0 || cx >= cols) continue;
      const i = cy * cols + cx;
      const top = pixels[topRow + x];
      colours[i] = RGB_CELL;
      if (!hasBottom) { glyphs[i] = 0x2580; fg[i] = top; continue; }
      const bot = pixels[botRow + x];
      if (top === bot) { glyphs[i] = 32; fg[i] = top; bg[i] = top; } else { glyphs[i] = 0x2580; fg[i] = top; bg[i] = bot; }
    }
  }
}

// bit for the dot at (x, y) inside a cell, indexed y * 2 + x
const BRAILLE_BIT = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80];

export function brailleToCells(params, cols, rows, dots, dw, dh, fg, bg, ox = 0, oy = 0) {
  const { glyphs, colours } = params;
  if (!(cols > 0 && rows > 0 && dw > 0 && dh > 0)) return;
  const cw = (dw + 1) >> 1, ch = (dh + 3) >> 2;
  const fgArr = typeof fg === 'number' ? null : fg, bgArr = typeof bg === 'number' ? null : bg;
  for (let ky = 0; ky < ch; ky++) {
    const cy = oy + ky;
    if (cy < 0 || cy >= rows) continue;
    for (let kx = 0; kx < cw; kx++) {
      const cx = ox + kx;
      if (cx < 0 || cx >= cols) continue;
      let bits = 0;
      for (let dy = 0; dy < 4; dy++) {
        const y = ky * 4 + dy;
        if (y >= dh) break;
        for (let dx = 0; dx < 2; dx++) {
          const x = kx * 2 + dx;
          if (x < dw && dots[y * dw + x]) bits |= BRAILLE_BIT[dy * 2 + dx];
        }
      }
      const i = cy * cols + cx, k = ky * cw + kx;
      glyphs[i] = bits ? 0x2800 + bits : 32;
      params.fg[i] = fgArr ? fgArr[k] : fg;
      params.bg[i] = bgArr ? bgArr[k] : bg;
      colours[i] = RGB_CELL;
    }
  }
}

// ---- safeHue --------------------------------------------------------------------------------------

const L_MIN = 0.05, L_MAX = 0.92;
const RED_SHARE_MAX = 0.75;
const Y_TOL = 0.002;

// OKLCH -> linear sRGB (Ottosson), unclamped. out = [r, g, b]
function oklchToLinear(L, C, hRad, out) {
  const a = C * Math.cos(hRad), b = C * Math.sin(hRad);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
}

const clampL = (L) => (L > L_MAX ? L_MAX : L > L_MIN ? L : L_MIN); // NaN -> L_MIN
const linY = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// The renderer drops the 2 low bits of every channel, so a colour is only ever shown on the 6-bit grid
// (multiples of 4, at most 252). safeHue stores a grid colour, so the drop is a no-op and the luminance and red
// share measured here are what appears on screen. Each channel is rounded down or up to its two neighbouring
// grid codes, and of the 8 combinations the one whose luminance is closest to the target wins (a plain
// truncation darkens bright colours by up to 3 codes a channel, nearest rounding still misses by about 0.016).
const CODE = new Int32Array(3);
const codeF = (v) => {
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return 255 * (s < 0 ? 0 : s > 1 ? 1 : s);
};
function gridCodes(r, g, b, target, out) {
  const f0 = codeF(r), f1 = codeF(g), f2 = codeF(b);
  const l0 = Math.min(248, Math.floor(f0 / 4) * 4), l1 = Math.min(248, Math.floor(f1 / 4) * 4), l2 = Math.min(248, Math.floor(f2 / 4) * 4);
  let best = Infinity;
  for (let m = 0; m < 8; m++) {
    const c0 = l0 + ((m & 1) << 2), c1 = l1 + ((m & 2) << 1), c2 = l2 + (m & 4);
    const y = 0.2126 * SRGB_LIN[c0] + 0.7152 * SRGB_LIN[c1] + 0.0722 * SRGB_LIN[c2];
    const d0 = c0 - f0, d1 = c1 - f1, d2 = c2 - f2;
    const cost = Math.abs(y - target) + 1e-7 * (d0 * d0 + d1 * d1 + d2 * d2); // nearest hue breaks ties
    if (cost < best) { best = cost; CODE[0] = c0 > 252 ? 252 : c0; CODE[1] = c1 > 252 ? 252 : c1; CODE[2] = c2 > 252 ? 252 : c2; }
  }
  out[3] = CODE[0]; out[4] = CODE[1]; out[5] = CODE[2];
}

// Search one table entry. Returns the chosen chroma; out = [r, g, b, codeR, codeG, codeB]: the unrounded
// linear channels and the grid codes chosen from them.
function solve(row, col, out) {
  const L = clampL(row / (L_ROWS - 1));
  const target = L * L * L;
  const hRad = (col * Math.PI) / 180;
  let C = 0.20;
  for (let k = 0; k <= 10; k++, C *= 0.5) {
    // correct OKLab lightness so that the relative luminance is the target
    let Lc = L;
    oklchToLinear(Lc, C, hRad, out);
    for (let i = 0; i < 6; i++) {
      const y = linY(out);
      if (Math.abs(y - target) <= Y_TOL) break;
      Lc += Math.cbrt(target) - Math.cbrt(Math.max(y, 0));
      oklchToLinear(Lc, C, hRad, out);
    }
    const r = out[0], g = out[1], b = out[2];
    if (r < 0 || g < 0 || b < 0 || r > 1 || g > 1 || b > 1) continue;
    gridCodes(r, g, b, target, out);
    // red share of the colour as it will be shown, not of the ideal float
    const qr = SRGB_LIN[out[3]], qg = SRGB_LIN[out[4]], qb = SRGB_LIN[out[5]];
    const sum = qr + qg + qb;
    if (sum > 0 && qr / sum > RED_SHARE_MAX) continue;
    return C;
  }
  out[0] = out[1] = out[2] = target; // chroma 0: a neutral grey of the target luminance
  let gc = 0, gd = Infinity; // equal channels, so that the grey stays grey on the grid
  for (let c = 0; c <= 252; c += 4) { const d = Math.abs(SRGB_LIN[c] - target); if (d < gd) { gd = d; gc = c; } }
  out[3] = out[4] = out[5] = gc;
  return 0;
}

function colourOf(row, col) {
  const out = [0, 0, 0, 0, 0, 0];
  solve(row, col, out);
  return ((out[3] << 16) | (out[4] << 8) | out[5]) >>> 0;
}

const hueCol = (h) => {
  if (!Number.isFinite(h)) return 0;
  return Math.round(((h % 360) + 360) % 360) % 360;
};
const lRow = (L) => Math.round(clampL(L) * (L_ROWS - 1));

export function safeHueExact(h, L) {
  return colourOf(lRow(L), hueCol(h));
}

export function safeHueLinear(h, L) {
  const out = [0, 0, 0, 0, 0, 0];
  const chroma = solve(lRow(L), hueCol(h), out);
  return { r: out[0], g: out[1], b: out[2], chroma, codes: [out[3], out[4], out[5]] };
}

const TABLE = new Uint32Array(L_ROWS * HUE_COLS);
const BUILT = new Uint8Array(L_ROWS);

function buildRow(row) {
  const base = row * HUE_COLS;
  for (let c = 0; c < HUE_COLS; c++) TABLE[base + c] = colourOf(row, c);
  BUILT[row] = 1;
}

export function safeHue(h, L) {
  const row = Math.round(clampL(L) * (L_ROWS - 1));
  if (BUILT[row] === 0) buildRow(row);
  let hh = h % 360;
  if (hh < 0) hh += 360;
  let col = Math.round(hh);
  if (!(col < HUE_COLS)) col = 0; // 360 (after rounding) and NaN/Infinity
  return TABLE[row * HUE_COLS + col];
}

// ---- staggerTime ----------------------------------------------------------------------------------

export function staggerTime(t, y, fps = 18) {
  const tick = Number.isFinite(t) ? Math.floor(t * fps) : 0;
  const parity = ((Math.floor(y) % 2) + 2) % 2 || 0;
  const last = tick - ((((tick - parity) % 2) + 2) % 2);
  return last / fps;
}
