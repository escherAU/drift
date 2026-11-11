// The cartridge menu, drawn over the running scene (DRIFT-4). A stub: simple but correct. Pure.
//
//   drawMenu(frame, { entries, index, title }, skin)
//
//   entries  [{ label, current }]   current marks the program that is playing
//   index    the highlighted entry
//   title    the box title (skin.menu.title is used when absent)
//   skin     the cartridge skin; skin.menu: { layout, anchor, cursor, title, box }
//
// Three engine layouts (a skin picks one by name; there are no free-form layouts):
//   list   a boxed column of entries
//   slots  4-row cards, one per entry, 2-row below 30 rows
//   grid   22x7 tiles in rows; a list below 100 columns
// Only the cells inside the menu's boxes are written; the scene shows through everywhere else.
import { put, putText, putCentered, fillRect, drawBox, lenOf, centerX } from './ui.js';

export const LAYOUT_NAMES = Object.freeze({ list: 'list', slots: 'slots', grid: 'grid' });
export const TILE_W = 22;
export const TILE_H = 7;
export const DEFAULT_HINT = 'Up and down choose, Enter selects, Esc closes';

function boxed(f, x, y, w, h, box, shade) {
  fillRect(f, x, y, w, h, 32, 0);
  drawBox(f, x, y, w, h, box, shade);
}

function place(f, w, h, anchor) {
  const x = anchor === 'left' ? 2 : centerX(f.cols, w);
  const y = anchor === 'bottom' ? Math.max(0, f.rows - h - 1) : Math.max(0, Math.floor((f.rows - h) / 2));
  return { x: Math.max(0, x), y };
}

function drawList(f, a, skin) {
  const ui = skin.palette.ui;
  const m = skin.menu || {};
  const cursor = m.cursor || '▶';
  const hint = (skin.wording && skin.wording.menuHint) || DEFAULT_HINT;
  const n = a.entries.length;
  const labelW = Math.max(1, ...a.entries.map((e) => lenOf(e.label)));
  const title = a.title === undefined ? (m.title || '') : a.title;
  const inner = Math.max(labelW + 4, lenOf(title), Math.min(lenOf(hint), Math.max(0, f.cols - 8)));
  let withHint = true, withTitle = title !== '';
  const need = () => n + 2 + (withTitle ? 2 : 0) + (withHint ? 2 : 0);
  if (need() > f.rows) withHint = false;
  if (need() > f.rows) withTitle = false;
  const room = Math.max(1, f.rows - (need() - n));
  const first = Math.max(0, Math.min(a.index - Math.floor(room / 2), n - room));
  const shown = Math.min(n, room);
  const w = Math.min(f.cols, inner + 4), h = shown + (need() - n);
  const { x, y } = place(f, w, h, m.anchor);
  boxed(f, x, y, w, h, m.box, ui.dim);
  let row = y + 1;
  if (withTitle) { putText(f, x + 2, row, title, ui.head, w - 4); row += 2; }
  for (let k = 0; k < shown; k++) {
    const i = first + k;
    const e = a.entries[i];
    const sel = i === a.index;
    putText(f, x + 2, row + k, (sel ? cursor : ' ') + ' ' + e.label + (e.current ? ' *' : ''), sel ? ui.accent : ui.text, w - 4);
  }
  if (withHint) putText(f, x + 2, y + h - 2, hint, ui.dim, w - 4);
}

function drawSlots(f, a, skin) {
  const ui = skin.palette.ui;
  const m = skin.menu || {};
  const cursor = m.cursor || '▶';
  const n = a.entries.length;
  const tall = f.rows >= 30;
  const cardH = tall ? 4 : 2;
  if (n * cardH > f.rows) return drawList(f, a, skin);
  const labelW = Math.max(1, ...a.entries.map((e) => lenOf(e.label)));
  const w = Math.min(f.cols, labelW + 10);
  const top = place(f, w, n * cardH, m.anchor);
  for (let i = 0; i < n; i++) {
    const e = a.entries[i];
    const sel = i === a.index;
    const y = top.y + i * cardH;
    const text = (sel ? cursor : ' ') + ' ' + e.label + (e.current ? ' *' : '');
    if (tall) {
      boxed(f, top.x, y, w, 3, m.box, sel ? ui.accent : ui.dim);
      putText(f, top.x + 2, y + 1, text, sel ? ui.accent : ui.text, w - 4);
    } else {
      fillRect(f, top.x, y, w, 2, 32, 0);
      putText(f, top.x + 1, y, text, sel ? ui.accent : ui.text, w - 2);
      if (sel) for (let k = 1; k < w - 1; k++) put(f, top.x + k, y + 1, 0x2500, ui.accent);
    }
  }
}

function drawGrid(f, a, skin) {
  const ui = skin.palette.ui;
  const m = skin.menu || {};
  const n = a.entries.length;
  const per = Math.max(1, Math.floor((f.cols - 2) / (TILE_W + 2)));
  const lines = Math.ceil(n / per);
  if (f.cols < 100 || lines * (TILE_H + 1) > f.rows) return drawList(f, a, skin);
  const cols = Math.min(per, n);
  const totalW = cols * TILE_W + (cols - 1) * 2;
  const totalH = lines * TILE_H + (lines - 1);
  const top = place(f, totalW, totalH, m.anchor);
  for (let i = 0; i < n; i++) {
    const e = a.entries[i];
    const sel = i === a.index;
    const x = top.x + (i % per) * (TILE_W + 2), y = top.y + Math.floor(i / per) * (TILE_H + 1);
    boxed(f, x, y, TILE_W, TILE_H, m.box, sel ? ui.accent : ui.dim);
    const label = e.label + (e.current ? ' *' : '');
    putText(f, x + Math.max(1, Math.floor((TILE_W - lenOf(label)) / 2)), y + Math.floor(TILE_H / 2), label, sel ? ui.accent : ui.text, TILE_W - 2);
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

export { putCentered };
