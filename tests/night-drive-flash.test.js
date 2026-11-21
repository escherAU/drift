// DRIFT-5 slice 2, piece 4: Night Drive's photosensitivity spec, measured on rendered frames (Ingrid's rules).
// Every list is read from the manifest or the module exports, so slice 3's scenes join automatically.
//   - (a) Overdrive, every frame of the full 90 s through the cell composer, at 1x and 4x, at the shipped, breakpoint and just-above-console sizes:
//         STRICTLY under 30% of the cells changing (no spaced-flash allowance, no first-frame exemption); a control without the ring guard exceeds 30%
//   - (b) the dissolves: every consecutive pair of the tape's manifest order (the wrap, last -> first, included) at 120x40, 80x24 and 41x11, at 1x and 4x,
//         through a two-scene Scheduler with the tape's real hold and a 2 s fade: the worst frame of the whole run is STRICTLY under 30%
//   - (c) ramps: in every scene, no cell that keeps its (non-blank) glyph moves more than one shade step (28 L*) in a frame; a control proves it bites
//   - (d) bright solid coverage: no frame has more than 25% of the screen as bright solid blocks (█ or ▓ at L* 60 or more); the background is the one
//         #0D0820 (blank cells are glyph 32 in colour 0, every palette entry carries the one background, the shell frames keep one); a control that fills 40% fails
//   - (e) the shell steps for the cartridge (insert, boot, menu opening, running, eject) at 89x40, 79x25, 41x11, 120x40, 80x24: 30% or less outside the
//         frame that carries the key press, never over 40%
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import overdrive, { createOverdrive, LAYOUTS } from '../cartridges/night-drive/scenes/overdrive.js';
import { discoverCartridges, loadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { createCellComposer } from '../src/cells.js';
import { Scheduler } from '../src/compose.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { parseHex } from '../src/color.js';
import { FLASH_FRACTION, changedFraction, lstarTable, brightnessJumps, failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { mkShell, DT } from './helpers-shell.js';
import { shownMeter } from './helpers-flash-modes.js';
import { clockedShell, tickStats, FPS_APP } from './helpers-clock-app.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';
import { createRun } from './helpers-clock.js';

const FPS = 18;
const pct = (x) => (x * 100).toFixed(2) + '%';
// DRIFT-9 item 4: the times (seconds of wall time) at which the app's loop paints on a clock (tests/helpers-clock.js), from 0 to `wallSeconds`; a replay that runs a scene at speed S shows
// it at S times these. The old replays step k / FPS exactly (the grid); the clock arms below step these.
function paintTimes(clk, wallSeconds) {
  const run = createRun({ clock: clk, fps: FPS });
  return run.timeline(Math.ceil(wallSeconds * FPS * 1.5) + 20).filter((ms) => ms <= wallSeconds * 1000 + 1e-6).map((ms) => ms / 1000);
}
const dedupe = (sizes) => { const seen = new Set(); return sizes.filter(([w, h]) => { const k = `${w}x${h}`; if (seen.has(k)) return false; seen.add(k); return true; }); };

// ---- the cartridge: read through the real loader, like the other night-drive tests
const dirs = [{ dir: INSTALL_DIR, trusted: true }];
const found = discoverCartridges({ dirs });
const cart = found.cartridges.find((c) => c.id === 'night-drive');
assert.ok(cart, 'night-drive is on the shelf');
const manifest = cart.manifest;
const loaded = await loadScenes(cart);
assert.deepEqual(loaded.errors, []);
const SCENES = loaded.scenes; // manifest order, each { id, kind, scene }
const SKIN = JSON.parse(fs.readFileSync(path.join(INSTALL_DIR, 'night-drive', 'skin.json'), 'utf8'));
const PALETTE = makeSkinPalette(cart.skin, 'truecolor', 'night-drive');
const LTAB = lstarTable(PALETTE);
const byId = (id) => SCENES.find((s) => s.id === id);
const TAPE = manifest.programs.find((p) => p.id === manifest.start) || manifest.programs[0];
const ORDER = TAPE.scenes; // the tape's order
const HOLD = TAPE.sceneSeconds; // 90
const holdOf = (id) => (TAPE.seconds && TAPE.seconds[id]) ?? HOLD; // a scene with its own seconds (the 75 s call) is held for that long
const FADE = 2;
const nextOf = (i) => (i + 1) % ORDER.length;
const B_SIZES = [[120, 40], [80, 24], [41, 11]], B_SPEEDS = [1, 4]; // what (b) runs every pair at
const PAIRS = ORDER.map((a, k) => [a, ORDER[nextOf(k)]]); // every consecutive pair of the tape, the wrap included: what (b) runs

// ---- (a) Overdrive's share of changed cells, every frame

// Runs `seconds` of the scene through the composer, the clock advancing `speed` frames' worth each frame, and returns the worst
// frame-to-frame share and the time it came at. Frame 0 is compared with nothing; every frame after it counts.
function shareRun(scene, w, h, speed, seconds, clk = null) {
  const cc = createCellComposer({ scenes: [scene], cols: w, rows: h, seed: 1 });
  let pg = null, pc = null, worst = 0, where = 0, n = 0;
  const times = clk ? paintTimes(clk, seconds / speed) : null;
  const total = times ? times.length - 1 : Math.ceil((seconds * FPS) / speed);
  for (let k = 0; k <= total; k++) {
    const t = times ? times[k] * speed : (k * speed) / FPS;
    tickStats.frames++;
    const f = cc.frame({ a: 0, b: 0, p: 0 }, t);
    if (pg) {
      const x = changedFraction(f.glyphs, pg, f.shades, pc);
      if (x > worst) { worst = x; where = t; }
      n++;
    } else { pg = new Uint16Array(f.glyphs.length); pc = new Uint8Array(f.glyphs.length); }
    pg.set(f.glyphs); pc.set(f.shades);
  }
  return { worst, where, n };
}

const A_SIZES = dedupe([[120, 40], [80, 24], [240, 67], ...LAYOUTS.filter((l) => l.minCols > 0).map((l) => [l.minCols, l.minRows]), [89, 40], [79, 25], [41, 11]]);

test('flash (a) overdrive: all 90 s through the composer at 1x and 4x, every frame changes strictly under 30% of the cells at every size; the unguarded control goes over', () => {
  const bad = [];
  const rows = [];
  for (const [w, h] of A_SIZES) {
    for (const speed of [1, 4]) {
      const r = shareRun(overdrive, w, h, speed, 90);
      rows.push(`${w}x${h} ${speed}x worst ${pct(r.worst)} at ${r.where.toFixed(2)} s (${r.n} steps)`);
      if (!(r.worst < FLASH_FRACTION)) bad.push(rows[rows.length - 1]);
    }
  }
  const off = shareRun(createOverdrive({ ringLimit: false }), 120, 40, 4, 90);
  rows.push(`CONTROL ringLimit:false 120x40 4x worst ${pct(off.worst)} at ${off.where.toFixed(2)} s`);
  console.log('TABLE flash (a)\n  ' + rows.join('\n  '));
  assert.deepEqual(bad, [], 'frames at or over 30%');
  assert.ok(off.worst > FLASH_FRACTION, `the control (no ring guard) changed only ${pct(off.worst)} at ${off.where.toFixed(2)} s at 120x40 4x: the check would not notice a missing guard`);
});

// ---- (b) the dissolves

const pairCache = new Map();
// A -> B through a two-scene composer under a Scheduler with the tape's real holds (a scene's own `seconds` if the program gives it one), to the end of the dissolve plus 2 s.
// The worst frame is taken over the WHOLE run (the sims' real phases, the dissolve window and the tail).
function pairRun(idA, idB, w, h, speed, clk = null, scenes = null) {
  const key = `${idA}>${idB} ${w}x${h} ${speed}x${clk ? ` ${clk.mode}` : ''}`;
  if (pairCache.has(key) && !scenes) return pairCache.get(key);
  const cc = createCellComposer({ scenes: scenes || [byId(idA).scene, byId(idB).scene], cols: w, rows: h, seed: 1 });
  const holdA = holdOf(idA), holdB = holdOf(idB);
  const sched = new Scheduler({ count: 2, durationSec: holdA, fadeSec: FADE, start: 0, durations: [holdA, holdB] });
  const times = clk ? paintTimes(clk, (holdA + FADE + 2) / speed) : null;
  const total = times ? times.length - 1 : Math.ceil(((holdA + FADE + 2) * FPS) / speed);
  let pg = null, pc = null, worst = 0, where = 0;
  for (let k = 0; k <= total; k++) {
    sched.advance(times && k > 0 ? speed * (times[k] - times[k - 1]) : speed / FPS);
    const t = times ? times[k] * speed : (k * speed) / FPS;
    tickStats.frames++;
    const f = cc.frame(sched.state(), t);
    if (pg) {
      const x = changedFraction(f.glyphs, pg, f.shades, pc);
      if (x > worst) { worst = x; where = t; }
    } else { pg = new Uint16Array(f.glyphs.length); pc = new Uint8Array(f.glyphs.length); }
    pg.set(f.glyphs); pc.set(f.shades);
  }
  const r = { key, worst, where };
  if (!scenes) pairCache.set(key, r);
  return r;
}

test('flash (b) dissolves: every consecutive pair of the tape in manifest order, the wrap (last -> first) included, stays under 30% over the whole run, at 1x and 4x, at 120x40, 80x24 and 41x11', () => {
  // The pairs come from the manifest's tape order, so slice 3 joins by itself: today redlight -> overdrive is a pair, and when slice 3 puts
  // caller before overdrive the pair re-points to caller -> overdrive (and the wrap, overdrive -> onramp, becomes the new last -> first).
  assert.ok(ORDER.length >= 2, 'the tape has at least two scenes');
  assert.ok(ORDER.includes('overdrive'), 'overdrive is on the tape');
  const pairs = PAIRS;
  assert.deepEqual(pairs[pairs.length - 1], [ORDER[ORDER.length - 1], ORDER[0]], 'the wrap is a pair');
  // the 75 s call is held for its own length, and the pairs on either side of it are run
  if (ORDER.includes('caller')) {
    assert.equal(holdOf('caller'), 75);
    const has = (a, b) => pairs.some(([x, y]) => x === a && y === b);
    assert.ok(has('diner', 'caller') && has('caller', 'overdrive'), 'diner -> caller and caller -> overdrive are pairs');
  }
  const rows = [], bad = [];
  for (const [a, b] of pairs) {
    for (const [w, h] of B_SIZES) {
      for (const speed of B_SPEEDS) {
        const r = pairRun(a, b, w, h, speed);
        rows.push(`${r.key} worst ${pct(r.worst)} at ${r.where.toFixed(2)} s`);
        if (!(r.worst < FLASH_FRACTION)) bad.push(rows[rows.length - 1]);
      }
    }
  }
  console.log('TABLE flash (b)\n  ' + rows.join('\n  '));
  assert.deepEqual(bad, [], 'a frame of a dissolve at or over 30%');
});

// ---- coverage: the lists the suites iterate are the manifest's eight scenes, so nobody can quietly drop one

const EIGHT = ['onramp', 'skyline', 'sundown', 'coast', 'redlight', 'diner', 'caller', 'overdrive'];

test('flash coverage: the scenes, the tape order, the (b) pairs and the (c)/(d) scan jobs are the manifest\'s eight ids (8 pairs including the wrap, holds 90 and 75, caller -> overdrive among them)', () => {
  assert.deepEqual(manifest.scenes.map((s) => s.id), EIGHT, 'the manifest lists the eight');
  assert.deepEqual(SCENES.map((s) => s.id), EIGHT, 'the scenes every suite here loads');
  assert.deepEqual(ORDER, EIGHT, 'the tape order (b) walks');
  // (b): 8 pairs, each scene once as the first and once as the second, the wrap last, and the holds the pair runs with
  assert.equal(PAIRS.length, 8);
  assert.deepEqual(PAIRS.map(([a]) => a), EIGHT);
  assert.deepEqual(PAIRS.map(([, b]) => b), [...EIGHT.slice(1), EIGHT[0]]);
  assert.deepEqual(PAIRS[7], ['overdrive', 'onramp'], 'the wrap');
  assert.ok(PAIRS.some(([a, b]) => a === 'caller' && b === 'overdrive') && PAIRS.some(([a, b]) => a === 'diner' && b === 'caller'));
  assert.deepEqual(EIGHT.map(holdOf), [90, 90, 90, 90, 90, 90, 75, 90]);
  // (b) runs every pair at 1x and 4x, at 120x40, 80x24 and 41x11 (the same constants (b) iterates)
  assert.deepEqual(B_SPEEDS, [1, 4]);
  assert.deepEqual(B_SIZES, [[120, 40], [80, 24], [41, 11]]);
  assert.equal(PAIRS.length * B_SIZES.length * B_SPEEDS.length, 48, '48 pair runs');
  // (c) and (d): the scan jobs cover every scene at both sizes, and the sims at 4x as well
  const jobs = SCAN_JOBS.map(([s, w, h, speed]) => `${s.id} ${w}x${h} ${speed}x`);
  for (const id of EIGHT) {
    for (const size of ['120x40', '80x24']) assert.ok(jobs.includes(`${id} ${size} 1x`), `${id} ${size} 1x is scanned`);
  }
  assert.deepEqual([...new Set(SCAN_JOBS.map(([s]) => s.id))], EIGHT);
  assert.deepEqual([...new Set(SCAN_JOBS.filter(([, , , speed]) => speed === 4).map(([s]) => s.id))], ['redlight', 'overdrive'], 'the sims also at 4x');
  assert.equal(SCAN_JOBS.length, 8 * 2 + 2 * 2);
  // control: a list with a scene dropped is not the eight
  assert.notDeepEqual(EIGHT.filter((id) => id !== 'caller'), SCENES.map((s) => s.id));
});

// ---- (c) and (d): one pass over a scene alone gives both

// Cells scenes run 60 s, sims 90 s (their phases). Records, per run: the cells that kept a glyph and jumped more than one shade step,
// the worst share of bright solid cells (█ or ▓ at L* 60 or more), blank cells not in colour 0 (glyph 32 must be colour 0), and the
// colour indexes outside the palette.
const SOLID = new Set([0x2588, 0x2593]);
function scan(scene, kind, w, h, speed, clk = null) {
  const seconds = kind === 'sim' ? 90 : 60;
  const cc = createCellComposer({ scenes: [scene], cols: w, rows: h, seed: 1 });
  const n = w * h;
  const times = clk ? paintTimes(clk, seconds / speed) : null;
  const total = times ? times.length - 1 : Math.ceil((seconds * FPS) / speed);
  let prev = null;
  const out = { jumps: 0, firstJump: null, bright: 0, brightAt: 0, blankBad: 0, firstBlankBad: null, outOfPalette: 0 };
  for (let k = 0; k <= total; k++) {
    const t = times ? times[k] * speed : (k * speed) / FPS;
    tickStats.frames++;
    const f = cc.frame({ a: 0, b: 0, p: 0 }, t);
    const cur = { g: f.glyphs.slice(), c: f.shades.slice(), L: LTAB };
    let hot = 0;
    for (let i = 0; i < n; i++) {
      const g = cur.g[i], c = cur.c[i];
      if (c >= LTAB.length) out.outOfPalette++;
      if (g === 32) { if (c !== 0) { out.blankBad++; if (!out.firstBlankBad) out.firstBlankBad = { x: i % w, y: Math.floor(i / w), c, t }; } }
      else if (SOLID.has(g) && LTAB[c] >= 60) hot++;
    }
    if (hot / n > out.bright) { out.bright = hot / n; out.brightAt = t; }
    if (prev) {
      const j = brightnessJumps(prev, cur, w);
      if (j.length) { out.jumps += j.length; if (!out.firstJump) out.firstJump = { ...j[0], t, speed }; }
    }
    prev = cur;
  }
  return out;
}

const scanCache = new Map();
function scanOf(s, w, h, speed) {
  const key = `${s.id} ${w}x${h} ${speed}x`;
  if (!scanCache.has(key)) scanCache.set(key, { key, ...scan(s.scene, s.kind, w, h, speed) });
  return scanCache.get(key);
}
// 1x at both sizes for every scene, and 4x for the sims
const SCAN_JOBS = [];
for (const s of SCENES) for (const [w, h] of [[120, 40], [80, 24]]) for (const speed of s.kind === 'sim' ? [1, 4] : [1]) SCAN_JOBS.push([s, w, h, speed]);

// A fake scene (a cells scene) built from a per-frame function of the clock
function fake(fn) {
  const f = (t, w, h, params) => fn(t, w, h, params);
  f.id = 'fake'; f.kind = 'cells';
  return f;
}
const DARKEST = LTAB.indexOf(Math.min(...LTAB)), BRIGHTEST = LTAB.indexOf(Math.max(...LTAB));
const BRIGHT_COLOUR = LTAB.findIndex((L) => L >= 60);

test('flash (c) ramps: in every scene alone, no cell that keeps its glyph moves more than one shade step (28 L*) in a frame, at 120x40 and 80x24', () => {
  const bad = [];
  for (const [s, w, h, speed] of SCAN_JOBS) {
    if (speed !== 1) continue;
    const r = scanOf(s, w, h, speed);
    if (r.jumps) bad.push(`${r.key}: ${r.jumps} jumps, first ${JSON.stringify(r.firstJump)}`);
  }
  assert.deepEqual(bad, [], 'brightness jumps');
  // control: a cell that stays one glyph but goes from the darkest to the brightest palette colour is a jump
  const flip = fake((t, w, h, p) => { const on = Math.floor(t * FPS) % 2 === 1; p.glyphs.fill(0x2588); p.colours.fill(on ? BRIGHTEST : DARKEST); });
  const r = scan(flip, 'cells', 40, 12, 1);
  assert.ok(r.jumps > 0, 'the control (darkest to brightest under one glyph) must produce a jump');
  assert.equal(r.jumps, 40 * 12 * Math.floor(60 * FPS), 'and every cell of every frame is flagged');
});

test('flash (d) bright solid coverage: no frame of any scene has more than 25% of the screen as bright solid blocks; the background is the one #0D0820; a 40% fill fails', () => {
  const bad = [], rows = [];
  for (const [s, w, h, speed] of SCAN_JOBS) {
    const r = scanOf(s, w, h, speed);
    rows.push(`${r.key} worst bright solid ${pct(r.bright)} at ${r.brightAt.toFixed(2)} s`);
    if (r.bright > 0.25) bad.push(rows[rows.length - 1]);
    if (r.blankBad) bad.push(`${r.key}: ${r.blankBad} blank cells not in colour 0, first ${JSON.stringify(r.firstBlankBad)}`);
    if (r.outOfPalette) bad.push(`${r.key}: ${r.outOfPalette} colour indexes outside the palette`);
  }
  console.log('TABLE flash (d)\n  ' + rows.join('\n  '));
  assert.deepEqual(bad, [], 'bright coverage, blank cells or palette range');
  // the background: the skin says #0D0820 and every palette entry carries exactly that background
  assert.equal(SKIN.palette.bg.toUpperCase(), '#0D0820');
  const bg = parseHex('#0D0820');
  const want = `\x1b[48;2;${bg[0]};${bg[1]};${bg[2]}m`;
  assert.equal(PALETTE.base, want);
  for (let i = 0; i < PALETTE.sgr.length; i++) assert.ok(PALETTE.sgr[i].endsWith(want), `palette entry ${i} carries the one background`);
  assert.ok(LTAB.length > BRIGHT_COLOUR && BRIGHT_COLOUR >= 0);
  assert.ok(PALETTE.sgr.every((s) => (s.match(/\x1b\[48;[0-9;]+m/g) || []).length === 1), 'one background escape per entry');
  // control: 40% of the screen filled with a bright full block fails the 25% rule
  const fill = fake((t, w, h, p) => { p.glyphs.fill(32); p.colours.fill(0); const n = Math.floor(w * h * 0.4); for (let i = 0; i < n; i++) { p.glyphs[i] = 0x2588; p.colours[i] = BRIGHT_COLOUR; } });
  const r = scan(fill, 'cells', 120, 40, 1);
  assert.ok(r.bright > 0.25 && Math.abs(r.bright - 0.4) < 0.001, `the control must read 40%, read ${pct(r.bright)}`);
});

// ---- (e) the shell steps

// 41x11 is here too. Its insert KEY FRAME (Enter on the card) used to be the console's hard cut from the library picture to the insert picture:
// 50.11% of the cells at 41x11 (Delza 49.4%, 44x11 47.7%, 40x12 47.3%), over the 40% ceiling at any window under 78x24. DRIFT-7 C8: at the list and tiny
// tiers the shell now dissolves into the insert picture over 0.3 s, so the key frame is held to the same ceiling as every other step, at every size.
const SHELL_SIZES = [[89, 40], [79, 25], [120, 40], [80, 24], [41, 11]];
const HARD_CEILING = 0.4;
const grab = (c) => { tickStats.frames++; const f = c.app.screenshot(); return { g: f.glyphs.slice(), s: f.shades.slice(), p: f.palette }; };
const bgCache = new Map();
const bgsOf = (p) => {
  if (!p) return '(none)';
  if (!bgCache.has(p)) bgCache.set(p, JSON.stringify([p.base || '', ...new Set(p.sgr.map((s) => (/\x1b\[48;[0-9;]+m/.exec(s) || [''])[0]))]));
  return bgCache.get(p);
};

const shellCache = new Map();
const shellSteps = (cols, rows) => {
  const key = `${cols}x${rows}`;
  if (!shellCache.has(key)) shellCache.set(key, runShellSteps(cols, rows));
  return shellCache.get(key);
};

// DRIFT-9 item 4: `clk` ({ mode, seed, strobe }) runs the same flow with the app stepped by that clock (tests/helpers-clock-app.js) and the screens read through the flash meter;
// it returns { steps, rep } instead of steps.
async function runShellSteps(cols, rows, clk = null) {
  const c0 = mkShell({ dirs, cols, rows, startScreen: { screen: 'library' } });
  let c = c0, kit = null;
  const steps = {};
  try {
    c0.app.start();
    c0.tick(2);
    assert.ok(c0.goto('night-drive'), 'the cursor reaches night-drive');
    if (clk) { kit = clockedShell(c0, { clock: clk, meter: shownMeter(cols, rows, FPS_APP), cols, rows, strobe: !!clk.strobe }); c = kit.c; }
    let prev = grab(c), n = 0;
    const record = async (name, isKey) => {
      c.tick(DT);
      if (++n % 9 === 0) await c.settle(5); // let the scene import() promises settle between ticks
      const f = grab(c);
      const fr = changedFraction(f.g, prev.g, f.s, prev.s);
      if (typeof name === 'function') name = name();
      const st = steps[name] || (steps[name] = { worst: 0, at: 0, keyStep: 0, frames: 0, bgs: new Set() });
      if (isKey) st.keyStep = fr;
      else { st.frames++; if (fr > st.worst) { st.worst = fr; st.at = st.frames; } }
      if (!isKey) st.bgs.add(bgsOf(f.p));
      prev = f;
      return f;
    };
    const phaseOf = () => { const s = c.sh(); return s.screen === 'insert' ? 'insert' : (s.menu ? 'menu' : 'boot'); };
    // insert: Enter on the card; the key frame, then the insert animation and the boot, until the menu opens
    const startBg = JSON.parse(bgsOf(prev.p))[0];
    c.key('\r');
    await record('insert', true);
    steps.insert.startBg = startBg;
    for (let k = 0; k < 18 * 20 && !c.sh().menu; k++) await record(phaseOf, false);
    assert.ok(c.sh().menu, 'the tape-deck menu opened');
    // menu opening: three seconds of it
    for (let k = 0; k < 54; k++) await record('menu', false);
    // running: Enter on the highlighted track closes the menu and the track runs, 6 s
    c.key('\r');
    await record('running', true);
    for (let k = 0; k < 6 * 18; k++) await record('running', false);
    assert.equal(c.sh().menu, false, 'the menu closed');
    assert.equal(c.sh().screen, 'running');
    // eject
    c.key('e');
    await record('eject', true);
    for (let k = 0; k < 3 * 18; k++) await record('eject', false);
    assert.equal(c.sh().screen, 'library', 'eject lands in the library');
  } finally { c0.app.quit(0); }
  return clk ? { steps, rep: kit.report() } : steps;
}

for (const [cols, rowsN] of SHELL_SIZES) {
  test(`flash (e) shell steps ${cols}x${rowsN}: insert, boot, menu opening, running and eject each change 30% or less of the cells outside the key frame (never over 40%); the background is one value`, async () => {
    const bad = [], rows = [];
    const steps = await shellSteps(cols, rowsN);
    for (const name of ['insert', 'boot', 'menu', 'running', 'eject']) {
      const st = steps[name];
      assert.ok(st, `${cols}x${rowsN}: no frames for step ${name}`);
      rows.push(`${cols}x${rowsN} ${name}: worst ${pct(st.worst)} (frame ${st.at} of ${st.frames}), key frame ${pct(st.keyStep)}`);
      const keyOver = st.keyStep > HARD_CEILING;
      if (!(st.worst <= FLASH_FRACTION) || st.worst > HARD_CEILING || keyOver) bad.push(rows[rows.length - 1]);
    }
    // the background: every frame from boot to the running track carries the one background #0D0820. The insert animation is still drawn in the
    // console's own palette (its #0A0C10 background, the one the library had), so it is one value too, and the switch to #0D0820 comes with the boot.
    // (The eject frames land in the library, which has its own palette.)
    const escapes = (names) => { const s = new Set(); for (const name of names) for (const b of steps[name].bgs) for (const e of JSON.parse(b)) s.add(e); return s; };
    const want = '\x1b[48;2;13;8;32m';
    assert.deepEqual([...escapes(['boot', 'menu', 'running'])], [want], `${cols}x${rowsN}: boot, menu and running keep the one background #0D0820`);
    assert.deepEqual([...escapes(['insert'])], [steps.insert.startBg], `${cols}x${rowsN}: the insert animation keeps the console's background, one value`);
    assert.notEqual(steps.insert.startBg, want, 'and that is the console\'s, not the cartridge\'s (the one cut, at the boot)');
    console.log('TABLE flash (e)\n  ' + rows.join('\n  '));
    assert.deepEqual(bad, [], 'a step over 30% outside its key frame, or over 40%');
  });
}

// The insert key frame at 41x11 (the frame that carries Enter on the card), on its own: the shell's list-tier dissolve (DRIFT-7 C8) keeps it at 40% or less.
test('flash (e) shell insert key frame 41x11: the frame that carries Enter on the card changes 40% or less of the cells', async () => {
  const steps = await shellSteps(41, 11);
  console.log(`TABLE flash (e) key frame
  41x11 insert key frame ${pct(steps.insert.keyStep)}`);
  assert.ok(steps.insert.keyStep <= HARD_CEILING, `41x11: the insert key frame changed ${pct(steps.insert.keyStep)}`);
});


// ---- DRIFT-9 item 4: the clocks. Every rule above judges a step of an exact 18 fps grid, and a loop on a real clock paints steps of 46.9 or 62.5 ms (the 15.6 ms Windows tick) or up to 16 ms late
// (tests/helpers-clock.js). Each group has one q156 arm and one jitter arm on its worst known case, at the SAME limits (nothing is loosened: STRICTLY under 30 % for (a) and (b), one shade
// step for (c), 25 % bright solid and the one background for (d), 30 % outside the key frame and 40 % for (e)), the replays stepping the clock's paint times instead of k / 18 and (e) running
// the app stepped by the clock and also read through the flash meter and judged by the five 1x rules; a control per group; and the cost by count (every frame a replay or the app paints).
const CLK = [{ mode: 'q156', seed: 1 }, { mode: 'jitter', seed: 3 }];
// the controls and nothing else are not counted: they are not arms, and they are not frames the other arms read
async function uncounted(fn) { const kept = tickStats.frames; try { return await fn(); } finally { tickStats.frames = kept; } }

for (const clk of CLK) {
  test(`flash (a) overdrive on the ${clk.mode} clock: 90 s at 4x through the composer at 60x18, every painted step changes strictly under 30% of the cells; the unguarded control goes over on this clock too`, async () => {
    const r = await clockArm(async () => shareRun(overdrive, 60, 18, 4, 90, clk), tickStats);
    console.log(`CLOCK STEP (a) ${clk.mode} 60x18 4x: worst ${pct(r.worst)} at ${r.where.toFixed(2)} s (${r.n} steps; limit strictly under ${pct(FLASH_FRACTION)})`);
    assert.ok(r.worst < FLASH_FRACTION, `${clk.mode} 60x18 4x: worst ${pct(r.worst)} at ${r.where.toFixed(2)} s`);
    const off = await uncounted(async () => shareRun(createOverdrive({ ringLimit: false }), 120, 40, 4, 90, clk));
    assert.ok(off.worst > FLASH_FRACTION, `${clk.mode}: the control (no ring guard) changed only ${pct(off.worst)} at 120x40 4x: this arm would not notice a missing guard`);
  });

  for (const [a, b, w, h] of [['sundown', 'coast', 41, 11], ['redlight', 'diner', 80, 24]]) {
    test(`flash (b) dissolve ${a} > ${b} on the ${clk.mode} clock at ${w}x${h}, 4x: the worst painted step of the whole run is strictly under 30%; two scenes that flip every cell each frame are over it on this clock too`, async () => {
      const r = await clockArm(async () => pairRun(a, b, w, h, 4, clk), tickStats);
      console.log(`CLOCK STEP (b) ${clk.mode} ${a}>${b} ${w}x${h} 4x: worst ${pct(r.worst)} at ${r.where.toFixed(2)} s (limit strictly under ${pct(FLASH_FRACTION)})`);
      assert.ok(r.worst < FLASH_FRACTION, `${r.key}: worst ${pct(r.worst)} at ${r.where.toFixed(2)} s`);
      const flip = (o) => { const f = (t, ww, hh, p) => { const on = (Math.floor(t * FPS) + o) % 2 === 1; p.glyphs.fill(0x2588); p.colours.fill(on ? BRIGHTEST : DARKEST); }; f.id = `flip${o}`; f.kind = 'cells'; return f; };
      const bad = await uncounted(async () => pairRun('x', 'y', 41, 11, 4, clk, [flip(0), flip(1)]));
      assert.ok(bad.worst > FLASH_FRACTION, `${clk.mode}: the control (every cell flips each frame) changed only ${pct(bad.worst)}`);
    });
  }

  test(`flash (c)+(d) overdrive on the ${clk.mode} clock: 90 s at 1x at 80x24, no cell that keeps its glyph moves more than one shade step in a painted step, never over 25% bright solid, blank cells in colour 0, colours in the palette; the controls fail on this clock too`, async () => {
    const r = await clockArm(async () => scan(overdrive, 'sim', 80, 24, 1, clk), tickStats);
    console.log(`CLOCK STEP (c)(d) ${clk.mode} overdrive 80x24 1x: ${r.jumps} jumps, worst bright solid ${pct(r.bright)} at ${r.brightAt.toFixed(2)} s, ${r.blankBad} bad blanks, ${r.outOfPalette} out of palette (limits 0, ${pct(0.25)}, 0, 0)`);
    assert.equal(r.jumps, 0, `${clk.mode}: ${r.jumps} brightness jumps, first ${JSON.stringify(r.firstJump)}`);
    assert.ok(r.bright <= 0.25, `${clk.mode}: bright solid ${pct(r.bright)} at ${r.brightAt.toFixed(2)} s`);
    assert.equal(r.blankBad, 0, `${clk.mode}: blank cells not in colour 0, first ${JSON.stringify(r.firstBlankBad)}`);
    assert.equal(r.outOfPalette, 0, `${clk.mode}: colour indexes outside the palette`);
    const flip = fake((t, w, h, p) => { const on = Math.floor(t * FPS) % 2 === 1; p.glyphs.fill(0x2588); p.colours.fill(on ? BRIGHTEST : DARKEST); });
    const fill = fake((t, w, h, p) => { p.glyphs.fill(32); p.colours.fill(0); const n = Math.floor(w * h * 0.4); for (let i = 0; i < n; i++) { p.glyphs[i] = 0x2588; p.colours[i] = BRIGHT_COLOUR; } });
    const [cj, cb] = await uncounted(async () => [scan(flip, 'cells', 40, 12, 1, clk), scan(fill, 'cells', 120, 40, 1, clk)]);
    assert.ok(cj.jumps > 0, `${clk.mode}: the ramp control (darkest to brightest under one glyph) must produce a jump`);
    assert.ok(cb.bright > 0.25, `${clk.mode}: the coverage control (a 40% fill) must read over 25%, read ${pct(cb.bright)}`);
  });

  test(`flash (e) shell steps on the ${clk.mode} clock, 79x25: insert, boot, menu, running and eject change 30% or less of the cells outside the key frame (never over 40%) and pass the five 1x rules`, async () => {
    const { steps, rep } = await clockArm(() => runShellSteps(79, 25, clk), tickStats);
    const lines = [], bad = [];
    for (const name of ['insert', 'boot', 'menu', 'running', 'eject']) {
      const st = steps[name];
      assert.ok(st, `79x25: no frames for step ${name}`);
      lines.push(`${name} worst ${pct(st.worst)} key ${pct(st.keyStep)}`);
      if (!(st.worst <= FLASH_FRACTION) || st.worst > HARD_CEILING || st.keyStep > HARD_CEILING) bad.push(`${clk.mode} 79x25 ${name}: worst ${pct(st.worst)} (frame ${st.at} of ${st.frames}), key frame ${pct(st.keyStep)}`);
    }
    console.log(`CLOCK STEP (e) ${clk.mode} 79x25: ${lines.join('; ')} (limits ${pct(FLASH_FRACTION)} and ${pct(HARD_CEILING)})`);
    assert.deepEqual(bad, [], 'a step over 30% outside its key frame, or over 40%');
    judgeX1(rep, `night-drive shell ${clk.mode} 79x25`);
  });
  test(`flash (e) clock control (${clk.mode}): the same flow with a white/black strobe in place of the screen fails L1 and L3, so the arm above can fail`, async () => {
    const { rep } = await uncounted(() => runShellSteps(79, 25, { ...clk, strobe: true }));
    const bad = failedRules(rep, { only: X1_RULE_IDS });
    assert.ok(bad.includes('l1.x1') && bad.includes('l3'), `${clk.mode}: the strobe failed ${bad.join(',')}`);
  });
}
test('DRIFT-9 clock arms cost: night-drive flash clock arms read at most 15 % of the frames the other arms of this file read (by count)', () => { assertArmCost('night-drive flash', undefined, tickStats); });
