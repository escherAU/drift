// Shared runner and size lists for Night Drive's size matrix (DRIFT-5).
//
// Why it exists: the older Night Drive suites run each scene at 120x40, 80x24 and a handful of breakpoints. A scene whose layout, floor or sim
// depends on the exact window size can hide a flash, a ramp jump, a wide glyph or a stray colour at the sizes in between (one column either side
// of a breakpoint, the blank floor, the console's own tiers). matrixRun() plays one scene ALONE through the real cell composer (seed 1,
// params {a:0,b:0,p:0}, t = k * speed / 18) and counts, over every frame:
//   worst/at     the largest share of cells that change between two frames, and when
//   ramp         cells that keep their glyph and move more than one shade step in the same colour family, or more than 28 L*
//   wide         lit cells whose glyph is wide or invisible
//   glyph        lit cells whose glyph is outside the allow-list
//   banned       lit cells with a banned glyph
//   blankCol     blank cells (glyph 32) with a colour other than 0
//   colour       lit cells with a colour outside 16..COUNT-1 (the fixed families; 0 to 15 is the hue ramp)
//   litMin/litMax fewest and most lit cells in a frame
//   throws       the exception text, if the scene threw (the run stops there)
// Sizes are DERIVED from each scene's exported LAYOUTS and MIN_W/MIN_H, so a breakpoint that moves moves the sizes with it; the asserts in
// breakpointsOf() make the test notice that the breakpoints are where the tests think they are.
import assert from 'node:assert/strict';
import { createCellComposer } from '../src/cells.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { FAMILIES, COUNT } from '../cartridges/night-drive/lib/palette.js';
import { isWide, isInvisible } from './helpers-width.js';
import { BANNED, LTAB, FPS } from './helpers-night-drive.js';
import { SHADE_STEP_LSTAR } from './helpers-flash.js';

export const SCENE_IDS = ['onramp', 'skyline', 'sundown', 'coast', 'redlight', 'diner', 'caller', 'overdrive'];
export const MODS = {};
for (const id of SCENE_IDS) MODS[id] = await import(`../cartridges/night-drive/scenes/${id}.js`);

// colour -> family number and shade index, as typed arrays (no per-cell Object.entries)
const FAM = new Int8Array(256).fill(-1), IDX = new Int8Array(256);
Object.values(FAMILIES).forEach((f, k) => f.forEach((c, j) => { FAM[c] = k; IDX[c] = j; }));

// glyph class cache: bit 1 computed, 2 wide or invisible, 4 outside the allow-list, 8 banned
const GCLS = new Uint8Array(65536);
const BAN = new Set(BANNED);
function classOf(g) {
  let v = GCLS[g];
  if (!v) { v = 1 | (isWide(g) || isInvisible(g) ? 2 : 0) | (isAllowedGlyph(g) ? 0 : 4) | (BAN.has(g) ? 8 : 0); GCLS[g] = v; }
  return v;
}

export function matrixRun(scene, w, h, speed, seconds) {
  const r = { worst: 0, at: 0, ramp: 0, firstRamp: null, wide: 0, glyph: 0, banned: 0, blankCol: 0, colour: 0, litMin: Infinity, litMax: 0, throws: null };
  try {
    const cc = createCellComposer({ scenes: [scene], cols: w, rows: h, seed: 1 });
    cc.resize(w, h); cc.reset(0);
    const n = w * h;
    const pg = new Uint16Array(n), pc = new Uint8Array(n);
    let have = false;
    const total = Math.ceil((seconds * FPS) / speed);
    for (let k = 0; k <= total; k++) {
      const t = (k * speed) / FPS;
      const f = cc.frame({ a: 0, b: 0, p: 0 }, t);
      const g = f.glyphs, c = f.shades;
      let lit = 0;
      for (let i = 0; i < n; i++) {
        const gi = g[i];
        if (gi === 32) { if (c[i] !== 0) r.blankCol++; continue; }
        lit++;
        const cls = classOf(gi);
        if (cls & 2) r.wide++;
        if (cls & 4) r.glyph++;
        if (cls & 8) r.banned++;
        if (c[i] < 16 || c[i] >= COUNT) r.colour++;
      }
      if (lit < r.litMin) r.litMin = lit;
      if (lit > r.litMax) r.litMax = lit;
      if (have) {
        let changed = 0;
        for (let i = 0; i < n; i++) {
          if (g[i] !== pg[i] || c[i] !== pc[i]) {
            changed++;
            if (g[i] !== 32 && g[i] === pg[i]) {
              const a = pc[i], b = c[i];
              if ((FAM[a] >= 0 && FAM[b] >= 0 && (FAM[a] !== FAM[b] || Math.abs(IDX[a] - IDX[b]) !== 1)) || Math.abs(LTAB[a] - LTAB[b]) > SHADE_STEP_LSTAR) {
                r.ramp++;
                if (!r.firstRamp) r.firstRamp = { t: +t.toFixed(2), from: a, to: b, x: i % w, y: (i / w) | 0 };
              }
            }
          }
        }
        const s = changed / n;
        if (s > r.worst) { r.worst = s; r.at = +t.toFixed(2); }
      }
      pg.set(g); pc.set(c); have = true;
    }
  } catch (e) {
    r.throws = String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ');
  }
  if (r.litMin === Infinity) r.litMin = 0;
  return r;
}

