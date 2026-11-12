// Diff renderer: turns glyph/shade arrays into the shortest ANSI string that
// updates the screen from the previous frame. One string per frame; the empty
// string when nothing changed.
//
// frame = { cols, rows, glyphs: Uint16Array (code points),
//           shades: Uint8Array (palette level per cell),
//           palette: { key, sgr: string[], bg?: true, base?: string } }
//
// A palette may carry a background (`bg`, with `base` = the SGR to start every frame with).
// Then every cell, spaces included, is drawn with its full SGR, every non-empty frame
// starts with `base`, and a full repaint is base + CLEAR + every cell.
//
// Safety rules: cursor addresses never leave the grid, and the bottom-right
// cell is never drawn (writing it can scroll some terminals). A blank cell
// has no colour, so colour-only changes under a space are not emitted.

const CLEAR = '\x1b[2J';
const RESET = '\x1b[0m';

// ---- DRIFT-7 C2: the full-colour branch (a frame carrying `fg`, and `bg`, Uint32Array of 0xRRGGBB per cell).
// A cell whose shade is RGB_CELL takes its colours from fg/bg; any other shade resolves through the frame's
// palette tables (fgRgb/bgRgb, or fg256/bg256 when frame.mode === '256'). A bg of PALETTE_BG means "this
// palette's background" (table entry 0). The palette branch below is untouched.
export const RGB_CELL = 255;
export const PALETTE_BG = 0x1000000;
const DONT_CARE = -1, UNKNOWN = -2;
const XTERM_CUBE = [0, 95, 135, 175, 215, 255];

function oklab(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

// Nearest of xterm colours 16..255 by OKLab distance, L difference weighted 4x so brightness survives.
// One shared 15-bit (5 bits per channel) table, filled lazily; each key is judged at its cell centre
// (the 5-bit value expanded back to 8 bits as (v << 3) | (v >> 2)). Colour indexes are never 0, so 0 = unset.
// Red-safe: a source whose linear red share r/(r+g+b) is under RED_SAFE_SHARE (0.8, the WCAG saturated-red line;
// safeHue keeps 0.75 or less) never maps to a candidate at or over it, so quantising cannot make a safe hue a red.
const RED_SAFE_SHARE = 0.8;
const redShare = (r, g, b) => {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), s = R + lin(g) + lin(b);
  return s === 0 ? 0 : R / s;
};
let lut256 = null, labs256 = null, red256 = null;
export function nearest256(c) {
  const key = (((c >> 19) & 31) << 10) | (((c >> 11) & 31) << 5) | ((c >> 3) & 31);
  if (!lut256) lut256 = new Uint8Array(32768);
  let v = lut256[key];
  if (v) return v;
  if (!labs256) {
    labs256 = []; red256 = [];
    for (let i = 16; i < 256; i++) {
      let rgb;
      if (i < 232) { const k = i - 16; rgb = [XTERM_CUBE[Math.floor(k / 36)], XTERM_CUBE[Math.floor(k / 6) % 6], XTERM_CUBE[k % 6]]; } else { const g = 8 + (i - 232) * 10; rgb = [g, g, g]; }
      labs256.push(oklab(rgb[0], rgb[1], rgb[2]));
      red256.push(redShare(rgb[0], rgb[1], rgb[2]) >= RED_SAFE_SHARE);
    }
  }
  const e = (q) => (q << 3) | (q >> 2);
  const sr = e((key >> 10) & 31), sg = e((key >> 5) & 31), sb = e(key & 31);
  const [L, A, B] = oklab(sr, sg, sb);
  const skipRed = redShare(sr, sg, sb) < RED_SAFE_SHARE;
  let best = 16, bd = Infinity;
  for (let i = 0; i < labs256.length; i++) {
    if (skipRed && red256[i]) continue;
    const p = labs256[i];
    const d = (4 * (L - p[0])) ** 2 + (A - p[1]) ** 2 + (B - p[2]) ** 2;
    if (d < bd) { bd = d; best = i + 16; }
  }
  lut256[key] = best;
  return best;
}

