// DRIFT-2 S3: the experimental physics sims (sand, waves, pendulum, cloth). The shared suite
// (noncalm-scenes.test.js) already covers glyph allow-list, sizes, flash and determinism for
// every scene in the playlist; this file adds the physics: conservation, bounds, energy or
// amplitude over 10 simulated minutes at three sizes, chunk equivalence, tiny sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import sand from '../src/scenes/sand.js';
import waves, { LIMIT } from '../src/scenes/waves.js';
import pendulum, { pendulumEnergy, pendulumPoints } from '../src/scenes/pendulum.js';
import cloth, { VMAX } from '../src/scenes/cloth.js';
import { PLAYLISTS } from '../src/scenes/index.js';
import { createCellComposer } from '../src/cells.js';
import { isAllowedGlyph } from '../src/glyphs.js';

const TEN_MIN = 30 * 600;
const SIZES = [[120, 40], [40, 12], [240, 67]];
const OBST = 0x80;

function frameOf(sim, s, w, h) {
  const g = new Uint16Array(w * h), c = new Uint8Array(w * h);
  sim.draw(s, { glyphs: g, colours: c });
  return { g: Array.from(g), c: Array.from(c) };
}

test('experimental playlist alternates styles: bounce, sand, waves, pendulum, cloth, then the artist (S4)', () => {
  assert.deepEqual(PLAYLISTS.experimental.map((s) => s.id), ['bounce', 'sand', 'waves', 'pendulum', 'cloth', 'artist']);
});

// ---- sand
test('sand: grain count is conserved (count == grains in the grid; changes only by spawns and the fade-out), 10 min at 3 sizes', () => {
  for (const [w, h] of [[120, 40], [40, 12], [20, 8]]) {
    const s = sand.init(w, h, 1);
    let cycles = 0, maxRemoved = 0, peak = 0;
    for (let i = 0; i < TEN_MIN; i++) {
      const before = s.count, cyc = s.cycle, phaseBefore = s.phase;
      sand.step(s);
      let grains = 0;
      for (let k = 0; k < s.cells.length; k++) if (s.cells[k] !== 0 && s.cells[k] !== OBST) grains++;
      assert.equal(grains, s.count, `${w}x${h} step ${i}: grid has ${grains}, count says ${s.count}`);
      assert.equal(s.count - before, s.added - s.removed, `${w}x${h} step ${i}`);
      if (s.added === 0 && s.removed === 0) assert.equal(s.count, before, 'no spawn, no fade: nothing appears or vanishes');
      if (phaseBefore === 1) assert.equal(s.added, 0, 'no spawns while fading');
      assert.ok(s.count >= 0 && s.count <= w * h);
      if (s.removed > maxRemoved) maxRemoved = s.removed;
      if (s.count > peak) peak = s.count;
      if (s.cycle !== cyc) cycles++;
    }
    assert.ok(cycles >= 1, `${w}x${h}: the box was cleared and refilled at least once in 10 minutes`);
    // gentle reset: no step removes more than a sixth of the biggest pile (no flash, no cut)
    assert.ok(maxRemoved <= Math.max(3, peak / 6), `${w}x${h}: one step removed ${maxRemoved} of a peak ${peak}`);
  }
});

test('sand: a grain falls to the floor, and a stream of grains piles up into a heap that spreads sideways', () => {
  const s = sand.init(60, 30, 1);
  s.cells.fill(0);
  s.emitters = [];
  s.cells[5] = (0 << 4) | 9; s.count = 1;
  for (let i = 0; i < 40; i++) sand.step(s);
  let at = -1;
  for (let k = 0; k < s.cells.length; k++) if (s.cells[k] !== 0) at = k;
  assert.ok(Math.floor(at / 60) === 29, `grain landed on the bottom row, was row ${Math.floor(at / 60)}`);

  const t = sand.init(60, 30, 2);
  t.cells.fill(0); // no obstacles
  t.emitters = [{ ph: 0, sp: 0, amp: 0, kind: 1 }];
  for (let i = 0; i < 300; i++) sand.step(t);
  assert.ok(t.count > 150, `grains were spawned (${t.count})`);
  let bottom = 0, tallest = 0;
  for (let x = 0; x < 60; x++) {
    if (t.cells[29 * 60 + x] !== 0) bottom++;
    let hgt = 0;
    for (let y = 29; y >= 0 && t.cells[y * 60 + x] !== 0; y--) hgt++;
    tallest = Math.max(tallest, hgt);
  }
  assert.ok(bottom >= 12, `the heap is ${bottom} wide at the floor`);
  assert.ok(tallest < t.count / 3, `a slope, not a pole: tallest column ${tallest} of ${t.count} grains`);
});

