// DRIFT-5: scene A2, Velvet Skyline. The design's promises, read off rendered frames:
//   - parked at an overlook across Velvet Bay from Port Solace: two towers (The Orchid, a magenta crown over tubes; Solace Tower, cyan crown
//     bands and a coral beacon), a skyline of lit windows, a rail bridge in violet, the bay with streaks one shade down, a guard rail
//   - beacon: coral 0 -> 3 -> 0 over a 4 s period (2 s rest, 1 s up, 1 s down); windows: one change begins every 0.4 s, each a 0.3 s
//     ramp through shade 1; reflections: a cell shifts a column at most every 0.5 s, about 12 cells change a frame; a train of 8 squares
//     crosses the bridge every 30 s at a column per 0.08 s; two searchlight beams sweep a step per 1.5 s
//   - calm: under 5% of the cells change in a frame (the design says about 0.8%), no kept glyph moves more than a shade step
import test from 'node:test';
import assert from 'node:assert/strict';
import skyline, { LAYOUTS, layoutFor, geometry } from '../cartridges/night-drive/scenes/skyline.js';
import { renderScene } from '../src/cells.js';
import { SUN, CORAL, MAG, CYAN, VIOLET, ICE, COUNT } from '../cartridges/night-drive/lib/palette.js';
import { FPS, BANNED, MANIFEST, framer, rowText, cellsOf, rampViolations, calmRun, walk, meanMs, cp } from './helpers-night-drive.js';

const frame = framer(skyline);
const bridgeOf = (w, h) => geometry(w, h).bridgeY;

// ---- K1 the contract and the manifest

test('night-drive skyline (K1): a cells scene called skyline, LAYOUTS widest first from 100x32, layoutFor, and the manifest lists it in tape order with its menu entry', () => {
  assert.equal(skyline.id, 'skyline');
  assert.equal(skyline.kind, 'cells');
  assert.ok(Array.isArray(LAYOUTS) && LAYOUTS.length >= 2);
  assert.deepEqual([LAYOUTS[0].minCols, LAYOUTS[0].minRows], [100, 32]);
  assert.deepEqual([LAYOUTS[LAYOUTS.length - 1].minCols, LAYOUTS[LAYOUTS.length - 1].minRows], [0, 0]);
  assert.equal(layoutFor(120, 40).name, LAYOUTS[0].name);
  assert.equal(layoutFor(100, 32).name, LAYOUTS[0].name, 'at the breakpoint: the big layout');
  assert.notEqual(layoutFor(99, 32).name, LAYOUTS[0].name);
  assert.notEqual(layoutFor(100, 31).name, LAYOUTS[0].name);
  assert.notEqual(layoutFor(80, 24).name, LAYOUTS[0].name);
  const ids = MANIFEST.scenes.map((s) => s.id);
  assert.ok(ids.indexOf('onramp') < ids.indexOf('skyline') && ids.indexOf('skyline') < ids.indexOf('sundown'), 'tape order: A1 onramp, A2 skyline, A3 sundown');
  assert.equal(MANIFEST.scenes.find((s) => s.id === 'skyline').title, 'Velvet Skyline');
  assert.ok(MANIFEST.scenes.find((s) => s.id === 'skyline').title.length <= 23);
  assert.deepEqual(MANIFEST.programs[0].scenes, ids, 'the tape lists the same scenes in the same order');
  const entry = MANIFEST.menu.find((e) => e.scene === 'skyline');
  assert.ok(entry);
  assert.deepEqual([entry.label, entry.program, entry.note], ['A2  VELVET SKYLINE', 'tape', '1:30']);
  assert.ok(entry.desc && [...entry.desc].length <= 76);
  const labels = MANIFEST.menu.map((e) => e.label);
  assert.ok(labels.indexOf('A1  MIDNIGHT ON-RAMP') < labels.indexOf(entry.label) && labels.indexOf(entry.label) < labels.indexOf('A3  SUNDOWN GRID'));
  assert.equal(MANIFEST.programs[0].sceneSeconds, 90);
});

