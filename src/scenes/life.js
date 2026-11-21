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
//
// DRIFT-10, the flash rules. The board (s.cells) is the simulation; what is DRAWN is s.shown, which follows the board with a limit: a cell
// (its two half-blocks together) may change on the screen at most once every FLIP_GAP steps (0.6 s). So no cell can change three times in
// any one second, which is what the meter calls hot on the in-house rule L2 (and seven times, L1), whatever the pattern: blinkers, the pulsar and the
// chaos of a methuselah all shimmer slowly instead of strobing, while a glider, whose cells each change a few times as it passes, still reads as
// a glider (a pixel or two late). A cell that wants to change sooner waits, then takes whatever the board shows at that moment. The scene also
// asks the composer for the real-time clock (realClock, src/cells.js): the speed keys do not make it step faster than 10 generations a real
// second, so the limit above is a limit per real second at 4x too.

const SUBSTEPS = 3; // sim steps per generation
const RING = 24; // remember this many recent boards to spot short cycles
const IDLE_GENS = 30; // dead or cycling for this long (3 s) -> reseed
const MAX_AGE = 2400; // generations (4 min) before a refresh regardless
// A drawn cell may change at most once in FLIP_GAP steps. Three changes then take 2 * FLIP_GAP = 1.2 s at the least; the meter's second is 17 frame
// intervals (0.94 s at 18 fps) and a change is painted up to one frame (and a late timer's 16 ms) after it is made, so 1.2 s leaves a margin of more than 0.1 s.
const FLIP_GAP = 18;
// ... and at most this share of the cells may change on the screen in one step (1/30 s), so a reseed that drops a pulsar on a small board arrives over a few steps instead of in one
// frame, where it would be more than the 30 % of the screen the step rule (L3) allows. At 80x24 that is 153 cells a step.
export const FLIP_SHARE = 0.08;
// ... and at most this share of the cells may change between two PAINTED frames, which is what the viewer sees and what L3 meters. A frame holds as many steps as the time since the last
// paint covers: one at --fps 30, three at 18, four to six at 8 to 12 (the composer steps from a time accumulator and hands step() the count, step(s, n)). So the frame's share is split
// over its steps, floor(cells * FRAME_SHARE / n) each (never more than FLIP_SHARE, at least one cell so that nothing waiting is stuck for ever): a paint then changes at most
// FRAME_SHARE of the cells however many steps it holds. Why 0.15, half of the 30 % L3 allows: the viewer reads the screen on its own 18 Hz grid, and a timer that fires late (the Windows
// tick, 15.625 ms) followed by one on time puts TWO paints between two reads, at any --fps from 8 to 30 (the gap between paints is at least 1 / fps - 15.6 ms, over half the read
// interval). Two paints of 15 % are 30 %, the limit. (At 0.24, the cap that three 8 % steps made at 18 fps, q156 at --fps 10 still read 45 % on a 10x4 board.) The cap is not derived from
// MIN_FPS or the step rate: tests/life-frame-cap.test.js asserts it for every n up to MAX_STEPS (src/cells.js) and fails if the floor, the step rate or MAX_STEPS moves it out of reach.
export const FRAME_SHARE = 0.15;

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
    shown: new Uint8Array(n), lastFlip: new Int32Array(W * H).fill(-FLIP_GAP), dirty: false, visits: 0,
  };
  seedPatterns(s, patternCount(s));
  s.pop = count(s.cells);
  s.shown.set(s.cells); // the first picture is the board as it was seeded: nothing is waiting
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
  s.dirty = true; // the drawn picture may now be behind the board
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

// Brings the drawn picture up to the board, under the per-cell limit. Visits every cell of the visible grid once, only while something is waiting.
function follow(s, n) {
  if (!s.dirty) return;
  const { w, h, cells, shown, lastFlip, sub } = s;
  let waiting = false, budget = Math.max(1, Math.floor(w * h * Math.min(FLIP_SHARE, FRAME_SHARE / Math.max(1, n))));
  for (let r = 0; r < h; r++) {
    const y = (r + sub) % h; // a different row first each step, so what has to wait is not always the bottom of the screen
    if (budget === 0) { waiting = true; break; }
    s.visits += w;
    for (let x = 0; x < w; x++) {
      const top = 2 * y * w + x, bot = top + w;
      if (cells[top] === shown[top] && cells[bot] === shown[bot]) continue;
      const i = y * w + x;
      if (budget === 0 || sub - lastFlip[i] < FLIP_GAP) { waiting = true; continue; }
      budget--;
      lastFlip[i] = sub;
      shown[top] = cells[top];
      shown[bot] = cells[bot];
    }
  }
  s.dirty = waiting;
}

// n: the number of steps the composer runs for this painted frame (src/cells.js), 1 when the caller gives none (renderScene, a test)
function step(s, n = 1) {
  s.sub++;
  if (s.w === 0 || s.H2 === 0) return;
  if (s.sub % SUBSTEPS === 0) generation(s);
  follow(s, n);
}

function draw(s, params) {
  const g = params.glyphs, c = params.colours;
  g.fill(32);
  c.fill(0);
  const { w, h } = s, cells = s.shown;
  for (let y = 0; y < h; y++) {
    const top = 2 * y * w, bot = top + w;
    for (let x = 0; x < w; x++) {
      const a = cells[top + x], b = cells[bot + x];
      if (a || b) g[y * w + x] = a && b ? 0x2588 : a ? 0x2580 : 0x2584;
    }
  }
}

export default { id: 'life', kind: 'sim', realClock: true, init, step, draw };
