// DRIFT-5: Night Drive ramps are phase-robust. A scene's clock at the moment it becomes active has any phase against the frame grid, and the
// shell runs at 1x, 2x, 3x and 4x (SPEEDS in src/app.js: a frame step of speed/18 s). The ramp rule is hard, so it has to hold for every phase,
// not only for the test clock grid.
//
// For EVERY scene in the manifest (the list is read, not typed), at 120x40, 80x24 and each LAYOUTS breakpoint the scene exports, at speeds 1 to 4,
// at clock phases 0, 0.25, 0.5 and 0.75 of the frame step, for the scene's whole length on the tape (90 s; the call 75 s):
//   (i)   no cell that keeps a non-blank glyph moves more than one shade step (more than 28 L*, or more than one shade of its family)
//   (ii)  no cell that keeps its glyph changes colour family
//   (iii) the worst share of changed cells is STRICTLY under 30%
// Cells scenes take the phase through params.t0 (the scene runs on t - t0, so t0 = -phase * step makes its local clock k * step + phase * step);
// sims go through the cell composer (its step accumulator is where a sim's phase lives): a first frame at 0 and then frames at phase * step + k * step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCartridges, loadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { createCellComposer } from '../src/cells.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { FAMILIES, MAG } from '../cartridges/night-drive/lib/palette.js';
import { FLASH_FRACTION, lstarTable, SHADE_STEP_LSTAR } from './helpers-flash.js';

const FPS = 18;
const SPEEDS = [1, 2, 3, 4];
const PHASES = [0, 0.25, 0.5, 0.75];
const dirs = [{ dir: INSTALL_DIR, trusted: true }];
const cart = discoverCartridges({ dirs }).cartridges.find((c) => c.id === 'night-drive');
assert.ok(cart, 'night-drive is on the shelf');
const loaded = await loadScenes(cart);
assert.deepEqual(loaded.errors, []);
const SCENES = loaded.scenes; // manifest order, each { id, kind, scene }
const TAPE = cart.manifest.programs.find((p) => p.id === cart.manifest.start) || cart.manifest.programs[0];
const holdOf = (id) => (TAPE.seconds && TAPE.seconds[id]) ?? TAPE.sceneSeconds;
const LTAB = lstarTable(makeSkinPalette(cart.skin, 'truecolor', 'night-drive'));

// colour index -> [family name, shade]
const FAM = new Map();
for (const [name, f] of Object.entries(FAMILIES)) f.forEach((c, s) => FAM.set(c, [name, s]));

// the sizes: 120x40, 80x24 and the smallest window of each layout the scene exports (breakpoints with a minimum above 0)
const sizesOf = async (id) => {
  const set = new Map([['120x40', [120, 40]], ['80x24', [80, 24]]]);
  const mod = await import(`../cartridges/night-drive/scenes/${id}.js`);
  for (const l of mod.LAYOUTS || []) if (l.minCols > 0 || l.minRows > 0) { const w = l.minCols || 80, h = l.minRows || 24; set.set(`${w}x${h}`, [w, h]); }
  return [...set.values()];
};

// One run. Returns { ramp, family, step, worst, at, frames } over every consecutive pair.
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

