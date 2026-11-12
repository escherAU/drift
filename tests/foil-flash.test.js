// DRIFT-7 C12: the flash meter (createFlashMeter: WCAG luminance, saturated red, field and step rules at 1x and 4x playback) over the
// foil label. The old 30% changed-cell count is blind to full-colour frames; this meter is not.
//   rest   30 s of the selected foil card at rest (the holo shimmer, 6 steps a second), absolute limits: L1, L2, L3, R must all pass.
//   moves  a 30 s walk over the shelf: rest, a slide right onto the second foil card, back, a slide onto the plain card, a slide back,
//          then two quick presses (one queued), with the foil neighbours dimming and brightening as they move. The library slide
//          is not the foil's doing, so this flow is held to the SAME shelf with the foil switched off (same labels, same ink,
//          palette colours), with the dense fixture label AND the real art of Delza. Where that baseline passes a rule, the foil flow passes
//          it at the rule's own limit. Where the baseline is over already (the library slide itself: nothing to do with the foil), the foil
//          flow may not be worse than it by more than SLACK. The only difference between the two flows is the brightness of a foil cell: safeHue's
//          colour is within 0.011 of the luminance of the palette colour it stands for (6-bit grid), which moves a cell whose swing sits right
//          at the meter's 0.10 across the line. With a foil of exactly the palette luminance the two flows are identical (measured).
//   insert  insert + boot (1x and 4x) and eject (1x) of a foil cartridge, foil frozen at t = 0: ABSOLUTE limits (DRIFT-7 item 1), every rule at its limit and a
//          per-size L2 ceiling (CEIL_L2). SLACK no longer applies to them; it still applies to the walk (the library slide, item 2).
//   control  the rest flow with the brightness of every foil cell also modulated (on alternate steps the fg of every foil cell is scaled up to full lightness, so a label at level 1-3 flashes to the brightest the hue allows,
//          a test-only post-filter on the frames the shell drew): the meter must flag it.
// Sizes: the three usual ones and the size just above each layout breakpoint (full 88x39, extra-large 176x58, compact 78x24).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlashMeter } from './helpers-flash.js';
import { shelfLayout, LABEL_W, LABEL_H } from '../src/shell/library.js';
import { sizeTier } from '../src/shell/ui.js';
import { foilRoot, foilShell, copyOf, DT, FPS } from './helpers-foil.js';
import { flush } from './helpers-console-hook.js';

const SIZES = [[120, 40], [80, 24], [240, 67], [88, 39], [176, 58], [78, 24]];
const RULES = [['l1.x1', (r) => r.l1.x1], ['l1.x4', (r) => r.l1.x4], ['l2.x1', (r) => r.l2.x1], ['l2.x4', (r) => r.l2.x4], ['l3', (r) => r.l3], ['r.x1', (r) => r.r.x1], ['r.x4', (r) => r.r.x4]];
const SLACK = 0.015; // 1.5 points, only where the shelf without the foil is already over the rule (the SHELF WALK only: the library slide itself, item 2)
const pc = (x) => (x * 100).toFixed(2);
// Insert + boot and eject of a foil cartridge are held to ABSOLUTE limits (DRIFT-7 item 1: insert step 3 is a dissolve now, so these flows no longer
// sit over a rule): every rule at its own limit, and a ceiling on L2 per size, the measured value (Delza's art) plus a hair, to the next tenth of a
// point. [insert+boot 1x, insert+boot 4x, eject 1x]. The eject at 4x gets no ceiling: playback speed reaches only the scene clock.
const CEIL_L2 = { // fractions
  '120x40': [0.046, 0.162, 0.010], '80x24': [0.094, 0.177, 0.024], '240x67': [0.020, 0.055, 0.004], '88x39': [0.083, 0.216, 0.029], '176x58': [0.037, 0.095, 0.004], '78x24': [0.083, 0.169, 0.035],
};
const show = (rep) => `L1 ${pc(rep.l1.x1.worstFraction)}/${pc(rep.l1.x4.worstFraction)} L2 ${pc(rep.l2.x1.worstFraction)}/${pc(rep.l2.x4.worstFraction)} L3 ${pc(rep.l3.worstFraction)} R ${pc(rep.r.x1.worstFraction)}/${pc(rep.r.x4.worstFraction)}`;

// the 30 s at rest: wait for nothing, the library is the start screen
function rest(cols, rows, { withFoil = true, seconds = 30, offset = 0, filter = null, art = 'dense' } = {}) {
  const { sh } = foilShell(cols, rows, { root: foilRoot({ withFoil, art }) });
  const meter = createFlashMeter(cols, rows, FPS);
  if (offset > 0) sh.tick(offset);
  for (let k = 0; k < seconds * FPS; k++) {
    const f = sh.frame();
    meter.push(filter ? filter(copyOf(f), k) : f);
    sh.tick(DT);
  }
  return meter.report();
}

