// DRIFT-4: scene II, The Tallow & Tin (Delza's simulation scene). What the storyboard promises, checked on the frames:
// the fire never goes out and changes by a shade at a time, the flicker stays under 1% of the screen (1.5% at 80x24, where the
// 8x4 fire patch alone is 1.7% of the cells), a spark every 0.8 s, a mug raised every 9 to 14 s by each patron, a tail flick
// every 6 s. Each promise has a control that fails when the promise is broken.
import test from 'node:test';
import assert from 'node:assert/strict';
import tallow, { layoutOf } from '../cartridges/delza/scenes/tallow.js';
import { STEP_HZ } from '../src/cells.js';
import { EMBER, GOLD } from '../cartridges/delza/lib/palette.js';

const FPS = 18;
const cp = (ch) => ch.codePointAt(0);
const params = (w, h) => ({ glyphs: new Uint16Array(w * h), colours: new Uint8Array(w * h) });

// Run the scene for `seconds` at w x h: the frames at 18 fps as { g, c } copies, stepping the sim at 30 Hz like the composer.
function run(scene, w, h, seconds, seed = 1) {
  const st = scene.init(w, h, seed);
  const p = params(w, h);
  const frames = [];
  let owed = 0;
  for (let k = 0; k < seconds * FPS; k++) {
    owed += STEP_HZ / FPS;
    while (owed >= 1) { scene.step(st); owed -= 1; }
    scene.draw(st, p);
    frames.push({ g: p.glyphs.slice(), c: p.colours.slice(), steps: st.steps });
  }
  return { frames, st };
}
const changed = (a, b) => { let n = 0; for (let i = 0; i < a.g.length; i++) if (a.g[i] !== b.g[i] || a.c[i] !== b.c[i]) n++; return n; };

for (const [w, h, limit] of [[120, 40, 0.01], [240, 67, 0.01], [80, 24, 0.015]]) {
  test(`tallow ${w}x${h}: from one frame to the next at most ${limit * 100}% of the screen changes, over 90 s on two seeds`, () => {
    for (const seed of [1, 7]) {
      const { frames } = run(tallow, w, h, 90, seed);
      const worst = worstChange(frames, w, h);
      assert.ok(worst < limit, `seed ${seed}: worst frame changed ${(worst * 100).toFixed(2)}%`);
      assert.ok(worst > 0.0005, `seed ${seed}: and it does move (${(worst * 100).toFixed(3)}%)`);
    }
  });
}

// The fire patch in every frame: lit, shade 1 to 3, one shade at a time. Returns how many shade moves it saw.
function checkFire(frames, w, h) {
  const L = layoutOf(w, h);
  const cells = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) cells.push((L.fireY + r) * w + L.fireX + c);
  let moves = 0;
  const prev = new Array(cells.length).fill(-1);
  for (const f of frames) {
    cells.forEach((i, n) => {
      assert.notEqual(f.g[i], 32, 'a fire cell is never blank');
      const s = (n < 8 ? GOLD : EMBER).indexOf(f.c[i]);
      assert.ok(s >= 1 && s <= 3, `shade ${s} (colour ${f.c[i]})`);
      if (prev[n] >= 0 && prev[n] !== s) { moves++; assert.equal(Math.abs(prev[n] - s), 1, 'one shade at a time'); }
      prev[n] = s;
    });
  }
  return moves;
}
// Largest share of the screen that changes between two frames.
function worstChange(frames, w, h) {
  let worst = 0;
  for (let k = 1; k < frames.length; k++) worst = Math.max(worst, changed(frames[k - 1], frames[k]) / (w * h));
  return worst;
}

test('tallow: the fire never goes out - the 8x4 patch is lit in every frame, each cell between shade 1 and shade 3, and a cell moves one shade at a time', () => {
  const moves = checkFire(run(tallow, 120, 40, 60).frames, 120, 40);
  assert.ok(moves > 50, `the fire flickers (${moves} moves in 60 s)`);
});

