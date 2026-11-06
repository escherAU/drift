// High contrast / life: Conway's Game of Life on a wrapping grid, two cells per text
// row (half blocks), strictly two-tone (colour index 0 only).
//
// Seeded from classic patterns (gliders, R-pentomino, acorn, pulsar, lightweight
// spaceship, B-heptomino), never from dense random soup. When the board dies out or
// settles into still lifes and short oscillators, a few new patterns are dropped on
// top of whatever is there (no blank-and-refill flash).
//
// kind 'sim': init(w, h, seed) -> state, step(state) at 1/30 s (one generation every 3rd
// step, so 10 generations per second), draw(state, params).

const SUBSTEPS = 3; // sim steps per generation
const RING = 24; // remember this many recent boards to spot short cycles
const IDLE_GENS = 30; // dead or cycling for this long (3 s) -> reseed
const MAX_AGE = 2400; // generations (4 min) before a refresh regardless

const PATTERNS = [
  ['.#.', '..#', '###'], // glider
  ['.#.', '..#', '###'], // (weighted: gliders are the most common)
  ['.##', '##.', '.#.'], // R-pentomino
  ['.#.....', '...#...', '##..###'], // acorn
  [
    '..###...###..', '.............', '#....#.#....#', '#....#.#....#', '#....#.#....#', '..###...###..',
    '.............', '..###...###..', '#....#.#....#', '#....#.#....#', '#....#.#....#', '.............', '..###...###..',
  ], // pulsar
  ['.#..#', '#....', '#...#', '####.'], // lightweight spaceship
  ['#.###', '#....', '...##', '.##.#', '#.#.#'], // B-heptomino-like methuselah (small, lively)
  ['##', '##'], // block (a still life to collide with)
  ['###'], // blinker
];

function rnd(s) {
  let a = (s.rs = (s.rs + 0x6d2b79f5) | 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function place(s, pat, x0, y0, rot, flip) {
  const ph = pat.length, pw = pat[0].length;
  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      if (pat[py][px] !== '#') continue;
      let x = flip ? pw - 1 - px : px, y = py;
      for (let r = 0; r < rot; r++) { const nx = -y, ny = x; x = nx; y = ny; } // rotate 90 degrees
      const gx = (((x0 + x) % s.w) + s.w) % s.w, gy = (((y0 + y) % s.H2) + s.H2) % s.H2;
      s.cells[gy * s.w + gx] = 1;
    }
  }
}

function seedPatterns(s, count) {
  if (s.w === 0 || s.H2 === 0) return;
  for (let i = 0; i < count; i++) {
    const pat = PATTERNS[Math.floor(rnd(s) * PATTERNS.length)];
    place(s, pat, Math.floor(rnd(s) * s.w), Math.floor(rnd(s) * s.H2), Math.floor(rnd(s) * 4), rnd(s) < 0.5);
  }
  s.ringN = 0;
  s.idle = 0;
  s.age = 0;
}

function patternCount(s) {
  return Math.max(2, Math.min(40, Math.round((s.w * s.H2) / 2200)));
}

function init(w, h, seed) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const n = W * H * 2;
  const s = {
    w: W, h: H, H2: H * 2,
    cells: new Uint8Array(n), next: new Uint8Array(n),
    rs: (seed | 0) ^ 0x9e3779b9, sub: 0, gen: 0, pop: 0,
    ring: new Uint32Array(RING), ringN: 0, idle: 0, age: 0, reseeds: 0,
  };
  seedPatterns(s, patternCount(s));
  s.pop = count(s.cells);
  return s;
}

function count(a) { let n = 0; for (let i = 0; i < a.length; i++) n += a[i]; return n; }

function hashCells(a) {
  let h = 0x811c9dc5;
  for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 0x01000193);
  return h >>> 0;
}

function generation(s) {
  const { w, H2, cells, next } = s;
  for (let y = 0; y < H2; y++) {
    const up = ((y + H2 - 1) % H2) * w, mid = y * w, dn = ((y + 1) % H2) * w;
    for (let x = 0; x < w; x++) {
      const l = x === 0 ? w - 1 : x - 1, r = x === w - 1 ? 0 : x + 1;
      const n = cells[up + l] + cells[up + x] + cells[up + r] + cells[mid + l] + cells[mid + r] + cells[dn + l] + cells[dn + x] + cells[dn + r];
      next[mid + x] = n === 3 || (n === 2 && cells[mid + x] === 1) ? 1 : 0;
    }
  }
  s.cells = next; s.next = cells;
  s.gen++; s.age++;
  s.pop = count(s.cells);
  const hsh = hashCells(s.cells);
  let seen = false;
  const have = Math.min(s.ringN, RING);
  for (let i = 0; i < have; i++) if (s.ring[i] === hsh) { seen = true; break; }
  s.ring[s.ringN % RING] = hsh;
  s.ringN++;
  s.idle = s.pop === 0 || seen ? s.idle + 1 : 0;
  if (s.idle >= IDLE_GENS || s.age >= MAX_AGE) {
    seedPatterns(s, patternCount(s));
    s.reseeds++;
    s.pop = count(s.cells);
  }
}

function step(s) {
  s.sub++;
  if (s.sub % SUBSTEPS !== 0 || s.w === 0 || s.H2 === 0) return;
  generation(s);
}

function draw(s, params) {
  const g = params.glyphs, c = params.colours;
  g.fill(32);
  c.fill(0);
  const { w, h, cells } = s;
  for (let y = 0; y < h; y++) {
    const top = 2 * y * w, bot = top + w;
    for (let x = 0; x < w; x++) {
      const a = cells[top + x], b = cells[bot + x];
      if (a || b) g[y * w + x] = a && b ? 0x2588 : a ? 0x2580 : 0x2584;
    }
  }
}

export default { id: 'life', kind: 'sim', init, step, draw };
