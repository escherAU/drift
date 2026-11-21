// High contrast / tunnel: a checkerboard tunnel, flown through slowly. Rings (log depth) times
// spokes (angle), the parity of the two picks lit or dark, so the board is a perfect checker.
//
// Strictly two-tone (colour index 0 only) and drawn with space, ▀, ▄ and █ only. The shade
// blocks (U+2591-2593) are left out on purpose: in a two-tone mode a dither would read as a
// third tone, and the whole point of the mode is that it is crisp.
//
// Motion is slow on purpose: rings move outward one per second, so every cell of the board
// flips about once a second (never a few Hz), and the spokes turn at a fraction of a spoke
// per second. The depth is logarithmic, so rings stay evenly spread over the screen and do
// not all flip together. A small clear eye hides the centre, where the checks would shrink
// below one pixel.
//
// kind 'cells', pure in t. Pixels are half rows: a cell is 1 wide and 2 tall, so a half row
// is square.
import { seedOf, timeOf, fastAtan2 } from './util.js';

export const TUNNEL_GLYPHS = [32, 0x2580, 0x2584, 0x2588];

const RING_SCALE = 2.4; // rings per natural-log unit of radius
const EYE = 3.4; // radius (pixels) of the clear centre
const FLY = 0.9; // rings per second flowing outwards
const TURN = 0.12; // spokes per second
const TWIST = 0.22; // spokes of extra turn per ring of depth (a gentle spiral)
const TAU = Math.PI * 2;

export default function tunnel(t, w, h, params) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const g = params.glyphs, col = params.colours;
  g.fill(32);
  col.fill(0);
  if (W === 0 || H === 0) return;
  const T = timeOf(t), s = seedOf(params);
  const spokes = 10 + 2 * (((s % 5) + 5) % 5); // even, so the checker closes round the circle
  const dir = (s & 1) === 0 ? 1 : -1;
  const phase = ((s * 0.37) % 1 + 1) % 1;
  // the vanishing point drifts a little, so the tunnel bends
  const cx = W / 2 + Math.sin(T * 0.21 + phase * 6) * W * 0.05;
  const cy = H + Math.cos(T * 0.17 + phase * 5) * H * 0.08; // in half rows
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
tunnel.id = 'tunnel';
tunnel.kind = 'cells';
