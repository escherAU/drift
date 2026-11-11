// The cartridge library screen and the console body it shares with the insert animation (DRIFT-4).
// A stub: simple but correct. Pure; writes every cell it owns (it clears the whole frame first).
//
//   drawLibrary(frame, view, skin)       skin = the console skin (driftman.js)
//
//   frame  { glyphs: Uint16Array, shades: Uint8Array, cols, rows }
//   view   {
//     cartridges: [{ id, title, code, blurb, facts: [text], locked, label: [text rows, <= 24x10],
//                    ink: [rows of digits 0-3] | null (per-glyph brightness; absent = solid),
//                    tint: palette index of the cartridge's 4 brightness levels (tint+0 dim .. tint+3 bright) }],
//     index   the cartridge under the cursor
//     prev    the cursor's previous position (for the ramp)
//     slide   0..1 ramp since the last cursor move (the new cartridge brightens, the old one dims)
//     message text shown near the bottom ('' = none)
//     dip     0 or 1: rows the selected cartridge is pressed down (the locked "dip and spring back")
//     tier    'full' | 'compact' | 'list' | 'tiny'   (optional; worked out from the frame size)
//   }
// Size tiers: full >= 88x39 (three cartridges, details), compact >= 78x24 (one cartridge, blurb),
// list >= 40x10 (text list), below that one line asking for a bigger window.
import { put, putText, putCentered, centerX, lenOf, drawBox, wrapWords, clearFrame, sizeTier, drawTooSmall, dissolveThresholds } from './ui.js';
import { DRIFTMAN_COLOURS } from './driftman.js';

export const LABEL_W = 24;
export const LABEL_H = 10;
export const NEIGHBOUR_STEP = 28;
export const SLOT_W = 30;
export const SLOT_H = 3;
export const SLOT_BOX = '╔═╗║╝═╚║';
export const LIBRARY_HINT = 'left/right choose   Enter insert   h help   q quit';
export const TITLE_TEXT = 'D R I F T M A N   2 0 0 0';

const wrapIdx = (i, n) => ((i % n) + n) % n;

// Where everything sits for a frame size (full and compact tiers).
export function shelfLayout(cols, rows, tier) {
  const full = tier === 'full';
  const infoH = full ? 10 : 3;
  const blockH = 2 + LABEL_H + 1 + SLOT_H + 1 + infoH + 1 + 1;
  const y0 = Math.max(0, Math.floor((rows - 1 - blockH) / 2));
  const labelTop = y0 + 2;
  const labelBottom = labelTop + LABEL_H - 1;
  const slotY = labelBottom + 1;
  const infoY = slotY + SLOT_H + 1;
  const dotsY = infoY + infoH + 1;
  const cx = Math.floor(cols / 2);
  return {
    full, barY: y0, labelTop, labelBottom, slotY, infoY, infoH, dotsY, hintY: rows - 1, messageY: Math.min(rows - 3, dotsY + 1),
    cx, xSel: cx - LABEL_W / 2, slotX: cx - SLOT_W / 2,
  };
}

// The brightness level (0-3) of cartridge i given the ramp.
export function levelOf(view, i) {
  const slide = view.slide === undefined ? 1 : view.slide;
  if (i === view.index) return 1 + Math.round(2 * slide);
  if (i === view.prev && view.prev !== view.index) return 3 - Math.round(2 * slide);
  return 1;
}

// One cartridge's label art with its bottom row at bottomY. Rows at or below clipY are not drawn (the
// part that has gone into the slot). fadeP 0..1 dissolves it away cell by cell.
export function drawLabel(f, x, bottomY, cart, level, clipY = Infinity, fadeP = 0) {
  const lines = cart.label || [];
  const thr = fadeP > 0 ? dissolveThresholds(f.cols * f.rows) : null;
  const top = bottomY - (lines.length - 1);
  for (let r = 0; r < lines.length; r++) {
    const y = top + r;
    if (y < 0 || y >= f.rows || y >= clipY) continue;
    const chars = [...lines[r]];
    const ink = cart.ink && cart.ink[r] ? cart.ink[r] : null;
    for (let c = 0; c < chars.length; c++) {
      const cp = chars[c].codePointAt(0);
      const xx = x + c;
      if (cp === 32 || xx < 0 || xx >= f.cols) continue;
      if (thr && fadeP >= thr[y * f.cols + xx]) continue;
      const lv = ink && ink[c] >= '0' && ink[c] <= '3' ? Number(ink[c]) : level;
      put(f, xx, y, cp, cart.tint + lv);
    }
  }
}

