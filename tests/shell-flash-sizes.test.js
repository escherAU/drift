// DRIFT-4: photosensitivity of every console transition at the sizes where it used to break (found by the
// contrarian): the library slide at 88-106 columns, the eject into a small library, and the cuts between the
// boot, the menu, Classic and the library at small sizes.
//   Rule: no frame step changes more than 30% of the cells, except the frame that carries the key press;
//   never above the 40% hard ceiling (not even the key frame).
// Every scenario is measured on the frames the app really draws (app.screenshot() after each 18 fps tick).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLASH_FRACTION, changedFraction, failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { shownMeter } from './helpers-flash-modes.js';
import { clockedShell, tickStats, FPS_APP } from './helpers-clock-app.js';
import { clockArm, assertArmCost, judgeX1 } from './helpers-clock-arms.js';
import { mkShell, DT, runCartridge } from './helpers-shell.js';
import { INSTALL_DIR } from '../src/cartridge/loader.js';

const HARD_CEILING = 0.4;
const SIZES = [[88, 39], [89, 39], [106, 39], [56, 14], [50, 12], [44, 11], [40, 10], [78, 24], [80, 24], [120, 40], [60, 14]];
const dirs = [{ dir: INSTALL_DIR, trusted: true }];
const RIGHT = '\x1b[C', LEFT = '\x1b[D', ESC = '\x1b';

const grab = (c) => { tickStats.frames++; const f = c.app.screenshot(); return { g: f.glyphs.slice(), s: f.shades.slice() }; };

// Press `key`, tick once (the key frame), then watch `secs` seconds. Returns the worst non-key step and the
// key step itself. `between` runs after the key (a real-time settle for the cartridge load).
async function watch(c, key, secs, between) {
  let prev = grab(c);
  c.key(key);
  if (between) await between();
  c.tick(DT);
  let f = grab(c);
  const keyStep = changedFraction(f.g, prev.g, f.s, prev.s);
  prev = f;
  let worst = 0, at = 0;
  for (let k = 1; k < secs * 18; k++) {
    c.tick(DT);
    f = grab(c);
    const fr = changedFraction(f.g, prev.g, f.s, prev.s);
    if (fr > worst) { worst = fr; at = k; }
    prev = f;
  }
  return { worst, at, keyStep };
}

const library = (cols, rows, startScreen = { screen: 'library' }) => {
  const c = mkShell({ dirs, cols, rows, startScreen });
  c.app.start();
  c.tick(2);
  return c;
};

const SCENARIOS = {
  'slide right': async (c) => watch(c, RIGHT, 1.2),
  'slide left': async (c) => watch(c, LEFT, 1.2),
  // Enter on Delza: insert, boot, then the menu opens
  'insert, boot, menu': async (c) => { c.goto('delza'); c.tick(1); return watch(c, '\r', 8, () => c.settle()); },
  // eject from a running cartridge into the library
  eject: async (c) => { await runCartridge(c, 'delza'); return watch(c, 'e', 3); },
  // Enter on the Classic cartridge: the library hands over to Classic
  'library to Classic': async (c) => { assert.equal(c.sh().cartridge, 'classic'); return watch(c, '\r', 3); },
  // from Classic, `l` opens the library
  'Classic to library': async (c) => { assert.equal(c.sh(), null); return watch(c, 'l', 3); },
  // and Esc in a library opened from Classic goes back
  'library Esc to Classic': async (c) => { c.key('l'); c.tick(3); return watch(c, ESC, 3); },
};

for (const [cols, rows] of SIZES) {
  for (const [name, run] of Object.entries(SCENARIOS)) {
    test(`flash ${cols}x${rows}: ${name} stays at or under 30% a frame outside the key press (never over 40%)`, async (t) => {
      const startsInClassic = name === 'Classic to library' || name === 'library Esc to Classic';
      const c = library(cols, rows, startsInClassic ? null : { screen: 'library' });
      let r;
      try { r = await run(c); } finally { c.app.quit(0); }
      t.diagnostic(`TABLE ${name} ${cols}x${rows} worst ${(r.worst * 100).toFixed(1)} key ${(r.keyStep * 100).toFixed(1)}`);
      assert.ok(r.worst <= FLASH_FRACTION, `${name} ${cols}x${rows}: worst non-key step ${(r.worst * 100).toFixed(1)}% at tick ${r.at} (key step ${(r.keyStep * 100).toFixed(1)}%)`);
      assert.ok(r.worst <= HARD_CEILING, 'under the ceiling');
    });
  }
}

