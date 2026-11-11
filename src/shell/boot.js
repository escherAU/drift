// The boot screen, second part of the cartridge timeline (DRIFT-4). A stub: right phases, right order,
// flash-safe; Ana's art replaces the drawing, not the timing.
//
//   drawBoot(frame, { skin, labelArt, bootArt, t, loading, error, title }, consoleSkin)
//
//   skin       the cartridge's validated skin (the console skin for Classic)
//   labelArt   the cartridge's label rows (shown when there is no boot art)
//   bootArt    the cartridge's boot.txt rows, or null
//   t          seconds since the boot screen began, 0..bootSeconds(skin)
//   loading    true while the scenes are still loading (the bar holds just short of full)
//   error      text of a load failure: draws the error card instead of the boot
//   title      the cartridge's title, drawn in big capitals on the title card
//
// Timeline of the whole cartridge start, in seconds from Enter (INSERT_END = 1.5 is where this begins):
//   1.5 - 1.7  screen on: a line grows from the centre to full width
//   1.7 - 1.9  it opens to full height (dark background, no flash)
//   1.9 - 3.4  boot lines type out, 0.25 s each
//   3.4 - 3.8  progress bar (the shell holds here until the scenes have loaded)
//   3.8 - 4.6  the screen rectangle zooms to fill the terminal, its edge in the skin's frame glyphs
//   4.6 - 5.2  title card in big block capitals
//   5.2 - 5.8  the title dissolves cell by cell into the cartridge's menu (the shell composes it)
// skin.boot.seconds, when given, replaces the 1.5 s the typed lines take. Every brightness change is a
// ramp of at least 0.15 s; the background never changes.
import { INSERT_END } from './insert.js';
import { FONT } from '../scenes/blockfont.js';
import { clearFrame, put, putText, putCentered, drawBox, ramp, dissolveThresholds, wrapWords, lenOf } from './ui.js';

export const SCREEN_ON_END = INSERT_END + 0.4; // 1.9
export const LINES_END = SCREEN_ON_END + 1.5; // 3.4
export const BAR_END = LINES_END + 0.4; // 3.8
export const ZOOM_END = BAR_END + 0.8; // 4.6
export const TITLE_END = ZOOM_END + 0.6; // 5.2
export const BOOT_END = TITLE_END + 0.6; // 5.8
export const LINE_SECONDS = 0.25;

const DEFAULT_LINES_SECONDS = LINES_END - SCREEN_ON_END;

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

const FILL = [0x258f, 0x258e, 0x258d, 0x258c, 0x258b, 0x258a, 0x2589, 0x2588]; // eighths: left bar 1/8 .. full

function titleCard(f, title, shade, appearP) {
  const text = String(title || '').toUpperCase();
  const thr = appearP < 1 ? dissolveThresholds(f.cols * f.rows) : null;
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
    for (const c of cells) {
      if (!c.g) continue;
      for (let r = 0; r < 7; r++) {
        for (let k = 0; k < 5; k++) {
          if (c.g[r][k] !== '#') continue;
          for (let d = 0; d < sx; d++) {
            const x = x0 + c.x + k * sx + d, y = y0 + r;
            if (x < 0 || x >= f.cols || y < 0 || y >= f.rows) continue;
            if (thr && appearP < thr[y * f.cols + x]) continue;
            put(f, x, y, 0x2588, shade);
          }
        }
      }
    }
    return;
  }
  putCentered(f, Math.floor(f.rows / 2), text, shade); // too small for the big letters
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

export function drawBoot(frame, args, consoleSkin) {
  const { skin, t, loading, error } = args;
  const sk = skin || consoleSkin;
  const ui = sk.palette.ui;
  clearFrame(frame);
  const f = frame;
  if (f.cols < 6 || f.rows < 4) return;
  if (error) { errorCard(f, String(error), ui); return; }
  const P = bootPhases(sk);
  const T = Number.isFinite(t) ? Math.max(0, Math.min(P.end, t)) : 0;
  const glyphs = (sk.frame && sk.frame.glyphs) || '┌─┐│┘─└│';
  const edge = (sk.frame && sk.frame.colour !== undefined) ? sk.frame.colour : ui.dim;

  // the screen rectangle
  const w0 = Math.max(6, Math.min(f.cols - 4, 64)), h0 = Math.max(4, Math.min(f.rows - 2, 20));
  const x0 = Math.floor((f.cols - w0) / 2), y0 = Math.floor((f.rows - h0) / 2);
  const mid = Math.floor(f.rows / 2);

  if (T < P.on) {
    // screen on: a line grows from the centre, then opens to full height
    const grow = ramp(T, 0, 0.2), open = ramp(T, 0.2, 0.4);
    const w = Math.max(1, Math.round(w0 * grow));
    if (open <= 0) {
      for (let i = 0; i < w; i++) put(f, Math.floor((f.cols - w) / 2) + i, mid, 0x2500, edge);
    } else {
      const h = Math.max(3, Math.round(3 + (h0 - 3) * open));
      drawBox(f, x0, Math.floor((f.rows - h) / 2), w0, h, glyphs, edge);
    }
    return;
  }

  const zoom = ramp(T, P.barEnd, P.zoomEnd);
  const ez = zoom * zoom * (3 - 2 * zoom);
  const w = Math.round(w0 + (f.cols - w0) * ez), h = Math.round(h0 + (f.rows - h0) * ez);
  drawBox(f, Math.floor((f.cols - w) / 2), Math.floor((f.rows - h) / 2), w, h, glyphs, edge);

  if (T < P.zoomEnd) {
    // typed lines (and art) inside the base rectangle, then the progress bar
    const art = sk.boot && sk.boot.art && args.bootArt ? args.bootArt : null;
    let y = y0 + 1;
    if (art) for (const row of art.slice(0, Math.max(0, Math.floor((h0 - 6) / 1)))) { putText(f, x0 + 2, y++, row, ui.dim, w0 - 4); }
    const lines = (sk.boot && sk.boot.lines) || (consoleSkin && consoleSkin.boot && consoleSkin.boot.lines) || [];
    for (let k = 0; k < lines.length && y < y0 + h0 - 3; k++, y++) {
      const a = P.on + k * LINE_SECONDS;
      const n = Math.round(lenOf(lines[k]) * ramp(T, a, a + LINE_SECONDS));
      if (n > 0) putText(f, x0 + 2, y, [...lines[k]].slice(0, n).join(''), ui.text, w0 - 4);
    }
    if (T >= P.linesEnd) {
      const barW = Math.max(2, w0 - 6);
      const u = ramp(T, P.linesEnd, P.barEnd) * (loading ? 0.92 : 1);
      const eighths = Math.round(u * barW * 8);
      const by = y0 + h0 - 2;
      put(f, x0 + 2, by, 0x5b, ui.dim); put(f, x0 + 3 + barW, by, 0x5d, ui.dim);
      for (let i = 0; i < barW; i++) {
        const e = Math.max(0, Math.min(8, eighths - i * 8));
        if (e > 0) put(f, x0 + 3 + i, by, FILL[e - 1], ui.head);
      }
    }
    return;
  }
  if (T < P.zoomEnd) return;
  // title card, appearing cell by cell over its first half
  titleCard(f, args.title, ui.head, ramp(T, P.zoomEnd, P.zoomEnd + 0.3));
}
