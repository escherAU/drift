// The cartridge library screen and the Driftman 2000 console art it shares with the insert animation
// (DRIFT-4). Pure: writes every cell it owns (it clears the whole frame first), never throws at any size.
//
//   drawLibrary(frame, view, skin)       skin = the console skin (driftman.js)
//
//   frame  { glyphs: Uint16Array, shades: Uint8Array, cols, rows }
//   view   {
//     cartridges: [{ id, title, code, blurb, facts: [text], locked, label: [text rows, <= 24x10],
//                    ink: [rows of digits 0-3] | null (per-glyph brightness: shade = tint + max(0, digit - (3 - level));
//                    spaces and cells without a digit keep the card's level; a locked card ignores it),
//                    tint: palette index of the cartridge's 4 brightness levels (tint+0 dim .. tint+3 bright) }],
//     index   the cartridge under the cursor
//     prev    the cursor's previous position (for the ramp)
//     slide   0..1 progress since the last cursor move: the whole shelf slides 34 columns with an ease-out
//             (slideOffset), the new cartridge brightens and the old one dims
//     dir     +1 / -1: the way the last move went (optional; worked out from prev and index)
//     type    0..1 how much of the console screen text is typed so far (optional, default 1 = all)
//     dial    the TUNE dial's step count (optional, default index; one notch per cursor step)
//     message text shown near the bottom ('' = none)
//     dip     0 or 1: rows the selected cartridge is pressed down (the locked "dip and spring back"; dipAt)
//     tier    'full' | 'compact' | 'list' | 'tiny'   (optional; worked out from the frame size)
//   }
//
// Pieces (all assembled from component specs; widths are asserted in tests/shell-library-art.test.js):
//   cartridge   30 x 18   shell, grip ridges, LED, label window 24 x 10, name plate, tongue, contacts
//   console     84 x 18   slot housing, 46 x 9 bezel screen, panel (LEDs, TUNE dial, grille, buttons), chrome band
//   mini        38 x 4    the compact tier's console
//   spine        4 x 10   the extra-large tier's shelf
// Layout tiers (sizeTier in ui.js):
//   full     >= 88 x 39   centre cartridge, neighbours 4 columns apart (step 34), far ones as slivers at the edges
//   extra    >= 176 x 58  the full layout with 2 whole neighbours each side (5 x 30 + 4 x 4 = 166 columns), a spine
//                         shelf above the cartridges (10 + 1 rows) and a desk line under the console feet. 176 is the
//                         166-column cluster plus 5 columns of air each side; 58 is the 53-row composition plus 5.
//                         Nothing is scaled: the art stays at its normal size and is centred.
//   compact  >= 78 x 24   one cartridge left, the CARTRIDGES list and blurb box right, the mini console under it
//   list     >= 40 x 10   the list and a hint, no art
//   tiny                  one line asking for a bigger window
import { put, putText, putCentered, centerX, lenOf, drawBox, wrapWords, clearFrame, sizeTier, drawTooSmall, dissolveThresholds } from './ui.js';
import { DRIFTMAN_COLOURS } from './driftman.js';

export const LABEL_W = 24;
export const LABEL_H = 10;
export const CART_W = 30;
export const CART_H = 18;
export const CONSOLE_W = 84;
export const CONSOLE_H = 18;
export const MINI_W = 38;
export const MINI_H = 4;
export const SPINE_W = 4;
export const SPINE_H = 10;
export const NEIGHBOUR_STEP = 34; // 30 wide + a 4 column gap
export const SLOT_W = CART_W;
export const SLOT_BOX = '╔═╗║╝═╚║'; // the screen bezel (and what "no change" means for a skin takeover)
export const ROUND_BOX = '╭─╮│╯─╰│'; // the console's outer frame
export const TITLE_TEXT = 'D R I F T M A N   2 0 0 0';
export const SOON_STRIP = '────── COMING SOON ─────'; // replaces label row 4 of a locked cartridge
export const XL_COLS = 176;
export const XL_ROWS = 58;
export const FULL_H = 39; // dots, gap, cartridge 18, console 18, hint
export const XL_H = 53; // + spine shelf 11 and 1 gap, + desk line and 1 gap, same dots and hint
export const COMPACT_H = 24;
export const LIST_SLOTS = 5; // rows of the compact tier's list
export const LOCKED_NOTE = 'Not on the shelf yet.';

const wrapIdx = (i, n) => ((i % n) + n) % n;
const cpOf = (ch) => ch.codePointAt(0);

// ---- grids: a small sprite (cols x rows of glyph + shade). A blank glyph is transparent.

function newGrid(w, h) {
  return { w, h, g: new Uint16Array(w * h).fill(32), s: new Uint8Array(w * h), fl: new Uint8Array(w * h) };
}
function gPut(G, x, y, cp, shade, fade = 0) {
  if (x < 0 || y < 0 || x >= G.w || y >= G.h) return;
  const i = y * G.w + x;
  G.g[i] = cp;
  G.s[i] = cp === 32 ? 0 : shade;
  G.fl[i] = fade;
}
function gText(G, x, y, text, shade, fade = 0, maxW = Infinity) {
  let n = 0;
  for (const ch of String(text)) {
    if (n >= maxW) break;
    const cp = cpOf(ch);
    if (cp !== 32) gPut(G, x + n, y, cp, shade, fade);
    n++;
  }
}
function gRun(G, x, y, ch, count, shade) {
  const cp = typeof ch === 'string' ? cpOf(ch) : ch;
  for (let i = 0; i < count; i++) gPut(G, x + i, y, cp, shade);
}
// The grid as text rows (blank cells as spaces). Tests assert widths on these.
export function gridRows(G) {
  const out = [];
  for (let y = 0; y < G.h; y++) out.push(String.fromCharCode(...G.g.subarray(y * G.w, (y + 1) * G.w)));
  return out;
}

// Copy a grid onto the frame. Blank grid cells leave what is underneath. Options:
//   fadeP + all   dissolve every cell (fadeP 0..1); with fadeP only, just the cells the grid marked as fading
//   clipX0/clipX1 only columns in [clipX0, clipX1) of the frame; clipY rows at or below it are not drawn;
//   clipY0 rows above it are not drawn
function blit(f, G, x0, y0, o = {}) {
  const fadeP = o.fadeP || 0, all = !!o.all;
  const cx0 = o.clipX0 === undefined ? 0 : o.clipX0, cx1 = o.clipX1 === undefined ? f.cols : o.clipX1;
  const cy = o.clipY === undefined ? Infinity : o.clipY, cy0 = o.clipY0 === undefined ? -Infinity : o.clipY0;
  const thr = fadeP > 0 ? dissolveThresholds(f.cols * f.rows) : null;
  for (let y = 0; y < G.h; y++) {
    const yy = y0 + y;
    if (yy < 0 || yy >= f.rows || yy >= cy || yy < cy0) continue;
    for (let x = 0; x < G.w; x++) {
      const xx = x0 + x;
      if (xx < cx0 || xx >= cx1 || xx < 0 || xx >= f.cols) continue;
      const i = y * G.w + x;
      const cp = G.g[i];
      if (cp === 32) continue;
      if (thr && (all || G.fl[i]) && fadeP >= thr[yy * f.cols + xx]) continue;
      f.glyphs[yy * f.cols + xx] = cp;
      f.shades[yy * f.cols + xx] = G.s[i];
    }
  }
}

// ---- the cartridge component, 30 x 18

const nameOf = (c) => String(c.title || '').toUpperCase();

// The ripple: in label column `col`, up to two water glyphs swap (~ <-> ≈), starting at a row that
// travels with the column so the swell looks like it moves. Generic: any label with those glyphs.
const TILDE = 0x7e, WAVY = 0x2248;
function rippleColumn(G, col) {
  const x = 3 + col;
  const rows = [];
  for (let r = 0; r < LABEL_H; r++) { const cp = G.g[(3 + r) * G.w + x]; if (cp === TILDE || cp === WAVY) rows.push(3 + r); }
  for (let k = 0; k < Math.min(2, rows.length); k++) {
    const y = rows[(col + k) % rows.length], i = y * G.w + x;
    G.g[i] = G.g[i] === TILDE ? WAVY : TILDE;
  }
}
const waterIn = (label, col) => (label || []).slice(0, LABEL_H).some((l) => { const ch = [...l][col]; return ch === '~' || ch === '≈'; });
export const hasWater = (label) => (label || []).some((l) => /[~≈]/.test(l));

