// DRIFT-5: scene A4, Coast Road 86. The design's promises, read off rendered frames:
//   - a side view: the Vantra Halcyon in profile on a cliff road, a moon (14x6; 8x4 when small) with a path of glitter on the sea, a far
//     headland with a lighthouse, guard-rail posts, a retaining wall with coral reflectors, a palm that passes in front
//   - the car stands still and the world moves: posts a column per 0.05 s, the headland a column per 4 s, the palm a column per 0.05 s
//   - wheels step once per 0.25 s (never faster: at 4x anything quicker strobes); glitter cells change at most every 0.6 s, at most 15
//     a frame; the lighthouse beam swings on an 8 s turn and shows for half of it, a dash at a time
//   - calm: under 5% of the cells change in a frame (the design says about 2.5%), no kept glyph moves more than a shade step
import test from 'node:test';
import assert from 'node:assert/strict';
import coast, { LAYOUTS, layoutFor, geometry, beamLength, hillAt, palmStart } from '../cartridges/night-drive/scenes/coast.js';
import { renderScene } from '../src/cells.js';
import * as S from '../cartridges/night-drive/lib/sprites.js';
import { ICE, FAR, NEAR, CORAL, VIOLET, COUNT } from '../cartridges/night-drive/lib/palette.js';
import { FPS, BANNED, MANIFEST, framer, rowText, cellsOf, rampViolations, changedShare, calmRun, walk, meanMs, cp } from './helpers-night-drive.js';

const frame = framer(coast);
const palmCells = (f) => {
  const roadY = f.h - 5, out = [];
  for (let i = 0; i < f.g.length; i++) if (f.c[i] === NEAR && f.g[i] !== 32 && Math.floor(i / f.w) < roadY) out.push(i);
  return out;
};

// ---- C1 the contract and the manifest

test('night-drive coast (C1): a cells scene called coast, LAYOUTS widest first from 100x32, layoutFor, and the manifest lists it between Sundown Grid and Red Light, Rain with its menu entry', () => {
  assert.equal(coast.id, 'coast');
  assert.equal(coast.kind, 'cells');
  assert.ok(Array.isArray(LAYOUTS) && LAYOUTS.length >= 2);
  assert.deepEqual([LAYOUTS[0].minCols, LAYOUTS[0].minRows], [100, 32]);
  assert.deepEqual([LAYOUTS[LAYOUTS.length - 1].minCols, LAYOUTS[LAYOUTS.length - 1].minRows], [0, 0]);
  assert.equal(layoutFor(120, 40).name, LAYOUTS[0].name);
  assert.equal(layoutFor(100, 32).name, LAYOUTS[0].name, 'at the breakpoint: the big layout');
  assert.notEqual(layoutFor(99, 32).name, LAYOUTS[0].name);
  assert.notEqual(layoutFor(100, 31).name, LAYOUTS[0].name);
  assert.notEqual(layoutFor(80, 24).name, LAYOUTS[0].name);
  const ids = MANIFEST.scenes.map((s) => s.id);
  assert.ok(ids.indexOf('sundown') < ids.indexOf('coast') && ids.indexOf('coast') < ids.indexOf('redlight'), 'tape order: A3 sundown, A4 coast, B1 redlight');
  const sc = MANIFEST.scenes.find((s) => s.id === 'coast');
  assert.deepEqual([sc.kind, sc.title], ['cells', 'Coast Road 86']);
  assert.deepEqual(MANIFEST.programs[0].scenes, ids);
  const entry = MANIFEST.menu.find((e) => e.scene === 'coast');
  assert.ok(entry);
  assert.deepEqual([entry.label, entry.program, entry.note], ['A4  COAST ROAD 86', 'tape', '1:30']);
  assert.ok(entry.desc && [...entry.desc].length <= 76);
  const labels = MANIFEST.menu.map((e) => e.label);
  assert.ok(labels.indexOf('A3  SUNDOWN GRID') < labels.indexOf(entry.label) && labels.indexOf(entry.label) < labels.indexOf('B1  RED LIGHT, RAIN'));
});

