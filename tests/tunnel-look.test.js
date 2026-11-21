// DRIFT-12: the tunnel scene of Classic high contrast is still a tunnel after it became a sim on the real-time clock (src/scenes/tunnel.js): a checkerboard of rings and spokes receding to a
// vanishing point, flowing outwards, with the bend and the clear eye. The flash rules are tests/tunnel-flash*.test.js and tunnel-cycle; the controls are tunnel-flash-controls. What this file pins:
//   sim              kind sim, realClock, init/step/draw, id 'tunnel'; the ideal picture (`ideal`) is a pure cells scene, and the sim draws it at step / 30 s
//   two-tone         colour index 0 only, only space, U+2580, U+2584 and U+2588; every cell of every buffer is written (a sentinel fill is gone), on 0x0, 1x1, 3x2 and 10x4 too, without a throw,
//                    through renderScene as well; the app shows the size card below 40x10 (tests/classic-size-card*.test.js), so these are the scene alone
//   concentric       along a ray from the vanishing point the lit/dark changes come at least four times between the eye and the edge and the rings get wider with the radius (a log depth)
//   spokes           on a circle round the vanishing point the lit/dark changes number the seed's spokes
//   eye              every pixel nearer the vanishing point than the eye (EYE) is dark; the picture just outside it is not
//   flow             the picture 0.3 s later matches the old one better when its radius is scaled OUTWARDS than inwards: the rings flow outwards, at the real-time rate at every speed
//   bend             the vanishing point drifts over a minute (a few cells) and stays on the screen
//   not blank        the lit share stays in a stated band at 80x24, 120x40 and 41x11, seeds 1 to 8, over 60 s; and it is never still: a different picture a second later
//   deterministic    the same seed and the same steps give the same frames; other seeds differ; two real-app runs meter the same
//   invert           the real `i` key and the saved config give the same glyphs with the colours swapped
//   cost             240x67 and 400x100 within COUNTED work (cells given a depth: Math.log calls, at most two a cell and none in a step), no wall clock
import test from 'node:test';
import assert from 'node:assert/strict';
import tunnel, { ideal, eyeAt, EYE, RING_SCALE, FLY, TWIST, TUNNEL_GLYPHS } from '../src/scenes/tunnel.js';
import { renderScene } from '../src/cells.js';
import { runLife } from './helpers-life-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { SCENE_INDEX } from './helpers-wb-flash.js';

const SENTINEL = 0xffff;
const phaseOf = (seed) => (((seed | 0) * 0.37) % 1 + 1) % 1;
const spokesOf = (seed) => 10 + 2 * ((((seed | 0) % 5) + 5) % 5);

function sim(W, H, seed, steps, onStep) {
  const s = tunnel.init(W, H, seed);
  for (let k = 1; k <= steps; k++) { tunnel.step(s, 1); if (onStep) onStep(s, k); }
  return s;
}
function drawn(s, W, H, seed = 1) {
  const params = { seed, glyphs: new Uint16Array(W * H).fill(SENTINEL), colours: new Uint8Array(W * H).fill(0xff) };
  tunnel.draw(s, params);
  return params;
}
// the share of lit pixels (two to a cell: U+2580 and U+2584 light one, U+2588 both)
const litShare = (g) => { let n = 0; for (let i = 0; i < g.length; i++) n += g[i] === 0x2588 ? 2 : g[i] === 32 ? 0 : 1; return n / (2 * g.length); };
// the picture at scene time T as a grid of square pixels (2 per cell down): 1 lit, 0 dark
function pixels(T, W, H, seed) {
  const g = renderScene(ideal, T, W, H, seed).glyphs, P = new Uint8Array(W * 2 * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = g[y * W + x];
    P[2 * y * W + x] = v === 0x2580 || v === 0x2588 ? 1 : 0;
    P[(2 * y + 1) * W + x] = v === 0x2584 || v === 0x2588 ? 1 : 0;
  }
  return P;
}
const at = (P, W, H2, x, y) => { const i = Math.floor(x), j = Math.floor(y); return i < 0 || j < 0 || i >= W || j >= H2 ? -1 : P[j * W + i]; };