// o = { selected, level (1-3 brightness of label and chrome), ui, led (1-3, the idle breath), ripple (label column | -1) }
// Shell and window frame take the chrome shade, the name its own, the label the cartridge's tint.
export function cartridgeGrid(cart, o = {}) {
  const G = cartridgeBase(cart, o);
  if (!!o.selected && !cart.locked && o.ripple >= 0 && o.ripple < LABEL_W) rippleColumn(G, o.ripple);
  return G;
}

// The cartridge without the ripple (which only swaps a few water glyphs after everything else is drawn).
function cartridgeBase(cart, o) {
  const ui = o.ui || { text: 15, dim: 19, head: 15, accent: 16 };
  const locked = !!cart.locked;
  const selected = !!o.selected;
  const level = Math.max(1, Math.min(3, o.level || (selected ? 3 : 1)));
  const H = locked ? '┄' : '─', V = locked ? '┆' : '│';
  const chrome = o.chrome !== undefined ? o.chrome : level >= 3 ? 13 : level === 2 ? 9 : DRIFTMAN_COLOURS.housing;
  const G = newGrid(CART_W, CART_H);
  const row = (y, s, shade = chrome) => gText(G, 0, y, s, shade);

  row(0, '╭' + H.repeat(28) + '╮');
  row(1, V + '  ════' + ' '.repeat(18 + 1 + 3) + V); // the LED goes in at column 25 below
  const ledLevel = Math.max(1, Math.min(3, o.led || 3)); // the selected LED breathes between tint+1 and tint+3 (idle)
  gPut(G, 25, 1, selected && !locked ? 0x25cf : 0x25cb, selected && !locked ? cart.tint + ledLevel : DRIFTMAN_COLOURS.housing);
  row(2, V + ' ┌' + H.repeat(24) + '┐ ' + V);
  for (let r = 0; r < LABEL_H; r++) row(3 + r, V + ' ' + V + ' '.repeat(LABEL_W) + V + ' ' + V);
  row(13, V + ' └' + H.repeat(24) + '┘ ' + V);

  // the label art
  const lines = (cart.label || []).slice(0, LABEL_H);
  for (let r = 0; r < LABEL_H; r++) {
    const chars = [...(lines[r] || '')].slice(0, LABEL_W);
    const ink = cart.ink && cart.ink[r] ? cart.ink[r] : null;
    for (let c = 0; c < chars.length; c++) {
      const cp = cpOf(chars[c]);
      if (cp === 32) continue;
      const lv = locked ? 0 : (ink && ink[c] >= '0' && ink[c] <= '3' ? Math.max(0, Number(ink[c]) - (3 - level)) : level);
      gPut(G, 3 + c, 3 + r, cp, cart.tint + lv);
    }
  }
  if (locked) {
    for (let c = 0; c < LABEL_W; c++) gPut(G, 3 + c, 3 + 4, 32, 0); // the strip replaces row 4 whole
    gText(G, 3, 3 + 4, SOON_STRIP, ui.dim);
  }

  // the name plate: "V  " + name padded to 19 + code (5) + "  V"
  const name = [...nameOf(cart)].slice(0, 19).join('').padEnd(19);
  const code = (locked ? 'SOON' : String(cart.code || '')).slice(0, 5).padEnd(5);
  gText(G, 3, 14, name, level >= 2 ? cart.tint + level : ui.dim);
  gText(G, 22, 14, code, ui.dim);
  gPut(G, 0, 14, cpOf(V), chrome); gPut(G, 29, 14, cpOf(V), chrome);

  // the tongue and its contacts
  row(15, '╰' + H.repeat(2) + '┬' + H.repeat(22) + '┬' + H.repeat(2) + '╯');
  gPut(G, 3, 16, cpOf(V), chrome); gPut(G, 26, 16, cpOf(V), chrome);
  // the contacts glow amber on the selected cartridge; mid-slide they follow the chrome ramp so they never jump
  const contacts = o.chrome !== undefined ? (o.chrome === 13 ? DRIFTMAN_COLOURS.amber : o.chrome) : selected ? DRIFTMAN_COLOURS.amber : DRIFTMAN_COLOURS.housing;
  if (!locked) gRun(G, 4, 16, 0x258c, 22, contacts);
  row(17, '   ╰' + H.repeat(22) + '╯');
  return G;
}

// ---- the spine (extra-large tier), 4 x 10: the name down the middle in vertical letters

export function spineGrid(cart, o = {}) {
  const ui = o.ui || { text: 15, dim: 19, head: 15, accent: 16 };
  const locked = !!cart.locked, lit = !!o.selected;
  const H = locked ? '┄' : '─', V = locked ? '┆' : '│';
  const chrome = o.chrome !== undefined ? o.chrome : lit ? 13 : DRIFTMAN_COLOURS.housing;
  const G = newGrid(SPINE_W, SPINE_H);
  gText(G, 0, 0, '╭' + H + H + '╮', chrome);
  gText(G, 0, SPINE_H - 1, '╰' + H + H + '╯', chrome);
  const letters = [...nameOf(cart)].filter((ch) => ch !== ' ').slice(0, SPINE_H - 2);
  for (let r = 0; r < SPINE_H - 2; r++) {
    gPut(G, 0, 1 + r, cpOf(V), chrome); gPut(G, 3, 1 + r, cpOf(V), chrome);
    if (!locked) gPut(G, 1, 1 + r, 0x258c, cart.tint + (lit ? 3 : 1));
    if (letters[r]) gPut(G, 2, 1 + r, cpOf(letters[r]), lit ? cart.tint + 3 : ui.dim);
  }
  return G;
}

// ---- the console, 84 x 18

const HOUSING_X = 28; // the slot housing is 28 wide; the mouth inside it is 24 wide at columns 30-53
export const MOUTH_X = 30;
export const MOUTH_W = 24;
const BEZEL_X = 2;
const PANEL_X = 53;

// the TUNE dial: 9 x 5 with 8 pointer positions clockwise from the top
const DIAL = ['  ╭───╮  ', ' ╱     ╲ ', '│   ●   │', ' ╲     ╱ ', '  ╰───╯  '];
const POINTER = [
  [[1, 4, '│']], [[1, 5, '╱']], [[2, 5, '─'], [2, 6, '─']], [[3, 5, '╲']],
  [[3, 4, '│']], [[3, 3, '╱']], [[2, 2, '─'], [2, 3, '─']], [[1, 3, '╲']],
];
export const DIAL_POSITIONS = POINTER.length;

export function consoleStyle(skin, overrides = {}) {
  const ui = skin.palette.ui;
  return {
    box: SLOT_BOX, shade: DRIFTMAN_COLOURS.housing, bar: ui.head, led: 'off', ledShade: DRIFTMAN_COLOURS.housing,
    openShade: DRIFTMAN_COLOURS.dark, link: false, grille: 0x2592, grilleShade: null, stripe: null, stripeShade: null, ...overrides,
  };
}

const cpOfChar = (ch) => ch.codePointAt(0);
const up = (level) => Math.min(3, level + 1); // the takeover band is one level brighter than what it leaves behind

