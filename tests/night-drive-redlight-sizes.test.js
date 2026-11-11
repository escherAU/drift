// DRIFT-5: Night Drive "Red Light, Rain" (the downpour) at ten sizes, 90 s at 1x and 4x, alone through the real cell composer (seed 1).
//
// What it pins, per size and speed, over every frame:
//   - the worst frame-to-frame change is under 25% of the cells and above 1% (the rain is alive), and the MEAN changed share is 20% or less
//   - coral.3 (colour CORAL[3]) is at most 1.5% of the cells and coral.2+3 at most 5% (the hot red stays small)
//   - bright solid (U+2588 or U+2593 at L* 60 or more) is under 25% of the cells
//   - lit cells are between 5% and 90% of the cells (neither empty nor filled)
//   - the frame's mean L* (sum of L* of the lit cells over ALL cells) never moves more than 4 between two frames (no flash of brightness)
// Why the mean-share bound: redlight is by far the costliest track. tools/measure.mjs (--seconds 12 --cols 240 --rows 67 --cartridge night-drive
// --program tape --scene <id>) gave 899 KB/s of output for redlight against 7 to 89 KB/s for the other seven tracks (caller 9.4K, coast 88.7K, diner 7.1K,
// onramp 22.0K, overdrive 9.9K, skyline 10.6K, sundown 30.7K). The mean changed share is the proxy for that cost, so it is bounded here.
// Why these sizes: the older redlight tests (tests/night-drive-redlight.test.js, the flash and phase suites) run only 120x40, 80x24 and 240x67 (and
// the layout breakpoints in the phase suite); the downpour's slot counts and glass depend on the exact width and height, and these sizes sit
// around the 100x32 layout breakpoint, the 40x12 floor and the wide and tall extremes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCellComposer } from '../src/cells.js';
import { CORAL } from '../cartridges/night-drive/lib/palette.js';
import redlight from '../cartridges/night-drive/scenes/redlight.js';
import { LTAB, FPS } from './helpers-night-drive.js';

const SIZES = [[240, 67], [101, 33], [100, 32], [100, 31], [99, 32], [99, 33], [41, 12], [40, 12], [100, 67], [200, 32]];
const SPEEDS = [1, 4];
const pct = (x) => (x * 100).toFixed(2) + '%';

export function sizeRun(scene, w, h, speed, seconds = 90) {
  const cc = createCellComposer({ scenes: [scene], cols: w, rows: h, seed: 1 });
  const N = w * h;
  const pg = new Uint16Array(N), pc = new Uint8Array(N);
  let have = false, nf = 0;
  const r = { worst: 0, sum: 0, coral3: 0, coral23: 0, bright: 0, litMin: 1, litMax: 0, dL: 0, mean: 0 };
  let mlPrev = null;
  const total = Math.ceil((seconds * FPS) / speed);
  const C3 = CORAL[3], C2 = CORAL[2];
  for (let k = 0; k <= total; k++) {
    const f = cc.frame({ a: 0, b: 0, p: 0 }, (k * speed) / FPS);
    const g = f.glyphs, c = f.shades;
    let lit = 0, n3 = 0, n23 = 0, br = 0, ml = 0;
    for (let i = 0; i < N; i++) {
      const gi = g[i], ci = c[i];
      if (gi !== 32) { lit++; ml += LTAB[ci]; }
      if (ci === C3) { n3++; n23++; } else if (ci === C2) n23++;
      if ((gi === 0x2588 || gi === 0x2593) && LTAB[ci] >= 60) br++;
    }
    ml /= N;
    if (mlPrev !== null) r.dL = Math.max(r.dL, Math.abs(ml - mlPrev));
    mlPrev = ml;
    r.coral3 = Math.max(r.coral3, n3 / N); r.coral23 = Math.max(r.coral23, n23 / N); r.bright = Math.max(r.bright, br / N);
    r.litMin = Math.min(r.litMin, lit / N); r.litMax = Math.max(r.litMax, lit / N);
    if (have) {
      let n = 0;
      for (let i = 0; i < N; i++) if (g[i] !== pg[i] || c[i] !== pc[i]) n++;
      r.worst = Math.max(r.worst, n / N); r.sum += n / N; nf++;
    }
    pg.set(g); pc.set(c); have = true;
  }
  r.mean = r.sum / nf;
  return r;
}

