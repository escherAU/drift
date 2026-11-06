// Chaos / fireworks: rockets climb, burst into rings of radial glyphs in several hues, and the
// sparks fall under gravity while they fade. Particles are capped (MAX_PARTICLES) and bursts
// are always short-lived, so the sim never runs away and never goes quiet.
//
// kind 'sim' (fixed 1/30 s step). Units: x in columns, y in half-rows (isotropic), y grows
// downward; the box is [0, w] by [0, 2h]. Colour index = hue * 4 + brightness level.

const DT = 1 / 30;
export const MAX_PARTICLES = 700;

// radial glyphs (* + x . o) plus maths, Greek and geometric shapes from the allow-list
const BURST = [
  0x2a, 0x2b, 0x78, 0x2e, 0x6f, 0x2a, 0x2b, 0x78, // * + x . o ...
  0xd7, 0xb1, 0xb0, 0x3b1, 0x3b2, 0x3b4, 0x3bb, 0x3c0, 0x3a3, 0x3a9,
  0x221e, 0x2248, 0x222b, 0x25c6, 0x25cb, 0x25cf, 0x25b2,
];

function rnd(s) {
  let a = (s.rs = (s.rs + 0x6d2b79f5) | 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Brightness level 0..3 from the life left; never rises as life falls.
export function particleLevel(p) {
  const f = p.life / p.max;
  return f > 0.6 ? 3 : f > 0.35 ? 2 : f > 0.15 ? 1 : 0;
}

function init(w, h, seed) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const s = {
    w: W, h: H, H2: H * 2, rs: (seed | 0) ^ 0x2f6b1a93, g: Math.max(6, H * 2 * 0.8),
    rockets: [], particles: [], launchIn: 5, launched: 0, bursts: 0, steps: 0,
  };
  return s;
}

function launch(s) {
  const top = s.H2 * (0.12 + 0.35 * rnd(s)); // burst height (half-rows from the top)
  const rise = s.H2 - top;
  s.rockets.push({
    x: s.w * (0.1 + 0.8 * rnd(s)), y: s.H2, vx: (rnd(s) - 0.5) * s.w * 0.04,
    vy: -Math.sqrt(2 * s.g * rise), hue: (rnd(s) * 8) | 0,
  });
  s.launched++;
}

function burst(s, r) {
  s.bursts++;
  const room = MAX_PARTICLES - s.particles.length;
  const n = Math.min(room, 28 + ((rnd(s) * 24) | 0));
  const scale = Math.min(1.8, Math.max(0.6, s.H2 / 80));
  const hue2 = (r.hue + 1 + ((rnd(s) * 7) | 0)) & 7;
  const ringGlyph = BURST[(rnd(s) * BURST.length) | 0];
  const rings = rnd(s) < 0.5; // two shells (inner slower) or one
  const phase = rnd(s) * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2 + (rnd(s) - 0.5) * 0.25;
    const sp = (rings && i % 2 ? 9 : 16 + 10 * rnd(s)) * scale;
    const max = 36 + ((rnd(s) * 24) | 0); // 1.2 to 2 s
    s.particles.push({
      x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: max, max,
      hue: i % 3 === 2 ? hue2 : r.hue, ch: i % 4 === 0 ? ringGlyph : BURST[(rnd(s) * BURST.length) | 0],
    });
  }
}

function step(s) {
  if (s.w === 0 || s.h === 0) return;
  s.steps++;
  const g = s.g;
  if (--s.launchIn <= 0) {
    launch(s);
    s.launchIn = 8 + ((rnd(s) * 18) | 0);
  }
  for (let i = s.rockets.length - 1; i >= 0; i--) {
    const r = s.rockets[i];
    r.vy += g * DT;
    r.x += r.vx * DT; r.y += r.vy * DT;
    if (r.vy >= -1.5) { // at the top of the climb
      s.rockets.splice(i, 1);
      burst(s, r);
    }
  }
  const drag = 0.985;
  const ps = s.particles;
  let o = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    p.vy += g * DT * 0.6;
    p.vx *= drag; p.vy *= drag;
    p.x += p.vx * DT; p.y += p.vy * DT;
    p.life--;
    if (p.life <= 0 || p.y > s.H2 + 4 || p.x < -4 || p.x > s.w + 4) continue;
    ps[o++] = p;
  }
  ps.length = o;
}

function draw(s, params) {
  const g = params.glyphs, c = params.colours;
  g.fill(32);
  c.fill(0);
  const { w, h } = s;
  if (w === 0 || h === 0) return;
  const put = (x, y, ch, col) => {
    const cx = Math.floor(x), cy = Math.floor(y / 2);
    if (cx < 0 || cx >= w || cy < 0 || cy >= h) return;
    g[cy * w + cx] = ch; c[cy * w + cx] = col;
  };
  for (const r of s.rockets) {
    put(r.x, r.y + 4, 0x7c, r.hue * 4 + 1); // short tail
    put(r.x, r.y + 2, 0x7c, r.hue * 4 + 2);
    put(r.x, r.y, 0x5e, r.hue * 4 + 3);
  }
  for (const p of s.particles) {
    const lv = particleLevel(p);
    const ch = lv === 0 ? 0x2e : lv === 1 ? 0xb7 : p.ch;
    put(p.x, p.y, ch, p.hue * 4 + lv);
  }
}

export default { id: 'fireworks', kind: 'sim', init, step, draw };