// the walk
const WALK = [[8, 'libNext'], [13, 'libPrev'], [18, 'libPrev'], [22, 'libNext'], [26, 'libNext'], [26.3, 'libPrev']];
function walk(cols, rows, { withFoil = true, offset = 0, art = 'dense' } = {}) {
  const { sh } = foilShell(cols, rows, { root: foilRoot({ withFoil, art }) });
  const meter = createFlashMeter(cols, rows, FPS);
  if (offset > 0) sh.tick(offset);
  let clock = 0, next = 0;
  const path = [sh.state().cartridge];
  for (let k = 0; k < 30 * FPS; k++) {
    while (next < WALK.length && clock >= WALK[next][0] - 1e-9) { sh.actions[WALK[next][1]](); next++; path.push(sh.state().cartridge); }
    meter.push(sh.frame());
    sh.tick(DT);
    clock += DT;
  }
  return { rep: meter.report(), path };
}

// The control: on alternate steps every foil (full-colour, label-rect) cell is scaled up until its brightest channel is 252, so the
// brightness moves with the clock while the hue stays; the rest of the frame is the shell's own.
function wobble(cols, rows) {
  const tier = sizeTier(cols, rows);
  const L = shelfLayout(cols, rows, tier);
  return (f, k) => {
    if (Math.floor(k / 3) % 2 === 0) return f; // 6 steps a second: 3 frames at 18 fps
    for (let y = 0; y < LABEL_H; y++) for (let x = 0; x < LABEL_W; x++) {
      const i = (L.cartTop + 3 + y) * cols + L.cartX + 3 + x;
      if (f.shades[i] !== 255) continue;
      const c = f.fg[i], r = (c >>> 16) & 255, g = (c >>> 8) & 255, b = c & 255, k = 252 / Math.max(r, g, b, 1);
      f.fg[i] = ((Math.min(252, Math.round(r * k)) << 16) | (Math.min(252, Math.round(g * k)) << 8) | Math.min(252, Math.round(b * k))) >>> 0;
    }
    return f;
  };
}

// insert + boot until the cartridge runs (plus a second of it), then the eject; the foil is frozen at t = 0 for all of it
async function insertFlow(cols, rows, withFoil) {
  const { sh } = foilShell(cols, rows, { root: foilRoot({ withFoil, art: 'delza' }), start: { cartridge: 'foil-a' } });
  await flush();
  const ins = createFlashMeter(cols, rows, FPS);
  let sawFoil = false;
  for (let n = 0; sh.state().screen !== 'running' && n < 900; n++) {
    const f = sh.frame();
    if (sh.state().screen === 'insert' && f.shades.includes(255)) sawFoil = true;
    ins.push(f);
    sh.tick(DT);
    if (n % 10 === 0) await flush();
  }
  assert.equal(sh.state().screen, 'running', `${cols}x${rows} reached the running screen`);
  for (let k = 0; k < FPS; k++) { ins.push(sh.frame()); sh.tick(DT); }
  sh.key('e');
  const eje = createFlashMeter(cols, rows, FPS);
  for (let n = 0; sh.state().screen === 'eject' && n < 600; n++) { eje.push(sh.frame()); sh.tick(DT); }
  for (let k = 0; k < 6; k++) { eje.push(sh.frame()); sh.tick(DT); }
  return { ins: ins.report(), eje: eje.report(), sawFoil };
}

