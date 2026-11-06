// Experimental / bounce: balls with gravity and friction, drawn with round glyphs.
// A fixed-step sim (1/30 s). Units: x in columns, y in half-rows (a cell is 1 wide and
// 2 tall, so the physics is isotropic); the box is w by 2h.
//
// Energy per ball (per unit mass) is v^2/2 + g * height above the floor. Bounces lose
// energy (restitution < 1, air drag), and a ball that has settled gets a kick, but never
// more than the launch energy, so the total is bounded by BALLS * EMAX at all times.
// Colour index = brightness level 6..15 of the single-hue calm palette.

const DT = 1 / 30;
const E_REST = 0.82; // floor and ceiling restitution
const W_REST = 0.9; // wall restitution
const DRAG = 0.04; // air drag per second
const FLOOR_FRICTION = 0.97; // horizontal speed kept on each floor bounce
const SETTLE_E = 0.06; // a ball under this fraction of EMAX is kicked

function rnd(s) {
  let a = (s.rs = (s.rs + 0x6d2b79f5) | 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function energy(s, b) {
  return 0.5 * (b.vx * b.vx + b.vy * b.vy) + s.g * (s.H2 - b.r - b.y); // y grows downward
}

function kick(s, b) {
  const sp = Math.sqrt(2 * s.g * s.H2 * (0.35 + 0.5 * rnd(s)));
  b.vy = -sp;
  b.vx = (rnd(s) - 0.5) * 2 * Math.sqrt(s.g * s.H2) * 0.8;
}

function init(w, h, seed) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const H2 = H * 2;
  const s = { w: W, h: H, H2, rs: (seed | 0) ^ 0x7f4a7c15, balls: [], g: Math.max(1, H2 * 1.3), emax: 0, steps: 0 };
  s.emax = s.g * s.H2 + 0.5 * (s.g * s.H2) * 0.64; // launch kinetic + potential, with the horizontal kick
  const n = W === 0 || H === 0 ? 0 : Math.max(3, Math.min(14, Math.round((W * H) / 380)));
  for (let i = 0; i < n; i++) {
    const r = 1 + Math.floor(rnd(s) * 3) * 0.9 + (Math.min(W, H2) > 30 ? 0.8 : 0); // radius in columns
    const b = { r, x: r + rnd(s) * Math.max(0, W - 2 * r), y: r + rnd(s) * Math.max(0, H2 * 0.6 - r), vx: (rnd(s) - 0.5) * W * 0.6, vy: 0, lvl: 6 + (i % 10) };
    s.balls.push(b);
  }
  return s;
}

function step(s) {
  if (s.balls.length === 0) return;
  s.steps++;
  const { w, H2, g } = s;
  const drag = 1 - DRAG * DT;
  for (const b of s.balls) {
    b.vy += g * DT;
    b.vx *= drag; b.vy *= drag;
    b.x += b.vx * DT; b.y += b.vy * DT;
    if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * W_REST; }
    else if (b.x > w - b.r) { b.x = w - b.r; b.vx = -Math.abs(b.vx) * W_REST; }
    if (b.y > H2 - b.r) { b.y = H2 - b.r; b.vy = -Math.abs(b.vy) * E_REST; b.vx *= FLOOR_FRICTION; }
    else if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * E_REST; }
  }
  // equal-mass elastic collisions (isotropic space)
  const n = s.balls.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = s.balls[i], b = s.balls[j];
      const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel > 0) {
        a.vx -= rel * nx; a.vy -= rel * ny;
        b.vx += rel * nx; b.vy += rel * ny;
      }
      const push = (min - d) / 2;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      a.x = Math.min(w - a.r, Math.max(a.r, a.x)); b.x = Math.min(w - b.r, Math.max(b.r, b.x));
      a.y = Math.min(H2 - a.r, Math.max(a.r, a.y)); b.y = Math.min(H2 - b.r, Math.max(b.r, b.y));
    }
  }
  // keep the system alive and bounded
  for (const b of s.balls) {
    const e = energy(s, b);
    if (e < s.emax * SETTLE_E && Math.abs(b.vy) < s.g * 0.15 && b.y > H2 - b.r - 0.5) kick(s, b);
    const e2 = energy(s, b);
    if (e2 > s.emax) {
      // scale only the kinetic part so that kinetic + potential lands exactly on the bound
      const ke = 0.5 * (b.vx * b.vx + b.vy * b.vy), pe = e2 - ke;
      const f = ke > 0 ? Math.sqrt(Math.max(0, s.emax - pe) / ke) : 0;
      b.vx *= f; b.vy *= f;
    }
  }
}

function draw(s, params) {
  const g = params.glyphs, c = params.colours;
  g.fill(32);
  c.fill(0);
  const { w, h } = s;
  for (const b of s.balls) {
    const R = b.r;
    const x0 = Math.max(0, Math.floor(b.x - R)), x1 = Math.min(w - 1, Math.ceil(b.x + R));
    const y0 = Math.max(0, Math.floor((b.y - R) / 2)), y1 = Math.min(h - 1, Math.ceil((b.y + R) / 2));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - b.x, dy = (y + 0.5) * 2 - b.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > R) continue;
        const i = y * w + x;
        // core filled, rim half-moon facing the direction of travel
        const ch = d < R * 0.55 ? 0x25cf : (b.vx >= 0 ? (dx >= 0 ? 0x25d1 : 0x25cb) : (dx <= 0 ? 0x25d0 : 0x25cb));
        g[i] = ch;
        c[i] = b.lvl;
      }
    }
  }
}

export default { id: 'bounce', kind: 'sim', init, step, draw };
