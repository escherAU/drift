// The insert animation, first part of the cartridge timeline (DRIFT-4, designer section 3, steps 1-5).
// Pure: it draws the library shelf in a state that depends only on t.
//
//   drawInsert(frame, { item, t, link }, skin)       skin = the console skin; t = seconds since Enter, 0..INSERT_END
//
//   item   { cartridge, view, cartSkin, classic }
//     cartridge  the library entry being inserted (see library.js)
//     view       the library view when Enter was pressed (cursor, neighbours)
//     cartSkin   the cartridge's validated skin, or null
//     classic    true for the Classic cartridge (the takeover is a one-shade shimmer only)
//   link   optional: true lights the LINK LED (cyan); the boot screen (boot.js) draws the console through here
//
// Timeline (seconds; the whole insert + boot is 5.8 s, see boot.js):
//   0    - 0.15  step 1  the cartridge lifts one row (at 0.075), its shell LED is solid
//   0.15 - 0.45  step 2  the neighbours slide off to their sides and dissolve; dots, hint and details dissolve
//   0.45 - 0.85  step 3  the cartridge drops three rows, accelerating; the tongue is hidden from the slot floor down
//   0.85 - 1.0   step 4  click: the housing brightens one shade and eases back, the CART LED goes on in the accent colour
//   1.0  - 1.5   step 5  a BAND_W-column band sweeps left to right over the console; behind it the console shows the
//                        cartridge's skin (frame glyphs, colour). Classic: the band is only a one-shade shimmer
// Eject (shell.js) plays this backwards. Every brightness change is a one-shade step or a dissolve; the background
// never changes.
import { clearFrame, putCentered, ramp, sizeTier, drawTooSmall } from './ui.js';
import { drawShelf, shelfLayout, takeoverStyle, CONSOLE_W, MINI_W } from './library.js';
import { DRIFTMAN_COLOURS } from './driftman.js';

export const INSERT_LIFT_END = 0.15;
export const INSERT_SLIDE_END = 0.45;
export const INSERT_DROP_END = 0.85;
export const INSERT_CLICK_END = 1.0;
export const INSERT_SWEEP_END = 1.5;
export const INSERT_END = INSERT_SWEEP_END;
export const BAND_W = 6; // the takeover band is six columns wide
export const NEIGHBOUR_SPREAD = 10; // columns the neighbours travel while they fade
const PULSE_SECONDS = 0.075; // the housing stays one shade up for this long after the click, then eases back

// Rows the cartridge is displaced by at time t: -1 (lifted) ... +3 (dropped into the slot).
export function cartridgeOffset(t) {
  if (t < INSERT_LIFT_END / 2) return 0;
  if (t < INSERT_SLIDE_END) return -1;
  const u = ramp(t, INSERT_SLIDE_END, INSERT_DROP_END);
  return -1 + Math.round(4 * u * u);
}

// Columns the neighbours have slid outward at time t (ease-out over step 2).
export function spreadAt(t) {
  const u = ramp(t, INSERT_LIFT_END, INSERT_SLIDE_END);
  return Math.round(NEIGHBOUR_SPREAD * (1 - (1 - u) * (1 - u)));
}

// The console style the takeover swaps in behind the band, and the band's own style (one shade brighter).
// ONE small pure function: takeoverStyle() (library.js) does the work. It reads the skin's console block (the frame,
// grille, stripe and the ink levels), so eject, which reuses drawInsert backwards, reverses it for free.
//   -> { style, band }    both are console style overrides (see consoleStyle in library.js)
export function sweepStyle(item, ui) {
  return takeoverStyle(item.cartSkin || null, item.cartridge.tint, !!item.classic, item.cartSkin && item.cartSkin.console, ui);
}

export function drawInsert(frame, args, skin) {
  const { item, t } = args;
  const T = Number.isFinite(t) ? Math.max(0, Math.min(INSERT_END, t)) : 0;
  clearFrame(frame);
  const ui = skin.palette.ui;
  const view = item.view;
  const tier = sizeTier(frame.cols, frame.rows);
  if (tier === 'tiny') { drawTooSmall(frame, ui.text); return; }
  if (tier === 'list') {
    // text only: the title, a growing bar
    const mid = Math.floor(frame.rows / 2);
    putCentered(frame, Math.max(0, mid - 2), (skin.insert && skin.insert.text) || 'Inserting cartridge', ui.head);
    putCentered(frame, Math.max(0, mid - 1), item.cartridge.title, item.cartridge.tint + 3);
    const w = Math.min(20, Math.max(2, frame.cols - 6));
    const k = Math.round(w * (T / INSERT_END));
    putCentered(frame, mid + 1, '[' + '#'.repeat(k) + '.'.repeat(w - k) + ']', ui.text);
    return;
  }
  const off = cartridgeOffset(T);
  const clicked = T >= INSERT_DROP_END;
  const body = {
    led: clicked ? 'on' : 'off', // CART is ○ until the click
    ledShade: clicked ? ui.accent : DRIFTMAN_COLOURS.housing,
    openShade: clicked ? DRIFTMAN_COLOURS.housing : DRIFTMAN_COLOURS.dark,
    link: !!args.link,
  };
  if (clicked && T < INSERT_DROP_END + PULSE_SECONDS) body.housing = DRIFTMAN_COLOURS.dim; // the click
  const L = shelfLayout(frame.cols, frame.rows, tier);
  const sweepU = ramp(T, INSERT_CLICK_END, INSERT_SWEEP_END);
  let sweep = null;
  if (sweepU > 0) {
    const take = sweepStyle(item, ui);
    const cx = L.full ? L.consoleX : L.miniX, cw = L.full ? CONSOLE_W : MINI_W;
    sweep = {
      x: cx + Math.round((cw + BAND_W) * sweepU),
      style: { ...body, ...take.style },
      band: { w: BAND_W, style: { ...body, ...take.band } },
    };
  }
  drawShelf(frame, { ...view, tier, slide: 1, dip: 0, message: '' }, skin, {
    lift: off < 0 ? -off : 0,
    drop: off > 0 ? off : 0,
    fadeP: ramp(T, INSERT_LIFT_END, INSERT_SLIDE_END),
    spread: spreadAt(T),
    body, sweep, noArrows: T > 0,
  });
}
