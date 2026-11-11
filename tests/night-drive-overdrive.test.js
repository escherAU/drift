// DRIFT-5 slice 2: scene B4, Overdrive (a sim), and lib/skyline.js. The storyboard's promises, read off rendered frames, and the one rule that
// matters most: how many cells change in a frame is a function of STEP COUNT and of the window size, never of what the last frame did.
//   - D1  contract: a sim called overdrive, LAYOUTS widest first, ring counts that never rise as the window shrinks, createOverdrive, the manifest
//   - D2  sim purity: the composer at 1x and 4x agrees with renderScene; draw never changes the state; the seed matters; odd sizes do not throw
//   - D3  the ring schedule: any 8 consecutive steps hold no more ring moves than ringBudget; it is pure; it matches what is drawn; the control exceeds it
//   - D4  the light trails: born only on allowed slots, at most one a step, 1.5 to 4 a second, at most 12 / 6 / 3 alive, 4 to 10 cells fading 3 to 0
//   - D5  the phases: the mouth grows, rings and ceiling lights from 15 s, the 20x4 car, the exit dissolve outward, a trail about every 2 s from 66 s
//   - D6  the share of cells that change in a frame, at 1x and 4x, over the whole 90 s (and 150 s), with the control that goes through 30%
//   - D7  tolerance of the clock: carries on validly to 150 s with bounded state; a run drawn only every 7th step shows the same frames
//   - D8  ramps: no cell that keeps its glyph changes family or moves more than one shade in a frame; no brightness jump
//   - D9  compact: 80x24 and 40x12 keep to fewer rings and trails
//   - D10 every glyph allowed and none banned, every colour inside the palette, blanks in colour 0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import overdrive, {
  createOverdrive, LAYOUTS, layoutFor, planOf, movesInWindow, ringBudget, spawnAllowed, dashClock,
  T_TUNNEL, T_RINGS, T_EXIT, T_REVEAL, T_FREE, T_EASE,
} from '../cartridges/night-drive/scenes/overdrive.js';
import { skylineCells, SKY_ROOF, SKY_WALL, SKY_WINDOW } from '../cartridges/night-drive/lib/skyline.js';
import { REAR_20, REAR_20_W, REAR_20_H } from '../cartridges/night-drive/lib/sprites.js';
import { renderScene, createCellComposer } from '../src/cells.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { SUN, TANG, CORAL, CYAN, VIOLET, ICE, FAMILIES, FAR, NEAR, COUNT } from '../cartridges/night-drive/lib/palette.js';
import { changedFraction, lstarTable, brightnessJumps } from './helpers-flash.js';

const BANNED = [0x25cd, 0x25ce, 0x25d1, 0x25e2, 0x25e3, 0x222b, 0x2261, 0x25d0, 0x25d3, 0x25d2]; // ◍ ◎ ◑ ◢ ◣ ∫ ≡ and ◐ ◓ ◒
const cp = (ch) => ch.codePointAt(0);
const width = (s) => [...s].length;
const FPS = 18;
const SKIN = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../cartridges/night-drive/skin.json', import.meta.url)), 'utf8'));
const LTAB = lstarTable(makeSkinPalette(SKIN, 'truecolor', 'night-drive'));
const TL = cp('┏'), HEAD = cp('●'), STREAK = cp('━');
const TRAIL_GLYPHS = [cp('─'), cp('╱'), cp('╲')];
const SHIPPED = [[120, 40], [80, 24], [240, 67]];
// the first size of each LAYOUTS breakpoint (the last one, 0x0, is blank and has nothing to measure), and the small windows
const SIZES = [...SHIPPED, ...LAYOUTS.filter((l) => l.minCols > 0).map((l) => [l.minCols, l.minRows]), [41, 11], [40, 12], [30, 10]];

// ---- helpers: a stepper that draws any step (never going back), and a runner at 18 fps
const params = (w, h) => ({ glyphs: new Uint16Array(w * h), colours: new Uint8Array(w * h) });
function stepper(w, h, seed = 1, scene = overdrive) {
  const st = scene.init(w, h, seed);
  const p = params(w, h);
  return {
    st, p, w, h, scene,
    to(n) { while (st.steps < n) scene.step(st); return this; },
    look() { scene.draw(st, p); return { g: p.glyphs.slice(), c: p.colours.slice(), w, h, n: st.steps }; },
    // the picture without the light trails (the scenery, the rings, the car): a copy of the state with no particles
    lookBare() { scene.draw({ ...st, parts: [] }, p); return { g: p.glyphs.slice(), c: p.colours.slice(), w, h, n: st.steps }; },
  };
}
const frameAt = (n, w = 120, h = 40, seed = 1) => stepper(w, h, seed).to(n).look();
const at = (f, x, y) => ({ g: f.g[y * f.w + x], c: f.c[y * f.w + x] });
const cellsWhere = (f, pred) => {
  const out = [];
  for (let i = 0; i < f.g.length; i++) if (pred(f.g[i], f.c[i], i % f.w, Math.floor(i / f.w))) out.push([i % f.w, Math.floor(i / f.w)]);
  return out;
};
const familyOf = (col) => Object.entries(FAMILIES).find(([, f]) => f.includes(col));
const carBox = (w, h) => ({ x0: Math.floor((w - REAR_20_W) / 2), y0: h - 1 - REAR_20_H, x1: Math.floor((w - REAR_20_W) / 2) + REAR_20_W - 1, y1: h - 2 });
const inCar = (w, h, x, y) => { const b = carBox(w, h); return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; };
const lightCol = (c) => CORAL.includes(c) || ICE.includes(c);

// ---- D1