test('sand: ramps and a sieve show up across cycles, and obstacles are never counted as grains', () => {
  const seen = new Set();
  const s = sand.init(80, 24, 3);
  for (let i = 0; i < TEN_MIN && seen.size < 3; i++) { sand.step(s); seen.add(s.layout); }
  assert.deepEqual([...seen].sort(), ['plain', 'ramps', 'sieve']);
  const f = frameOf(sand, s, 80, 24);
  for (const cp of f.g) assert.ok(isAllowedGlyph(cp));
});

// ---- waves
test('waves: amplitude stays bounded and finite over 10 simulated minutes at three sizes (seat-belt clamp never needed)', () => {
  for (const [w, h] of SIZES) {
    const s = waves.init(w, h, 1);
    let mx = 0;
    for (let i = 0; i < TEN_MIN; i++) {
      waves.step(s);
      if (s.maxAbs > mx) mx = s.maxAbs;
    }
    assert.ok(Number.isFinite(mx) && mx <= LIMIT, `${w}x${h}: max amplitude ${mx}`);
    assert.equal(s.clamped, 0, `${w}x${h}: the clamp engaged ${s.clamped} times`);
    for (let k = 0; k < s.u.length; k++) assert.ok(Number.isFinite(s.u[k]));
    // the edge cells are held at zero
    for (let x = 0; x < w; x++) assert.equal(s.u[x] + s.u[(h - 1) * w + x], 0);
    for (let y = 0; y < h; y++) assert.equal(s.u[y * w] + s.u[y * w + w - 1], 0);
  }
});

test('waves: a disturbance spreads as a ring at a finite speed (nothing beyond one cell a step) and fades by damping', () => {
  const w = 101, h = 41;
  const s = waves.init(w, h, 1);
  s.u.fill(0); s.p.fill(0); s.nextDrop = 1e9; s.sources = [];
  const cx = 50, cy = 20;
  s.u[cy * w + cx] = 1; s.p[cy * w + cx] = 1;
  for (let i = 0; i < 20; i++) waves.step(s);
  let reach = 0, nonzeroNear = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (s.u[y * w + x] !== 0) reach = Math.max(reach, Math.abs(x - cx));
    if (Math.abs(x - cx) <= 8 && Math.abs(s.u[y * w + x]) > 1e-4) nonzeroNear++;
  }
  assert.ok(reach <= 20, `reach ${reach} > 20 cells in 20 steps`);
  assert.ok(reach >= 9, `the ring moved (reach ${reach})`);
  assert.ok(nonzeroNear > 20);
  // with no more pebbles, the energy decays
  const energy = () => s.u.reduce((a, v) => a + v * v, 0);
  const e1 = energy();
  for (let i = 0; i < 3000; i++) waves.step(s);
  assert.ok(energy() < e1 * 0.05, 'a lone ring dies away');
});

// ---- pendulum
test('pendulum: total energy drifts by under 0.1% of its scale over 10 simulated minutes at three sizes (RK4, 8 substeps)', () => {
  for (const [w, h] of SIZES) {
    const s = pendulum.init(w, h, 1);
    assert.ok(s.p.length >= 3);
    const e0 = s.p.map((q) => pendulumEnergy(s, q));
    const scale = 2 * s.g * (s.l1 + s.l2);
    let drift = 0;
    for (let i = 0; i < TEN_MIN; i++) {
      pendulum.step(s);
      if (i % 30 === 0) s.p.forEach((q, k) => { drift = Math.max(drift, Math.abs(pendulumEnergy(s, q) - e0[k]) / scale); });
    }
    assert.ok(drift < 1e-3, `${w}x${h}: relative energy drift ${drift}`);
  }
});