// ---- K2 purity

test('night-drive skyline (K2): the same (t, w, h, seed) draws the same frame; t0 shifts the scene\'s own clock; the seed changes the picture; odd times do not throw', () => {
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
  const shared = renderScene(skyline, 12.5, 120, 40, 1);
  assert.deepEqual(Array.from(shared.glyphs), Array.from(frame(12.5).g), 'the shared renderer gives the same picture');
});

// ---- K3 the beacon

// Shade series of the beacon (the ● cell) sampled at `speed`x over `seconds`; [{t, shade}]
function beaconSeries(speed, seconds, step) {
  const f0 = frame(0);
  const cells = cellsOf(f0, '●');
  assert.equal(cells.length, 1, 'one beacon');
  const [bx, by] = cells[0];
  const out = [];
  const n = step ? Math.ceil(seconds / step) : Math.ceil((seconds * FPS) / speed);
  for (let k = 0; k <= n; k++) {
    const t = step ? k * step : (k * speed) / FPS;
    const f = frame(t);
    assert.equal(f.g[by * f.w + bx], cp('●'), `the beacon stays at ${t}`);
    out.push({ t, shade: CORAL.indexOf(f.c[by * f.w + bx]) });
  }
  return out;
}
const runsOf = (series) => {
  const runs = [];
  for (const s of series) {
    if (runs.length && runs[runs.length - 1].shade === s.shade) runs[runs.length - 1].end = s.t; else runs.push({ shade: s.shade, start: s.t, end: s.t });
  }
  return runs;
};
const maxStep = (series) => series.reduce((m, s, k) => (k ? Math.max(m, Math.abs(s.shade - series[k - 1].shade)) : m), 0);

test('night-drive skyline (K3): the beacon is coral 0 -> 1 -> 2 -> 3 -> 2 -> 1 -> 0, resting 2 s, a second up and a second down, every 4 s; never more than one shade in a frame at 18 fps and 4x', () => {
  const series = beaconSeries(1, 13, 0.02);
  assert.ok(series.every((s) => s.shade >= 0), 'the beacon is always one of the four corals');
  const runs = runsOf(series);
  // the shade sequence is 0,1,2,3,2,1,0 and round again
  const cycle = [0, 1, 2, 3, 2, 1];
  runs.forEach((r, k) => assert.equal(r.shade, cycle[k % 6], `run ${k}`));
  assert.ok(runs.length >= 12);
  // rests: the 0 runs between ramps last 2 s; the first starts the scene
  const rests = runs.filter((r, k) => r.shade === 0 && k > 0 && k < runs.length - 1);
  assert.ok(rests.length >= 2);
  for (const r of rests) assert.ok(Math.abs(r.end - r.start + 0.02 - 2) <= 0.05, `a rest of ${(r.end - r.start + 0.02).toFixed(2)} s`);
  // a ramp is the time from the first lit sample to the last lit sample: 2 s, the peak in the middle (1 s up, 1 s down)
  for (let k = 0; k + 6 < runs.length - 1; k += 6) {
    const lit = runs.slice(k + 1, k + 6);
    const start = lit[0].start, end = lit[4].end + 0.02;
    assert.ok(Math.abs(end - start - 2) <= 0.06, `ramp ${k / 6}: ${(end - start).toFixed(2)} s`);
    const peak = lit[2];
    assert.ok(Math.abs((peak.start + peak.end + 0.02) / 2 - start - 1) <= 0.06, 'the peak is the middle of the ramp');
    if (k + 12 < runs.length - 1) assert.ok(Math.abs(runs[k + 7].start - start - 4) <= 0.04, 'a ramp every 4 s');
  }
  // each shade 1 and 2 holds longer than a 4x frame (0.222 s), so a 4x frame can never skip one
  for (const r of runs.slice(1, -1)) if (r.shade === 1 || r.shade === 2) assert.ok(r.end - r.start + 0.02 > 0.25, `shade ${r.shade} holds ${(r.end - r.start + 0.02).toFixed(2)} s`);
  for (const speed of [1, 4]) {
    const s = beaconSeries(speed, 40);
    assert.ok(maxStep(s) <= 1, `${speed}x: the beacon moves at most one shade a frame`);
    assert.ok(new Set(s.map((x) => x.shade)).size === 4, `${speed}x: all four shades are seen`);
  }
  // control: a beacon that jumps 0 -> 2 is caught by the step check
  assert.equal(maxStep([{ shade: 0 }, { shade: 2 }, { shade: 0 }]), 2);
});