// events read from the simulation's own state, stepped at 30 Hz
function events(seconds, seed = 1) {
  const st = tallow.init(120, 40, seed);
  const raise = [[], [], []];
  const wasUp = [false, false, false];
  const sparkBorn = new Set();
  for (let n = 0; n < seconds * STEP_HZ; n++) {
    tallow.step(st);
    st.patrons.forEach((p, i) => { const up = p.up > 0; if (up && !wasUp[i]) raise[i].push(st.steps / STEP_HZ); wasUp[i] = up; });
    for (const k of st.sparks) sparkBorn.add(k.born);
  }
  return { raise, sparks: [...sparkBorn].sort((a, b) => a - b).map((b) => b / STEP_HZ) };
}

test('tallow: a spark leaves the flames every 0.8 s; each patron raises a mug every 9 to 14 s (start to start), on three seeds', () => {
  for (const seed of [1, 2, 99]) {
    const e = events(180, seed);
    assert.ok(e.sparks.length >= 220, `${e.sparks.length} sparks in 180 s`);
    for (let i = 1; i < e.sparks.length; i++) assert.ok(Math.abs(e.sparks[i] - e.sparks[i - 1] - 0.8) < 0.01);
    for (const [i, times] of e.raise.entries()) {
      assert.ok(times.length >= 10, `seed ${seed} patron ${i}: ${times.length} raises in 180 s`);
      for (let k = 1; k < times.length; k++) {
        const gap = times[k] - times[k - 1];
        assert.ok(gap >= 9 - 0.04 && gap <= 14 + 0.04, `seed ${seed} patron ${i}: gap ${gap.toFixed(2)} s`);
      }
    }
    // they do not all raise together: the first raises are spread out
    const firsts = e.raise.map((t) => t[0]);
    assert.ok(new Set(firsts.map((t) => t.toFixed(1))).size === 3, `first raises ${firsts}`);
  }
});

test('tallow: a raised mug is on screen for 1.2 s (the picture changes at the mug), and the cat\'s tail flicks for 0.4 s in every 6', () => {
  const w = 120, h = 40;
  const L = layoutOf(w, h);
  const { frames } = run(tallow, w, h, 60);
  // the tail cell: catX + 4, fy - 1; '~' at rest, '-' while it flicks
  const tailAt = (f) => f.g[(L.fy - 1) * w + L.catX + 4];
  const flickFrames = frames.map((f, k) => (tailAt(f) === cp('-') ? k : -1)).filter((k) => k >= 0);
  assert.ok(flickFrames.length > 0 && frames.every((f) => [cp('~'), cp('-')].includes(tailAt(f))), 'the tail is always one of the two');
  const starts = flickFrames.filter((k, i) => i === 0 || k - flickFrames[i - 1] > 1).map((k) => k / FPS);
  assert.ok(starts.length >= 9, `${starts.length} flicks in 60 s`);
  for (let i = 1; i < starts.length; i++) assert.ok(Math.abs(starts[i] - starts[i - 1] - 6) < 0.2, `flicks ${starts[i - 1]} and ${starts[i]}`);
  const run1 = flickFrames.filter((k) => k < 6 * FPS).length;
  assert.ok(Math.abs(run1 / FPS - 0.4) < 0.12, `a flick lasts ${run1 / FPS} s`);
});

test('control: a fire that burns out, jumps two shades, or strobes is caught by the same checks', () => {
  const dying = { ...tallow, step(s) { tallow.step(s); if (s.steps > 150) s.fire.fill(0); } };
  assert.throws(() => checkFire(run(dying, 120, 40, 20).frames, 120, 40), /shade 0/);
  const jumpy = { ...tallow, step(s) { tallow.step(s); if (s.steps % 3 === 0) s.fire[5] = s.fire[5] === 1 ? 3 : 1; } };
  assert.throws(() => checkFire(run(jumpy, 120, 40, 20).frames, 120, 40), /one shade at a time/);
  const wild = { ...tallow, step(s) { tallow.step(s); if (s.steps % 3 === 0) for (let k = 0; k < s.fire.length; k++) s.fire[k] = (s.steps / 3) % 2 ? 1 : 2; } };
  const worst = worstChange(run(wild, 80, 24, 20).frames, 80, 24);
  assert.ok(worst >= 0.015, `a strobing fire changes ${(worst * 100).toFixed(2)}% of an 80x24 screen - past the 1.5% bound`);
  const calm = worstChange(run(tallow, 80, 24, 20).frames, 80, 24);
  assert.ok(calm < 0.015 && calm < worst, `the real fire: ${(calm * 100).toFixed(2)}%`);
});