// ---- C2 purity

test('night-drive coast (C2): the same (t, w, h, seed) draws the same frame; t0 shifts the scene\'s own clock; the seed changes the picture; odd times do not throw', () => {
  for (const [w, h] of [[120, 40], [80, 24], [100, 32], [240, 67]]) {
    for (const t of [0, 5.3, 12, 33.7]) {
      const a = frame(t, w, h, 1), b = frame(t, w, h, 1);
      assert.deepEqual(a.g, b.g);
      assert.deepEqual(a.c, b.c);
    }
  }
  const early = frame(10, 120, 40, 1, 0), later = frame(40, 120, 40, 1, 30);
  assert.deepEqual(later.g, early.g, 'the frame at t = 40 with t0 = 30 is the frame at t = 10');
  assert.deepEqual(later.c, early.c);
  assert.notDeepEqual(frame(10, 120, 40, 1, 0).g, frame(10, 120, 40, 1, 3).g, 'a different t0 is a different moment');
  assert.notDeepEqual(frame(10, 120, 40, 1).g, frame(10, 120, 40, 2).g, 'the seed matters');
  for (const t of [-5, NaN, Infinity, -Infinity, 1e9]) assert.doesNotThrow(() => frame(t), String(t));
  assert.deepEqual(frame(-5).g, frame(0).g);
  assert.deepEqual(Array.from(renderScene(coast, 12.5, 120, 40, 1).glyphs), Array.from(frame(12.5).g), 'the shared renderer gives the same picture');
});

// ---- C3 the world moves, the car does not

const xsOf = (f, ch, col, y) => cellsOf(f, ch, col).filter(([, yy]) => yy === y).map(([x]) => x);

test('night-drive coast (C3): the posts slide left a column every 0.05 s (every 10th column), the wall reflectors with them; the car does not move', () => {
  const W = 120, H = 40, g = geometry(W, H);
  assert.equal(g.postY, H - 4);
  for (let c = 0; c < 60; c++) {
    const f = frame(c * 0.05 + 0.01, W, H);
    const posts = xsOf(f, '╥', ICE[0], g.postY);
    assert.deepEqual(posts, Array.from({ length: W }, (_, x) => x).filter((x) => (x + c) % 10 === 0), `posts at step ${c}`);
    if (c > 0) {
      const before = xsOf(frame((c - 1) * 0.05 + 0.01, W, H), '▪', CORAL[1], g.wallTop + 1);
      const now = xsOf(f, '▪', CORAL[1], g.wallTop + 1);
      assert.ok(now.length >= 4, `${now.length} reflectors on the wall`);
      for (const x of before) if (x > 0) assert.ok(now.includes(x - 1), `the reflector at ${x} moved to ${x - 1}`);
    }
  }
  // the car's cells (but for its wheels) are the same at every time
  for (const t of [0.3, 1.9, 41.3, 77.7]) {
    const f = frame(t, W, H);
    for (let j = 0; j < S.PROFILE_H - 1; j++) {
      let i = 0;
      for (const ch of S.PROFILE_33[j]) { if (ch !== ' ') assert.equal(f.g[(g.carY + j) * W + g.carX + i], cp(ch), `t=${t}: the car's cell (${i}, ${j})`); i++; }
    }
  }
});

const farRows = (f, g) => { const out = []; for (let y = g.landBottom - 7; y <= g.landBottom; y++) for (let x = 0; x < f.w; x++) out.push(f.c[y * f.w + x] === FAR ? f.g[y * f.w + x] : 0); return out; };

