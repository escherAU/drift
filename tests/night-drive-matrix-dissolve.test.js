// DRIFT-5: Night Drive's dissolves at the sizes between the ones tests/night-drive-flash.test.js (b) runs (120x40, 80x24, 41x11).
//
// What it pins: each of the 8 consecutive pairs of the tape (the wrap, overdrive -> onramp, included), through createCellComposer and a two-scene
// Scheduler with the tape's real holds (90 s, the caller 75 s) and a 2 s fade, exactly as pairRun does in night-drive-flash.test.js, over the whole
// run (hold, dissolve and 2 s tail): every frame changes STRICTLY under 30% of the cells. Sizes are the breakpoint neighbours (100x32, 99x32, 100x31,
// 101x33, 60x18, 59x18, 80x23, 41x24, 40x12), the console tiers (89x40, 79x25) and 240x67; speeds 1, 2, 3, 4 (not 0.25x: the dissolve is slower
// than the scenes there).
// Why: the dissolve mixes two scenes' frames, so a size where either scene or its layout changes shape can add a flash the solo runs do not show.
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCartridges, loadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { createCellComposer } from '../src/cells.js';
import { Scheduler } from '../src/compose.js';
import { FLASH_FRACTION, changedFraction } from './helpers-flash.js';

const FPS = 18, FADE = 2;
const pct = (x) => (x * 100).toFixed(2) + '%';
const cart = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.find((c) => c.id === 'night-drive');
assert.ok(cart, 'night-drive is on the shelf');
const loaded = await loadScenes(cart);
assert.deepEqual(loaded.errors, []);
const byId = (id) => loaded.scenes.find((s) => s.id === id);
const TAPE = cart.manifest.programs.find((p) => p.id === cart.manifest.start) || cart.manifest.programs[0];
const ORDER = TAPE.scenes;
const holdOf = (id) => (TAPE.seconds && TAPE.seconds[id]) ?? TAPE.sceneSeconds;
const PAIRS = ORDER.map((a, k) => [a, ORDER[(k + 1) % ORDER.length]]);

const SIZES = [[240, 67], [100, 32], [99, 32], [100, 31], [101, 33], [60, 18], [59, 18], [80, 23], [41, 24], [40, 12], [89, 40], [79, 25]];
const SPEEDS = [1, 2, 3, 4];

const cache = new Map();
// Same run as pairRun in night-drive-flash.test.js: returns the worst frame share over the whole run and when it came.
function pairRun(idA, idB, w, h, speed, scenes = null) {
  const key = `${idA}>${idB} ${w}x${h} ${speed}x`;
  if (!scenes && cache.has(key)) return cache.get(key);
  const [sa, sb] = scenes || [byId(idA).scene, byId(idB).scene];
  const cc = createCellComposer({ scenes: [sa, sb], cols: w, rows: h, seed: 1 });
  const holdA = holdOf(idA), holdB = holdOf(idB);
  const sched = new Scheduler({ count: 2, durationSec: holdA, fadeSec: FADE, start: 0, durations: [holdA, holdB] });
  const total = Math.ceil(((holdA + FADE + 2) * FPS) / speed);
  let pg = null, pc = null, worst = 0, where = 0;
  for (let k = 0; k <= total; k++) {
    sched.advance(speed / FPS);
    const t = (k * speed) / FPS;
    const f = cc.frame(sched.state(), t);
    if (pg) {
      const x = changedFraction(f.glyphs, pg, f.shades, pc);
      if (x > worst) { worst = x; where = t; }
    } else { pg = new Uint16Array(f.glyphs.length); pc = new Uint8Array(f.glyphs.length); }
    pg.set(f.glyphs); pc.set(f.shades);
  }
  const r = { key, worst, where };
  if (!scenes) cache.set(key, r);
  return r;
}

test('matrix dissolve: the pairs are the manifest\'s eight consecutive tape pairs (wrap included), holds 90 and 75', () => {
  assert.equal(PAIRS.length, 8);
  assert.deepEqual(PAIRS[7], ['overdrive', 'onramp']);
  assert.equal(holdOf('caller'), 75);
  assert.equal(holdOf('onramp'), 90);
  assert.equal(PAIRS.length * SIZES.length * SPEEDS.length, 384);
});

test('matrix dissolve: all 8 tape pairs at 12 sizes and speeds 1 to 4, every frame of every run strictly under 30%', () => {
  const rows = [], bad = [];
  let top = { worst: 0, key: '' };
  for (const [a, b] of PAIRS) {
    for (const [w, h] of SIZES) {
      for (const speed of SPEEDS) {
        const r = pairRun(a, b, w, h, speed);
        if (r.worst > top.worst) top = r;
        if (!(r.worst < FLASH_FRACTION)) bad.push(`${r.key} worst ${pct(r.worst)} at ${r.where.toFixed(2)} s`);
      }
    }
    rows.push(`${a}>${b}: worst over ${SIZES.length * SPEEDS.length} runs ${pct(Math.max(...SIZES.flatMap(([w, h]) => SPEEDS.map((s) => pairRun(a, b, w, h, s).worst))))}`);
  }
  console.log(`TABLE matrix dissolve (${PAIRS.length * SIZES.length * SPEEDS.length} runs)\n  ${rows.join('\n  ')}\n  top: ${top.key} ${pct(top.worst)} at ${top.where.toFixed(2)} s`);
  assert.deepEqual(bad, [], 'a dissolve frame at or over 30%');
});

test('matrix dissolve control: the same run over two planted scenes that flip half the cells every frame reads over 30%', () => {
  const flip = (o) => { const f = (t, w, h, p) => { const k = Math.round(t * FPS) % 2; for (let i = 0; i < w * h; i++) { p.glyphs[i] = (i + k) % 2 ? 0x2588 : 0x2591; p.colours[i] = 20 + o; } }; f.id = 'flip' + o; f.kind = 'cells'; return f; };
  const r = pairRun('onramp', 'skyline', 40, 12, 1, [flip(0), flip(1)]);
  assert.ok(!(r.worst < FLASH_FRACTION), `the control read ${pct(r.worst)}`);
});
