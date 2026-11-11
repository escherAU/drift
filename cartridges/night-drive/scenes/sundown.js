// A3. Sundown Grid: the sun going down over a neon grid. A half-disc sun on the horizon cut by gaps that slide down it, a grid of
// cyan lines running in toward the viewer, wireframe mountains and a palm at each edge.
//
//   sun         a semicircle 52 wide and 13 rows tall (34x8 at 80x24) centred on the horizon, coloured by the row it is in (sun,
//               tang, coral, mag from the top), cut by gaps that widen toward the bottom and slide down half a row every second
//   sinking     it steps down a row every 15 s for 60 s and rises back the same way over the next 60 s: the scene loops every 120 s
//   grid        a horizontal appears just under the horizon every 0.8 s and runs toward the viewer, faster as it nears; nine
//               verticals meet at the middle of the horizon
//   palms       two, at the edges; every 20 s one frond steps one cell out and back, the left palm first (not at 80x24)
//
// Compact rule (anything under 100 columns or 32 rows, such as 80x24): the 34x8 sun, four horizontals, no palms, smaller mountains.
// Small rule (under 24 rows): a 24x5 sun without gaps, two horizontals. The horizontals' steps are planned per window (lib/grid.js), so
// that neither one tick nor four in a row (a frame at 4x) change much of the picture; a short window has the fewest cells to spend.
// kind 'cells'. Pure in (t, w, h, seed): t0 in params shifts the scene's own clock; everything moves on the 15 Hz tick of lib/grid.js, so
// the picture at T + 120 s is the picture at T. The background is never drawn: a blank cell is a space in colour 0. The sun is
// never lit or dimmed: its colour is a function of the row, so it can only appear and disappear a half-row at a time.
import { rand } from '../../../src/scenes/util.js';
import { canvas, clear, put } from '../lib/canvas.js';
import { sceneTime, seedOf } from '../lib/clock.js';
import { SUN, TANG, CORAL, MAG, VIOLET, CYAN, ICE } from '../lib/palette.js';
import { tickOf, slideOf, sinkOf, swayOf, gapAt, lineTable, planOf, capsOf, LINE_TICKS, LOOP_TICKS, BUDGET_WINDOW } from '../lib/grid.js';
import { PALM_W, PALM_H, drawPalm, drawMountain, mountainsIn } from '../lib/palms.js';

// Breakpoints, widest first; a window gets the first layout it is at least as big as.
export const LAYOUTS = Object.freeze([
  Object.freeze({ name: 'full', minCols: 100, minRows: 32, sunRows: 13, sunR: 13, sunHalf: 26, gapTop: 16, lines: 5, fewLines: 4, palms: true, hmin: 4, hmax: 7, left: 4 }),
  Object.freeze({ name: 'compact', minCols: 0, minRows: 24, sunRows: 8, sunR: 8.5, sunHalf: 17, gapTop: 13, lines: 4, palms: false, hmin: 2, hmax: 3, left: 2 }),
  Object.freeze({ name: 'small', minCols: 0, minRows: 0, sunRows: 5, sunR: 5.5, sunHalf: 12, gapTop: 0, lines: 2, palms: false, hmin: 2, hmax: 3, left: 2 }),
]);
export function layoutFor(w, h) {
  return LAYOUTS.find((l) => w >= l.minCols && h >= l.minRows) || LAYOUTS[LAYOUTS.length - 1];
}

// How many horizontals are in flight: a layout's `lines`, or one fewer (fewLines) where the plan for that many cannot keep four ticks
// under BUDGET_WINDOW (100x32 and the other short windows of the big layout): every horizontal that moves costs a whole row of cells.
const linesMemo = new Map();
function linesOf(L, W, H, below) {
  if (!L.fewLines) return L.lines;
  const key = L.name + '|' + W + 'x' + H;
  let n = linesMemo.get(key);
  if (n === undefined) {
    n = planOf(W, H, sunTicks(W, H), below, L.lines).level <= BUDGET_WINDOW + 1e-9 ? L.lines : L.fewLines;
    linesMemo.set(key, n);
  }
  return n;
}

const cp = (ch) => ch.codePointAt(0);
const BANDS = [SUN[3], TANG[3], CORAL[3], MAG[3]];
const STAR_DENSITY = 0.02;

// The horizon row, and the rows under it, of a window.
const horizonOf = (H) => Math.floor(H / 2);

// The rows (ascending, nearest last) the horizontals are on at time T, in a window w x h.
export function lineRows(T, w, h) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  if (W === 0 || H < 2) return [];
  const L = layoutFor(W, H);
  const hz = horizonOf(H), below = Math.max(1, H - 1 - hz);
  const n = linesOf(L, W, H, below);
  const table = lineTable(below, n, capsOf(W, H, sunTicks(W, H), below, n));
  const k = tickOf(sceneTime(T)) % LINE_TICKS;
  const out = [];
  for (let j = 0; j < n; j++) out.push(hz + table[j * LINE_TICKS + k]);
  return out;
}