test('overdrive (D1): a sim called overdrive with init, step and draw; LAYOUTS widest first with ring counts that never rise as the window shrinks', () => {
  assert.equal(overdrive.kind, 'sim');
  assert.equal(overdrive.id, 'overdrive');
  for (const k of ['init', 'step', 'draw']) assert.equal(typeof overdrive[k], 'function', k);
  assert.ok(Array.isArray(LAYOUTS) && LAYOUTS.length >= 3, `${LAYOUTS.length} layouts`);
  for (const l of LAYOUTS) {
    assert.ok(Number.isInteger(l.minCols) && Number.isInteger(l.minRows), JSON.stringify(l));
    for (const k of ['rings', 'moving', 'particles', 'slotGap']) assert.ok(Number.isInteger(l[k]) && l[k] >= 0, `${l.name}.${k}`);
    assert.equal(l.car, 'rear20', `${l.name}: the car is the 20x4 sprite`);
    assert.ok(l.moving <= l.rings, `${l.name}: moving rings are rings`);
  }
  for (let i = 1; i < LAYOUTS.length; i++) {
    assert.ok(LAYOUTS[i].minCols <= LAYOUTS[i - 1].minCols && LAYOUTS[i].minRows <= LAYOUTS[i - 1].minRows, 'sorted widest first');
    assert.ok(LAYOUTS[i].rings <= LAYOUTS[i - 1].rings, `rings never rise as the window shrinks (${LAYOUTS[i - 1].name} -> ${LAYOUTS[i].name})`);
    assert.ok(LAYOUTS[i].particles <= LAYOUTS[i - 1].particles, 'nor do the trails');
  }
  const last = LAYOUTS[LAYOUTS.length - 1];
  assert.deepEqual([last.minCols, last.minRows], [0, 0], 'the last layout takes every window');
  assert.ok(last.rings <= 2, 'the smallest layout has 2 rings or fewer');
  const [big] = LAYOUTS;
  assert.ok(big.rings <= 7 && big.rings >= 6 && big.particles <= 12 && big.particles >= 10, 'full: up to 7 rings and 12 trails');
  assert.ok(layoutFor(80, 24).rings <= 4 && layoutFor(80, 24).particles <= 6, '80x24: 4 rings or fewer, 6 trails or fewer');
  assert.ok(layoutFor(40, 12).rings <= 2, '40x12: 2 rings or fewer');
  assert.equal(layoutFor(120, 40).name, big.name);
  assert.equal(layoutFor(240, 67).name, big.name);
  assert.equal(layoutFor(big.minCols, big.minRows).name, big.name, 'at the breakpoint: the big layout');
  assert.notEqual(layoutFor(big.minCols - 1, big.minRows).name, big.name, 'one column short: not');
  assert.notEqual(layoutFor(big.minCols, big.minRows - 1).name, big.name, 'one row short: not');
  // what the plan really draws agrees with what the layout allows
  for (const [w, h] of [...SIZES, [100, 32]]) {
    const p = planOf(w, h), L = layoutFor(w, h);
    assert.ok(p.R + p.statics.length <= L.rings, `${w}x${h}: ${p.R} moving + ${p.statics.length} still rings, at most ${L.rings}`);
    assert.ok(p.R <= L.moving, `${w}x${h}: at most ${L.moving} moving`);
    assert.equal(p.cap, L.particles);
  }
});

test('overdrive (D1): createOverdrive makes the scene, the default export is createOverdrive(), and the manifest lists it after redlight with its menu entry', () => {
  assert.equal(typeof createOverdrive, 'function');
  const a = createOverdrive();
  for (const k of ['init', 'step', 'draw', 'movesInWindow']) assert.equal(typeof a[k], 'function', k);
  assert.equal(a.kind, 'sim');
  assert.equal(a.id, 'overdrive');
  assert.equal(a.ringLimit, true, 'the guard is on by default');
  assert.equal(createOverdrive({ ringLimit: false }).ringLimit, false);
  assert.deepEqual(Object.keys(a).sort(), Object.keys(overdrive).sort());
  const x = stepper(120, 40, 1, a).to(700).look(), y = stepper(120, 40, 1, overdrive).to(700).look();
  assert.deepEqual(x, y, 'the default export draws what createOverdrive() draws');
  const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../cartridges/night-drive/manifest.json', import.meta.url)), 'utf8'));
  const ids = manifest.scenes.map((s) => s.id);
  assert.ok(ids.includes('overdrive'));
  assert.ok(ids.indexOf('overdrive') > ids.indexOf('redlight'), 'after redlight');
  const entry = manifest.scenes.find((s) => s.id === 'overdrive');
  assert.equal(entry.kind, 'sim');
  assert.equal(entry.title, 'Overdrive');
  assert.ok(width(entry.title) <= 23);
  const tape = manifest.programs.find((p) => p.id === 'tape');
  assert.deepEqual(tape.scenes, ids, 'tape order is manifest scene order');
  const menu = manifest.menu.find((m) => m.scene === 'overdrive');
  assert.equal(menu.label, 'B4  OVERDRIVE');
  assert.equal(menu.program, 'tape');
  assert.equal(menu.note, '1:30');
  assert.ok(menu.desc && width(menu.desc) <= 76, `desc is ${width(menu.desc || '')} wide`);
  assert.equal(manifest.menu[manifest.menu.length - 1].action, 'eject', 'Eject stays last');
  assert.ok(manifest.menu.indexOf(menu) < manifest.menu.length - 1);
  assert.ok(manifest.menu.indexOf(menu) > manifest.menu.indexOf(manifest.menu.find((m) => m.scene === 'redlight')));
});

// ---- D2

test('overdrive (D2a): the same (size, seed) gives equal states and equal frames after N steps; draw does not change the state and drawing twice gives the same frame', () => {
  for (const [w, h] of SHIPPED) {
    const a = stepper(w, h, 5).to(777), b = stepper(w, h, 5).to(777);
    assert.deepEqual(a.st, b.st, `${w}x${h} state`);
    assert.deepEqual(a.look(), b.look(), `${w}x${h} frame`);
  }
  assert.deepEqual(overdrive.init(120, 40, 3), overdrive.init(120, 40, 3), 'init twice');
  for (const n of [0, 5, 300, 460, 900, 1745, 1830, 1900, 2800]) {
    const s = stepper(120, 40, 3).to(n);
    const before = structuredClone(s.st);
    const f1 = s.look();
    assert.deepEqual(s.st, before, `n=${n}: state after draw`);
    assert.deepEqual(s.look(), f1, `n=${n}: second draw`);
  }
});

test('overdrive (D2b): a state stepped N times with draws in between equals one stepped N times with none', () => {
  const a = stepper(120, 40, 2), b = stepper(120, 40, 2);
  for (let i = 0; i < 1900; i++) { overdrive.step(a.st); if (i % 7 === 0) a.look(); }
  b.to(1900);
  assert.deepEqual(a.st, b.st);
  assert.deepEqual(a.look(), b.look());
});

