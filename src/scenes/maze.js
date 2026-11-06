// High contrast / maze: a maze carved live by a recursive backtracker (seeded), drawn with
// box-drawing walls as the carving grows, then solved from the top-left to the bottom-right
// in solid blocks, held for a few seconds, wiped away from left to right, and regenerated.
//
// Layout: every maze cell is one screen cell, centred in a (2*cw+1) by (2*ch+1) character
// grid. Odd/odd positions are cells, odd/even and even/odd positions are the wall pieces (or
// passages) between them, even/even are posts. Posts pick the box-drawing glyph that joins
// the wall pieces around them. The solution is drawn as ONE block per path cell and one per
// passage between consecutive path cells, so a solved path of n cells has 2n-1 blocks.
//
// Strictly two-tone: colour index 0 only. kind 'sim': step at 1/30 s; draw never mutates.
//   carve (about 9 s) -> solve (4 s) -> hold (5 s) -> erase (2.4 s) -> next maze

const HOLD_STEPS = 150;
const CARVE_STEPS = 270;
const SOLVE_STEPS = 120;
const ERASE_STEPS = 72;

function rnd(s) {
  let a = (s.rs = (s.rs + 0x6d2b79f5) | 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Recursive backtracker over a cw by ch grid, from cell 0. Returns
//   { cw, ch, n, edges: [[parent, child]...] (n-1 of them, in carve order),
//     order: cells in the order first reached, rank: cell -> index in order,
//     openR[c]: passage between c and c+1, openD[c]: passage between c and c+cw,
//     parent: cell -> the cell it was carved from (-1 for cell 0) }
export function generateMaze(cw, ch, seed) {
  const CW = cw > 0 ? Math.floor(cw) : 0, CH = ch > 0 ? Math.floor(ch) : 0;
  const n = CW * CH;
  const m = {
    cw: CW, ch: CH, n, edges: [], order: [], rank: new Int32Array(n), parent: new Int32Array(n).fill(-1),
    openR: new Uint8Array(n), openD: new Uint8Array(n),
  };
  if (n === 0) return m;
  const rs = { rs: (seed | 0) ^ 0x9e3779b9 };
  const seen = new Uint8Array(n);
  const stack = [0];
  const nb = [0, 0, 0, 0];
  seen[0] = 1;
  m.order.push(0);
  while (stack.length) {
    const c = stack[stack.length - 1], x = c % CW, y = (c / CW) | 0;
    let k = 0;
    if (x > 0 && !seen[c - 1]) nb[k++] = c - 1;
    if (x < CW - 1 && !seen[c + 1]) nb[k++] = c + 1;
    if (y > 0 && !seen[c - CW]) nb[k++] = c - CW;
    if (y < CH - 1 && !seen[c + CW]) nb[k++] = c + CW;
    if (k === 0) { stack.pop(); continue; }
    const d = nb[Math.floor(rnd(rs) * k)];
    seen[d] = 1;
    m.rank[d] = m.order.length;
    m.order.push(d);
    m.parent[d] = c;
    m.edges.push([c, d]);
    const lo = c < d ? c : d;
    if (((c / CW) | 0) === ((d / CW) | 0)) m.openR[lo] = 1; else m.openD[lo] = 1;
    stack.push(d);
  }
  return m;
}

function pathOf(m) {
  if (m.n === 0) return [];
  const p = [];
  for (let c = m.n - 1; c >= 0; c = m.parent[c]) p.push(c);
  return p.reverse();
}

function mazeSeed(seed, cycle) {
  return Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(cycle + 1, 0x85ebca6b);
}

function startMaze(s) {
  s.maze = generateMaze(s.cw, s.ch, mazeSeed(s.seed, s.cycle));
  s.path = pathOf(s.maze);
  s.phase = 'carve';
  s.carved = 0;
  s.shown = 0;
  s.hold = 0;
  s.eraseX = 0;
  s.carveRate = Math.max(1, Math.ceil(s.maze.n / CARVE_STEPS));
  s.solveRate = Math.max(1, Math.ceil(s.path.length / SOLVE_STEPS));
}

function init(w, h, seed) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const cw = Math.max(0, Math.floor((W - 1) / 2)), ch = Math.max(0, Math.floor((H - 1) / 2));
  const GW = 2 * cw + 1, GH = 2 * ch + 1;
  const s = {
    w: W, h: H, cw, ch, seed: seed | 0, cycle: 0,
    ox: Math.floor((W - GW) / 2), oy: Math.floor((H - GH) / 2),
    marks: new Uint8Array(cw > 0 && ch > 0 ? GW * GH : 0),
    eraseRate: Math.max(1, Math.ceil(W / ERASE_STEPS)),
    maze: null, path: [], phase: 'carve', carved: 0, shown: 0, hold: 0, eraseX: 0, carveRate: 1, solveRate: 1,
  };
  startMaze(s);
  return s;
}

function step(s) {
  const n = s.maze.n;
  if (n === 0) return;
  if (s.phase === 'carve') {
    s.carved = Math.min(n, s.carved + s.carveRate);
    if (s.carved >= n) { s.phase = 'solve'; s.shown = 0; }
  } else if (s.phase === 'solve') {
    s.shown = Math.min(s.path.length, s.shown + s.solveRate);
    if (s.shown >= s.path.length) { s.phase = 'hold'; s.hold = 0; }
  } else if (s.phase === 'hold') {
    if (++s.hold >= HOLD_STEPS) { s.phase = 'erase'; s.eraseX = 0; }
  } else {
    s.eraseX += s.eraseRate;
    if (s.eraseX >= s.w) { s.cycle++; startMaze(s); }
  }
}

// post glyph by neighbours: up = 1, right = 2, down = 4, left = 8
const POST = [32, 0x2575, 0x2576, 0x2514, 0x2577, 0x2502, 0x250c, 0x251c, 0x2574, 0x2518, 0x2500, 0x2534, 0x2510, 0x2524, 0x252c, 0x253c];
const VERT = 1, HORIZ = 2; // wall piece marks

function draw(s, params) {
  const g = params.glyphs, c = params.colours;
  g.fill(32);
  c.fill(0);
  const m = s.maze, n = m.n;
  if (n === 0) return;
  const { cw, ch, w: W, ox, oy, marks } = s;
  const GW = 2 * cw + 1, GH = 2 * ch + 1;
  const { rank, openR, openD } = m;
  const lim = s.phase === 'carve' ? s.carved : n; // cells with rank below lim are carved
  marks.fill(0);
  // vertical pieces at (2i, 2j+1): between cell (i-1, j) and (i, j)
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i <= cw; i++) {
      const L = i > 0 ? j * cw + i - 1 : -1, R = i < cw ? j * cw + i : -1;
      const seenL = L >= 0 && rank[L] < lim, seenR = R >= 0 && rank[R] < lim;
      if (!seenL && !seenR) continue;
      if (L >= 0 && R >= 0 && openR[L] && seenL && seenR) continue; // a passage
      if ((i === 0 && j === 0) || (i === cw && j === ch - 1)) continue; // entrance and exit
      marks[(2 * j + 1) * GW + 2 * i] = VERT;
    }
  }
  // horizontal pieces at (2i+1, 2j): between cell (i, j-1) and (i, j)
  for (let j = 0; j <= ch; j++) {
    for (let i = 0; i < cw; i++) {
      const U = j > 0 ? (j - 1) * cw + i : -1, D = j < ch ? j * cw + i : -1;
      const seenU = U >= 0 && rank[U] < lim, seenD = D >= 0 && rank[D] < lim;
      if (!seenU && !seenD) continue;
      if (U >= 0 && D >= 0 && openD[U] && seenU && seenD) continue;
      marks[2 * j * GW + 2 * i + 1] = HORIZ;
    }
  }
  for (let Y = 0; Y < GH; Y++) {
    const row = (oy + Y) * W + ox;
    for (let X = 0; X < GW; X++) {
      const mk = marks[Y * GW + X];
      if ((X & 1) !== (Y & 1)) { if (mk) g[row + X] = mk === VERT ? 0x2502 : 0x2500; continue; }
      if (X & 1) continue; // a cell: blank for now
      let mask = 0;
      if (Y > 0 && marks[(Y - 1) * GW + X]) mask |= 1;
      if (X < GW - 1 && marks[Y * GW + X + 1]) mask |= 2;
      if (Y < GH - 1 && marks[(Y + 1) * GW + X]) mask |= 4;
      if (X > 0 && marks[Y * GW + X - 1]) mask |= 8;
      g[row + X] = POST[mask];
    }
  }
  const cellAt = (cell) => (oy + 2 * ((cell / cw) | 0) + 1) * W + ox + 2 * (cell % cw) + 1;
  if (s.phase === 'carve') {
    if (s.carved > 0 && s.carved < n) g[cellAt(m.order[s.carved - 1])] = 0x2588; // the digger
  } else if (s.phase !== 'carve') {
    const p = s.path;
    for (let i = 0; i < s.shown; i++) {
      g[cellAt(p[i])] = 0x2588;
      if (i > 0) {
        const a = p[i - 1], b = p[i];
        g[cellAt(a) + (cellAt(b) - cellAt(a)) / 2] = 0x2588; // the passage between them
      }
    }
  }
  if (s.phase === 'erase') {
    const x1 = Math.min(W, s.eraseX);
    for (let y = 0; y < s.h; y++) g.fill(32, y * W, y * W + x1);
  }
}

export default { id: 'maze', kind: 'sim', init, step, draw };
