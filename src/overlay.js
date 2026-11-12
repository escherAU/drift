// The help panel: a centred box drawn into the frame buffers AFTER composition, so the
// renderer treats it like any other cells. Text is plain ASCII plus the box-drawing
// corners and lines (all on the glyph allow-list). Never throws, whatever the size.
//
// Three layouts, the roomiest that fits the terminal's rows:
//   roomy    blank line between groups, a blank pad row inside the top and bottom border (30 rows)
//   compact  no blank lines between groups, one blank line under the mode line         (24 rows)
//   tight    the same without that blank line                                          (23 rows)
// Below that the tight layout is cut to fit and its last text row says how much is missing:
// "(+N more, enlarge window)", N counting the body lines left out.
import { helpLines } from './keymap.js';

const PAD = 2; // blank columns between border and text

// info = { mode, modeName, sceneName, ui: { text, dim, head } }  (ui = palette indexes)
// Optional (the console's skinned help uses them; the defaults are the Classic panel):
//   title     heading line                       (default 'DRIFT  keys')
//   box       8 characters: tl t tr r br b bl l   (default the single-line box)
//   lines     body lines [{ text, style }]       (default helpLines(info.mode))
//   modeLine  the line under the title           (default 'mode: ...    scene: ...'; '' = none)
// The tight layout merges the title and the mode line into ONE row, which keeps 80x23 free of the
// truncation hint now that the key table has one more row.
const DEFAULT_BOX = '┌─┐│┘─└│';

function headParts(info) {
  const title = info.title === undefined ? 'DRIFT  keys' : info.title;
  const modeLine = info.modeLine === undefined ? `mode: ${info.modeName}    scene: ${info.sceneName}` : info.modeLine;
  return { title, modeLine };
}

function head(info, withBlank, merged = false) {
  const { title, modeLine } = headParts(info);
  const out = [];
  if (merged && modeLine !== '') out.push({ text: title + '  ' + modeLine, style: 'head' });
  else {
    out.push({ text: title, style: 'head' });
    if (modeLine !== '') out.push({ text: modeLine, style: 'text' });
  }
  if (withBlank) out.push({ text: '', style: 'text' });
  return out;
}

// A head line wider than `width` goes onto more rows, broken only at its runs of two or more spaces (the
// gap between the title and the mode line, or inside the mode line); pieces are packed left to right with the
// original gap kept between those on one row. A piece with no gap that is still too wide stays whole: the draw clips it.
function wrapAt(text, width) {
  if (text.length <= width) return [text];
  const parts = text.split(/( {2,})/); // pieces at even indexes, gaps at odd
  const rows = [];
  let cur = parts[0];
  for (let i = 1; i < parts.length; i += 2) {
    const next = cur + parts[i] + parts[i + 1];
    if (next.length <= width) cur = next;
    else { rows.push(cur); cur = parts[i + 1]; }
  }
  rows.push(cur);
  return rows;
}

const wrapHead = (lines, width) => lines.flatMap((l) => (l.text.length > width ? wrapAt(l.text, width).map((text) => ({ text, style: l.style })) : [l]));

const withoutBlanks = (lines) => lines.filter((l) => l.text !== '');
const bodyOf = (info) => info.lines || helpLines(info.mode);

// { lines, pad } for a terminal of `rows` rows (rows omitted = the roomy layout) and `cols` columns (omitted =
// no wrapping): a head line wider than the box's inner width, cols - 2 - 2*PAD, is wrapped onto more rows.
export function layoutFor(info, rows = Infinity, cols = Infinity) {
  const inner = cols - 2 - 2 * PAD;
  const hd = (withBlank, merged) => wrapHead(head(info, withBlank, merged), inner);
  const roomy = { lines: [...hd(true, false), ...bodyOf(info)], pad: 1 };
  if (roomy.lines.length + 4 <= rows) return roomy;
  const body = withoutBlanks(bodyOf(info));
  const compact = { lines: [...hd(true, false), ...body], pad: 0 };
  if (compact.lines.length + 2 <= rows) return compact;
  const tight = { lines: [...hd(false, true), ...body], pad: 0 };
  if (tight.lines.length + 2 <= rows) return tight;
  // below the minimum: keep the top of the tight layout and end with a hint line
  const room = Math.max(0, rows - 2); // text rows inside the border
  if (room <= 0) return { lines: [], pad: 0 };
  if (room === 1) return { lines: [{ text: `(+${tight.lines.length} more, enlarge window)`, style: 'dim' }], pad: 0 };
  const keep = room - 1;
  const left = tight.lines.length - keep;
  return { lines: [...tight.lines.slice(0, keep), { text: `(+${left} more, enlarge window)`, style: 'dim' }], pad: 0 };
}

export function panelLines(info) {
  return layoutFor(info).lines;
}

export function panelSize(info, rows = Infinity, cols = Infinity) {
  const { lines, pad } = layoutFor(info, rows, cols);
  let wide = 0;
  for (const l of lines) if (l.text.length > wide) wide = l.text.length;
  return { width: wide + 2 * PAD + 2, height: lines.length + 2 + 2 * pad }; // borders + optional pad rows
}

// Returns { left, top, width, height } of the box actually drawn, or null when nothing fits.
export function drawHelp(glyphs, shades, cols, rows, info) {
  if (cols < 5 || rows < 3) return null;
  const { lines, pad } = layoutFor(info, rows, cols);
  const want = panelSize(info, rows, cols);
  const bw = Math.min(cols, want.width), bh = Math.min(rows, want.height);
  const left = Math.floor((cols - bw) / 2), top = Math.floor((rows - bh) / 2);
  const ui = info.ui;
  const put = (x, y, cp, shade) => { const i = (top + y) * cols + left + x; glyphs[i] = cp; shades[i] = shade; };
  // interior and border
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) put(x, y, 32, 0);
  const bx = [...(info.box || DEFAULT_BOX)].map((ch) => ch.codePointAt(0)); // tl t tr r br b bl l
  for (let x = 1; x < bw - 1; x++) { put(x, 0, bx[1], ui.text); put(x, bh - 1, bx[5], ui.text); }
  for (let y = 1; y < bh - 1; y++) { put(0, y, bx[7], ui.text); put(bw - 1, y, bx[3], ui.text); }
  put(0, 0, bx[0], ui.text); put(bw - 1, 0, bx[2], ui.text);
  put(0, bh - 1, bx[6], ui.text); put(bw - 1, bh - 1, bx[4], ui.text);
  // text rows start under the border (and the pad row, when the layout has one)
  const rowEnd = bh - 1 - pad; // exclusive
  for (let k = 0; k < lines.length; k++) {
    const y = 1 + pad + k;
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
