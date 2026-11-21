// DRIFT-10: what Life still is after the flash fix (src/scenes/life.js, src/cells.js realClock, src/app.js rt), and the quiet states.
//   look      strictly two-tone (glyphs only space and U+2580 / 2584 / 2588, one ink and one paper, in both colour modes), `i` still inverts (config and key press), the board is still
//             Conway's Life seeded from the same patterns (cell for cell the same as the old Life's board, every step, reseeds included, and equal to a naive reference), a glider seeded
//             alone still glides (its drawn picture keeps five-ish cells and its centroid follows the board's), the scene is not blank (lit share within a stated band over a run) and is
//             not frozen, and a run is deterministic per seed.
//   quiet     empty and tiny grids (0 by 0 up) do not throw, the real app at 5x3 and 1x1 runs; a dead board and an idle board (still lifes) reseed and the reseed is not a flash (the five rules
//             over the frames around it); runs of the real app with a reseed in them pass at 1x and at 4x; very large boards (240x67 and 400x100) keep the per-cell history bounded to the
//             visible grid (counted, not timed) and cost at most one visit of the grid a step (counted; no wall-clock bound: it flaked under load and the count is what the design promises).
//   clock     the composer steps a sim with realClock from the real-time clock and every other sim from t, with and without tc (stub sims, no flash meter).
import test from 'node:test';
import assert from 'node:assert/strict';
import life from '../src/scenes/life.js';
import oldLife from './fixtures/life-before-drift10.js';
import { createCellComposer } from '../src/cells.js';
import { runLife, PLAN, SPEED_OF } from './helpers-life-app.js';
import { createFlashMeter, failedRules, ruleOf, X1_RULE_IDS } from './helpers-flash.js';

const GLYPHS = new Set([32, 0x2580, 0x2584, 0x2588]);
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const draw = (sc, s) => { const g = new Uint16Array(s.w * s.h), c = new Uint8Array(s.w * s.h).fill(9); sc.draw(s, { glyphs: g, colours: c }); return { g, c }; };
const line = (rep) => X1_RULE_IDS.map((id) => `${id} ${(ruleOf(rep, id).worstFraction * 100).toFixed(2)}`).join(' ');
// a frame the flash meter takes: white on black, glyphs from the scene
function frameOf(s) {
  const { g } = draw(life, s);
  const n = s.w * s.h;
  return { cols: s.w, rows: s.h, glyphs: Uint32Array.from(g), fg: new Uint32Array(n).fill(0xffffff), bg: new Uint32Array(n) };
}
// steps the scene and feeds the meter the viewer's 18 Hz grid: sample j is taken after step ceil(j * 30 / 18)
function meterRun(s, steps, { onStep = null, fps = 18 } = {}) {
  const meter = createFlashMeter(s.w, s.h, fps);
  let j = 0;
  for (let i = 0; i <= steps; i++) {
    if (i > 0) { life.step(s); if (onStep) onStep(i); }
    while (Math.ceil((j * 30) / fps) <= i) { meter.push(frameOf(s), undefined); j++; }
  }
  return meter.report();
}
const hashOf = (a) => { let h = 0x811c9dc5; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 0x01000193); return h >>> 0; };

// ---- look
test('DRIFT-10 look: two-tone only, in the real app, truecolor and 256 colours (glyphs from space and the three block halves, one ink, one paper)', async () => {
  for (const mode of ['truecolor', '256']) for (const seed of [1, 2, 4]) {
    const glyphs = new Set(), inks = new Set(), papers = new Set();
    const r = await runLife({ seed, mode, seconds: 12, grab: (k, screen, app, f) => { for (let j = 0; j < f.glyphs.length; j++) { glyphs.add(f.glyphs[j]); papers.add(f.bg[j]); if (f.glyphs[j] !== 32) inks.add(f.fg[j]); } } });
    assert.ok(r.frames > 200, 'frames read');
    for (const g of glyphs) assert.ok(GLYPHS.has(g), `${mode} seed ${seed}: glyph ${g.toString(16)} is allowed`);
    assert.equal(inks.size, 1, `${mode} seed ${seed}: one ink`);
    assert.equal(papers.size, 1, `${mode} seed ${seed}: one paper`);
    const [ink] = inks, [paper] = papers;
    assert.ok(ink !== paper, 'ink and paper differ');
    assert.ok(glyphs.has(0x2588) || glyphs.has(0x2580) || glyphs.has(0x2584), 'something is drawn');
  }
});

