// Small drawing helpers shared by the console screens (DRIFT-4). Pure: they write into a frame
// { glyphs: Uint16Array, shades: Uint8Array, fg: Uint32Array, bg: Uint32Array, cols, rows } and never throw, whatever the
// size. fg/bg (0xRRGGBB) are read only for a cell whose shade is RGB_CELL (255); every copy of a frame copies them too.
import { fadeOffsets } from '../compose.js';
import { DEFAULT_UI } from '../cartridge/palette.js';

export const MSG_TOO_SMALL = 'Make the window bigger to see the cartridges.';
export const DEFAULT_BOX = '┌─┐│┘─└│'; // tl t tr r br b bl l

// The skin's four UI shades with the defaults filled in (a validated skin keeps only the ones it names).
export function uiOf(skin) {
  return { ...DEFAULT_UI, ...((skin && skin.palette && skin.palette.ui) || {}) };
}

export function newFrame(cols, rows) {
  const c = Math.max(0, cols | 0), r = Math.max(0, rows | 0);
  return { glyphs: new Uint16Array(c * r).fill(32), shades: new Uint8Array(c * r), fg: new Uint32Array(c * r), bg: new Uint32Array(c * r), cols: c, rows: r };
}

// Every cell blank, shade 0 (a blank cell always has shade 0, so frame diffs stay honest).
export function clearFrame(f) {
  f.glyphs.fill(32);
  f.shades.fill(0);
}

export function put(f, x, y, cp, shade) {
  if (x < 0 || y < 0 || x >= f.cols || y >= f.rows) return;
  const i = y * f.cols + x;
  f.glyphs[i] = cp;
  f.shades[i] = cp === 32 ? 0 : shade;
}

// Text at (x, y); spaces are skipped (the cell underneath stays), at most maxW cells.
export function putText(f, x, y, text, shade, maxW = Infinity) {
  let n = 0;
  for (const ch of String(text)) {
    if (n >= maxW) break;
    const cp = ch.codePointAt(0);
    if (cp !== 32) put(f, x + n, y, cp, shade);
    n++;
  }
}

export const lenOf = (s) => [...String(s)].length;
export const centerX = (cols, len) => Math.max(0, Math.floor((cols - len) / 2));

export function putCentered(f, y, text, shade, maxW = f.cols) {
  const s = [...String(text)].slice(0, Math.max(0, maxW)).join('');
  putText(f, centerX(f.cols, lenOf(s)), y, s, shade);
}

export function fillRect(f, x, y, w, h, cp = 32, shade = 0) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(f, x + i, y + j, cp, shade);
}

// A box of w x h cells with the 8-character border set (tl t tr r br b bl l). Interior left alone.
export function drawBox(f, x, y, w, h, chars, shade) {
  if (w < 2 || h < 2) return;
  const b = [...(chars || DEFAULT_BOX)].map((c) => c.codePointAt(0));
  for (let i = 1; i < w - 1; i++) { put(f, x + i, y, b[1], shade); put(f, x + i, y + h - 1, b[5], shade); }
  for (let j = 1; j < h - 1; j++) { put(f, x, y + j, b[7], shade); put(f, x + w - 1, y + j, b[3], shade); }
  put(f, x, y, b[0], shade); put(f, x + w - 1, y, b[2], shade);
  put(f, x, y + h - 1, b[6], shade); put(f, x + w - 1, y + h - 1, b[4], shade);
}

// ---- shared by the menu and the chrome (DRIFT-4 A4)

// A skin's border glyph set, else the default (tl t tr r br b bl l).
export const boxChars = (box) => [...(box || DEFAULT_BOX)];

// The single title rule: when a border's top glyph is a double or heavy line ('═' or '━') the title is set into the edge
// between two caps, '╡ TITLE ╞' ('┥ TITLE ┝' for heavy); on any other border it is just ' TITLE ' (spaces around, no caps).
export function titleCapsOf(box) {
  const top = boxChars(box)[1];
  if (top === '═') return ['╡', '╞'];
  if (top === '━') return ['┥', '┝'];
  return null;
}

