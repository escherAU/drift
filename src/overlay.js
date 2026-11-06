// The help panel: a centred box drawn into the frame buffers AFTER composition, so the
// renderer treats it like any other cells. Text is plain ASCII plus the box-drawing
// corners and lines (all on the glyph allow-list). Never throws, whatever the size:
// a terminal too small for the whole panel gets a clipped one.
import { helpLines } from './keymap.js';

const PAD = 2; // blank columns between border and text

// info = { mode, modeName, sceneName, ui: { text, dim, head } }  (ui = palette indexes)
export function panelLines(info) {
  const lines = [
    { text: 'DRIFT  keys', style: 'head' },
    { text: `mode: ${info.modeName}    scene: ${info.sceneName}`, style: 'text' },
    { text: '', style: 'text' },
    ...helpLines(info.mode),
  ];
  return lines;
}

export function panelSize(info) {
  const lines = panelLines(info);
  let wide = 0;
  for (const l of lines) if (l.text.length > wide) wide = l.text.length;
  return { width: wide + 2 * PAD + 2, height: lines.length + 4 }; // borders + one blank row above and below
}

// Returns { left, top, width, height } of the box actually drawn, or null when nothing fits.
export function drawHelp(glyphs, shades, cols, rows, info) {
  if (cols < 5 || rows < 3) return null;
  const want = panelSize(info);
  const bw = Math.min(cols, want.width), bh = Math.min(rows, want.height);
  const left = Math.floor((cols - bw) / 2), top = Math.floor((rows - bh) / 2);
  const ui = info.ui;
  const put = (x, y, cp, shade) => { const i = (top + y) * cols + left + x; glyphs[i] = cp; shades[i] = shade; };
  // interior and border
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) put(x, y, 32, 0);
  for (let x = 1; x < bw - 1; x++) { put(x, 0, 0x2500, ui.text); put(x, bh - 1, 0x2500, ui.text); }
  for (let y = 1; y < bh - 1; y++) { put(0, y, 0x2502, ui.text); put(bw - 1, y, 0x2502, ui.text); }
  put(0, 0, 0x250c, ui.text); put(bw - 1, 0, 0x2510, ui.text);
  put(0, bh - 1, 0x2514, ui.text); put(bw - 1, bh - 1, 0x2518, ui.text);
  // text rows: row 0 of the box is the border, row 1 a blank pad row
  const lines = panelLines(info);
  const rowEnd = bh < want.height ? bh - 1 : bh - 2; // exclusive; keeps the pad row when it all fits
  for (let k = 0; k < lines.length; k++) {
    const y = 2 + k;
    if (y >= rowEnd) break;
    const l = lines[k];
    const shade = l.style === 'dim' ? ui.dim : l.style === 'head' ? ui.head : ui.text;
    for (let x = 0; x < l.text.length && 1 + PAD + x < bw - 1; x++) {
      const cp = l.text.charCodeAt(x);
      if (cp !== 32) put(1 + PAD + x, y, cp, shade);
    }
  }
  return { left, top, width: bw, height: bh };
}
