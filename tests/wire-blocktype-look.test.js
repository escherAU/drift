// DRIFT-11: the wire and blocktype scenes of Classic high contrast are still what they are after they were turned into followers (src/scenes/follow.js): a rotating cube then a torus in braille dots,
// big block words with wipe, scroll and wave changes. What this file pins (the flash rules are tests/wire-blocktype-flash*.test.js; the controls are wire-blocktype-flash-controls):
//   two-tone and glyphs   colour index 0 only; wire draws braille U+2801..U+28FF (and space), blocktype space, U+2580, U+2584 and U+2588; every cell of every buffer is written (a sentinel fill
//                         is gone after draw), on 0x0, 1x1, 3x2 and 10x4 too, over 40 s of steps, without a throw
//   invert                the real `i` key and the saved config give the same glyphs with the colours swapped (white on black becomes black on white)
//   deterministic         the same seed and the same steps give the same frames; other seeds differ (wire's starting orientation, blocktype's word order)
//   not blank             the lit share of the shown frame at 80x24 and 120x40 stays in a stated band
//   wire                  the shown picture settles onto its pose: 12 steps (0.4 s) after every beat of 18 steps the shown frame IS the ideal frame (100 % of the cells, measured at 80x24, 120x40, 41x11,
//                         20x6 and 10x4, seeds 1 to 3), so the cube phase shows one connected shape and the torus phase at most two (as tests/contrast-scenes.test.js asserts of the ideal)
//   blocktype             in every hold (from 1 s into a slot to the start of the transition) the shown frame IS the ideal frame, cell for cell (the whole word readable); all eight words are reached; the three
//                         transitions are all reached and differ from each other and from the holds
//   cost                  240x67 and 400x100 within COUNTED work (the follower's own counters: cells visited, cells changed, targets worked out), no wall-clock
import test from 'node:test';
import assert from 'node:assert/strict';
import wire, { ideal as wireIdeal, phaseAt, PHASE_SECONDS } from '../src/scenes/wire.js';
import blocktype, { ideal as blockIdeal, BLOCK_WORDS, SLOT_SECONDS, TRANSITION_SECONDS, wordIndexAt } from '../src/scenes/blocktype.js';
import { FLIP_SHARE } from '../src/scenes/follow.js';
import { renderScene } from '../src/cells.js';
import { runLife } from './helpers-life-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { SCENE_INDEX } from './helpers-wb-flash.js';

const SCENES = { wire, blocktype };
const BLOCK_GLYPHS = [32, 0x2580, 0x2584, 0x2588];
const okGlyph = (name, g) => (name === 'wire' ? g === 32 || (g >= 0x2801 && g <= 0x28ff) : BLOCK_GLYPHS.includes(g));
const SENTINEL = 0xffff;

