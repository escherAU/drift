// The boot screen, second part of the cartridge timeline (DRIFT-4, designer section 3, steps 6-12). Pure.
//
//   drawBoot(frame, { skin, labelArt, bootArt, t, loading, error, title, item, consoleMap }, consoleSkin)
//
//   skin       the cartridge's validated skin (the console skin for Classic)
//   labelArt   the cartridge's label rows (24 x 10); shown above the title card when there is no boot art and room
//   bootArt    the cartridge's boot.txt rows, or null
//   t          seconds since the boot screen began, 0..bootSeconds(skin)
//   loading    true while the scenes are still loading (the bar holds just short of full)
//   error      text of a load failure: draws the error card instead of the boot
//   title      the cartridge's title, drawn in big capitals on the title card
//   item       optional, the shape drawInsert takes: when present the boot is drawn ON the console in its post-insert
//              state (cartridge seated, CART LED on, takeover applied) inside the console's screen rectangle
//              (screenRect in library.js: 46 x 9 at the full tier, the 38 x 9 blurb box at the compact tier). Without
//              it, or below the compact tier, the boot is drawn in a centred rectangle on a blank frame
//   consoleMap optional (shade) => shade: where the console's library colours live in the boot palette
//              (mergeBootPalette); identity when absent
//
// Timeline of the whole cartridge start, in seconds from Enter (INSERT_END = 1.5 is where this begins):
//   1.5 - 1.7  step 6   a line grows from the centre of the screen to its full width
//   1.7 - 1.9  step 7   it opens to the full screen height (dark inside, no flash)
//   1.9 - 3.4  step 8   boot lines type out, 0.25 s each; the LINK LED goes cyan as the last one lands
//   3.4 - 3.8  step 9   progress bar in eighth-cell steps (the shell holds here until the scenes have loaded)
//   3.8 - 4.6  step 10  the screen rectangle zooms (ease in and out) to fill the terminal, its edge in the skin's frame
//                       glyphs: the last frame is exactly drawChrome's border, which is the menu's frame
//   4.6 - 5.2  step 11  title card in block capitals, revealed left to right over 0.3 s (with the label above it
//                       and the skin's ornament row under it, if it has one)
//   5.2 - 5.8  step 12  the title dissolves cell by cell into the menu (the shell composes the dissolve)
// skin.boot.seconds, when given, replaces the 1.5 s the typed lines take. Every brightness change is a one-shade
// step or a dissolve; the background never changes.
import { INSERT_END, drawInsert } from './insert.js';
import { screenRect } from './library.js';
import { cartridgeLines } from './driftman.js';
import { drawChrome } from './chrome.js';
import { FONT } from '../scenes/blockfont.js';
import {
  clearFrame, uiOf, put, putText, putCentered, centerX, fillRect, drawBox, ramp, dissolveThresholds, wrapWords, lenOf, sizeTier,
} from './ui.js';

export const SCREEN_ON_END = INSERT_END + 0.4; // 1.9
export const LINES_END = SCREEN_ON_END + 1.5; // 3.4
export const BAR_END = LINES_END + 0.4; // 3.8
export const ZOOM_END = BAR_END + 0.8; // 4.6
export const TITLE_END = ZOOM_END + 0.6; // 5.2
export const BOOT_END = TITLE_END + 0.6; // 5.8
export const LINE_SECONDS = 0.25;
export const REVEAL_SECONDS = 0.3; // the title card is revealed left to right over this long
export const TEXT_CLEAR_SECONDS = 0.35; // the typed text dissolves away at the start of the zoom

const DEFAULT_LINES_SECONDS = LINES_END - SCREEN_ON_END;
const CONSOLE_COLOURS = 20; // the console's own palette entries (silver 0-15, amber, cyan, graphite, dim)

