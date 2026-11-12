// DRIFT-4 phase 2: photosensitivity of the console, measured on the frames the app really draws
// (app.screenshot() after every tick, 18 fps) at 120x40 and 80x24.
//   - no frame step changes more than 30% of the cells, except the step that carries a key press
//   - big steps (there should be none outside key presses) are at least 3 s apart
//   - at the insert -> boot palette swap the last insert frame and the first boot frame each have at most
//     30% lit cells (the swap repaints every lit cell in the new palette)
//   - an idle library for 60 s stays within the limit and draws next to nothing
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLASH_FRACTION, changedFraction, snap, lstarTable, brightnessJumps, SHADE_STEP_LSTAR } from './helpers-flash.js';
import { mkShell, DT, FPS } from './helpers-shell.js';
import { INSERT_END } from '../src/shell/insert.js';
import { BOOT_END } from '../src/shell/boot.js';

const SIZES = [[120, 40], [80, 24]];

// Drives the app and records every frame step. press(key) marks the next step as a key step.
function recorder(c) {
  const frames = [];
  const keySteps = new Set();
  const screens = [];
  let last = null;
  const grab = () => { const s = c.app.screenshot(); if (s) { frames.push({ ...snap(s), L: lstarTable(s.palette) }); screens.push(c.sh() ? c.sh().screen : 'classic'); } };
  return {
    frames, keySteps, screens,
    press(k) { c.key(k); keySteps.add(frames.length); },
    run(seconds) { for (let t = 0; t < seconds - 1e-9; t += DT) { c.app.tick(DT); grab(); } last = frames.length; return last; },
    stepFractions() {
      const out = [];
      for (let k = 1; k < frames.length; k++) out.push(changedFraction(frames[k].g, frames[k - 1].g, frames[k].c, frames[k - 1].c));
      return out;
    },
  };
}

function assertSafe(r, label) {
  const steps = r.stepFractions();
  let worst = 0, worstAt = -1;
  const big = [];
  for (let k = 0; k < steps.length; k++) {
    if (r.keySteps.has(k + 1)) continue; // the step that carries the key press
    if (steps[k] > worst) { worst = steps[k]; worstAt = k + 1; }
    if (steps[k] > FLASH_FRACTION) big.push(k + 1);
  }
  assert.deepEqual(big, [], `${label}: steps over ${FLASH_FRACTION} at frames ${big.slice(0, 5)} (worst ${worst.toFixed(3)} at ${worstAt}, screens ${big.slice(0, 3).map((k) => r.screens[k - 1] + '>' + r.screens[k])})`);
  // flashes (any step over the limit, key steps included) at least 3 s apart
  const all = [];
  for (let k = 0; k < steps.length; k++) if (steps[k] > FLASH_FRACTION) all.push((k + 1) / FPS);
  for (let i = 1; i < all.length; i++) assert.ok(all[i] - all[i - 1] >= 3, `${label}: flashes ${all[i - 1]} and ${all[i]} less than 3 s apart`);
  return { worst, worstAt };
}

const litFraction = (f) => f.g.reduce((n, g) => n + (g !== 32 ? 1 : 0), 0) / f.g.length;