// ---- the runs each size gets: [speed, seconds]. The caller is held for 75 s on the tape, every other track for 90 s.
// 1x and 0.25x have shorter windows (the speeds 4, 3 and 2 always run the full tape length).
export const TAPE_SECONDS = (id) => (id === 'caller' ? 75 : 90);
export function runsFor(id, { shortSeconds1x = 45, shortSeconds025x = 20 } = {}) {
  const full = TAPE_SECONDS(id);
  return [[4, full], [3, full], [2, full], [1, Math.min(full, shortSeconds1x)], [0.25, shortSeconds025x]];
}

// ---- floors and breakpoints, derived from the scenes
// MIN_W/MIN_H are exported by skyline, coast, diner and caller; redlight (40x12) and overdrive (30x9) keep them as module constants, so they are
// literals here (the floor tests prove them: blank one below, lit at the floor). onramp and sundown draw at every size.
export const FLOORS = {
  onramp: null, sundown: null,
  skyline: [MODS.skyline.MIN_W, MODS.skyline.MIN_H],
  coast: [MODS.coast.MIN_W, MODS.coast.MIN_H],
  diner: [MODS.diner.MIN_W, MODS.diner.MIN_H],
  caller: [MODS.caller.MIN_W, MODS.caller.MIN_H],
  redlight: [40, 12],
  overdrive: [30, 9],
};

// Breakpoints of a scene: { corners: [[cols, rows]...] (both minimums above 0), rowsOnly: [rows...] (minCols 0, minRows above 0) }
export function breakpointsOf(id) {
  const L = MODS[id].LAYOUTS;
  assert.ok(Array.isArray(L) || Object.isFrozen(L), `${id} exports LAYOUTS`);
  assert.deepEqual([L[0].name, L[0].minCols, L[0].minRows], ['full', 100, 32], `${id}: the full layout starts at 100x32`);
  const corners = [], rowsOnly = [];
  for (const l of L) {
    if (l.minCols > 0 && l.minRows > 0) corners.push([l.minCols, l.minRows]);
    else if (l.minCols === 0 && l.minRows > 0) rowsOnly.push(l.minRows);
  }
  if (id === 'overdrive') {
    const mid = L.find((l) => l.name === 'mid');
    assert.deepEqual([mid.minCols, mid.minRows], [60, 18], 'overdrive: the mid layout starts at 60x18');
  }
  if (id === 'sundown') {
    const compact = L.find((l) => l.name === 'compact');
    assert.deepEqual([compact.minCols, compact.minRows], [0, 24], 'sundown: the compact layout is rows-only, from 24 rows');
    assert.deepEqual(rowsOnly, [24]);
  } else assert.deepEqual(rowsOnly, [], `${id}: no rows-only breakpoint`);
  return { corners, rowsOnly };
}

const around = (c, r) => { const out = []; for (const h of [r - 1, r, r + 1]) for (const w of [c - 1, c, c + 1]) out.push([w, h]); return out; };
export const CONSOLE_TIERS = [[89, 40], [88, 39], [79, 25], [78, 24], [41, 11], [40, 10]];
export const TINY = [[40, 12], [41, 11], [30, 10], [20, 6]];
export const COMMON = [[240, 67], [120, 40], [80, 24], [100, 67], [200, 32]];

// The size list for one scene: around each breakpoint, the floor and its three neighbours, the console tiers, tiny windows and the common big ones.
export function sizesFor(id) {
  const { corners, rowsOnly } = breakpointsOf(id);
  const out = [];
  for (const [c, r] of corners) out.push(...around(c, r));
  for (const r of rowsOnly) for (const c of [80, 41]) for (const h of [r - 1, r, r + 1]) out.push([c, h]);
  const fl = FLOORS[id];
  if (fl) { const [c, r] = fl; out.push([c, r], [c - 1, r], [c, r - 1], [c + 1, r + 1]); }
  out.push(...CONSOLE_TIERS, ...TINY, ...COMMON);
  const seen = new Set();
  return out.filter(([w, h]) => w > 0 && h > 0 && !seen.has(`${w}x${h}`) && seen.add(`${w}x${h}`));
}

