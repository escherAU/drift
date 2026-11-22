// DRIFT-13 phase 2: the flash governor (src/governor.js) as WIRED into the app (src/app.js govern(): Classic high contrast only, after the help panel, on the app's real time `wall`).
// Everything here runs the REAL app (createApp itself, its own loop on a clock from tests/helpers-clock.js, real key presses, the bytes it writes read back through the independent terminal
// reader, the screens through the flash meter) and judges the five 1x rules (L1, L2, L3, R, C: X1_RULE_IDS) at their limits; nothing is loosened.
//   1. Desmond Hale's cases (README, "Not covered" (4)) and the two 25.00 % edges of DRIFT-12, whole 170 s cycle: each FAILS on the tree before the governor (BEFORE13_EDITS: a temporary
//      copy of src/ with the governor's one line taken out of app.js) with exactly the reading he found, and passes with it. The controls print their numbers first.
//   2. what the governor is, on the wired app: never made for calm, chaos, experimental, the size card or the Driftman 9000; one per run in Classic high contrast; a held cell is never a
//      third picture; `i` still gives two tones and its first paint is whole; the help panel, pause, the size card, resizes and mode changes leave no stale cell; a stalled terminal cannot
//      push it past a rule; a paint where nothing was held is byte for byte the paint of the tree before.
// The spy tree (tests/helpers-governor-app.js) is a copy of src/ that only REPORTS each governed paint; it makes the same bytes (asserted below).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runLife, nums, makeTree, rmTree, BEFORE13_EDITS, GOVERN_LINE } from './helpers-life-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { judgeX1 } from './helpers-clock-arms.js';
import { runSpied, withSpyTree, cycle, DESMOND, pctOf, SPY_EDITS } from './helpers-governor-app.js';
import { startCard, colourPairs, twoToneOf } from './helpers-size-card.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';
import { INSTALL_DIR } from '../src/cartridge/loader.js';

const line = (rep) => { const n = nums(rep); return `L1 ${n.l1.toFixed(2)} L2 ${n.l2.toFixed(2)} L3 ${n.l3.toFixed(2)} R ${n.r.toFixed(2)} C ${n.c.toFixed(2)}`; };
const bad = (rep) => failedRules(rep, { only: X1_RULE_IDS });

let BEFORE = null;
test.before(() => { BEFORE = makeTree('new', BEFORE13_EDITS); });
test.after(() => { if (BEFORE) rmTree(BEFORE); });

// ---- 1. Desmond's cases
for (const d of DESMOND) {
  test(`DRIFT-13 Desmond: ${d.id}: ${d.fails ? 'fails' : 'passes at the limit'} before the governor (${d.rule} ${d.before} %), passes with it`, async () => {
    const before = await cycle(d, { root: BEFORE });
    assert.equal(before.frames, Math.round(170 * d.fps), 'the whole cycle was metered, every frame');
    assert.equal(before.speedMax, d.speed, `the key presses reached ${d.speed}x`);
    assert.equal(pctOf(before.rep, d.rule), d.before, `before the governor ${d.rule} reads ${d.before} % (${line(before.rep)})`);
    if (d.fails) assert.ok(bad(before.rep).includes(d.rule), `before the governor ${d.rule} fails (${line(before.rep)})`);
    else assert.deepEqual(bad(before.rep), [], `before the governor the five rules pass at the limit (${line(before.rep)})`);
    console.log(`DESMOND before the governor, ${d.id}: ${line(before.rep)}${bad(before.rep).length ? ' FAILS ' + bad(before.rep).join(' ') : ' (passes at the limit)'}`);
    const after = await cycle(d);
    assert.equal(after.frames, Math.round(170 * d.fps), 'the whole cycle was metered, every frame');
    assert.equal(after.speedMax, d.speed, `the key presses reached ${d.speed}x`);
    judgeX1(after.rep, `with the governor, ${d.id}`);
    assert.ok(Number(pctOf(after.rep, d.rule)) < Number(d.before), `${d.rule} is lower than before the governor (${pctOf(after.rep, d.rule)} against ${d.before})`);
    console.log(`DESMOND with the governor, ${d.id}: ${line(after.rep)}`);
  });
}