function sim(scene, W, H, seed, steps, onStep) {
  const s = scene.init(W, H, seed);
  for (let k = 1; k <= steps; k++) { scene.step(s, 1); if (onStep) onStep(s, k); }
  return s;
}
function drawn(scene, s, W, H) {
  const params = { seed: 1, glyphs: new Uint16Array(W * H).fill(SENTINEL), colours: new Uint8Array(W * H).fill(0xff) };
  scene.draw(s, params);
  return params;
}
const litShare = (g) => { let n = 0; for (let i = 0; i < g.length; i++) if (g[i] !== 32) n++; return n / g.length; };
function components(g, W, H) {
  const seen = new Uint8Array(W * H);
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    if (g[i] === 32 || seen[i]) continue;
    n++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop(), x = j % W, y = (j / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const k = yy * W + xx;
        if (g[k] !== 32 && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
  }
  return n;
}

test('DRIFT-11 both scenes are sims on the real-time clock (kind sim, realClock, init/step/draw) and keep their ids; the ideal pictures are pure cells scenes', () => {
  for (const [name, sc] of Object.entries(SCENES)) {
    assert.equal(sc.id, name);
    assert.equal(sc.kind, 'sim');
    assert.equal(sc.realClock, true);
    for (const f of ['init', 'step', 'draw']) assert.equal(typeof sc[f], 'function', `${name}.${f}`);
  }
  assert.equal(wireIdeal.kind, 'cells');
  assert.equal(blockIdeal.kind, 'cells');
});

for (const [name, sc] of Object.entries(SCENES)) {
  test(`DRIFT-11 ${name}: two-tone and the glyph allow-list at 80x24, 41x11 and 10x4 over 40 s, two seeds; every cell is written`, () => {
    for (const [W, H] of [[80, 24], [41, 11], [10, 4]]) {
      for (const seed of [1, 2]) {
        sim(sc, W, H, seed, 40 * 30, (s, k) => {
          if (k % 15) return;
          const p = drawn(sc, s, W, H);
          for (let i = 0; i < W * H; i++) {
            assert.ok(p.glyphs[i] !== SENTINEL && p.colours[i] === 0, `${name} ${W}x${H} seed ${seed} step ${k} cell ${i}: written, colour 0`);
            assert.ok(okGlyph(name, p.glyphs[i]), `${name} ${W}x${H} seed ${seed} step ${k}: U+${p.glyphs[i].toString(16)}`);
          }
        });
      }
    }
  });
  test(`DRIFT-11 ${name}: empty and tiny boards (0x0, 1x1, 3x2, 10x4) do not throw over 40 s of steps and write every cell, also through renderScene`, () => {
    for (const [W, H] of [[0, 0], [1, 1], [3, 2], [10, 4], [5, 0], [0, 5]]) {
      sim(sc, W, H, 1, 40 * 30, (s, k) => {
        if (k % 30) return;
        const p = drawn(sc, s, W, H);
        assert.equal(p.glyphs.length, W * H);
        for (let i = 0; i < W * H; i++) assert.ok(p.glyphs[i] !== SENTINEL && p.colours[i] === 0 && okGlyph(name, p.glyphs[i]), `${name} ${W}x${H} step ${k} cell ${i}`);
      });
      for (const t of [0, 1.7, 13, 40]) {
        const f = renderScene(sc, t, W, H, 1);
        assert.equal(f.glyphs.length, W * H);
        assert.ok(f.colours.every((v) => v === 0));
      }
    }
  });
  test(`DRIFT-11 ${name}: the same seed and the same steps give the same frames; another seed differs`, () => {
    for (const [W, H] of [[80, 24], [20, 6]]) {
      const a = sim(sc, W, H, 5, 600), b = sim(sc, W, H, 5, 600), c = sim(sc, W, H, 6, 600);
      assert.deepEqual(Array.from(drawn(sc, a, W, H).glyphs), Array.from(drawn(sc, b, W, H).glyphs));
      if (W === 80) assert.notDeepEqual(Array.from(drawn(sc, a, W, H).glyphs), Array.from(drawn(sc, c, W, H).glyphs), 'seed matters');
    }
    // the same through the real app: two runs of the same seed meter the same, and read back the same last screen
    return Promise.all([1, 2].map(() => runLife({ cols: 40, rows: 12, mode: '256', seed: 3, clock: 'grid', seconds: 8, scene: name, startScene: SCENE_INDEX[name] }))).then(([x, y]) => {
      assert.deepEqual(x.rep.l3, y.rep.l3);
      for (const r of [x, y]) assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `${name}: the same run passes the five rules`);
      assert.equal(x.frames, y.frames);
    });
  });
  test(`DRIFT-11 ${name}: the real i key and the saved invert setting give the same glyphs with the colours swapped (white on black becomes black on white)`, async () => {
    const grab = (store) => (k, screen, app, f) => { if (k === 100) store.f = { g: f.glyphs.slice(), fg: f.fg.slice(), bg: f.bg.slice() }; };
    const base = { cols: 40, rows: 12, mode: 'truecolor', seed: 1, clock: 'grid', seconds: 8, scene: name, startScene: SCENE_INDEX[name] };
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
}

// ---- wire
test('DRIFT-11 wire is not blank: at 80x24 the lit share of the shown frame stays within 5 to 14 % in the cube phase and 8 to 25 % in the torus phase (measured 7.1 to 11.3 and 10.4 to 22.0), at 120x40 within 3.5 to 10 and 7.5 to 22 (4.6 to 8.0 and 9.3 to 18.9), seeds 1 to 8', () => {
  const bands = { '80x24': [[5, 14], [8, 25]], '120x40': [[3.5, 10], [7.5, 22]] };
  for (const [W, H] of [[80, 24], [120, 40]]) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      sim(wire, W, H, seed, 25 * 30, (s, k) => {
        const T = k / 30;
        const ph = T >= 2 && T <= 11 ? 0 : T >= 15 && T <= 24 ? 1 : -1;
        if (ph < 0 || k % 6) return;
        const share = 100 * litShare(s.F.shown), [lo, hi] = bands[`${W}x${H}`][ph];
        assert.ok(share >= lo && share <= hi, `${W}x${H} seed ${seed} t ${T.toFixed(1)} ${ph ? 'torus' : 'cube'}: ${share.toFixed(1)} % lit`);
      });
    }
  }
});

