// Ripples: soft rings that spread from seeded random points, overlap and fade.
// Stateless: ripple i is born at a time/position derived by hashing (seed, i),
// so any t can be evaluated directly. Only the annulus around each ring is
// visited, so cost scales with ring circumference, not screen area.
import { dims, outBuf, seedOf, timeOf, rand, smooth } from './util.js';

const INTERVAL = 2.4; // mean seconds between births
const LIFE = 17; // mean lifetime in seconds
const SPEED = 2.2; // mean spread speed in units/s

const GAUSS = new Float32Array(512); // exp(-q) for q in [0,8) at 1/64 steps
for (let i = 0; i < 512; i++) GAUSS[i] = Math.exp(-(i + 0.5) / 64);
const SAT = new Uint8Array(1024); // saturating curve for summed ring strength
for (let i = 0; i < 1024; i++) SAT[i] = Math.round(255 * (1 - Math.exp(-(i / 256) * 1.3)));

let scratch = new Float32Array(0);

export default function ripples(t, w, h, params) {
  const [W, H] = dims(w, h);
  const n = W * H;
  const out = outBuf(params, n);
  if (n === 0) return out;
  if (scratch.length !== n) scratch = new Float32Array(n); else scratch.fill(0);
  const T = timeOf(t), s = seedOf(params);
  const P = 2 * H;
  const i0 = Math.floor((T - LIFE * 1.25) / INTERVAL) - 1;
  const i1 = Math.floor(T / INTERVAL) + 1;
  for (let k = i0; k <= i1; k++) {
    const born = k * INTERVAL + (rand(s, k, 1) - 0.5) * INTERVAL * 0.8;
    const age = T - born;
    const life = LIFE * (0.8 + 0.4 * rand(s, k, 4));
    if (age < 0 || age >= life) continue;
    const x0 = rand(s, k, 2) * W, y0 = rand(s, k, 3) * P;
    const r = SPEED * (0.8 + 0.4 * rand(s, k, 5)) * age;
    const amp = Math.pow(1 - age / life, 1.7) * smooth(age / 3) * (0.55 + 0.45 * rand(s, k, 6));
    const sigma = 2.8 + 0.06 * age;
    const reach = 3 * sigma;
    const Ro = r + reach, Ri = r > reach ? r - reach : 0;
    const k2 = 1 / (2 * sigma * sigma);
    const jlo = Math.max(0, Math.ceil((y0 - Ro) / 2)), jhi = Math.min(H - 1, Math.floor((y0 + Ro) / 2));
    for (let j = jlo; j <= jhi; j++) {
      const dy = 2 * j - y0, dy2 = dy * dy;
      const o2 = Ro * Ro - dy2;
      if (o2 <= 0) continue;
      const xo = Math.sqrt(o2);
      const in2 = Ri * Ri - dy2;
      const xi = in2 > 0 ? Math.sqrt(in2) : 0;
      const base = j * W;
      // left span [x0-xo, x0-xi], right span [x0+xi, x0+xo]
      for (let side = 0; side < 2; side++) {
        let lo, hi;
        if (side === 0) { lo = x0 - xo; hi = xi > 0 ? x0 - xi : x0 + xo; }
        else { if (xi === 0) break; lo = x0 + xi; hi = x0 + xo; }
        const a = Math.max(0, Math.ceil(lo)), b = Math.min(W - 1, Math.floor(hi));
        for (let i = a; i <= b; i++) {
          const dx = i - x0;
          const d = Math.sqrt(dx * dx + dy2) - r;
          const q = d * d * k2;
          if (q < 8) scratch[base + i] += amp * GAUSS[(q * 64) | 0];
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const v = scratch[i];
    if (v > 0) { const idx = (v * 256) | 0; out[i] = SAT[idx > 1023 ? 1023 : idx]; }
  }
  return out;
}
ripples.id = 'ripples';