// The console style a skin takes over the console with, and the style of the band that sweeps it in (one level up).
// Pure. cartSkin = the cartridge's validated skin (or null), tint = the library palette index of its level 0,
// classic = the Classic cartridge (its takeover is a one-shade shimmer only), consoleSkin = skin.console (the console
// block; defaults to cartSkin.console), ui = the console's ui colours (the band's title text).
//   box       console.frame, else frame.glyphs, else the bezel
//   shades    frame = tint + (ink.frame ?? 2), title bar = tint + (ink.bar ?? 3)
//   LED       tint + ink.led only when ink.led is given; otherwise it stays the accent colour
//   grille, stripe, and their shades: only when the block gives them (else the console keeps today's)
// -> { style, band }    both are console style overrides (see consoleStyle)
export function takeoverStyle(cartSkin, tint, classic, consoleSkin, ui) {
  if (classic) return { style: {}, band: { shade: DRIFTMAN_COLOURS.dim, bar: ui.head } };
  const cs = consoleSkin || (cartSkin && cartSkin.console) || {};
  const ink = cs.ink || {};
  const box = cs.frame || (cartSkin && cartSkin.frame && cartSkin.frame.glyphs) || SLOT_BOX;
  const fl = ink.frame === undefined ? 2 : ink.frame;
  const bl = ink.bar === undefined ? 3 : ink.bar;
  const style = { box, shade: tint + fl, bar: tint + bl };
  const band = { box, shade: tint + up(fl), bar: ui.head };
  if (cs.grille) style.grille = band.grille = cpOfChar(cs.grille);
  if (cs.stripe) style.stripe = band.stripe = cs.stripe;
  for (const [key, field] of [['grille', 'grilleShade'], ['stripe', 'stripeShade'], ['led', 'ledShade']]) {
    if (ink[key] === undefined) continue;
    style[field] = tint + ink[key];
    band[field] = tint + up(ink[key]);
  }
  return { style, band };
}

const frameChars = (st) => ((st.box && st.box !== SLOT_BOX) ? [...st.box].map(cpOf) : [...ROUND_BOX].map(cpOf));
const bezelChars = (st) => [...(st.box || SLOT_BOX)].map(cpOf);
const LED_GLYPH = { off: 0x25cb, solid: 0x25cf, on: 0x25cf };

function ledRow(G, x, y, st, ui, fade = 0) {
  gPut(G, x, y, 0x25cf, DRIFTMAN_COLOURS.amber); gText(G, x + 1, y, ' PWR', ui.dim, fade);
  gPut(G, x + 9, y, LED_GLYPH[st.led] || 0x25cb, st.led === 'on' ? st.ledShade : (st.led === 'solid' ? st.ledShade : DRIFTMAN_COLOURS.housing));
  gText(G, x + 10, y, ' CART', ui.dim, fade);
  gPut(G, x + 19, y, st.link ? 0x25cf : 0x25cb, st.link ? DRIFTMAN_COLOURS.cyan : DRIFTMAN_COLOURS.housing);
  gText(G, x + 20, y, ' LINK', ui.dim, fade);
}

const SCREEN_W = 44; // the text area of the console screen

// the screen's 9 interior rows: [{ text, shade, x }] by row (x = column inside the 44-wide text area)
function screenRows(sel, n, ui, cursor) {
  const rows = [];
  const locked = !!sel.locked;
  rows[0] = [{ x: 0, text: nameOf(sel), shade: sel.tint + 3 }, { x: 44 - 5, text: locked ? 'SOON ' : String(sel.code || '').padEnd(5), shade: ui.dim, right: true }];
  rows[1] = [{ x: 0, text: '─'.repeat(44), shade: DRIFTMAN_COLOURS.housing }];
  const wrap = wrapWords(sel.blurb || '', 44);
  for (let k = 0; k < Math.min(2, wrap.length); k++) rows[2 + k] = [{ x: 0, text: wrap[k], shade: ui.text }];
  if (locked) {
    rows[5] = [{ x: 0, text: LOCKED_NOTE, shade: ui.text }];
    if (n > 1) rows[7] = [{ x: 0, text: '◀ ▶ to browse', shade: ui.dim }];
  } else {
    const facts = (sel.facts || []).join(' · ');
    if (facts) rows[5] = [{ x: 0, text: [...facts].slice(0, 44).join(''), shade: ui.dim }];
    rows[7] = [{ x: 0, text: '▶ Enter to insert', shade: ui.text }, { x: 17, text: '▌', shade: cursor === undefined ? DRIFTMAN_COLOURS.amber : cursor }];
  }
  return rows;
}

// The scanline: screen row `row` is one shade brighter (text brightens, blank cells show a faint ░) and the row
// it is leaving (`from`) dims back, cell by cell on a fixed spread so a step never repaints a whole row at once.
// scan = { row, from, p } with p 0..1 the progress of the step (-1 = no row).
const brighter = (shade, tint) => {
  if (shade >= tint && shade < tint + 3) return shade + 1;
  if (shade === DRIFTMAN_COLOURS.dim) return 15;
  if (shade === DRIFTMAN_COLOURS.housing) return DRIFTMAN_COLOURS.dim;
  return shade < 15 ? shade + 1 : shade;
};
const scanThreshold = (x) => ((x * 17) % SCREEN_W) / SCREEN_W;
function applyScan(G, scan, tint) {
  const doRow = (j, litAt) => {
    if (j < 0 || j > 8) return;
    const y = 4 + j;
    for (let x = 0; x < SCREEN_W; x++) {
      if (!litAt(scanThreshold(x))) continue;
      const gx = BEZEL_X + 2 + x, i = y * G.w + gx;
      if (G.g[i] === 32) { G.g[i] = 0x2591; G.s[i] = DRIFTMAN_COLOURS.housing; G.fl[i] = 1; } else G.s[i] = brighter(G.s[i], tint);
    }
  };
  doRow(scan.row, (th) => th < scan.p);
  if (scan.from >= 0) doRow(scan.from, (th) => th >= scan.p);
}

// o = { st (console style), ui, n (cartridges on the shelf), index (the cursor), dial (TUNE dial steps; default index),
//       type (0..1 of the screen text typed), scan ({ row, from, p }), cursor (shade of the prompt cursor) }
export function consoleGrid(sel, o = {}) {
  const G = consoleBase(sel, o);
  if (o.scan) applyScan(G, o.scan, sel.tint); // the scan touches only the screen's interior, which nothing after it in the base draws on
  return G;
}

