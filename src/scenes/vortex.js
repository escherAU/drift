// Chaos / vortex: a spinning spiral of mixed glyphs. Five arms wind into the middle and turn
// as time passes; each arm is one hue, brightest at its leading edge and dropping through
// the four levels toward its tail. Glyph kind depends on the distance from the centre
// (Greek near the middle, letters and digits mid-way, symbols outside) and re-rolls slowly.
//
// kind 'cells', pure in t. Colour index = hue * 4 + brightness level.
import { rand, seedOf, timeOf, fastAtan2 } from './util.js';

const ARMS = 5;
const TWIST = 1.9; // turns of spiral per unit of log radius
const SPIN = 0.09; // revolutions per second
const WIDTH = 0.62; // fraction of an arm period that is lit

function range(a, b) { const o = []; for (let c = a; c <= b; c++) o.push(c); return o; }
const INNER = [...range(0x3b1, 0x3c9), 0x3a3, 0x3a9, 0x3a8, 0x394, 0x398];
const MID = [...range(0x41, 0x5a), ...range(0x30, 0x39), ...range(0x61, 0x7a)];
const OUTER = Array.from('!#$%&*+<=>?@^~/|{}[]()', (c) => c.codePointAt(0)).concat([0x2211, 0x221e, 0x2248, 0x2260, 0xd7, 0xf7, 0x25a0, 0x25b2, 0x25c6, 0x25cb, 0x25cf]);

export default function vortex(t, w, h, params) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const g = params.glyphs, col = params.colours;
  g.fill(32);
  col.fill(0);
  if (W === 0 || H === 0) return;
  const T = timeOf(t), s = seedOf(params);
  const cx = W / 2, cy = H; // centre in (columns, half-rows)
  const rMax = Math.hypot(cx, cy);
  const spin = T * SPIN;

  for (let y = 0; y < H; y++) {
    const dy = (y + 0.5) * 2 - cy;
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < 1.2) continue; // a small clear eye
      const a = fastAtan2(dy, dx) / (Math.PI * 2); // turns, -0.5..0.5
      // position along the arm period: the angle, twisted by log radius, and the spin
      const v = (a * ARMS + Math.log(r + 1) * TWIST * ARMS * 0.5 + spin * ARMS) % 1;
      const f = v < 0 ? v + 1 : v;
      if (f >= WIDTH) continue;
      const raw = a * ARMS + Math.log(r + 1) * TWIST * ARMS * 0.5 + spin * ARMS;
      const arm = ((Math.floor(raw) % ARMS) + ARMS) % ARMS;
      const lvl = 3 - Math.min(3, Math.floor((f / WIDTH) * 4));
      const zone = r / rMax;
      const set = zone < 0.28 ? INNER : zone < 0.62 ? MID : OUTER;
      const k = rand(s, x * 4099 + y, 21 + Math.floor(T * 1.2 + ((x * 7 + y * 13) % 11) / 11));
      g[y * W + x] = set[(k * set.length) | 0];
      col[y * W + x] = ((arm + (zone * 3 | 0)) & 7) * 4 + lvl;
    }
  }
}
vortex.id = 'vortex';
vortex.kind = 'cells';