test('DRIFT-12 the tunnel is a sim on the real-time clock (kind sim, realClock, init/step/draw) and keeps its id; the ideal picture is a pure cells scene', () => {
  assert.equal(tunnel.id, 'tunnel');
  assert.equal(tunnel.kind, 'sim');
  assert.equal(tunnel.realClock, true);
  for (const f of ['init', 'step', 'draw']) assert.equal(typeof tunnel[f], 'function', f);
  assert.equal(ideal.kind, 'cells');
});

test('DRIFT-12 the sim draws the ideal picture at step / 30 s, cell for cell (80x24, 41x11, 120x40, seeds 1 to 3)', () => {
  for (const [W, H] of [[80, 24], [41, 11], [120, 40]]) {
    for (const seed of [1, 2, 3]) {
      sim(W, H, seed, 300, (s, k) => {
        if (k % 50) return;
        const a = drawn(s, W, H, seed).glyphs, b = renderScene(ideal, k / 30, W, H, seed).glyphs;
        assert.deepEqual(Array.from(a), Array.from(b), `${W}x${H} seed ${seed} step ${k}`);
      });
    }
  }
});

test('DRIFT-12 tunnel: two-tone and the glyph allow-list at 80x24, 41x11 and 40x10 over 40 s, two seeds; every cell is written', () => {
  for (const [W, H] of [[80, 24], [41, 11], [40, 10]]) {
    for (const seed of [1, 2]) {
      sim(W, H, seed, 40 * 30, (s, k) => {
        if (k % 15) return;
        const p = drawn(s, W, H, seed);
        for (let i = 0; i < W * H; i++) {
          assert.ok(p.glyphs[i] !== SENTINEL && p.colours[i] === 0, `${W}x${H} seed ${seed} step ${k} cell ${i}: written, colour 0`);
          assert.ok(TUNNEL_GLYPHS.includes(p.glyphs[i]), `${W}x${H} seed ${seed} step ${k}: U+${p.glyphs[i].toString(16)}`);
        }
      });
    }
  }
});

test('DRIFT-12 tunnel: empty and tiny boards (0x0, 1x1, 3x2, 10x4) do not throw over 40 s of steps and write every cell, also through renderScene (the app shows the size card there; this is the scene alone)', () => {
  for (const [W, H] of [[0, 0], [1, 1], [3, 2], [10, 4], [5, 0], [0, 5]]) {
    sim(W, H, 1, 40 * 30, (s, k) => {
      if (k % 30) return;
      const p = drawn(s, W, H);
      assert.equal(p.glyphs.length, W * H);
      for (let i = 0; i < W * H; i++) assert.ok(p.glyphs[i] !== SENTINEL && p.colours[i] === 0 && TUNNEL_GLYPHS.includes(p.glyphs[i]), `${W}x${H} step ${k} cell ${i}`);
    });
    for (const t of [0, 1.7, 13, 40]) {
      const f = renderScene(tunnel, t, W, H, 1);
      assert.equal(f.glyphs.length, W * H);
      assert.ok(f.colours.every((v) => v === 0));
    }
  }
});

// the radii of the ring edges in the picture at T: at an edge the pixel just inside and the pixel just outside differ at (nearly) every angle; inside a ring they differ only where a spoke edge runs
function ringEdges(P, W, H, T, seed) {
  const [cx, cy] = eyeAt(T, W, H, phaseOf(seed)), edges = [];
  let run = [];
  for (let r = 2 * EYE; r <= 34; r += 0.1) { // from twice the eye's radius: the dark of the eye is not a ring edge
    let diff = 0, n = 0;
    for (let i = 0; i < 360; i++) {
      const ang = (i / 360) * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
      const a = at(P, W, 2 * H, cx + (r - 0.55) * c, cy + (r - 0.55) * s), b = at(P, W, 2 * H, cx + (r + 0.55) * c, cy + (r + 0.55) * s);
      if (a < 0 || b < 0) continue;
      n++;
      if (a !== b) diff++;
    }
    if (n > 300 && diff / n > 0.6) run.push(r);
    else if (run.length) { edges.push((run[0] + run[run.length - 1]) / 2); run = []; }
  }
  return edges;
}