// The console without the scanline (the part that does not change from one idle step to the next).
function consoleBase(sel, o) {
  const st = o.st || {};
  const ui = o.ui || { text: 15, dim: 19, head: 15, accent: 16 };
  const n = o.n || 1;
  const FR = frameChars(st), BZ = bezelChars(st);
  const G = newGrid(CONSOLE_W, CONSOLE_H);
  const sh = st.shade;
  const hs = st.housing === undefined ? sh : st.housing; // the slot housing's own shade (the insert click brightens it)
  // slot housing (rows 0-1) and its floor (row 2)
  gRun(G, HOUSING_X, 0, 0x2584, 28, hs);
  gPut(G, HOUSING_X, 1, 0x2588, hs); gPut(G, HOUSING_X + 1, 1, 0x258c, hs);
  gPut(G, HOUSING_X + 26, 1, 0x2590, hs); gPut(G, HOUSING_X + 27, 1, 0x2588, hs);
  gPut(G, 0, 2, FR[0], sh); gRun(G, 1, 2, FR[1], 27, sh);
  gPut(G, HOUSING_X, 2, 0x2588, hs); gPut(G, HOUSING_X + 1, 2, 0x2599, hs);
  gRun(G, MOUTH_X, 2, 0x2584, MOUTH_W, st.openShade);
  gPut(G, MOUTH_X + MOUTH_W, 2, 0x259f, hs); gPut(G, MOUTH_X + MOUTH_W + 1, 2, 0x2588, hs);
  gRun(G, 56, 2, FR[1], 27, sh); gPut(G, 83, 2, FR[2], sh);
  // body rows 3-13: the bezel screen (48) and the panel (29)
  for (let k = 0; k < 11; k++) {
    const y = 3 + k;
    gPut(G, 0, y, FR[7], sh); gPut(G, 83, y, FR[3], sh);
    if (k === 0 || k === 10) {
      const [l, m, r] = k === 0 ? [BZ[0], BZ[1], BZ[2]] : [BZ[6], BZ[5], BZ[4]];
      gPut(G, BEZEL_X, y, l, sh); gRun(G, BEZEL_X + 1, y, m, 46, sh); gPut(G, BEZEL_X + 47, y, r, sh);
    } else {
      gPut(G, BEZEL_X, y, BZ[7], sh); gPut(G, BEZEL_X + 47, y, BZ[3], sh);
    }
  }
  const rows = screenRows(sel, n, ui, o.cursor);
  const reveal = o.type === undefined ? Infinity : Math.ceil(Math.max(0, Math.min(1, o.type)) * SCREEN_W);
  for (let j = 0; j < 9; j++) {
    for (const seg of rows[j] || []) {
      if (reveal - seg.x > 0) gText(G, BEZEL_X + 2 + seg.x, 4 + j, seg.text, seg.shade, 1, reveal - seg.x);
    }
  }
  // the panel
  ledRow(G, PANEL_X, 3, st, ui);
  for (let r = 0; r < DIAL.length; r++) {
    for (let c = 0; c < 9; c++) {
      const ch = DIAL[r][c];
      if (ch === ' ') continue;
      gPut(G, PANEL_X + 1 + c, 5 + r, cpOf(ch), ch === '●' ? ui.text : DRIFTMAN_COLOURS.housing);
    }
    gRun(G, PANEL_X + 14, 5 + r, st.grille, 13, st.grilleShade === null || st.grilleShade === undefined ? sh : st.grilleShade);
  }
  const pos = wrapIdx(o.dial === undefined ? (o.index || 0) : o.dial, DIAL_POSITIONS);
  for (const [r, c, ch] of POINTER[pos]) gPut(G, PANEL_X + 1 + c, 5 + r, cpOf(ch), DRIFTMAN_COLOURS.amber);
  gText(G, PANEL_X + 3, 10, 'TUNE', ui.dim);
  gText(G, PANEL_X + 3, 12, '[ EJECT ]', ui.dim);
  gText(G, PANEL_X + 16, 12, '[ RESET ]', ui.dim);
  // the chrome band
  if (st.box && st.box !== SLOT_BOX) { gPut(G, 0, 14, FR[7], sh); gRun(G, 1, 14, FR[1], 82, sh); gPut(G, 83, 14, FR[3], sh); }
  else { gPut(G, 0, 14, 0x255e, sh); gRun(G, 1, 14, 0x2550, 82, sh); gPut(G, 83, 14, 0x2561, sh); }
  gPut(G, 0, 15, FR[7], sh); gPut(G, 83, 15, FR[3], sh);
  gText(G, 3, 15, TITLE_TEXT, st.bar);
  // the rule on the band row: today's glyphs, or the skin's stripe tiled across the same 34 cells
  const tile = st.stripe ? [...st.stripe] : null;
  const stripe = tile ? Array.from({ length: 34 }, (_, i) => tile[i % tile.length]) : [...('═'.repeat(30) + '╱╱╱╱')];
  gText(G, 31, 15, stripe.join(''), st.stripeShade === null || st.stripeShade === undefined ? sh : st.stripeShade);
  gText(G, 68, 15, 'MODEL DM-2000', ui.dim);
  gPut(G, 0, 16, FR[6], sh); gRun(G, 1, 16, FR[5], 82, sh); gPut(G, 83, 16, FR[4], sh);
  gRun(G, 3, 17, 0x2580, 6, sh); gRun(G, 75, 17, 0x2580, 6, sh);
  return G;
}

// The mini console, 38 x 4: the housing (mouth at columns 7-30), the LEDs and the name.
export function miniGrid(o = {}) {
  const st = o.st || {};
  const ui = o.ui || { text: 15, dim: 19, head: 15, accent: 16 };
  const FR = frameChars(st);
  const sh = st.shade;
  const G = newGrid(MINI_W, MINI_H);
  const hs = st.housing === undefined ? sh : st.housing;
  gRun(G, 5, 0, 0x2584, 28, hs);
  gPut(G, 0, 1, FR[0], sh); gRun(G, 1, 1, FR[1], 4, sh);
  gPut(G, 5, 1, 0x2588, hs); gPut(G, 6, 1, 0x258c, hs);
  gPut(G, 31, 1, 0x2590, hs); gPut(G, 32, 1, 0x2588, hs);
  gRun(G, 33, 1, FR[1], 4, sh); gPut(G, 37, 1, FR[2], sh);
  gPut(G, 0, 2, FR[7], sh); gPut(G, 37, 2, FR[3], sh);
  gPut(G, 2, 2, 0x25cf, DRIFTMAN_COLOURS.amber); gText(G, 3, 2, ' PWR', ui.dim);
  gPut(G, 9, 2, LED_GLYPH[st.led] || 0x25cb, st.led === 'off' || !st.led ? DRIFTMAN_COLOURS.housing : st.ledShade);
  gText(G, 10, 2, ' CART', ui.dim);
  gText(G, 19, 2, 'DRIFTMAN 2000', st.bar === undefined ? ui.head : st.bar);
  gPut(G, 0, 3, FR[6], sh); gRun(G, 1, 3, FR[5], 36, sh); gPut(G, 37, 3, FR[4], sh);
  return G;
}

// ---- the memo (F3): the library at rest redraws the same art every tick
//
// The shell passes view.memo (makeLibraryMemo()) so the grids it has built are kept: a cartridge without its ripple
// (per cartridge object, level, chrome, LED level), the console without its scanline (per cartridge object, dial
// position, typing, cursor shade), the mini console, and the water columns of each label. A grid from the memo is
// only read, never written; the ripple and the scanline are applied to a copy. Cartridge objects are assumed not to
// change while a memo holds them (the shell's never do). Without view.memo nothing is kept and every draw is fresh.
// tests/shell-library-memo.test.js: with and without the memo the pictures are identical at every idle step.
const MEMO_CAP = 600;
export function makeLibraryMemo() {
  return { builds: 0, nextId: 1, carts: new WeakMap(), consoles: new WeakMap(), minis: new WeakMap(), spines: new WeakMap(), styles: new WeakMap(), water: new WeakMap() };
}
function memoGet(map, owner, key, build, memo) {
  let m = map.get(owner);
  if (!m) { m = new Map(); map.set(owner, m); }
  let g = m.get(key);
  if (g === undefined) {
    if (m.size >= MEMO_CAP) m.clear();
    g = build(); memo.builds++; m.set(key, g);
  }
  return g;
}
function memoStyle(memo, skin) {
  let s = memo.styles.get(skin);
  if (!s) { s = { id: memo.nextId++, st: consoleStyle(skin, {}) }; memo.styles.set(skin, s); }
  return s;
}
const NO_WATER = { has: false, cols: new Uint8Array(LABEL_W) };
// which label columns hold water in the first LABEL_H rows (what waterIn asks), and whether any row does (hasWater)
function waterInfo(memo, label) {
  if (!label) return NO_WATER;
  let w = memo.water.get(label);
  if (!w) {
    const cols = new Uint8Array(LABEL_W);
    for (const l of label.slice(0, LABEL_H)) { const a = [...l]; for (let c = 0; c < LABEL_W; c++) if (a[c] === '~' || a[c] === '≈') cols[c] = 1; }
    w = { has: hasWater(label), cols };
    memo.water.set(label, w);
  }
  return w;
}
function cloneGrid(G) { return { w: G.w, h: G.h, g: G.g.slice(), s: G.s.slice(), fl: G.fl.slice() }; }
// cartridgeGrid(cart, o) from the memo. o.led / o.ripple only matter for the selected, unlocked cartridge.
function memoCart(memo, cart, o) {
  const live = !!o.selected && !cart.locked;
  const led = live ? Math.max(1, Math.min(3, o.led || 3)) : 0;
  const ui = o.ui;
  const base = memoGet(memo.carts, cart, `${live ? 1 : 0}${o.selected ? 1 : 0}|${o.level}|${o.chrome}|${led}|${ui ? ui.dim : ''}`, () => cartridgeBase(cart, o), memo);
  if (live && o.ripple >= 0 && o.ripple < LABEL_W && waterInfo(memo, cart.label).cols[o.ripple]) {
    const G = cloneGrid(base);
    rippleColumn(G, o.ripple);
    return G;
  }
  return base;
}
function memoConsole(memo, sel, skin, o) {
  const sk = memoStyle(memo, skin);
  const pos = wrapIdx(o.dial === undefined ? (o.index || 0) : o.dial, DIAL_POSITIONS);
  const reveal = o.type === undefined ? -1 : Math.ceil(Math.max(0, Math.min(1, o.type)) * SCREEN_W);
  const base = memoGet(memo.consoles, sel, `${sk.id}|${o.n}|${pos}|${reveal}|${o.cursor}`, () => consoleBase(sel, { ...o, scan: null }), memo);
  if (!o.scan) return base;
  const G = cloneGrid(base);
  applyScan(G, o.scan, sel.tint);
  return G;
}
function memoSpine(memo, cart, o) {
  return memoGet(memo.spines, cart, `${o.selected ? 1 : 0}|${o.chrome}|${o.ui ? o.ui.dim : ''}`, () => spineGrid(cart, o), memo);
}
function memoMini(memo, skin, ui) {
  const sk = memoStyle(memo, skin);
  let g = memo.minis.get(skin);
  if (!g) { g = miniGrid({ st: sk.st, ui }); memo.builds++; memo.minis.set(skin, g); }
  return g;
}