test('overdrive (D2c): the composer at 1x and 4x, once it has taken N steps, shows what renderScene shows for N / 30 s (N = 450, 1200, 1800, 2700 or the first count past it)', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    for (const speed of [1, 4]) {
      const cc = createCellComposer({ scenes: [overdrive], cols: w, rows: h, seed: 1 });
      const want = new Map([450, 1200, 1800, 2700].map((n) => [n, null]));
      for (let k = 1; k <= (90 * FPS) / speed + 5; k++) {
        const f = cc.frame({ a: 0, b: 0, p: 0 }, (k * speed) / FPS);
        for (const [n, v] of want) {
          if (v !== null || cc.stepsTotal < n) continue; // 4x moves 6 or 7 steps a frame and never lands on 450 exactly: it is checked at the count it does land on
          const ref = renderScene(overdrive, cc.stepsTotal / 30, w, h, 1);
          assert.deepEqual(Array.from(f.glyphs), Array.from(ref.glyphs), `${w}x${h} ${speed}x N=${cc.stepsTotal} glyphs`);
          assert.deepEqual(Array.from(f.shades), Array.from(ref.colours), `${w}x${h} ${speed}x N=${cc.stepsTotal} colours`);
          want.set(n, cc.stepsTotal);
        }
      }
      for (const [n, v] of want) assert.ok(v !== null && v >= n && v - n <= 8, `${w}x${h} ${speed}x never reached N=${n}`);
    }
  }
});

test('overdrive (D2d): the seed changes the picture; odd sizes do not throw and stay blank when too small', () => {
  for (const n of [100, 700, 1900]) {
    const a = frameAt(n, 120, 40, 1), b = frameAt(n, 120, 40, 2);
    assert.ok(cellsWhere(a, (g, c, x, y) => g !== b.g[y * 120 + x] || c !== b.c[y * 120 + x]).length > 20, `n=${n}: another seed differs`);
  }
  for (const [w, h] of [[1, 1], [0, 0], [2, 200], [200, 2], [5, 5], [40, 12], [41, 11], [30, 10], [29, 10], [30, 8]]) {
    const s = stepper(w, h);
    assert.doesNotThrow(() => { s.to(1900); s.look(); renderScene(overdrive, 70, w, h, 4); }, `${w}x${h}`);
  }
  for (const [w, h] of [[1, 1], [0, 0], [2, 200], [200, 2], [29, 10], [30, 8]]) {
    const f = stepper(w, h).to(900).look();
    assert.ok(f.g.every((g) => g === 32) && f.c.every((c) => c === 0), `${w}x${h}: too small, so blank`);
  }
});

// ---- D3

const WINDOW_SIZES = [[120, 40], [80, 24], [240, 67], [40, 12], [41, 11], [100, 32], [60, 18], [30, 10], [0, 0]];

test('overdrive (D3a): for every window start from 0 to 4500, no 8 consecutive steps hold more ring moves than ringBudget, at every size; the budget is at least 1 wherever a ring is drawn', () => {
  for (const [w, h] of WINDOW_SIZES) {
    const budget = ringBudget(w, h), p = planOf(w, h);
    if (p.ok) assert.ok(budget >= 1, `${w}x${h}: budget ${budget}`); else assert.equal(budget, 0, `${w}x${h}: blank, no budget`);
    let worst = 0, total = 0;
    for (let step0 = 0; step0 <= 4500; step0++) {
      const m = movesInWindow(step0, 8, w, h);
      if (m > worst) worst = m;
      assert.ok(m <= budget, `${w}x${h}: ${m} ring moves in steps ${step0 + 1}..${step0 + 8}, budget ${budget}`);
    }
    for (let n = 1; n <= 4500; n++) total += movesInWindow(n - 1, 1, w, h);
    if (p.ok) {
      assert.ok(worst >= 1, `${w}x${h}: the schedule does move rings (worst window ${worst})`);
      assert.ok(total >= 80, `${w}x${h}: ${total} ring moves in 150 s`);
    } else assert.equal(total, 0);
    assert.equal(movesInWindow(T_EXIT, 4500 - T_EXIT, w, h), 0, `${w}x${h}: no ring moves after the exit opens`);
  }
});