for (const [cols, rows] of SIZES) {
  test(`flash ${cols}x${rows}: library, cursor moves, Enter, insert, boot and the first 10 s of running stay under the limit`, async (t) => {
    const c = mkShell({ startScreen: { screen: 'library' }, cols, rows });
    c.app.start();
    const r = recorder(c);
    r.run(1);
    r.press('\x1b[C'); r.run(1.2); // cursor to the fixture
    r.press('\x1b[C'); r.run(1.2); // and on to the locked one
    r.press('\r'); r.run(1.2); // locked: dip and spring back
    r.press('\x1b[D'); r.run(1.2);
    r.press('\r'); // insert the fixture
    await c.settle();
    const insertStart = r.frames.length;
    r.run(INSERT_END);
    assert.equal(c.sh().screen, 'boot', 'the insert has run its course');
    r.run(BOOT_END - INSERT_END + 0.4);
    assert.equal(c.sh().screen, 'running');
    const runStart = r.frames.length;
    r.run(5);
    r.press('\x1b'); // close the menu
    r.run(5.5);
    assert.equal(c.sh().screen, 'running');
    const { worst, worstAt } = assertSafe(r, `${cols}x${rows}`);
    t.diagnostic(`${cols}x${rows}: worst non-key step ${(worst * 100).toFixed(1)}% at frame ${worstAt} (${r.screens[worstAt - 1]} > ${r.screens[worstAt]}); ${r.frames.length} frames`);
    // the insert -> boot swap
    const firstBoot = r.screens.indexOf('boot');
    assert.ok(firstBoot > insertStart);
    assert.equal(r.screens[firstBoot - 1], 'insert');
    assert.ok(litFraction(r.frames[firstBoot - 1]) <= FLASH_FRACTION, `last insert frame lit ${litFraction(r.frames[firstBoot - 1])}`);
    assert.ok(litFraction(r.frames[firstBoot]) <= FLASH_FRACTION, `first boot frame lit ${litFraction(r.frames[firstBoot])}`);
    assert.ok(runStart > firstBoot);
    c.done();
  });

  test(`flash ${cols}x${rows}: ejecting (the insert played backwards) and re-inserting stay under the limit`, async () => {
    const c = mkShell({ startScreen: { screen: 'library' }, cols, rows });
    c.app.start();
    const r = recorder(c);
    r.run(0.5);
    c.goto('fixture');
    r.run(0.6);
    r.press('\r');
    await c.settle();
    r.run(INSERT_END + BOOT_END);
    assert.equal(c.sh().screen, 'running');
    r.press('\x1b'); r.run(1);
    r.press('e');
    r.run(2.2);
    assert.equal(c.sh().screen, 'library');
    r.run(1);
    assertSafe(r, `eject ${cols}x${rows}`);
    c.done();
  });

  test(`flash ${cols}x${rows}: a program switch from the menu dissolves under the limit, and the menu opening and closing ramps`, async () => {
    const c = mkShell({ startScreen: { screen: 'library' }, cols, rows });
    c.app.start();
    c.goto('fixture');
    c.key('\r');
    await c.settle();
    c.tick(8);
    const r = recorder(c);
    r.run(1);
    r.press('\x1b[B'); r.run(0.5);
    r.press('\r'); r.run(4); // Calm
    r.press('\r'); r.run(1); // open
    r.press('\x1b'); r.run(1); // close
    r.press('\r'); r.run(21); // open and let it auto-close
    assert.equal(c.sh().menu, false);
    assertSafe(r, `switch ${cols}x${rows}`);
    c.done();
  });

  test(`flash ${cols}x${rows}: 60 s idle in the library stays under the limit and draws only the small idle movements`, () => {
    const c = mkShell({ startScreen: { screen: 'library' }, cols, rows });
    c.app.start();
    c.tick(0.5);
    const n = c.writes();
    const r = recorder(c);
    r.run(60);
    assertSafe(r, `idle ${cols}x${rows}`);
    // (A2: the idle movements - LED breath, label ripple, console scanline, prompt cursor - are the only writes)
    const steps = r.stepFractions();
    const moved = steps.filter((f) => f > 0).length;
    assert.equal(c.writes() - n, moved, 'one write per visible change and none for an unchanged frame');
    assert.ok(moved < steps.length * 0.4, `${moved} of ${steps.length} frames changed`);
    assert.ok(Math.max(...steps) <= 0.011, `worst idle step ${(Math.max(...steps) * 100).toFixed(2)}%`);
    c.done();
  });
}

test('flash: Classic <-> library round trips: only the key steps are big (the repaint is a palette-for-palette swap)', () => {
  const c = mkShell({ cols: 120, rows: 40 });
  c.app.start();
  const r = recorder(c);
  r.run(2);
  r.press('l'); r.run(2);
  r.press('\x1b'); r.run(2);
  assertSafe(r, 'round trip');
  c.done();
});