// ---- idle: four small movements at rest (the clock is view.idle seconds; 0 / absent = the still picture)
//   LED     the selected shell LED breathes tint+3, +2, +1, +2, +3 with a 4 s period
//   ripple  one column of the selected label's water glyphs swaps ~ and ≈, moving 1 column per 0.4 s
//   scan    a scanline on the console screen moves down 1 row per 0.5 s across the 9 rows, then rests 8 s
//   cursor  the prompt cursor fades in and out over 2 s on a ramp of silver shades
export const LED_PERIOD = 4;
export const RIPPLE_STEP = 0.4;
export const SCAN_STEP = 0.5;
export const SCAN_ROWS = 9;
export const SCAN_REST = 8;
export const SCAN_FADE = 0.2; // a scan step's cross-fade, in two steps (half the row, then all of it)
export const SCAN_CYCLE = SCAN_STEP * SCAN_ROWS + SCAN_REST;
const SCAN_LEAD = SCAN_CYCLE - 3; // the first scan starts 3 s after the library opens
export const CURSOR_PERIOD = 2;
// Everything but the scan keeps one beat, the ripple's 0.4 s, so a redraw serves them all at once (the fewer
// frames the library draws, the less it costs at rest).
const beatOf = (idle) => Math.floor(idle / RIPPLE_STEP + 1e-6);
const LED_BEATS = [3, 3, 2, 2, 1, 1, 2, 2, 3, 3]; // 10 beats = the 4 s period: 3, 2, 1, 2, 3
const CURSOR_RAMP = [3, 9, 15, 9, 3]; // 5 beats = the 2 s period: dark, half, bright, half, dark

export function ledLevelAt(idle) {
  return LED_BEATS[beatOf(Math.max(0, idle)) % LED_BEATS.length];
}

export function rippleColAt(idle) {
  return idle > 0 ? beatOf(idle) % LABEL_W : -1;
}

export function scanAt(idle) {
  if (!(idle > 0)) return null;
  const c = (idle + SCAN_LEAD) % SCAN_CYCLE;
  let k = Math.floor(c / SCAN_STEP + 1e-9);
  let s = c - k * SCAN_STEP;
  if (s < 1e-6) { // exactly on a step: the picture is still the one the step before finished with
    if (k === 0) return null;
    k -= 1; s = SCAN_STEP;
  }
  if (k > SCAN_ROWS) return null;
  const x = Math.min(1, s / SCAN_FADE);
  const p = Math.ceil(x * 2 - 1e-9) / 2;
  if (k === SCAN_ROWS) return p >= 1 ? null : { row: -1, from: SCAN_ROWS - 1, p };
  return { row: k, from: p >= 1 || k === 0 ? -1 : k - 1, p };
}

export function cursorShadeAt(idle) {
  if (!(idle > 0)) return DRIFTMAN_COLOURS.amber;
  return CURSOR_RAMP[beatOf(idle) % CURSOR_RAMP.length];
}

// What the idle clock would draw for the selected cartridge, as a string: equal strings = the same picture.
// The shell redraws only when it changes. tier: 'full' | 'compact' | other (list and tiny never animate).
// memo (optional, makeLibraryMemo()) keeps each label's water columns, so asking every tick costs next to nothing.
export function idleSignature(idle, sel, tier, memo) {
  if (!(idle > 0) || (tier !== 'full' && tier !== 'compact')) return '';
  const parts = [];
  if (!sel.locked) {
    parts.push('led:' + ledLevelAt(idle));
    const water = memo ? waterInfo(memo, sel.label) : null;
    if (water ? water.has : hasWater(sel.label)) { const col = rippleColAt(idle); parts.push('rip:' + ((water ? water.cols[col] : waterIn(sel.label, col)) ? col : -1)); }
    if (tier === 'full') parts.push('cur:' + cursorShadeAt(idle));
  }
  if (tier === 'full') { const s = scanAt(idle); parts.push('scan:' + (s ? `${s.row},${s.from},${s.p}` : '-')); }
  return parts.join('|');
}

// ---- layout

export function isExtraLarge(cols, rows) {
  return cols >= XL_COLS && rows >= XL_ROWS;
}

// Where everything sits for a frame size (full, extra-large and compact tiers).
export function shelfLayout(cols, rows, tier) {
  if (tier === 'compact') {
    const y0 = Math.max(0, Math.floor((rows - COMPACT_H) / 2));
    const cartX = Math.max(4, Math.floor((cols - 74) / 2) + 1);
    const cartTop = y0 + 1;
    return {
      full: false, xl: false, y0, cartTop, cartX, miniTop: cartTop + CART_H, miniX: cartX - 4, listX: cartX + 36, listW: 38,
      hintY: y0 + COMPACT_H - 1, messageY: y0 + COMPACT_H - 1,
    };
  }
  const xl = isExtraLarge(cols, rows);
  const h = xl ? XL_H : FULL_H;
  const y0 = Math.max(0, Math.floor((rows - h) / 2));
  const cartTop = y0 + (xl ? 14 : 2);
  const consoleTop = cartTop + CART_H;
  const cartX = Math.floor(cols / 2) - CART_W / 2;
  return {
    full: true, xl, y0, dotsY: y0, messageY: y0 + 1, spineY: y0 + 2, shelfY: y0 + 12, cartTop, cartX, consoleTop,
    consoleX: cartX - 27, deskY: consoleTop + CONSOLE_H, hintY: consoleTop + CONSOLE_H + (xl ? 2 : 0), step: NEIGHBOUR_STEP,
  };
}

// The console screen as the boot draws on it: { x, y, w, h } including its one-cell edge, or null where there is no
// art (list tier and smaller). Full and extra-large: the bezel interior, 46 x 9 (text area 44 x 7). Compact: the
// blurb box on the right, 38 x 9 (text area 36 x 7).
export function screenRect(cols, rows, tier = sizeTier(cols, rows)) {
  if (tier !== 'full' && tier !== 'compact') return null;
  const L = shelfLayout(cols, rows, tier);
  if (L.full) return { x: L.consoleX + BEZEL_X + 1, y: L.consoleTop + 4, w: 46, h: 9 };
  return { x: L.listX, y: L.cartTop + 9, w: L.listW, h: 9 };
}

// Ease-out: fast first, settling softly (1 - (1 - p)^1.3). The exponent is 1.3, not the 2 of a quadratic ease, so
// the first moving frame at 18 fps covers 7 columns (steps 7, 6, 6, 5, 5, 4, 1) instead of 10. With the real label art
// a frame that moves the shelf 8 columns or more changes over 30% of the cells at 120x40 (10 columns: 30.2%, 8: 30.7%,
// 7: under 29%), because nearly every cartridge cell differs from the frame before.
export const SLIDE_EASE_POWER = 1.3;
export function slideEase(p) {
  const x = p <= 0 ? 0 : p >= 1 ? 1 : p;
  return 1 - Math.pow(1 - x, SLIDE_EASE_POWER);
}