test('DRIFT-12 tunnel is concentric: the ring edges are circles round the vanishing point, at least three between twice the eye and 34 pixels out, each about exp(1 / RING_SCALE) = 1.52 times the radius of the one inside (a log depth: the rings widen with the radius), 120x40, seeds 1 to 8, four times each', () => {
  const ratio = Math.exp(1 / RING_SCALE);
  let edgesSeen = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    for (const T of [2, 5, 11, 23]) {
      const W = 120, H = 40, e = ringEdges(pixels(T, W, H, seed), W, H, T, seed);
      assert.ok(e.length >= 3, `seed ${seed} t ${T}: ${e.length} ring edges (${e.map((x) => x.toFixed(1))})`);
      for (let i = 1; i < e.length; i++) {
        const q = e[i] / e[i - 1];
        assert.ok(Math.abs(q / ratio - 1) < 0.1, `seed ${seed} t ${T}: edge ${i} at ${e[i].toFixed(1)} is ${q.toFixed(3)} times the one inside (${ratio.toFixed(3)} expected; edges ${e.map((x) => x.toFixed(1))})`);
        edgesSeen++;
      }
    }
  }
  assert.ok(edgesSeen >= 60, `${edgesSeen} edge pairs checked`);
});

test('DRIFT-12 tunnel alternates ring by ring: the pattern round a circle in one ring is the opposite of the pattern round the next ring out (a checkerboard), 120x40, seeds 1 to 8', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const W = 120, H = 40, T = 7, P = pixels(T, W, H, seed), [cx, cy] = eyeAt(T, W, H, phaseOf(seed)), flow = T * FLY + phaseOf(seed);
    const mids = [];
    for (let n = -60; n < 30; n++) { const c = Math.exp((n + 0.5 + flow) / RING_SCALE); if (c >= 6 && c <= 30) mids.push(c); }
    assert.ok(mids.length >= 3, `seed ${seed}: three ring middles on screen`);
    const circle = (r) => Array.from({ length: 720 }, (_, i) => at(P, W, 2 * H, cx + r * Math.cos((i / 720) * Math.PI * 2), cy + r * Math.sin((i / 720) * Math.PI * 2)));
    for (let i = 1; i < mids.length; i++) {
      const A = circle(mids[i - 1]), B = circle(mids[i]);
      // the spiral turns the pattern by 0.22 of a spoke a ring: allow that shift in either direction
      const shift = Math.round((TWIST / spokesOf(seed)) * 720);
      let best = 0;
      for (const sh of [-shift, shift]) { let opp = 0; for (let j = 0; j < 720; j++) if (B[j] !== A[(j + sh + 720) % 720]) opp++; best = Math.max(best, opp / 720); }
      assert.ok(best > 0.85, `seed ${seed} rings ${i - 1} and ${i}: ${(100 * best).toFixed(1)} % of the circle is the opposite`);
    }
  }
});

test('DRIFT-12 tunnel has spokes: on a circle round the vanishing point the lit/dark changes number the seed\'s spokes (10 to 18, 120x40, seeds 1 to 8)', () => {
  const W = 120, H = 40;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const T = 7, P = pixels(T, W, H, seed), [cx, cy] = eyeAt(T, W, H, phaseOf(seed));
    // a radius in the middle of a ring (the depth is a whole number plus a half there), so a ring edge never cuts the circle
    const flow = T * FLY + phaseOf(seed);
    let r = 0;
    for (let n = -60; n < 30; n++) { const c = Math.exp((n + 0.5 + flow) / RING_SCALE); if (c >= 9 && c <= 17) r = c; }
    assert.ok(r > 0, 'a mid-ring radius between 9 and 17 exists');
    let prev = null, first = null, cuts = 0;
    for (let i = 0; i < 1440; i++) {
      const ang = (i / 1440) * Math.PI * 2;
      const v = at(P, W, 2 * H, cx + r * Math.cos(ang), cy + r * Math.sin(ang));
      if (v < 0) continue; // below the screen edge
      if (first === null) first = v;
      if (prev !== null && v !== prev) cuts++;
      prev = v;
    }
    // the whole circle is on screen at 120x40 (radius 17 at most): one change a spoke edge
    assert.equal(cuts, spokesOf(seed), `seed ${seed}: ${cuts} changes round the circle of radius ${r.toFixed(1)}`);
  }
});