test('DRIFT-10 look: the scene draws colour index 0 only and nothing but the three half-block glyphs, on every size from 0x0 up', () => {
  for (const [w, h] of [[0, 0], [0, 5], [5, 0], [1, 1], [2, 1], [1, 3], [5, 3], [40, 10], [80, 24]]) {
    const s = life.init(w, h, 3);
    for (let i = 0; i < 300; i++) life.step(s);
    const { g, c } = draw(life, s);
    assert.equal(g.length, w * h);
    for (const v of g) assert.ok(GLYPHS.has(v), `${w}x${h}: glyph ${v}`);
    for (const v of c) assert.equal(v, 0, `${w}x${h}: colour index`);
  }
});

test('DRIFT-10 look: `i` still inverts (the config, and a key press during the run), and Life keeps drawing the same way in both', async () => {
  const stats = async (o) => {
    const seen = { ink: new Set(), paper: new Set(), last: null };
    const r = await runLife({ seed: 1, mode: '256', seconds: 14, ...o, grab: (k, screen, app, f) => { if (k > 150) { for (let j = 0; j < f.glyphs.length; j++) { seen.paper.add(f.bg[j]); if (f.glyphs[j] !== 32) seen.ink.add(f.fg[j]); } seen.last = app.getState().light; } } });
    return { r, seen };
  };
  const normal = await stats({}), cfg = await stats({ invert: true }), key = await stats({ keys: [{ at: 2, key: 'i' }] });
  assert.equal(normal.seen.last, false);
  assert.equal(cfg.seen.last, true);
  assert.equal(key.seen.last, true, 'the key press inverted it');
  const [nInk] = normal.seen.ink, [nPaper] = normal.seen.paper;
  for (const x of [cfg, key]) {
    assert.deepEqual([...x.seen.ink], [nPaper], 'inverted: the ink is the old paper');
    assert.deepEqual([...x.seen.paper], [nInk], 'inverted: the paper is the old ink');
  }
});

test('DRIFT-10 look: the board is still Conway\'s Life from the same patterns: cell for cell the old Life\'s board at every step (reseeds included), and a naive reference', () => {
  for (const [w, h, seed] of [[80, 24, 1], [80, 24, 8], [41, 11, 3], [40, 10, 5], [120, 40, 2]]) {
    const a = life.init(w, h, seed), b = oldLife.init(w, h, seed);
    assert.deepEqual(a.cells, b.cells, `${w}x${h} seed ${seed}: seeded the same`);
    for (let i = 0; i < 1200; i++) {
      life.step(a); oldLife.step(b);
      if (i % 3 === 2) assert.deepEqual(a.cells, b.cells, `${w}x${h} seed ${seed}: board after step ${i + 1}`);
    }
    assert.equal(a.reseeds, b.reseeds);
  }
  // a naive reference, independent of the scene's loops: 100 generations of seed 1 at 80x24 (no reseed in them)
  const s = life.init(80, 24, 1), W = 80, H2 = 48;
  let ref = Uint8Array.from(s.cells);
  for (let gen = 0; gen < 100; gen++) {
    const nx = new Uint8Array(ref.length);
    for (let y = 0; y < H2; y++) for (let x = 0; x < W; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) n += ref[((y + dy + H2) % H2) * W + ((x + dx + W) % W)];
      nx[y * W + x] = n === 3 || (n === 2 && ref[y * W + x]) ? 1 : 0;
    }
    ref = nx;
    for (let k = 0; k < 3; k++) life.step(s);
  }
  assert.equal(s.reseeds, 0);
  assert.deepEqual(s.cells, ref, '100 generations equal the naive Life');
});

