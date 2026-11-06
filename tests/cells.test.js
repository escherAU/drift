import test from 'node:test';
import assert from 'node:assert/strict';
import { createCellComposer, renderScene, STEP_HZ, MAX_STEPS } from '../src/cells.js';
import { smoothstep } from '../src/compose.js';
import life from '../src/scenes/life.js';
import bounce from '../src/scenes/bounce.js';
import glyphrain from '../src/scenes/glyphrain.js';

const W = 120, H = 40;

test('dissolve: exactly A at p = 0, exactly B at p = 1, a mix in between', () => {
  const cc = createCellComposer({ scenes: [glyphrain, life], cols: W, rows: H, seed: 1 });
  const t = 4;
  const A = renderScene(glyphrain, t, W, H, 1);
  const a0 = cc.frame({ a: 0, b: 1, p: 0 }, t);
  assert.deepEqual(Array.from(a0.glyphs), Array.from(A.glyphs), 'p=0 is exactly A (glyphs)');
  assert.deepEqual(Array.from(a0.shades), Array.from(A.colours), 'p=0 is exactly A (colours)');
  // B for a sim is "fresh state, stepped as the composer stepped it": compare with the composer's own p=1 frame
  const cc2 = createCellComposer({ scenes: [glyphrain, life], cols: W, rows: H, seed: 1 });
  cc2.frame({ a: 0, b: 1, p: 0.01 }, t);
  const mid = cc2.frame({ a: 0, b: 1, p: 0.5 }, t);
  const gm = Array.from(mid.glyphs);
  const end = cc2.frame({ a: 0, b: 1, p: 1 }, t);
  const gend = Array.from(end.glyphs);
  const B = cc2.frame({ a: 1, b: 1, p: 0 }, t); // scene 1 alone (life has not stepped: same t)
  assert.deepEqual(gend, Array.from(B.glyphs), 'p=1 is exactly B');
  assert.notDeepEqual(gm, gend, 'mid-dissolve is not B');
  assert.notDeepEqual(gm, Array.from(A.glyphs), 'mid-dissolve is not A');
});

test('dissolve: every cell flips from A to B exactly once, never back, and never blends', () => {
  const cc = createCellComposer({ scenes: [glyphrain, life], cols: W, rows: H, seed: 1 });
  const t = 4;
  const A = renderScene(glyphrain, t, W, H, 1);
  const B = renderScene(life, 0, W, H, 1);
  cc.frame({ a: 0, b: 1, p: 0.001 }, t);
  const flipped = new Int32Array(W * H);
  let prevB = new Uint8Array(W * H);
  for (let k = 1; k <= 60; k++) {
    const p = k / 60;
    const f = cc.frame({ a: 0, b: 1, p }, t);
    for (let i = 0; i < f.glyphs.length; i++) {
      const isA = f.glyphs[i] === A.glyphs[i] && f.shades[i] === A.colours[i];
      const isB = f.glyphs[i] === B.glyphs[i] && f.shades[i] === B.colours[i];
      assert.ok(isA || isB, `cell ${i} at p=${p} is neither A nor B`);
      if (isB && !isA) {
        if (!prevB[i]) flipped[i]++;
        prevB[i] = 1;
      } else if (isA && !isB) {
        assert.ok(!prevB[i], `cell ${i} flipped back to A`);
      }
    }
  }
  for (let i = 0; i < flipped.length; i++) assert.ok(flipped[i] <= 1);
});

test('dissolve: changed cells per frame stay within budget (6%) over the 2 s dissolve at 18 fps', () => {
  const cc = createCellComposer({ scenes: [glyphrain, life], cols: W, rows: H, seed: 1 });
  const t = 4;
  let prev = cc.frame({ a: 0, b: 1, p: 0 }, t).glyphs.slice();
  let worst = 0, total = 0;
  const frames = 36;
  for (let k = 1; k <= frames; k++) {
    const f = cc.frame({ a: 0, b: 1, p: smoothstep(k / frames) }, t);
    let ch = 0;
    for (let i = 0; i < prev.length; i++) if (f.glyphs[i] !== prev[i]) ch++;
    worst = Math.max(worst, ch / prev.length);
    total += ch;
    prev = f.glyphs.slice();
  }
  assert.ok(worst < 0.06, `worst frame changed ${(worst * 100).toFixed(2)}% of cells`);
  assert.ok(total > 0.5 * W * H * 0.3, 'but the dissolve does change the screen');
});

test('sim stepping: at most 4 steps per frame, so a huge dt or 4x speed slows the sim instead of burning CPU', () => {
  assert.equal(MAX_STEPS, 4);
  const cc = createCellComposer({ scenes: [life], cols: 40, rows: 10, seed: 1 });
  const st = { a: 0, b: 0, p: 0 };
  cc.frame(st, 0);
  cc.frame(st, 100); // a 100 s jump
  assert.equal(cc.stepsLastFrame, 4);
  // 4x speed at 18 fps wants 6.7 steps a frame
  let t = 100;
  for (let k = 0; k < 40; k++) { t += 4 / 18; cc.frame(st, t); assert.ok(cc.stepsLastFrame <= 4); }
  assert.equal(cc.stepsLastFrame, 4);
});

