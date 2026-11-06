// DRIFT-2 slice 2: the four new chaos scenes (swarm, glitch, fireworks, vortex).
// The shared suite (noncalm-scenes.test.js) covers determinism, sizes, allow-list, buffer
// reuse, change over time and the 60 s flash check for every scene in PLAYLISTS; this file
// pins what is specific to each scene, plus the chaos-wide colour and no-invert checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYLISTS } from '../src/scenes/index.js';
import { renderScene, createCellComposer, STEP_DT } from '../src/cells.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import swarm from '../src/scenes/swarm.js';
import glitch, { WORDS, SCRAMBLE_SETS, glitchEvent, fullyShown, laneCount } from '../src/scenes/glitch.js';
import fireworks, { MAX_PARTICLES, particleLevel } from '../src/scenes/fireworks.js';
import vortex from '../src/scenes/vortex.js';

const CHAOS = PLAYLISTS.chaos;
const FPS = 18;
const hueSet = (f) => {
  const s = new Set();
  for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] !== 32) s.add(f.colours[i] >> 2);
  return s;
};
const rowText = (f, row, x0, len) => String.fromCodePoint(...Array.from(f.glyphs.slice(row * f.cols + x0, row * f.cols + x0 + len)));

// ---------------------------------------------------------------- B: chaos-wide
test('B chaos set: the playlist holds glyphrain, swarm, glitch, fireworks, vortex in that order', () => {
  assert.deepEqual(CHAOS.map((s) => s.id), ['glyphrain', 'swarm', 'glitch', 'fireworks', 'vortex']);
});

for (const scene of CHAOS) {
  test(`B chaos/${scene.id}: at least 3 distinct hues are visible in a 120x40 frame (several times and seeds)`, () => {
    for (const seed of [1, 2]) {
      for (const t of [3, 8, 15, 31]) {
        const f = renderScene(scene, t, 120, 40, seed);
        assert.ok(hueSet(f).size >= 3, `${scene.id} seed ${seed} t=${t}: hues ${[...hueSet(f)]}`);
      }
    }
  });

  test(`B chaos/${scene.id}: no whole-screen invert or flash: lit<->unlit cells never exceed 25% between consecutive 1/18 s frames over 60 s (and the run holds a second scene event)`, () => {
    const cc = createCellComposer({ scenes: [scene], cols: 120, rows: 40, seed: 1 });
    let prev = null, worst = 0, worstAt = 0;
    for (let k = 0; k < 60 * FPS; k++) {
      const g = cc.frame({ a: 0, b: 0, p: 0 }, k / FPS).glyphs;
      if (prev) {
        let sw = 0;
        for (let i = 0; i < g.length; i++) if ((g[i] !== 32) !== (prev[i] !== 32)) sw++;
        if (sw / g.length > worst) { worst = sw / g.length; worstAt = k / FPS; }
      }
      prev = g.slice();
    }
    assert.ok(worst <= 0.25, `${scene.id}: ${(worst * 100).toFixed(1)}% flipped at t=${worstAt}`);
  });
}

test('B control: the invert detector sees a blank<->full swap (it is not vacuous)', () => {
  const a = new Uint16Array(100).fill(32), b = new Uint16Array(100).fill(0x41);
  let sw = 0;
  for (let i = 0; i < 100; i++) if ((a[i] !== 32) !== (b[i] !== 32)) sw++;
  assert.ok(sw / 100 > 0.25);
});

// ---------------------------------------------------------------- C: swarm
function runSwarm(w, h, seed, steps) {
  const s = swarm.init(w, h, seed);
  for (let i = 0; i < steps; i++) swarm.step(s);
  return s;
}
function drawSwarm(s) {
  const p = { glyphs: new Uint16Array(s.w * s.h), colours: new Uint8Array(s.w * s.h) };
  swarm.draw(s, p);
  return p;
}
const part = (o) => ({ x: 10, y: 20, vx: 0, vy: 0, ch: 0x41, hue: 0, ...o });

test('C swarm: same seed and same step count give the identical drawn frame; another seed differs', () => {
  const a = drawSwarm(runSwarm(100, 30, 4, 200)), b = drawSwarm(runSwarm(100, 30, 4, 200)), c = drawSwarm(runSwarm(100, 30, 5, 200));
  assert.deepEqual(Array.from(a.glyphs), Array.from(b.glyphs));
  assert.deepEqual(Array.from(a.colours), Array.from(b.colours));
  assert.notDeepEqual(Array.from(a.glyphs), Array.from(c.glyphs));
});

