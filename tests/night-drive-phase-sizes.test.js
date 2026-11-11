// DRIFT-5: Night Drive's phase rules (tests/night-drive-phase.test.js) at the sizes that suite does not run.
//
// The phase suite runs every scene at 120x40, 80x24 and each LAYOUTS breakpoint only. Here the same rules (phaseRun is copied, not imported, so that
// suite stays untouched) run at one column or row either side of the 100x32 and 60x18 breakpoints and at a small window:
//   - redlight and overdrive (sims): 99x32, 101x33, 100x31, 59x18, 61x19, 41x12, speeds 1 to 4, clock phases 0, 0.25, 0.5, 0.75, the full 90 s
//   - the six cells scenes: 99x32, 101x33, 100x31, 41x24, speeds 4 and 3, all four phases, their whole length on the tape (90 s, the caller 75 s)
// Rules, as in the phase suite: no cell that keeps a non-blank glyph moves more than one shade step (28 L*), none changes colour family, and the
// worst frame changes STRICTLY under 30% of the cells. Cells scenes take the phase through params.t0; sims go through the cell composer.
// Why: a size-dependent defect (the downpour's slot count, a layout edge) shows only at a clock phase that lines up with it, and the older suite
// never visits these sizes. Two controls (a quick dip that jumps only at an off-grid phase) show the check bites, in cut-down form.
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCartridges, loadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { createCellComposer } from '../src/cells.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { FAMILIES, MAG } from '../cartridges/night-drive/lib/palette.js';
import { FLASH_FRACTION, lstarTable, SHADE_STEP_LSTAR } from './helpers-flash.js';

const FPS = 18;
const PHASES = [0, 0.25, 0.5, 0.75];
const cart = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.find((c) => c.id === 'night-drive');
assert.ok(cart, 'night-drive is on the shelf');
const loaded = await loadScenes(cart);
assert.deepEqual(loaded.errors, []);
const SCENES = loaded.scenes;
const byId = (id) => SCENES.find((s) => s.id === id);
const TAPE = cart.manifest.programs.find((p) => p.id === cart.manifest.start) || cart.manifest.programs[0];
const holdOf = (id) => (TAPE.seconds && TAPE.seconds[id]) ?? TAPE.sceneSeconds;
const LTAB = lstarTable(makeSkinPalette(cart.skin, 'truecolor', 'night-drive'));
const FAM = new Map();
for (const [name, f] of Object.entries(FAMILIES)) f.forEach((c, s) => FAM.set(c, [name, s]));
const pct = (x) => (x * 100).toFixed(2) + '%';

// Copied from tests/night-drive-phase.test.js. One run. Returns { ramp, family, step, worst, at, first } over every consecutive pair.
function phaseRun(s, w, h, speed, phase, seconds = holdOf(s.id)) {
  const step = speed / FPS;
  const n = w * h;
  const out = { ramp: 0, family: 0, step: 0, worst: 0, at: 0, first: null };
  let pg = null, pc = null;
  const sim = s.kind === 'sim';
  const cc = sim ? createCellComposer({ scenes: [s.scene], cols: w, rows: h, seed: 1 }) : null;
  const gb = new Uint16Array(n), cb = new Uint8Array(n);
  const params = { seed: 1, glyphs: gb, colours: cb, t0: -phase * step };
  const draw = (t) => {
    if (sim) { const f = cc.frame({ a: 0, b: 0, p: 0 }, t); return [f.glyphs, f.shades]; }
    s.scene(t, w, h, params);
    return [gb, cb];
  };
  const see = (g, c, t) => {
    if (pg) {
      let changed = 0;
      for (let i = 0; i < n; i++) {
        if (g[i] === pg[i] && c[i] === pc[i]) continue;
        changed++;
        if (g[i] !== pg[i] || g[i] === 32) continue;
        const fa = FAM.get(pc[i]), fb = FAM.get(c[i]);
        let why = null;
        if (Math.abs(LTAB[c[i]] - LTAB[pc[i]]) > SHADE_STEP_LSTAR) { out.ramp++; why = 'brightness'; }
        if (fa && fb) {
          if (fa[0] !== fb[0]) { out.family++; why = why || 'family'; }
          else if (Math.abs(fa[1] - fb[1]) !== 1) { out.step++; why = why || 'shade step'; }
        }
        if (why && !out.first) out.first = { t: +t.toFixed(3), x: i % w, y: Math.floor(i / w), from: pc[i], to: c[i], why };
      }
      const share = changed / n;
      if (share > out.worst) { out.worst = share; out.at = t; }
    } else { pg = new Uint16Array(n); pc = new Uint8Array(n); }
    pg.set(g); pc.set(c);
  };
  if (sim && phase > 0) { const [g, c] = draw(0); see(g, c, 0); }
  const total = Math.ceil(seconds / step);
  for (let k = 0; k <= total; k++) {
    const t = sim ? (phase + k) * step : k * step;
    const [g, c] = draw(t);
    see(g, c, t);
  }
  return out;
}