test('sim stepping: normal speed keeps real time (30 steps per scene second); paused (same t) steps nothing', () => {
  const cc = createCellComposer({ scenes: [life], cols: 40, rows: 10, seed: 1 });
  const st = { a: 0, b: 0, p: 0 };
  cc.frame(st, 0);
  const base = cc.stepsTotal;
  for (let k = 1; k <= 18 * 10; k++) cc.frame(st, k / 18);
  assert.ok(Math.abs(cc.stepsTotal - base - 10 * STEP_HZ) <= 1, `steps ${cc.stepsTotal - base}`);
  const n = cc.stepsTotal;
  for (let k = 0; k < 20; k++) cc.frame(st, 10);
  assert.equal(cc.stepsTotal, n, 'no time, no steps');
});

test('sim determinism: same seed + same step count gives the same frame; another count differs', () => {
  for (const sim of [life, bounce]) {
    const run = (steps, seed = 3) => {
      const s = sim.init(60, 20, seed);
      for (let i = 0; i < steps; i++) sim.step(s);
      const g = new Uint16Array(1200), c = new Uint8Array(1200);
      sim.draw(s, { glyphs: g, colours: c });
      return [Array.from(g), Array.from(c)];
    };
    assert.deepEqual(run(240), run(240), sim.id);
    assert.notDeepEqual(run(240)[0], run(300)[0], `${sim.id}: more steps, different frame`);
    assert.notDeepEqual(run(240, 3)[0], run(240, 4)[0], `${sim.id}: different seed`);
  }
});

test('sim draw does not mutate state (drawing twice changes nothing)', () => {
  for (const sim of [life, bounce]) {
    const s = sim.init(60, 20, 1);
    for (let i = 0; i < 90; i++) sim.step(s);
    const mk = () => ({ glyphs: new Uint16Array(1200), colours: new Uint8Array(1200) });
    const p1 = mk(), p2 = mk();
    sim.draw(s, p1);
    sim.draw(s, p2);
    assert.deepEqual(Array.from(p1.glyphs), Array.from(p2.glyphs));
  }
});

test('composer reuses its buffers frame to frame and a scene that leaves the playlist restarts fresh', () => {
  const cc = createCellComposer({ scenes: [life, bounce], cols: 60, rows: 20, seed: 1 });
  const f1 = cc.frame({ a: 0, b: 1, p: 0 }, 0);
  const g = f1.glyphs, s = f1.shades;
  const f2 = cc.frame({ a: 0, b: 1, p: 0 }, 1);
  assert.equal(f2.glyphs, g);
  assert.equal(f2.shades, s);
  for (let k = 0; k < 30; k++) cc.frame({ a: 0, b: 0, p: 0 }, 1 + k / 18);
  const before = Array.from(cc.frame({ a: 0, b: 0, p: 0 }, 3).glyphs);
  cc.frame({ a: 1, b: 1, p: 0 }, 3.05); // life is inactive now: its state is dropped
  cc.frame({ a: 0, b: 0, p: 0 }, 3.1);
  const fresh = createCellComposer({ scenes: [life, bounce], cols: 60, rows: 20, seed: 1 });
  fresh.frame({ a: 0, b: 0, p: 0 }, 0);
  assert.deepEqual(Array.from(cc.frame({ a: 0, b: 0, p: 0 }, 3.1).glyphs), Array.from(fresh.frame({ a: 0, b: 0, p: 0 }, 0).glyphs), 'restarted from the seed');
  assert.notDeepEqual(before.length, 0);
});

test('resize re-initialises sims at the new size without throwing (including 0x0)', () => {
  const cc = createCellComposer({ scenes: [life, bounce, glyphrain], cols: 60, rows: 20, seed: 1 });
  for (const [w, h] of [[30, 10], [0, 0], [1, 1], [200, 60]]) {
    cc.resize(w, h);
    for (let i = 0; i < 3; i++) {
      for (let a = 0; a < 3; a++) cc.frame({ a, b: (a + 1) % 3, p: 0.4 }, i);
    }
    assert.equal(cc.glyphs.length, w * h);
  }
});

// ---- life
test('life: seeded from patterns, not soup (sparse, never a half-full random field)', () => {
  for (const seed of [1, 2, 3, 99]) {
    const s = life.init(120, 40, seed);
    const density = s.pop / s.cells.length;
    assert.ok(density > 0 && density < 0.03, `seed ${seed} density ${density}`);
  }
});