// The chrome (shell, name plate frame) of a cartridge ramps through grey steps while the shelf slides: silver 18
// (graphite), 7, 9, 11, 13 = L* 42, 49, 58, 66, 74. Cells that move from one cartridge onto another with the same
// glyph (a border landing where the neighbour's border was) then differ by one step or two small ones, never the
// full 32 L* of graphite against silver 13. While the shelf moves 5 or more columns a frame the selected and leaving
// chrome stay at 66 or below; the brightest step is reached only on the last, slow frames.
export const CHROME_RAMP = Object.freeze([DRIFTMAN_COLOURS.housing, 7, 9, 11, 13]);
// The chrome shade of cartridge i: the arriving one climbs the ramp with the slide, the leaving one comes down it
// (one step off the top on the first moving frame), everything else is graphite. Null = use the level's own shade.
export function chromeShadeOf(view, i) {
  if (view.slide === undefined || view.slide >= 1 || view.prev === view.index) return null;
  const top = CHROME_RAMP.length - 1;
  const p = view.slide <= 0 ? 0 : view.slide;
  if (i === view.index) return CHROME_RAMP[Math.round(p * top)];
  if (i === view.prev) return CHROME_RAMP[Math.round((1 - p) * top)];
  return null;
}

// Columns the shelf is still displaced at slide progress p (0..1); dir +1 = the cursor moved right, so the
// shelf starts one step to the right and slides left onto its settled layout. Exactly 0 at p = 1.
export function slideOffset(p, dir) {
  const d = dir < 0 ? -1 : 1;
  const o = Math.round(NEIGHBOUR_STEP * (1 - slideEase(p)));
  return o === 0 ? 0 : d * o;
}

// The extra-large tier (176 x 58 and up) writes about twice the bytes of the full tier for the same slide, so the shelf
// moves in fewer, longer steps there. Moving a cartridge rewrites nearly all of its cells whatever the distance, so the
// cost of a slide is the number of frames in which it moves, not the distance. At 18 fps the 0.36 s slide has frames at
// progress 0.154, 0.309, 0.463, 0.617, 0.772, 0.926 and 1: here it moves on the 2nd, 4th and 6th (34 -> 21 -> 10 -> 0
// columns, still an ease-out, 34 in all, ending on the settled frame) and holds in between. The first frame holds too:
// the key press already shows in the chrome and the brightness of the two cartridges. The cuts sit half-way between
// frames, so a frame that comes a little early or late still lands on the same step.
export const XL_SLIDE_STEPS = Object.freeze([[0.23, 0], [0.54, 0.309], [0.85, 0.617]]);
export function xlSlideProgress(p) {
  if (!(p > 0)) return 0;
  if (p >= 1) return 1;
  for (const [upTo, at] of XL_SLIDE_STEPS) if (p < upTo) return at;
  return 1;
}

// The full tier below the extra-large one (88 x 39 up to 175 x 57): the cartridge band is up to 46% of the screen and a
// frame in which the whole shelf moves rewrites about 70% of it, so 33% of all cells at 88 x 39 (the photosensitivity
// rule is 30%). So the shelf moves in two halves that take turns: the upper nine rows of the cartridges move on one
// frame, the lower nine on the next, each to where the whole shelf would be at that frame. A frame then rewrites half
// the band (about 21% at 88 x 39) and the halves are never more than one frame's step apart (7 columns at most, for
// one frame, mid-slide). It also halves the bytes: a half moves on every other frame. The cuts sit half-way between
// frames (0.154 s apart / 0.36 s = 1/6.48 of the slide), like XL_SLIDE_STEPS. At 18 fps the upper half moves on the
// 1st, 3rd and 5th frame (progress 0.154, 0.463, 0.772) and the lower on the 2nd, 4th and 6th (0.309, 0.617, 0.926);
// the 7th frame settles both.
export const BAND_ROWS = 9; // rows of the cartridge in the upper half
export const BAND_STEPS = Object.freeze([
  Object.freeze([[0.077, 0], [0.386, 0.154], [0.694, 0.463], [0.963, 0.772]]),
  Object.freeze([[0.231, 0], [0.54, 0.309], [0.849, 0.617], [0.963, 0.926]]),
]);
export function bandProgress(p, band) {
  if (!(p > 0)) return 0;
  if (p >= 1) return 1;
  for (const [upTo, at] of BAND_STEPS[band]) if (p < upTo) return at;
  return 1;
}

// The locked "dip and spring back": rows the selected cartridge is pressed down t seconds after Enter. A sine
// half-wave over DIP_SECONDS rounded to whole rows: 0 for the first 0.05 s, 1 for 0.2 s, 0 again for the last 0.05 s.
export const DIP_SECONDS = 0.3;
export function dipAt(t) {
  if (!(t > 0) || t >= DIP_SECONDS) return 0;
  return Math.round(Math.sin(Math.PI * t / DIP_SECONDS));
}

// The way the cursor last moved: view.dir, else the shorter way round from prev to index.
export function slideDir(view) {
  if (view.dir === 1 || view.dir === -1) return view.dir;
  const n = view.cartridges.length;
  if (n < 2 || view.prev === view.index) return 1;
  return wrapIdx(view.index - view.prev, n) <= n / 2 ? 1 : -1;
}

// The brightness level (0-3) of cartridge i given the ramp.
export function levelOf(view, i) {
  const slide = view.slide === undefined ? 1 : view.slide;
  if (i === view.index) return 1 + Math.round(2 * slide);
  if (i === view.prev && view.prev !== view.index) return 3 - Math.round(2 * slide);
  return 1;
}

// ---- drawing helpers that fade with the insert animation

function fadeCtx(f, fadeP) {
  const thr = fadeP > 0 ? dissolveThresholds(f.cols * f.rows) : null;
  return {
    f,
    put(x, y, cp, shade) {
      if (x < 0 || y < 0 || x >= f.cols || y >= f.rows) return;
      if (thr && fadeP >= thr[y * f.cols + x]) return;
      put(f, x, y, cp, shade);
    },
    text(x, y, text, shade, maxW = Infinity) {
      let k = 0;
      for (const ch of String(text)) {
        if (k >= maxW) break;
        if (ch !== ' ') this.put(x + k, y, cpOf(ch), shade);
        k++;
      }
    },
  };
}

// keys silver, words dim: [[key, word], ...] centred on row y
function hintSegments(n, tier) {
  const choose = tier === 'full' ? '◀ ▶' : '↑ ↓';
  return [...(n > 1 ? [[choose, 'choose']] : []), ['Enter', 'insert'], ['h', 'help'], ['q', 'quit']];
}
export const LIBRARY_HINT = '◀ ▶ choose   Enter insert   h help   q quit';

function drawHint(ctx, y, cols, n, tier, ui, text) {
  if (y < 0 || y >= ctx.f.rows) return;
  if (text !== undefined && text !== null) {
    ctx.text(centerX(cols, lenOf(text)), y, text, ui.dim);
    return;
  }
  const segs = hintSegments(n, tier);
  for (const sep of [3, 1]) {
    const total = segs.reduce((a, [k, w]) => a + lenOf(k) + 1 + lenOf(w), 0) + sep * (segs.length - 1);
    if (total <= cols - 2 || sep === 1) {
      let x = centerX(cols, total);
      segs.forEach(([k, w], i) => {
        ctx.text(x, y, k, ui.text); x += lenOf(k) + 1;
        ctx.text(x, y, w, ui.dim); x += lenOf(w) + (i < segs.length - 1 ? sep : 0);
      });
      return;
    }
  }
}

// Dots (one per cartridge, 5 at most) or "k / n" when there are more or they do not fit.
function drawDots(ctx, y, view, ui) {
  const f = ctx.f;
  if (y < 0 || y >= f.rows) return;
  const n = view.cartridges.length;
  const text = n <= 5 && 2 * n - 1 <= f.cols - 4
    ? Array.from({ length: n }, (_, i) => (i === view.index ? '●' : '○')).join(' ')
    : `${view.index + 1} / ${n}`;
  const x0 = centerX(f.cols, lenOf(text));
  let k = 0;
  for (const ch of text) {
    const x = x0 + k++;
    if (ch === ' ') continue;
    ctx.put(x, y, cpOf(ch), ch === '●' || /\d/.test(ch) ? ui.text : ui.dim);
  }
}