const TABLE = [];
for (const [cols, rows] of SIZES) {
  test(`foil flash ${cols}x${rows}: 30 s of the shimmer at rest passes L1, L2, L3 and R at 1x and 4x; the walk over the shelf is no worse than the same shelf without the foil (dense label and Delza's art); a brightness-modulating foil is flagged`, () => {
    const at = `${cols}x${rows}`.padEnd(8);
    const r = rest(cols, rows);
    TABLE.push(at + 'rest   foil     ' + show(r));
    for (const [name, get] of RULES) assert.ok(get(r).pass, `${cols}x${rows} rest ${name} ${pc(get(r).worstFraction)}% is over ${pc(get(r).limit)}%`);
    assert.equal(r.pass, true);
    assert.equal(r.frames, 30 * FPS);

    for (const art of ['dense', 'delza']) {
      const w = walk(cols, rows, { art }), b = walk(cols, rows, { withFoil: false, art });
      TABLE.push(at + `walk   foil ${art.padEnd(5)} ` + show(w.rep));
      TABLE.push(at + `walk   none ${art.padEnd(5)} ` + show(b.rep));
      assert.deepEqual(w.path, b.path);
      assert.ok(new Set(w.path).size >= 3, 'the walk visits foil and plain cards: ' + w.path.join(' > '));
      const bad = [];
      for (const [name, get] of RULES) {
        const a = get(w.rep), base = get(b.rep);
        if (base.pass) { if (!a.pass) bad.push(`${name}: ${pc(a.worstFraction)}% is over ${pc(a.limit)}% (the same shelf without the foil passes at ${pc(base.worstFraction)}%)`); } else if (a.worstFraction > base.worstFraction + SLACK) bad.push(`${name}: ${pc(a.worstFraction)}% is worse than the shelf without the foil, ${pc(base.worstFraction)}%`);
      }
      assert.deepEqual(bad, [], `${cols}x${rows} ${art}`);
    }

    // the control: the same flow with the brightness also moving
    const c = rest(cols, rows, { filter: wobble(cols, rows), seconds: 10 });
    const clean = rest(cols, rows, { seconds: 10 });
    TABLE.push(at + 'ctrl   wobble   ' + show(c));
    const label = LABEL_W * LABEL_H;
    const field = Math.ceil(cols / 3) * Math.ceil(rows / 3);
    if (label > 0.25 * field + 6) {
      // the label is more than a quarter of a field here, so a flickering label must trip the 25% field rule
      assert.equal(c.pass, false, `${cols}x${rows}: the meter must flag a foil that modulates its brightness`);
      assert.ok(!c.l2.x1.pass || !c.l1.x4.pass, 'flagged by L2 at 1x or L1 at 4x');
    } else {
      // the label is smaller than a quarter of a field (176x58 and 240x67): the 25% rule cannot trip on one label by design;
      // the meter still sees it, as the share of the field that is hot
        assert.ok(c.l2.x1.worstFraction > clean.l2.x1.worstFraction + 0.05, `${cols}x${rows}: control L2 ${pc(c.l2.x1.worstFraction)}% vs clean ${pc(clean.l2.x1.worstFraction)}%`);
    }
    assert.ok(c.l2.x1.worstFraction > clean.l2.x1.worstFraction + 0.05, 'the control is above the clean foil on L2');
  });
}

for (const [cols, rows] of SIZES) {
  test(`foil flash ${cols}x${rows}: insert + boot (1x and 4x) and eject (1x) of a foil cartridge (the foil frozen at t = 0) pass every rule and sit under the absolute L2 ceilings`, async () => {
    const a = await insertFlow(cols, rows, true), b = await insertFlow(cols, rows, false);
    TABLE.push(`${cols}x${rows}`.padEnd(8) + 'insert foil      ' + show(a.ins) + ' | eject ' + show(a.eje));
    TABLE.push(`${cols}x${rows}`.padEnd(8) + 'insert no foil   ' + show(b.ins) + ' | eject ' + show(b.eje));
    const tier = sizeTier(cols, rows);
    assert.equal(a.sawFoil, tier === 'full' || tier === 'compact', 'the insert draws the foil label (frozen) at the tiers that show it');
    const bad = [];
    const [i1, i4, e1] = CEIL_L2[`${cols}x${rows}`];
    for (const [flow, x] of [['insert+boot', a.ins], ['eject', a.eje]]) {
      for (const [name, get] of RULES) { const r = get(x); if (!r.pass) bad.push(`${flow} ${name}: ${pc(r.worstFraction)}% is over ${pc(r.limit)}%`); }
    }
    for (const [name, r, ceil] of [['insert+boot l2.x1', a.ins.l2.x1, i1], ['insert+boot l2.x4', a.ins.l2.x4, i4], ['eject l2.x1', a.eje.l2.x1, e1]]) {
      if (r.worstFraction > ceil) bad.push(`${name}: ${pc(r.worstFraction)}% is over its ceiling ${pc(ceil)}%`);
    }
    assert.deepEqual(bad, []);
  });
}

test('foil flash: the shimmer is clock-stepped, so run it at four phases of the frame clock (the first tick lands 0, 1/4, 1/2 and 3/4 of a frame into the step) and at both usual sizes: all rules pass', () => {
  for (const [cols, rows] of [[120, 40], [80, 24]]) {
    for (const k of [0, 1, 2, 3]) {
      const r = rest(cols, rows, { seconds: 12, offset: (k / 4) * DT });
      for (const [name, get] of RULES) assert.ok(get(r).pass, `${cols}x${rows} phase ${k}/4 ${name} ${pc(get(r).worstFraction)}%`);
      TABLE.push(`${cols}x${rows}`.padEnd(8) + `phase ${k}/4 foil   ` + show(r));
    }
  }
});

test('foil flash TABLE: every measured value at the six sizes', () => {
  console.log(['TABLE foil flash meter (x1/x4; limits L1 25, L2 25, L3 30, R 25)', ...TABLE.map((l) => '  ' + l)].join('\n'));
  assert.ok(TABLE.length === 0 || TABLE.length >= SIZES.length * 4);
});
