// DRIFT-7 C11: the flash meter (createFlashMeter, WCAG luminance, red, field and step rules at 1x and 4x playback) over the WHOLE insert + boot and
// the WHOLE eject of a cartridge with a console hook. The old changed-cell count (30%) is blind to full-colour frames; this meter is not.
// The running scene is a dark one (all blank), so the console is what is measured. Fixtures (helpers-console-hook.js):
//   calm   a plausible real hook: line glyphs go from the console's graphite to a teal of EXACTLY the same luminance; lightness held, hue only
//   harsh  a lit console: lines graphite -> bright amber (Y 0.12 to 0.63) and an opaque panel background (Y 0.006 to 0.037); lightness moves
//   strobe a must-fail control: black and white every frame
// Sizes: the three usual ones and the size just above each layout breakpoint (full 88x39, extra-large 176x58, compact 78x24).
//
// What is held (DRIFT-7 item 1). The insert's step 3 is a dissolve now (before it, the cartridge sprite dropping through the slot
// striped the picture and put the STANDARD flow over the L2 rule at the compact sizes), so every flow is held to ABSOLUTE limits and
// no longer to "no worse than the standard flow":
//   - every rule (L1, L2, L3, R) at the rule's own limit, for insert + boot at 1x AND 4x, and for the eject at 1x and 4x as they pass today;
//   - a tighter ceiling on L2 per size (CEIL_L2: the largest of the calm and harsh hooks' measured values, rounded up to the next
//     tenth of a point), for insert + boot at 1x and 4x and for the eject at 1x. The eject at 4x gets no ceiling: playback speed
//     reaches only the scene clock, so the shell's eject is a 1x condition (see tests/shell-eject-fade.test.js).
// The standard flow (the same cartridge with no hook) is still measured: it is the control the strobe is compared with.
// TABLE lines print every measured value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlashMeter } from './helpers-flash.js';
import { loadScenes as realLoadScenes } from '../src/cartridge/loader.js';
import { shelfLayout } from '../src/shell/library.js';
import { sizeTier } from '../src/shell/ui.js';
import { insertedShell, calmHookSource, harshHookSource, strobeHookSource, recorderHookSource, flush, DT, SIZES } from './helpers-console-hook.js';

const FPS = 18;
const noHook = async (cart) => { const r = await realLoadScenes(cart); const { console: _c, ...rest } = r; return rest; };
const RULES = [['l1.x1', (r) => r.l1.x1], ['l1.x4', (r) => r.l1.x4], ['l2.x1', (r) => r.l2.x1], ['l2.x4', (r) => r.l2.x4], ['l3', (r) => r.l3], ['r.x1', (r) => r.r.x1], ['r.x4', (r) => r.r.x4]];
const pc = (x) => (x * 100).toFixed(2);
// L2 ceilings (fractions) per size: [insert+boot 1x, insert+boot 4x, eject 1x]
const CEIL_L2 = { // percentages / 100; the largest measured (standard, calm, harsh) plus a hair, to the next tenth of a point
  '120x40': [0.012, 0.081, 0.006], '80x24': [0.006, 0.121, 0.006], '240x67': [0.004, 0.020, 0.003], '88x39': [0.016, 0.106, 0.014], '176x58': [0.006, 0.031, 0.003], '78x24': [0.006, 0.131, 0.006],
};
const show = (rep) => `L1 ${pc(rep.l1.x1.worstFraction)}/${pc(rep.l1.x4.worstFraction)} L2 ${pc(rep.l2.x1.worstFraction)}/${pc(rep.l2.x4.worstFraction)} L3 ${pc(rep.l3.worstFraction)} R ${pc(rep.r.x1.worstFraction)}/${pc(rep.r.x4.worstFraction)}`;

// Insert + boot (until the running screen, plus one second of it) and, from the same shell, the eject (plus the library after it).
// -> { ins, eje, y: { first, last } } (y = the luminance of one line cell of the console at its first and last hooked frame)
async function measure(source, cols, rows, loadScenes) {
  const { sh } = insertedShell(cols, rows, { source, ...(loadScenes ? { loadScenes } : {}) });
  await flush();
  const full = sizeTier(cols, rows) === 'full';
  const lay = shelfLayout(cols, rows, sizeTier(cols, rows));
  const ins = createFlashMeter(cols, rows, FPS);
  const y = { first: null, last: null, at: -1 };
  for (let k = 0, n = 0; sh.state().screen !== 'running' && n++ < 600; k++) {
    const f = sh.frame();
    ins.push(f);
    if (y.at < 0 && f.shades.includes(255) && sh.state().screen === 'insert') {
      // a left-border cell of the console frame: column 0 of the console, 5 rows down (full) or 2 rows down (mini)
      y.at = ((full ? lay.consoleTop + 5 : lay.miniTop + 2)) * cols + (full ? lay.consoleX : lay.miniX);
      y.first = ins.cellY(y.at);
    }
    if (y.at >= 0 && sh.state().screen === 'boot' && f.shades[y.at] === 255) y.last = ins.cellY(y.at);
    sh.tick(DT);
  }
  for (let k = 0; k < FPS; k++) { ins.push(sh.frame()); sh.tick(DT); }
  const insRep = ins.report();
  sh.key('e');
  const eje = createFlashMeter(cols, rows, FPS);
  for (let n = 0; sh.state().screen === 'eject' && n < 600; n++) { eje.push(sh.frame()); sh.tick(DT); }
  for (let k = 0; k < 6; k++) { eje.push(sh.frame()); sh.tick(DT); }
  return { ins: insRep, eje: eje.report(), y };
}