test('DRIFT-13 control: the before-tree edit changes only the governor line of app.js, and a mutation that matches nothing throws', () => {
  const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.equal(src.split(GOVERN_LINE).length, 2, 'the governor line occurs once in src/app.js');
  const edited = BEFORE13_EDITS['src/app.js'](src);
  assert.equal(edited, src.replace(GOVERN_LINE, 'const painted = f;'));
  assert.throws(() => BEFORE13_EDITS['src/app.js']('nothing here'), /no match/);
  const noGov = fs.readFileSync(path.join(BEFORE, 'src', 'app.js'), 'utf8');
  assert.ok(noGov.includes('const painted = f;') && !noGov.includes(GOVERN_LINE));
});

// ---- 2a. where the governor is made
test('DRIFT-13 wired: calm, chaos and experimental never make a governor (and Classic high contrast makes exactly one for the whole run)', async () => {
  for (const startMode of ['calm', 'chaos', 'experimental']) {
    const r = await runSpied({ cols: 80, rows: 24, fps: 18, seconds: 40, startMode, feedAll: true, stopAtDissolve: false, sceneSeconds: 8, meter: false });
    assert.equal(r.built, 0, `${startMode}: no governor was made`);
    assert.equal(r.paints, 0, `${startMode}: no paint was governed`);
    assert.ok(r.frames >= 700, `${startMode}: the run drew frames (${r.frames})`);
  }
  const hc = await runSpied({ cols: 80, rows: 24, fps: 18, seconds: 40, startMode: 'contrast', feedAll: true, stopAtDissolve: false, sceneSeconds: 8, meter: false });
  assert.equal(hc.built, 1, 'Classic high contrast: one governor');
  assert.ok(hc.paints > 600, `and it governs every paint (${hc.paints})`);
});

test('DRIFT-13 wired: the size card never makes a governor; leaving the card makes it, and a resize reuses it (built once)', async () => {
  await withSpyTree(async (root, g13) => {
    const h = await startCard({ cols: 39, rows: 10, startMode: 'contrast', clock: 'grid', root, sceneSeconds: 1000 });
    g13.app = h.app;
    try {
      h.advance(3);
      assert.equal(g13.built, 0, 'the card: nothing governed');
      assert.equal(g13.paints, 0);
      h.resize(60, 20);
      h.advance(2);
      assert.equal(g13.built, 1, 'the art: one governor');
      const paints = g13.paints;
      assert.ok(paints > 20, `and it governs the art's paints (${paints})`);
      h.resize(70, 22); h.advance(1); h.resize(39, 10); h.advance(1); h.resize(80, 24); h.advance(1);
      assert.equal(g13.built, 1, 'resizes and the card in between reuse the one governor');
      assert.ok(g13.paints > paints, 'and it keeps governing');
    } finally { h.close(); }
  });
});