// The cartridge list (compact tier's right column and the list tier). Scrolls with "up N more" and
// "down N more" rows when it has more entries than slots.
function listWindow(n, index, slots) {
  if (n <= slots) return { first: 0, count: n, up: 0, down: 0 };
  let vis = slots;
  let first = 0;
  for (let pass = 0; pass < 4; pass++) {
    first = Math.max(0, Math.min(index - Math.floor(vis / 2), n - vis));
    const need = (first > 0 ? 1 : 0) + (first + vis < n ? 1 : 0);
    const next = slots - need;
    if (next === vis) break;
    vis = next;
  }
  if (index < first) first = index;
  if (index >= first + vis) first = index - vis + 1;
  return { first, count: vis, up: first, down: n - first - vis };
}

function drawListPane(ctx, view, skin, x, y, w, slots, gap) {
  const ui = skin.palette.ui;
  const n = view.cartridges.length;
  const pos = `${view.index + 1} / ${n}`;
  ctx.text(x, y, 'CARTRIDGES', ui.head);
  ctx.text(x + w - lenOf(pos), y, pos, ui.dim);
  for (let i = 0; i < w; i++) ctx.put(x + i, y + 1, 0x2500, DRIFTMAN_COLOURS.housing);
  const top = y + 2 + gap;
  const win = listWindow(n, view.index, slots);
  let row = 0;
  if (win.up > 0) ctx.text(x + 2, top + row++, `↑ ${win.up} more`, ui.dim);
  for (let k = 0; k < win.count; k++) {
    const i = win.first + k, c = view.cartridges[i];
    const sel = i === view.index;
    const right = c.locked ? 'soon' : String(c.code || '');
    ctx.put(x, top + row, sel ? 0x25b6 : 32, DRIFTMAN_COLOURS.amber);
    ctx.text(x + 2, top + row, c.title, sel ? c.tint + 3 : ui.dim, Math.max(0, w - 4 - lenOf(right)));
    ctx.text(x + w - lenOf(right), top + row, right, ui.dim);
    row++;
  }
  if (win.down > 0) ctx.text(x + 2, top + row, `↓ ${win.down} more`, ui.dim);
}

// ---- the shelf, shared by the library (at rest) and the insert animation (o carries the animation)
//   o.lift       rows the selected cartridge is raised (0 or 1)
//   o.drop       rows it has dropped (0..3)
//   o.fadeP      0..1 dissolve of the neighbours, dots, hint and the console screen
//   o.body       console style overrides ({ led, ledShade, openShade, shade, ... }) and
//   o.spread     columns the neighbours have slid outward (each to its own side)
//   o.sweep      { x, style, band: { w, style } }: the skin-takeover over the console. Columns left of x - w show the
//                console in `style`; the w columns before x show it in band.style (the band); the rest is unchanged
//   o.hint       replaces the hint line text
//   o.noArrows   accepted for the insert animation (the shelf draws no arrows: the hint names the keys)
export function drawShelf(f, view, skin, o = {}) {
  const tier = view.tier || sizeTier(f.cols, f.rows);
  const L = shelfLayout(f.cols, f.rows, tier);
  const ui = skin.palette.ui;
  const n = view.cartridges.length;
  // extra-large: the brightness and chrome ramps follow the stepped slide, so they change in the frames in which the
  // shelf moves and cost no frames of their own
  const look = L.xl && view.slide !== undefined && view.slide < 1 && view.prev !== view.index ? { ...view, slide: xlSlideProgress(view.slide) } : view;
  const fadeP = o.fadeP || 0;
  const sel = view.cartridges[view.index];
  const ctx = fadeCtx(f, fadeP);
  const memo = view.memo || null;
  const plain = memo ? memoStyle(memo, skin).st : null; // the console style with no overrides, when a memo is in use
  const st = o.body ? consoleStyle(skin, o.body) : (plain || consoleStyle(skin, {}));
  const offset = (view.dip || 0) + (o.drop || 0) - (o.lift || 0);
  const idle = view.idle > 0 ? view.idle : 0;
  // compact: the one cartridge on show is swapped in place, so its chrome stays at the selected shade (a ramp would
  // flip every border cell from silver to graphite in one frame when the cursor moves)
  const cartAtFor = (lk) => (i, selected, compact = false) => {
    const co = {
      selected, level: levelOf(lk, i), chrome: compact ? 13 : chromeShadeOf(lk, i) ?? undefined, ui, led: selected && idle ? ledLevelAt(idle) : undefined, ripple: selected && idle ? rippleColAt(idle) : -1,
    };
    return memo ? memoCart(memo, view.cartridges[i], co) : cartridgeGrid(view.cartridges[i], co);
  };
  const cartAt = cartAtFor(look);

  // the console, then the takeover band over it
  const makeConsole = (style) => {
    if (!L.full) return memo && style === plain ? memoMini(memo, skin, ui) : miniGrid({ st: style, ui });
    const co = { st: style, ui, n, index: view.index, dial: view.dial, type: view.type, scan: idle ? scanAt(idle) : null, cursor: idle ? cursorShadeAt(idle) : undefined };
    return memo && style === plain ? memoConsole(memo, sel, skin, co) : consoleGrid(sel, co);
  };
  const cx = L.full ? L.consoleX : L.miniX, cy = L.full ? L.consoleTop : L.miniTop;
  blit(f, makeConsole(st), cx, cy, { fadeP });
  if (o.sweep && o.sweep.x > 0) {
    // behind the band the console is in its swapped state; the band itself (sweep.band = { w, style }) is that state one shade up
    const x = Math.floor(o.sweep.x), bw = o.sweep.band ? o.sweep.band.w : 0, x0 = Math.max(0, x - bw);
    blit(f, makeConsole(consoleStyle(skin, o.sweep.style)), cx, cy, { fadeP, clipX1: Math.min(f.cols, x0) });
    if (bw > 0) blit(f, makeConsole(consoleStyle(skin, o.sweep.band.style)), cx, cy, { fadeP, clipX0: x0, clipX1: Math.min(f.cols, x) });
  }

  if (L.full) {
    // while the shelf slides it is displaced by `shift` columns; the cartridges beyond the settled cluster
    // (two whole neighbours each side) are clipped to it so nothing pops in or out when the slide ends
    const sliding = view.slide !== undefined && view.slide < 1 && view.prev !== view.index;
    const dir = sliding ? slideDir(view) : 1;
    const shift = sliding ? slideOffset(L.xl ? xlSlideProgress(view.slide) : view.slide, dir) : 0;
    const win0 = L.cartX - 2 * L.step, win1 = L.cartX + CART_W + 2 * L.step;
    const spread = o.spread || 0;
    const drawNeighbour = (idx, x, shiftNow = shift, at = cartAt, rows = {}) => {
      const visible = Math.min(x + CART_W, f.cols, win1) - Math.max(x, 0, win0);
      if (visible < (shiftNow ? 1 : 3)) return;
      blit(f, at(idx, false), x, L.cartTop, { fadeP, all: true, clipX0: win0, clipX1: win1, ...rows });
    };
    if (n > 1 && L.xl && shift !== 0) {
      // Extra-large slide: only the centre three slide (the cartridge before, the new one and the one after, each
      // 34 columns to its place). The two far slots stay put and change at the ends of the slide: on the side the
      // shelf comes from the new far cartridge is simply uncovered as the near one slides off it; on the side it
      // goes to, the cartridges the old shelf had there stay under the sliding one and the far one changes in the
      // last frame. A taste call to save bytes (tests/shell-library-bandwidth.test.js).
      const ahead = -dir;
      const seen = new Set([view.index]);
      const plan = [];
      const want = (idx, x, layer) => { if (seen.has(idx)) return; seen.add(idx); plan.push({ idx, x, layer }); };
      for (const side of [1, -1]) want(wrapIdx(view.index + side, n), L.cartX + side * L.step + shift + side * spread, 1);
      want(wrapIdx(view.index + dir * 2, n), L.cartX + dir * 2 * L.step + dir * spread, 0);
      for (const k of [1, 2]) want(wrapIdx(view.prev + ahead * k, n), L.cartX + ahead * k * L.step + ahead * spread, 0);
      for (const layer of [0, 1]) for (const p of plan) if (p.layer === layer) drawNeighbour(p.idx, p.x);
      drawSpines(f, look, ui, L, fadeP, cartAt);
    } else {
      // Below the extra-large tier a slide moves the cartridge band in two halves that take turns (bandProgress);
      // otherwise (at rest, or extra-large with nothing to move) it is one band with the whole shelf.
      const split = sliding && !L.xl;
      const bandY = L.cartTop + BAND_ROWS;
      const bands = split
        ? [0, 1].map((b) => ({ lk: { ...view, slide: bandProgress(view.slide, b) }, rows: b ? { clipY0: bandY } : { clipY: bandY } }))
        : [{ lk: look, rows: {} }];
      for (const { lk, rows } of bands) {
        const at = split ? cartAtFor(lk) : cartAt;
        const shiftNow = split ? slideOffset(lk.slide, dir) : shift;
        if (n > 1) {
          // neighbours: each cartridge at most once, nearest first, the right side winning a tie; slivers at the edges
          const seen = new Set([view.index]);
          const maxR = shiftNow ? 3 : 2;
          for (let r = 1; r <= maxR; r++) {
            for (const side of [1, -1]) {
              const idx = wrapIdx(view.index + side * r, n);
              if (seen.has(idx)) continue;
              seen.add(idx);
              drawNeighbour(idx, L.cartX + side * r * L.step + shiftNow + side * spread, shiftNow, at, rows);
            }
          }
        }
        if (L.xl && n > 1) drawSpines(f, look, ui, L, fadeP, cartAt);
        const sy = rows.clipY === undefined ? L.consoleTop + 2 : Math.min(rows.clipY, L.consoleTop + 2);
        blit(f, at(view.index, true), L.cartX + shiftNow, L.cartTop + offset, { clipY: sy, clipY0: rows.clipY0 });
      }
    }
    if (n > 1 && L.xl && shift !== 0) blit(f, cartAt(view.index, true), L.cartX + shift, L.cartTop + offset, { clipY: L.consoleTop + 2 });
    if (L.xl) {
      const dw = Math.min(f.cols, CONSOLE_W + 16), dx = centerX(f.cols, dw);
      for (let i = 0; i < dw; i++) put(f, dx + i, L.deskY, 0x2594, DRIFTMAN_COLOURS.housing);
    }
    if (n > 1) drawDots(ctx, L.dotsY, view, ui);
    if (view.message) {
      const m = wrapWords(view.message, Math.max(10, f.cols - 4))[0] || '';
      putCentered(f, L.messageY, m, ui.accent);
    }
    drawHint(ctx, L.hintY, f.cols, n, 'full', ui, o.hint);
    return L;
  }

  // compact: the cartridge on the left, the list and the blurb box on the right
  blit(f, cartAt(view.index, true, true), L.cartX, L.cartTop + offset, { clipY: L.miniTop + 2 });
  drawListPane(ctx, view, skin, L.listX, L.cartTop, L.listW, LIST_SLOTS, 1);
  const by = L.cartTop + 9;
  if (!fadeP) drawBox(f, L.listX, by, L.listW, 9, null, DRIFTMAN_COLOURS.housing);
  else drawFadedBox(ctx, L.listX, by, L.listW, 9);
  const wrap = wrapWords(sel.blurb || '', 34);
  for (let k = 0; k < Math.min(3, wrap.length); k++) ctx.text(L.listX + 2, by + 1 + k, wrap[k], ui.text);
  if (sel.locked) {
    ctx.text(L.listX + 2, by + 5, LOCKED_NOTE, ui.text);
    if (n > 1) ctx.text(L.listX + 2, by + 7, '↑ ↓ to browse', ui.dim);
  } else {
    const facts = wrapWords((sel.facts || []).join(' · '), 34);
    for (let k = 0; k < Math.min(2, facts.length); k++) ctx.text(L.listX + 2, by + 5 + k, facts[k], ui.dim);
    ctx.put(L.listX + 2, by + 7, 0x25b6, ui.accent);
    ctx.text(L.listX + 4, by + 7, 'Enter to insert', ui.text);
  }
  if (view.message) {
    const m = wrapWords(view.message, Math.max(10, f.cols - 4))[0] || '';
    putCentered(f, L.messageY, m, ui.accent);
  } else {
    drawHint(ctx, L.hintY, f.cols, n, 'compact', ui, o.hint);
  }
  return L;
}