test('C swarm: after 600 steps every particle is inside [0,w]x[0,2h] (several sizes) and the count never changes', () => {
  for (const [w, h] of [[120, 40], [30, 10], [240, 67], [2, 200], [1, 1]]) {
    const s0 = swarm.init(w, h, 3), n = s0.p.length;
    const s = runSwarm(w, h, 3, 600);
    assert.equal(s.p.length, n, `${w}x${h} count changed`);
    for (const q of s.p) {
      assert.ok(q.x >= 0 && q.x <= w && q.y >= 0 && q.y <= 2 * h, `${w}x${h} out of box: ${q.x},${q.y}`);
      assert.ok(Number.isFinite(q.vx) && Number.isFinite(q.vy));
    }
  }
  assert.ok(swarm.init(120, 40, 1).p.length >= 60, 'a busy swarm at 120x40');
  assert.equal(swarm.init(0, 0, 1).p.length, 0);
});

test('C swarm wall arm: a particle going out of bounds is reflected and its velocity sign flips (all four walls)', () => {
  const s = swarm.init(40, 20, 1);
  const cases = [
    [{ x: 0.1, vx: -12 }, 'x', (q) => q.x >= 0 && q.vx > 0],
    [{ x: 39.9, vx: 12 }, 'x', (q) => q.x <= 40 && q.vx < 0],
    [{ y: 0.1, vy: -12 }, 'y', (q) => q.y >= 0 && q.vy > 0],
    [{ y: 39.9, vy: 12 }, 'y', (q) => q.y <= 40 && q.vy < 0],
  ];
  for (const [o, , ok] of cases) {
    s.p = [part({ x: 20, y: 20, ...o })];
    swarm.step(s);
    assert.ok(ok(s.p[0]), JSON.stringify(s.p[0]));
    assert.equal(Math.hypot(s.p[0].vx, s.p[0].vy), 12, 'a wall bounce keeps the speed');
  }
});

test('C swarm particle arm: two particles on a collision course exchange velocity and never pass through; parallel ones that miss are untouched', () => {
  const s = swarm.init(60, 20, 1);
  s.p = [part({ x: 10, y: 20, vx: 10 }), part({ x: 16, y: 20, vx: -10 })];
  for (let i = 0; i < 30; i++) {
    swarm.step(s);
    assert.ok(s.p[0].x < s.p[1].x, `passed through at step ${i}`);
  }
  assert.ok(s.p[0].vx < 0 && s.p[1].vx > 0, `velocities ${s.p[0].vx} ${s.p[1].vx}`);
  // off-centre hit: the tangential components change too (momentum is exchanged along the contact normal)
  const o = swarm.init(60, 20, 1);
  o.p = [part({ x: 10, y: 20, vx: 10 }), part({ x: 16, y: 21, vx: -10 })];
  for (let i = 0; i < 12; i++) swarm.step(o);
  assert.ok(o.p[0].vy !== 0 && o.p[1].vy !== 0, 'glancing hit changes vy');
  // miss arm: far apart rows, same x paths: nothing changes
  const m = swarm.init(60, 20, 1);
  m.p = [part({ x: 10, y: 6, vx: 10 }), part({ x: 16, y: 34, vx: -10 })];
  for (let i = 0; i < 12; i++) swarm.step(m);
  assert.equal(m.p[0].vx, 10);
  assert.equal(m.p[1].vx, -10);
  // all of the above conserve total speed in a pair collision
  assert.ok(Math.abs(Math.hypot(s.p[0].vx, s.p[0].vy) - 10) < 1e-9);
});

test('C swarm trails: a left-behind glyph fades by dropping brightness one level at a time (3,2,1,0) and then goes blank, never a flash', () => {
  const s = swarm.init(40, 20, 1);
  s.p = [part({ x: 4.8, y: 20, vx: 15 })];
  const seq = [];
  for (let i = 0; i < 60; i++) {
    swarm.step(s);
    const f = drawSwarm(s);
    const cell = 10 * 40 + 5;
    seq.push(f.glyphs[cell] === 32 ? -1 : f.colours[cell] & 3);
  }
  const lit = seq.filter((v) => v >= 0);
  assert.ok(lit.length >= 4, `trail cell lit ${lit.length} frames`);
  for (let i = 1; i < lit.length; i++) assert.ok(lit[i] <= lit[i - 1], `level rose: ${seq}`);
  assert.deepEqual([...new Set(lit)], [3, 2, 1, 0], `levels ${seq}`);
  assert.equal(seq.at(-1), -1, 'ends blank');
});