test('DRIFT-12 tunnel has a clear eye: every pixel nearer the vanishing point than EYE is dark and the ring just outside it is not (80x24, 120x40, 41x11, seeds 1 to 8, 8 times)', () => {
  for (const [W, H] of [[80, 24], [120, 40], [41, 11]]) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const T of [0, 3.3, 9, 20, 41, 60, 77, 100]) {
        const P = pixels(T, W, H, seed), [cx, cy] = eyeAt(T, W, H, phaseOf(seed));
        let outside = 0;
        for (let y = 0; y < 2 * H; y++) for (let x = 0; x < W; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d < EYE - 1e-9) assert.equal(P[y * W + x], 0, `${W}x${H} seed ${seed} t ${T}: pixel ${x},${y} inside the eye is dark`);
          if (d >= EYE && d < 3 * EYE) outside += P[y * W + x];
        }
        assert.ok(outside > 0, `${W}x${H} seed ${seed} t ${T}: something is lit just outside the eye`);
      }
    }
  }
});

test('DRIFT-12 tunnel flows outwards: the picture 0.3 s later matches the old one better with its radius scaled outwards than inwards, at 80x24 and 120x40, seeds 1 to 8, six times each', () => {
  let better = 0, total = 0;
  for (const [W, H] of [[80, 24], [120, 40]]) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const T of [2, 6, 11, 17, 25, 33]) {
        const dt = 0.3, A = pixels(T, W, H, seed), B = pixels(T + dt, W, H, seed);
        const [cx0, cy0] = eyeAt(T, W, H, phaseOf(seed)), [cx1, cy1] = eyeAt(T + dt, W, H, phaseOf(seed));
        // a ring at radius r moves to r * exp(FLY * dt / RING_SCALE): the scale an outward flow predicts
        const f = Math.exp((FLY * dt) / RING_SCALE);
        const score = (scale) => {
          let same = 0, n = 0;
          for (let y = 0; y < 2 * H; y++) for (let x = 0; x < W; x++) {
            const dx = x + 0.5 - cx1, dy = y + 0.5 - cy1, d = Math.hypot(dx, dy);
            if (d < 3 * EYE || d > 0.45 * H * 2) continue;
            const v = at(A, W, 2 * H, cx0 + dx / scale, cy0 + dy / scale);
            if (v < 0) continue;
            n++;
            if (v === B[y * W + x]) same++;
          }
          return same / n;
        };
        const out = score(f), inn = score(1 / f);
        total++;
        if (out > inn) better++;
      }
    }
  }
  assert.equal(better, total, `${better} of ${total} pictures flow outwards`);
});

test('DRIFT-12 tunnel bends: the vanishing point drifts by at least 2 cells across and 1 half row down over a minute, and stays on the screen (80x24, 120x40, seeds 1 to 8)', () => {
  for (const [W, H] of [[80, 24], [120, 40]]) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (let k = 0; k <= 60 * 30; k += 10) {
        const [cx, cy] = eyeAt(k / 30, W, H, phaseOf(seed));
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
      }
      assert.ok(maxX - minX >= 2 && maxY - minY >= 1, `${W}x${H} seed ${seed}: drift ${(maxX - minX).toFixed(1)} x ${(maxY - minY).toFixed(1)}`);
      assert.ok(minX > 0 && maxX < W && minY > 0 && maxY < 2 * H, `${W}x${H} seed ${seed}: on the screen`);
    }
  }
});

test('DRIFT-12 tunnel is not blank and never still: the lit share of pixels stays within 40 to 60 % (measured 42.0 to 56.0) at 80x24, 120x40 and 41x11 over 60 s, seeds 1 to 8, and the picture a second later is different', () => {
  const bands = {};
  for (const [W, H] of [[80, 24], [120, 40], [41, 11]]) {
    let lo = 1, hi = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      let prev = null, changed = 0, looks = 0;
      sim(W, H, seed, 60 * 30, (s, k) => {
        if (k % 30) return;
        const g = drawn(s, W, H, seed).glyphs, share = litShare(g);
        lo = Math.min(lo, share); hi = Math.max(hi, share);
        assert.ok(share >= 0.40 && share <= 0.60, `${W}x${H} seed ${seed} t ${k / 30}: ${(100 * share).toFixed(1)} % lit`);
        if (prev) { let n = 0; for (let i = 0; i < g.length; i++) if (g[i] !== prev[i]) n++; looks++; if (n >= g.length * 0.05) changed++; }
        prev = g.slice();
      });
      assert.ok(changed >= looks - 1, `${W}x${H} seed ${seed}: ${changed} of ${looks} seconds changed at least 5 % of the cells`);
    }
    bands[`${W}x${H}`] = [lo, hi];
  }
  console.log(`tunnel lit share over 60 s, seeds 1 to 8: ${Object.entries(bands).map(([k, v]) => `${k} ${(100 * v[0]).toFixed(1)} to ${(100 * v[1]).toFixed(1)} %`).join(', ')}`);
});