test('overdrive (D3b): movesInWindow, ringBudget and spawnAllowed are pure: the same answer in any call order and after calls for other sizes', () => {
  const queries = [];
  for (const [w, h] of WINDOW_SIZES) for (let s0 = 0; s0 < 4400; s0 += 97) queries.push([s0, 8, w, h], [s0, 31, w, h]);
  const run = (qs) => qs.map(([a, n, w, h]) => [movesInWindow(a, n, w, h), ringBudget(w, h), spawnAllowed(a + n, w, h)]);
  const forward = run(queries);
  const reversed = run([...queries].reverse()).reverse();
  assert.deepEqual(reversed, forward, 'reverse order');
  const shuffled = queries.map((q, i) => [(i * 7919) % queries.length, q]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const again = run(shuffled);
  const byKey = new Map(shuffled.map((q, i) => [q.join(','), again[i]]));
  queries.forEach((q, i) => assert.deepEqual(byKey.get(q.join(',')), forward[i], `query ${q}`));
  // building scenes and stepping them leaves nothing behind
  stepper(240, 67).to(2000);
  stepper(41, 11).to(2000);
  assert.deepEqual(run(queries), forward, 'after stepping other scenes');
  const scene = createOverdrive();
  for (const [w, h] of WINDOW_SIZES) assert.equal(scene.movesInWindow(500, 40, w, h), movesInWindow(500, 40, w, h), `${w}x${h}: the scene's method agrees with the export`);
});

test('overdrive (D3c): the schedule is what is drawn: the number of steps on which a ring corner moves equals the number of ring moves scheduled', () => {
  for (const [w, h] of [[120, 40], [80, 24], [240, 67], [100, 32], [41, 11]]) {
    const s = stepper(w, h);
    s.to(T_RINGS); // the mouth has dissolved and the still rings are all in by now
    const corners = (f) => new Set(cellsWhere(f, (g, c) => g === TL && c === VIOLET[1]).map((p) => p.join()));
    let prevFrame = s.lookBare(), prev = corners(prevFrame);
    let changes = 0, mostCells = 0;
    const cap = layoutFor(w, h).ringCap * w * h;
    for (let n = T_RINGS + 1; n <= T_EXIT; n++) {
      s.to(n);
      const frame = s.lookBare();
      const cur = corners(frame);
      const moved = cur.size !== prev.size || [...cur].some((k) => !prev.has(k));
      if (moved) changes++;
      // one move redraws two outlines at most, and the layout's ringCap says how much of the window that may be
      let cells = 0;
      for (let i = 0; i < frame.g.length; i++) if (frame.g[i] !== prevFrame.g[i] || frame.c[i] !== prevFrame.c[i]) cells++;
      assert.equal(cells > 0, movesInWindow(n - 1, 1, w, h) > 0, `${w}x${h} step ${n}: the picture changes on exactly the steps with a scheduled move (${cells} cells)`);
      assert.ok(cells <= cap, `${w}x${h} step ${n}: one ring move changed ${cells} cells, the cap is ${cap.toFixed(0)}`);
      mostCells = Math.max(mostCells, cells);
      prev = cur;
      prevFrame = frame;
    }
    const scheduled = movesInWindow(T_RINGS, T_EXIT - T_RINGS, w, h);
    assert.equal(changes, scheduled, `${w}x${h}: ${changes} steps where a ring moved, ${scheduled} scheduled`);
    assert.ok(changes >= 40, `${w}x${h}: ${changes} ring moves seen`);
    assert.ok(mostCells > 0.3 * cap, `${w}x${h}: the cap is a real bound, not a loose one (${mostCells} of ${cap.toFixed(0)})`);
  }
});

test('overdrive (D3 control): with ringLimit: false the same windows at 120x40 exceed the budget, so the limit is real', () => {
  const off = createOverdrive({ ringLimit: false });
  for (const [w, h] of [[120, 40], [41, 11]]) {
    const budget = ringBudget(w, h);
    let over = 0, worst = 0;
    for (let step0 = 0; step0 <= 4500; step0++) {
      const m = off.movesInWindow(step0, 8, w, h);
      worst = Math.max(worst, m);
      if (m > budget) over++;
    }
    console.log(`overdrive control ${w}x${h}: budget ${budget}, the unguarded schedule puts up to ${worst} ring moves in 8 steps (${over} windows over)`);
    assert.ok(over > 1000, `${w}x${h}: ${over} windows over the budget`);
  }
  assert.ok(createOverdrive().movesInWindow(1000, 8, 120, 40) <= ringBudget(120, 40), 'and the guarded one is not');
});

// ---- D4

function spawnLog(w, h, until) {
  const s = stepper(w, h);
  const log = [];
  let alive = 0;
  for (let n = 1; n <= until; n++) {
    const before = s.st.spawned;
    s.to(n);
    const born = s.st.spawned - before;
    assert.ok(born === 0 || born === 1, `${w}x${h} step ${n}: ${born} born at once`);
    if (born) log.push(n);
    alive = Math.max(alive, s.st.parts.length);
    assert.ok(s.st.parts.length <= layoutFor(w, h).particles, `${w}x${h} step ${n}: ${s.st.parts.length} alive`);
  }
  return { log, alive, s };
}

test('overdrive (D4a): trails are born only on allowed slots, at most one a step, 1.5 to 4 a second in the tunnel at full size (and no more at small ones), never more than 12 / 6 / 3 alive', () => {
  const want = [[120, 40, 12], [240, 67, 12], [80, 24, 6], [60, 18, 6], [40, 12, 3], [41, 11, 3]];
  for (const [w, h, cap] of want) {
    const { log, alive } = spawnLog(w, h, 1800);
    for (const n of log) assert.ok(spawnAllowed(n, w, h), `${w}x${h}: born on step ${n}, which is not an allowed slot`);
    for (const n of log) assert.ok(n > T_TUNNEL, `${w}x${h}: born at step ${n}, before the tunnel`);
    const perSecond = log.filter((n) => n > T_TUNNEL).length / 45;
    console.log(`overdrive trails ${w}x${h}: ${perSecond.toFixed(2)} a second in the tunnel, ${alive} alive at most (cap ${cap})`);
    assert.ok(perSecond <= 4, `${w}x${h}: ${perSecond.toFixed(2)} a second`);
    assert.ok(alive <= cap && alive >= 2, `${w}x${h}: ${alive} alive at most`);
    if (layoutFor(w, h).name === 'full') {
      assert.ok(perSecond >= 1.5, `${w}x${h}: ${perSecond.toFixed(2)} a second`);
      assert.ok(alive >= 5, `${w}x${h}: the cap is approached (${alive})`);
    }
  }
  // the slots themselves: never on a ring slot, none before the tunnel
  for (const [w, h] of WINDOW_SIZES.filter(([a, b]) => planOf(a, b).ok)) {
    const gap = planOf(w, h).slotGap;
    let n = 0;
    for (let s = 0; s <= 4500; s++) {
      if (!spawnAllowed(s, w, h)) continue;
      n++;
      assert.ok(s > T_TUNNEL && s % gap !== 0, `${w}x${h}: slot at ${s}`);
    }
    assert.ok(n > 20, `${w}x${h}: ${n} slots`);
  }
});

test('overdrive (D4b): a trail is 4 to 10 cells that fall from shade 3 to 0 in single steps; tail lights are coral.3, headlights ice.3; glyphs are only ─ ╱ ╲ (and the ● head)', () => {
  const w = 120, h = 40;
  const s = stepper(w, h);
  let mature = 0, lengths = new Set();
  for (let n = 600; n <= 1500; n += 2) {
    const f = s.to(n).look();
    for (const q of s.st.parts) {
      const ray = s.st.plan.rays[q.ray];
      const k = Math.floor((n - q.born) / q.mv);
      if (k < 12 || k > q.travel - 1) continue;
      const fam = q.dir > 0 ? ICE : CORAL;
      const head = ray.cells[q.q0 + q.dir * k];
      assert.deepEqual(at(f, head.x, head.y), { g: HEAD, c: fam[3] }, `n=${n}: the head`);
      const shades = [3];
      for (let vis = k - 1; vis >= Math.max(0, k - 10); vis--) {
        const cell = ray.cells[q.q0 + q.dir * vis], got = at(f, cell.x, cell.y);
        if (!fam.includes(got.c)) break;
        assert.ok(TRAIL_GLYPHS.includes(got.g) && got.g === cell.g, `n=${n}: trail glyph U+${got.g.toString(16)}`);
        shades.push(fam.indexOf(got.c));
      }
      const trail = shades.length - 1;
      assert.ok(trail >= 4 && trail <= 10, `n=${n}: a trail of ${trail} cells`);
      lengths.add(trail);
      assert.ok(shades[1] >= 2, `n=${n}: the trail starts bright (${shades[1]})`);
      assert.equal(shades[shades.length - 1], 0, `n=${n}: the trail ends at shade 0 (${shades.join('')})`);
      for (let i = 1; i < shades.length; i++) assert.ok(shades[i - 1] - shades[i] === 0 || shades[i - 1] - shades[i] === 1, `n=${n}: ${shades.join('')} falls by more than one shade`);
      mature++;
    }
    // nothing else in the light colours: every such cell outside the car is a head or a trail glyph
    for (const [x, y] of cellsWhere(f, (g, c, cx, cy) => lightCol(c) && !inCar(w, h, cx, cy))) assert.ok(f.g[y * w + x] === HEAD || TRAIL_GLYPHS.includes(f.g[y * w + x]), `n=${n}: U+${f.g[y * w + x].toString(16)} in a light colour`);
  }
  assert.ok(mature >= 100, `${mature} mature trails checked`);
  assert.ok(lengths.size >= 3, `trail lengths seen: ${[...lengths].sort().join()}`);
});

test('overdrive (D4c): tail lights move toward the vanishing point; headlights come the other way, on the left', () => {
  const w = 120, h = 40, cx = (w - 1) / 2;
  const g = planOf(w, h);
  const s = stepper(w, h);
  const heads = (f, col) => cellsWhere(f, (gl, c) => gl === HEAD && c === col);
  let prev = s.to(600).look();
  const seen = { tail: 0, head: 0 };
  for (let n = 601; n <= 1700; n++) {
    const f = s.to(n).look();
    for (const [col, kind] of [[CORAL[3], 'tail'], [ICE[3], 'head']]) {
      const before = heads(prev, col);
      for (const [x, y] of heads(f, col)) {
        const old = before.filter(([a, b]) => Math.abs(b - y) <= 1 && Math.abs(a - x) <= 5).sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y))[0];
        if (!old || (old[0] === x && old[1] === y)) continue;
        if (kind === 'tail') {
          assert.ok(y <= old[1] && Math.abs(x - cx) <= Math.abs(old[0] - cx) + 1e-9, `n=${n}: a tail light moved from ${old} to ${x},${y}, away from the vanishing point`);
          assert.ok(x > cx, 'tail lights run on the right');
        } else {
          assert.ok(y >= old[1] && Math.abs(x - cx) >= Math.abs(old[0] - cx) - 1e-9, `n=${n}: a headlight moved from ${old} to ${x},${y}, toward the vanishing point`);
          assert.ok(x < cx, 'headlights come on the left');
        }
        seen[kind]++;
      }
    }
    prev = f;
  }
  assert.ok(g.rays.some((r) => r.dir > 0) && g.rays.some((r) => r.dir < 0));
  assert.ok(seen.tail >= 100 && seen.head >= 100, `moves seen: ${JSON.stringify(seen)}`);
});

