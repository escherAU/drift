// Experimental / cloth: a small curtain of springs and masses, pinned along its top edge in
// swags, pushed about by a gusting wind while a heavy ball swings through it. Nodes are drawn
// as crosses, links as box-drawing strokes; a link glows brighter the more it is stretched and
// a node the faster it moves, so a poke lights up as a ripple.
//
// kind 'sim' (fixed 1/30 s step). Units: x in columns, y in half-rows. Verlet integration with
// distance constraints (structural and shear links, relaxed ITER times a step), so it cannot
// blow up the way a stiff explicit spring can. Bounds are enforced, not hoped for: the speed of
// every node is limited to VMAX units per step, then every node is clamped into the box.
//   => kinetic energy <= nodes * (VMAX / dt)^2 / 2 and every position is on screen, always.
import { rnd, seedState, strokeGlyph } from './simrng.js';

const DT = 1 / 30;
const D = 4; // rest length of a structural link (4 columns, 2 rows)
const ITER = 8;
const GRAVITY = 70;
const DRAG = 0.992;
export const VMAX = 3;
const MAX_NX = 48, MAX_NY = 22;

function init(w, h, seed) {
  const W = w > 0 ? Math.floor(w) : 0, Hh = h > 0 ? Math.floor(h) : 0, H2 = Hh * 2;
  const s = {
    w: W, h: Hh, H2, rs: seedState(seed, 0x5be0cd19), steps: 0, nx: 0, ny: 0, n: 0,
    x: null, y: null, px: null, py: null, pin: null, la: null, lb: null, rest: null, nStruct: 0,
    ball: { x: W / 2, y: H2 / 2, r: 0 }, ph: [0, 0, 0, 0], maxStretch: 1,
  };
  s.ph = [rnd(s) * 6.28, rnd(s) * 6.28, rnd(s) * 6.28, rnd(s) * 6.28];
  if (W < 14 || Hh < 8) return s;
  const nx = Math.min(MAX_NX, Math.floor((W * 0.7) / D) + 1);
  const ny = Math.min(MAX_NY, Math.floor((H2 * 0.5) / D) + 1);
  if (nx < 3 || ny < 3) return s;
  s.nx = nx; s.ny = ny; s.n = nx * ny;
  s.x = new Float64Array(s.n); s.y = new Float64Array(s.n);
  s.px = new Float64Array(s.n); s.py = new Float64Array(s.n);
  s.pin = new Uint8Array(s.n);
  const x0 = (W - (nx - 1) * D) / 2, y0 = 1.5;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      s.x[k] = s.px[k] = x0 + i * D;
      s.y[k] = s.py[k] = y0 + j * D;
    }
  }
  for (let i = 0; i < nx; i++) if (i % 3 === 0 || i === nx - 1) s.pin[i] = 1;
  const la = [], lb = [], rest = [];
  const link = (a, b, r) => { la.push(a); lb.push(b); rest.push(r); };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (i + 1 < nx) link(j * nx + i, j * nx + i + 1, D);
      if (j + 1 < ny) link(j * nx + i, (j + 1) * nx + i, D);
    }
  }
  s.nStruct = la.length;
  const dg = D * Math.SQRT2;
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      link(j * nx + i, (j + 1) * nx + i + 1, dg);
      link(j * nx + i + 1, (j + 1) * nx + i, dg);
    }
  }
  s.la = Int32Array.from(la); s.lb = Int32Array.from(lb); s.rest = Float64Array.from(rest);
  s.ball.r = Math.max(2.5, Math.min(7, H2 * 0.08));
  moveBall(s);
  return s;
}

function moveBall(s) {
  const t = s.steps;
  s.ball.x = s.w / 2 + s.w * 0.36 * Math.sin(0.021 * t + s.ph[0]);
  s.ball.y = s.H2 * 0.5 + s.H2 * 0.3 * Math.sin(0.033 * t + s.ph[1]);
}