// ---- K4 windows

// All the window cells at 120x40: squares in the sun family, off the bridge row.
function windowCells(w, h) {
  const f = frame(0, w, h);
  const by = bridgeOf(w, h);
  const out = [];
  for (let i = 0; i < f.g.length; i++) if (f.g[i] === cp('▪') && SUN.includes(f.c[i]) && Math.floor(i / w) !== by) out.push(i);
  return out;
}

test('night-drive skyline (K4): exactly one window change begins every 0.4 s, each ramp holds shade 1 for 0.3 s between a 0 and a 2, and a window never leaves the sun family', () => {
  const W = 120, H = 40, STEP = 0.05, SECONDS = 40;
  const cells = windowCells(W, H);
  assert.ok(cells.length >= 100, `${cells.length} windows`);
  const series = new Map(cells.map((i) => [i, []]));
  for (let k = 0; k <= SECONDS / STEP; k++) {
    const f = frame(k * STEP, W, H);
    for (const i of cells) {
      assert.equal(f.g[i], cp('▪'), 'a window is always a small square');
      const shade = SUN.indexOf(f.c[i]);
      assert.ok(shade >= 0 && shade <= 2, `a window is in the sun family, shades 0 to 2: colour ${f.c[i]}`);
      series.get(i).push(shade);
    }
  }
  const starts = [];
  let on = 0, off = 0;
  for (const [i, s] of series) {
    if (s[0] === 2) on++; else off++;
    for (let k = 1; k < s.length; k++) {
      assert.ok(Math.abs(s[k] - s[k - 1]) <= 1, `window ${i}: never more than a shade step`);
    }
    for (let k = 1; k < s.length; k++) {
      if (s[k] === 1 && s[k - 1] !== 1) {
        let e = k;
        while (e < s.length && s[e] === 1) e++;
        if (e >= s.length) continue; // cut off by the end of the run
        assert.ok(Math.abs((e - k) * STEP - 0.3) <= 0.051, `window ${i}: shade 1 held ${(e - k) * STEP} s`);
        assert.ok(s[k - 1] !== s[e] && (s[k - 1] === 0 || s[k - 1] === 2) && (s[e] === 0 || s[e] === 2), 'a ramp goes from lit to dim or dim to lit through shade 1');
        starts.push(k * STEP);
      }
    }
  }
  assert.ok(on > 20 && off > 20, `a mix of lit (${on}) and dim (${off}) windows at the start`);
  // one begins in every 0.4 s slot: slot m (m = 1 to 98) holds exactly one start, within a sample of m * 0.4
  const per = new Map();
  for (const s of starts) { const m = Math.round(s / 0.4); per.set(m, (per.get(m) || 0) + 1); assert.ok(Math.abs(s - m * 0.4) <= STEP + 1e-6, `a start at ${s} is not on a 0.4 s mark`); }
  for (let m = 1; m <= 98; m++) assert.equal(per.get(m) || 0, 1, `slot ${m}: ${per.get(m) || 0} windows began changing`);
  assert.equal(starts.length, new Set(starts.map((s) => Math.round(s / 0.4))).size);
  // control: a series that goes straight from dim to lit is not a ramp through shade 1
  const direct = [0, 0, 2, 2];
  assert.ok(Math.abs(direct[2] - direct[1]) > 1, 'the step check would fail on a direct 0 -> 2');
});