test('DRIFT-13 wired: the Driftman 9000 (the console shell) never makes a governor', async () => {
  await withSpyTree(async (root, g13) => {
    const { createApp } = await import(pathToFileURL(path.join(root, 'src', 'app.js')).href);
    const stdout = fakeStdout({ columns: 120, rows: 40 }), stdin = fakeStdin(), stderr = fakeStderr(), proc = fakeProc();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-gov-9000-'));
    const app = createApp({
      stdin, stdout, stderr, proc, env: { COLORTERM: 'truecolor' }, configPath: path.join(dir, 'config.json'), dirs: [{ dir: INSTALL_DIR, trusted: true }],
      startScreen: { screen: 'cartridge', cartridge: 'driftman-9000', skipBoot: false }, startMode: 'contrast', autoLoop: false, seed: 1, sceneSeconds: 1000, fps: 18,
    });
    g13.app = app;
    try {
      app.start();
      let screen = null;
      for (let k = 0; k < 1500; k++) {
        app.tick(1 / 18);
        stdout.writes.length = 0;
        if (k % 20 === 0) await new Promise((r) => setTimeout(r, 5));
        const st = app.getState().shell;
        if (st) screen = st.screen;
      }
      assert.equal(screen, 'running', 'the console is running its program');
      assert.equal(app.getState().mode, 'contrast', 'the app is in the mode it began in (the shell owns the screen)');
      assert.equal(app.getState().shell !== null, true);
      assert.equal(g13.built, 0, 'no governor was made');
      assert.equal(g13.paints, 0, 'nothing was governed');
    } finally { try { proc.emit('exit'); } catch { /* ignore */ } fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// ---- 2b. what it paints
test('DRIFT-13 wired: held cells are never a third picture, the painted screen is the composed frame or the screen before it, and what the screen shows equals what was painted', async () => {
  const o = { cols: 42, rows: 12, fps: 26, seed: 6, clock: 'grid', speed: 1, mode: '256' };
  const composed = new Set(), screenGlyphs = new Set();
  let prevG = null, prevS = null, heldPaints = 0, heldCells = 0, paints = 0;
  const r = await runSpied({ ...o, clockSeed: 6, keys: [], sceneSeconds: 30, seconds: 170, feedAll: true, stopAtDissolve: false, grab: (k, screen) => { for (let i = 0; i < screen.glyphs.length; i++) screenGlyphs.add(screen.glyphs[i]); } }, {
    onPaint: (f, g, gov) => {
      paints++;
      const n = f.glyphs.length;
      let dev = 0;
      for (let i = 0; i < n; i++) {
        composed.add(f.glyphs[i]);
        const same = g.glyphs[i] === f.glyphs[i] && g.shades[i] === f.shades[i];
        if (same) continue;
        dev++;
        assert.ok(prevG && g.glyphs[i] === prevG[i] && g.shades[i] === prevS[i], `paint ${paints} cell ${i}: a held cell keeps the pair it showed (${g.glyphs[i]}), never a new one`);
      }
      assert.equal(gov.stats.last.held, dev, `paint ${paints}: the governor's own count of held cells is the cells that differ from the composed frame`);
      if (dev) { heldPaints++; heldCells += dev; }
      prevG = g.glyphs.slice(); prevS = g.shades.slice();
    },
  });
  assert.equal(r.frames, 170 * 26);
  assert.ok(heldPaints > 0 && heldCells > 0, `the governor engaged on this case (${heldPaints} paints held ${heldCells} cells of ${paints})`);
  for (const gl of screenGlyphs) assert.ok(composed.has(gl), `the screen showed glyph ${gl}, which no composed frame ever had`);
  judgeX1(r.rep, 'the spy tree, 42x12 grid 1x fps 26 seed 6');
  console.log(`GOVERNED 42x12 --fps 26 seed 6: ${heldPaints} of ${paints} paints held a cell, ${heldCells} cell-holds in all`);
});

test('DRIFT-13 wired: the spy tree writes the same bytes as the shipped tree (the spy only observes)', async () => {
  const o = { cols: 42, rows: 12, fps: 26, seed: 6, clock: 'grid', speed: 1, mode: '256' };
  const a = [], b = [];
  await cycle(o, { seconds: 60, writes: a, meter: false });
  await runSpied({ ...o, clockSeed: 6, keys: [], sceneSeconds: 30, seconds: 60, feedAll: true, stopAtDissolve: false, writes: b, meter: false });
  assert.ok(a.length > 100);
  assert.deepEqual(a, b);
});

test('DRIFT-13 wired: a paint where nothing was held is byte for byte the paint of the tree before the governor: 30 s of Life at 1x, 80x24 (seeds 1 to 3), and the Life to tunnel dissolve up to its first held paint', async () => {
  const seen = [];
  for (const seed of [1, 2, 3]) {
    const log = [], plain = [];
    await runSpied({ cols: 80, rows: 24, fps: 18, seed, clock: 'grid', clockSeed: seed, mode: '256', keys: [], sceneSeconds: 30, seconds: 40, writes: log, meter: false }, {
      onPaint: (f, g, gov) => log.push({ held: gov.stats.last.held }),
    });
    await runLife({ cols: 80, rows: 24, fps: 18, seed, clock: 'grid', clockSeed: seed, mode: '256', keys: [], sceneSeconds: 30, seconds: 40, root: BEFORE, writes: plain, meter: false });
    const marks = log.filter((x) => typeof x !== 'string');
    const held = marks.reduce((s, x) => s + x.held, 0), heldPaints = marks.filter((x) => x.held > 0).length;
    const strs = log.filter((x) => typeof x === 'string');
    const first = log.findIndex((x) => typeof x !== 'string' && x.held > 0);
    const k = first < 0 ? strs.length : log.slice(0, first).filter((x) => typeof x === 'string').length;
    assert.ok(k >= 5, `seed ${seed}: ${k} writes come before the first held paint`);
    assert.deepEqual(strs.slice(0, k), plain.slice(0, k), `seed ${seed}: the first ${k} writes are the writes of the tree before the governor`);
    if (held === 0) assert.deepEqual(strs, plain, `seed ${seed}: all ${plain.length} writes are the writes of the tree before the governor`);
    seen.push(`seed ${seed}: ${marks.length} paints, ${heldPaints} held a cell (${held} cell-holds), ${k} of ${strs.length} writes identical before the first held paint`);
  }
  for (const l of seen) console.log(`IDENTICAL 80x24 1x Life ${l}`);
  assert.ok(seen.some((l) => / 0 held a cell/.test(l)), 'at least one seed holds nothing in all of the 30 s of Life: its whole byte stream is the old one');
  // the whole of Life and then its dissolve into the tunnel (seed 1: Life holds nothing, the dissolve does): the bytes are identical until the first paint that held a cell
  const log = [], plain = [];
  const o = { cols: 80, rows: 24, fps: 18, seed: 1, clock: 'grid', clockSeed: 1, mode: '256', keys: [], sceneSeconds: 30, seconds: 45, feedAll: true, stopAtDissolve: false, startScene: 0, scene: 'life', meter: false };
  await runSpied({ ...o, writes: log }, { onPaint: (f, g, gov) => log.push({ held: gov.stats.last.held }) });
  await runLife({ ...o, root: BEFORE, writes: plain });
  const first = log.findIndex((x) => typeof x !== 'string' && x.held > 0);
  assert.ok(first > 0, 'the dissolve holds a cell');
  const k = log.slice(0, first).filter((x) => typeof x === 'string').length;
  assert.ok(k > 200, `${k} writes come before the first held paint (the whole of Life)`);
  assert.deepEqual(log.filter((x) => typeof x === 'string').slice(0, k), plain.slice(0, k));
  assert.notEqual(log.filter((x) => typeof x === 'string')[k], plain[k], 'and the first held paint differs from the ungoverned one (so the comparison could tell)');
});

test('DRIFT-13 wired: `i` still gives two tones, in both polarities, and its first paint is whole (the governor is reset, the palette is not its business)', async () => {
  for (const cmode of ['256', 'truecolor']) {
    await withSpyTree(async (root, g13) => {
      const h = await startCard({ cols: 80, rows: 24, startMode: 'contrast', startScene: 1, cmode, clock: 'grid', root, sceneSeconds: 1000 });
      g13.app = h.app;
      let light = false, wholeAt = 0, ungoverned = 0, checked = 0;
      g13.spy = (f, g, gov) => {
        const nowLight = h.app.getState().light;
        if (nowLight !== light) {
          light = nowLight;
          const u = gov.stats.ungoverned;
          assert.equal(u, ungoverned + 1, 'the governor counted the flip paint as an ungoverned one');
          for (let i = 0; i < f.glyphs.length; i++) assert.ok(g.glyphs[i] === f.glyphs[i] && g.shades[i] === f.shades[i], `the first paint after the flip is the composed frame whole (cell ${i})`);
          wholeAt++;
        }
        ungoverned = gov.stats.ungoverned;
        checked++;
      };
      try {
        h.advance(4);
        assert.deepEqual([...colourPairs(h.screen)], [`${twoToneOf(cmode, false).fg}/${twoToneOf(cmode, false).bg}`], `${cmode}: one pair of colours on the screen`);
        h.key('i');
        h.advance(4);
        assert.equal(h.app.getState().light, true, `${cmode}: inverted`);
        assert.equal(wholeAt, 1, `${cmode}: one flip, one whole paint`);
        assert.deepEqual([...colourPairs(h.screen)], [`${twoToneOf(cmode, true).fg}/${twoToneOf(cmode, true).bg}`], `${cmode}: inverted: the other single pair`);
        h.advance(4); h.key('i'); h.advance(2);
        assert.equal(wholeAt, 2, `${cmode}: and back`);
        assert.ok(checked > 100);
      } finally { h.close(); }
    });
  }
});

// ---- 2c. pause, help, the size card, resizes, mode changes: no stale painted state
// the screen the terminal shows must equal the composed frame of the last paint (every cell but the bottom-right one, which the renderer never draws)
function screenIsComposed(h, composed, label) {
  const n = composed.length;
  for (let i = 0; i < n - 1; i++) {
    if (h.screen.glyphs[i] !== composed[i]) assert.fail(`${label}: cell ${i % h.size.cols},${Math.floor(i / h.size.cols)} shows ${h.screen.glyphs[i]}, the composed frame has ${composed[i]}`);
  }
}

test('DRIFT-13 wired: the help panel is governed like any other change (no exemption): the loop keeps painting until the panel is whole, with the clock stopped, and closing it leaves no stale cell', async () => {
  const report = [];
  const CASES = [[80, 24, 1, 18], [40, 10, 1, 18], [120, 40, 1, 18], [61, 21, 1, 12], [80, 24, 0, 18], [40, 10, 0, 18]];
  for (const [cols, rows, scene, fps, paused] of [...CASES.map((c) => [...c, false]), ...CASES.slice(0, 2).map((c) => [...c, true])]) {
    await withSpyTree(async (root, g13) => {
      const n = cols * rows;
      let composed = new Uint16Array(n), devs = [];
      g13.spy = (f, g, gov) => { composed = f.glyphs.slice(); let d = 0; for (let i = 0; i < n; i++) if (g.glyphs[i] !== f.glyphs[i] || g.shades[i] !== f.shades[i]) d++; devs.push(d); assert.equal(gov.stats.last.held, d); };
      const h = await startCard({ cols, rows, startMode: 'contrast', startScene: scene, cmode: '256', fps, clock: 'grid', root, sceneSeconds: 1000 });
      g13.app = h.app;
      try {
        h.advance(5);
        if (paused) { h.key('p'); h.advance(2); } // the scene clock stopped by pause first: the picture can settle exactly, so closing the panel can be checked cell for cell
        const t0 = h.app.getState().t;
        devs = [];
        h.key('h');
        assert.equal(h.app.getState().help, true);
        h.advance(3);
        assert.equal(h.app.getState().t, t0, 'the scene clock stood still while help was open');
        const whole = devs.findIndex((d) => d === 0);
        assert.ok(whole >= 0, `${cols}x${rows}: the panel is whole at some paint (deviations ${devs.slice(0, 14)})`);
        assert.ok((whole + 1) / fps <= 2, `${cols}x${rows}: whole after ${whole + 1} paints = ${((whole + 1) / fps).toFixed(2)} s, inside 2 s (twice the per-cell wait W = 1 s)`);
        assert.ok(devs.slice(whole).every((d) => d === 0), 'and it stays whole');
        screenIsComposed(h, composed, `${cols}x${rows} help open`);
        const painted = devs.length;
        h.advance(1);
        assert.equal(devs.length, painted, 'help open and settled: nothing more is painted');
        report.push(`${cols}x${rows} ${scene === 0 ? 'life' : 'tunnel'}${paused ? ' (paused first)' : ''} --fps ${fps}: help whole after ${whole + 1} paints (${((whole + 1) / fps).toFixed(2)} s), first paint holds ${devs[0]} of ${n} cells`);
        devs = [];
        h.key('h');
        h.advance(3);
        assert.equal(h.app.getState().help, false);
        // with the clock running again the picture moves on (and the governor lags it a little, as in any scene); stopped by pause, it must settle on the composed frame exactly
        if (paused) { assert.equal(devs[devs.length - 1], 0); screenIsComposed(h, composed, `${cols}x${rows} help closed`); }
      } finally { h.close(); }
    });
  }
  for (const l of report) console.log(`HELP ${l}`);
});

test('DRIFT-13 wired: pause leaves the picture as it was (nothing held is left waiting), and resuming carries on', async () => {
  await withSpyTree(async (root, g13) => {
    const n = 80 * 24;
    let composed = new Uint16Array(n), held = 0, paints = 0;
    g13.spy = (f, g, gov) => { composed = f.glyphs.slice(); held = gov.stats.last.held; paints++; };
    const h = await startCard({ cols: 80, rows: 24, startMode: 'contrast', startScene: 1, cmode: '256', clock: 'grid', root, sceneSeconds: 1000 });
    g13.app = h.app;
    try {
      h.advance(6.3); // mid-scene, wherever the picture is
      h.key('p');
      h.advance(2); // anything the governor still held is painted while the clock is stopped
      assert.equal(h.app.getState().paused, true);
      assert.equal(held, 0, 'nothing is held once the picture has settled');
      const frozen = h.snap();
      screenIsComposed(h, composed, 'paused');
      const before = paints;
      h.advance(2);
      assert.equal(paints, before, 'then nothing is painted at all while paused and settled');
      assert.equal(h.text(), frozen.text);
      h.key('p');
      h.advance(2);
      assert.notEqual(h.text(), frozen.text, 'the picture moves again');
    } finally { h.close(); }
  });
});

test('DRIFT-13 wired: a resize and the size card leave no stale painted state: the next paint is the composed frame whole', async () => {
  await withSpyTree(async (root, g13) => {
    let composed = null, last = null;
    g13.spy = (f, g, gov) => { composed = f.glyphs.slice(); last = { held: gov.stats.last.held, ungov: gov.stats.ungoverned, n: f.glyphs.length }; };
    const h = await startCard({ cols: 80, rows: 24, startMode: 'contrast', startScene: 1, cmode: '256', clock: 'grid', root, sceneSeconds: 1000 });
    g13.app = h.app;
    try {
      h.advance(7.1);
      let ungov = last.ungov;
      for (const [cols, rows] of [[90, 30], [61, 21], [120, 40], [41, 11]]) {
        h.resize(cols, rows);
        assert.equal(last.n, cols * rows, `${cols}x${rows}: the governor follows the size`);
        assert.equal(last.held, 0, `${cols}x${rows}: nothing is held on the first paint after a resize`);
        assert.equal(last.ungov, ungov + 1, `${cols}x${rows}: and that paint is a reset one`);
        ungov = last.ungov;
        screenIsComposed(h, composed, `${cols}x${rows} right after the resize`);
        h.advance(3.3);
      }
      // the card in between: its text is the whole screen, and back on the art the first paint is whole again
      h.resize(39, 9);
      h.advance(2);
      const g = last; // the card paints nothing through the governor
      h.resize(80, 24);
      assert.equal(last.held, 0, 'back from the size card: nothing held');
      assert.equal(last.ungov, g.ungov + 1, 'and the paint is a reset one');
      screenIsComposed(h, composed, 'back from the size card');
    } finally { h.close(); }
  });
});

test('DRIFT-13 wired: a mode change away from high contrast and back, and the console and back, start with a whole paint', async () => {
  await withSpyTree(async (root, g13) => {
    let last = null;
    const recs = [];
    g13.spy = (f, g, gov) => { let d = 0; for (let i = 0; i < f.glyphs.length; i++) if (g.glyphs[i] !== f.glyphs[i]) d++; last = { held: gov.stats.last.held, ungov: gov.stats.ungoverned }; recs.push({ dev: d, ungov: gov.stats.ungoverned }); };
    const h = await startCard({ cols: 80, rows: 24, startMode: 'contrast', startScene: 1, cmode: '256', clock: 'grid', root, sceneSeconds: 1000, dirs: [{ dir: INSTALL_DIR, trusted: true }] });
    g13.app = h.app;
    try {
      h.advance(7.3);
      const u0 = last.ungov;
      for (let i = 0; i < 4; i++) { h.key('m'); h.advance(1.7); } // experimental, calm, chaos, back to contrast
      assert.equal(h.app.getState().mode, 'contrast');
      assert.ok(last.ungov >= u0 + 1, 'the way back to high contrast reset the governor');
      h.advance(4);
      // the library and back: the console owns the screen, Classic comes back whole
      h.key('l');
      h.advance(1);
      assert.notEqual(h.app.getState().shell, null, 'the library is open');
      const before = last.ungov, mark = recs.length;
      for (let k = 0; k < 60 && h.app.getState().shell !== null; k++) { h.key('\x1b'); h.advance(0.2); }
      assert.equal(h.app.getState().shell, null, 'Escape handed the screen back to Classic');
      const back = recs.slice(mark);
      assert.ok(back.length > 0 && last.ungov > before, 'back from the console the governor was reset');
      const firstReset = back.findIndex((r) => r.ungov > before);
      assert.equal(firstReset, 0, 'the first paint after the console is the reset one');
      assert.equal(back[0].dev, 0, 'and it is the composed frame whole');
    } finally { h.close(); }
  });
});

// ---- 2d. a stalled terminal
test('DRIFT-13 wired: a terminal that stops reading (writableNeedDrain: frames dropped, runs of 6 to 40 frames) cannot push the app over a rule', async () => {
  const stall = (k, { stdout }) => {
    const block = Math.floor(k / 6);
    const h = Math.imul(block + 1, 0x9e3779b1) >>> 0;
    stdout.writableNeedDrain = h % 3 === 0 || (block > 30 && block < 38); // a third of the blocks of 6 frames, and one long stall of about 1.5 s
  };
  const cases = [
    { cols: 42, rows: 12, fps: 26, seed: 6, clock: 'grid', speed: 1, mode: '256' },
    { cols: 80, rows: 24, fps: 18, seed: 2, clock: 'q156', speed: 1, mode: '256' },
    { cols: 40, rows: 10, fps: 30, seed: 7, clock: 'jitter', speed: 4, mode: 'truecolor' },
    { cols: 61, rows: 21, fps: 9, seed: 5, clock: 'q156', speed: 2, mode: '256' },
  ];
  for (const o of cases) {
    const r = await cycle(o, { beforeFrame: stall });
    assert.equal(r.frames, Math.round(170 * o.fps));
    judgeX1(r.rep, `stalled terminal, ${o.cols}x${o.rows} ${o.clock} ${o.speed}x --fps ${o.fps} seed ${o.seed}`);
  }
  // control: the same stall on the tree before the governor fails (L3: after a stall the frame that follows moves a third of the screen), so the stall is a real test of the rule
  const r = await cycle(cases[0], { beforeFrame: stall, root: BEFORE });
  assert.ok(bad(r.rep).includes('l3'), `before the governor the stalled run fails L3 (${line(r.rep)})`);
  console.log(`CONTROL stalled terminal before the governor, 42x12 grid fps 26 seed 6: ${line(r.rep)} FAILS ${bad(r.rep).join(' ')}`);
});

test('DRIFT-13 wired: the spy edits match exactly once (a spy that matches nothing would pass every test above on nothing)', () => {
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8'), gov = fs.readFileSync(new URL('../src/governor.js', import.meta.url), 'utf8');
  assert.notEqual(SPY_EDITS['src/app.js'](app), app);
  assert.notEqual(SPY_EDITS['src/governor.js'](gov), gov);
  assert.throws(() => SPY_EDITS['src/app.js']('nothing'), /exactly once/);
});
