// DRIFT-7 C13: the flash meter (createFlashMeter: WCAG luminance, saturated red, field and step rules at 1x and 4x playback) over the Driftman 9000's
// OWN console: the whole insert + boot and the whole eject in a real shell with the installed cartridge, its running scene swapped for a dark one so
// the console is what is measured (the Rosette's own lit dissolve is not the console's doing). Four clock phases (the first tick lands 0, 1/4, 1/2, 3/4
// of a frame into the step) at the three usual sizes and the size just above each layout breakpoint (full 88x39, extra-large 176x58, compact 78x24).
// Held to ABSOLUTE limits, as every shell flow is (DRIFT-7 item 1): every rule (L1, L2, L3, R) at its own limit for insert + boot at 1x AND 4x and for the
// eject at 1x and 4x, at every size, with no exception (DRIFT-7 stage C: the compact screens' L2 at 4x was 27.8 to 29.8 % because the boot lines'
// typed cells sat on the library's blurb cells and were cleared again within the meter's 4 s window; the 9000's skin.json holds the lines 0.5 s longer,
// boot.seconds 2.0 (1.75 until the third menu entry, when the menu list at 80x24 and 78x24 came to overlap the typed lines), which puts the clear outside it), and a constant 10 % headroom pin on L2 (L2_HEADROOM, below).
// The control: the same flow with the brightness of every console cell flipped between black and white on alternate frames must fail the meter.
// A load-proof CPU budget for the hook at 240x67 (a ratio to a calibration loop, with a 3x-slower control) closes the file. TABLE lines print every measured value.
import test from 'node:test';
import { RULE_IDS, ruleOf } from './helpers-flash.js';
import assert from 'node:assert/strict';
import { shownMeter, FLASH_MODE, MODE_NOTE } from './helpers-flash-modes.js';
import { createShell } from '../src/shell/shell.js';
import { discoverCartridges, loadScenes as realLoadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { shelfLayout } from '../src/shell/library.js';
import { sizeTier, newFrame } from '../src/shell/ui.js';
import { flush, DT, FPS, SIZES, hook, RGB_CELL } from './helpers-driftman-console.js';
import { measureRelativeCost } from './helpers-budget.js';

const RULES = RULE_IDS.map((id) => [id, (r) => ruleOf(r, id)]); // the shared list (helpers-flash.js): the brightness and red rules and C (DRIFT-8 C4)
const pc = (x) => (x * 100).toFixed(2);
const showOne = (rep) => `L1 ${pc(rep.l1.x1.worstFraction)}/${pc(rep.l1.x4.worstFraction)} L2 ${pc(rep.l2.x1.worstFraction)}/${pc(rep.l2.x4.worstFraction)} L3 ${pc(rep.l3.worstFraction)} R ${pc(rep.r.x1.worstFraction)}/${pc(rep.r.x4.worstFraction)} C ${pc(rep.c.worstFraction)}`;
// the cell grid (the old reading) and the pixel grid (DRIFT-8 C2)
const show = (rep) => `${showOne(rep.cell)} | pixel ${showOne(rep.pixel)}`;
const PHASES = [0, 0.25, 0.5, 0.75];
const HOST = { persist() {}, quit() {}, leaveToClassic() {} };

// L2 regression pin (DRIFT-7 stage E). The hand-measured per-size ceilings (CEIL_L2) had to be re-measured every time the menu grew by one entry
// (library cells under the console move), so they are gone. What matters is the shell's own absolute L2 limit (25 %), checked below for every flow
// at every size with no exception; on top of that one constant pin that never needs re-measuring: no flow may use more than L2_HEADROOM of the limit
// (22.5 % of 25 %), so a change that eats the last tenth of the margin fails here before it fails the limit. The worst measured value is 21.3 %
// (80x24, insert + boot at 4x, with the third menu entry, the 2.0 s boot hold and the shortened menu hint: see tests/driftman-9000-cartridge.test.js), and the TABLE below prints every value so a drift is visible.
const L2_HEADROOM = 0.9;

// A dark running scene in place of the Rosette (blank cells, palette colour 0), keeping the cartridge's console hook.
const dark = (t, w, h, params) => { params.glyphs.fill(32); params.colours.fill(0); };
dark.id = 'rosette'; dark.kind = 'cells';
const darkLoader = (withHook) => async (cart) => {
  const r = await realLoadScenes(cart);
  const { console: c, ...rest } = r;
  const scenes = r.scenes.map((s) => ({ ...s, rgb: false, scene: dark }));
  return withHook ? { ...rest, scenes, console: c } : { ...rest, scenes };
};

function shell9(cols, rows, withHook) {
  const d = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
  return createShell({
    cols, rows, cartridges: d.cartridges, seed: 1, cmode: FLASH_MODE, host: HOST, loadScenes: darkLoader(withHook),
    consts: { SPEEDS: [1, 2, 3, 4], DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 },
    start: { cartridge: 'driftman-9000' },
  });
}

// Insert + boot (until the running screen, plus one second of it) and, from the same shell, the eject (plus the library after it).
// `filter(frame, k, rect)` is a test-only post-filter on the frames the shell drew (the control).
async function measure(cols, rows, phase, { withHook = true, filter = null } = {}) {
  const sh = shell9(cols, rows, withHook);
  await flush();
  const lay = shelfLayout(cols, rows, sizeTier(cols, rows));
  const full = sizeTier(cols, rows) === 'full';
  const rect = full ? { x: lay.consoleX, y: lay.consoleTop, w: 84, h: 18 } : { x: lay.miniX, y: lay.miniTop, w: 38, h: 4 };
  if (phase > 0) sh.tick(phase * DT);
  const ins = shownMeter(cols, rows, FPS);
  let k = 0;
  const push = (meter) => { const f = sh.frame(); meter.push(filter ? filter(f, k++, rect) : f); };
  let n = 0;
  for (; sh.state().screen !== 'running' && n < 600; n++) { push(ins); sh.tick(DT); }
  assert.ok(n < 600, 'the boot reached the running screen');
  for (let j = 0; j < FPS; j++) { push(ins); sh.tick(DT); }
  const insRep = ins.report();
  sh.key('e');
  const eje = shownMeter(cols, rows, FPS);
  for (let m = 0; sh.state().screen === 'eject' && m < 600; m++) { push(eje); sh.tick(DT); }
  for (let j = 0; j < 6; j++) { push(eje); sh.tick(DT); }
  return { ins: insRep, eje: eje.report() };
}

const TABLE = [];
const WORST = new Map(); // size -> [insert 1x, insert 4x, eject 1x] worst L2 fractions over the phases

for (const [cols, rows] of SIZES) {
  test(`9000 console flash${MODE_NOTE} ${cols}x${rows}: insert + boot (1x and 4x) and eject, at four clock phases, pass every rule (L1, L2, L3, R) and keep 10 % headroom on the L2 limit`, async () => {
    const key = `${cols}x${rows}`;
    const bad = [];
    for (const phase of PHASES) {
      const m = await measure(cols, rows, phase);
      TABLE.push(key.padEnd(8) + `phase ${phase * 4}/4 insert+boot ` + show(m.ins) + ' | eject ' + show(m.eje));
      const w = WORST.get(key) || [0, 0, 0];
      w[0] = Math.max(w[0], m.ins.l2.x1.worstFraction); w[1] = Math.max(w[1], m.ins.l2.x4.worstFraction); w[2] = Math.max(w[2], m.eje.l2.x1.worstFraction);
      WORST.set(key, w);
      // every rule at its own, absolute limit (the shell's global one), at every size, for insert + boot and for the eject
      for (const [flow, rep] of [['insert+boot', m.ins], ['eject', m.eje]]) {
        for (const [name, get] of RULES) {
          const r = get(rep);
          if (!r.pass) bad.push(`phase ${phase * 4}/4 ${flow} ${name}: ${pc(r.worstFraction)}% is over ${pc(r.limit)}%`);
        }
      }
      for (const [flow, rep] of [['insert+boot', m.ins], ['eject', m.eje]]) {
        for (const [name, get] of [['l2.x1', (r) => r.l2.x1], ['l2.x4', (r) => r.l2.x4]]) {
          const r = get(rep);
          if (r.worstFraction > r.limit * L2_HEADROOM) bad.push(`phase ${phase * 4}/4 ${flow} ${name}: ${pc(r.worstFraction)}% is over ${pc(r.limit * L2_HEADROOM)}% (${L2_HEADROOM} of the limit)`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });
}

test(`9000 console flash TABLE${MODE_NOTE}: every measured value, and the worst L2 per size over the four phases`, () => {
  console.log([`TABLE 9000 console flash meter${MODE_NOTE} (x1/x4; limits L1 25, L2 25, L3 30, R 25; cell grid | pixel grid)`, ...TABLE.map((l) => '  ' + l)].join('\n'));
  console.log('WORST L2 over four phases [insert+boot 1x, insert+boot 4x, eject 1x] (%): ' + [...WORST].map(([k, w]) => `${k} ${w.map((x) => pc(x)).join('/')}`).join(', '));
  assert.ok(TABLE.length === 0 || TABLE.length === SIZES.length * PHASES.length);
});

// ---- the control: the meter bites on this path

test(`9000 console flash control${MODE_NOTE}: the same flow with every console cell flipped between black and white on alternate frames fails the meter (120x40 and 80x24)`, async () => {
  const flip = (f, k, r) => {
    const g = { glyphs: f.glyphs.slice(), shades: f.shades.slice(), fg: f.fg ? f.fg.slice() : new Uint32Array(f.glyphs.length), bg: f.bg ? f.bg.slice() : new Uint32Array(f.glyphs.length), palette: f.palette, cols: f.cols, rows: f.rows };
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * f.cols + x;
        if (g.glyphs[i] === 32 && g.shades[i] === 0) continue;
        g.shades[i] = RGB_CELL; g.fg[i] = k % 2 ? 0xFFFFFF : 0x000000; g.bg[i] = k % 2 ? 0x808080 : 0x000000;
      }
    }
    return g;
  };
  for (const [cols, rows] of [[120, 40], [80, 24]]) {
    const ok = await measure(cols, rows, 0);
    const bad = await measure(cols, rows, 0, { filter: flip });
    assert.equal(ok.ins.pass, true, `${cols}x${rows}: the real flow passes: ${show(ok.ins)}`);
    assert.equal(bad.ins.pass, false, `${cols}x${rows}: the flipped flow fails the meter: ${show(bad.ins)}`);
    assert.ok(bad.ins.l1.x1.worstFraction > ok.ins.l1.x1.worstFraction + 0.05 || bad.ins.l2.x1.worstFraction > ok.ins.l2.x1.worstFraction + 0.05, show(bad.ins));
  }
});

// ---- CPU: the hook's own cost per call, at the biggest size
// DRIFT-7 stage E: a millisecond bound on a mean wall time read 0.064 ms under the whole `npm test` (0.016 alone), so it was a broken gate. The cost is
// now measured as measureRelativeCost does it (tests/helpers-budget.js): the quietest of 300 identical batches of 8 calls, divided by a calibration
// loop timed in the same moment. The ratio does not move with the load of the machine (1.0 to 1.3 alone and under 100 busy processes, up to 1.55 inside the whole suite) and moves in
// proportion with the work (a hook that costs 3x as much reads 3.1 to 4.4; a hook 2.8x slower, planted for real, read 3.6).
const RATIO_BOUND = 2.25;
const cpuCase = (draw) => {
  const rect = { x: 78, y: 20, w: 84, h: 18 };
  const screen = { x: rect.x + 3, y: rect.y + 4, w: 46, h: 9 };
  const f = newFrame(240, 67);
  // a mixture of what the shell calls: the insert's morph, the boot's fan, the awake machine at rest, the eject's fold
  const call = (k) => {
    const m = k % 4;
    if (m === 0) return { phase: 'insert', p: 0.55 * ((k % 9) / 9), t: 1.0 + (k % 9) / 18 };
    if (m === 1) return { phase: 'boot', p: 0.55 + 0.45 * ((k % 8) / 8), t: (k % 8) / 18 };
    if (m === 2) return { phase: 'boot', p: 1, t: 1.7 + k / 18 };
    return { phase: 'eject', p: 0.55 * ((k % 9) / 9), t: 1.0 + (k % 9) / 18 };
  };
  const ctxs = [];
  for (let k = 0; k < 8; k++) ctxs.push({ ...call(k + 18), rect, screen, tier: 'full' });
  return measureRelativeCost(() => { for (let k = 0; k < 8; k++) draw(f, ctxs[k]); }, { calls: 8 });
};

if (FLASH_MODE === 'truecolor') test('9000 console CPU: drawConsole at 240x67 costs under 2.25x a calibration loop timed in the same moment (quietest of 1500 batches of 8 calls)', () => {
  const m = cpuCase((f, c) => hook.drawConsole(f, c));
  console.log(`CPU drawConsole at 240x67: ${m.msPerCall.toFixed(4)} ms per call, calibration ${m.calibMs.toFixed(4)} ms, ratio ${m.ratio.toFixed(3)} (bound ${RATIO_BOUND})`);
  assert.ok(m.ratio < RATIO_BOUND, `ratio ${m.ratio.toFixed(3)} (${m.msPerCall} ms per call) is over ${RATIO_BOUND}`);
});

if (FLASH_MODE === 'truecolor') test('9000 console CPU control: a hook that does the same work three times per call (3x slower) FAILS the bound', () => {
  const m = cpuCase((f, c) => { hook.drawConsole(f, c); hook.drawConsole(f, c); hook.drawConsole(f, c); });
  console.log(`CPU control (3x): ratio ${m.ratio.toFixed(3)}`);
  assert.ok(m.ratio >= RATIO_BOUND, `the 3x hook reads ${m.ratio.toFixed(3)}, under the bound ${RATIO_BOUND}: the gate no longer bites`);
});