test('night-drive coast (C3): the headland, and the lighthouse on it, slide left one column every 4 s and hold still in between', () => {
  const W = 120, H = 40, g = geometry(W, H);
  // the far-silhouette cells of the headland rows (the lighthouse included), with the cells the palm covers marked -1
  const rowsAt = (t) => { const f = frame(t, W, H); const r = []; for (let y = g.landBottom - 7; y <= g.landBottom; y++) r.push(Array.from({ length: W }, (_, x) => (f.c[y * W + x] === NEAR ? -1 : f.c[y * W + x] === FAR ? f.g[y * W + x] : 0))); return r; };
  let compared = 0;
  for (let from = 0; from < 80; from += 4) {
    const t1 = from + 1.3;
    const a = rowsAt(t1), b = rowsAt(t1 + 4); // one step apart
    for (let r = 0; r < a.length; r++) for (let x = 0; x < W - 1; x++) {
      if (a[r][x + 1] === -1 || b[r][x] === -1) continue;
      assert.equal(b[r][x], a[r][x + 1], `t=${t1}: row ${r} column ${x} is the old column ${x + 1}`);
      compared++;
    }
  }
  assert.ok(compared > 10 * 8 * 80, `${compared} cells compared`);
  // control: two frames in the same step do not differ, and a frame two steps on does
  const same = rowsAt(1.3), later = rowsAt(9.3);
  let differ = 0;
  for (let r = 0; r < same.length; r++) for (let x = 0; x < W - 1; x++) if (same[r][x + 1] !== -1 && later[r][x] !== -1 && later[r][x] !== same[r][x + 1]) differ++;
  assert.ok(differ > 0, 'two steps on is not one step on');
  // hold: within one 4 s step nothing of the headland moves
  let held = 0;
  for (let t = 0.1; t < 40 && held < 3; t += 0.37) {
    const t2 = t + 0.35;
    if (t % 4 < 1.4 || t2 % 4 < 1.4 || Math.floor(t / 4) !== Math.floor(t2 / 4) || palmCells(frame(t)).length || palmCells(frame(t2)).length) continue;
    assert.deepEqual(farRows(frame(t), g), farRows(frame(t2), g), `the headland holds still between ${t} and ${t2}`);
    held++;
  }
  assert.equal(held, 3);
  // the hills are a function of the world column: a step shifts them by one
  for (let x = 0; x < 400; x++) assert.ok(hillAt(x, 1, 4, null) >= 0 && hillAt(x, 1, 4, null) <= 4 && hillAt(x, 1, 2, null) <= 2);
  for (let x = 33; x <= 39; x++) assert.equal(hillAt(x, 1, 4, 36), 4, 'the headland is at its full height under the lighthouse');
});

test('night-drive coast (C3): the lighthouse beam is 10 dashes of ice 0 at most, swings on an 8 s turn, shows for 4 s of it and grows and shrinks a dash at a time', () => {
  assert.deepEqual([4, 5, 6, 7, 7.9].map(beamLength), [0, 0, 0, 0, 0], 'turned away for the second half');
  assert.equal(beamLength(2), 10);
  assert.equal(beamLength(0), 0);
  const W = 120, H = 40;
  const lampOf = (f) => { const c = cellsOf(f, '●', ICE[3]); return c.length === 1 ? c[0] : null; };
  const g0 = geometry(W, H), lampRow = g0.landBottom - 7;
  const series = (speed, seconds) => {
    const out = [];
    const n = Math.ceil((seconds * FPS) / speed);
    for (let k = 0; k <= n; k++) {
      const t = (k * speed) / FPS, f = frame(t, W, H);
      if (palmCells(f).some((i) => Math.floor(i / W) === lampRow)) { out.push(null); continue; } // the palm hides what it crosses
      const lamp = lampOf(f);
      assert.ok(lamp, `the lamp at ${t}`);
      assert.equal(lamp[1], lampRow);
      let len = 0;
      while (f.g[lamp[1] * W + lamp[0] + 1 + len] === cp('─') && f.c[lamp[1] * W + lamp[0] + 1 + len] === ICE[0]) len++;
      out.push({ t, len });
    }
    return out;
  };
  const s1 = series(1, 24);
  const seen = s1.filter(Boolean);
  assert.ok(seen.length > 200);
  assert.ok(Math.max(...seen.map((x) => x.len)) === 10, 'at its longest the beam is ten dashes');
  for (const x of seen) {
    const q = (x.t % 8) / 8;
    if (q >= 0.5) assert.equal(x.len, 0, `${x.t}: the beam is turned away for the second half of the turn`);
    else assert.equal(x.len, beamLength(x.t), `${x.t}: swelling and shrinking`);
  }
  for (const [speed, limit] of [[1, 1], [4, 3]]) {
    const s = series(speed, 40);
    s.forEach((x, k) => { if (k && x && s[k - 1]) assert.ok(Math.abs(x.len - s[k - 1].len) <= limit, `${speed}x at ${x.t}: ${s[k - 1].len} -> ${x.len}`); });
  }
  // peak at 2 s into the turn, none at 4 s
  assert.ok(seen.find((x) => Math.abs(x.t - 2) < 0.06).len >= 9);
  assert.equal(seen.find((x) => Math.abs(x.t - 4.5) < 0.06).len, 0);
});