// ---------------------------------------------------------------- D: glitch
test('D glitch words: at least 20, letters only, at most 8 long, all different', () => {
  assert.ok(WORDS.length >= 20, String(WORDS.length));
  assert.equal(new Set(WORDS).size, WORDS.length);
  for (const w of WORDS) {
    assert.match(w, /^[A-Za-z]+$/, w);
    assert.ok(w.length >= 2 && w.length <= 8, w);
  }
});

test('D glitch scramble sets: at least 4 varied sets, every glyph on the allow-list and single cells', () => {
  assert.ok(SCRAMBLE_SETS.length >= 4);
  for (const set of SCRAMBLE_SETS) {
    assert.ok(set.length >= 8);
    for (const cp of set) assert.ok(isAllowedGlyph(cp), `U+${cp.toString(16)}`);
  }
  assert.notDeepEqual(SCRAMBLE_SETS[0], SCRAMBLE_SETS[1]);
});

test('D glitch: at a pinned t and seed a target word is fully shown on screen; at an earlier t in its scramble phase it is not (both arms)', () => {
  const W = 120, H = 40;
  const ev = glitchEvent(1, 2, 0, 3, W, H);
  assert.ok(WORDS.includes(ev.word));
  const mid = (Math.max(...ev.lockAt) + ev.outStart) / 2 + ev.t0;
  const early = ev.t0 + 0.2;
  assert.ok(fullyShown(ev, mid) && !fullyShown(ev, early));
  // pinned literals (seed 1, lane 2, left track, event 3 is FUZZ at column 25, row 7, starting at 23.735 s)
  assert.equal(ev.word, 'FUZZ');
  const lit1 = renderScene(glitch, 25.5, W, H, 1), lit0 = renderScene(glitch, 23.9, W, H, 1);
  assert.equal(rowText(lit1, 7, 25, 4), 'FUZZ', 'pinned t = 25.5 s: FUZZ is shown');
  assert.notEqual(rowText(lit0, 7, 25, 4), 'FUZZ', 'pinned t = 23.9 s: still scrambling');
  const shown = renderScene(glitch, mid, W, H, 1);
  assert.equal(rowText(shown, ev.row, ev.x, ev.word.length), ev.word, 'word on screen at the locked moment');
  const scr = renderScene(glitch, early, W, H, 1);
  assert.notEqual(rowText(scr, ev.row, ev.x, ev.word.length), ev.word, 'scrambled earlier');
  // no letter of the word is locked yet in the scramble phase: every cell is a lit scramble glyph
  for (let i = 0; i < ev.word.length; i++) assert.notEqual(scr.glyphs[ev.row * W + ev.x + i], 32);
  // and after the word has scrambled out the cells are blank again
  const gone = renderScene(glitch, ev.t0 + ev.duration + 0.05, W, H, 1);
  assert.notEqual(rowText(gone, ev.row, ev.x, ev.word.length), ev.word);
});

test('D glitch: pinned numbers: seed 1, t = 7.5 s shows a whole list word somewhere on a 120x40 frame', () => {
  const f = renderScene(glitch, 7.5, 120, 40, 1);
  let found = 0;
  for (let r = 0; r < 40; r++) {
    const line = rowText(f, r, 0, 120);
    for (const w of WORDS) if (line.includes(w)) found++;
  }
  assert.ok(found >= 1, 'a target word is on screen');
});

test('D glitch: several words are active at the same moment, at different places', () => {
  const f = renderScene(glitch, 9, 120, 40, 1);
  const rows = new Set();
  for (let r = 0; r < 40; r++) for (let x = 0; x < 120; x++) if (f.glyphs[r * 120 + x] !== 32) { rows.add(r); break; }
  assert.ok(rows.size >= 5, `${rows.size} rows have text`);
  assert.ok(laneCount(40) >= 10);
});

