// IV. Across the Reach: the Hollowmere Reach as a map. Parchment lines on the dark background, a scroll rod down each side, the
// cartouche on top. A dotted route is drawn from Lowmarrow to Highcandle, one dot every 0.3 s, with a gold marker at its head; at
// each of the four landmarks (Lowmarrow, Thornwell Wood, Hollowmere, Highcandle) the marker rests for 2 s and the place's label
// fades up from dim to the text colour over 0.5 s. Three cloud shadows drift one column per 1.5 s. Fog lies on the land ahead of the
// marker and thins away cell by cell as it comes; what the marker has passed stands one shade brighter. Every 90 s the route is
// taken up again over 5 s (the dots and the fog sweep back) and drawn afresh.
//
// The land (all of it original to Delza): Thornwell Wood in leaf-green triangles, the lake Hollowmere in wave marks, the village
// Lowmarrow in little houses, mountains in the north with a river running down to the lake, and Highcandle, a small castle with a
// gold diamond. A compass of arrows with N, S, E and W sits in the south-east corner.
//
// kind 'cells'. Pure in (t, w, h, seed): the seed moves the trees, the grain of the paper, the fog, the clouds and the order the
// fog thins in. Everything is a position in the map's own fractions, so 80x24 and 240x67 are the same map.
import { rand } from '../../../src/scenes/util.js';
import { canvas, clear, put, text, label } from '../lib/canvas.js';
import { sceneTime, seedOf } from '../lib/clock.js';
import { LEAF, MOSS, BARK, PARCH, GOLD, STONE, DIM } from '../lib/palette.js';

export const N_DOTS = 60, DOT_EVERY = 0.3, PAUSE = 2, START = 1, CYCLE = 90, RETURN = 5, CLOUD_STEP = 1.5, FOG_LEAD = 8, LABEL_FADE = 0.5;
export const TITLE = '◆═╡ THE HOLLOWMERE REACH ╞═◆';
export const LANDMARKS = Object.freeze(['Lowmarrow', 'Thornwell Wood', 'Hollowmere', 'Highcandle']);
const cp = (ch) => ch.codePointAt(0);

// ---- the map's frame of reference
export function layoutOf(w, h) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const iw = Math.max(0, W - 8), ih = Math.max(0, H - 2);
  const at = (fx, fy) => ({ x: 4 + Math.round(fx * (iw - 1)), y: 1 + Math.round(fy * (ih - 1)) });
  return { W, H, iw, ih, at, ok: iw >= 12 && ih >= 8 };
}

// Vertices of the route in map fractions; the landmarks are vertices 0, 2, 4 and 8.
const ROUTE = [[0.13, 0.82], [0.22, 0.8], [0.3, 0.71], [0.4, 0.78], [0.52, 0.8], [0.66, 0.74], [0.76, 0.58], [0.82, 0.47], [0.85, 0.4]];
const LM_VERTEX = [0, 2, 4, 8];

// The route as N_DOTS + 1 points evenly spaced along it (a row counts twice a column), the landmarks' dot indexes, and the times
// the marker arrives at and leaves each landmark.
export function routeOf(w, h) {
  const L = layoutOf(w, h);
  const pts = ROUTE.map(([fx, fy]) => L.at(fx, fy));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, 2 * (pts[i].y - pts[i - 1].y)));
  const total = cum[cum.length - 1];
  const dots = [];
  let seg = 1;
  for (let i = 0; i <= N_DOTS; i++) {
    const s = (total * i) / N_DOTS;
    while (seg < pts.length - 1 && cum[seg] < s) seg++;
    const span = cum[seg] - cum[seg - 1];
    const u = span > 0 ? (s - cum[seg - 1]) / span : 0;
    dots.push({ x: Math.round(pts[seg - 1].x + (pts[seg].x - pts[seg - 1].x) * u), y: Math.round(pts[seg - 1].y + (pts[seg].y - pts[seg - 1].y) * u) });
  }
  const ks = LM_VERTEX.map((v) => (total > 0 ? Math.round((N_DOTS * cum[v]) / total) : 0));
  const arrive = [START], leave = [START + PAUSE];
  for (let j = 1; j < ks.length; j++) {
    arrive.push(leave[j - 1] + (ks[j] - ks[j - 1]) * DOT_EVERY);
    leave.push(arrive[j] + PAUSE);
  }
  return { L, pts, dots, ks, arrive, leave, lm: LM_VERTEX.map((v) => pts[v]) };
}