// A2: the library's motion. Idle, a slide (with its queued second press), and the locked dip, driven through the real app.
for (const [cols, rows] of [...SIZES, [240, 67]]) {
  test(`flash ${cols}x${rows}: library idle 60 s, slides (one queued, one dropped) and a locked dip stay under the limit`, (t) => {
    const c = mkShell({ startScreen: { screen: 'library' }, cols, rows });
    c.app.start();
    const r = recorder(c);
    r.run(30); // idle: LED, ripple, scanline, cursor
    r.press('\x1b[C'); r.press('\x1b[C'); r.press('\x1b[C'); r.run(2.5); // one slide, a queued one (starts at 1.2 s), a dropped one
    r.press('\x1b[D'); r.run(1.3);
    r.press('\x1b[C'); r.run(1.3);
    assert.equal(c.sh().cartridge, 'locker');
    r.press('\r'); r.run(1.2); // locked: dip, spring back, message
    r.press('\x1b[D'); r.run(1.3);
    r.press('\x1b[D'); r.run(30); // and idle again, on another cartridge
    assert.equal(c.sh().screen, 'library');
    const { worst, worstAt } = assertSafe(r, `motion ${cols}x${rows}`);
    // no flash at all (any step over the limit) - not even on a key step
    assert.deepEqual(r.stepFractions().filter((f) => f > FLASH_FRACTION), [], 'no step over the limit, key steps included');
    // the slide: the biggest step is the one carrying the key (first slide frame), the rest ease out
    const steps = r.stepFractions();
    const slideSteps = steps.slice(Math.floor(30 * FPS), Math.floor(30 * FPS) + 8);
    assert.ok(Math.max(...slideSteps) <= FLASH_FRACTION);
    assert.ok(r.keySteps.size >= 6, 'the presses were recorded');
    // 60 s of idle in all: the idle stretches stay at about 1% a frame
    const idleSteps = steps.slice(0, Math.floor(30 * FPS) - 1).concat(steps.slice(steps.length - Math.floor(29 * FPS)));
    assert.ok(Math.max(...idleSteps) <= 0.011, `idle worst ${(Math.max(...idleSteps) * 100).toFixed(2)}%`);
    c.done();
    t.diagnostic(`motion ${cols}x${rows}: worst non-key step ${(worst * 100).toFixed(1)}% at frame ${worstAt}; worst slide step ${(Math.max(...slideSteps) * 100).toFixed(1)}%; worst idle step ${(Math.max(...idleSteps) * 100).toFixed(2)}%`);
  });
}

// ---- A3: insert, boot and eject (designer section 3), through the real app at 18 fps.
// Two rules on every step that does not carry a key press:
//   1. no step changes more than FLASH_FRACTION of the cells (assertSafe, above)
//   2. brightness ramps: no cell that keeps its glyph moves by more than one shade step (SHADE_STEP_LSTAR, see
//      helpers-flash.js) between consecutive frames. Cells that appear, disappear or change glyph are dissolves
//      and wipes and are bounded by rule 1.
function assertRamps(r, label) {
  const bad = [];
  let worstBoot = 0;
  for (let k = 1; k < r.frames.length; k++) {
    if (r.keySteps.has(k)) continue;
    const jumps = brightnessJumps(r.frames[k - 1], r.frames[k], r.cols);
    // In the boot the edge of the zoom crosses cells that hold the same glyph (a vertical edge over a vertical bar):
    // a few of them change by more than a step as it passes (the designer: the biggest change in any one frame is the
    // moving edge of the zoom). Allow 1% of the cells there. Everywhere else two cells: the library's prompt cursor
    // starts its fade (amber to silver 3) on the first beat after the library comes back.
    const room = r.screens[k] === 'boot' ? Math.ceil(r.frames[k].g.length * 0.01) : 2;
    if (r.screens[k] === 'boot') worstBoot = Math.max(worstBoot, jumps.length);
    if (jumps.length > room) bad.push(`frame ${k} (${r.screens[k - 1]}>${r.screens[k]}): ${jumps.length} cells (room ${room}), first ${JSON.stringify(jumps[0])}`);
  }
  assert.deepEqual(bad.slice(0, 4), [], `${label}: cells jumping by more than ${SHADE_STEP_LSTAR} L* in one frame`);
  return worstBoot;
}

const withCols = (r, cols) => { r.cols = cols; return r; };