// Synchronized output (DEC private mode 2026): the app wraps each frame's single
// write in these so a supporting terminal paints it atomically. Others ignore it.
// The renderer returns the bare body so the diff stays pinned minimal.
export const SYNC_BEGIN = '\x1b[?2026h';
export const SYNC_END = '\x1b[?2026l';

export function createRenderer() {
  let prevG = new Uint16Array(0);
  let prevS = new Uint8Array(0);
  let pc = 0, pr = 0, pkey = null, valid = false, prevBg = false;
  // full-colour branch state: per-cell glyph / fg / bg as last drawn (resolved: truecolor value or 256 index)
  let rgG = new Uint16Array(0), rgF = new Int32Array(0), rgB = new Int32Array(0);
  let inRgb = false, rgMode = 0, lastPal = null, sgrF = UNKNOWN, sgrB = UNKNOWN;

  function invalidate() { valid = false; }

  function render(frame) {
    if (frame.fg) return renderRgb(frame);
    // leaving the full-colour branch: invalidate, and treat the screen as holding a stale background so
    // the palette branch's full path starts with RESET
    if (inRgb) { inRgb = false; valid = false; prevBg = true; }
    lastPal = frame.palette;
    const { cols, rows, glyphs, shades, palette } = frame;
    const n = cols * rows;
    const full = !valid || cols !== pc || rows !== pr;
    const bg = !!palette.bg;
    let out = '';
    if (full) {
      // Leaving a background palette: reset first, so the clear is not painted in its bg.
      // Only sent when the previous palette had a bg, so calm-only output is unchanged.
      out = (prevBg && !bg ? RESET : '') + (bg ? palette.base : '') + CLEAR;
      prevG = new Uint16Array(n); prevS = new Uint8Array(n);
      pc = cols; pr = rows;
    }
    const keyChanged = !full && palette.key !== pkey;
    const sgr = palette.sgr;
    const last = n - 1; // bottom-right cell is skipped
    let curSgr = -1;
    let runRow = -1, runCol = -2;
    let any = full;
    if (bg && !full) out = palette.base;
    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        if (i >= last) break;
        const g = glyphs[i];
        const s = g === 32 ? 0 : shades[i];
        const pg = prevG[i], ps = prevS[i];
        let draw;
        if (full) draw = bg || g !== 32;
        else draw = g !== pg || s !== ps || (keyChanged && (bg || g !== 32));
        prevG[i] = g; prevS[i] = s;
        if (!draw) continue;
        any = true;
        if (y !== runRow || x !== runCol + 1) out += `\x1b[${y + 1};${x + 1}H`;
        runRow = y; runCol = x;
        if ((bg || g !== 32) && s !== curSgr) { out += sgr[s]; curSgr = s; }
        out += String.fromCharCode(g);
      }
    }
    pkey = palette.key;
    valid = true;
    prevBg = bg;
    return any ? out : '';
  }

  function renderRgb(frame) {
    const { cols, rows, glyphs, shades, fg, bg, palette } = frame;
    const n = cols * rows;
    const m256 = frame.mode === '256';
    const mode = m256 ? 256 : 24;
    const fgT = m256 ? palette.fg256 : palette.fgRgb;
    const bgT = m256 ? palette.bg256 : palette.bgRgb;
    const pbg = !!palette.bg;
    let full = !valid || cols !== pc || rows !== pr || (inRgb && mode !== rgMode);
    let out = '';
    if (rgG.length !== n) { rgG = new Uint16Array(n); rgF = new Int32Array(n); rgB = new Int32Array(n); }
    if (full) {
      // exactly the palette branch's full path (plus RESET when the screen may hold a stale rgb background)
      out = ((prevBg || inRgb) && !pbg ? RESET : '') + (pbg ? palette.base : '') + CLEAR;
      pc = cols; pr = rows;
    } else if (!inRgb) {
      // takeover from the palette branch: its cells, resolved through the palette it drew with
      const lp = lastPal;
      const pf = lp && (m256 ? lp.fg256 : lp.fgRgb), pb = lp && (m256 ? lp.bg256 : lp.bgRgb);
      if (!pf || !pb) full = true;
      else {
        for (let i = 0; i < n; i++) {
          const g = prevG[i], s = prevS[i];
          rgG[i] = g;
          rgF[i] = g === 32 ? DONT_CARE : pf[s];
          rgB[i] = g === 0x2588 ? DONT_CARE : pb[s];
        }
      }
      if (full) { out = (prevBg && !pbg ? RESET : '') + (pbg ? palette.base : '') + CLEAR; pc = cols; pr = rows; }
    }
    const fgS = m256 ? (k) => `38;5;${k}` : (k) => `38;2;${(k >> 16) & 255};${(k >> 8) & 255};${k & 255}`;
    const bgS = m256 ? (k) => `48;5;${k}` : (k) => `48;2;${(k >> 16) & 255};${(k >> 8) & 255};${k & 255}`;
    const last = n - 1; // bottom-right cell is skipped
    // The terminal's current colours carry over from one full-colour frame to the next (nothing else
    // writes colour between them), so a lone fg change costs only 38;2. Anything else starts unknown.
    if (full || !inRgb) { sgrF = UNKNOWN; sgrB = UNKNOWN; }
    let curF = sgrF, curB = sgrB;
    let runRow = -1, runCol = -2;
    let any = full;
    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        if (i >= last) break;
        const g = glyphs[i];
        let s = shades ? shades[i] : RGB_CELL;
        if (g === 32 && s !== RGB_CELL) s = 0;
        let f, b;
        if (s === RGB_CELL) {
          const fv = fg[i], bv = bg[i];
          f = m256 ? nearest256(fv) : fv & 0xFCFCFC;
          b = bv === PALETTE_BG ? bgT[0] : (m256 ? nearest256(bv) : bv & 0xFCFCFC);
        } else { f = fgT[s]; b = bgT[s]; }
        if (g === 32) f = DONT_CARE; else if (g === 0x2588) b = DONT_CARE;
        if (!full && g === rgG[i] && f === rgF[i] && b === rgB[i]) continue;
        rgG[i] = g; rgF[i] = f; rgB[i] = b;
        any = true;
        if (y !== runRow || x !== runCol + 1) out += `\x1b[${y + 1};${x + 1}H`;
        runRow = y; runCol = x;
        const nf = f !== DONT_CARE && f !== curF, nb = b !== DONT_CARE && b !== curB;
        if (nf && nb) { out += `\x1b[${fgS(f)};${bgS(b)}m`; curF = f; curB = b; }
        else if (nf) { out += `\x1b[${fgS(f)}m`; curF = f; }
        else if (nb) { out += `\x1b[${bgS(b)}m`; curB = b; }
        out += String.fromCharCode(g);
      }
    }
    sgrF = curF; sgrB = curB;
    inRgb = true; rgMode = mode; valid = true;
    return any ? out : '';
  }

  return { render, invalidate };
}

// ---- capture helpers (plain text and ANSI dumps of one frame)

export function frameToText(frame) {
  const { cols, rows, glyphs } = frame;
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) line += String.fromCharCode(glyphs[y * cols + x]);
    lines.push(line);
  }
  return lines.join('\n');
}

export function frameToAnsi(frame) {
  const { cols, rows, glyphs, shades, palette } = frame;
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = '', cur = -1;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const g = glyphs[i];
      if (g !== 32 && shades[i] !== cur) { line += palette.sgr[shades[i]]; cur = shades[i]; }
      line += String.fromCharCode(g);
    }
    lines.push(line);
  }
  return lines.join('\n') + '\x1b[0m';
}