const tag = (s, w, h, speed, phase) => `${s.id} ${w}x${h} ${speed}x phase ${phase}`;
function sweep(ids, sizes, speeds) {
  const bad = [], worstBy = {};
  let runs = 0;
  for (const id of ids) {
    const s = byId(id);
    for (const [w, h] of sizes) for (const speed of speeds) for (const phase of PHASES) {
      const r = phaseRun(s, w, h, speed, phase);
      runs++;
      if (!worstBy[id] || r.worst > worstBy[id].worst) worstBy[id] = { worst: r.worst, at: tag(s, w, h, speed, phase) };
      if (r.ramp || r.family || r.step) bad.push(`${tag(s, w, h, speed, phase)}: ${r.ramp} brightness, ${r.family} family, ${r.step} shade-step jumps, first ${JSON.stringify(r.first)}`);
      if (!(r.worst < FLASH_FRACTION)) bad.push(`${tag(s, w, h, speed, phase)}: worst share ${pct(r.worst)} at ${r.at.toFixed(2)} s`);
    }
  }
  return { bad, worstBy, runs };
}
const report = (title, r) => console.log(`TABLE ${title} (${r.runs} runs)\n  ` + Object.entries(r.worstBy).map(([id, v]) => `${id} worst share ${pct(v.worst)} (${v.at})`).join('\n  '));

test('phase sizes: redlight and overdrive at 99x32, 101x33, 100x31, 59x18, 61x19, 41x12, speeds 1 to 4, phases 0 to 0.75, 90 s - no ramp, family or shade-step jump, worst frame under 30%', () => {
  const r = sweep(['redlight', 'overdrive'], [[99, 32], [101, 33], [100, 31], [59, 18], [61, 19], [41, 12]], [1, 2, 3, 4]);
  report('phase sizes sims', r);
  assert.equal(r.runs, 2 * 6 * 4 * 4);
  assert.deepEqual(r.bad, []);
});

test('phase sizes: the six cells scenes at 99x32, 101x33, 100x31, 41x24, speeds 4 and 3, phases 0 to 0.75 - no ramp, family or shade-step jump, worst frame under 30%', () => {
  const r = sweep(['onramp', 'skyline', 'sundown', 'coast', 'diner', 'caller'], [[99, 32], [101, 33], [100, 31], [41, 24]], [4, 3]);
  report('phase sizes cells', r);
  assert.equal(r.runs, 6 * 4 * 2 * 4);
  assert.deepEqual(r.bad, []);
});

// ---- controls (cut down from the phase suite): the check bites at an off-grid phase
function dipScene(hold) {
  const f = (t, w, h, p) => {
    p.glyphs.fill(32); p.colours.fill(0);
    const local = t - (p.t0 || 0);
    const a = (local % 20) - 10;
    let shade = 3;
    if (a >= 0 && a < hold * 3) shade = [2, 1, 2][Math.floor(a / hold)];
    p.glyphs[5] = 0x2588; p.colours[5] = MAG[shade];
  };
  return { id: 'dip', kind: 'cells', scene: f };
}

test('phase sizes controls: a 0.1 s-per-level dip jumps 3 to 1 in one 4x frame at some phase and not at another (clean at 1x); a 0.3 s dip is clean at every phase', () => {
  const quick = dipScene(0.1), slow = dipScene(0.3);
  const at4 = PHASES.map((ph) => phaseRun(quick, 40, 12, 4, ph, 30));
  assert.ok(at4.some((r) => r.step > 0 || r.ramp > 0), 'a 3 -> 1 jump is found at some phase');
  assert.ok(at4.some((r) => r.step === 0 && r.ramp === 0), 'and the same dip is clean at another phase');
  for (const ph of PHASES) { const r = phaseRun(quick, 40, 12, 1, ph, 30); assert.equal(r.step + r.ramp, 0, `1x phase ${ph}`); }
  for (const speed of [1, 2, 3, 4]) for (const ph of PHASES) { const r = phaseRun(slow, 40, 12, speed, ph, 30); assert.equal(r.step + r.ramp + r.family, 0, `slow dip ${speed}x phase ${ph}`); }
  const half = { id: 'half', kind: 'cells', scene: (t, w, h, p) => { p.glyphs.fill(0x2588); p.colours.fill(0); const on = Math.floor(t * FPS) % 2; for (let i = 0; i < p.glyphs.length / 2; i++) p.colours[i] = on ? 40 : 0; } };
  assert.ok(!(phaseRun(half, 20, 6, 1, 0, 5).worst < FLASH_FRACTION), 'a 50% flip is flagged by the share check');
});
