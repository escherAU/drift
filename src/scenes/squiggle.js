// Squiggle: one head tracing a slowly morphing Lissajous / spirograph figure,
// leaving a long soft trail. The line itself is drawn with braille dots (via
// params.glyphs) and only the part near the head carries a soft block glow.
import { dims, outBuf, glyphBuf, seedOf, timeOf, rand, smooth } from './util.js';

const TAU = Math.PI * 2;
const HEAD_SPEED = 6.5; // physical units (cell widths) per second along the path
const TRAIL_SEC = 48; // how many seconds of travel the trail covers
const DOT_MIN = 26; // trail intensity below which a braille dot is not drawn

// braille bit for [dotRow 0..3][dotCol 0..1]
const BIT = [[1, 8], [2, 16], [4, 32], [64, 128]];
const SPLAT = new Float32Array(200); // exp(-d2/2) with d2 in 1/16 steps up to 12.5
for (let i = 0; i < 200; i++) SPLAT[i] = Math.exp(-(i / 16) / 2);

export default function squiggle(t, w, h, params) {
  const [W, H] = dims(w, h);
  const n = W * H;
  const out = outBuf(params, n);
  const masks = glyphBuf(params, n);
  if (n === 0) return out;
  const T = timeOf(t), s = seedOf(params);
  const ph = (k) => rand(s, k, 5) * TAU;
  const cx = (W - 1) / 2, cy = H - 1; // physical y = 2 * row
  const ax = Math.min(0.46 * W, cx), ay = Math.min(0.46 * 2 * H, cy);
  const p1 = 0.013 * T + 0.5 * Math.sin(0.009 * T + ph(1)) + ph(2);
  const p2 = 0.011 * T + 0.5 * Math.sin(0.007 * T + ph(3)) + ph(4);
  const p3 = -0.009 * T + ph(5);
  const p4 = 0.008 * T + ph(6);
  const sp = Math.max(0.5, 0.7 * Math.hypot(3.4 * ax, 3.1 * ay)); // typical |dP/du|
  const uPerSec = HEAD_SPEED / sp;
  const head = T * uPerSec + ph(7);
  const span = TRAIL_SEC * uPerSec;
  const N = Math.max(120, Math.min(5000, Math.ceil((TRAIL_SEC * HEAD_SPEED) / 0.45)));
  for (let j = 0; j < N; j++) {
    const f = j / (N - 1);
    const rise = smooth(f / 0.07);
    const inv = 1 - f;
    const I = 255 * inv * inv * rise;
    if (I < 2) continue;
    const u = head - f * span;
    const x = cx + ax * (0.78 * Math.sin(3 * u + p1) + 0.22 * Math.sin(5 * u + p3));
    const y = cy + ay * (0.78 * Math.sin(2 * u + p2) + 0.22 * Math.sin(7 * u + p4));
    const ci = Math.round(x), cj = Math.round(y / 2);
    for (let dr = -1; dr <= 1; dr++) {
      const jj = cj + dr;
      if (jj < 0 || jj >= H) continue;
      const dy = y - 2 * jj;
      for (let dc = -2; dc <= 2; dc++) {
        const ii = ci + dc;
        if (ii < 0 || ii >= W) continue;
        const dx = x - ii;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 12.5) continue;
        const v = 0.55 * I * SPLAT[(d2 * 16) | 0];
        const idx = jj * W + ii;
        if (v > out[idx]) out[idx] = v + 0.5;
      }
    }
    if (masks && I >= DOT_MIN) {
      const col = Math.floor(x + 0.5), row = Math.floor((y + 1) / 2);
      if (col >= 0 && col < W && row >= 0 && row < H) {
        const dxd = Math.floor((x + 0.5 - col) * 2);
        const dyd = Math.floor((y + 1 - 2 * row) * 2);
        const idx = row * W + col;
        masks[idx] |= BIT[dyd > 3 ? 3 : dyd][dxd > 1 ? 1 : dxd];
        const iv = I + 0.5;
        if (iv > out[idx]) out[idx] = iv > 255 ? 255 : iv;
      }
    }
  }
  return out;
}
squiggle.id = 'squiggle';
squiggle.glyphs = true;