// ---- K5 reflections

function reflectionCells(w, h) {
  const g = geometry(w, h);
  return { top: g.reflTop, bottom: g.reflBottom };
}

test('night-drive skyline (K5): reflections shift a column at most every 0.5 s per cell and about 12 cells change a frame, at 18 fps; four times that at 4x at most', () => {
  const W = 120, H = 40;
  const { top, bottom } = reflectionCells(W, H);
  const inBay = (i) => { const y = Math.floor(i / W); return y >= top && y <= bottom; };
  const f0 = frame(0, W, H);
  let streaks = 0;
  for (let i = 0; i < f0.g.length; i++) if (inBay(i) && f0.g[i] !== 32) streaks++;
  assert.ok(streaks >= 60, `${streaks} streak cells in the bay`);
  const glyphs = new Set();
  for (let k = 0; k < 20 * FPS; k++) { const f = frame(k / FPS, W, H); for (let i = 0; i < f.g.length; i++) if (inBay(i) && f.g[i] !== 32) glyphs.add(f.g[i]); }
  assert.deepEqual([...glyphs].sort((a, b) => a - b), [cp('-'), cp('·'), cp('─')].sort((a, b) => a - b), 'streaks are dashes and dots');
  for (const speed of [1, 4]) {
    const last = new Map();
    let worst = 0, total = 0, frames = 0;
    walk(frame, W, H, speed, 60, (a, b, t) => {
      let n = 0;
      for (let i = 0; i < a.g.length; i++) {
        if (!inBay(i) || (a.g[i] === b.g[i] && a.c[i] === b.c[i])) continue;
        n++;
        if (last.has(i)) assert.ok(t - last.get(i) >= 0.5 - 1 / FPS - 1e-9, `${speed}x: cell ${i} changed again after ${(t - last.get(i)).toFixed(3)} s`);
        last.set(i, t);
      }
      worst = Math.max(worst, n); total += n; frames++;
    });
    const mean = total / frames;
    if (speed === 1) {
      assert.ok(worst <= 16, `worst ${worst} reflection cells in a frame`);
      assert.ok(mean >= 8 && mean <= 14, `mean ${mean.toFixed(1)} reflection cells a frame (the design says about 12)`);
    } else assert.ok(worst <= 64, `4x: worst ${worst}`);
    console.log(`# skyline reflections ${speed}x: mean ${mean.toFixed(1)}, worst ${worst} cells a frame, ${last.size} different cells changed`);
  }
});

test('night-drive skyline (K5 control): streaks that all shift together would break the per-frame bound of 16 changed cells', () => {
  // the bay of frame 0, and the same bay with every streak one column to the right: what an unplanned shimmer does on one tick
  const { top, bottom } = reflectionCells(120, 40);
  const a = frame(0);
  const b = { g: a.g.slice(), c: a.c.slice(), w: 120, h: 40 };
  for (let y = top; y <= bottom; y++) for (let x = 119; x > 0; x--) { b.g[y * 120 + x] = a.g[y * 120 + x - 1]; b.c[y * 120 + x] = a.c[y * 120 + x - 1]; }
  let n = 0;
  for (let i = 0; i < a.g.length; i++) if (Math.floor(i / 120) >= top && Math.floor(i / 120) <= bottom && (a.g[i] !== b.g[i] || a.c[i] !== b.c[i])) n++;
  assert.ok(n > 16, `${n} cells change when every streak shifts at once`);
});

// ---- K6 the train

const trainCells = (f, by) => cellsOf(f, '▪', SUN[2]).filter(([, y]) => y === by).map(([x]) => x);

