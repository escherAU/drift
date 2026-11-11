// The perspective road. All pure geometry: where the edges are at a row, where a thing in flight is at a moment, how big it is.
//
// At 120x40 the horizon is row 15 and the edges are  L = 58 - 2.33(r - 15)  and  R = 61 + 2.33(r - 15). At other sizes the
// horizon stays at 37.5% of the height, the road is centred, and the slope is scaled so the road reaches the same fraction of
// the width at the bottom (k = 2.33 * w/120 * 24/rows-below-the-horizon). The right edge is the mirror of the left, so the road
// is exactly symmetric about the middle.
//
// A thing in flight has a phase u from 0 (at the horizon) to 1 (at the car). Its distance under the horizon is
// 1 + (below - 1) u^2 rows: it starts just under the horizon, crawls at first and gathers speed toward the car. (True perspective,
// horizon + below / z, rushes the last 20 rows in a single frame and shows a dash at only one place at a time; the squared ease
// keeps the same far-to-near feeling and moves a dash at most two rows a frame.)
export const DASH_TRAVEL = 1.2; // seconds for a dash from the horizon to the car
export const DASH_COUNT = 3; // dashes in flight per lane line, evenly spaced
export const DASH_PERIOD = 0.4; // = DASH_TRAVEL / DASH_COUNT: the whole picture repeats
export const LAMP_PERIOD = 2.4; // seconds between street lamps
export const LAMP_HEIGHT = 16; // rows of a lamp at full size at 120x40 (scaled with the rows under the horizon); full size is reached at three quarters of the way down, and it leaves past the right edge
export const POST_PERIOD = 1.2; // seconds between reflector posts

export function geometry(w, h) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const horizon = Math.round(H * 0.375);
  const below = Math.max(1, H - 1 - horizon);
  const cx = (W - 1) / 2;
  const k = 2.33 * (W / 120) * (24 / below);
  return { W, H, horizon, below, cx, k };
}

export function edgeL(g, r) {
  return Math.round(g.cx - 1.5 - g.k * (r - g.horizon));
}
export function edgeR(g, r) {
  return g.W - 1 - edgeL(g, r);
}
// The column of the i-th lane line (1 or 2: the thirds of the road) at row r.
export function laneX(g, r, i) {
  const l = edgeL(g, r), rr = edgeR(g, r);
  return Math.round(l + ((rr - l) * i) / 3);
}
// The middle of lane i (0 left, 1 middle, 2 right) at row r.
export function laneCentre(g, r, i) {
  const l = edgeL(g, r), rr = edgeR(g, r);
  return Math.round(l + ((rr - l) * (2 * i + 1)) / 6);
}

const frac = (x) => x - Math.floor(x);

// Rows under the horizon (1 .. below) of a thing at phase u (0 to 1).
export function depthRows(g, u) {
  const uu = u < 0 ? 0 : u > 1 ? 1 : u;
  return 1 + (g.below - 1) * uu * uu;
}
export function rowAtPhase(g, u) {
  return g.horizon + Math.round(depthRows(g, u));
}

// The row of dash i (0 to DASH_COUNT - 1) at scene time T. The three dashes of a lane line are a third of a travel apart.
export function dashRow(g, T, i) {
  return rowAtPhase(g, frac(T / DASH_TRAVEL + i / DASH_COUNT));
}

// The street lamp at scene time T: the row of its foot, its height in rows, the column of its pole and the arm length.
// It starts one row tall beside the far road, grows to full height (16 rows at 120x40) and leaves past the right edge of the window.
export function lamp(g, T) {
  const u = frac(T / LAMP_PERIOD);
  const d = depthRows(g, u);
  const foot = g.horizon + Math.round(d);
  const maxH = Math.round((LAMP_HEIGHT * g.below) / 24);
  const height = Math.min(maxH, Math.max(1, Math.round((d * maxH) / (0.75 * g.below))));
  const x = edgeR(g, foot) + 2 + Math.round(d * 0.3);
  return { u, d, foot, height, x, arm: Math.round(height / 5) };
}

// The reflector post at scene time T, on the left verge.
export function post(g, T) {
  const u = frac(T / POST_PERIOD);
  const d = depthRows(g, u);
  const foot = g.horizon + Math.round(d);
  return { u, d, foot, x: edgeL(g, foot) - 2 - Math.round(d * 0.2) };
}

// The width of one lane at row r, in columns.
export function laneWidth(g, r) {
  return (edgeR(g, r) - edgeL(g, r)) / 3;
}