test('night-drive phase: every scene of the manifest, at 120x40, 80x24 and each layout breakpoint, speeds 1 to 4, clock phases 0 to 0.75 of a frame, for its whole length on the tape: no cell moves more than one shade or changes colour family, and the worst frame changes under 30%', async () => {
  assert.ok(SCENES.length >= 8, 'the manifest lists the scenes');
  const bad = [];
  let runs = 0;
  const worstBy = {};
  for (const s of SCENES) {
    for (const [w, h] of await sizesOf(s.id)) {
      for (const speed of SPEEDS) {
        for (const phase of PHASES) {
          const r = phaseRun(s, w, h, speed, phase);
          runs++;
          if (!worstBy[s.id] || r.worst > worstBy[s.id].worst) worstBy[s.id] = { worst: r.worst, at: tag(s, w, h, speed, phase) };
          if (r.ramp || r.family || r.step) bad.push(`${tag(s, w, h, speed, phase)}: ${r.ramp} brightness, ${r.family} family, ${r.step} shade-step jumps, first ${JSON.stringify(r.first)}`);
          if (!(r.worst < FLASH_FRACTION)) bad.push(`${tag(s, w, h, speed, phase)}: worst share ${(r.worst * 100).toFixed(2)}% at ${r.at.toFixed(2)} s`);
        }
      }
    }
  }
  console.log(`TABLE night-drive phase (${runs} runs)\n  ` + Object.entries(worstBy).map(([id, v]) => `${id} worst share ${(v.worst * 100).toFixed(2)}% (${v.at})`).join('\n  '));
  // report per scene, so a failure names the scenes
  const scenesBad = [...new Set(bad.map((b) => b.split(' ')[0]))];
  const sample = scenesBad.flatMap((id) => bad.filter((b) => b.startsWith(id + ' ')).slice(0, 3));
  assert.deepEqual(sample, [], `scenes failing: ${scenesBad.map((id) => `${id} (${bad.filter((b) => b.startsWith(id + ' ')).length} runs)`).join(', ')}`);
});

// ---- controls: the check bites, at an off-grid phase

// A cells scene with one tube: shade 3, except a dip 3 -> 2 -> 1 -> 2 -> 3 that holds each level `hold` seconds from local 10 s and every 20 s after
function dipScene(hold) {
  const f = (t, w, h, p) => {
    p.glyphs.fill(32); p.colours.fill(0);
    const local = t - (p.t0 || 0);
    const a = local % 20 - 10;
    let shade = 3;
    if (a >= 0 && a < hold * 3) shade = [2, 1, 2][Math.floor(a / hold)];
    p.glyphs[5] = 0x2588; p.colours[5] = MAG[shade];
  };
  return { id: 'dip', kind: 'cells', scene: f };
}

test('night-drive phase controls: a 0.1 s-per-level dip jumps 3 -> 1 in one 4x frame at an off-grid phase (and is clean at 1x); a 0.3 s-per-level dip is clean at every phase; a colour-family flip and a 50% flip are caught', () => {
  const quick = dipScene(0.1), slow = dipScene(0.3);
  const quickAt4 = PHASES.map((ph) => phaseRun(quick, 40, 12, 4, ph, 60));
  assert.ok(quickAt4.some((r) => r.step > 0 || r.ramp > 0), 'a 3 -> 1 jump is found at some phase of the 4x clock');
  assert.ok(quickAt4.some((r) => r.step === 0 && r.ramp === 0), 'and the same dip is clean at another phase: the test depends on the phase, so it needs them all');
  for (const ph of PHASES) { const r = phaseRun(quick, 40, 12, 1, ph, 60); assert.equal(r.step + r.ramp, 0, `1x phase ${ph}`); }
  for (const speed of SPEEDS) for (const ph of PHASES) { const r = phaseRun(slow, 40, 12, speed, ph, 60); assert.equal(r.step + r.ramp + r.family, 0, `slow dip ${speed}x phase ${ph}: ${JSON.stringify(r.first)}`); }
  const fam = { id: 'fam', kind: 'cells', scene: (t, w, h, p) => { p.glyphs.fill(0x2588); p.colours.fill(Math.floor(t * FPS) % 2 ? FAMILIES.cyan[2] : FAMILIES.coral[2]); } };
  assert.ok(phaseRun(fam, 20, 6, 1, 0, 5).family > 0, 'a family flip is flagged');
  const half = { id: 'half', kind: 'cells', scene: (t, w, h, p) => { p.glyphs.fill(0x2588); p.colours.fill(0); const on = Math.floor(t * FPS) % 2; for (let i = 0; i < p.glyphs.length / 2; i++) p.colours[i] = on ? 40 : 0; } };
  assert.ok(!(phaseRun(half, 20, 6, 1, 0, 5).worst < FLASH_FRACTION), 'a 50% flip is flagged by the share check');
});