test('DRIFT-11 wire shows the cube then the torus: 12 steps (0.4 s) after every beat of 18 steps the shown frame is the ideal frame (100 % of the cells) at five sizes, seeds 1 to 3; the cube is one connected shape and the torus at most two at 120x40', () => {
  let cubeShapes = 0, torusShapes = 0, checked = 0;
  for (const [W, H] of [[80, 24], [120, 40], [41, 11], [20, 6], [10, 4]]) {
    for (const seed of [1, 2, 3]) {
      sim(wire, W, H, seed, 28 * 30, (s, k) => {
        if (k < 60 || k % 18 !== 12) return;
        const beat = k - 12, T = beat / 30;
        const ideal = renderScene(wireIdeal, T, W, H, seed).glyphs;
        let same = 0;
        for (let i = 0; i < W * H; i++) if (s.F.shown[i] === ideal[i]) same++;
        assert.equal(same, W * H, `${W}x${H} seed ${seed} t ${T.toFixed(2)}: the shown frame equals the ideal (${(100 * same / (W * H)).toFixed(1)} %)`);
        checked++;
        if (W === 120 && T > 2 && T < 11) { assert.equal(phaseAt(T), 'cube'); assert.equal(components(s.F.shown, W, H), 1, `cube t ${T.toFixed(2)}`); cubeShapes++; }
        if (W === 120 && T > PHASE_SECONDS + 2 && T < 2 * PHASE_SECONDS - 2) { assert.equal(phaseAt(T), 'torus'); const n = components(s.F.shown, W, H); assert.ok(n >= 1 && n <= 2, `torus t ${T.toFixed(2)}: ${n} shapes`); torusShapes++; }
      });
    }
  }
  assert.ok(checked > 600 && cubeShapes > 30 && torusShapes > 30, `checked ${checked} settled frames, ${cubeShapes} cube, ${torusShapes} torus`);
});

test('DRIFT-11 wire turns: the shown picture changes between beats about every 0.6 s (a new pose each beat), and is blank only while the shape grows and shrinks at the phase switches', () => {
  const W = 80, H = 24;
  let prev = null, changes = 0, beats = 0, blankSteps = 0;
  sim(wire, W, H, 1, 28 * 30, (s, k) => {
    if (k % 18 === 17) { // just before the next beat: the picture has settled on this one
      const cur = Array.from(s.F.shown).join(',');
      if (prev !== null && cur !== prev) changes++;
      prev = cur; beats++;
    }
    if (litShare(s.F.shown) === 0) blankSteps++;
  });
  assert.ok(changes >= beats - 3, `${changes} of ${beats} beats changed the picture`);
  assert.ok(blankSteps <= 2 * 30 * 0.8 + 30, `blank for ${blankSteps} steps in 28 s (the grow at the start and at each switch: under 1 s each)`);
});

// ---- blocktype
test('DRIFT-11 blocktype is not blank: at 80x24 the lit share of the shown frame in the holds stays within 9 to 20 % (measured 11.3 to 18.3), at 120x40 within 6 to 13 % (7.9 to 11.3), seeds 1 to 8', () => {
  const bands = { '80x24': [9, 20], '120x40': [6, 13] };
  for (const [W, H] of [[80, 24], [120, 40]]) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      sim(blocktype, W, H, seed, 30 * 30, (s, k) => {
        const loc = (k / 30) % SLOT_SECONDS;
        if (loc < 1 || loc > SLOT_SECONDS - TRANSITION_SECONDS - 0.1 || k % 6) return;
        const share = 100 * litShare(s.F.shown), [lo, hi] = bands[`${W}x${H}`];
        assert.ok(share >= lo && share <= hi, `${W}x${H} seed ${seed} t ${(k / 30).toFixed(1)}: ${share.toFixed(1)} % lit`);
      });
    }
  }
});