// ---- D5

test('overdrive (D5a): at 120x40 the mouth (┏━┓┃┗┛ in far silhouette) grows from the vanishing point and never shrinks between 0 and 15 s', () => {
  const s = stepper(120, 40);
  let last = null, grew = 0, first = null;
  for (let n = 0; n <= 449; n += 3) {
    const f = s.to(n).look();
    const corners = cellsWhere(f, (g, c) => g === TL && c === FAR);
    assert.equal(corners.length, 1, `n=${n}: one mouth`);
    const [x, y] = corners[0];
    const box = { w: 119 - 2 * x + 1, top: y };
    if (last) {
      assert.ok(box.w >= last.w && box.top <= last.top, `n=${n}: the mouth shrank (${box.w}x from ${last.w}x)`);
      if (box.w > last.w) grew++;
    } else first = box;
    last = box;
    assert.deepEqual(at(f, x + 1, y), { g: STREAK, c: FAR }, 'its top edge');
    assert.deepEqual(at(f, x, y + 1), { g: cp('┃'), c: FAR }, 'its side');
  }
  assert.ok(first.w <= 12, `starts as a small box (${first.w} wide)`);
  assert.ok(last.w >= 100, `ends against the frame (${last.w} wide)`);
  assert.ok(grew >= 8, `it grew on ${grew} samples`);
  // nothing in violet before 15 s; the scenery of the approach is there
  for (let n = 0; n < T_TUNNEL; n += 10) assert.equal(cellsWhere(s.to(n).look(), (g, c, x, y) => c === VIOLET[1] && !inCar(120, 40, x, y)).length, 0, `n=${n}: no ring yet`);
  const f0 = frameAt(0);
  assert.ok(cellsWhere(f0, (g, c) => c === CYAN[3] && (g === cp('╱') || g === cp('╲'))).length >= 40, 'road edges');
  assert.ok(cellsWhere(f0, (g, c) => g === cp('·') && c === ICE[0]).length >= 10, 'stars');
});

test('overdrive (D5b): nested rings in violet.1 appear from 15 s, each with a ceiling light of ━ in tang.3 that lengthens (1 to 4 cells) toward the viewer; the outer frame is near silhouette', () => {
  const w = 120, h = 40;
  const f = frameAt(35 * 30, w, h);
  const rings = cellsWhere(f, (g, c) => g === TL && c === VIOLET[1]);
  const mouth = cellsWhere(f, (g, c) => g === TL && c === FAR);
  assert.equal(rings.length, 6, 'six rings in violet.1 (three moving, three still)');
  assert.equal(mouth.length, 1, 'and the mouth, the seventh');
  // each ring is a closed rectangle of ┏━┓┃┗┛
  for (const [x, y] of [...rings, ...mouth]) {
    const col = at(f, x, y).c;
    let x1 = x + 1;
    while (at(f, x1, y).g === STREAK || (at(f, x1, y).c === TANG[3] && at(f, x1, y).g === STREAK)) x1++;
    assert.equal(at(f, x1, y).g, cp('┓'), `ring at ${x},${y}: top right corner`);
    assert.equal(at(f, x1, y).c, col);
    let y1 = y + 1;
    while (at(f, x, y1).g === cp('┃')) y1++;
    assert.equal(at(f, x, y1).g, cp('┗'), `ring at ${x},${y}: bottom left corner`);
    assert.equal(at(f, x1, y1).g, cp('┛'), `ring at ${x},${y}: bottom right corner`);
    assert.equal(at(f, x1, y1 - 1).g, cp('┃'));
  }
  // the ceiling lights: runs of ━ in tang.3 on each ring's top row, centred, 1 to 4 long, longer on the bigger rings
  const runs = rings.map(([x, y]) => {
    let n = 0;
    for (let xx = x + 1; at(f, xx, y).g !== cp('┓'); xx++) if (at(f, xx, y).c === TANG[3]) n++;
    const wide = 119 - 2 * x + 1;
    return { wide, n, y };
  }).sort((a, b) => a.wide - b.wide);
  for (const r of runs) assert.ok(r.n >= 1 && r.n <= 4, `a ceiling light of ${r.n}`);
  for (let i = 1; i < runs.length; i++) assert.ok(runs[i].n >= runs[i - 1].n, `longer toward the viewer: ${runs.map((r) => r.n).join(',')}`);
  assert.equal(runs[0].n, 1, 'the smallest has one cell');
  assert.equal(runs[runs.length - 1].n, 4, 'the biggest has four');
  for (const r of runs) {
    const cells = cellsWhere(f, (g, c, x, y) => y === r.y && c === TANG[3]);
    assert.equal(cells.length, r.n);
    const xs = cells.map((p) => p[0]);
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 59.5) <= 0.5, 'centred');
  }
  // the outer frame is near silhouette: the top and bottom rows and two columns each side
  for (let x = 0; x < w; x++) { assert.deepEqual(at(f, x, 0), { g: cp('█'), c: NEAR }); assert.deepEqual(at(f, x, h - 1), { g: cp('█'), c: NEAR }); }
  for (let y = 1; y < h - 1; y++) for (const x of [0, 1, w - 2, w - 1]) assert.deepEqual(at(f, x, y), { g: cp('█'), c: NEAR });
  // the rings that move do move, nested rings never cross
  const a = frameAt(35 * 30), b = frameAt(35 * 30 + 24);
  assert.ok(cellsWhere(a, (g, c, x, y) => g !== b.g[y * w + x] || c !== b.c[y * w + x]).length > 60, 'the picture moves');
});