// The sizes the contrarian swept (88-130 columns x 39-46 rows) for the slide, in both
// directions, not only the ones the fix was tuned on: a held-out grid (columns 91, 97, ... and rows the cases above never use).
test('flash: the library slide stays at or under 30% a frame (and under 26% with the fix) on a grid of full-tier sizes it was not tuned on', async () => {
  const worst = [];
  for (const h of [39, 40, 42, 46]) {
    for (let w = 91; w <= 130; w += 6) {
      const c = library(w, h);
      try {
        for (const key of [RIGHT, LEFT]) { const r = await watch(c, key, 1.2); worst.push({ at: `${key === RIGHT ? 'right' : 'left'} ${w}x${h}`, v: r.worst }); c.tick(1); }
      } finally { c.app.quit(0); }
    }
  }
  const top = worst.reduce((a, b) => (b.v > a.v ? b : a));
  assert.ok(top.v <= 0.26, `worst slide step ${(top.v * 100).toFixed(1)}% at ${top.at}`);
});

// ---- DRIFT-9 item 4: the clocks. The flows above at 88x39 (the size the slide broke at) with the app stepped by a clock (tests/helpers-clock-app.js): the library slide right and left, then
// Enter on Delza (insert, boot, the menu opening) and eject, each through the file's own watch() and its own limits on the clock's real steps (30 % a step outside the key frame, never over
// 40 %), and the screens read through the flash meter on the viewer's 18 Hz grid and judged by the five 1x rules at their own limits. One q156 arm and one jitter arm, a control per clock
// (the same flow with a white/black strobe in place of the screen, which must fail L1 and L3) and the cost by count.
async function clockSizes(clock, { cols = 88, rows = 39, strobe = false } = {}) {
  const c0 = mkShell({ dirs, cols, rows, startScreen: { screen: 'library' } });
  try {
    c0.app.start();
    c0.tick(2);
    const k = clockedShell(c0, { clock, meter: shownMeter(cols, rows, FPS_APP), cols, rows, strobe });
    const c = k.c;
    const marks = [];
    const take = async (name, key, secs, between) => { const r = await watch(c, key, secs, between); marks.push({ name, ...r }); };
    await take('slide right', RIGHT, 1.2);
    await take('slide left', LEFT, 1.2);
    for (let i = 0; i < 12 && c.sh().cartridge !== 'delza'; i++) await take('cursor to delza', RIGHT, 0.8);
    assert.equal(c.sh().cartridge, 'delza', `${clock.mode}: the cursor reached Delza`);
    await take('insert, boot, menu', '\r', 8, () => c.settle());
    assert.equal(c.sh().screen, 'running', `${clock.mode}: insert and boot ran, the menu is open`);
    await take('eject', 'e', 3);
    assert.equal(c.sh().screen, 'library', `${clock.mode}: ejected`);
    return { marks, rep: k.report() };
  } finally { c0.app.quit(0); }
}
const CLOCKS = [{ mode: 'q156', seed: 1 }, { mode: 'jitter', seed: 3 }];
for (const clock of CLOCKS) {
  test(`flash on the ${clock.mode} clock, 88x39: slides both ways, insert, boot, menu and eject of Delza pass the step rule and the five 1x rules`, async () => {
    const { marks, rep } = await clockArm(() => clockSizes(clock), tickStats);
    for (const m of marks) {
      assert.ok(m.worst <= FLASH_FRACTION, `${clock.mode} 88x39 ${m.name}: worst non-key step ${(m.worst * 100).toFixed(1)}% at tick ${m.at} (key step ${(m.keyStep * 100).toFixed(1)}%)`);
      assert.ok(m.keyStep <= HARD_CEILING, `${clock.mode} 88x39 ${m.name}: key step ${(m.keyStep * 100).toFixed(1)}% is over the ${HARD_CEILING * 100}% ceiling`);
    }
    console.log(`CLOCK STEP ${clock.mode} 88x39: ${marks.map((m) => `${m.name} worst ${(m.worst * 100).toFixed(1)} % key ${(m.keyStep * 100).toFixed(1)} %`).join('; ')} (limits ${FLASH_FRACTION * 100} % and ${HARD_CEILING * 100} %)`);
    judgeX1(rep, `sizes ${clock.mode} 88x39`);
  });
  test(`flash clock control (${clock.mode}): the same flow with a white/black strobe in place of the screen fails L1 and L3, so the arm above can fail`, async () => {
    const kept = tickStats.frames; // the control is not an arm and not one of the file's other arms: it is not counted
    try {
      const { rep } = await clockSizes(clock, { strobe: true });
      const bad = failedRules(rep, { only: X1_RULE_IDS });
      assert.ok(bad.includes('l1.x1') && bad.includes('l3'), `${clock.mode}: the strobe failed ${bad.join(',')}`);
    } finally { tickStats.frames = kept; }
  });
}
test('DRIFT-9 clock arms cost: sizes flash clock arms read at most 15 % of the frames the other arms of this file read (by count)', () => { assertArmCost('sizes flash', undefined, tickStats); });
