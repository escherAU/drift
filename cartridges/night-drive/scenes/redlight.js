// B1. Red Light, Rain: the view from the driver's seat, stopped at a red light in a heavy red downpour. A simulation (kind 'sim') because
// the wiper clears water that the rain then lays down again.
//
//   cabin       roof liner, A-pillars, a rear-view mirror with two tail lights, a dashboard with two dials, the clock (2:14), the radio
//               (88.1 FM) and the top of the wheel, all in near silhouette; one wiper (a line of ╱) with its pivot at (34,31)
//   outside     far buildings, a traffic light on a wire at (60,7) blurred by the rain into a bokeh, its reflections on the road, a
//               pedestrian crossing under an umbrella
//   the rain    a heavy downpour of slanted ╲ speed lines (2 to 8 cells, lit deep red, falling down and to the right in a gusting wind;
//               lib/downpour.js), with water on the glass (drops, runners and their trails; lib/rain.js): about 0.005 new drops per
//               glass cell per step, a drop lasting 0.6 to 1.1 s, about 1 in 4.5 a runner
//   the wiper   a cycle of 72 steps (2.4 s): still for 44, then 28 steps (0.93 s) up and back; every cell the blade crosses is dried
//               (no water, and no rain shown there for 0.4 to 0.63 s) and the blade throws spray (* then x then a degree sign)
//   the light   red until 58 s (step 1740); then the red ramps down a shade at a time (0.267 s a shade, each cell 0 to 3 steps late) to
//               dark, and the green ramps up from step 1776 (59.2 s), reaching full by about 60.1 s; the reflections go coral, dark,
//               then mint from 59.2 s to about 61.7 s. The rain near the lamp follows: inside an ellipse round the lamp it turns mint,
//               in the ring around it mint one shade lower, beyond that it stays red. Each such cell goes red, then dark for a gap
//               (longer than a 4x frame, so there is never a red-to-green cut), then green 16 steps (plus 0 to 11 jitter) after
//               the lamp's own green begins
//   buildings   still until 62 s (step 1860), then they slide a column every 0.2 s (6 steps)
//
// Compact rule (under 100 columns or 32 rows, such as 80x24): no mirror, a 9x5 bokeh, a 2-row dashboard, lower buildings.
// The sim's clock is its step count (30 a second): a picture is a function of (size, seed, steps) and nothing else, draw never changes
// the state, and nothing depends on the end of the 90 s: the state stays bounded for as long as it is stepped. The background is never
// drawn: a blank cell is a space in colour 0.
import { seedState } from '../../../src/scenes/simrng.js';
import { canvas, clear, put } from '../lib/canvas.js';
import { geometry as geometryOf, drawCabin } from '../lib/dash.js';
import { bokehCells, lampColour } from '../lib/bokeh.js';
import { makeBuildings, drawBuildings, drawZebra, drawPed, drawReflections } from '../lib/street.js';
import { rainInit, rainStep, drawRain, drawWiper, inBand } from '../lib/rain.js';
import { FAR } from '../lib/palette.js';

// Breakpoints, widest first; a window gets the first layout it is at least as big as.
export const LAYOUTS = Object.freeze([
  Object.freeze({ name: 'full', minCols: 100, minRows: 32, mirror: true, bokehRx: 7.5, bokehRy: 3.5, bokehHalfH: 3, glassTop: 4, dashRows: 9, reflRows: 6, bMin: 4, bMax: 6, pedSpan: 76, lenFrac: 0.9, sRest: 5, sTop: -1.2, tintRx: 15, tintRy: 6, maxLen: 8 }),
  Object.freeze({ name: 'compact', minCols: 0, minRows: 0, mirror: false, bokehRx: 4.5, bokehRy: 2.5, bokehHalfH: 2, glassTop: 1, dashRows: 2, reflRows: 4, bMin: 3, bMax: 4, pedSpan: 48, lenFrac: 0.9, sRest: 5, sTop: -1.2, tintRx: 10, tintRy: 4.5, maxLen: 6 }),
]);
export function layoutFor(w, h) {
  return LAYOUTS.find((l) => w >= l.minCols && h >= l.minRows) || LAYOUTS[LAYOUTS.length - 1];
}

const dims = (w, h) => [w > 0 ? Math.floor(w) : 0, h > 0 ? Math.floor(h) : 0];
const MIN_W = 40, MIN_H = 12; // under this the window is too small to hold a picture, and stays blank

// Where everything stands in a window of w x h (plain numbers).
export function geometry(w, h) {
  const [W, H] = dims(w, h);
  return geometryOf(W, H, layoutFor(W, H));
}

// Is the cell inside the area the wiper sweeps?
export function inSweep(w, h, x, y) {
  return inBand(geometry(w, h), x, y);
}

function init(w, h, seed) {
  const [W, H] = dims(w, h);
  const s = { w: W, h: H, seed: Number.isFinite(seed) ? seed | 0 : 1, rs: seedState(seed, 0x7ed11), steps: 0, ok: W >= MIN_W && H >= MIN_H };
  if (!s.ok) return s;
  const L = layoutFor(W, H);
  s.g = geometryOf(W, H, L);
  const b = makeBuildings(s, L);
  s.bh = b.h;
  s.bs = b.st;
  rainInit(s, s.g, L.maxLen);
  return s;
}

function step(s) {
  s.steps++;
  if (!s.ok) return;
  rainStep(s, s.g);
}

function draw(s, params) {
  const cv = canvas(params.glyphs, params.colours, s.w, s.h);
  clear(cv);
  if (!s.ok) return;
  const g = s.g, n = s.steps, L = layoutFor(s.w, s.h);
  // outside, back to front
  drawBuildings(cv, g, s);
  drawRain(cv, s, n);
  // the wire, and the light hanging from it
  const wy = g.ly - L.bokehHalfH, wr = L.mirror ? 28 : 20;
  for (let x = g.cx - wr; x <= g.cx + wr; x++) if (Math.abs(x - g.cx) > Math.floor(L.bokehRx * 0.5)) put(cv, x, wy, '─'.codePointAt(0), FAR);
  for (const c of bokehCells(L, s.seed)) {
    const col = lampColour(n, c.shade, c.a, c.b);
    if (col !== 0) put(cv, g.cx + c.dx, g.ly + c.dy, c.glyph, col);
  }
  drawReflections(cv, g, n, L.name, s.seed);
  drawZebra(cv, g);
  drawPed(cv, g, n);
  // the cabin, then the wiper in front of it all
  drawCabin(cv, g);
  drawWiper(cv, g, n);
}

const redlight = { id: 'redlight', kind: 'sim', init, step, draw };
export default redlight;