// Where the marker is at time Tc (0 up to CYCLE): the index of the dot at its head (-1 before the route begins) and whether the
// route is being taken up again.
export function headAt(route, Tc) {
  if (Tc >= CYCLE - RETURN) return { n: Math.floor(N_DOTS * (1 - (Tc - (CYCLE - RETURN)) / RETURN)), back: true };
  if (Tc < START) return { n: -1, back: false };
  const { ks, arrive, leave } = route;
  if (Tc < leave[0]) return { n: 0, back: false };
  for (let j = 1; j < ks.length; j++) {
    if (Tc < arrive[j]) return { n: Math.min(ks[j], ks[j - 1] + Math.floor((Tc - leave[j - 1]) / DOT_EVERY + 1e-9)), back: false };
    if (Tc < leave[j]) return { n: ks[j], back: false };
  }
  return { n: ks[ks.length - 1], back: false };
}

// A label's colour `age` seconds after the marker reached its place: dim, then up to the text colour in LABEL_FADE.
export function labelColour(age) {
  if (!(age >= 0)) return DIM;
  if (age >= LABEL_FADE) return PARCH[3];
  return [DIM, PARCH[1], PARCH[2], PARCH[3]][Math.floor((age / LABEL_FADE) * 4)];
}

const CLOUD = [' ░░░░░░  ', '░░░░░░░░░░', ' ░░░░░░░░ '];
const CASTLE = ['  ◆  ', ' ▟█▙ ', '▐███▌'];
const HOUSES = ['■ ▪ ■', ' ▪ ■ '];
const COMPASS = ['  N  ', '  ↑  ', 'W←┼→E', '  ↓  ', '  S  '];

