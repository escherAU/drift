// DRIFT-7 C13: the flash meter (createFlashMeter: WCAG luminance, saturated red, field and step rules at 1x and 4x playback) over the Driftman 9000's
// OWN console: the whole insert + boot and the whole eject in a real shell with the installed cartridge, its running scene swapped for a dark one so
// the console is what is measured (the Rosette's own lit dissolve is not the console's doing). Four clock phases (the first tick lands 0, 1/4, 1/2, 3/4
// of a frame into the step) at the three usual sizes and the size just above each layout breakpoint (full 88x39, extra-large 176x58, compact 78x24).
// Held to ABSOLUTE limits, as every shell flow is (DRIFT-7 item 1): every rule (L1, L2, L3, R) at its own limit for insert + boot at 1x AND 4x and for the
// eject at 1x and 4x, EXCEPT a rule the same flow fails with the hook switched off (L2 at 4x at 80x24 and 78x24: the 9000's six boot lines, not its
// console; the hooked flow equals the no-hook value there and may not exceed it), and a per-size ceiling on L2 (CEIL_L2: the largest value measured over the four phases, plus a hair, to the next
// tenth of a point). The eject at 4x gets no L2 ceiling: playback speed reaches only the scene clock, so the shell's eject is a 1x condition.
// The control: the same flow with the brightness of every console cell flipped between black and white on alternate frames must fail the meter.
// A CPU budget for the hook at 240x67 closes the file. TABLE lines print every measured value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlashMeter } from './helpers-flash.js';
import { createShell } from '../src/shell/shell.js';
import { discoverCartridges, loadScenes as realLoadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { shelfLayout } from '../src/shell/library.js';
import { sizeTier, newFrame } from '../src/shell/ui.js';
import { flush, DT, FPS, SIZES, hook, RGB_CELL } from './helpers-driftman-console.js';

const RULES = [['l1.x1', (r) => r.l1.x1], ['l1.x4', (r) => r.l1.x4], ['l2.x1', (r) => r.l2.x1], ['l2.x4', (r) => r.l2.x4], ['l3', (r) => r.l3], ['r.x1', (r) => r.r.x1], ['r.x4', (r) => r.r.x4]];
const pc = (x) => (x * 100).toFixed(2);
const show = (rep) => `L1 ${pc(rep.l1.x1.worstFraction)}/${pc(rep.l1.x4.worstFraction)} L2 ${pc(rep.l2.x1.worstFraction)}/${pc(rep.l2.x4.worstFraction)} L3 ${pc(rep.l3.worstFraction)} R ${pc(rep.r.x1.worstFraction)}/${pc(rep.r.x4.worstFraction)}`;
const PHASES = [0, 0.25, 0.5, 0.75];
const HOST = { persist() {}, quit() {}, leaveToClassic() {} };

// L2 ceilings (fractions) per size: [insert+boot 1x, insert+boot 4x, eject 1x]. See the TABLE of measured values.
const CEIL_L2 = { // the largest measured over the four phases, rounded up to the next tenth of a point
  '120x40': [0.001, 0.088, 0.015], '80x24': [0.001, 0.292, 0.033], '240x67': [0.001, 0.033, 0.004], '88x39': [0.003, 0.124, 0.018], '176x58': [0.001, 0.050, 0.004], '78x24': [0.001, 0.299, 0.034],
};

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
    cols, rows, cartridges: d.cartridges, seed: 1, cmode: 'truecolor', host: HOST, loadScenes: darkLoader(withHook),
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
  const ins = createFlashMeter(cols, rows, FPS);
  let k = 0;
  const push = (meter) => { const f = sh.frame(); meter.push(filter ? filter(f, k++, rect) : f); };
  let n = 0;
  for (; sh.state().screen !== 'running' && n < 600; n++) { push(ins); sh.tick(DT); }
  assert.ok(n < 600, 'the boot reached the running screen');
  for (let j = 0; j < FPS; j++) { push(ins); sh.tick(DT); }
  const insRep = ins.report();
  sh.key('e');
  const eje = createFlashMeter(cols, rows, FPS);
  for (let m = 0; sh.state().screen === 'eject' && m < 600; m++) { push(eje); sh.tick(DT); }
  for (let j = 0; j < 6; j++) { push(eje); sh.tick(DT); }
  return { ins: insRep, eje: eje.report() };
}

const TABLE = [];
const WORST = new Map(); // size -> [insert 1x, insert 4x, eject 1x] worst L2 fractions over the phases
const KNOWN = []; // rules the 9000's flow fails with its hook OFF as well (not the console's doing)

