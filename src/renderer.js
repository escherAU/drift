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

// Synchronized output (DEC private mode 2026): the app wraps each frame's single
// write in these so a supporting terminal paints it atomically. Others ignore it.
// The renderer returns the bare body so the diff stays pinned minimal.
export const SYNC_BEGIN = '\x1b[?2026h';
export const SYNC_END = '\x1b[?2026l';

export function createRenderer() {
  let prevG = new Uint16Array(0);
  let prevS = new Uint8Array(0);
  let pc = 0, pr = 0, pkey = null, valid = false, prevBg = false;

  function invalidate() { valid = false; }

  function render(frame) {
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
