// Red Light, Rain: the inside of the car, and where everything stands. The geometry of a window (plain numbers, so a sim can keep it
// in its state), the cabin drawn in near silhouette (roof liner, A-pillars, mirror, dashboard, wheel) and the tests of where the
// glass is. Rows count from the top for the sky and the street and from the bottom for the dashboard, so a taller window gets more
// glass, not a taller dashboard.
import { put, text } from './canvas.js';
import { NEAR, CORAL, CYAN, MINT } from './palette.js';

const cp = (ch) => ch.codePointAt(0);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// L is one of the scene's layouts. Everything here is a number or an array of numbers.
export function geometry(W, H, L) {
  const cx = Math.floor(W / 2);
  const pivotY = H - L.dashRows;
  const hoodTop = pivotY - (L.dashRows > 2 ? 2 : 1);
  const ly = Math.max(L.glassTop + L.bokehHalfH, Math.round(H * 0.175));
  const bb = ly + L.bokehHalfH; // the row the far buildings stand on
  const pwMax = clamp(Math.round(W * 0.125), 6, 18);
  const pw = new Array(H).fill(0);
  for (let y = 1; y <= hoodTop && y < H; y++) pw[y] = 3 + Math.floor(((y - 1) * (pwMax - 3)) / Math.max(1, hoodTop - 1));
  const zx = Math.ceil(L.bokehRx) + 1;
  return {
    W, H, cx, pivotY, hoodTop, ly, bb, gTop: L.glassTop, pw, pwMax,
    mirror: L.mirror, dashRows: L.dashRows,
    zone: [cx - zx, cx + zx, ly - L.bokehHalfH, bb + 4 + L.reflRows], // the light, the street under it and the reflections
    wireRow: ly - L.bokehHalfH, pedRow: bb + 1, zebraRow: bb + 4, reflTop: bb + 5, reflRows: L.reflRows,
    span: L.pedSpan, pedX0: cx - Math.floor(L.pedSpan / 2),
    tint: [cx, ly, L.tintRx, L.tintRy], // the rain near the lamp turns green: inside this ellipse, and in the ring around it
    px: cx - 26, py: pivotY, len: Math.round(W * L.lenFrac), sRest: L.sRest, sTop: L.sTop,
  };
}

export function onGlass(g, x, y) {
  return y >= g.gTop && y < g.hoodTop && x >= g.pw[y] && x < g.W - g.pw[y];
}

export function inZone(g, x, y) {
  return x >= g.zone[0] && x <= g.zone[1] && y >= g.zone[2] && y <= g.zone[3];
}

// ---- the cabin
const DIAL = Object.freeze(['╭──╮', '│╲ │', '╰──╯']);

// A box of w columns on three rows at (x, y), its frame in colour col.
function box(cv, x, y, w, col) {
  text(cv, x, y, '┌' + '─'.repeat(w - 2) + '┐', col);
  text(cv, x, y + 1, '│' + ' '.repeat(w - 2) + '│', col);
  text(cv, x, y + 2, '└' + '─'.repeat(w - 2) + '┘', col);
}

export function drawCabin(cv, g) {
  const { W, H, cx, pivotY, hoodTop, pw } = g;
  // the roof liner
  for (let x = 0; x < W; x++) put(cv, x, 0, cp('▀'), NEAR);
  // the A-pillars: a rounded outer corner at the top, then a slanted inner edge
  for (let y = 1; y <= hoodTop; y++) {
    const w = pw[y];
    for (let x = 0; x < w; x++) {
      put(cv, x, y, cp('█'), NEAR);
      put(cv, W - 1 - x, y, cp('█'), NEAR);
    }
    put(cv, w - 1, y, cp('▟'), NEAR);
    put(cv, W - w, y, cp('▙'), NEAR);
  }
  put(cv, 0, 1, cp('▟'), NEAR);
  put(cv, W - 1, 1, cp('▙'), NEAR);
  // the rear-view mirror, with two tail lights behind us
  if (g.mirror) {
    const x0 = cx - 12;
    put(cv, x0, 1, cp('▐'), NEAR); put(cv, x0 + 23, 1, cp('▌'), NEAR);
    put(cv, x0, 2, cp('▐'), NEAR); put(cv, x0 + 23, 2, cp('▌'), NEAR);
    put(cv, x0, 3, cp('▝'), NEAR); put(cv, x0 + 23, 3, cp('▘'), NEAR);
    for (let i = 1; i < 23; i++) { put(cv, x0 + i, 1, cp('▀'), NEAR); put(cv, x0 + i, 3, cp('▄'), NEAR); }
    put(cv, x0 + 4, 2, cp('▪'), CORAL[2]);
    put(cv, x0 + 19, 2, cp('▪'), CORAL[2]);
  }
  // the dashboard: a top edge across the glass, then solid
  for (let x = pw[hoodTop]; x < W - pw[hoodTop]; x++) put(cv, x, hoodTop, cp('▄'), NEAR);
  for (let y = hoodTop + 1; y < H; y++) for (let x = 0; x < W; x++) put(cv, x, y, cp('█'), NEAR);
  if (g.dashRows > 2) {
    DIAL.forEach((row, j) => { text(cv, cx - 44, pivotY + j, row, CYAN[2]); text(cv, cx - 38, pivotY + j, row, CYAN[2]); });
    box(cv, cx - 12, pivotY, 16, CYAN[1]);
    text(cv, cx - 6, pivotY + 1, '2:14', MINT[3]);
    box(cv, cx + 12, pivotY, 21, CYAN[1]);
    text(cv, cx + 14, pivotY + 1, '88.1 FM', CYAN[3]);
    text(cv, cx + 23, pivotY + 1, '▏▎▍▌', CYAN[1]);
    // the top of the wheel, with the opening under it carved out of the dashboard
    const wt = pivotY + 3, x0 = cx - 20;
    put(cv, x0, wt, cp('╭'), NEAR);
    for (let i = 1; i < 40; i++) put(cv, x0 + i, wt, cp('━'), NEAR);
    put(cv, x0 + 40, wt, cp('╮'), NEAR);
    for (let y = wt + 1, j = 1; y < H; y++, j++) {
      for (let x = x0 - j + 1; x < x0 + 40 + j; x++) put(cv, x, y, 32, 0);
      put(cv, x0 - j, y, cp('╱'), NEAR);
      put(cv, x0 + 40 + j, y, cp('╲'), NEAR);
    }
  } else {
    text(cv, cx - 14, pivotY, '2:14', MINT[3]);
    text(cv, cx + 6, pivotY, '88.1 FM', CYAN[3]);
    const x0 = cx - 8, y = H - 1;
    for (let x = x0 + 1; x < x0 + 16; x++) put(cv, x, y, 32, 0);
    put(cv, x0, y, cp('╱'), NEAR);
    put(cv, x0 + 16, y, cp('╲'), NEAR);
  }
}
