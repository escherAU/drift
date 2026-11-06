// Experimental / waves: the 2D wave equation on the cell grid. Pebbles drop at random
// (heaps and dips both) and spread as rings that bounce off the walls; now and then two
// driven sources run side by side and their rings interfere.
//
// kind 'sim' (fixed 1/30 s step). u is the height, p the height one step ago:
//   u' = u + (u - p) * DAMP + KX * (u[x-1] + u[x+1] - 2u) + KY * (u[y-1] + u[y+1] - 2u)
// A cell is 1 wide and 2 tall, so the vertical coupling is KX / 4 (isotropic waves). The
// scheme is stable while KX + KY <= 1 (here 0.5625), the damping eats energy, and the
// edges are held at zero. The height is also clamped to +-LIMIT as a seat belt: the tests
// check that at ordinary sizes the clamp never actually engages (it may at very small ones).
//
// Rendering: crests are solid shade blocks (and half blocks), troughs are braille lace;
// the colour index is the brightness level of the single-hue calm palette.
import { rnd, seedState } from './simrng.js';

const KX = 0.12;
const KY = KX / 4;
const DAMP = 0.99;
export const LIMIT = 3;
const CYCLE = 1500; // steps; the last part of each cycle runs two driven sources
const DRIVE_FROM = 900, DRIVE_TO = 1400;
const DRIVE_AMP = 0.09, DRIVE_OMEGA = 0.135;

const ENV_K = 6; // 1 / typical angular rate (about 0.17 rad per step) turns speed into height units
const CREST =[32, 0xb7, 0x2591, 0x2592, 0x2593, 0x2588];
const TROUGH = [32, 0x2802, 0x2812, 0x2836, 0x28e4, 0x28ff];

function pebble(s, cx, cy, amp, sigma) {
  const { w, h, u, p } = s;
  const r = Math.ceil(sigma * 3);
  const inv = 1 / (2 * sigma * sigma);
  for (let y = Math.max(1, Math.floor(cy) - r); y <= Math.min(h - 2, Math.floor(cy) + r); y++) {
    for (let x = Math.max(1, Math.floor(cx) - r); x <= Math.min(w - 2, Math.floor(cx) + r); x++) {
      const dx = x - cx, dy = (y - cy) * 2;
      const v = amp * Math.exp(-(dx * dx + dy * dy) * inv);
      u[y * w + x] += v;
      p[y * w + x] += v; // at rest: the heap splits into rings that run outward
    }
  }
}

function drop(s) {
  const { w, h } = s;
  const small = Math.min(1, Math.max(0.5, Math.min(w, h * 2) / 40)); // a small box gets gentler pebbles
  const amp = (1.0 + rnd(s) * 0.8) * small * (rnd(s) < 0.3 ? -1 : 1);
  pebble(s, 2 + rnd(s) * (w - 4), 2 + rnd(s) * (h - 4), amp, 2.0 + rnd(s) * 2.0);
}

function init(w, h, seed) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const n = W * H;
  const s = {
    w: W, h: H, rs: seedState(seed, 0x3c6ef372), u: new Float64Array(n), p: new Float64Array(n), q: new Float64Array(n),
    steps: 0, nextDrop: 0, clamped: 0, maxAbs: 0, sources: [],
  };
  if (W < 5 || H < 5) return s;
  for (let i = 0; i < 3; i++) drop(s);
  s.nextDrop = 25 + Math.floor(rnd(s) * 40);
  const sy = Math.floor(H / 2);
  s.sources = [Math.floor(W * 0.3), Math.floor(W * 0.7)].map((x) => sy * W + Math.min(W - 2, Math.max(1, x)));
  return s;
}

function step(s) {
  const { w, h } = s;
  if (w < 5 || h < 5) return;
  s.steps++;
  let u = s.u, p = s.p;
  const q = s.q;
  let maxAbs = 0;
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      const c = u[i];
      let v = c + (c - p[i]) * DAMP + KX * (u[i - 1] + u[i + 1] - 2 * c) + KY * (u[i - w] + u[i + w] - 2 * c);
      if (v > LIMIT) { v = LIMIT; s.clamped++; } else if (v < -LIMIT) { v = -LIMIT; s.clamped++; }
      q[i] = v;
      const a = v < 0 ? -v : v;
      if (a > maxAbs) maxAbs = a;
    }
  }
  // rotate the three buffers: p <- u, u <- q, q <- old p (edges stay zero in all three)
  s.p = u; s.u = q; s.q = p;
  s.maxAbs = maxAbs;
  const phase = s.steps % CYCLE;
  if (phase >= DRIVE_FROM && phase < DRIVE_TO) {
    const a = DRIVE_AMP * Math.sin(s.steps * DRIVE_OMEGA);
    for (const i of s.sources) s.u[i] += a;
  }
  if (s.steps >= s.nextDrop) {
    drop(s);
    s.nextDrop = s.steps + 25 + Math.floor(rnd(s) * 45);
  }
}

function draw(s, params) {
  const g = params.glyphs, c = params.colours;
  g.fill(32);
  c.fill(0);
  const { w, h, u, p } = s;
  if (w < 5 || h < 5) return;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = u[i];
      // Whether a cell is lit follows the ENVELOPE of the wave (height and speed together,
      // which stays put while a crest turns into a trough), so a ripple never blinks the
      // screen on and off; the glyph follows the height itself.
      const v = (a - p[i]) * ENV_K;
      const env = Math.sqrt(a * a + v * v);
      let ce = Math.floor(Math.sqrt(env) * 5.5 - 0.45);
      if (ce < 1) continue;
      if (ce > 5) ce = 5;
      c[i] = 3 + ce * 2 + (ce >= 5 ? 1 : 0);
      const m = a < 0 ? -a : a;
      let idx = Math.floor(Math.sqrt(m) * 5.5);
      if (idx < 1) idx = 1;
      if (idx > 5) idx = 5;
      if (a > 0) {
        g[i] = idx === 3 ? (u[i + w] > u[i - w] ? 0x2580 : 0x2584) : CREST[idx];
      } else {
        g[i] = idx === 3 ? (u[i + 1] > u[i - 1] ? 0x2847 : 0x28b8) : TROUGH[idx];
      }
    }
  }
}

export default { id: 'waves', kind: 'sim', init, step, draw };
