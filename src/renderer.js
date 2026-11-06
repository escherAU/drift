// Diff renderer: turns glyph/shade arrays into the shortest ANSI string that
// updates the screen from the previous frame. One string per frame; the empty
// string when nothing changed.
//
// frame = { cols, rows, glyphs: Uint16Array (code points),
//           shades: Uint8Array (palette level per cell),
//           palette: { key, sgr: string[] } }
//
// Safety rules: cursor addresses never leave the grid, and the bottom-right
// cell is never drawn (writing it can scroll some terminals). A blank cell
// has no colour, so colour-only changes under a space are not emitted.

const CLEAR = '\x1b[2J';

export function createRenderer() {
  let prevG = new Uint16Array(0);
  let prevS = new Uint8Array(0);
  let pc = 0, pr = 0, pkey = null, valid = false;

  function invalidate() { valid = false; }

  function render(frame) {
    const { cols, rows, glyphs, shades, palette } = frame;
    const n = cols * rows;
    const full = !valid || cols !== pc || rows !== pr;
    let out = '';
    if (full) {
      out = CLEAR;
      prevG = new Uint16Array(n); prevS = new Uint8Array(n);
      pc = cols; pr = rows;
    }
    const keyChanged = !full && palette.key !== pkey;
    const sgr = palette.sgr;
    const last = n - 1; // bottom-right cell is skipped
    let curSgr = -1;
    let runRow = -1, runCol = -2;
    let any = full;
    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        if (i >= last) break;
        const g = glyphs[i];
        const s = g === 32 ? 0 : shades[i];
        const pg = prevG[i], ps = prevS[i];
        let draw;
        if (full) draw = g !== 32;
        else draw = g !== pg || s !== ps || (keyChanged && g !== 32);
        prevG[i] = g; prevS[i] = s;
        if (!draw) continue;
        any = true;
        if (y !== runRow || x !== runCol + 1) out += `\x1b[${y + 1};${x + 1}H`;
        runRow = y; runCol = x;
        if (g !== 32 && s !== curSgr) { out += sgr[s]; curSgr = s; }
        out += String.fromCharCode(g);
      }
    }
    pkey = palette.key;
    valid = true;
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