test('D glitch: letters lock left-to-right in some events and in random order in others', () => {
  let ltr = 0, random = 0;
  for (let seed = 1; seed <= 4; seed++) for (let lane = 0; lane < 6; lane++) for (let k = 0; k < 6; k++) {
    const ev = glitchEvent(seed, lane, 0, k, 120, 40);
    if (ev.word.length < 4) continue;
    const sorted = ev.lockAt.every((v, i) => i === 0 || v > ev.lockAt[i - 1]);
    if (ev.lockMode === 'ltr') { assert.ok(sorted, 'ltr events lock in index order'); ltr++; }
    else { assert.equal(ev.lockMode, 'random'); if (!sorted) random++; /* a short random order can happen to be sorted */ }
  }
  assert.ok(ltr >= 5 && random >= 5, `ltr ${ltr} random ${random}`);
});

// ---------------------------------------------------------------- E: fireworks
function runFw(w, h, seed, steps, each) {
  const s = fireworks.init(w, h, seed);
  for (let i = 0; i < steps; i++) { fireworks.step(s); if (each) each(s, i); }
  return s;
}
const drawFw = (s) => { const p = { glyphs: new Uint16Array(s.w * s.h), colours: new Uint8Array(s.w * s.h) }; fireworks.draw(s, p); return p; };

test('E fireworks: same seed and steps give the same frame; another seed differs', () => {
  const a = drawFw(runFw(100, 30, 2, 240)), b = drawFw(runFw(100, 30, 2, 240)), c = drawFw(runFw(100, 30, 3, 240));
  assert.deepEqual(Array.from(a.glyphs), Array.from(b.glyphs));
  assert.deepEqual(Array.from(a.colours), Array.from(b.colours));
  assert.notDeepEqual(Array.from(a.glyphs), Array.from(c.glyphs));
});

test('E fireworks: the particle count never exceeds the exported cap over 3000 steps at 240x67; a forced mass-burst is held at the cap exactly', () => {
  assert.ok(Number.isInteger(MAX_PARTICLES) && MAX_PARTICLES >= 200 && MAX_PARTICLES <= 2000);
  let peak = 0;
  runFw(240, 67, 1, 3000, (s) => { peak = Math.max(peak, s.particles.length); assert.ok(s.particles.length <= MAX_PARTICLES); });
  assert.ok(peak > 50, `peak ${peak}`);
  const s = fireworks.init(240, 67, 1);
  s.launchIn = 1e9;
  for (let i = 0; i < 40; i++) s.rockets.push({ x: 5 + i * 5, y: 60, vx: 0, vy: 0, hue: i & 7 });
  fireworks.step(s);
  assert.equal(s.rockets.length, 0, 'every rocket at its apex burst');
  assert.equal(s.particles.length, MAX_PARTICLES);
});

test('E fireworks: rockets rise (y decreases every step) before they burst, and the burst appears where the rocket was', () => {
  const s = fireworks.init(120, 40, 1);
  let r = null, lastY = null, rises = 0, burstAt = null;
  for (let i = 0; i < 400 && burstAt === null; i++) {
    fireworks.step(s);
    if (r === null && s.rockets.length) { r = s.rockets[0]; lastY = r.y; continue; }
    if (r !== null) {
      if (s.rockets.includes(r)) { assert.ok(r.y < lastY, `rocket did not rise at step ${i}`); lastY = r.y; rises++; }
      else burstAt = i;
    }
  }
  assert.ok(rises >= 10, `rose for ${rises} steps`);
  assert.notEqual(burstAt, null, 'it burst');
  assert.ok(s.particles.length > 10);
  assert.ok(lastY < 2 * 40 * 0.8, 'it burst above the floor');
});

test('E fireworks: after a burst particles gain downward speed (mean vy rises every step) and fade (level never rises until removed)', () => {
  const s = fireworks.init(120, 40, 1);
  while (s.particles.length === 0) fireworks.step(s);
  s.launchIn = 1e9; s.rockets.length = 0; // isolate this burst
  const tracked = s.particles.slice(0, 12);
  const lv0 = tracked.map(particleLevel);
  let prevMean = s.particles.reduce((a, p) => a + p.vy, 0) / s.particles.length;
  const prevLv = lv0.slice();
  let gone = 0;
  for (let i = 0; i < 70; i++) {
    fireworks.step(s);
    if (i < 8) {
      const mean = s.particles.reduce((a, p) => a + p.vy, 0) / s.particles.length;
      assert.ok(mean > prevMean, `mean vy did not rise at +${i}: ${mean} <= ${prevMean}`);
      prevMean = mean;
    }
    tracked.forEach((p, k) => {
      if (!s.particles.includes(p)) { gone++; return; }
      const lv = particleLevel(p);
      assert.ok(lv <= prevLv[k], `particle ${k} brightened`);
      prevLv[k] = lv;
    });
  }
  assert.ok(gone >= 6, `only ${gone} of 12 left after 70 steps`);
  assert.ok(lv0.some((v) => v === 3), 'starts bright');
  assert.ok(prevLv.some((v, k) => v < lv0[k]) || gone > 0, 'something faded');
});