// (sampled at three phases of the 18 fps clock, so the bounds are not tuned on one set of frames)
for (const [cols, rows, phase] of [...SIZES, [240, 67]].flatMap(([w, h]) => [0, 0.021, 0.043].map((p) => [w, h, p]))) {
  test(`flash ${cols}x${rows} (phase +${phase} s): insert, boot and the dissolve into the menu - every step under the limit, every brightness change a ramp`, async (t) => {
    const c = mkShell({ startScreen: { screen: 'library' }, cols, rows });
    c.app.start();
    c.goto('fixture');
    const r = withCols(recorder(c), cols);
    r.run(0.5 + phase);
    r.press('\r');
    c.tick(phase);
    await c.settle();
    const first = r.frames.length;
    r.run(INSERT_END + 0.05);
    assert.equal(c.sh().screen, 'boot');
    r.run(BOOT_END - INSERT_END + 0.3);
    await c.settle();
    r.run(1);
    assert.equal(c.sh().screen, 'running');
    const { worst, worstAt } = assertSafe(r, `A3 ${cols}x${rows}`);
    assertRamps(r, `A3 ${cols}x${rows}`);
    // the insert and the boot are real animations: many frames, none of them a flash
    const screens = r.screens.slice(first);
    assert.ok(screens.filter((s) => s === 'insert').length >= 26, 'the insert has its 27 frames');
    assert.ok(screens.filter((s) => s === 'boot').length >= 70, 'the boot has its 77 frames');
    // the biggest step in the insert and in the boot, apart from the key press, is well inside the limit
    const steps = r.stepFractions();
    const inScreen = (name) => Math.max(...steps.filter((f, k) => r.screens[k + 1] === name && r.screens[k] === name && !r.keySteps.has(k + 1)));
    assert.ok(inScreen('insert') <= 0.2, `insert worst ${(inScreen('insert') * 100).toFixed(1)}%`);
    assert.ok(inScreen('boot') <= 0.2, `boot worst ${(inScreen('boot') * 100).toFixed(1)}%`);
    t.diagnostic(`${cols}x${rows}: insert worst ${(inScreen('insert') * 100).toFixed(1)}%, boot worst ${(inScreen('boot') * 100).toFixed(1)}%, overall non-key worst ${(worst * 100).toFixed(1)}% at frame ${worstAt}`);
    c.done();
  });
}

for (const [cols, rows] of SIZES) {
  test(`flash ${cols}x${rows}: eject (fade to blank 0.3 s, then the insert backwards 1.6 s) under the limit with every brightness change a ramp, and the library after it`, async (t) => {
    const c = mkShell({ startScreen: { screen: 'library' }, cols, rows });
    c.app.start();
    c.goto('fixture');
    c.key('\r');
    await c.settle();
    c.tick(INSERT_END + BOOT_END + 0.5);
    await c.settle();
    c.tick(1);
    assert.equal(c.sh().screen, 'running');
    c.key('\x1b'); // close the menu
    c.tick(1);
    const r = withCols(recorder(c), cols);
    r.run(0.5);
    r.press('e');
    r.run(2.2);
    assert.equal(c.sh().screen, 'library');
    r.run(1);
    const { worst, worstAt } = assertSafe(r, `eject ${cols}x${rows}`);
    assertRamps(r, `eject ${cols}x${rows}`);
    const steps = r.stepFractions();
    const ej = Math.max(...steps.filter((f, k) => r.screens[k + 1] === 'eject' && r.screens[k] === 'eject'));
    assert.ok(ej <= 0.2, `eject worst ${(ej * 100).toFixed(1)}%`);
    t.diagnostic(`${cols}x${rows}: eject worst ${(ej * 100).toFixed(1)}%, overall non-key worst ${(worst * 100).toFixed(1)}% at frame ${worstAt}`);
    c.done();
  });
}