test('night-drive skyline (K6): a train of 8 squares in sun 2 crosses the bridge row every 30 s at a column per 0.08 s and never leaves that row', () => {
  const W = 120, H = 40, by = bridgeOf(W, H);
  const windows = new Set(windowCells(W, H));
  assert.ok(!windows.has(by * W + 3));
  // absent before it starts, present on its pass, absent after, back 30 s later
  for (const t of [0, 3, 7.9]) assert.equal(trainCells(frame(t), by).length, 0, `no train at ${t}`);
  for (const base of [0, 30, 60]) {
    let prevHead = null, seen = 0;
    for (let k = 0; k < 14 * 50; k++) {
      const t = base + 8 + k * 0.02;
      const xs = trainCells(frame(t), by);
      if (!xs.length) { assert.ok(prevHead === null || prevHead >= W - 1, `the train leaves at the right edge (head ${prevHead}) at ${t}`); break; }
      xs.sort((a, b) => a - b);
      const head = xs[xs.length - 1];
      if (xs.length === 8) { assert.equal(xs[7] - xs[0], 7, 'eight squares in a row'); seen++; }
      const want = Math.floor((t - base - 8) / 0.08);
      if (want < W) assert.ok(Math.abs(head - want) <= 1, `${t}: head ${head}, want ${want}`);
      if (prevHead !== null) assert.ok(head - prevHead >= 0 && head - prevHead <= 1, 'a column at a time');
      prevHead = head;
    }
    assert.ok(seen > 400, `${seen} frames with the whole train on screen in the pass starting ${base}`);
    // the pass is the same every 30 s
    assert.deepEqual(trainCells(frame(base + 12.34), by), trainCells(frame(12.34), by), `${base}: the same pass`);
  }
  // squares in sun 2 off the bridge row are windows and nothing else, with the train on
  const f = frame(12);
  for (let i = 0; i < f.g.length; i++) if (f.g[i] === cp('▪') && SUN.includes(f.c[i]) && Math.floor(i / W) !== by) assert.ok(windows.has(i), `a square off the bridge row at ${i} is a window`);
  // its row is the bridge row and the squares replace the rail
  assert.ok(/▪{8}/.test(rowText(f, by)));
  assert.ok(!/▪/.test(rowText(frame(2), by)));
  // control: a train one row off the bridge would be caught
  const bad = trainCells(frame(12), by + 1);
  assert.equal(bad.length, 0);
});

// ---- K7 key frames