test('DRIFT-10 look: a glider seeded alone still glides: the board keeps five cells and moves, the drawn picture keeps about five cells and its centre follows the board\'s', () => {
  const W = 120, H = 40;
  const s = life.init(W, H, 1);
  s.cells.fill(0); s.shown.fill(0);
  const G = ['.#.', '..#', '###'];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (G[y][x] === '#') s.cells[(5 + y) * W + 5 + x] = 1;
  s.shown.set(s.cells); s.pop = 5; s.ringN = 0; s.idle = 0;
  const centre = (a) => { let n = 0, cx = 0, cy = 0; for (let i = 0; i < a.length; i++) if (a[i]) { n++; cx += i % W; cy += Math.floor(i / W); } return { n, x: cx / n, y: cy / n }; };
  const start = centre(s.cells);
  const pics = new Set();
  let worst = 0, minN = 99, maxN = 0;
  for (let i = 1; i <= 300; i++) { // 10 s, 100 generations
    life.step(s);
    assert.equal(s.pop, 5, `the board keeps its five cells (step ${i})`);
    pics.add(hashOf(s.shown));
    if (i >= 36) {
      const c = centre(s.cells), d = centre(s.shown);
      worst = Math.max(worst, Math.abs(c.x - d.x), Math.abs(c.y - d.y));
      minN = Math.min(minN, d.n); maxN = Math.max(maxN, d.n);
    }
  }
  assert.equal(s.reseeds, 0);
  const end = centre(s.cells), shownEnd = centre(s.shown);
  assert.ok(end.x - start.x >= 20 && end.y - start.y >= 20, `the glider moved (${(end.x - start.x).toFixed(1)}, ${(end.y - start.y).toFixed(1)} pixels in 100 generations)`);
  assert.ok(shownEnd.x - start.x >= 18 && shownEnd.y - start.y >= 18, 'the drawn glider moved with it');
  assert.ok(worst <= 2, `the drawn centre stays within 2 pixels of the board's (${worst.toFixed(2)})`);
  assert.ok(minN >= 3 && maxN <= 9, `the drawn glider has between 3 and 9 cells at every step from 1.2 s on (${minN} to ${maxN})`);
  assert.ok(pics.size >= 40, `the picture is not frozen (${pics.size} different pictures in 300 steps)`);
});

test('DRIFT-10 look: the scene is not blank and not frozen: lit share within 0.1 to 20 % of the cells at 80x24 and 120x40 over the whole scene, every seed, at least 10 pictures a run', async () => {
  for (const [cols, rows] of [[80, 24], [120, 40]]) for (const seed of SEEDS) {
    let min = 1, max = 0; const pics = new Set();
    const r = await runLife({ cols, rows, seed, mode: '256', seconds: 32, grab: (k, screen, app, f) => {
      let lit = 0; for (let j = 0; j < f.glyphs.length; j++) if (f.glyphs[j] !== 32) lit++;
      const sh = lit / f.glyphs.length; min = Math.min(min, sh); max = Math.max(max, sh); pics.add(hashOf(f.glyphs));
    } });
    assert.ok(r.frames >= 538);
    assert.ok(min >= 0.001 && max <= 0.2, `${cols}x${rows} seed ${seed}: lit share ${(min * 100).toFixed(2)} to ${(max * 100).toFixed(2)} %`);
    assert.ok(pics.size >= 10, `${cols}x${rows} seed ${seed}: ${pics.size} different pictures`);
  }
});

test('DRIFT-10 look: on a small board (40x10) the screen is blank for at most the 3 s Life waits before reseeding a dead board, and lit 1 to 35 % on average', async () => {
  for (const seed of SEEDS) {
    let blank = 0, sum = 0, n = 0;
    await runLife({ cols: 40, rows: 10, seed, mode: '256', seconds: 32, grab: (k, screen, app, f) => { let lit = 0; for (let j = 0; j < f.glyphs.length; j++) if (f.glyphs[j] !== 32) lit++; if (!lit) blank++; sum += lit / f.glyphs.length; n++; } });
    assert.ok(blank <= 58, `seed ${seed}: ${blank} blank frames`);
    assert.ok(sum / n >= 0.01 && sum / n <= 0.35, `seed ${seed}: mean lit ${(100 * sum / n).toFixed(2)} %`);
  }
});

