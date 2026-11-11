// The insert animation, first part of the cartridge timeline (DRIFT-4). A stub: it plays the right
// phases in the right order and stays flash-safe; Ana's art replaces the drawing, not the timing.
//
//   drawInsert(frame, { item, t }, skin)       skin = the console skin; t = seconds since Enter, 0..INSERT_END
//
//   item   { cartridge, view, cartSkin, classic }
//     cartridge  the library entry being inserted (see library.js)
//     view       the library view when Enter was pressed (cursor, neighbours)
//     cartSkin   the cartridge's validated skin, or null
//     classic    true for the Classic cartridge (the takeover is a one-shade shimmer only)
//
// Timeline (seconds; the whole insert + boot is 5.8 s, see boot.js):
//   0    - 0.15  the cartridge lifts one row, the LED is solid
//   0.15 - 0.45  the neighbours slide off and dim; dots, hint and details dissolve
//   0.45 - 0.85  the cartridge drops three rows into the slot (accelerating)
//   0.85 - 1.0   click: the housing row brightens one shade, the CART LED goes on in the accent colour
//   1.0  - 1.5   the skin takeover band sweeps left to right, swapping the console's frame, grille,
//                stripe and colour (Classic: a one-shade shimmer only)
// Every brightness change is a ramp of at least 0.15 s; the background never changes.
import { clearFrame, putCentered, ramp, sizeTier, drawTooSmall } from './ui.js';
import { drawShelf, SLOT_BOX } from './library.js';
import { DRIFTMAN_COLOURS } from './driftman.js';

export const INSERT_LIFT_END = 0.15;
export const INSERT_SLIDE_END = 0.45;
export const INSERT_DROP_END = 0.85;
export const INSERT_CLICK_END = 1.0;
export const INSERT_SWEEP_END = 1.5;
export const INSERT_END = INSERT_SWEEP_END;

// Rows the cartridge is displaced by at time t: -1 (lifted) ... +3 (dropped into the slot).
export function cartridgeOffset(t) {
  if (t < INSERT_LIFT_END / 2) return 0;
  if (t < INSERT_SLIDE_END) return -1;
  const u = ramp(t, INSERT_SLIDE_END, INSERT_DROP_END);
  return -1 + Math.round(4 * u * u);
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
    led: clicked ? 'on' : 'solid',
    ledShade: clicked ? ui.accent : DRIFTMAN_COLOURS.housing,
    openShade: clicked ? DRIFTMAN_COLOURS.housing : DRIFTMAN_COLOURS.dark,
  };
  const sweepU = ramp(T, INSERT_CLICK_END, INSERT_SWEEP_END);
  const sweep = sweepU > 0 ? {
    x: frame.cols * sweepU,
    style: {
      ...body,
      box: item.classic ? SLOT_BOX : ((item.cartSkin && item.cartSkin.frame && item.cartSkin.frame.glyphs) || SLOT_BOX),
      shade: item.classic ? ui.dim : item.cartridge.tint + 2,
      bar: item.classic ? ui.head : item.cartridge.tint + 3,
    },
  } : null;
  drawShelf(frame, { ...view, tier, slide: 1, dip: 0, message: '' }, skin, {
    lift: off < 0 ? -off : 0,
    drop: off > 0 ? off : 0,
    fadeP: ramp(T, INSERT_LIFT_END, INSERT_SLIDE_END),
    body, sweep, noArrows: T > 0,
  });
}
