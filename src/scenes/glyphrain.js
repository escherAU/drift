// Chaos / glyphrain: multi-colour rain of letters, digits and symbols. Faster and
// denser than calm rain: most columns carry a stream, each with a bright head and a
// tail that steps down in four brightness levels. Characters stay where they were
// dropped and re-roll now and then, so it shimmers rather than strobes.
//
// kind 'cells', pure in t. Colour index = hue * 4 + brightness (see makeMultiPalette).
import { rand, seedOf, timeOf, pmod } from './util.js';

const ACTIVE = 0.82; // fraction of stream cycles that actually fall

function charset() {
  const out = [];
  const add = (a, b) => { for (let c = a; c <= b; c++) out.push(c); };
  add(0x30, 0x39); // digits
  add(0x41, 0x5a); // A-Z
  add(0x61, 0x7a); // a-z
  for (const ch of '!#$%&*+<=>?@^~/\\|{}[]()') out.push(ch.codePointAt(0));
  add(0x3b1, 0x3c9); // Greek small
  out.push(0x2211, 0x221a, 0x221e, 0x2248, 0x2260, 0x2264, 0x2265, 0x2202, 0x222b, 0xd7, 0xf7, 0xb1, 0xb0, 0x25a0, 0x25b2, 0x25c6, 0x25cb, 0x25cf);
  return out;
}
const CHARS = charset();

export default function glyphrain(t, w, h, params) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const g = params.glyphs, col = params.colours;
  g.fill(32);
  col.fill(0);
  if (W === 0 || H === 0) return;
  const T = timeOf(t), s = seedOf(params);
  for (let c = 0; c < W; c++) {
    const speed = 7 + 9 * rand(s, c, 11); // rows per second
    const len = 6 + 10 * rand(s, c, 12);
    const gap = 1 + 10 * rand(s, c, 13);
    const cycle = H + len + gap;
    const pos = T * speed + rand(s, c, 14) * cycle * 40;
    const k = Math.floor(pos / cycle);
    const kk = pmod(k, 100000);
    if (rand(s, c, 100 + kk) > ACTIVE) continue;
    const head = pos - k * cycle; // row of the head (may be above the screen at first)
    const dropHue = Math.floor(rand(s, c, 200 + kk) * 8);
    const y0 = Math.max(0, Math.ceil(head - len));
    const y1 = Math.min(H - 1, Math.floor(head));
    for (let y = y0; y <= y1; y++) {
      const d = head - y; // 0 at the head, up to len in the tail
      const level = d < 1 ? 3 : Math.max(0, 3 - Math.floor((d / len) * 4));
      const spice = rand(s, c * 4099 + y, 300 + kk);
      const hue = spice < 0.22 ? (dropHue + 1 + Math.floor(spice * 14)) & 7 : dropHue;
      const roll = Math.floor(T * 1.5 + rand(s, c, y + 500) * 4); // re-roll about every 0.7 s, out of phase
      const ch = CHARS[(rand(s * 31 + roll, c * 4099 + y, kk) * CHARS.length) | 0];
      g[y * W + c] = ch;
      col[y * W + c] = hue * 4 + level;
    }
  }
}
glyphrain.id = 'glyphrain';
glyphrain.kind = 'cells';