test('pendulum: elbow and tip stay on screen at all times; nearby starts diverge (chaos) after being together at first', () => {
  for (const [w, h] of SIZES) {
    const s = pendulum.init(w, h, 4);
    const apart = (a, b) => { const p = pendulumPoints(s, s.p[a]), q = pendulumPoints(s, s.p[b]); return Math.hypot(p.x2 - q.x2, (p.y2 - q.y2) / 2); };
    let early = 0, late = 0;
    for (let i = 0; i < 30 * 60; i++) {
      pendulum.step(s);
      for (const q of s.p) {
        const pt = pendulumPoints(s, q);
        for (const [x, y] of [[pt.x1, pt.y1], [pt.x2, pt.y2]]) {
          assert.ok(x >= 0 && x < w && y >= 0 && y < 2 * h, `${w}x${h} step ${i}: (${x}, ${y}) off screen`);
        }
      }
      if (i === 30) early = apart(0, s.p.length - 1) / s.reach;
      if (i >= 30 * 40) late = Math.max(late, apart(0, s.p.length - 1) / s.reach);
    }
    assert.ok(early < 0.05, `${w}x${h}: pendula start together (${early})`);
    assert.ok(late > 0.3, `${w}x${h}: and fly apart later (${late})`);
  }
});

// ---- cloth
test('cloth: every node stays in the box, speed is limited, kinetic energy bounded, links never blow up (10 min, 3 sizes)', () => {
  for (const [w, h] of SIZES) {
    const s = cloth.init(w, h, 1);
    assert.ok(s.n > 20, `${w}x${h}: ${s.n} nodes`);
    const pinned = [];
    for (let k = 0; k < s.n; k++) if (s.pin[k]) pinned.push([s.x[k], s.y[k]]);
    let worst = 0, sum = 0, cnt = 0, maxKE = 0;
    const keBound = (s.n * VMAX * VMAX) / 2 + 1e-9; // per step units
    for (let i = 0; i < TEN_MIN; i++) {
      cloth.step(s);
      let ke = 0;
      for (let k = 0; k < s.n; k++) {
        assert.ok(s.x[k] >= 0 && s.x[k] < w && s.y[k] >= 0 && s.y[k] < 2 * h, `${w}x${h} step ${i}: node ${k} at (${s.x[k]}, ${s.y[k]})`);
        const d2 = (s.x[k] - s.px[k]) ** 2 + (s.y[k] - s.py[k]) ** 2;
        ke += d2 / 2;
        assert.ok(d2 <= VMAX * VMAX + 1e-9, 'speed limit');
      }
      assert.ok(Number.isFinite(ke));
      if (ke > maxKE) maxKE = ke;
      if (i % 10 === 0) {
        for (let l = 0; l < s.nStruct; l++) {
          const r = Math.hypot(s.x[s.lb[l]] - s.x[s.la[l]], s.y[s.lb[l]] - s.y[s.la[l]]) / s.rest[l];
          if (r > worst) worst = r;
          sum += r; cnt++;
        }
      }
    }
    assert.ok(maxKE <= keBound, `${w}x${h}: kinetic ${maxKE} > ${keBound}`);
    assert.ok(worst < 4, `${w}x${h}: a link stretched to ${worst} times its length`);
    assert.ok(sum / cnt < 1.1, `${w}x${h}: mean stretch ${sum / cnt}`);
    let j = 0;
    for (let k = 0; k < s.n; k++) if (s.pin[k]) { assert.deepEqual([s.x[k], s.y[k]], pinned[j++], 'pinned nodes never move'); }
  }
});