// Phase end times in boot-local seconds (0 = the moment the boot screen begins).
export function bootPhases(skin) {
  const span = skin && skin.boot && skin.boot.seconds !== undefined ? skin.boot.seconds : DEFAULT_LINES_SECONDS;
  const on = SCREEN_ON_END - INSERT_END; // 0.4
  const linesEnd = on + span;
  const barEnd = linesEnd + (BAR_END - LINES_END);
  const zoomEnd = barEnd + (ZOOM_END - BAR_END);
  const titleEnd = zoomEnd + (TITLE_END - ZOOM_END);
  return { on, linesEnd, barEnd, zoomEnd, titleEnd, end: titleEnd + (BOOT_END - TITLE_END) };
}

export function bootSeconds(skin) {
  return bootPhases(skin).end;
}

// ---- the boot text

// The lines the console types: its core lines (consoleSkin.boot.lines), then the cartridge's own (skin.boot.lines), or
// - when it has none, or is the console skin itself - one line naming the cartridge. Only as many as the screen has
// rows are drawn (drawBoot).
export function bootLines(skin, consoleSkin, title) {
  const core = (consoleSkin && consoleSkin.boot && consoleSkin.boot.lines) || [];
  const own = skin && skin !== consoleSkin && skin.boot && skin.boot.lines;
  return [...core, ...(own && own.length ? own : cartridgeLines(title))];
}

// A line as runs of text, so each run can have its own colour: the text up to a run of three or more dots and a space
// ('text'), the dots ('dots') and what follows them ('value': the 'OK'-style words). A line without such a run, or
// with nothing after it, is one 'text' run.
export function lineRuns(line) {
  const s = String(line);
  const m = /\.{3,} /.exec(s);
  if (!m || m.index + m[0].length >= s.length) return [{ text: s, kind: 'text' }];
  const runs = [];
  if (m.index > 0) runs.push({ text: s.slice(0, m.index), kind: 'text' });
  runs.push({ text: m[0], kind: 'dots' }, { text: s.slice(m.index + m[0].length), kind: 'value' });
  return runs;
}

// The shade of each kind of run. Schema item 8 makes the value colour a skin field (boot.valueColour): this is
// the one place that changes.
function runShade(kind, ui, skin) {
  if (kind === 'value') return valueColour(skin, ui);
  return kind === 'dots' ? ui.dim : ui.text;
}
// HOOK (schema item 8): the colour of the value words. Today the skin's accent.
function valueColour(skin, ui) {
  return ui.accent;
}

// One shade per character of the line.
function lineCells(line, ui, skin) {
  const out = [];
  for (const r of lineRuns(line)) for (const ch of r.text) out.push({ ch, shade: runShade(r.kind, ui, skin) });
  return out;
}

// ---- the boot palette: the console's colours alongside the cartridge's

// While the cartridge boots the frame holds the console (drawn in library colours) and the cartridge's own screen
// (skin colours). The merged palette is the cartridge's palette first, so the running cartridge's indices need no
// change at all, then the console's 20 colours and the cartridge's 4 tints, all on the cartridge's background.
//   -> { pal, map }    map(libraryShade) -> shade in the merged palette
export function mergeBootPalette(cartPal, libPal, tint) {
  const off = cartPal.sgr.length;
  const base = cartPal.base || '';
  const take = (i) => {
    let s = libPal.sgr[i];
    if (libPal.base && s.endsWith(libPal.base)) s = s.slice(0, -libPal.base.length);
    return s + base;
  };
  const sgr = cartPal.sgr.slice();
  for (let i = 0; i < CONSOLE_COLOURS; i++) sgr.push(take(i));
  for (let k = 0; k < 4; k++) sgr.push(take(tint + k));
  const map = (i) => (i < CONSOLE_COLOURS ? off + i : (i >= tint && i < tint + 4 ? off + CONSOLE_COLOURS + (i - tint) : off + 18));
  return { pal: { ...cartPal, key: `boot:${cartPal.key}:${tint}`, sgr }, map };
}

// ---- drawing pieces

const FILL = [0x258f, 0x258e, 0x258d, 0x258c, 0x258b, 0x258a, 0x2589, 0x2588]; // eighths: left bar 1/8 .. full