test('overdrive (D5c): our car is the 20x4 sprite at the bottom at every size and in every phase', () => {
  for (const [w, h] of [[120, 40], [80, 24], [240, 67], [100, 32], [60, 18], [41, 11], [40, 12], [30, 10]]) {
    const b = carBox(w, h);
    for (const n of [0, 300, 700, 1200, 1795, 1850, 2000, 2700, 4000]) {
      const f = frameAt(n, w, h);
      REAR_20.forEach((row, j) => {
        let i = 0;
        for (const ch of row) {
          if (ch !== ' ') assert.equal(f.g[(b.y0 + j) * w + b.x0 + i], cp(ch), `${w}x${h} n=${n}: car cell ${i},${j}`);
          i++;
        }
      });
    }
  }
});

test('overdrive (D5d): the exit dissolve reveals the city in the end rectangle from the centre outward between 60 and 62 s: the count only grows, the mean distance of what is new never drops, and no frame is a flash', () => {
  for (const [w, h] of [[120, 40], [240, 67], [80, 24]]) {
    const p = planOf(w, h), e = p.end;
    const s = stepper(w, h);
    const inside = (x, y) => x > e.x0 && x < e.x1 && y > e.y0 && y < e.y1;
    const dist = (x, y) => Math.max(Math.abs(x - p.cxf) / ((e.x1 - e.x0 + 1) / 2), y < p.vy ? (p.vy - y) / (p.vy - e.y0) : (y - p.vy) / (e.y1 - p.vy));
    const isCity = (g, c) => (g === SKY_ROOF || g === SKY_WALL) && (c === FAR || c === NEAR) || (g === SKY_WINDOW && c === SUN[1]);
    const final = s.to(T_EXIT + T_REVEAL + 1).lookBare();
    const target = cellsWhere(final, (g, c, x, y) => inside(x, y) && isCity(g, c));
    assert.ok(target.length >= 100, `${w}x${h}: ${target.length} city cells inside the end rectangle`);
    let revealedBefore = new Set(), lastMean = -1, lastNew = 0;
    for (const n of [T_EXIT - 1, ...Array.from({ length: 9 }, (_, k) => T_EXIT + Math.round(7.5 * (k + 1)))]) {
      const f = stepper(w, h).to(n).lookBare();
      const now = new Set(target.filter(([x, y]) => isCity(f.g[y * w + x], f.c[y * w + x])).map((c) => c.join()));
      for (const k of revealedBefore) assert.ok(now.has(k), `${w}x${h} n=${n}: ${k} was revealed and went away`);
      const fresh = [...now].filter((k) => !revealedBefore.has(k)).map((k) => k.split(',').map(Number));
      if (fresh.length >= 8 && lastNew >= 8) {
        const mean = fresh.reduce((a, [x, y]) => a + dist(x, y), 0) / fresh.length;
        assert.ok(mean >= lastMean - 1e-9, `${w}x${h} n=${n}: new cells average ${mean.toFixed(3)} from the centre, after ${lastMean.toFixed(3)}`);
        lastMean = mean;
      } else if (fresh.length >= 8) lastMean = fresh.reduce((a, [x, y]) => a + dist(x, y), 0) / fresh.length;
      lastNew = fresh.length;
      revealedBefore = now;
    }
    assert.equal(revealedBefore.size, target.length, `${w}x${h}: everything is revealed by 62 s`);
    // at 60 s the end rectangle is not yet showing the city; at no frame from 59 to 67 s are bright solid cells a quarter of the screen
    const before = stepper(w, h).to(T_EXIT - 1).lookBare();
    assert.equal(target.filter(([x, y]) => isCity(before.g[y * w + x], before.c[y * w + x])).length, 0, `${w}x${h}: nothing of the city before 60 s`);
    const run = stepper(w, h).to(T_EXIT - 30);
    for (let n = T_EXIT - 30; n <= T_FREE + 30; n++) {
      const f = run.to(n).look();
      let bright = 0;
      for (let i = 0; i < f.g.length; i++) if ((f.g[i] === cp('█') || f.g[i] === cp('▓')) && LTAB[f.c[i]] >= 60) bright++;
      assert.ok(bright < 0.25 * f.g.length, `${w}x${h} n=${n}: ${bright} bright solid cells`);
    }
  }
});

test('overdrive (D5e): from 66 s the trails thin to about one every 2 s: at most 2 alive at any frame, the gap between births about 2 s; the dashes ease from double pace to A1\'s by 90 s', () => {
  for (const [w, h] of [[120, 40], [80, 24], [240, 67], [41, 11]]) {
    const s = stepper(w, h);
    const born = [];
    let mostAlive = 0;
    for (let n = 1; n <= 4500; n++) {
      const before = s.st.spawned;
      s.to(n);
      if (s.st.spawned > before) born.push(n);
      if (n >= T_FREE) mostAlive = Math.max(mostAlive, s.st.parts.length);
    }
    const after = born.filter((n) => n > T_FREE);
    const gaps = after.slice(1).map((n, i) => n - after[i]);
    assert.ok(mostAlive <= 2, `${w}x${h}: ${mostAlive} alive after 66 s`);
    assert.ok(after.length >= 30, `${w}x${h}: ${after.length} born after 66 s`);
    for (const g of gaps) assert.ok(g >= 50 && g <= 70, `${w}x${h}: a gap of ${g} steps`);
    const inFreeway = born.filter((n) => n > T_FREE && n <= T_EASE);
    assert.ok(inFreeway.length >= 10 && inFreeway.length <= 14, `${w}x${h}: ${inFreeway.length} between 66 and 90 s (about one every 2 s)`);
  }
  // the pace: double until 66 s, easing to 1 by 90 s, and 1 after
  assert.equal(dashClock(0), 0);
  assert.equal(dashClock(T_FREE) - dashClock(T_FREE - 30), 60);
  assert.equal(Math.round(dashClock(T_EASE + 30) - dashClock(T_EASE)), 30);
  const pace = (n) => dashClock(n + 1) - dashClock(n);
  assert.ok(Math.abs(pace(T_FREE + 1) - 2) < 0.01 && Math.abs(pace(T_EASE - 2) - 1) < 0.01, 'the ease runs from 2 to 1');
  for (let n = T_FREE; n < T_EASE; n += 30) assert.ok(pace(n) >= pace(n + 30) - 1e-9, 'the pace never rises');
});