test('cloth: gravity pulls unpinned nodes down, and the ball pushes nodes out of itself', () => {
  const g = cloth.init(120, 40, 1);
  g.pin.fill(0);
  g.ball.r = 0;
  const y0 = g.y.reduce((a, v) => a + v, 0) / g.n;
  for (let i = 0; i < 45; i++) cloth.step(g);
  const y1 = g.y.reduce((a, v) => a + v, 0) / g.n;
  assert.ok(y1 > y0 + 5, `an unpinned curtain falls: ${y0} -> ${y1}`);

  const s = cloth.init(120, 40, 1);
  const free = [];
  for (let k = 0; k < s.n; k++) if (!s.pin[k]) free.push(k);
  for (let i = 0; i < 600; i++) {
    cloth.step(s);
    for (const k of free) {
      const d = Math.hypot(s.x[k] - s.ball.x, s.y[k] - s.ball.y);
      // the final speed limit and box clamp may leave a node a little inside; never deeply
      assert.ok(d > s.ball.r * 0.5, `step ${i}: node ${k} is ${d} from the ball centre (r ${s.ball.r})`);
    }
  }
});

// ---- all four: determinism, chunk equivalence, tiny sizes
const SIMS = [sand, waves, pendulum, cloth];

test('same seed + same step count -> same frame; stepping in one go equals stepping in pieces (with draws in between)', () => {
  for (const sim of SIMS) {
    const w = 70, h = 22;
    const whole = sim.init(w, h, 7);
    for (let i = 0; i < 400; i++) sim.step(whole);
    const pieces = sim.init(w, h, 7);
    for (const n of [1, 7, 90, 2, 300]) {
      for (let i = 0; i < n; i++) sim.step(pieces);
      frameOf(sim, pieces, w, h); // drawing must not change the future
    }
    assert.deepEqual(frameOf(sim, pieces, w, h), frameOf(sim, whole, w, h), sim.id);
    const other = sim.init(w, h, 8);
    for (let i = 0; i < 400; i++) sim.step(other);
    assert.notDeepEqual(frameOf(sim, other, w, h).g, frameOf(sim, whole, w, h).g, `${sim.id}: another seed differs`);
  }
});

test('the cell composer gives the same frame whether it is fed 1 step or 3 steps per frame', () => {
  for (const sim of SIMS) {
    const run = (per) => {
      const cc = createCellComposer({ scenes: [sim], cols: 60, rows: 20, seed: 3 });
      let f;
      for (let k = 0; k <= 90 / per; k++) f = cc.frame({ a: 0, b: 0, p: 0 }, (k * per) / 30);
      return { g: Array.from(f.glyphs), c: Array.from(f.shades), steps: cc.stepsTotal };
    };
    const a = run(1), b = run(3);
    assert.equal(a.steps, 90);
    assert.equal(b.steps, 90);
    assert.deepEqual(a, b, sim.id);
  }
});

test('tiny and empty sizes (0x0, 0x5, 5x0, 1x1, 2x2, 3x1, 1x40): no NaN, no throw, every glyph allowed, buffers sized right', () => {
  for (const sim of SIMS) {
    for (const [w, h] of [[0, 0], [0, 5], [5, 0], [1, 1], [2, 2], [3, 1], [1, 40], [9, 4], [16, 9]]) {
      const s = sim.init(w, h, 1);
      for (let i = 0; i < 600; i++) sim.step(s);
      const f = frameOf(sim, s, w, h);
      assert.equal(f.g.length, w * h);
      for (const cp of f.g) assert.ok(isAllowedGlyph(cp), `${sim.id} ${w}x${h}: U+${cp.toString(16)}`);
      for (const c of f.c) assert.ok(c < 16, `${sim.id} ${w}x${h}: colour ${c}`);
      for (const v of Object.values(s)) {
        if (v instanceof Float64Array) for (let k = 0; k < v.length; k++) assert.ok(Number.isFinite(v[k]), `${sim.id} ${w}x${h}`);
      }
    }
  }
});

test('the four sims draw several distinct glyphs and use more than one brightness level (variety)', () => {
  for (const sim of SIMS) {
    const s = sim.init(120, 40, 1);
    for (let i = 0; i < 30 * 25; i++) sim.step(s);
    const f = frameOf(sim, s, 120, 40);
    const glyphs = new Set(f.g.filter((v) => v !== 32));
    const levels = new Set(f.c.filter((_, k) => f.g[k] !== 32));
    assert.ok(glyphs.size >= 5, `${sim.id}: ${glyphs.size} distinct glyphs`);
    assert.ok(levels.size >= 4, `${sim.id}: ${levels.size} brightness levels`);
  }
});