// The ornament row drawn under the title card: console.title.ornament, else the older hook fields. A skin without one has none.
export function titleOrnament(skin) {
  const ct = skin.console && skin.console.title;
  const o = (ct && ct.ornament) || (skin.menu && skin.menu.ornament) || (skin.frame && skin.frame.ornament) || (skin.title && skin.title.ornament) || null;
  return typeof o === 'string' && o ? o : null;
}

// The title in big block capitals, revealed left to right: `reveal` (0..1) is the fraction of its columns shown.
// style 'spaced' sets the capitals as plain text with a single space between letters, 'plain' as plain centred text
// (spaced falls back to plain when it does not fit); 'block' (default) is the big letters, and falls back to plain
// text when they do not fit. Returns { top, bottom, left, width } of what it drew (the ornament and the label go round it).
function titleCard(f, title, shade, reveal, style = 'block') {
  const text = String(title || '').toUpperCase();
  if (style === 'spaced' || style === 'plain') {
    const shown = style === 'spaced' && lenOf(text) * 2 - 1 <= f.cols - 2 ? [...text].join(' ') : [...text].slice(0, Math.max(0, f.cols - 2)).join('');
    const w = lenOf(shown), x0 = centerX(f.cols, w), y = Math.floor(f.rows / 2);
    putText(f, x0, y, [...shown].slice(0, Math.ceil(w * Math.max(0, Math.min(1, reveal)))).join(''), shade);
    return { top: y, bottom: y, left: x0, width: w };
  }
  for (const sx of [2, 1]) {
    const cells = [];
    let w = 0;
    for (const ch of text) {
      const g = FONT[ch];
      const cw = g ? 5 * sx : 3 * sx;
      cells.push({ g, x: w });
      w += cw + sx;
    }
    w -= sx;
    if (w > f.cols - 2 || f.rows < 9 || w <= 0) continue;
    const x0 = Math.floor((f.cols - w) / 2), y0 = Math.floor((f.rows - 7) / 2);
    const shown = Math.ceil(w * Math.max(0, Math.min(1, reveal)));
    for (const c of cells) {
      if (!c.g) continue;
      for (let r = 0; r < 7; r++) {
        for (let k = 0; k < 5; k++) {
          if (c.g[r][k] !== '#') continue;
          for (let d = 0; d < sx; d++) {
            const col = c.x + k * sx + d;
            if (col >= shown) continue;
            put(f, x0 + col, y0 + r, 0x2588, shade);
          }
        }
      }
    }
    return { top: y0, bottom: y0 + 6, left: x0, width: w };
  }
  // too small for the big letters
  const y = Math.floor(f.rows / 2);
  const n = Math.ceil(lenOf(text) * Math.max(0, Math.min(1, reveal)));
  putCentered(f, y, [...text].slice(0, n).join(''), shade);
  return { top: y, bottom: y, left: centerX(f.cols, lenOf(text)), width: lenOf(text) };
}

// Rows of text (the label or the boot art) drawn left to right with the same reveal, centred, ending above `bottom`.
function drawAbove(f, rowsArt, bottomY, shade, reveal, maxW) {
  const rowsA = rowsArt.map((r) => [...String(r)].slice(0, maxW));
  const w = Math.max(0, ...rowsA.map((r) => r.length));
  const h = rowsA.length;
  const y0 = bottomY - 1 - h; // one blank row between the art and the title
  if (h === 0 || w === 0 || y0 < 1 || w > f.cols - 2) return;
  const x0 = centerX(f.cols, w);
  const shown = Math.ceil(w * Math.max(0, Math.min(1, reveal)));
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < Math.min(shown, rowsA[r].length); c++) if (rowsA[r][c] !== ' ') put(f, x0 + c, y0 + r, rowsA[r][c].codePointAt(0), shade);
  }
}