function heldAbsolute(flow, rep, label, bad, cols, rows) {
  for (const [name, get] of RULES) {
    const r = get(rep);
    if (!r.pass) bad.push(`${label} ${flow} ${name}: ${pc(r.worstFraction)}% is over ${pc(r.limit)}%`);
  }
  const [i1, i4, e1] = CEIL_L2[`${cols}x${rows}`];
  const checks = flow === 'insert+boot' ? [['l2.x1', rep.l2.x1, i1], ['l2.x4', rep.l2.x4, i4]] : [['l2.x1', rep.l2.x1, e1]];
  for (const [name, r, ceil] of checks) if (r.worstFraction > ceil) bad.push(`${label} ${flow} ${name}: ${pc(r.worstFraction)}% is over its ceiling ${pc(ceil)}%`);
}

const TABLE = [];
for (const [cols, rows] of SIZES) {
  test(`flash ${cols}x${rows}: the calm and the harsh hook, over the whole insert + boot and the whole eject, at 1x and 4x, pass every rule and sit under the absolute L2 ceilings; the strobe control fails`, async () => {
    const base = await measure(recorderHookSource(), cols, rows, noHook);
    const calm = await measure(calmHookSource(), cols, rows);
    const harsh = await measure(harshHookSource(), cols, rows);
    const strobe = await measure(strobeHookSource(), cols, rows);
    TABLE.push(`${cols}x${rows}`.padEnd(8) + 'standard  insert+boot ' + show(base.ins) + ' | eject ' + show(base.eje));
    for (const [name, m] of [['calm', calm], ['harsh', harsh], ['strobe', strobe]]) TABLE.push(`${cols}x${rows}`.padEnd(8) + name.padEnd(9) + ' insert+boot ' + show(m.ins) + ' | eject ' + show(m.eje));
    const bad = [];
    for (const [label, m] of [['calm', calm], ['harsh', harsh]]) {
      heldAbsolute('insert+boot', m.ins, label, bad, cols, rows);
      heldAbsolute('eject', m.eje, label, bad, cols, rows);
    }
    // the standard flow passes too, at the rule's own limits (the same absolute hold, no hook)
    heldAbsolute('insert+boot', base.ins, 'standard', bad, cols, rows);
    heldAbsolute('eject', base.eje, 'standard', bad, cols, rows);
    assert.deepEqual(bad, []);
    // the fixtures are what they say: the calm hook holds the luminance of its lines, the harsh one moves it a long way
    assert.ok(Math.abs(calm.y.last - calm.y.first) < 0.005, `calm: a line cell's Y ${calm.y.first} -> ${calm.y.last}`);
    assert.ok(harsh.y.last - harsh.y.first > 0.15, `harsh: a line cell's Y ${harsh.y.first} -> ${harsh.y.last}`);
    // the control: the meter bites on this path. A strobing console is worse than the standard flow on L1 or L2 by 5 points or more, in both flows
    for (const [flow, s, b] of [['insert+boot', strobe.ins, base.ins], ['eject', strobe.eje, base.eje]]) {
      const gap = Math.max(s.l1.x1.worstFraction - b.l1.x1.worstFraction, s.l2.x1.worstFraction - b.l2.x1.worstFraction);
      assert.ok(gap >= 0.05, `${cols}x${rows} strobe ${flow}: only ${pc(gap)} points worse than the standard flow`);
      assert.equal(s.pass, false, `${cols}x${rows} strobe ${flow} fails the meter`);
    }
  });
}

test('flash TABLE: every measured value (standard flow, calm, harsh, strobe) at the six sizes', () => {
  console.log(['TABLE console hook flash meter (x1/x4; limits L1 25, L2 25, L3 30, R 25)', ...TABLE.map((l) => '  ' + l)].join('\n'));
  assert.ok(TABLE.length === 0 || TABLE.length === SIZES.length * 4);
});