// ---- C-wheel

test('night-drive coast (C-wheel): both wheels show the same frame of the spinner, stepping exactly every 0.25 s, so no wheel cell changes in two consecutive frames at 18 fps', () => {
  const W = 120, H = 40, g = geometry(W, H);
  const cellsOfWheels = [];
  for (const wh of S.PROFILE_WHEELS) for (let i = 0; i < 3; i++) cellsOfWheels.push((g.carY + wh.y) * W + g.carX + wh.x + i);
  const frameAt = (t) => { const f = frame(t, W, H); return S.WHEEL_FRAMES.map((fr) => fr).findIndex((fr) => S.PROFILE_WHEELS.every((wh) => rowText(f, g.carY + wh.y).slice(g.carX + wh.x, g.carX + wh.x + 3) === fr)); };
  // exactly the four frames, in order, a quarter second each
  const seq = [];
  for (let k = 0; k < 8; k++) seq.push(frameAt(k * 0.25 + 0.01));
  assert.deepEqual(seq, [0, 1, 2, 3, 0, 1, 2, 3]);
  for (let k = 0; k < 40; k++) assert.ok(frameAt(k / FPS) >= 0, `at frame ${k} both wheels show one frame of the spinner`);
  // the cells of the wheels: when each changes, and how long it then holds
  const last = new Map();
  let changes = 0;
  walk(frame, W, H, 1, 20, (a, b, t) => {
    for (const i of cellsOfWheels) {
      if (a.g[i] === b.g[i] && a.c[i] === b.c[i]) continue;
      changes++;
      if (last.has(i)) {
        const gap = t - last.get(i);
        assert.ok(gap >= 0.25 - 1 / FPS - 1e-9, `wheel cell ${i} changed again after ${gap.toFixed(3)} s`);
        assert.ok(gap > 1.5 / FPS, 'never in two consecutive frames');
      }
      last.set(i, t);
    }
  });
  assert.ok(changes >= 2 * 78 && changes <= 2 * 80, `${changes} wheel cell changes in 20 s (two wheels, 4 a second)`);
  // control: a spinner that steps every frame would change a cell in consecutive frames
  const quick = (t) => S.WHEEL_FRAMES[Math.floor(t * FPS) & 3];
  assert.notEqual(quick(0), quick(1 / FPS));
  assert.equal(S.WHEEL_STEP, 0.25);
});

// ---- C-glitter