const LED = { off: 0x25cb, solid: 0x25cf, on: 0x25cf };

// The console body: title bar, the slot, the CART LED. st = { box, rule, shade, led, ledShade, openShade, bar }.
// clip = { x0, x1 } limits which columns are written (the skin-takeover band).
export function drawConsoleBody(f, L, st, clip) {
  const x0 = clip ? clip.x0 : 0, x1 = clip ? clip.x1 : f.cols;
  if (x1 <= x0) return;
  const sub = { glyphs: f.glyphs, shades: f.shades, cols: f.cols, rows: f.rows };
  // draw into the real frame, then restore the columns outside the clip from a copy
  const keep = clip ? snapshotRows(f, [L.barY, L.barY + 1, L.slotY, L.slotY + 1, L.slotY + 2]) : null;
  putCentered(sub, L.barY, TITLE_TEXT, st.bar);
  const ruleW = Math.min(36, f.cols - 2);
  for (let i = 0; i < ruleW; i++) put(sub, centerX(f.cols, ruleW) + i, L.barY + 1, st.rule, st.shade);
  const w = Math.min(SLOT_W, f.cols);
  const sx = Math.max(0, L.slotX);
  drawBox(sub, sx, L.slotY, w, SLOT_H, st.box, st.shade);
  for (let i = 1; i < w - 1; i++) put(sub, sx + i, L.slotY + 1, 0x2591, st.openShade);
  const ledX = sx + Math.floor(w / 2) + 3;
  putText(sub, ledX - 7, L.slotY + 2, ' CART ', st.shade);
  put(sub, ledX, L.slotY + 2, LED[st.led], st.ledShade);
  if (keep) restoreOutside(f, keep, x0, x1);
}

function snapshotRows(f, ys) {
  const out = [];
  for (const y of ys) {
    if (y < 0 || y >= f.rows) continue;
    out.push({ y, g: f.glyphs.slice(y * f.cols, (y + 1) * f.cols), s: f.shades.slice(y * f.cols, (y + 1) * f.cols) });
  }
  return out;
}
function restoreOutside(f, keep, x0, x1) {
  for (const k of keep) {
    for (let x = 0; x < f.cols; x++) {
      if (x >= x0 && x < x1) continue;
      f.glyphs[k.y * f.cols + x] = k.g[x];
      f.shades[k.y * f.cols + x] = k.s[x];
    }
  }
}

export function consoleStyle(skin, overrides = {}) {
  const ui = skin.palette.ui;
  return {
    box: SLOT_BOX, rule: 0x2550, shade: DRIFTMAN_COLOURS.housing, bar: ui.head, led: 'off', ledShade: DRIFTMAN_COLOURS.housing,
    openShade: DRIFTMAN_COLOURS.dark, ...overrides,
  };
}

// Dots (one per cartridge) or "k / n" when they do not fit.
function drawDots(f, y, view, shade, dimShade, fadeP) {
  if (y < 0 || y >= f.rows) return;
  const n = view.cartridges.length;
  const thr = fadeP > 0 ? dissolveThresholds(f.cols * f.rows) : null;
  const text = 2 * n - 1 <= f.cols - 4
    ? Array.from({ length: n }, (_, i) => (i === view.index ? '●' : '○')).join(' ')
    : `${view.index + 1} / ${n}`;
  const x0 = centerX(f.cols, lenOf(text));
  let k = 0;
  for (const ch of text) {
    const x = x0 + k++;
    if (ch === ' ') continue;
    if (thr && fadeP >= thr[y * f.cols + x]) continue;
    put(f, x, y, ch.codePointAt(0), ch === '●' || /\d/.test(ch) ? shade : dimShade);
  }
}

function drawFaded(f, y, text, shade, fadeP, x = null) {
  if (y < 0 || y >= f.rows) return;
  const thr = fadeP > 0 ? dissolveThresholds(f.cols * f.rows) : null;
  const x0 = x === null ? centerX(f.cols, lenOf(text)) : x;
  let k = 0;
  for (const ch of text) {
    const xx = x0 + k++;
    if (ch === ' ' || xx < 0 || xx >= f.cols) continue;
    if (thr && fadeP >= thr[y * f.cols + xx]) continue;
    put(f, xx, y, ch.codePointAt(0), shade);
  }
}

