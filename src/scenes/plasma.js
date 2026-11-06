// Plasma: a slowly rolling field of four sine waves (horizontal, vertical,
// diagonal, radial). The diagonal and radial terms use angle-addition tables
// so a frame costs a few multiplies per cell and no per-cell sin().
import { dims, outBuf, seedOf, timeOf, rand } from './util.js';

const TAU = Math.PI * 2;
let cache = null;

function tables(W, H) {
  if (cache && cache.W === W && cache.H === H) return cache;
  const cx = (W - 1) / 2, cy = H - 1; // physical y = 2 * row
  const k1 = TAU / Math.max(14, 0.85 * W);
  const k2 = TAU / Math.max(12, 1.0 * H * 2);
  const lam3 = Math.max(16, 0.7 * W);
  const k3x = (TAU / lam3) * 0.8, k3y = (TAU / lam3) * 0.6;
  const k4 = TAU / Math.max(16, 0.55 * W);
  const t = {
    W, H, k1, k2,
    s1: new Float64Array(W), c1: new Float64Array(W),
    s3x: new Float64Array(W), c3x: new Float64Array(W),
    s2: new Float64Array(H), c2: new Float64Array(H),
    s3y: new Float64Array(H), c3y: new Float64Array(H),
    sd: new Float32Array(W * H), cd: new Float32Array(W * H),
    colA: new Float64Array(W), colB: new Float64Array(W),
  };
  for (let i = 0; i < W; i++) {
    const x = i - cx;
    t.s1[i] = Math.sin(k1 * x); t.c1[i] = Math.cos(k1 * x);
    t.s3x[i] = Math.sin(k3x * x); t.c3x[i] = Math.cos(k3x * x);
  }
  for (let j = 0; j < H; j++) {
    const y = 2 * j - cy;
    t.s2[j] = Math.sin(k2 * y); t.c2[j] = Math.cos(k2 * y);
    t.s3y[j] = Math.sin(k3y * y); t.c3y[j] = Math.cos(k3y * y);
    for (let i = 0; i < W; i++) {
      const d = Math.sqrt((i - cx) * (i - cx) + y * y);
      t.sd[j * W + i] = Math.sin(k4 * d);
      t.cd[j * W + i] = Math.cos(k4 * d);
    }
  }
  cache = t;
  return t;
}

export default function plasma(t, w, h, params) {
  const [W, H] = dims(w, h);
  const out = outBuf(params, W * H);
  if (out.length === 0) return out;
  const T = timeOf(t), s = seedOf(params);
  const tb = tables(W, H);
  const ph = (k) => rand(s, k, 77) * TAU;
  const a1 = 0.115 * T + ph(1), a2 = -0.09 * T + ph(2), a3 = 0.075 * T + ph(3), a4 = -0.10 * T + ph(4);
  const ca1 = Math.cos(a1), sa1 = Math.sin(a1);
  const ca3 = Math.cos(a3), sa3 = Math.sin(a3);
  const ca2 = Math.cos(a2), sa2 = Math.sin(a2);
  const ca4 = Math.cos(a4), sa4 = Math.sin(a4);
  const { colA, colB, s1, c1, s3x, c3x, s2, c2, s3y, c3y, sd, cd } = tb;
  for (let i = 0; i < W; i++) {
    // term 1 and the sin/cos of (u + a3) for the diagonal term
    colA[i] = s1[i] * ca1 + c1[i] * sa1; // sin(k1 x + a1)
  }
  // diagonal: sin(u + v + a3) with u = k3x*x, v = k3y*y -> sin(u+a3)cos v + cos(u+a3) sin v
  const dA = tb.dA || (tb.dA = new Float64Array(W));
  const dB = tb.dB || (tb.dB = new Float64Array(W));
  for (let i = 0; i < W; i++) {
    dA[i] = s3x[i] * ca3 + c3x[i] * sa3;
    dB[i] = c3x[i] * ca3 - s3x[i] * sa3;
  }
  for (let j = 0; j < H; j++) {
    const r2 = s2[j] * ca2 + c2[j] * sa2; // sin(k2 y + a2)
    const cv = c3y[j], sv = s3y[j];
    const base = j * W;
    for (let i = 0; i < W; i++) {
      const v = colA[i] + r2 + dA[i] * cv + dB[i] * sv + (sd[base + i] * ca4 + cd[base + i] * sa4);
      let u = 0.5 + v * 0.17;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      u = u * u * (3 - 2 * u);
      out[base + i] = (u * 205 + 0.5) | 0; // tops out at the dark-block level: no walls of solid white
    }
  }
  return out;
}
plasma.id = 'plasma';