function errorCard(f, message, ui) {
  const w = Math.max(10, Math.min(f.cols - 2, 60));
  const lines = ['Cartridge problem', '', ...wrapWords(message || 'unknown problem', w - 4), '', 'Back to the library ...'];
  const h = Math.min(f.rows, lines.length + 2);
  const bw = Math.min(f.cols, Math.max(...lines.map(lenOf)) + 4);
  const x0 = Math.floor((f.cols - bw) / 2), y0 = Math.floor((f.rows - h) / 2);
  drawBox(f, x0, y0, bw, h, null, ui.accent);
  for (let k = 0; k < lines.length && 1 + k < h - 1; k++) putText(f, x0 + 2, y0 + 1 + k, lines[k], k === 0 ? ui.head : ui.text, Math.max(0, bw - 4));
}

// A rectangle with the skin's frame glyphs, its inside cleared (dark). h = 1 is just the line.
function drawRect(f, r, glyphs, edge) {
  if (r.w < 1 || r.h < 1) return;
  fillRect(f, r.x, r.y, r.w, r.h, 32, 0);
  if (r.h === 1 || r.w < 2) {
    const top = [...glyphs][1].codePointAt(0);
    for (let i = 0; i < r.w; i++) put(f, r.x + i, r.y, top, edge);
    return;
  }
  drawBox(f, r.x, r.y, r.w, r.h, glyphs, edge);
}