// The shelf shared by the library (at rest) and the insert animation (o carries the animation).
//   o.lift       rows the selected cartridge is raised (0 or 1)
//   o.drop       rows it has dropped (0..3)
//   o.fadeP      0..1 dissolve of the neighbours, dots, hint and details
//   o.body       console-body style overrides ({ led, shade, ... }) and o.sweep = { x, style } for the takeover band
export function drawShelf(f, view, skin, o = {}) {
  const tier = view.tier || sizeTier(f.cols, f.rows);
  const L = shelfLayout(f.cols, f.rows, tier);
  const ui = skin.palette.ui;
  const n = view.cartridges.length;
  const fadeP = o.fadeP || 0;
  const sel = view.cartridges[view.index];

  // console body, then the takeover band over it
  const st = consoleStyle(skin, o.body || {});
  drawConsoleBody(f, L, st);
  if (o.sweep && o.sweep.x > 0) drawConsoleBody(f, L, consoleStyle(skin, o.sweep.style), { x0: 0, x1: Math.min(f.cols, Math.floor(o.sweep.x)) });

  // neighbours (full tier only)
  if (L.full && n > 1) {
    for (const side of [-1, 1]) {
      if (n === 2 && side === -1) continue;
      const cart = view.cartridges[wrapIdx(view.index + side, n)];
      drawLabel(f, L.xSel + side * NEIGHBOUR_STEP, L.labelBottom, cart, fadeP > 0.5 ? 0 : levelOf(view, wrapIdx(view.index + side, n)), L.slotY, fadeP);
    }
  }
  // the selected cartridge
  const offset = (view.dip || 0) + (o.drop || 0) - (o.lift || 0);
  drawLabel(f, L.xSel, L.labelBottom + offset, sel, levelOf(view, view.index), L.slotY);
  if (!o.noArrows && n > 1 && fadeP === 0) {
    const my = L.labelTop + Math.floor(LABEL_H / 2);
    put(f, Math.max(0, L.xSel - 4), my, 0x25c0, ui.dim);
    put(f, Math.min(f.cols - 1, L.xSel + LABEL_W + 3), my, 0x25b6, ui.dim);
  }

  // details
  const code = sel.code ? `  [${sel.code}]` : '';
  const head = `${sel.title}${code}${sel.locked ? '  (locked)' : ''}`;
  drawFaded(f, L.infoY, head, sel.tint + 3, fadeP);
  const wrap = wrapWords(sel.blurb || '', Math.max(10, Math.min(60, f.cols - 4)));
  for (let k = 0; k < Math.min(L.full ? 2 : 1, wrap.length); k++) drawFaded(f, L.infoY + 1 + k, wrap[k], ui.text, fadeP);
  if (L.full) {
    const facts = sel.facts || [];
    for (let k = 0; k < Math.min(6, facts.length); k++) drawFaded(f, L.infoY + 4 + k, facts[k], ui.dim, fadeP);
  }
  drawDots(f, L.dotsY, view, ui.text, ui.dim, fadeP);
  if (view.message) {
    const m = wrapWords(view.message, Math.max(10, f.cols - 4));
    for (let k = 0; k < Math.min(2, m.length); k++) putCentered(f, L.messageY + k, m[k], ui.accent);
  }
  drawFaded(f, L.hintY, o.hint === undefined ? LIBRARY_HINT : o.hint, ui.dim, fadeP);
  return L;
}

function drawList(f, view, skin) {
  const ui = skin.palette.ui;
  const n = view.cartridges.length;
  putCentered(f, 0, 'DRIFTMAN 2000', ui.head);
  const room = Math.max(1, f.rows - 4);
  const first = Math.max(0, Math.min(view.index - Math.floor(room / 2), n - room));
  for (let k = 0; k < Math.min(room, n); k++) {
    const i = first + k;
    const c = view.cartridges[i];
    const text = `${i === view.index ? '▶' : ' '} ${c.title}${c.locked ? ' (locked)' : ''}`;
    putText(f, 2, 2 + k, text, c.tint + (i === view.index ? 3 : 1), Math.max(0, f.cols - 3));
  }
  const sel = view.cartridges[view.index];
  const line = view.message || sel.blurb || '';
  putText(f, 1, f.rows - 2, line, view.message ? ui.accent : ui.text, Math.max(0, f.cols - 2));
  putText(f, 1, f.rows - 1, 'Enter insert  Esc back  q quit', ui.dim, Math.max(0, f.cols - 2));
}

export function drawLibrary(frame, view, skin) {
  clearFrame(frame);
  const ui = skin.palette.ui;
  const tier = view.tier || sizeTier(frame.cols, frame.rows);
  if (tier === 'tiny' || !view.cartridges || view.cartridges.length === 0) { drawTooSmall(frame, ui.text); return; }
  if (tier === 'list') { drawList(frame, view, skin); return; }
  drawShelf(frame, { ...view, tier }, skin, {});
}