// ---- D6

function composerRun(scene, w, h, speed, seconds) {
  const cc = createCellComposer({ scenes: [scene], cols: w, rows: h, seed: 1 });
  let pg = null, pc = null, worst = 0, where = 0;
  const total = Math.ceil((seconds * FPS) / speed);
  for (let k = 1; k <= total; k++) {
    const f = cc.frame({ a: 0, b: 0, p: 0 }, (k * speed) / FPS);
    if (pg) {
      const x = changedFraction(f.glyphs, pg, f.shades, pc);
      if (x > worst) { worst = x; where = (k * speed) / FPS; }
    }
    pg = f.glyphs.slice(); pc = f.shades.slice();
  }
  return { worst, where };
}

for (const [w, h] of SIZES) {
  for (const speed of [1, 4]) {
    test(`overdrive (D6): ${w}x${h} at ${speed}x: through the composer over 90 s every frame changes under 28% of the cells (the aim is 18% or less), and more than 1%`, () => {
      const { worst, where } = composerRun(overdrive, w, h, speed, 90);
      console.log(`overdrive worst frame ${w}x${h} ${speed}x: ${(worst * 100).toFixed(2)}% (at ${where.toFixed(1)} s)`);
      assert.ok(worst < 0.28, `worst frame changed ${(worst * 100).toFixed(2)}%`);
      assert.ok(worst <= 0.18, `above the 18% aim: ${(worst * 100).toFixed(2)}%`);
      assert.ok(worst > 0.01, `and it does move (${(worst * 100).toFixed(3)}%)`);
    });
  }
}

test('overdrive (D6 control): with ringLimit: false the share goes through 30% at 4x at 120x40 and at 41x11 (the guard is what holds it down)', () => {
  const off = createOverdrive({ ringLimit: false });
  for (const [w, h] of [[120, 40], [41, 11]]) {
    const { worst, where } = composerRun(off, w, h, 4, 90);
    const on = composerRun(overdrive, w, h, 4, 90).worst;
    console.log(`overdrive control ${w}x${h} 4x: ${(worst * 100).toFixed(2)}% at ${where.toFixed(1)} s (guarded: ${(on * 100).toFixed(2)}%)`);
    assert.ok(worst > 0.3, `${w}x${h}: the unguarded scene changed only ${(worst * 100).toFixed(2)}%`);
    assert.ok(on < 0.28);
  }
});

// ---- D7

test('overdrive (D7a): after 90 s it keeps running validly to 150 s: glyphs and colours stay valid, the share bound still holds, and no state array grows', () => {
  for (const [w, h] of [[120, 40], [80, 24], [240, 67], [41, 11]]) {
    const s = stepper(w, h);
    const sizes = (st) => Object.entries(st).filter(([, v]) => Array.isArray(v) || ArrayBuffer.isView(v)).map(([k, v]) => [k, v.length]);
    s.to(2700);
    const at90 = sizes(s.st);
    let most = 0;
    for (let n = 2700; n <= 4500; n += 15) {
      s.to(n);
      most = Math.max(most, s.st.parts.length);
      if (n % 150 === 0) {
        const f = s.look();
        for (let i = 0; i < f.g.length; i++) {
          assert.ok(isAllowedGlyph(f.g[i]) && !BANNED.includes(f.g[i]) && f.c[i] < COUNT, `${w}x${h} n=${n}: cell ${i}`);
          if (f.g[i] === 32) assert.equal(f.c[i], 0);
        }
      }
    }
    const at150 = sizes(s.st);
    for (const [k, len] of at150) {
      const l90 = at90.find(([kk]) => kk === k)[1];
      if (k === 'parts') assert.ok(len <= s.st.plan.cap, `${w}x${h}: ${len} trails`); else assert.equal(len, l90, `${w}x${h}: ${k} changed from ${l90} to ${len}`);
    }
    assert.ok(most <= 2, `${w}x${h}: ${most} alive in the freeway`);
    assert.equal(s.st.parts.length <= 2, true);
  }
  for (const [w, h] of [[120, 40], [80, 24]]) {
    for (const speed of [1, 4]) {
      const { worst } = composerRun(overdrive, w, h, speed, 150);
      assert.ok(worst < 0.28, `${w}x${h} ${speed}x over 150 s: ${(worst * 100).toFixed(2)}%`);
    }
  }
});

test('overdrive (D7b): a run drawn only every 7th step shows the same frame at the same step as a run drawn every step', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const a = stepper(w, h), b = stepper(w, h);
    for (let n = 1; n <= 2800; n++) {
      overdrive.step(a.st);
      overdrive.step(b.st);
      if (n % 7 === 0) { assert.deepEqual(a.look(), b.look(), `${w}x${h} n=${n}`); } else if (n % 5 === 0) b.look();
    }
    assert.deepEqual(a.st, b.st);
  }
});

// ---- D8

function walk(w, h, seconds, each, scene = overdrive) {
  const s = stepper(w, h, 1, scene);
  let owed = 0, prev = null;
  for (let k = 0; k < seconds * FPS; k++) {
    owed += 30 / FPS;
    while (owed >= 1) { scene.step(s.st); owed -= 1; }
    const cur = s.look();
    if (prev) each(prev, cur, k / FPS);
    prev = cur;
  }
}

