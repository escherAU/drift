// Chaos / swarm: a swarm of bouncing letters, digits and symbols in many hues. Each glyph
// flies in a straight line, reflects off the four walls and bounces off the others
// (equal-mass elastic collisions, so the speed of a pair is conserved). Each glyph leaves
// a short trail that fades by dropping through the four brightness levels, then blanks.
//
// kind 'sim' (fixed 1/30 s step). Units: x in columns, y in half-rows (a cell is 1 wide
// and 2 tall, so space is isotropic); the box is [0, w] by [0, 2h].
// Colour index = hue * 4 + brightness level (see glyphrain).

const DT = 1 / 30;
const D = 2; // contact distance between two glyph centres (about one cell wide, one row tall)
const TRAIL = 12; // steps a trail cell lives: ages 12..10 level 3, 9..7 level 2, 6..4 level 1, 3..1 level 0
const MAX_N = 320;

function charset() {
  const out = [];
  const add = (a, b) => { for (let c = a; c <= b; c++) out.push(c); };
  add(0x30, 0x39); add(0x41, 0x5a); add(0x61, 0x7a);
  for (const ch of '!#$%&*+<=>?@^~/|{}[]()') out.push(ch.codePointAt(0));
  add(0x3b1, 0x3c9);
  out.push(0x2211, 0x221a, 0x221e, 0x2248, 0x2260, 0x2264, 0x2265, 0x2202, 0x222b, 0xd7, 0xf7, 0xb1, 0xb0, 0x25a0, 0x25b2, 0x25c6, 0x25cb, 0x25cf);
  return out;
}
const CHARS = charset();

function rnd(s) {
  let a = (s.rs = (s.rs + 0x6d2b79f5) | 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function init(w, h, seed) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const n = W === 0 || H === 0 ? 0 : Math.max(1, Math.min(MAX_N, Math.round((W * H) / 30)));
  const s = {
    w: W, h: H, H2: H * 2, rs: (seed | 0) ^ 0x51ed270b, p: [], steps: 0, collisions: 0,
    trail: new Uint8Array(W * H), tch: new Uint16Array(W * H), thue: new Uint8Array(W * H),
  };
  for (let i = 0; i < n; i++) {
    const sp = 7 + rnd(s) * 12; // 7..19 units per second
    const a = rnd(s) * Math.PI * 2;
    s.p.push({
      x: rnd(s) * W, y: rnd(s) * H * 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      ch: CHARS[(rnd(s) * CHARS.length) | 0], hue: i & 7,
    });
  }
  return s;
}

function step(s) {
  const { w, H2, p } = s;
  if (p.length === 0) return;
  s.steps++;
  const tr = s.trail;
  for (let i = 0; i < tr.length; i++) if (tr[i] > 0) tr[i]--;
  for (const q of p) {
    q.x += q.vx * DT; q.y += q.vy * DT;
    if (q.x < 0) { q.x = -q.x; q.vx = Math.abs(q.vx); }
    else if (q.x > w) { q.x = 2 * w - q.x; q.vx = -Math.abs(q.vx); }
    if (q.y < 0) { q.y = -q.y; q.vy = Math.abs(q.vy); }
    else if (q.y > H2) { q.y = 2 * H2 - q.y; q.vy = -Math.abs(q.vy); }
    if (q.x < 0) q.x = 0; else if (q.x > w) q.x = w; // a box narrower than the step
    if (q.y < 0) q.y = 0; else if (q.y > H2) q.y = H2;
  }
  // glyph-glyph: equal masses, exchange the velocity component along the contact normal
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i];
    for (let j = i + 1; j < n; j++) {
      const b = p[j];
      const dx = b.x - a.x;
      if (dx >= D || dx <= -D) continue;
      const dy = b.y - a.y;
      if (dy >= D || dy <= -D) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 >= D * D) continue;
      let nx, ny, d;
      if (d2 < 1e-12) { nx = 1; ny = 0; d = 0; } else { d = Math.sqrt(d2); nx = dx / d; ny = dy / d; }
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; // closing speed along the normal
      if (rel > 0) {
        a.vx -= rel * nx; a.vy -= rel * ny;
        b.vx += rel * nx; b.vy += rel * ny;
        a.ch = CHARS[(rnd(s) * CHARS.length) | 0];
        s.collisions++;
      }
      const push = (D - d) / 2;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      a.x = Math.min(w, Math.max(0, a.x)); b.x = Math.min(w, Math.max(0, b.x));
      a.y = Math.min(H2, Math.max(0, a.y)); b.y = Math.min(H2, Math.max(0, b.y));
    }
  }
  // stamp the trail where each glyph now is
  const W = s.w, Hh = s.h;
  for (const q of p) {
    const cx = Math.min(W - 1, q.x | 0), cy = Math.min(Hh - 1, (q.y / 2) | 0);
    const i = cy * W + cx;
    tr[i] = TRAIL; s.tch[i] = q.ch; s.thue[i] = q.hue;
  }
}

function draw(s, params) {
  const g = params.glyphs, c = params.colours;
  g.fill(32);
  c.fill(0);
  const { w, h } = s;
  if (w === 0 || h === 0) return;
  const tr = s.trail;
  for (let i = 0; i < tr.length; i++) {
    const age = tr[i];
    if (age > 0) {
      g[i] = s.tch[i];
      c[i] = s.thue[i] * 4 + ((age + 2) / 3 | 0) - 1;
    }
  }
  for (const q of s.p) {
    const cx = Math.min(w - 1, q.x | 0), cy = Math.min(h - 1, (q.y / 2) | 0);
    g[cy * w + cx] = q.ch;
    c[cy * w + cx] = q.hue * 4 + 3;
  }
}

export default { id: 'swarm', kind: 'sim', init, step, draw };
