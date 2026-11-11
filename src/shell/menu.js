// The cartridge menu, drawn over the running scene (DRIFT-4). Pure.
//
//   drawMenu(frame, { entries, index, title }, skin)
//
//   entries  [{ label, current }]   current marks the program that is playing
//   index    the highlighted entry
//   title    the box title (skin.menu.title is used when absent)
//   skin     the cartridge skin; skin.menu: { layout, anchor, cursor, title, box }
//
// Three engine layouts (a skin picks one by name; there are no free-form layouts):
//
//   list   a framed column of rows, the cursor glyph in front of the highlighted one and the hint under the list.
//          The frame is skin.menu.box, else skin.frame.glyphs, else the default box. Title rule (shared with the
//          chrome, see ui.js titleCapsOf): when the frame's top glyph is '═' or '━' the title is set into the top
//          border as '╡ TITLE ╞'; on any other frame it is a plain title row (and a blank row) inside the frame.
//          When the rows do not fit the window scrolls and its first and last rows say '↑ N more' / '↓ N more'.
//   slots  cards, one per entry, each with a Roman numeral (I..X) and the label. At >= 30 rows a card is a 4-row
//          box (selected: double line in the accent colour; the others: single line, dim, 4 rows high: the label row,
//          then a row kept for a description). Below 30 rows an entry is 2 rows (label, then the row kept for the
//          description) with a dashed rule (┄) between entries. A menu that does not fit that either is the list.
//   grid   22x7 tiles, 3 per row from 120 columns and 2 per row from 100; the selected tile is a double line in the
//          accent colour. Below 100 columns, or when the rows do not fit, it is the list.
//
// Only the cells inside the menu's own boxes are written; the scene shows through everywhere else. Every row is
// composed through putRow (left parts, right-aligned parts) so a later field (a note, a description) is a new part.
import { putText, putCentered, fillRect, drawBox, lenOf, centerX, uiOf, boxChars, titleCapsOf, putEdgeTitle, putRow, DEFAULT_BOX } from './ui.js';

export const LAYOUT_NAMES = Object.freeze({ list: 'list', slots: 'slots', grid: 'grid' });
export const TILE_W = 22;
export const TILE_H = 7;
export const TILE_GAP = 2;
export const SLOTS_TALL_ROWS = 30; // slots: 4-row cards at this many rows and more
export const GRID_MIN_COLS = 100; // grid: tiles at this many columns and more, else the list
export const GRID_THREE_COLS = 120; // grid: three tiles per row from here, else two
export const DEFAULT_HINT = 'Up and down choose, Enter selects, Esc closes';
export const SINGLE = '┌─┐│┘─└│';
export const DOUBLE = '╔═╗║╝═╚║';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const romanOf = (i) => (i >= 0 && i < ROMAN.length ? ROMAN[i] : String(i + 1));
const NUMERAL_W = 4;

// ---- small helpers

// The list's frame: the skin's menu box, else its frame glyphs, else the default.
function listBox(skin) {
  return (skin.menu && skin.menu.box) || (skin.frame && skin.frame.glyphs) || DEFAULT_BOX;
}
// A card's or tile's resting frame: single line (a skin box that is a double or heavy line is not used for the
// unselected ones, so the selected double line stays the difference).
function restBox(skin) {
  const b = listBox(skin);
  return titleCapsOf(b) ? SINGLE : b;
}

function boxed(f, x, y, w, h, box, shade) {
  fillRect(f, x, y, w, h, 32, 0);
  drawBox(f, x, y, w, h, box, shade);
}

// Rows the menu may use: one spare row top and bottom when the frame is tall enough to have them.
const usableRows = (f) => (f.rows >= 8 ? f.rows - 2 : f.rows);

function place(f, w, h, anchor) {
  const x = anchor === 'left' ? 2 : centerX(f.cols, w);
  const y = anchor === 'bottom' ? Math.max(0, f.rows - h - 1) : Math.max(0, Math.floor((f.rows - h) / 2));
  return { x: Math.max(0, x), y };
}

const labelOf = (e) => e.label + (e.current ? ' *' : '');
const labelWidth = (entries) => Math.max(1, ...entries.map((e) => lenOf(labelOf(e))));
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - lenOf(s)));

// The label as row parts: the text in the row's shade, the current mark in the head shade (accent when selected).
function labelParts(e, sel, ui) {
  const parts = [{ t: e.label, s: sel ? ui.accent : ui.text }];
  if (e.current) parts.push({ t: ' *', s: sel ? ui.accent : ui.head });
  return parts;
}

// ---- list

