// High contrast / tunnel: a checkerboard tunnel, flown through slowly. Rings (log depth) times
// spokes (angle), the parity of the two picks lit or dark, so the board is a perfect checker.
//
// Strictly two-tone (colour index 0 only) and drawn with space, ▀, ▄ and █ only. The shade
// blocks (U+2591-2593) are left out on purpose: in a two-tone mode a dither would read as a
// third tone, and the whole point of the mode is that it is crisp.
//
// Motion is slow on purpose: rings move outward about one every two seconds (FLY 0.55 a second; 0.9 before DRIFT-12) and the spokes turn at a fraction of a spoke per second, so every
// cell flips about once every two seconds (never a few Hz). The depth is logarithmic, so rings stay evenly spread over the screen and do not all flip together. A small clear eye hides the
// centre, where the checks would shrink below one pixel.
//
// DRIFT-12: a sim on the real-time clock (see the end of the file), so the speed keys no longer make it flow faster, and slower than it was, so that two paints between two reads of the
// viewer's grid (a late timer, the q156 clock at 10 fps) still change under 30 % of the cells (rule L3: 34.25 % at 0.9 rings a second, 24.50 % at 0.55 at the worst measured).
// `ideal` is the picture, pure in t; the default export is the scene: a sim that draws `ideal` at (steps taken / 30) s. Pixels are half rows: a cell is 1 wide and 2 tall, so a half row
// is square.
import { seedOf, timeOf, fastAtan2 } from './util.js';

export const TUNNEL_GLYPHS = [32, 0x2580, 0x2584, 0x2588];

export const RING_SCALE = 2.4; // rings per natural-log unit of radius
export const EYE = 3.4; // radius (pixels) of the clear centre
export const FLY = 0.55; // rings per second flowing outwards
const TURN = 0.08; // spokes per second
export const TWIST = 0.22; // spokes of extra turn per ring of depth (a gentle spiral)
const TAU = Math.PI * 2;

// the vanishing point (the middle of the eye), in cells across and in half rows down: it drifts a little with t, so the tunnel bends
export function eyeAt(T, W, H, phase) {
  return [W / 2 + Math.sin(T * 0.21 + phase * 6) * W * 0.05, H + Math.cos(T * 0.17 + phase * 5) * H * 0.08];
}

export function ideal(t, w, h, params) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const g = params.glyphs, col = params.colours;
  g.fill(32);
  col.fill(0);
  if (W === 0 || H === 0) return;
  const T = timeOf(t), s = seedOf(params);
  const spokes = 10 + 2 * (((s % 5) + 5) % 5); // even, so the checker closes round the circle
  const dir = (s & 1) === 0 ? 1 : -1;
  const phase = ((s * 0.37) % 1 + 1) % 1;
  const [cx, cy] = eyeAt(T, W, H, phase);
  const flow = T * FLY + phase;
  const turn = T * TURN * dir;
  const k = spokes / TAU;
  const BLOCK = [32, 0x2584, 0x2580, 0x2588]; // index = top * 2 + bottom: none, bottom only, top only, both
  for (let y = 0; y < H; y++) {
    const y0 = 2 * y + 0.5 - cy, y1 = 2 * y + 1.5 - cy;
    const yy0 = y0 * y0, yy1 = y1 * y1;
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx, dxx = dx * dx;
      const r0 = dxx + yy0, r1 = dxx + yy1;
      let top = 0, bot = 0;
      if (r0 > EYE * EYE) {
        const depth = Math.log(r0) * 0.5 * RING_SCALE - flow;
        const ang = fastAtan2(y0, dx) * k + turn + depth * TWIST * dir;
        top = ((Math.floor(depth) + Math.floor(ang)) & 1);
      }
      if (r1 > EYE * EYE) {
        const depth = Math.log(r1) * 0.5 * RING_SCALE - flow;
        const ang = fastAtan2(y1, dx) * k + turn + depth * TWIST * dir;
        bot = ((Math.floor(depth) + Math.floor(ang)) & 1);
      }
      g[y * W + x] = BLOCK[top * 2 + bot];
    }
  }
}

// ---- the sim (DRIFT-12). `ideal` above is the picture as it was: pure in t and seed. The scene is a sim on the REAL-TIME clock (realClock, src/cells.js, as Life, wire and blocktype are
// since DRIFT-10 and DRIFT-11): its t is the number of steps taken / 30, so the scene clock that the speed keys scale no longer drives the flow. Before, the keys multiplied it: at 2x and 4x
// every cell flipped two and four times as often (0.9 rings a second and the spokes' turn on top), which the flash rules L1 (7 changes in a second), L2 (3) and L3 (30 % of the cells in one
// read) read as hot (L2 57.14 % at 2x, 100.00 % at 4x). Now the flow is the 1x flow at every speed from 1x up (the app steps a realClock sim at min(speed, 1) of real time) and the keys still
// shorten the scene's turn in the scheduler, as for Life. Below 1x the tunnel slows down with the clock. There is no follower: the flow is slow enough by design (FLY above).
const STEP_HZ = 30;

function init(w, h, seed) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  return { w: W, h: H, seed: seed | 0, sub: 0 };
}

function step(s) {
  s.sub++;
}

function draw(s, params) {
  ideal(s.sub / STEP_HZ, s.w, s.h, params);
}

export default { id: 'tunnel', kind: 'sim', realClock: true, init, step, draw };
ideal.id = 'tunnel-ideal'; // renderScene(ideal, ...) is the picture the scene wants at t (a pure 'cells' scene)
ideal.kind = 'cells';