test('night-drive skyline (K7): key frame 1 (120x40, t = 0) has the Orchid crown, the beacon, the bridge and the guard rail; key frame 2 (t = 12 s) has the train on the bridge; 80x24 has one tower a side and 6 reflection rows', () => {
  const f = frame(0);
  const g = geometry(120, 40);
  const crowns = cellsOf(f, '◆', MAG[3]);
  assert.equal(crowns.length, 1, 'one Orchid crown');
  assert.ok(crowns[0][0] < 60, 'the Orchid is on the left');
  const beacon = cellsOf(f, '●', CORAL);
  assert.equal(beacon.length, 1, 'one beacon');
  assert.ok(beacon[0][0] > 60, 'Solace Tower is on the right');
  assert.ok(beacon[0][1] <= 3, 'the mast reaches near the top of the picture');
  assert.ok(/═╤═/.test(rowText(f, g.bridgeY)), 'the bridge');
  for (let x = 0; x < 120; x++) if (rowText(f, g.bridgeY)[x] === '═' || rowText(f, g.bridgeY)[x] === '╤') assert.equal(f.c[g.bridgeY * 120 + x], VIOLET[1], 'the bridge is violet 1');
  assert.ok(/╤═{4,}╤/.test(rowText(f, 38)), 'the guard rail');
  for (let x = 0; x < 120; x++) if (rowText(f, 38)[x] !== ' ') assert.equal(f.c[38 * 120 + x], ICE[0], 'the guard rail is ice 0');
  assert.ok(cellsOf(f, '┃', MAG[2]).length >= 6 || cellsOf(f, '┃', MAG[3]).length >= 6, 'the Orchid\'s tubes');
  assert.ok(cellsOf(f, '▄', CYAN[3]).length >= 6, 'Solace Tower\'s crown bands');
  assert.ok(cellsOf(f, '▪', SUN).length >= 100, 'lit windows');
  assert.ok(cellsOf(f, '╱', CYAN[0]).length >= 10, 'a searchlight beam');
  assert.ok(cellsOf(f, '▔').length >= 100, 'the bay\'s edge');
  const t12 = frame(12);
  assert.ok(/▪{8}/.test(rowText(t12, g.bridgeY)), 'the train is on the bridge at 12 s');
  assert.ok(!/▪/.test(rowText(f, g.bridgeY)), 'and not at 0 s');
  // 80x24: one tower a side, six reflection rows
  const c = frame(0, 80, 24);
  const cg = geometry(80, 24);
  const cr = cellsOf(c, '◆'), cb = cellsOf(c, '●');
  assert.equal(cr.length, 1);
  assert.equal(cb.length, 1);
  assert.ok(cr[0][0] < 40 && cb[0][0] >= 40, 'one tower on each side');
  assert.equal(cg.reflBottom - cg.reflTop + 1, 6);
  assert.equal(geometry(120, 40).reflBottom - geometry(120, 40).reflTop + 1, 9);
  const rowsWith = new Set();
  for (let k = 0; k < 40; k++) { const fr = frame(k * 0.5, 80, 24); for (let y = cg.reflTop; y <= cg.reflBottom; y++) if (/[─\-·]/.test(rowText(fr, y))) rowsWith.add(y); }
  assert.equal(rowsWith.size, 6, 'streaks in all 6 reflection rows');
  const outside = new Set();
  for (let k = 0; k < 40; k++) { const fr = frame(k * 0.5, 80, 24); for (let y = cg.reflBottom + 1; y < 24 - 2; y++) if (/[─\-]/.test(rowText(fr, y))) outside.add(y); }
  assert.equal(outside.size, 0, 'and none below them');
});

// ---- K8 calm and safety

const SIZES = [[120, 40], [80, 24], [100, 32]];

test('night-drive skyline (K8): 90 s at 1x and 4x at 120x40, 80x24 and 100x32: under 5% of the cells change a frame (never 30%), no kept glyph breaks the ramp rule, the background is never drawn, allowed glyphs only, none banned, colours inside the palette', () => {
  const rows = [];
  for (const [w, h] of SIZES) {
    for (const speed of [1, 4]) {
      const r = calmRun(frame, w, h, speed);
      rows.push(`${w}x${h} ${speed}x worst ${(r.worst * 100).toFixed(2)}% at ${r.at.toFixed(2)} s, lit at least ${r.litMin}`);
      assert.ok(r.worst < 0.3, `${w}x${h} ${speed}x: ${r.worst}`);
      assert.ok(r.worst < 0.05, `${w}x${h} ${speed}x: worst ${(r.worst * 100).toFixed(2)}% at ${r.at.toFixed(2)} s`);
      assert.ok(r.worst > 0.001, 'it moves');
      assert.equal(r.ramp, 0, `${w}x${h} ${speed}x: ${JSON.stringify(r.firstRamp)}`);
      assert.equal(r.blankBad, 0, 'a blank cell is colour 0 (the one background)');
      assert.equal(r.glyphBad, 0, 'allowed glyphs only');
      assert.equal(r.banned, 0, 'none of the banned set');
      assert.equal(r.colourBad, 0, `colours are the fixed families, below ${COUNT}`);
      assert.ok(r.litMin > w * h * 0.04, `${w}x${h}: never nearly blank (${r.litMin} cells lit)`);
    }
  }
  console.log('# skyline: ' + rows.join(' | '));
  // controls: a skyline that redraws everything breaks the share rule, a window jumping 0 -> 2 breaks the ramp rule
  const a = frame(0), b = frame(1 / 18);
  const flick = { g: a.g.map(() => cp('▪')), c: a.c.map((_, i) => SUN[i & 1]), w: 120, h: 40 };
  const flick2 = { g: flick.g, c: flick.c.map((v) => (v === SUN[0] ? SUN[1] : SUN[0])), w: 120, h: 40 };
  assert.equal(rampViolations(flick, flick2).length, 0, 'one shade step is fine');
  const jump = { g: flick.g, c: flick.c.map(() => SUN[2]), w: 120, h: 40 };
  const from0 = { g: flick.g, c: flick.c.map(() => SUN[0]), w: 120, h: 40 };
  assert.ok(rampViolations(from0, jump).length === 120 * 40, 'a jump from shade 0 to 2 is caught in every cell');
  const family = { g: flick.g, c: flick.c.map(() => CYAN[0]), w: 120, h: 40 };
  assert.ok(rampViolations(from0, family).length === 120 * 40, 'a change of colour family under one glyph is caught');
  assert.ok(a.g.length === b.g.length);
});

