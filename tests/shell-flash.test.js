// DRIFT-4 phase 2: photosensitivity of the console, measured on the frames the app really draws
// (app.screenshot() after every tick, 18 fps) at 120x40 and 80x24.
//   - no frame step changes more than 30% of the cells, except the step that carries a key press
//   - big steps (there should be none outside key presses) are at least 3 s apart
//   - at the insert -> boot palette swap the last insert frame and the first boot frame each have at most
//     30% lit cells (the swap repaints every lit cell in the new palette)
//   - an idle library for 60 s stays within the limit and draws next to nothing
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLASH_FRACTION, changedFraction, snap } from './helpers-flash.js';
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
  const grab = () => { const s = c.app.screenshot(); if (s) { frames.push(snap(s)); screens.push(c.sh() ? c.sh().screen : 'classic'); } };
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
