// Experimental / sand: a falling-sand sim. Moving emitters rain grains from the top edge;
// a grain falls straight (or leans with a slow wind), and a grain that lands slides down
// either side of what it sits on, so piles form slopes. Some cycles have fixed ramps or a
// sieve (a bar with gaps); the layout changes each time the box is cleared.
//
// kind 'sim' (fixed 1/30 s step), one grain per cell, cell resolution (w by h).
// Cell value: 0 empty, OBST (0x80) obstacle, else kind << 4 | level where level 1..15 is
// the brightness colour index and kind picks the glyph family.
//
// Conservation: `count` is the number of grains in the box. It changes only by `added`
// (spawns) and `removed` (the fade-out at the end of a cycle), both reported per step, and
// grains only ever move by swapping with an empty cell. When the box is full enough (or the
// emitters are blocked) the spawns stop and every grain dims a level at a time until it
// disappears, then the next layout starts: no flash, no cut.
import { rnd, seedState } from './simrng.js';

const OBST = 0x80;
const FILL = 0.5; // fraction of the box filled with grains that ends a cycle
const MAX_FILL_STEPS = 30 * 150;
const BLOCKED_STEPS = 60; // consecutive steps with every emitter blocked
const FADE_RATE = 0.09; // chance per step that a grain loses a level
const FADE_MAX = 30 * 12; // hard stop: whatever is left is cleared
const LAYOUTS = ['ramps', 'plain', 'sieve'];

// glyph families (rest) and airborne glyphs, by kind
const FAMILIES = [
  [0x2591, 0x2592, 0x2593, 0x2588], // shade blocks
  [0x28ff, 0x28f6, 0x28e4, 0x28b6, 0x2847, 0x28b8], // braille
  [0x25a0, 0x25c6, 0x25aa, 0x25a1, 0x25c7], // squares and diamonds
  [0x2211, 0x220f, 0x222b, 0x2248, 0x221e, 0x2202, 0x2261, 0x221a], // maths
];
const AIR = [0xb7, 0x2802, 0x25aa, 0x2e];

function placeBars(s) {
  const { w, h, cells } = s;
  if (w < 16 || h < 12) return;
  const nbars = Math.max(1, Math.min(3, Math.floor(w / 40) + 1));
  for (let b = 0; b < nbars; b++) {
    const dir = b % 2 === 0 ? 1 : -1;
    const len = Math.min(Math.floor(w * 0.22), 26);
    const x0 = Math.floor(w * (0.14 + (0.72 * (b + rnd(s) * 0.5)) / nbars));
    const y0 = Math.floor(h * (0.32 + 0.16 * b + 0.06 * rnd(s)));
    for (let k = 0; k < len; k++) {
      const x = x0 + k;
      const ya = y0 + (dir > 0 ? Math.floor(k / 2) : -Math.floor(k / 2));
      const yb = y0 + (dir > 0 ? Math.floor((k + 1) / 2) : -Math.floor((k + 1) / 2));
      for (const y of [ya, yb]) if (x >= 0 && x < w && y >= 2 && y < h - 2) cells[y * w + x] = OBST;
    }
  }
}

function placeSieve(s) {
  const { w, h, cells } = s;
  if (w < 12 || h < 10) return;
  const y = Math.floor(h * 0.5);
  const x0 = Math.floor(w * 0.12), x1 = Math.floor(w * 0.88);
  for (let x = x0; x < x1; x++) if ((x - x0) % 5 !== 2) cells[y * w + x] = OBST;
}

function layout(s) {
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i] === OBST) s.cells[i] = 0;
  s.layout = LAYOUTS[s.cycle % LAYOUTS.length];
  if (s.layout === 'ramps') placeBars(s);
  else if (s.layout === 'sieve') placeSieve(s);
}

function init(w, h, seed) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const n = W * H;
  const s = {
    w: W, h: H, rs: seedState(seed, 0x2b7e1516), cells: new Uint8Array(n), steps: 0,
    count: 0, added: 0, removed: 0, cap: Math.max(1, Math.floor(n * FILL)), phase: 0, phaseStep: 0,
    blocked: 0, cycle: 0, layout: 'plain', wind: 0, wph: 0, emitters: [],
  };
  if (n === 0) return s;
  s.wph = rnd(s) * 6.28;
  const ne = Math.max(1, Math.min(6, Math.round(W / 30)));
  for (let i = 0; i < ne; i++) {
    s.emitters.push({ ph: rnd(s) * 6.28, sp: 0.004 + rnd(s) * 0.008, amp: 0.3 + rnd(s) * 0.17, kind: i % 4 });
  }
  layout(s);
  return s;
}