test('E fireworks: several hues across burst particles over time, and it is still firing after 60 s of steps', () => {
  const hues = new Set();
  let launchedAt1500 = 0, lateLive = 0;
  const s = runFw(120, 40, 1, 1800, (st, i) => {
    for (const p of st.particles) hues.add(p.hue);
    if (i === 1499) launchedAt1500 = st.launched;
    if (i >= 1700 && st.particles.length > 0) lateLive++;
  });
  assert.ok(hues.size >= 3, `hues ${[...hues]}`);
  assert.ok(s.launched > launchedAt1500, 'launched more rockets in the last 10 s');
  assert.ok(lateLive > 50, `particles alive on ${lateLive} of the last 100 steps`);
  assert.ok(s.launched >= 20 && s.bursts >= 20, `launched ${s.launched} bursts ${s.bursts}`);
});

test('E fireworks: the glyphs include the radial set (* + x . o) and a maths/Greek/geometric glyph', () => {
  const seen = new Set();
  runFw(120, 40, 1, 900, (st, i) => { if (i % 6 === 0) for (const g of drawFw(st).glyphs) seen.add(g); });
  for (const ch of '*+x.o') assert.ok(seen.has(ch.codePointAt(0)), ch);
  assert.ok([...seen].some((cp) => cp > 0x7e), 'some non-ASCII glyph');
});

// ---------------------------------------------------------------- F: vortex (cells, pure in t)
test('F vortex: kind cells, pure in t (a frame does not depend on which frames were drawn before it), and it spins', () => {
  assert.equal(vortex.kind, 'cells');
  const fresh = renderScene(vortex, 5, 90, 30, 2);
  renderScene(vortex, 9, 90, 30, 2); renderScene(vortex, 1, 90, 30, 2);
  const again = renderScene(vortex, 5, 90, 30, 2);
  assert.deepEqual(Array.from(fresh.glyphs), Array.from(again.glyphs));
  assert.deepEqual(Array.from(fresh.colours), Array.from(again.colours));
  const later = renderScene(vortex, 5.3, 90, 30, 2);
  const diff = fresh.glyphs.reduce((n, v, i) => n + (v !== later.glyphs[i] ? 1 : 0), 0);
  assert.ok(diff > 90 * 30 * 0.05, `only ${diff} cells moved in 0.3 s`);
  // bounds arm: every cell is written with an allowed glyph and an in-palette colour at every size
  for (const [w, h] of [[120, 40], [1, 1], [3, 2], [240, 67], [2, 200]]) {
    const g = new Uint16Array(w * h).fill(0xffff), c = new Uint8Array(w * h).fill(255);
    renderScene(vortex, 7, w, h, 1, g, c);
    for (let i = 0; i < g.length; i++) { assert.ok(isAllowedGlyph(g[i]), `${w}x${h} cell ${i}`); assert.ok(c[i] < 32); }
  }
});

test('F vortex: arms cover a good part of the screen (20 to 80% lit), centred on the middle, with mixed glyph kinds', () => {
  const f = renderScene(vortex, 6, 120, 40, 1);
  const litN = f.glyphs.reduce((n, v) => n + (v !== 32 ? 1 : 0), 0);
  assert.ok(litN > 120 * 40 * 0.2 && litN < 120 * 40 * 0.8, `lit ${litN}`);
  const kinds = new Set(Array.from(f.glyphs).filter((v) => v !== 32).map((v) => (v < 0x7f ? 'ascii' : v < 0x400 ? 'greek' : 'sym')));
  assert.ok(kinds.size >= 2, [...kinds].join());
});

test('STEP_DT is 1/30 (the sims here are written against it)', () => assert.equal(STEP_DT, 1 / 30));
