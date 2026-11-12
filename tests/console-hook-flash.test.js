// DRIFT-7 C11: the flash meter (createFlashMeter, WCAG luminance, red, field and step rules at 1x and 4x playback) over the WHOLE insert + boot and
// the WHOLE eject of a cartridge with a console hook. The old changed-cell count (30%) is blind to full-colour frames; this meter is not.
// The running scene is a dark one (all blank), so the console is what is measured. Fixtures (helpers-console-hook.js):
//   calm   a plausible real hook: line glyphs go from the console's graphite to a teal of EXACTLY the same luminance; lightness held, hue only
//   harsh  a lit console: lines graphite -> bright amber (Y 0.12 to 0.63) and an opaque panel background (Y 0.006 to 0.037); lightness moves
//   strobe a must-fail control: black and white every frame
// Sizes: the three usual ones and the size just above each layout breakpoint (full 88x39, extra-large 176x58, compact 78x24).
//
// What can and cannot pass. The STANDARD flow (the same cartridge with no hook) already goes over the L2 rule at the compact sizes (80x24, 78x24)
// and at 88x39 at 4x, in the insert: it is the cartridge sprite lifting, sliding and dropping through the slot (insert-only L2 40.3% at 80x24, 22.6%
// at 88x39, 18.9% at 120x40; the boot alone is under 7%). That is not the hook and C11 does not fix it. So each rule is held like this:
//   - where the standard flow passes the rule, the hooked flow must pass it too, at the rule's own limit (nothing is loosened);
//   - where the standard flow is already over, the hooked flow may not be worse than it (by half a point).
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
const pc = (x) => (x * 100).toFixed(1);
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

function heldAgainstBaseline(flow, rep, base, label, bad) {
  for (const [name, get] of RULES) {
    const r = get(rep), b = get(base);
    if (b.pass) { if (!r.pass) bad.push(`${label} ${flow} ${name}: ${pc(r.worstFraction)}% is over ${pc(r.limit)}% (the standard flow passes at ${pc(b.worstFraction)}%)`); } else if (r.worstFraction > b.worstFraction + 0.005) bad.push(`${label} ${flow} ${name}: ${pc(r.worstFraction)}% is worse than the standard flow's ${pc(b.worstFraction)}%`);
  }
}

const TABLE = [];
for (const [cols, rows] of SIZES) {
  test(`flash ${cols}x${rows}: the calm and the harsh hook, over the whole insert + boot and the whole eject, at 1x and 4x, are no worse than the standard flow (and pass wherever it does); the strobe control fails`, async () => {
    const base = await measure(recorderHookSource(), cols, rows, noHook);
    const calm = await measure(calmHookSource(), cols, rows);
    const harsh = await measure(harshHookSource(), cols, rows);
    const strobe = await measure(strobeHookSource(), cols, rows);
    TABLE.push(`${cols}x${rows}`.padEnd(8) + 'standard  insert+boot ' + show(base.ins) + ' | eject ' + show(base.eje));
    for (const [name, m] of [['calm', calm], ['harsh', harsh], ['strobe', strobe]]) TABLE.push(`${cols}x${rows}`.padEnd(8) + name.padEnd(9) + ' insert+boot ' + show(m.ins) + ' | eject ' + show(m.eje));
    const bad = [];
    for (const [label, m] of [['calm', calm], ['harsh', harsh]]) {
      heldAgainstBaseline('insert+boot', m.ins, base.ins, label, bad);
      heldAgainstBaseline('eject', m.eje, base.eje, label, bad);
    }
    assert.deepEqual(bad, []);
    // L1, L3 and R pass for the hooked flows at every size, with no exception (the standard flow's only excess is L2)
    for (const m of [calm, harsh]) for (const rep of [m.ins, m.eje]) for (const [name, get] of RULES) if (!name.startsWith('l2')) assert.ok(get(rep).pass, `${cols}x${rows} ${name} ${pc(get(rep).worstFraction)}%`);
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