test('overdrive (D8): over 90 s no cell that keeps its glyph changes family or moves more than one shade in a frame; the L* step stays under 28 (brightnessJumps)', () => {
  let ramps = 0, jumps = 0;
  for (const [w, h] of [[120, 40], [80, 24], [40, 12], [41, 11]]) {
    walk(w, h, 90, (a, b, t) => {
      for (let i = 0; i < a.g.length; i++) {
        if (a.g[i] === 32 || a.g[i] !== b.g[i] || a.c[i] === b.c[i]) continue;
        const fa = familyOf(a.c[i]), fb = familyOf(b.c[i]);
        assert.ok(fa && fb && fa[0] === fb[0], `${w}x${h} t=${t.toFixed(2)} cell ${i} (${i % w},${Math.floor(i / w)}): colour ${a.c[i]} -> ${b.c[i]} changes family under glyph U+${a.g[i].toString(16)}`);
        assert.equal(Math.abs(fa[1].indexOf(a.c[i]) - fb[1].indexOf(b.c[i])), 1, `${w}x${h} t=${t.toFixed(2)} cell ${i}: more than one shade`);
        ramps++;
      }
      const j = brightnessJumps({ ...a, L: LTAB }, { ...b, L: LTAB }, w);
      assert.equal(j.length, 0, `${w}x${h} t=${t.toFixed(2)}: ${JSON.stringify(j.slice(0, 3))}`);
      jumps++;
    });
  }
  assert.ok(ramps > 400, `${ramps} ramp steps were checked`);
  assert.ok(jumps > 6000);
});

// ---- D9

test('overdrive (D9): compact: at 80x24 4 rings or fewer, 6 trails or fewer and the 20x4 car; at 40x12 and 41x11 2 rings or fewer', () => {
  for (const [w, h, rings, trails] of [[80, 24, 4, 6], [60, 18, 4, 6], [40, 12, 2, 3], [41, 11, 2, 3], [30, 10, 2, 3]]) {
    for (const n of [200, 449, 460, 700, 1000, 1500, 1795]) {
      const f = frameAt(n, w, h);
      const corners = cellsWhere(f, (g, c) => g === TL && (c === VIOLET[1] || c === FAR));
      assert.ok(corners.length <= rings, `${w}x${h} n=${n}: ${corners.length} rings`);
      const heads = cellsWhere(f, (g, c) => g === HEAD && (c === CORAL[3] || c === ICE[3]));
      assert.ok(heads.length <= trails, `${w}x${h} n=${n}: ${heads.length} trails`);
    }
    const f = frameAt(1000, w, h), b = carBox(w, h);
    assert.equal(at(f, b.x0 + 4, b.y0).g, cp('▗'), `${w}x${h}: the 20x4 car`);
    assert.equal((b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1), 80);
  }
  // the ring count really is what the layouts promise at full size too
  const f = frameAt(1000, 120, 40);
  assert.equal(cellsWhere(f, (g, c) => g === TL && (c === VIOLET[1] || c === FAR)).length, 7);
  assert.equal(cellsWhere(frameAt(1000, 80, 24), (g, c) => g === TL && (c === VIOLET[1] || c === FAR)).length, 4);
});

// ---- D10

test('overdrive (D10): allowed glyphs, none banned (also not ◐ ◓ ◒), colours inside the 52-entry palette, blanks in colour 0, lit cells a real colour, at every size', () => {
  const stepsList = [0, 1, 90, 300, 449, 450, 500, 700, 1200, 1795, 1801, 1830, 1861, 1900, 1979, 1985, 2400, 2700, 3600, 4500];
  for (const [w, h] of [...SIZES, [100, 32], [1, 1], [0, 0], [2, 200]]) {
    const s = stepper(w, h);
    let litSeen = 0;
    for (const n of stepsList) {
      const f = s.to(n).look();
      let lit = 0;
      for (let i = 0; i < f.g.length; i++) {
        assert.ok(isAllowedGlyph(f.g[i]), `${w}x${h} n=${n}: U+${f.g[i].toString(16)}`);
        assert.ok(!BANNED.includes(f.g[i]), `${w}x${h} n=${n}: banned U+${f.g[i].toString(16)}`);
        assert.ok(f.c[i] < COUNT, `${w}x${h} n=${n}: colour ${f.c[i]}`);
        if (f.g[i] === 32) assert.equal(f.c[i], 0, `${w}x${h} n=${n}: blank cell colour`);
        else { assert.ok(f.c[i] >= 16, `${w}x${h} n=${n}: lit cell colour ${f.c[i]}`); lit++; }
      }
      litSeen = Math.max(litSeen, lit);
      if (w >= 30 && h >= 9) assert.ok(lit > 0.05 * f.g.length, `${w}x${h} n=${n}: ${lit} lit`);
    }
    if (w < 30 || h < 9) assert.equal(litSeen, 0);
  }
});

// ---- lib/skyline.js (slice 3's skyline scene reuses it)

test('night-drive skyline (lib): buildings 3 to 6 wide on one line, only block glyphs and the small square, a cap per column, pure, and the seed and salt change it', () => {
  const args = { x0: 2, x1: 117, base: 15, maxH: 12, seed: 1 };
  const a = skylineCells(args);
  assert.deepEqual(a, skylineCells(args), 'pure');
  assert.ok(a.length > 300, `${a.length} cells`);
  for (const c of a) {
    assert.ok(c.x >= 2 && c.x <= 117 && c.y >= 15 - 12 && c.y <= 14, `cell ${c.x},${c.y} on the line`);
    assert.ok([SKY_ROOF, SKY_WALL, SKY_WINDOW].includes(c.g) && isAllowedGlyph(c.g));
    assert.ok(c.c === FAR || c.c === NEAR || c.c === SUN[1]);
    assert.ok(c.g !== SKY_WINDOW || c.c === SUN[1]);
  }
  assert.equal(new Set(a.map((c) => c.x + ',' + c.y)).size, a.length, 'no cell twice');
  const roofs = a.filter((c) => c.g === SKY_ROOF);
  assert.ok(roofs.length >= 15, 'every building has a roof');
  assert.ok(a.some((c) => c.g === SKY_WINDOW) && a.some((c) => c.c === NEAR), 'windows, and near buildings among the far');
  const capped = skylineCells({ ...args, cap: (x) => (x > 40 && x < 80 ? 3 : 12) });
  assert.ok(capped.filter((c) => c.x > 40 && c.x < 80).every((c) => c.y >= 15 - 3), 'the cap holds in its columns');
  assert.ok(capped.filter((c) => c.x <= 40).some((c) => c.y < 15 - 5), 'and not outside them');
  assert.notDeepEqual(skylineCells({ ...args, seed: 2 }), a, 'the seed matters');
  assert.notDeepEqual(skylineCells({ ...args, salt: 9 }), a, 'the salt matters');
  assert.deepEqual(skylineCells({ x0: 5, x1: 4, base: 10, maxH: 5, seed: 1 }), [], 'an empty span');
});