test('night-drive coast (C-glitter): the moon path of dashes and dots changes a cell at most every 0.6 s and 15 cells or fewer in a frame; it lies under the moon', () => {
  const W = 120, H = 40, g = geometry(W, H);
  const inCar = (x, y) => x >= g.carX - 1 && x <= g.carX + S.PROFILE_W + 4 && y >= g.carY;
  const isGlitter = (f, i) => {
    const x = i % W, y = Math.floor(i / W);
    return y >= g.seaTop && y < g.roadY && !inCar(x, y) && (f.g[i] === cp('━') || f.g[i] === cp('─') || f.g[i] === cp('·')) && [ICE[1], ICE[2], ICE[3]].includes(f.c[i]);
  };
  const cells = new Set();
  for (let k = 0; k < 20 * FPS; k++) { const f = frame(k / FPS, W, H); for (let i = 0; i < f.g.length; i++) if (isGlitter(f, i)) cells.add(i); }
  assert.ok(cells.size >= 30 && cells.size <= 40, `${cells.size} glitter cells`);
  const cxm = g.moon.x + (g.moon.w >> 1);
  for (const i of cells) assert.ok(Math.abs((i % W) - cxm) <= 9 && Math.floor(i / W) >= g.seaTop, 'under the moon');
  const state = (f, i) => (f.g[i] === 32 || ((f.g[i] === cp('━') || f.g[i] === cp('─') || f.g[i] === cp('·')) && [ICE[1], ICE[2], ICE[3]].includes(f.c[i])) ? f.g[i] : -1);
  for (const speed of [1, 4]) {
    const last = new Map();
    let worst = 0, total = 0, frames = 0;
    walk(frame, W, H, speed, 60, (a, b, t) => {
      let n = 0;
      for (const i of cells) {
        const sa = state(a, i), sb = state(b, i);
        if (sa === -1 || sb === -1 || sa === sb) continue; // the palm covering a cell is not the glitter changing
        n++;
        if (last.has(i)) assert.ok(t - last.get(i) >= 0.6 - speed / FPS - 1e-9, `${speed}x: cell ${i} changed again after ${(t - last.get(i)).toFixed(3)} s`);
        last.set(i, t);
      }
      worst = Math.max(worst, n); total += n; frames++;
    });
    if (speed === 1) assert.ok(worst <= 15, `worst ${worst} glitter cells in a frame`); else assert.ok(worst <= 60, `4x worst ${worst}`);
    assert.ok(total / frames > 0.5, 'the glitter does shimmer');
    console.log(`# coast glitter ${speed}x: mean ${(total / frames).toFixed(2)}, worst ${worst} cells a frame`);
  }
  // control: every glitter cell changing on one tick is over the bound
  assert.ok(cells.size > 15);
});

// ---- C-mountains

const SAFE = new Set(['▄', '█', '▟', '▙', '▗', '▖', '▀', '▐', '▌', ' ', '·', '°'].map(cp));

test('night-drive coast (C-mountains): every glyph in the headland rows is one of the safe block glyphs (stars aside), and the hills are there', () => {
  for (const [w, h] of [[120, 40], [80, 24], [100, 32], [240, 67], [60, 20]]) {
    const g = geometry(w, h);
    for (const t of [0, 3.7, 8, 21.5, 44, 89]) {
      const f = frame(t, w, h);
      let lit = 0;
      for (let y = g.landBottom - g.ridgeRows + 1; y <= g.landBottom; y++) {
        for (let x = 0; x < w; x++) {
          const v = f.g[y * w + x];
          assert.ok(SAFE.has(v), `${w}x${h} t=${t}: U+${v.toString(16)} in the headland rows`);
          if (v !== 32 && v !== cp('·') && v !== cp('°')) lit++;
        }
      }
      assert.ok(lit > w * g.ridgeRows * 0.25, `${w}x${h}: ${lit} hill cells`);
    }
  }
  // control: the banned glyphs are not in the allowed set
  for (const b of BANNED) assert.ok(!SAFE.has(b));
});

// ---- C-palm