test('DRIFT-11 blocktype shows the whole word in every hold: from 1 s into a slot to the start of the transition the shown frame IS the ideal frame, cell for cell (five sizes, seeds 1 to 3, 30 s); all eight words are reached', () => {
  const words = new Set();
  let checked = 0;
  for (const [W, H] of [[80, 24], [120, 40], [41, 11], [20, 6], [10, 4]]) {
    for (const seed of [1, 2, 3]) {
      const seen = new Set();
      sim(blocktype, W, H, seed, 48 * 30, (s, k) => {
        const T = k / 30, loc = T % SLOT_SECONDS;
        if (loc < 1 || loc >= SLOT_SECONDS - TRANSITION_SECONDS - 1 / 30) return;
        const ideal = renderScene(blockIdeal, T, W, H, seed).glyphs;
        for (let i = 0; i < W * H; i++) if (s.F.shown[i] !== ideal[i]) assert.fail(`${W}x${H} seed ${seed} t ${T.toFixed(2)} cell ${i}: shown U+${s.F.shown[i].toString(16)}, ideal U+${ideal[i].toString(16)}`);
        seen.add(BLOCK_WORDS[wordIndexAt(T, seed)]);
        checked++;
      });
      if (W === 80) for (const w of seen) words.add(w);
      assert.equal(seen.size, BLOCK_WORDS.length, `${W}x${H} seed ${seed}: eight slots, eight words (${[...seen]})`);
    }
  }
  assert.equal(words.size, BLOCK_WORDS.length);
  assert.ok(checked > 10000, `${checked} hold frames compared`);
});

test('DRIFT-11 blocktype reaches the wipe, the scroll and the wave: the three mid-transition frames differ from each other and from both holds, and each transition settles on the next word', () => {
  const W = 80, H = 24;
  for (const seed of [1, 2, 3]) {
    const frames = {};
    sim(blocktype, W, H, seed, 18 * 30, (s, k) => {
      const T = k / 30, slot = Math.floor(T / SLOT_SECONDS), loc = T - slot * SLOT_SECONDS;
      if (Math.abs(loc - (SLOT_SECONDS - TRANSITION_SECONDS / 2)) < 1 / 60) frames[slot] = Array.from(s.F.shown);
      if (loc > 0.99 && loc < 1.01) frames['hold' + slot] = Array.from(s.F.shown);
    });
    for (const k of [0, 1, 2]) assert.ok(frames[k] && frames['hold' + k], `slot ${k} sampled`);
    const key = (a) => a.join(',');
    const set = new Set([key(frames[0]), key(frames[1]), key(frames[2]), key(frames.hold0), key(frames.hold1), key(frames.hold2)]);
    assert.equal(set.size, 6, `seed ${seed}: wipe, scroll and wave mid-frames and three holds are six different pictures`);
    // mid-transition pictures are not words: each is neither the word before nor the word after
    for (const k of [0, 1, 2]) {
      assert.notEqual(key(frames[k]), key(frames['hold' + k]));
      assert.notEqual(key(frames[k]), key(frames['hold' + (k + 1)] || []));
    }
  }
});

// ---- cost: counted work, never a wall clock
for (const [name, sc] of Object.entries(SCENES)) {
  test(`DRIFT-11 ${name} at 240x67 and 400x100 over 40 s (1200 steps): counted work stays within the bounds (cells visited, cells changed, targets worked out)`, () => {
    for (const [W, H] of [[240, 67], [400, 100]]) {
      const cells = W * H, steps = 40 * 30;
      const s = sim(sc, W, H, 1, steps);
      assert.ok(s.F.visits <= steps * cells, `${name} ${W}x${H}: ${s.F.visits} cells visited, at most one visit of every cell each step (${steps * cells})`);
      assert.ok(s.F.flips <= steps * (Math.floor(cells * FLIP_SHARE) + 1), `${name} ${W}x${H}: ${s.F.flips} cells changed, at most ${FLIP_SHARE} of the cells a step`);
      if (name === 'wire') assert.equal(s.targets, 1 + Math.floor(steps / 18), 'one target at the start and one on every beat of 18 steps');
      else assert.ok(s.targets <= 8 * (Math.round(TRANSITION_SECONDS * 30) + 3), `${s.targets} targets: only while a transition plays and when a slot begins`);
      assert.ok(s.F.flips < cells * 40, `${name} ${W}x${H}: ${s.F.flips} cells changed in 40 s, under 40 changes a cell`);
    }
  });
}