const check = (tag, r) => {
  const bad = [];
  if (!(r.worst < 0.25 && r.worst > 0.01)) bad.push(`worst ${pct(r.worst)} not in (1%, 25%)`);
  if (!(r.mean <= 0.2)) bad.push(`mean changed share ${pct(r.mean)} over 20%`);
  if (!(r.coral3 <= 0.015)) bad.push(`coral.3 ${pct(r.coral3)} over 1.5%`);
  if (!(r.coral23 <= 0.05)) bad.push(`coral.2+3 ${pct(r.coral23)} over 5%`);
  if (!(r.bright < 0.25)) bad.push(`bright solid ${pct(r.bright)} at 25% or over`);
  if (!(r.litMin >= 0.05 && r.litMax <= 0.9)) bad.push(`lit ${pct(r.litMin)}-${pct(r.litMax)} outside 5%-90%`);
  if (!(r.dL <= 4)) bad.push(`mean L* moved ${r.dL.toFixed(2)} in a frame (over 4)`);
  return bad.length ? `${tag}: ${bad.join('; ')}` : null;
};

test('redlight sizes: ten sizes x 1x and 4x, 90 s - worst frame, mean share, coral, bright solid, lit share and mean-L* step all inside their bounds', () => {
  const rows = [], bad = [];
  for (const [w, h] of SIZES) {
    for (const speed of SPEEDS) {
      const r = sizeRun(redlight, w, h, speed);
      const tag = `${w}x${h} ${speed}x`;
      rows.push(`${tag} worst ${pct(r.worst)} mean ${pct(r.mean)} coral3 ${pct(r.coral3)} coral23 ${pct(r.coral23)} brightSolid ${pct(r.bright)} lit ${pct(r.litMin)}-${pct(r.litMax)} maxdL* ${r.dL.toFixed(2)}`);
      const b = check(tag, r);
      if (b) bad.push(b);
    }
  }
  console.log('TABLE redlight sizes\n  ' + rows.join('\n  '));
  assert.deepEqual(bad, []);
});

test('redlight sizes controls: each bound bites on a planted scene (50% flip: worst; flat fill: lit; red fill: coral; bright fill: bright solid; brightness pulse: mean L*)', () => {
  const mk = (fn) => { const f = (t, w, h, p) => fn(Math.round(t * FPS), w, h, p); f.id = 'ctl'; f.kind = 'cells'; return f; };
  const bright = LTAB.findIndex((L) => L >= 60);
  const dark = LTAB.indexOf(Math.min(...LTAB));
  const flip = sizeRun(mk((k, w, h, p) => { for (let i = 0; i < w * h; i++) { p.glyphs[i] = (i + k) % 2 ? 0x2588 : 0x2591; p.colours[i] = 30; } }), 40, 12, 1, 5);
  assert.ok(!(flip.worst < 0.25), 'a 50% flip is over the worst bound');
  const blankScene = sizeRun(mk((k, w, h, p) => { p.glyphs.fill(32); p.colours.fill(0); }), 40, 12, 1, 5);
  assert.ok(!(blankScene.worst > 0.01) && !(blankScene.litMin >= 0.05), 'a blank scene reads dead and empty');
  const red = sizeRun(mk((k, w, h, p) => { p.glyphs.fill(0x2592); p.colours.fill(CORAL[3]); }), 40, 12, 1, 5);
  assert.ok(red.coral3 > 0.015 && red.coral23 > 0.05 && red.litMax > 0.9, 'a coral.3 fill breaks the coral and lit bounds');
  const solid = sizeRun(mk((k, w, h, p) => { p.glyphs.fill(0x2588); p.colours.fill(bright); }), 40, 12, 1, 5);
  assert.ok(solid.bright >= 0.25, 'a bright block fill breaks the bright-solid bound');
  const pulse = sizeRun(mk((k, w, h, p) => { p.glyphs.fill(0x2592); p.colours.fill(k % 2 ? bright : dark); }), 40, 12, 1, 5);
  assert.ok(pulse.dL > 4, `a whole-screen brightness pulse moves the mean L* by ${pulse.dL.toFixed(1)}`);
  for (const r of [flip, red, solid]) assert.ok(check('ctl', r), 'the combined check flags it');
});