test('DRIFT-10 look: a run is deterministic per seed (the same seed, the same screens; another seed, other screens) on every clock', async () => {
  const run = async (seed, clock) => { const hs = []; await runLife({ seed, mode: '256', clock, clockSeed: 3, seconds: 14, grab: (k, screen, app, f) => hs.push(hashOf(f.glyphs)) }); return hs; };
  for (const clock of ['grid', 'q156', 'jitter']) {
    const a = await run(2, clock), b = await run(2, clock), c = await run(3, clock);
    assert.deepEqual(a, b, `${clock}: seed 2 twice`);
    assert.notDeepEqual(a, c, `${clock}: seeds 2 and 3 differ`);
  }
});

// ---- quiet states
test('DRIFT-10 quiet: empty and tiny grids do not throw and keep their history inside the grid', () => {
  for (const [w, h] of [[0, 0], [0, 7], [9, 0], [-3, 4], [NaN, 2], [1, 1], [1, 2], [2, 1], [3, 2], [5, 3]]) {
    const s = life.init(w, h, 4);
    const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
    assert.equal(s.shown.length, W * H * 2);
    assert.equal(s.lastFlip.length, W * H);
    for (let i = 0; i < 400; i++) life.step(s);
    assert.equal(s.shown.length, W * H * 2);
    if (W === 0 || H === 0) assert.equal(s.visits, 0, `${w}x${h}: nothing visited`);
    else assert.ok(s.visits <= 400 * W * H, `${w}x${h}: at most the grid per step`);
    draw(life, s);
  }
});

test('DRIFT-10 quiet: the real app at 5x3 and 1x1 runs 20 s in contrast without exiting, at 1x and at 4x', async () => {
  for (const [cols, rows] of [[5, 3], [1, 1], [3, 2]]) for (const speed of ['1x', '4x']) {
    const r = await runLife({ cols, rows, seed: 2, mode: '256', seconds: 20, keys: PLAN[speed], sceneSeconds: 30 * SPEED_OF[speed] });
    assert.deepEqual(r.exits, [], `${cols}x${rows} ${speed}: the app did not exit`);
    assert.ok(r.frames > 100, `${cols}x${rows} ${speed}: ${r.frames} frames`);
  }
});

test('DRIFT-10 quiet: a dead board reseeds after 3 s, and the reseed is not a flash (the five rules over the frames from before it to after it)', () => {
  const s = life.init(80, 24, 1);
  s.cells.fill(0); s.shown.fill(0); s.pop = 0; s.ringN = 0; s.idle = 0; // everything has died out and the screen is blank
  let reseedAt = -1;
  const rep = meterRun(s, 30 * 8, { onStep: (i) => { if (reseedAt < 0 && s.reseeds > 0) reseedAt = i; } });
  assert.equal(s.reseeds, 1);
  assert.ok(reseedAt >= 85 && reseedAt <= 95, `the reseed comes after 30 generations of nothing (step ${reseedAt})`);
  assert.ok(s.pop > 0);
  assert.deepEqual(failedRules(rep, { only: X1_RULE_IDS }), [], line(rep));
  assert.ok(rep.l3.worstFraction > 0, 'the reseed is in the metered frames: the picture changed');
});

test('DRIFT-10 quiet: an idle board (still lifes only) reseeds on top of what is there, the still lifes do not blink, and the reseed is not a flash', () => {
  const W = 80, H = 24;
  const s = life.init(W, H, 2);
  s.cells.fill(0);
  for (const [x, y] of [[10, 10], [60, 30]]) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) s.cells[(y + dy) * W + x + dx] = 1; // two blocks
  s.shown.set(s.cells); s.pop = 8; s.ringN = 0; s.idle = 0;
  const blocks = Uint8Array.from(s.cells);
  let reseedAt = -1, changedBefore = 0;
  const rep = meterRun(s, 30 * 10, { onStep: (i) => { if (reseedAt < 0 && s.reseeds > 0) reseedAt = i; if (reseedAt < 0 && hashOf(s.shown) !== hashOf(blocks)) changedBefore++; } });
  assert.equal(s.reseeds, 1);
  assert.equal(changedBefore, 0, 'the still lifes are drawn unchanged until the reseed');
  assert.ok(reseedAt >= 90 && reseedAt <= 100, `reseed after 30 idle generations (step ${reseedAt})`);
  assert.deepEqual(failedRules(rep, { only: X1_RULE_IDS }), [], line(rep));
});