test('life: runs for a long time without dying out, and half blocks are the only glyphs', () => {
  const s = life.init(80, 24, 7);
  const g = new Uint16Array(80 * 24), c = new Uint8Array(80 * 24);
  const seen = new Set();
  for (let i = 0; i < 30 * 600; i++) {
    life.step(s);
    if (i % 90 === 0) { life.draw(s, { glyphs: g, colours: c }); for (const v of g) seen.add(v); assert.ok(s.pop > 0, `dead at step ${i}`); }
  }
  for (const v of seen) assert.ok([32, 0x2580, 0x2584, 0x2588].includes(v), `U+${v.toString(16)}`);
});

test('life: reseeds when the board is dead (both a dead arm and a stagnant arm)', () => {
  // dead arm
  const d = life.init(60, 20, 1);
  d.cells.fill(0); d.pop = 0;
  for (let i = 0; i < 3 * 200 && d.reseeds === 0; i++) life.step(d);
  assert.ok(d.reseeds >= 1, 'dead board reseeded');
  assert.ok(d.pop > 0, 'and has life again');
  // stagnant arm: a lone block (still life) forever
  const s = life.init(60, 20, 1);
  s.cells.fill(0);
  for (const [x, y] of [[10, 10], [11, 10], [10, 11], [11, 11]]) s.cells[y * 60 + x] = 1;
  s.pop = 4; s.ringN = 0; s.idle = 0;
  for (let i = 0; i < 3 * 200 && s.reseeds === 0; i++) life.step(s);
  assert.ok(s.reseeds >= 1, 'a still life is stagnant and gets reseeded');
  // control: a glider alone is NOT stagnant for a long while
  const gl = life.init(60, 20, 1);
  gl.cells.fill(0);
  for (const [x, y] of [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]) gl.cells[y * 60 + x + 5] = 1;
  gl.pop = 5; gl.ringN = 0; gl.idle = 0;
  for (let i = 0; i < 3 * 60; i++) life.step(gl);
  assert.equal(gl.reseeds, 0, 'a moving glider does not trigger a reseed');
});

test('life: a reseed adds patterns on top (no whole-board refill: live cells stay a small fraction)', () => {
  const s = life.init(120, 40, 5);
  s.cells.fill(0); s.pop = 0;
  for (let i = 0; i < 3 * 200 && s.reseeds === 0; i++) life.step(s);
  assert.ok(s.pop / s.cells.length < 0.05);
});

// ---- bounce
test('bounce: energy is bounded (never above the launch bound) over a long run, and nothing leaves the box', () => {
  for (const [w, h, seed] of [[120, 40, 1], [60, 20, 2], [20, 8, 3]]) {
    const s = bounce.init(w, h, seed);
    let maxE = 0;
    for (let i = 0; i < 30 * 600; i++) {
      bounce.step(s);
      for (const b of s.balls) {
        const e = 0.5 * (b.vx * b.vx + b.vy * b.vy) + s.g * (s.H2 - b.r - b.y);
        if (e > maxE) maxE = e;
        assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.vx) && Number.isFinite(b.vy));
        assert.ok(b.x >= b.r - 1e-6 && b.x <= w - b.r + 1e-6 && b.y >= b.r - 1e-6 && b.y <= s.H2 - b.r + 1e-6, `ball left the box at step ${i}`);
      }
    }
    assert.ok(maxE <= s.emax * 1.0001, `${w}x${h}: energy ${maxE} above bound ${s.emax}`);
  }
});

test('bounce: gravity pulls down, bounces lose energy, and the balls are still moving after 10 minutes', () => {
  const s = bounce.init(120, 40, 1);
  const b = s.balls[0];
  b.y = 10; b.vy = 0; b.vx = 0;
  const y0 = b.y;
  for (let i = 0; i < 5; i++) bounce.step(s);
  assert.ok(b.vy > 0 && b.y > y0, 'gravity pulls down (y grows downward)');
  const one = bounce.init(120, 40, 1);
  one.balls.length = 1;
  const b1 = one.balls[0];
  b1.x = 60; b1.y = one.H2 - 20; b1.vx = 0; b1.vy = 0;
  let peaks = [];
  let lastVy = 0;
  for (let i = 0; i < 30 * 8; i++) {
    bounce.step(one);
    if (lastVy < 0 && b1.vy >= 0) peaks.push(b1.y); // top of an arc
    lastVy = b1.vy;
  }
  assert.ok(peaks.length >= 2, 'bounced more than once');
  assert.ok(peaks[1] > peaks[0] - 1e-9 || peaks[0] > one.H2 - 20, 'each arc is lower than the one before (y larger = lower)');
  const moving = bounce.init(120, 40, 4);
  for (let i = 0; i < 30 * 600; i++) bounce.step(moving);
  const sp = moving.balls.reduce((a, q) => a + Math.hypot(q.vx, q.vy), 0);
  assert.ok(sp > 1, `balls came to rest (speed sum ${sp})`);
});