// Is this size at or above the scene's floor? (onramp and sundown: always)
export const aboveFloor = (id, w, h) => { const f = FLOORS[id]; return !f || (w >= f[0] && h >= f[1]); };

export const pct = (x) => (x * 100).toFixed(2) + '%';

// ---- one scene across its whole size matrix. Returns { bad: [strings], rows: [strings], worst: {share, tag}, runs }.
// opts.skip(w, h, speed) -> true leaves a run out; opts.windows overrides the 1x and 0.25x windows.
export function matrixScene(id, opts = {}) {
  const scene = MODS[id].default;
  const out = { bad: [], rows: [], worst: { share: 0, tag: '' }, runs: 0 };
  for (const [w, h] of sizesFor(id)) {
    for (const [speed, seconds] of runsFor(id, opts.windows)) {
      if (opts.skip && opts.skip(w, h, speed)) continue;
      const r = matrixRun(scene, w, h, speed, seconds);
      out.runs++;
      const tag = `${id} ${w}x${h} ${speed}x ${seconds}s`;
      if (r.worst > out.worst.share) out.worst = { share: r.worst, tag };
      const why = [];
      if (r.throws) why.push(`threw ${r.throws}`);
      if (!(r.worst < 0.3)) why.push(`worst share ${pct(r.worst)} at ${r.at} s`);
      if (r.ramp) why.push(`${r.ramp} ramp violations, first ${JSON.stringify(r.firstRamp)}`);
      if (r.wide) why.push(`${r.wide} wide or invisible glyphs`);
      if (r.glyph) why.push(`${r.glyph} glyphs outside the allow-list`);
      if (r.banned) why.push(`${r.banned} banned glyphs`);
      if (r.blankCol) why.push(`${r.blankCol} blank cells with a colour`);
      if (r.colour) why.push(`${r.colour} lit cells with a colour outside 16..${COUNT - 1}`);
      if (aboveFloor(id, w, h)) { if (!(r.litMin > 0)) why.push(`a frame with no lit cell at or above the floor (litMin ${r.litMin})`); }
      else if (r.litMax !== 0) why.push(`lit cells below the floor (litMax ${r.litMax})`);
      if (why.length) out.bad.push(`${tag}: ${why.join('; ')}`);
    }
  }
  return out;
}

// ---- planted scenes: each breaks exactly one rule, so the runner can be shown to bite. All are cells scenes (t, w, h, params).
const parity = (t) => Math.round(t * FPS) % 2;
export const PLANTED = {
  // every other cell changes glyph every frame: 50% of cells change
  flip: (t, w, h, p) => { const o = parity(t); for (let i = 0; i < w * h; i++) { const on = (i + o) % 2 === 0; p.glyphs[i] = on ? 0x2588 : 0x2591; p.colours[i] = FAMILIES.mag[2]; } },
  // a CJK ideograph
  wide: (t, w, h, p) => { p.glyphs.fill(32); p.colours.fill(0); p.glyphs[3] = 0x4e16; p.colours[3] = 30; },
  // one cell: same glyph, shade 3 then shade 0 of the same family in the next frame
  ramp: (t, w, h, p) => { p.glyphs.fill(32); p.colours.fill(0); const f = Object.values(FAMILIES)[0]; p.glyphs[3] = 0x2588; p.colours[3] = parity(t) ? f[0] : f[3]; },
  // a blank cell carrying colour 5
  blank: (t, w, h, p) => { p.glyphs.fill(32); p.colours.fill(0); p.colours[3] = 5; p.glyphs[4] = 0x2588; p.colours[4] = 30; },
  // a banned circle glyph
  banned: (t, w, h, p) => { p.glyphs.fill(32); p.colours.fill(0); p.glyphs[3] = 0x25d0; p.colours[3] = 30; },
  // a quiet scene that is clean: a control for the controls
  clean: (t, w, h, p) => { p.glyphs.fill(32); p.colours.fill(0); p.glyphs[3] = 0x2588; p.colours[3] = Object.values(FAMILIES)[0][2]; },
};
for (const [k, fn] of Object.entries(PLANTED)) { fn.id = 'planted-' + k; fn.kind = 'cells'; }