// The sun: rows from its top down to the horizon; each row is two half-rows, each lit or in a gap.
function drawSun(cv, W, H, L, sink, slides) {
  const hz = horizonOf(H), cx = Math.floor(W / 2);
  const baseTop = hz - L.sunRows;
  for (let y = baseTop + sink; y < hz; y++) {
    const d = hz - 1 - y + sink; // rows above the sun's centre line
    const hw = Math.round(L.sunHalf * Math.sqrt(Math.max(0, 1 - (d / L.sunR) ** 2)));
    const eLow = 2 * (hz - 1 - y);
    const whole = y === baseTop + sink; // the top row of the sun is never cut
    const up = whole || !gapAt(eLow + 1, slides, L.gapTop), low = whole || !gapAt(eLow, slides, L.gapTop);
    if (!up && !low) continue;
    const band = Math.floor(((y - baseTop) * 4) / L.sunRows);
    const glyph = cp(up && low ? '█' : up ? '▀' : '▄');
    for (let x = cx - hw; x < cx + hw; x++) put(cv, x, y, glyph, BANDS[Math.max(0, Math.min(3, band))]);
  }
}

// Cells the sun changes on each tick of the 1800-tick loop in a window w x h (a slide of the gaps, a step down or up a row; zero on
// every other tick), counted on the sun alone: lib/grid.js capsOf plans the horizontals' steps around them.
const sunMemo = new Map();
export function sunTicks(w, h) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const key = W + 'x' + H;
  let out = sunMemo.get(key);
  if (out) return out;
  out = new Float64Array(LOOP_TICKS);
  if (W > 0 && H > 1) {
    const L = layoutFor(W, H);
    const draw = (m) => {
      const cv = canvas(new Uint16Array(W * H), new Uint8Array(W * H), W, H);
      clear(cv);
      drawSun(cv, W, H, L, sinkOf(m), slideOf(m));
      return cv;
    };
    for (let m = 0; m < LOOP_TICKS; m++) {
      const before = (m + LOOP_TICKS - 1) % LOOP_TICKS;
      if (sinkOf(m) === sinkOf(before) && slideOf(m) === slideOf(before)) continue;
      const x = draw(before), y = draw(m);
      let n = 0;
      for (let i = 0; i < x.g.length; i++) if (x.g[i] !== y.g[i] || x.c[i] !== y.c[i]) n++;
      out[m] = n;
    }
  }
  sunMemo.set(key, out);
  return out;
}

function sundown(t, w, h, params) {
  const cv = canvas(params.glyphs, params.colours, w, h);
  clear(cv);
  const W = cv.w, H = cv.h;
  if (W === 0 || H === 0) return;
  const T = sceneTime(t, params);
  const S = seedOf(params);
  const m = tickOf(T);
  const L = layoutFor(W, H);
  const hz = horizonOf(H), cx = Math.floor(W / 2), below = Math.max(1, H - 1 - hz);

  // ---- stars: still, in the sky above the sun's highest position
  const starRows = Math.max(0, hz - L.sunRows - 1);
  for (let y = 0; y < starRows; y++) {
    for (let x = 0; x < W; x++) {
      if (rand(S + 21, x, y) >= STAR_DENSITY) continue;
      if (rand(S + 23, x, y) < 0.25) put(cv, x, y, cp('°'), ICE[1]); else put(cv, x, y, cp('·'), ICE[0]);
    }
  }

  // ---- mountains, on both sides of the sun, standing on the horizon
  const base = hz - 1;
  // between the palm and the sun where there is room for one, else behind the palm
  const hiL = cx - L.sunHalf - 2, loR = cx + L.sunHalf + 1;
  const loL = L.palms && hiL - (PALM_W + 2) + 1 >= 2 * L.hmin ? PALM_W + 2 : L.left;
  const hiR = L.palms && W - 1 - (PALM_W + 2) - loR + 1 >= 2 * L.hmin ? W - 1 - (PALM_W + 2) : W - 1 - L.left;
  for (const mt of mountainsIn(loL, hiL, L.hmin, L.hmax, S, 0)) drawMountain(cv, mt.px, base, mt.hm, VIOLET[2]);
  for (const mt of mountainsIn(loR, hiR, L.hmin, L.hmax, S, 1)) drawMountain(cv, mt.px, base, mt.hm, VIOLET[2]);

  // ---- palms at the two edges, and the sway of one frond
  if (L.palms) {
    const sway = swayOf(m);
    drawPalm(cv, 2, hz - PALM_H, -1, sway === 0, VIOLET[1]);
    drawPalm(cv, W - 2 - PALM_W, hz - PALM_H, 1, sway === 1, VIOLET[1]);
  }

  // ---- the sun
  drawSun(cv, W, H, L, sinkOf(m), slideOf(m));

  // ---- the horizon
  for (let x = 0; x < W; x++) put(cv, x, hz, cp('━'), MAG[3]);

  // ---- the grid: nine verticals meeting at the middle of the horizon, then the horizontals over them
  const spread = (15 * W) / 120;
  for (let y = hz + 1; y < H; y++) {
    for (let k = -4; k <= 4; k++) {
      put(cv, Math.round(cx + (spread * k * (y - hz)) / below), y, cp(k === 0 ? '│' : k < 0 ? '╱' : '╲'), CYAN[0]);
    }
  }
  for (const y of lineRows(T, W, H)) for (let x = 0; x < W; x++) put(cv, x, y, cp('─'), CYAN[1]);
}

sundown.id = 'sundown';
sundown.kind = 'cells';
export default sundown;