test('DRIFT-10 quiet: real-app runs with a reseed in them pass the five rules at 1x and at 4x (the reseed is found by replaying the scene)', async () => {
  const cases = [[80, 24, 1], [80, 24, 8], [120, 40, 8], [41, 11, 3], [40, 10, 4], [20, 6, 2]];
  for (const [cols, rows, seed] of cases) {
    const s = life.init(cols, rows, seed);
    for (let i = 0; i < 900; i++) life.step(s);
    assert.ok(s.reseeds >= 1, `${cols}x${rows} seed ${seed}: the scene reseeds inside its 30 s`);
    for (const speed of ['1x', '4x']) {
      const r = await runLife({ cols, rows, seed, mode: '256', seconds: 36, keys: PLAN[speed], sceneSeconds: 30 * SPEED_OF[speed] });
      assert.ok(r.frames >= 538, `${cols}x${rows} seed ${seed} ${speed}: whole scene`);
      assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `${cols}x${rows} seed ${seed} ${speed}: ${line(r.rep)}`);
    }
  }
});

test('DRIFT-10 quiet: very large boards (240x67 and 400x100): the history is the visible grid and nothing more (counted: cells visited per step, array sizes), and the cost is counted, not timed', () => {
  for (const [w, h] of [[240, 67], [400, 100]]) {
    const s = life.init(w, h, 2);
    assert.equal(s.lastFlip.length, w * h, 'one stamp per cell');
    assert.equal(s.shown.length, w * h * 2, 'one drawn pixel per board pixel');
    const g = new Uint16Array(w * h), c = new Uint8Array(w * h);
    const STEPS = 600; // 20 s of scene
    for (let i = 0; i < STEPS; i++) { life.step(s, i % 5 === 0 || i % 5 === 3 ? 2 : 3); if (i % 5 === 0 || i % 5 === 3) life.draw(s, { glyphs: g, colours: c }); } // about 18 draws a second, two or three steps in each
    assert.ok(s.visits <= STEPS * w * h, `${w}x${h}: ${s.visits} cells visited in ${STEPS} steps; at most ${STEPS * w * h} (the grid, once a step)`);
    assert.ok(s.lastFlip.length === w * h && s.shown.length === w * h * 2, 'nothing grew');
  }
});

// ---- the clock
test('DRIFT-10 clock: the composer steps a sim with realClock from tc and every other sim from t (and both from t when no tc is given)', () => {
  const run = (realClock, withTc) => {
    const st = { n: 0 };
    const scene = { id: 's', kind: 'sim', realClock, init: () => st, step: (x) => { x.n++; }, draw: (x, p) => { p.glyphs.fill(32); p.colours.fill(0); } };
    const cc = createCellComposer({ scenes: [scene], cols: 4, rows: 2, seed: 1 });
    let t = 0, tc = 0;
    for (let f = 0; f <= 54; f++) { cc.frame({ a: 0, b: 0, p: 0 }, t, withTc ? tc : undefined); t += 4 / 18; tc += 1 / 18; } // 3 s of real time at 18 fps, the scene clock running 4x as fast
    return st.n;
  };
  assert.ok(Math.abs(run(true, true) - 90) <= 1, 'with tc, a realClock sim takes 90 steps in 3 real seconds (10 generations a second, the 1x rate)');
  assert.ok(Math.abs(run(false, true) - 360) <= 1, 'with tc, a plain sim still takes 4x that, from t');
  assert.ok(Math.abs(run(true, false) - 360) <= 1, 'without tc, a realClock sim follows t');
  assert.ok(Math.abs(run(false, false) - 360) <= 1, 'without tc, a plain sim follows t');
});