function emitterX(s, e) {
  return Math.min(s.w - 1, Math.max(0, Math.floor(s.w * (0.5 + e.amp * Math.sin(e.ph + s.steps * e.sp)))));
}

function moveGrains(s) {
  const { w, h, cells } = s;
  const lean = s.wind;
  const aw = Math.abs(lean);
  const dirR = (s.steps & 1) === 0;
  for (let y = h - 2; y >= 0; y--) {
    const row = y * w;
    for (let k = 0; k < w; k++) {
      const x = dirR ? k : w - 1 - k;
      const i = row + x;
      const v = cells[i];
      if (v === 0 || v === OBST) continue;
      const below = i + w;
      if (cells[below] === 0) {
        // airborne: the wind may lean it one column
        if (aw > 0.05 && rnd(s) < aw * 0.7) {
          const dx = lean > 0 ? 1 : -1;
          const nx = x + dx;
          if (nx >= 0 && nx < w && cells[below + dx] === 0 && cells[i + dx] === 0) { cells[below + dx] = v; cells[i] = 0; continue; }
        }
        cells[below] = v; cells[i] = 0;
        continue;
      }
      // resting on something: slide down a slope
      if (rnd(s) < 0.9) {
        const a = rnd(s) < 0.5 ? -1 : 1;
        for (let q = 0; q < 2; q++) {
          const dx = q === 0 ? a : -a;
          const nx = x + dx;
          if (nx >= 0 && nx < w && cells[below + dx] === 0 && cells[i + dx] === 0) { cells[below + dx] = v; cells[i] = 0; break; }
        }
      }
    }
  }
}

function spawn(s) {
  const { w, cells } = s;
  let tried = 0, placed = 0;
  const band = Math.floor(s.steps / 10);
  for (let i = 0; i < s.emitters.length; i++) {
    const e = s.emitters[i];
    if (rnd(s) > 0.8) continue;
    tried++;
    const x = Math.min(w - 1, Math.max(0, emitterX(s, e) + (Math.floor(rnd(s) * 3) - 1)));
    if (cells[x] !== 0) continue;
    const level = 4 + ((band + e.kind * 3) % 12);
    cells[x] = (e.kind << 4) | level;
    placed++;
  }
  s.added = placed;
  s.count += placed;
  if (tried > 0 && placed === 0) s.blocked++; else if (placed > 0) s.blocked = 0;
}

function fade(s) {
  const { cells } = s;
  let removed = 0;
  const clearAll = s.phaseStep >= FADE_MAX;
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (v === 0 || v === OBST) continue;
    if (clearAll) { cells[i] = 0; removed++; continue; }
    if (rnd(s) < FADE_RATE) {
      if ((v & 15) <= 1) { cells[i] = 0; removed++; } else cells[i] = v - 1;
    }
  }
  s.removed = removed;
  s.count -= removed;
}

function step(s) {
  if (s.w === 0 || s.h === 0) return;
  s.steps++;
  s.added = 0; s.removed = 0;
  s.wind = 0.55 * Math.sin(s.steps * 0.013 + s.wph) + 0.25 * Math.sin(s.steps * 0.0047 + 1.3);
  moveGrains(s);
  s.phaseStep++;
  if (s.phase === 0) {
    spawn(s);
    if (s.count >= s.cap || s.phaseStep > MAX_FILL_STEPS || s.blocked > BLOCKED_STEPS) { s.phase = 1; s.phaseStep = 0; }
  } else {
    fade(s);
    if (s.count === 0) {
      s.cycle++;
      layout(s);
      s.phase = 0; s.phaseStep = 0; s.blocked = 0;
    }
  }
}

function draw(s, params) {
  const g = params.glyphs, c = params.colours;
  g.fill(32);
  c.fill(0);
  const { w, h, cells } = s;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = cells[i];
      if (v === 0) continue;
      if (v === OBST) { g[i] = 0x2501; c[i] = 8; continue; }
      const kind = v >> 4, lv = v & 15;
      c[i] = lv;
      if (y < h - 1 && cells[i + w] === 0) g[i] = AIR[kind];
      else {
        const fam = FAMILIES[kind];
        g[i] = fam[(x * 7 + y * 3 + lv) % fam.length];
      }
    }
  }
}

export default { id: 'sand', kind: 'sim', init, step, draw };