function drawList(f, a, skin) {
  const ui = uiOf(skin);
  const m = skin.menu || {};
  const cursor = m.cursor || '▶';
  const hint = (skin.wording && skin.wording.menuHint) || DEFAULT_HINT;
  const box = listBox(skin);
  const n = a.entries.length;
  const title = a.title === undefined ? (m.title || '') : a.title;
  const edgeTitle = title !== '' && !!titleCapsOf(box);
  let withHint = true, withTitleRow = title !== '' && !edgeTitle;
  const fixed = () => 2 + (withTitleRow ? 2 : 0) + (withHint ? 2 : 0);
  const room = usableRows(f);
  // a scrolling window keeps the hint and title unless it would be left with fewer than 5 entry rows
  const need = Math.min(n, 5);
  if (room - fixed() < need) withHint = false;
  if (room - fixed() < need) withTitleRow = false;
  const avail = Math.max(1, room - fixed());
  const scrolling = n > avail;
  const shown = scrolling ? Math.max(1, avail >= 3 ? avail - 2 : avail) : n;
  const marks = scrolling && avail >= 3;
  const first = Math.max(0, Math.min(a.index - Math.floor(shown / 2), n - shown));
  const hasMore = (shown < n) && marks;
  const body = shown + (marks ? 2 : 0);

  const inner = Math.max(
    labelWidth(a.entries) + 4,
    withTitleRow ? lenOf(title) : 0,
    edgeTitle ? Math.min(lenOf(title) + 4, Math.max(0, f.cols - 8)) : 0,
    withHint ? Math.min(lenOf(hint), Math.max(0, f.cols - 8)) : 0,
    hasMore ? 12 : 0,
  );
  const w = Math.min(f.cols, inner + 4), h = body + fixed();
  const { x, y } = place(f, w, h, m.anchor);
  boxed(f, x, y, w, h, box, ui.dim);
  if (edgeTitle) putEdgeTitle(f, x, y, w, title, box, ui.dim, ui.head);
  let row = y + 1;
  if (withTitleRow) { putText(f, x + 2, row, title, ui.head, w - 4); row += 2; }
  if (marks) {
    if (first > 0) putText(f, x + 2, row, `↑ ${first} more`, ui.dim, w - 4);
    row++;
  }
  for (let k = 0; k < shown; k++) {
    const i = first + k;
    const e = a.entries[i];
    const sel = i === a.index;
    putRow(f, x + 2, row + k, w - 4, { left: [{ t: (sel ? cursor : ' ') + ' ', s: ui.accent }, ...labelParts(e, sel, ui)] });
  }
  if (marks) {
    const rest = n - first - shown;
    if (rest > 0) putText(f, x + 2, row + shown, `↓ ${rest} more`, ui.dim, w - 4);
  }
  if (withHint) putText(f, x + 2, y + h - 2, hint, ui.dim, w - 4);
}

// ---- slots

// One card's label row: cursor, Roman numeral, label (a later right field goes in `right`).
function slotRow(e, i, sel, ui, cursor) {
  return {
    left: [
      { t: ' ' + (sel ? cursor : ' ') + ' ', s: ui.accent },
      { t: pad(romanOf(i), NUMERAL_W) + '  ', s: sel ? ui.accent : ui.dim },
      ...labelParts(e, sel, ui),
    ],
  };
}

function drawSlots(f, a, skin) {
  const ui = uiOf(skin);
  const m = skin.menu || {};
  const cursor = m.cursor || '▶';
  const n = a.entries.length;
  const room = usableRows(f);
  const tall = f.rows >= SLOTS_TALL_ROWS && n * 4 <= room;
  const compact = n * 3 - 1 <= room;
  if (!tall && !compact) return drawList(f, a, skin);
  const w = Math.min(f.cols, Math.max(30, labelWidth(a.entries) + 3 + NUMERAL_W + 2 + 2 + 2));
  const total = tall ? n * 4 : n * 3 - 1;
  const { x, y } = place(f, w, total, m.anchor);
  const rest = restBox(skin);
  if (!tall) fillRect(f, x, y, w, total, 32, 0);
  for (let i = 0; i < n; i++) {
    const e = a.entries[i];
    const sel = i === a.index;
    if (tall) {
      const cy = y + i * 4;
      boxed(f, x, cy, w, 4, sel ? DOUBLE : rest, sel ? ui.accent : ui.dim);
      putRow(f, x + 1, cy + 1, w - 2, slotRow(e, i, sel, ui, cursor));
    } else {
      const cy = y + i * 3;
      putRow(f, x, cy, w, slotRow(e, i, sel, ui, cursor));
      if (i < n - 1) for (let k = 0; k < w; k++) putText(f, x + k, cy + 2, '┄', ui.dim);
    }
  }
}

// ---- grid

const LABEL_ROW = 3; // inside a tile; the rows above are kept for tile art

function drawGrid(f, a, skin) {
  const ui = uiOf(skin);
  const m = skin.menu || {};
  const n = a.entries.length;
  const per = f.cols >= GRID_THREE_COLS ? 3 : 2;
  const lines = Math.ceil(n / per);
  if (f.cols < GRID_MIN_COLS || lines * (TILE_H + 1) - 1 > usableRows(f)) return drawList(f, a, skin);
  const cols = Math.min(per, n);
  const totalW = cols * TILE_W + (cols - 1) * TILE_GAP;
  const totalH = lines * (TILE_H + 1) - 1;
  const top = place(f, totalW, totalH, m.anchor);
  const rest = restBox(skin);
  for (let i = 0; i < n; i++) {
    const e = a.entries[i];
    const sel = i === a.index;
    const x = top.x + (i % per) * (TILE_W + TILE_GAP), y = top.y + Math.floor(i / per) * (TILE_H + 1);
    boxed(f, x, y, TILE_W, TILE_H, sel ? DOUBLE : rest, sel ? ui.accent : ui.dim);
    const parts = labelParts(e, sel, ui);
    const len = lenOf(labelOf(e));
    const off = Math.max(1, Math.floor((TILE_W - len) / 2));
    putRow(f, x + off, y + LABEL_ROW, TILE_W - 1 - off, { left: parts });
  }
}

export function drawMenu(frame, args, skin) {
  if (!args || !args.entries || args.entries.length === 0 || frame.cols < 6 || frame.rows < 3) return;
  const a = { entries: args.entries, index: Math.max(0, Math.min(args.entries.length - 1, args.index | 0)), title: args.title };
  const layout = LAYOUT_NAMES[(skin.menu && skin.menu.layout) || 'list'] || 'list';
  if (layout === 'slots') drawSlots(frame, a, skin);
  else if (layout === 'grid') drawGrid(frame, a, skin);
  else drawList(frame, a, skin);
}

export { putCentered, boxChars };