test('night-drive coast (C-palm): a palm crosses right to left every 6 to 10 s in near silhouette, a column every 0.05 s, in front of the sea and behind the car', () => {
  const W = 120, H = 40, g = geometry(W, H);
  // cadence from the scene's own function, and from the frames
  for (let n = 0; n < 200; n++) { const gap = palmStart(n + 1, 1) - palmStart(n, 1); assert.ok(gap >= 6 - 1e-9 && gap <= 10 + 1e-9, `gap ${gap}`); }
  // a palm enters when cells of the near colour appear in the last column
  const edge = [];
  for (let k = 0; k <= 90 * 20; k++) { const f = frame(k * 0.05, W, H); edge.push(palmCells(f).some((i) => i % W === W - 1)); if (k === 0) assert.ok(palmCells(f).length > 0, 'a palm is already crossing at the start (key frame 2)'); }
  const enters = [];
  for (let k = 1; k < edge.length; k++) if (edge[k] && !edge[k - 1]) enters.push(k * 0.05);
  assert.ok(enters.length >= 9 && enters.length <= 13, `${enters.length} palms entered in 90 s`);
  for (let k = 1; k < enters.length; k++) {
    const gap = enters[k] - enters[k - 1];
    assert.ok(gap >= 6 - 0.11 && gap <= 10 + 0.11, `palms ${k - 1} and ${k} entered ${gap.toFixed(2)} s apart`);
  }
  // speed: the left edge of the crown moves a column every 0.04 s
  const leftEdge = (t) => { const f = frame(t, W, H); const xs = palmCells(f).map((i) => i % W); return Math.min(...xs); };
  const t1 = enters[0] + 1;
  assert.ok(Math.abs(leftEdge(t1) - leftEdge(t1 + 1) - 20) <= 1, `${leftEdge(t1)} -> ${leftEdge(t1 + 1)} in a second`);
  // it is a silhouette in the near colour, in front of the sea (the sea's cells are gone under it) and behind the car
  const tm = enters[0] + 1.2;
  const f = frame(tm, W, H);
  const cells = palmCells(f);
  assert.ok(cells.length >= 25 && cells.length <= 120, `${cells.length} cells`);
  for (const i of cells) assert.ok(Math.floor(i / W) < g.roadY && '▄▀█▐▌'.includes(String.fromCharCode(f.g[i])), 'palm glyphs only');
  const car = frame(tm, W, H);
  assert.equal(rowText(car, g.carY + 1).slice(g.carX + 8, g.carX + 12), S.PROFILE_33[1].slice(8, 12), 'the car is in front of the palm');
  // entering and leaving never makes a frame over the budget: the number of palm cells moves by under 5% of the picture per frame, at 1x and 4x
  for (const speed of [1, 4]) {
    let worst = 0, prev = palmCells(frame(0, W, H)).length;
    for (let k = 1; k <= (90 * FPS) / speed; k++) { const n = palmCells(frame((k * speed) / FPS, W, H)).length; worst = Math.max(worst, Math.abs(n - prev)); prev = n; }
    assert.ok(worst < W * H * 0.05, `${speed}x: the palm changes by ${worst} cells in a frame`);
  }
});

// ---- C-compact and the key frames

const moonBox = (f, g) => {
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < g.landBottom; y++) for (let x = 0; x < f.w; x++) {
    const i = y * f.w + x;
    if ((f.c[i] === ICE[3] && '▄▀█▐▌'.includes(String.fromCharCode(f.g[i]))) || (f.g[i] === cp('▓') && f.c[i] === ICE[1])) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, x0, y0 };
};
const seaRowsOf = (f, g) => { const rows = new Set(); for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const i = y * f.w + x; if (f.c[i] === VIOLET[0] && (f.g[i] === cp('─') || f.g[i] === cp('~'))) rows.add(y); } return [...rows].sort((a, b) => a - b); };