function drawFadedBox(ctx, x, y, w, h) {
  const b = [...'┌─┐│┘─└│'].map(cpOf);
  const sh = DRIFTMAN_COLOURS.housing;
  for (let i = 1; i < w - 1; i++) { ctx.put(x + i, y, b[1], sh); ctx.put(x + i, y + h - 1, b[5], sh); }
  for (let j = 1; j < h - 1; j++) { ctx.put(x, y + j, b[7], sh); ctx.put(x + w - 1, y + j, b[3], sh); }
  ctx.put(x, y, b[0], sh); ctx.put(x + w - 1, y, b[2], sh); ctx.put(x, y + h - 1, b[6], sh); ctx.put(x + w - 1, y + h - 1, b[4], sh);
}

// The spine shelf: every cartridge as a 4 x 10 spine, the selected one lit, with a shelf board under them.
function drawSpines(f, view, ui, L, fadeP, cartAt) {
  const n = view.cartridges.length;
  const pitch = SPINE_W + 1;
  const fit = Math.max(1, Math.floor((f.cols - 4 + 1) / pitch));
  const count = Math.min(n, fit);
  const first = Math.max(0, Math.min(view.index - Math.floor(count / 2), n - count));
  const total = count * pitch - 1;
  const x0 = centerX(f.cols, total);
  for (let k = 0; k < count; k++) {
    const i = first + k;
    const so = { selected: i === view.index, chrome: chromeShadeOf(view, i) ?? undefined, ui };
    blit(f, view.memo ? memoSpine(view.memo, view.cartridges[i], so) : spineGrid(view.cartridges[i], so), x0 + k * pitch, L.spineY, { fadeP, all: true });
  }
  const bx = Math.max(0, x0 - 2), bw = Math.min(f.cols - bx, total + 4);
  const ctx = fadeCtx(f, fadeP);
  for (let i = 0; i < bw; i++) ctx.put(bx + i, L.shelfY, 0x2581, DRIFTMAN_COLOURS.housing);
}

// ---- the list tier: the list, the blurb (or the message) and the hint, no art

function drawList(f, view, skin) {
  const ui = skin.palette.ui;
  const ctx = fadeCtx(f, 0);
  const n = view.cartridges.length;
  const w = Math.min(f.cols - 2, 46), x = centerX(f.cols, w);
  const slots = Math.max(1, f.rows - 5);
  drawListPane(ctx, view, skin, x, 0, w, slots, 0);
  const sel = view.cartridges[view.index];
  const line = view.message || sel.blurb || '';
  putText(f, 1, f.rows - 2, line, view.message ? ui.accent : ui.text, Math.max(0, f.cols - 2));
  drawHint(ctx, f.rows - 1, f.cols, n, 'compact', ui);
}

export function drawLibrary(frame, view, skin) {
  clearFrame(frame);
  const ui = skin.palette.ui;
  const tier = view.tier || sizeTier(frame.cols, frame.rows);
  if (tier === 'tiny' || !view.cartridges || view.cartridges.length === 0) { drawTooSmall(frame, ui.text); return; }
  if (tier === 'list') { drawList(frame, view, skin); return; }
  drawShelf(frame, { ...view, tier }, skin, {});
}