for (const [cols, rows] of SIZES) {
  test(`flash ${cols}x${rows}: the Classic cartridge - insert, boot and the hand-back to its scene stay under the limit (no key step excused except Enter)`, (t) => {
    const c = mkShell({ startScreen: { screen: 'library' }, cols, rows, config: { mode: 'calm' } });
    c.app.start();
    c.tick(0.3);
    const r = withCols(recorder(c), cols);
    r.run(0.5);
    r.press('\r');
    r.run(INSERT_END + 4.4);
    assert.equal(c.sh(), null, 'back on the Classic path');
    r.run(2);
    const { worst, worstAt } = assertSafe(r, `classic ${cols}x${rows}`);
    assertRamps(r, `classic ${cols}x${rows}`);
    t.diagnostic(`${cols}x${rows}: Classic non-key worst ${(worst * 100).toFixed(1)}% at frame ${worstAt} (${r.screens[worstAt - 1]} > ${r.screens[worstAt]})`);
    c.done();
  });
}

test('flash helper: brightnessJumps sees a two-step jump, accepts one step, ignores appearing cells and a palette swap that keeps the colours', () => {
  const pal = { sgr: ['\x1b[38;2;20;20;20m', '\x1b[38;2;93;100;116m', '\x1b[38;2;139;147;161m', '\x1b[38;2;200;204;212m'] };
  const L = lstarTable(pal);
  const frame = (g, c) => ({ g: Uint16Array.from(g), c: Uint8Array.from(c), L });
  const a = frame([65, 65, 65, 32], [1, 1, 1, 0]);
  assert.equal(brightnessJumps(a, frame([65, 65, 65, 32], [2, 1, 3, 0]), 4).length, 1, 'graphite -> silver is two steps; graphite -> dim is one');
  assert.equal(brightnessJumps(a, frame([66, 65, 65, 66], [3, 1, 1, 3]), 4).length, 0, 'a new glyph and a cell that appears are dissolves, not ramps');
  const swapped = { g: a.g, c: Uint8Array.from([2, 2, 2, 0]), L: lstarTable({ sgr: ['', '', '\x1b[38;2;93;100;116m'] }) };
  assert.equal(brightnessJumps(a, swapped, 4).length, 0, 'another palette index with the same colour is no change');
});

// ---- DRIFT-4 A4: moving the cursor through a slots menu (cards of 4 rows, 2-row entries, or the list it falls back to)
import fs from 'node:fs';
import path from 'node:path';
import { runCartridge, makeRoot } from './helpers-shell.js';
import { drawMenu } from '../src/shell/menu.js';
import { newFrame } from '../src/shell/ui.js';

for (const [cols, rows] of SIZES) {
  test(`flash ${cols}x${rows}: cycling the cursor through a slots menu of 8 entries (the manifest limit) stays under the limit on every step, key steps included`, async (t) => {
    const root = makeRoot();
    const mp = path.join(root, 'fixture', 'manifest.json'), sp = path.join(root, 'fixture', 'skin.json');
    const m = JSON.parse(fs.readFileSync(mp, 'utf8')), sk = JSON.parse(fs.readFileSync(sp, 'utf8'));
    m.menu = Array.from({ length: 7 }, (_, i) => ({ label: `Program ${i + 1}`, program: i % 2 ? 'calm' : 'mix' })).concat([{ label: 'Eject', action: 'eject' }]);
    sk.menu = { layout: 'slots', title: 'Menu' };
    fs.writeFileSync(mp, JSON.stringify(m)); fs.writeFileSync(sp, JSON.stringify(sk));
    const c = mkShell({ startScreen: { screen: 'library' }, cols, rows, root });
    c.app.start();
    await runCartridge(c, 'fixture');
    assert.equal(c.sh().screen, 'running');
    assert.equal(c.sh().menu, true, 'the menu is open');
    const r = recorder(c);
    r.run(1);
    for (let i = 0; i < 9; i++) { r.press('\x1b[B'); r.run(0.4); }
    for (let i = 0; i < 9; i++) { r.press('\x1b[A'); r.run(0.4); }
    const steps = r.stepFractions();
    const worst = Math.max(...steps);
    t.diagnostic(`${cols}x${rows}: worst step ${(worst * 100).toFixed(1)}%`);
    assert.ok(worst <= FLASH_FRACTION, `${cols}x${rows}: worst step ${(worst * 100).toFixed(1)}% (key steps included)`);
    assertSafe(r, `slots cycle ${cols}x${rows}`);
    c.done();
  });

  test(`flash ${cols}x${rows}: drawMenu cycling a 10-entry slots menu over a full-screen busy scene changes under 30% of the cells per step`, () => {
    const scene = newFrame(cols, rows);
    for (let i = 0; i < scene.glyphs.length; i++) { scene.glyphs[i] = 0x2591 + (i % 3); scene.shades[i] = 1 + (i * 7) % 5; }
    const entries = Array.from({ length: 10 }, (_, i) => ({ label: `Program ${i + 1}`, current: i === 3 }));
    const prev = (index) => {
      const f = { glyphs: scene.glyphs.slice(), shades: scene.shades.slice(), cols, rows };
      drawMenu(f, { entries, index }, { palette: { ui: { text: 5, dim: 3, head: 9, accent: 12 } }, menu: { layout: 'slots', title: 'Menu' } });
      return { g: f.glyphs, c: f.shades };
    };
    let last = prev(0);
    let worst = 0;
    for (let k = 1; k <= 20; k++) { // down through the ten and wrapping, then back up
      const cur = prev(k % 10);
      worst = Math.max(worst, changedFraction(cur.g, last.g, cur.c, last.c));
      last = cur;
    }
    for (let k = 9; k >= 0; k--) {
      const cur = prev(k);
      worst = Math.max(worst, changedFraction(cur.g, last.g, cur.c, last.c));
      last = cur;
    }
    assert.ok(worst <= FLASH_FRACTION, `${cols}x${rows}: worst cursor step ${(worst * 100).toFixed(1)}%`);
  });
}