for (const [cols, rows] of SIZES) {
  test(`9000 console flash ${cols}x${rows}: insert + boot (1x and 4x) and eject, at four clock phases, pass every rule (L1, L2, L3, R) and sit under the L2 ceilings`, async () => {
    const key = `${cols}x${rows}`;
    const bad = [];
    for (const phase of PHASES) {
      const m = await measure(cols, rows, phase);
      TABLE.push(key.padEnd(8) + `phase ${phase * 4}/4 insert+boot ` + show(m.ins) + ' | eject ' + show(m.eje));
      // the same cartridge with its hook switched off: the shell's own insert, boot and eject at this phase (what the console is compared with)
      const b = await measure(cols, rows, phase, { withHook: false });
      TABLE.push(key.padEnd(8) + `phase ${phase * 4}/4 NO HOOK     ` + show(b.ins) + ' | eject ' + show(b.eje));
      const w = WORST.get(key) || [0, 0, 0];
      w[0] = Math.max(w[0], m.ins.l2.x1.worstFraction); w[1] = Math.max(w[1], m.ins.l2.x4.worstFraction); w[2] = Math.max(w[2], m.eje.l2.x1.worstFraction);
      WORST.set(key, w);
      for (const [flow, rep, base] of [['insert+boot', m.ins, b.ins], ['eject', m.eje, b.eje]]) {
        for (const [name, get] of RULES) {
          const r = get(rep), r0 = get(base);
          if (r.pass) continue;
          // a rule the 9000's flow fails with its hook switched off (the boot screen's own text, see KNOWN) may not get worse with the hook on
          if (!r0.pass && r.worstFraction <= r0.worstFraction + 0.001) { KNOWN.push(`${key} phase ${phase * 4}/4 ${flow} ${name}: ${pc(r.worstFraction)}% (no hook ${pc(r0.worstFraction)}%) over ${pc(r.limit)}%`); continue; }
          bad.push(`phase ${phase * 4}/4 ${flow} ${name}: ${pc(r.worstFraction)}% is over ${pc(r.limit)}% (no hook ${pc(r0.worstFraction)}%)`);
        }
      }
      const [i1, i4, e1] = CEIL_L2[key];
      if (m.ins.l2.x1.worstFraction > i1) bad.push(`phase ${phase * 4}/4 insert+boot l2.x1 ${pc(m.ins.l2.x1.worstFraction)}% over its ceiling ${pc(i1)}%`);
      if (m.ins.l2.x4.worstFraction > i4) bad.push(`phase ${phase * 4}/4 insert+boot l2.x4 ${pc(m.ins.l2.x4.worstFraction)}% over its ceiling ${pc(i4)}%`);
      if (m.eje.l2.x1.worstFraction > e1) bad.push(`phase ${phase * 4}/4 eject l2.x1 ${pc(m.eje.l2.x1.worstFraction)}% over its ceiling ${pc(e1)}%`);
    }
    assert.deepEqual(bad, []);
  });
}

test('9000 console flash TABLE: every measured value, and the worst L2 per size over the four phases', () => {
  console.log(['TABLE 9000 console flash meter (x1/x4; limits L1 25, L2 25, L3 30, R 25)', ...TABLE.map((l) => '  ' + l)].join('\n'));
  console.log('WORST L2 over four phases [insert+boot 1x, insert+boot 4x, eject 1x] (%): ' + [...WORST].map(([k, w]) => `${k} ${w.map((x) => pc(x)).join('/')}`).join(', '));
  console.log(['KNOWN (fail with the hook off too, the hook no worse):', ...KNOWN.map((l) => '  ' + l)].join('\n'));
  assert.ok(TABLE.length === 0 || TABLE.length === SIZES.length * PHASES.length * 2);
});

// ---- the control: the meter bites on this path

test('9000 console flash control: the same flow with every console cell flipped between black and white on alternate frames fails the meter (120x40 and 80x24)', async () => {
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
    if (cols > 100) assert.equal(ok.ins.pass, true, `${cols}x${rows}: the real flow passes`); // (80x24 fails L2 at 4x with or without the hook, see KNOWN)
    assert.equal(bad.ins.pass, false, `${cols}x${rows}: the flipped flow fails the meter: ${show(bad.ins)}`);
    assert.ok(bad.ins.l1.x1.worstFraction > ok.ins.l1.x1.worstFraction + 0.05 || bad.ins.l2.x1.worstFraction > ok.ins.l2.x1.worstFraction + 0.05, show(bad.ins));
  }
});

// ---- CPU: the hook's own cost per call, at the biggest size

test('9000 console CPU: mean ms per drawConsole call at 240x67 (180 calls after 18 warm-up, best of 3) stays under the bound', () => {
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
  const run = () => {
    for (let k = 0; k < 18; k++) hook.drawConsole(f, { ...call(k), rect, screen, tier: 'full' });
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < 180; k++) hook.drawConsole(f, { ...call(k + 18), rect, screen, tier: 'full' });
    return Number(process.hrtime.bigint() - t0) / 1e6 / 180;
  };
  const best = Math.min(run(), run(), run());
  console.log(`CPU drawConsole at 240x67: best-of-3 mean ${best.toFixed(4)} ms per call`);
  assert.ok(best < CPU_BOUND_MS, `${best} ms per call is over ${CPU_BOUND_MS}`);
});
// measured 0.0152 to 0.0163 ms per call over six isolated runs (best of 3 each); the bound is about 3x the worst: 0.05 ms
const CPU_BOUND_MS = 0.05;