// Set a title into the edge of a box whose top-left is (x, y) and whose width is w: starts two cells in, leaves two
// cells of border at the far end, clips the title to fit. The spaces round it are blanks (not border showing
// through). Returns false when there is no room for even one letter.
export function putEdgeTitle(f, x, y, w, title, box, edgeShade, titleShade) {
  const caps = titleCapsOf(box);
  const avail = w - 4 - (caps ? 2 : 0) - 2;
  const t = [...String(title || '')].slice(0, Math.max(0, avail)).join('');
  if (avail <= 0 || t === '') return false;
  let cx = x + 2;
  if (caps) put(f, cx++, y, caps[0].codePointAt(0), edgeShade);
  put(f, cx++, y, 32, 0);
  for (const ch of t) put(f, cx++, y, ch.codePointAt(0), titleShade); // spaces inside the title are blanks, not the border
  put(f, cx++, y, 32, 0);
  if (caps) put(f, cx, y, caps[1].codePointAt(0), edgeShade);
  return true;
}

// A row composed of parts: { left: [{ t, s }...], right: [{ t, s }...] } inside w cells from x. The left parts run from
// the left edge, the right parts end at the right edge (a field the row can grow later: a note, a duration), and
// whatever does not fit is cut. Spaces are skipped (the cell underneath stays).
export function putRow(f, x, y, w, { left = [], right = [] } = {}) {
  const rw = right.reduce((n, p) => n + lenOf(p.t), 0);
  const leftRoom = Math.max(0, w - (rw > 0 ? rw + 1 : 0));
  let cx = 0;
  for (const p of left) {
    if (cx >= leftRoom) break;
    putText(f, x + cx, y, p.t, p.s, leftRoom - cx);
    cx += lenOf(p.t);
  }
  if (rw > 0 && rw <= w) {
    cx = w - rw;
    for (const p of right) { putText(f, x + cx, y, p.t, p.s); cx += lenOf(p.t); }
  }
}

// Greedy word wrap into lines of at most width characters (a word longer than the width is cut).
export function wrapWords(text, width) {
  const w = Math.max(1, width | 0);
  const lines = [];
  let cur = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    let wd = word;
    while (lenOf(wd) > w) {
      if (cur) { lines.push(cur); cur = ''; }
      lines.push([...wd].slice(0, w).join(''));
      wd = [...wd].slice(w).join('');
    }
    if (!cur) cur = wd;
    else if (lenOf(cur) + 1 + lenOf(wd) <= w) cur += ' ' + wd;
    else { lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Library size tiers: full >= 88x39, compact >= 78x24, list (text only) >= 40x10, otherwise tiny.
export function sizeTier(cols, rows) {
  if (cols >= 88 && rows >= 39) return 'full';
  if (cols >= 78 && rows >= 24) return 'compact';
  if (cols >= 40 && rows >= 10) return 'list';
  return 'tiny';
}

// Smooth 0..1 ramp of t between a and b.
export function ramp(t, a, b) {
  if (b <= a) return t >= b ? 1 : 0;
  const x = (t - a) / (b - a);
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

// Per-cell dissolve thresholds in (0, 1), the same ones the cell composer uses (0.98 spread + 0.01).
const thrCache = new Map();
export function dissolveThresholds(n) {
  let thr = thrCache.get(n);
  if (!thr) {
    thr = fadeOffsets(n, 0.98);
    for (let i = 0; i < n; i++) thr[i] += 0.01;
    if (thrCache.size > 8) thrCache.clear();
    thrCache.set(n, thr);
  }
  return thr;
}

// Print the "too small" message wrapped to the width, centred, in as many rows as it needs.
export function drawTooSmall(f, shade) {
  const lines = wrapWords(MSG_TOO_SMALL, Math.max(1, f.cols));
  const y0 = Math.max(0, Math.floor((f.rows - lines.length) / 2));
  for (let k = 0; k < lines.length; k++) putCentered(f, y0 + k, lines[k], shade);
}