export function drawBoot(frame, args, consoleSkin) {
  const { skin, t, loading, error, item } = args;
  const sk = skin || consoleSkin;
  const ui = uiOf(sk);
  clearFrame(frame);
  const f = frame;
  if (f.cols < 6 || f.rows < 4) return;
  if (error) { errorCard(f, String(error), ui); return; }
  const P = bootPhases(sk);
  const T = Number.isFinite(t) ? Math.max(0, Math.min(P.end, t)) : 0;
  const glyphs = (sk.frame && sk.frame.glyphs) || '┌─┐│┘─└│';
  const edge = (sk.frame && sk.frame.colour !== undefined) ? sk.frame.colour : ui.dim;
  const lines = bootLines(sk, consoleSkin, args.title);
  const map = args.consoleMap || ((s) => s);

  // the screen rectangle: the console's screen when the console is drawn, else a centred rectangle
  const tier = sizeTier(f.cols, f.rows);
  const onConsole = !!item && (tier === 'full' || tier === 'compact');
  let R0 = onConsole ? screenRect(f.cols, f.rows, tier) : null;
  if (!R0) {
    const w0 = Math.max(6, Math.min(f.cols - 4, 64)), h0 = Math.max(4, Math.min(f.rows - 2, 20));
    R0 = { x: Math.floor((f.cols - w0) / 2), y: Math.floor((f.rows - h0) / 2), w: w0, h: h0 };
  }
  const textRows = Math.max(0, R0.h - 3); // rows for lines; the last interior row is the bar
  const shownLines = lines.slice(0, textRows);

  if (onConsole) {
    // the console as the insert left it; its LINK LED lights as the last line lands
    const linked = shownLines.length > 0 && T >= P.on + shownLines.length * LINE_SECONDS;
    drawInsert(f, { item, t: INSERT_END, link: linked }, consoleSkin);
    for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] !== 32) f.shades[i] = map(f.shades[i]);
  }

  // ---- steps 6 and 7: the line grows, then opens (before the zoom starts the rectangle is R0)
  if (T < P.on) {
    const grow = ramp(T, 0, 0.2), open = ramp(T, 0.2, 0.4);
    if (open <= 0) {
      const w = Math.round(R0.w * grow);
      if (w > 0) drawRect(f, { x: R0.x + Math.floor((R0.w - w) / 2), y: R0.y + Math.floor(R0.h / 2), w, h: 1 }, glyphs, edge);
    } else {
      const h = 1 + Math.round((R0.h - 1) * open);
      drawRect(f, { x: R0.x, y: R0.y + Math.floor((R0.h - h) / 2), w: R0.w, h }, glyphs, edge);
    }
    return;
  }

  // ---- steps 8-10: the rectangle (R0, then zooming), with the typed lines and the bar in R0
  const zoom = ramp(T, P.barEnd, P.zoomEnd);
  const ez = zoom * zoom * (3 - 2 * zoom);
  const full = ez >= 1;
  if (full) {
    clearFrame(f);
    drawChrome(f, sk); // the zoom's last frame IS the menu's frame
  } else {
    const x0 = Math.round(R0.x * (1 - ez)), y0 = Math.round(R0.y * (1 - ez));
    const x1 = Math.round((R0.x + R0.w) + (f.cols - R0.x - R0.w) * ez), y1 = Math.round((R0.y + R0.h) + (f.rows - R0.y - R0.h) * ez);
    drawRect(f, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, glyphs, edge);
  }

  if (T < P.zoomEnd) {
    const gone = ramp(T, P.barEnd, P.barEnd + TEXT_CLEAR_SECONDS);
    const thr = gone > 0 ? dissolveThresholds(f.cols * f.rows) : null;
    const keep = (x, y) => !thr || gone < thr[y * f.cols + x];
    const textW = Math.max(0, R0.w - 4);
    const art = sk.boot && sk.boot.art && args.bootArt && !onConsole ? args.bootArt : null;
    let y = R0.y + 1;
    if (art) for (const row of art.slice(0, Math.max(0, R0.h - 6))) { putClipped(f, R0.x + 2, y++, row, ui.dim, textW, keep); }
    for (let k = 0; k < shownLines.length && y < R0.y + R0.h - 2; k++, y++) {
      const a = P.on + k * LINE_SECONDS;
      const n = Math.round(lenOf(shownLines[k]) * ramp(T, a, a + LINE_SECONDS));
      if (n <= 0) continue;
      const cells = lineCells(shownLines[k], ui, sk).slice(0, n);
      for (let c = 0; c < cells.length && c < textW; c++) if (cells[c].ch !== ' ' && keep(R0.x + 2 + c, y)) put(f, R0.x + 2 + c, y, cells[c].ch.codePointAt(0), cells[c].shade);
    }
    if (T >= P.linesEnd) {
      const barW = Math.max(2, R0.w - 6);
      const u = ramp(T, P.linesEnd, P.barEnd) * (loading ? 0.92 : 1);
      const eighths = Math.round(u * barW * 8);
      const by = R0.y + R0.h - 2;
      if (keep(R0.x + 2, by)) put(f, R0.x + 2, by, 0x5b, ui.dim);
      if (keep(R0.x + 3 + barW, by)) put(f, R0.x + 3 + barW, by, 0x5d, ui.dim);
      for (let i = 0; i < barW; i++) {
        const e = Math.max(0, Math.min(8, eighths - i * 8));
        if (e > 0 && keep(R0.x + 3 + i, by)) put(f, R0.x + 3 + i, by, FILL[e - 1], ui.head);
      }
    }
    return;
  }

  // ---- step 11: the title card, revealed left to right
  const reveal = ramp(T, P.zoomEnd, P.zoomEnd + REVEAL_SECONDS);
  const ct = (sk.console && sk.console.title) || {};
  const tc = titleCard(f, args.title, ct.colour === undefined ? ui.head : ct.colour, reveal, ct.style);
  const orn = titleOrnament(sk);
  if (orn && tc.bottom + 2 < f.rows - 1) {
    const o = [...orn].slice(0, Math.max(0, f.cols - 2)).join(''); // set at its final place, then revealed left to right
    putText(f, centerX(f.cols, lenOf(o)), tc.bottom + 2, [...o].slice(0, Math.ceil(lenOf(o) * reveal)).join(''), ct.ornamentColour === undefined ? ui.dim : ct.ornamentColour);
  }
  const art = sk.boot && sk.boot.art && args.bootArt ? args.bootArt : null;
  if (art) drawAbove(f, art, tc.top, ui.dim, reveal, f.cols - 2);
  else if (args.labelArt) drawAbove(f, args.labelArt.slice(0, 10), tc.top, item ? map(item.cartridge.tint + 1) : 8, reveal, 24);
}

function putClipped(f, x, y, text, shade, maxW, keep) {
  let n = 0;
  for (const ch of String(text)) {
    if (n >= maxW) break;
    if (ch !== ' ' && keep(x + n, y)) put(f, x + n, y, ch.codePointAt(0), shade);
    n++;
  }
}
