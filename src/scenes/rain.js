// Rain: sparse, slow, soft columns drifting down. Much calmer than a code
// rain: few columns are active, speeds are about 2-4 rows/s, and each drop has
// a long fading tail and a soft leading edge (no bright head).
import { dims, outBuf, seedOf, timeOf, rand, smooth, pmod } from './util.js';

const ACTIVE = 0.34; // fraction of drop cycles that actually rain

export default function rain(t, w, h, params) {
  const [W, H] = dims(w, h);
  const out = outBuf(params, W * H);
  if (out.length === 0) return out;
  const T = timeOf(t), s = seedOf(params);
  for (let c = 0; c < W; c++) {
    const speed = 1.4 + 1.6 * rand(s, c, 11); // rows per second
    const len = 9 + 9 * rand(s, c, 12);
    const gap = 4 + 26 * rand(s, c, 13);
    const cycle = H + len + gap;
    const pos = T * speed + rand(s, c, 14) * cycle * 40;
    const k = Math.floor(pos / cycle);
    if (rand(s, c, 100 + pmod(k, 100000)) > ACTIVE) continue;
    const p = pos - k * cycle; // 0..cycle
    const head = p - 6; // soft leading edge extends 3 rows ahead of this
    const bright = 0.4 + 0.45 * rand(s, c, 200 + pmod(k, 100000));
    const y0 = Math.max(0, Math.ceil(head - len));
    const y1 = Math.min(H - 1, Math.floor(head + 6));
    for (let y = y0; y <= y1; y++) {
      const d = head - y; // >0 behind the head
      const prof = d < 0 ? smooth((d + 6) / 6) : Math.pow(1 - d / len, 2);
      const v = prof * bright;
      if (v > 0) out[y * W + c] = (v * 235 + 0.5) | 0;
    }
  }
  return out;
}
rain.id = 'rain';
