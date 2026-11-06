// Sunburst: soft rays rotating slowly around a centre that drifts, with a
// gentle breathing pulse and a faint glow at the hub.
import { dims, outBuf, seedOf, timeOf, rand } from './util.js';

const TAU = Math.PI * 2;
const N1 = 12; // main ray count
const N2 = 7; // fainter counter-rotating ray set

export default function sunburst(t, w, h, params) {
  const [W, H] = dims(w, h);
  const out = outBuf(params, W * H);
  if (out.length === 0) return out;
  const T = timeOf(t), s = seedOf(params);
  const ph = (k) => rand(s, k, 31) * TAU;
  const P = H * 2; // physical height
  const cx = (W - 1) / 2 + 0.14 * W * Math.sin(0.017 * T + ph(0)) + 0.05 * W * Math.sin(0.041 * T + ph(1));
  const cy = (H - 1) + 0.14 * P * Math.sin(0.021 * T + ph(2)) + 0.05 * P * Math.sin(0.037 * T + ph(3));
  const rot1 = 0.036 * T + ph(4);
  const rot2 = -0.022 * T + ph(5);
  const R = Math.sqrt(W * W + P * P) / 2;
  const pulse = 1 + 0.08 * Math.sin(0.31 * T + ph(6));
  const amp = 0.93 + 0.07 * Math.sin(0.27 * T + ph(7));
  const R0 = 0.5 * R * pulse;
  const invR0sq = 1 / (R0 * R0);
  const glowK = 1 / (2 * (0.07 * R + 1) * (0.07 * R + 1));
  const a1 = N1 * rot1, a2 = N2 * rot2;
  for (let j = 0; j < H; j++) {
    const dy = 2 * j - cy;
    const dy2 = dy * dy;
    const base = j * W;
    for (let i = 0; i < W; i++) {
      const dx = i - cx;
      const r2 = dx * dx + dy2;
      const r = Math.sqrt(r2);
      const th = Math.atan2(dy, dx);
      const q1 = 0.5 + 0.5 * Math.sin(N1 * th - a1);
      const q2 = 0.5 + 0.5 * Math.sin(N2 * th - a2);
      const ray = 0.72 * (q1 * q1 * (3 - 2 * q1)) + 0.28 * (q2 * q2 * (3 - 2 * q2));
      const rad = 1 / (1 + r2 * invR0sq);
      const hub = r / (r + 5); // rays dissolve toward the centre (no angular singularity)
      let v = ray * rad * hub * amp + 0.5 * Math.exp(-r2 * glowK);
      v = v > 1 ? 1 : v;
      out[base + i] = (v * 255 + 0.5) | 0;
    }
  }
  return out;
}
sunburst.id = 'sunburst';