test('night-drive coast (C-compact): 120x40 has a 14x6 moon with maria, a lighthouse and sea; 80x24 has an 8x4 moon, 5 sea rows and no lighthouse; the car, posts and wall are in both', () => {
  const big = frame(0), bg = geometry(120, 40);
  const mb = moonBox(big, bg);
  assert.deepEqual([mb.w, mb.h], [14, 6]);
  assert.ok(mb.x0 > 60, 'upper right');
  assert.ok(cellsOf(big, '▓', ICE[1]).length >= 2, 'maria in ice 1');
  assert.equal(cellsOf(big, '●', ICE[3]).length, 1, 'a lighthouse lamp');
  let beam = 0;
  for (let t = 1.5; t < 2.6; t += 0.05) beam = Math.max(beam, cellsOf(frame(t), '─', ICE[0]).filter(([, y]) => y === bg.landBottom - 7).length);
  assert.ok(beam >= 6, `the lighthouse beam (${beam} dashes at its longest, the palm may hide some)`);
  assert.equal(seaRowsOf(big, bg).length, bg.seaRows);
  assert.equal(bg.seaRows, 12);
  const small = frame(0, 80, 24), sg = geometry(80, 24);
  const sb = moonBox(small, sg);
  assert.deepEqual([sb.w, sb.h], [8, 4]);
  assert.equal(sg.seaRows, 5);
  assert.equal(seaRowsOf(small, sg).length, 5, '5 rows of sea');
  assert.equal(cellsOf(small, '●', ICE[3]).length, 0, 'no lighthouse');
  for (let t = 0; t < 30; t += 0.7) { const f = frame(t, 80, 24); assert.equal(cellsOf(f, '●', ICE[3]).length, 0); assert.equal(beamLength(t) >= 0, true); assert.equal(cellsOf(f, '─', ICE[0]).length, 0, 'no beam at 80x24'); }
  for (const [f, g] of [[big, bg], [small, sg]]) {
    assert.ok(/^▀+$/.test(rowText(f, g.roadY)), 'the cliff road');
    assert.ok(xsOf(f, '╥', ICE[0], g.postY).length >= 8, 'guard-rail posts');
    assert.ok(/^▓+$/.test(rowText(f, g.wallTop)) && /^▓+$/.test(rowText(f, f.h - 1)), 'the retaining wall');
    assert.ok(xsOf(f, '▪', CORAL[1], g.wallTop + 1).length >= 3, 'coral reflectors');
    assert.ok(rowText(f, g.carY + 2).includes('▐█'), 'the Halcyon');
    assert.ok(rowText(f, g.carY + 2).includes('═══'), 'headlight beam');
    assert.ok(cellsOf(f, '━', CORAL[3]).length >= 1, 'tail light');
  }
  // key frame 2: a palm passes the left side at 3 s
  const k2 = frame(3);
  const xs = palmCells(k2).map((i) => i % 120);
  assert.ok(xs.length >= 10 && Math.min(...xs) < 60, 'a palm passes the left side at t = 3 s');
});

// ---- C8 calm and safety

const SIZES = [[120, 40], [80, 24], [100, 32]];

test('night-drive coast (C8): 90 s at 1x and 4x at 120x40, 80x24 and 100x32: under 5% of the cells change a frame (never 30%), no kept glyph breaks the ramp rule, the background is never drawn, allowed glyphs only, none banned, colours inside the palette', () => {
  const rows = [];
  for (const [w, h] of SIZES) {
    for (const speed of [1, 4]) {
      const r = calmRun(frame, w, h, speed);
      rows.push(`${w}x${h} ${speed}x worst ${(r.worst * 100).toFixed(2)}% at ${r.at.toFixed(2)} s`);
      assert.ok(r.worst < 0.3, `${w}x${h} ${speed}x: ${r.worst}`);
      assert.ok(r.worst < 0.05, `${w}x${h} ${speed}x: worst ${(r.worst * 100).toFixed(2)}% at ${r.at.toFixed(2)} s`);
      assert.ok(r.worst > 0.001, 'it moves');
      assert.equal(r.ramp, 0, `${w}x${h} ${speed}x: ${JSON.stringify(r.firstRamp)}`);
      assert.equal(r.blankBad, 0, 'a blank cell is colour 0 (the one background)');
      assert.equal(r.glyphBad, 0, 'allowed glyphs only');
      assert.equal(r.banned, 0, 'none of the banned set');
      assert.equal(r.colourBad, 0, `colours are the fixed families, below ${COUNT}`);
      assert.ok(r.litMin > w * h * 0.1, `${w}x${h}: never nearly blank (${r.litMin} cells lit)`);
    }
  }
  console.log('# coast: ' + rows.join(' | '));
  // controls: everything redrawn is over the share bound; a cell going from the dimmest to the brightest ice breaks the ramp rule
  const a = frame(0), b = { g: a.g.map(() => cp('█')), c: a.c.map(() => ICE[3]), w: 120, h: 40 };
  assert.ok(changedShare(a, b) > 0.9);
  const dim = { g: a.g.map(() => cp('─')), c: a.c.map(() => ICE[0]), w: 120, h: 40 };
  const bright = { g: dim.g, c: dim.c.map(() => ICE[3]), w: 120, h: 40 };
  assert.equal(rampViolations(dim, bright).length, 120 * 40);
  const step = { g: dim.g, c: dim.c.map(() => ICE[1]), w: 120, h: 40 };
  assert.equal(rampViolations(dim, step).length, 0);
});