function reach(t, w, h, params) {
  const cv = canvas(params.glyphs, params.colours, w, h);
  clear(cv);
  const T = sceneTime(t, params);
  const S = seedOf(params);
  const R = routeOf(cv.w, cv.h);
  const L = R.L;
  const W = L.W, H = L.H;
  if (W === 0 || H === 0) return;

  // scroll rods and the paper's edge
  for (let y = 0; y < H; y++) {
    const end = y === 0 || y === H - 1;
    for (let k = 0; k < 3; k++) {
      put(cv, k, y, cp(end ? '▄█▄'[k] : '▐█▌'[k]), BARK[end ? 2 : 1]);
      put(cv, W - 3 + k, y, cp(end ? '▄█▄'[k] : '▐█▌'[k]), BARK[end ? 2 : 1]);
    }
  }
  if (!L.ok) return;
  const x0 = 4, x1 = W - 5, y0 = 1, y1 = H - 2;

  const Tc = T % CYCLE;
  const head = headAt(R, Tc);
  const fogX = R.dots[Math.max(0, head.n)].x;
  // a cell is explored once the marker, plus a little ragged lead of its own, has gone by it
  const explored = (x, y) => x <= fogX + 1 + Math.floor(rand(S + 77, x, y) * FOG_LEAD);
  const feat = (x, y, ch, fam, hi, lo) => put(cv, x, y, cp(ch), fam[explored(x, y) ? hi : lo]);

  // Thornwell Wood
  const F = L.at(0.3, 0.48), frx = 0.12 * L.iw, fry = 0.16 * L.ih;
  for (let y = Math.floor(F.y - fry); y <= Math.ceil(F.y + fry); y++) {
    for (let x = Math.floor(F.x - frx); x <= Math.ceil(F.x + frx); x++) {
      const dx = (x - F.x) / frx, dy = (y - F.y) / fry;
      if (dx * dx + dy * dy > 1 || (x + y) % 2 !== 0 || rand(S + 101, x, y) >= 0.62) continue;
      feat(x, y, '▲', LEAF, rand(S + 103, x, y) < 0.3 ? 2 : 1, 0);
    }
  }
  // Hollowmere
  const K = L.at(0.52, 0.58), lrx = 0.1 * L.iw, lry = 0.13 * L.ih;
  for (let y = Math.floor(K.y - lry); y <= Math.ceil(K.y + lry); y++) {
    for (let x = Math.floor(K.x - lrx); x <= Math.ceil(K.x + lrx); x++) {
      const dx = (x - K.x) / lrx, dy = (y - K.y) / lry;
      if (dx * dx + dy * dy <= 1 && (x + y) % 2 === 0) feat(x, y, '≈', STONE, 2, 0);
    }
  }
  // mountains in the north (wider ones on a big screen), and the river from the middle one down to the lake
  const wide = L.iw >= 140;
  const peak = wide ? ['  ▲  ', ' ▟█▙ ', '▟███▙'] : [' ▲ ', '▟█▙'];
  [[0.1, 0.2], [0.45, 0.17], [0.54, 0.2], [0.64, 0.16], [0.74, 0.19]].forEach(([fx, fy], i) => {
    const m = L.at(fx, fy);
    peak.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== ' ') feat(m.x - 1 + c, m.y + r, ch, ch === '▲' ? PARCH : STONE, 2, 0); }));
    if (i === 2) {
      const ya = m.y + peak.length, yb = Math.floor(K.y - lry) - 1;
      for (let y = ya; y <= yb; y++) {
        const u = (y - ya) / Math.max(1, yb - ya);
        const xa = m.x + 1, xb = K.x;
        const xr = Math.round(xa + (xb - xa) * u + Math.sin(u * 7) * 2);
        const xn = Math.round(xa + (xb - xa) * Math.min(1, u + 1 / Math.max(1, yb - ya)) + Math.sin(Math.min(1, u + 1 / Math.max(1, yb - ya)) * 7) * 2);
        feat(xr, y, xn < xr ? '╱' : xn > xr ? '╲' : (y & 1 ? '╱' : '╲'), STONE, 2, 0);
      }
    }
  });
  // Lowmarrow's houses, Highcandle's castle
  const lm = R.lm;
  HOUSES.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== ' ') feat(lm[0].x - 6 + c, lm[0].y - 2 + r, ch, BARK, 3, 1); }));
  CASTLE.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === ' ') return;
    const x = lm[3].x - 2 + c, y = lm[3].y - 5 + r;
    if (ch === '◆') feat(x, y, ch, GOLD, 3, 1); else feat(x, y, ch, STONE, 3, 1);
  }));

  // the paper's grain, then the fog and the cloud shadows (both only on bare paper)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (cv.g[i] !== 32) continue;
      const r = rand(S + 9, x, y);
      if (r < 0.025) put(cv, x, y, cp('·'), PARCH[0]);
      else if (!explored(x, y) && r < 0.2) put(cv, x, y, cp('░'), STONE[0]);
    }
  }
  const span = L.iw + 12;
  for (let k = 0; k < 3; k++) {
    const cx = ((Math.floor((k * span) / 3 + rand(S + 21, k, 0) * 12) + Math.floor(T / CLOUD_STEP)) % span) - 10 + x0;
    const cy = y0 + 2 + Math.floor(((k + 0.5) * (L.ih - 6)) / 3) + Math.floor(rand(S + 23, k, 0) * 3);
    CLOUD.forEach((row, r) => [...row].forEach((ch, c) => {
      const x = cx + c, y = cy + r;
      if (ch !== ' ' && x >= x0 && x <= x1 && y >= y0 && y <= y1 && cv.g[y * W + x] === 32) put(cv, x, y, cp('░'), MOSS[0]);
    }));
  }

  // the route: a dot per step, the marker at the head
  for (let i = 0; i < R.dots.length && i <= head.n; i++) {
    if (i === head.n && !head.back) put(cv, R.dots[i].x, R.dots[i].y, cp('●'), GOLD[3]);
    else put(cv, R.dots[i].x, R.dots[i].y, cp('·'), PARCH[2]);
  }

  // labels (Thornwell Wood and Hollowmere sit inside their own land)
  const place = [
    { x: lm[0].x - 4, y: lm[0].y + 1 },
    { x: F.x, y: F.y },
    { x: K.x, y: K.y },
    { x: lm[3].x, y: lm[3].y - 2 },
  ];
  LANDMARKS.forEach((name, j) => {
    const s = ` ${name} `;
    const col = Tc >= CYCLE - RETURN ? DIM : labelColour(Tc - R.arrive[j]);
    label(cv, place[j].x - Math.floor(s.length / 2), place[j].y, s, col);
  });

  // compass and cartouche
  COMPASS.forEach((row, r) => text(cv, x1 - 5, y1 - 4 + r, row, r === 2 ? PARCH[2] : DIM));
  label(cv, Math.floor((W - TITLE.length) / 2), 1, TITLE, GOLD[2]);
  label(cv, Math.floor((W - TITLE.length) / 2) + 3, 1, ' THE HOLLOWMERE REACH ', PARCH[3]);

  // the paper's edge, drawn last so nothing runs over it
  for (let x = 3; x <= W - 4; x++) { put(cv, x, 0, x === 3 ? cp('┌') : x === W - 4 ? cp('┐') : cp('─'), PARCH[0]); put(cv, x, H - 1, x === 3 ? cp('└') : x === W - 4 ? cp('┘') : cp('─'), PARCH[0]); }
  for (let y = 1; y < H - 1; y++) { put(cv, 3, y, cp('│'), PARCH[0]); put(cv, W - 4, y, cp('│'), PARCH[0]); }
}

reach.id = 'reach';
reach.kind = 'cells';
export default reach;