test('DRIFT-12 tunnel: the same seed and the same steps give the same frames; another seed differs; two real-app runs meter the same', async () => {
  for (const [W, H] of [[80, 24], [41, 11]]) {
    const a = sim(W, H, 5, 600), b = sim(W, H, 5, 600), c = sim(W, H, 6, 600);
    assert.deepEqual(Array.from(drawn(a, W, H, 5).glyphs), Array.from(drawn(b, W, H, 5).glyphs));
    assert.notDeepEqual(Array.from(drawn(a, W, H, 5).glyphs), Array.from(drawn(c, W, H, 6).glyphs), 'seed matters');
  }
  const [x, y] = await Promise.all([1, 2].map(() => runLife({ cols: 40, rows: 12, mode: '256', seed: 3, clock: 'grid', seconds: 8, scene: 'tunnel', startScene: SCENE_INDEX.tunnel })));
  assert.deepEqual(x.rep.l3, y.rep.l3);
  for (const r of [x, y]) assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], 'the same run passes the five rules');
  assert.equal(x.frames, y.frames);
});

test('DRIFT-12 tunnel: the real i key and the saved invert setting give the same glyphs with the colours swapped (white on black becomes black on white)', async () => {
  const grab = (store) => (k, screen, app, f) => { if (k === 100) store.f = { g: f.glyphs.slice(), fg: f.fg.slice(), bg: f.bg.slice() }; };
  const base = { cols: 40, rows: 12, mode: 'truecolor', seed: 1, clock: 'grid', seconds: 8, scene: 'tunnel', startScene: SCENE_INDEX.tunnel };
  const a = {}, b = {}, c = {};
  await runLife({ ...base, grab: grab(a) });
  await runLife({ ...base, invert: true, grab: grab(b) });
  await runLife({ ...base, keys: [{ at: 0.5, key: 'i' }], grab: grab(c) });
  const lit = a.f.g.findIndex((v) => v !== 32 && v !== 0), blank = a.f.g.findIndex((v) => v === 32);
  assert.ok(lit >= 0 && blank >= 0, 'the frame has lit and blank cells');
  assert.deepEqual(Array.from(a.f.g), Array.from(b.f.g), 'the same glyphs inverted');
  assert.deepEqual(Array.from(a.f.g), Array.from(c.f.g), 'the same glyphs after the i key');
  assert.equal(a.f.fg[lit], 0xffffff); assert.equal(a.f.bg[lit], 0);
  for (const x of [b, c]) { assert.equal(x.f.fg[lit], 0); assert.equal(x.f.bg[lit], 0xffffff); assert.equal(x.f.bg[blank], 0xffffff); }
  assert.equal(a.f.bg[blank], 0);
});

// ---- cost: counted work, never a wall clock. A step does no work on the cells; a draw gives each pixel row of a cell at most one depth (one Math.log)
test('DRIFT-12 tunnel at 240x67 and 400x100 over 40 s (1200 steps): the steps work out no cell (no Math.log), a drawn frame at most two depths a cell, and a frame the same as the ideal', () => {
  const realLog = Math.log;
  let logs = 0;
  Math.log = (x) => { logs++; return realLog(x); };
  try {
    for (const [W, H] of [[240, 67], [400, 100]]) {
      const cells = W * H;
      logs = 0;
      const s = sim(W, H, 1, 40 * 30);
      assert.equal(logs, 0, `${W}x${H}: ${logs} depths worked out in 1200 steps, none`);
      drawn(s, W, H);
      assert.ok(logs > 0 && logs <= 2 * cells, `${W}x${H}: ${logs} depths worked out for one frame, at most ${2 * cells} (two a cell)`);
      const a = drawn(s, W, H).glyphs, b = renderScene(ideal, 40, W, H, 1).glyphs;
      assert.deepEqual(Array.from(a), Array.from(b), `${W}x${H}: the frame is the ideal at 40 s`);
    }
  } finally { Math.log = realLog; }
});