// ---- DRIFT-4 B1: a cartridge whose skin restyles the console (frame, grille, stripe, every ink at the brightest level 3,
// a spaced title with an ornament): insert, boot and eject stay under the limit and every brightness change is a ramp.
const CONSOLE_INK3 = {
  frame: '┏━┓┃┛━┗┃', grille: '═', stripe: '▁▂▃▄▅▆▇█',
  ink: { frame: 3, grille: 3, stripe: 3, led: 3, bar: 3 },
  title: { style: 'spaced', ornament: '── ◆ ──', ornamentColour: 12 },
};
function consoleSkinRoot() {
  const root = makeRoot();
  const sp = path.join(root, 'fixture', 'skin.json');
  const sk = JSON.parse(fs.readFileSync(sp, 'utf8'));
  sk.console = CONSOLE_INK3;
  fs.writeFileSync(sp, JSON.stringify(sk));
  return root;
}

for (const [cols, rows] of SIZES) {
  test(`flash ${cols}x${rows}: a console skin with every ink at level 3 - insert, boot and eject under the limit, every brightness change a ramp`, async (t) => {
    const c = mkShell({ startScreen: { screen: 'library' }, cols, rows, root: consoleSkinRoot() });
    c.app.start();
    c.goto('fixture');
    const r = withCols(recorder(c), cols);
    r.run(0.5);
    r.press('\r');
    await c.settle();
    r.run(INSERT_END + 0.05);
    assert.equal(c.sh().screen, 'boot');
    assert.ok(c.text().includes('┏') || c.text().includes('━'), 'the skin\'s console frame is on the screen at the end of the insert');
    r.run(BOOT_END - INSERT_END + 0.3);
    await c.settle();
    r.run(1);
    assert.equal(c.sh().screen, 'running');
    const insertBoot = assertSafe(r, `console skin ${cols}x${rows}`);
    assertRamps(r, `console skin ${cols}x${rows}`);
    c.key('\x1b');
    c.tick(1);
    const r2 = withCols(recorder(c), cols);
    r2.run(0.5);
    r2.press('e');
    r2.run(2.2);
    assert.equal(c.sh().screen, 'library');
    r2.run(1);
    const eject = assertSafe(r2, `console skin eject ${cols}x${rows}`);
    assertRamps(r2, `console skin eject ${cols}x${rows}`);
    t.diagnostic(`${cols}x${rows}: insert+boot worst ${(insertBoot.worst * 100).toFixed(1)}%, eject worst ${(eject.worst * 100).toFixed(1)}%`);
    c.done();
  });
}