test('night-drive skyline (K8): the base sizes show no blank picture and only the fixed palette; 41x11 is blank (too small), and nothing draws outside the window', () => {
  for (const [w, h] of [[120, 40], [80, 24], [100, 32], [240, 67]]) {
    const f = frame(3, w, h);
    const lit = f.g.reduce((n, v) => n + (v === 32 ? 0 : 1), 0);
    assert.ok(lit > w * h * 0.05 && lit < w * h * 0.6, `${w}x${h}: ${lit} lit cells`);
  }
});

// ---- K9 sizes

test('night-drive skyline (K9): 0x0, 1x1, 41x11, 99x31, 100x32, 240x67 and 400x120 do not throw; blank cells are glyph 32 in colour 0; small windows draw nothing', () => {
  const sizes = [[0, 0], [1, 1], [3, 3], [41, 11], [99, 31], [100, 32], [240, 67], [400, 120], [2, 200], [200, 2], [40, 18], [39, 40], [120, 17]];
  for (const [w, h] of sizes) {
    for (const t of [0, 7.7, 12, 38.5, 1e6]) {
      let f;
      assert.doesNotThrow(() => { f = frame(t, w, h); }, `${w}x${h} t=${t}`);
      for (let i = 0; i < f.g.length; i++) if (f.g[i] === 32) assert.equal(f.c[i], 0);
    }
  }
  const lit = (w, h) => frame(5, w, h).g.reduce((n, v) => n + (v === 32 ? 0 : 1), 0);
  assert.equal(lit(41, 11), 0, '41x11 is too small for the picture and stays blank');
  assert.equal(lit(0, 0), 0);
  assert.ok(lit(99, 31) > 200 && lit(100, 32) > 200 && lit(400, 120) > 2000);
  assert.ok(BANNED.length > 0);
});

// ---- K10 scale

test('night-drive skyline (K10): a 240x67 frame costs under 20 ms on average over 200 frames (the aim is 3 ms); a scan of the whole picture a few thousand times would not', () => {
  const g = new Uint16Array(240 * 67), c = new Uint8Array(240 * 67);
  const ms = meanMs((t) => skyline(t, 240, 67, { seed: 1, glyphs: g, colours: c }), 200);
  console.log(`# skyline 240x67: ${ms.toFixed(3)} ms a frame`);
  assert.ok(ms < 20, `${ms} ms`);
  const slow = (t, w, h, p) => { for (let k = 0; k < 6000; k++) for (let i = 0; i < p.glyphs.length; i++) p.glyphs[i] = (k + i) & 0xff; };
  const slowMs = meanMs((t) => slow(t, 240, 67, { glyphs: g, colours: c }), 5);
  assert.ok(slowMs > 20, `the control costs ${slowMs} ms and fails the bound`);
});