function step(s) {
  if (s.n === 0) return;
  s.steps++;
  const { n, x, y, px, py, pin, la, lb, rest, w, H2 } = s;
  const wind = 26 * Math.sin(0.019 * s.steps + s.ph[2]) + 14 * Math.sin(0.05 * s.steps + s.ph[3]);
  const gx = wind * DT * DT, gy = GRAVITY * DT * DT;
  for (let k = 0; k < n; k++) {
    if (pin[k]) continue;
    const vx = (x[k] - px[k]) * DRAG, vy = (y[k] - py[k]) * DRAG;
    px[k] = x[k]; py[k] = y[k];
    x[k] += vx + gx; y[k] += vy + gy;
  }
  moveBall(s);
  const b = s.ball, br = b.r + 0.4;
  for (let it = 0; it < ITER; it++) {
    for (let l = 0; l < la.length; l++) {
      const a = la[l], c = lb[l];
      const dx = x[c] - x[a], dy = y[c] - y[a];
      const d = Math.hypot(dx, dy);
      if (d === 0) continue;
      const diff = (d - rest[l]) / d;
      const pa = pin[a], pc = pin[c];
      if (pa && pc) continue;
      const fa = pa ? 0 : pc ? 1 : 0.5, fc = pc ? 0 : pa ? 1 : 0.5;
      x[a] += dx * diff * fa; y[a] += dy * diff * fa;
      x[c] -= dx * diff * fc; y[c] -= dy * diff * fc;
    }
    // the ball pushes nodes out of itself (isotropic distance)
    for (let k = 0; k < n; k++) {
      if (pin[k]) continue;
      const dx = x[k] - b.x, dy = y[k] - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < br * br) {
        const d = Math.sqrt(d2);
        if (d > 1e-9) { x[k] = b.x + (dx / d) * br; y[k] = b.y + (dy / d) * br; } else { x[k] = b.x; y[k] = b.y - br; }
      }
    }
  }
  // enforce the bounds: speed limit, then the box
  const hiX = w - 1e-6, hiY = H2 - 1e-6;
  for (let k = 0; k < n; k++) {
    if (pin[k]) { x[k] = px[k]; y[k] = py[k]; continue; }
    let dx = x[k] - px[k], dy = y[k] - py[k];
    const sp = Math.hypot(dx, dy);
    if (sp > VMAX) { dx *= VMAX / sp; dy *= VMAX / sp; }
    x[k] = Math.min(hiX, Math.max(0, px[k] + dx));
    y[k] = Math.min(hiY, Math.max(0, py[k] + dy));
  }
}

function put(s, g, c, x, y, ch, level, force) {
  const cx = Math.floor(x), cy = Math.floor(y / 2);
  if (cx < 0 || cx >= s.w || cy < 0 || cy >= s.h) return;
  const i = cy * s.w + cx;
  if (!force && g[i] !== 32 && c[i] > level) return;
  g[i] = ch;
  c[i] = level;
}

function draw(s, params) {
  const g = params.glyphs, c = params.colours;
  g.fill(32);
  c.fill(0);
  if (s.n === 0) return;
  const { x, y, px, py, pin, la, lb, rest, nStruct } = s;
  for (let l = 0; l < nStruct; l++) {
    const a = la[l], b = lb[l];
    const dx = x[b] - x[a], dy = y[b] - y[a];
    const ratio = Math.hypot(dx, dy) / rest[l];
    const lvl = 5 + Math.max(0, Math.min(10, Math.floor((ratio - 1) * 40)));
    const ch = strokeGlyph(dx, dy);
    put(s, g, c, x[a] + dx / 3, y[a] + dy / 3, ch, lvl, false);
    put(s, g, c, x[a] + (2 * dx) / 3, y[a] + (2 * dy) / 3, ch, lvl, false);
  }
  for (let k = 0; k < s.n; k++) {
    if (pin[k]) { put(s, g, c, x[k], y[k], 0x2564, 15, true); continue; }
    const sp = Math.hypot(x[k] - px[k], y[k] - py[k]);
    put(s, g, c, x[k], y[k], 0x253c, 6 + Math.min(9, Math.floor(sp * 6)), true);
  }
  const bl = s.ball;
  const R = bl.r;
  for (let cy = Math.max(0, Math.floor((bl.y - R) / 2)); cy <= Math.min(s.h - 1, Math.ceil((bl.y + R) / 2)); cy++) {
    for (let cx = Math.max(0, Math.floor(bl.x - R)); cx <= Math.min(s.w - 1, Math.ceil(bl.x + R)); cx++) {
      const dx = cx + 0.5 - bl.x, dy = (cy + 0.5) * 2 - bl.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > R) continue;
      const i = cy * s.w + cx;
      g[i] = d < R * 0.55 ? 0x25cf : 0x25cb;
      c[i] = 15;
    }
  }
}

export default { id: 'cloth', kind: 'sim', init, step, draw };
