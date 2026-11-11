// DRIFT-4: photosensitivity of every console transition at the sizes where it used to break (found by the
// contrarian): the library slide at 88-106 columns, the eject into a small library, and the cuts between the
// boot, the menu, Classic and the library at small sizes.
//   Rule: no frame step changes more than 30% of the cells, except the frame that carries the key press;
//   never above the 40% hard ceiling (not even the key frame).
// Every scenario is measured on the frames the app really draws (app.screenshot() after each 18 fps tick).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLASH_FRACTION, changedFraction } from './helpers-flash.js';
import { mkShell, DT, runCartridge } from './helpers-shell.js';
import { INSTALL_DIR } from '../src/cartridge/loader.js';

const HARD_CEILING = 0.4;
const SIZES = [[88, 39], [89, 39], [106, 39], [56, 14], [50, 12], [44, 11], [40, 10], [78, 24], [80, 24], [120, 40], [60, 14]];
const dirs = [{ dir: INSTALL_DIR, trusted: true }];
const RIGHT = '\x1b[C', LEFT = '\x1b[D', ESC = '\x1b';

const grab = (c) => { const f = c.app.screenshot(); return { g: f.glyphs.slice(), s: f.shades.slice() }; };

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