test('night-drive coast (C8): at and around the breakpoints and a spread of sizes, 24 s at 4x: the ramp rule, the 30% rule and the glyph rules hold', () => {
  for (const [w, h] of [[99, 31], [100, 31], [99, 32], [101, 33], [60, 20], [40, 18], [41, 19], [160, 48], [240, 67], [200, 30]]) {
    const r = calmRun(frame, w, h, 4, 24);
    assert.equal(r.ramp, 0, `${w}x${h}: ${JSON.stringify(r.firstRamp)}`);
    assert.ok(r.worst < 0.3, `${w}x${h}: ${r.worst}`);
    assert.equal(r.blankBad + r.glyphBad + r.banned + r.colourBad, 0, `${w}x${h}`);
  }
});

// ---- C9 sizes

test('night-drive coast (C9): 0x0, 1x1, 41x11, 99x31, 100x32, 240x67 and 400x120 do not throw; blank cells are glyph 32 in colour 0; small windows draw nothing', () => {
  const sizes = [[0, 0], [1, 1], [3, 3], [41, 11], [99, 31], [100, 32], [240, 67], [400, 120], [2, 200], [200, 2], [40, 18], [39, 40], [120, 17]];
  for (const [w, h] of sizes) {
    for (const t of [0, 7.7, 12, 38.5, 1e6]) {
      let f;
      assert.doesNotThrow(() => { f = frame(t, w, h); }, `${w}x${h} t=${t}`);
      for (let i = 0; i < f.g.length; i++) if (f.g[i] === 32) assert.equal(f.c[i], 0);
    }
  }
  const lit = (w, h) => frame(5, w, h).g.reduce((n, v) => n + (v === 32 ? 0 : 1), 0);
  assert.equal(lit(41, 11), 0);
  assert.equal(lit(0, 0), 0);
  assert.ok(lit(99, 31) > 200 && lit(100, 32) > 200 && lit(400, 120) > 2000);
});

// ---- C10 scale

test('night-drive coast (C10): a 240x67 frame costs under 20 ms on average over 200 frames (the aim is 3 ms); a scan of the whole picture a few thousand times would not', () => {
  const g = new Uint16Array(240 * 67), c = new Uint8Array(240 * 67);
  const ms = meanMs((t) => coast(t, 240, 67, { seed: 1, glyphs: g, colours: c }), 200);
  console.log(`# coast 240x67: ${ms.toFixed(3)} ms a frame`);
  assert.ok(ms < 20, `${ms} ms`);
  const slow = (t, w, h, p) => { for (let k = 0; k < 6000; k++) for (let i = 0; i < p.glyphs.length; i++) p.glyphs[i] = (k + i) & 0xff; };
  const slowMs = meanMs((t) => slow(t, 240, 67, { glyphs: g, colours: c }), 5);
  assert.ok(slowMs > 20, `the control costs ${slowMs} ms and fails the bound`);
});
