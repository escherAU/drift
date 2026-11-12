// DRIFT-7 C8: the insert key frame at the list and tiny tiers (windows under 78x24).
// Enter on the card used to cut from the library picture to the console's insert picture in one frame: about half of a 41x11 screen changed.
// The shell now keeps the last library frame and dissolves from it over INSERT_DISSOLVE_SECONDS (0.3 s, linear) at the list and tiny tiers only.
// The compact and full tiers (78x24 and up) draw exactly as before.
//   (1) the key frame (first tick after Enter) is 40% or less at every list and tiny size, on two cartridges
//   (2) the dissolve is linear: the share of cells changed from the library frame at 0.1, 0.2 and 0.3 s rises evenly and ends at the full cut
//   (3) the first frame carries the library (fg/bg ride along) and the last is the plain insert picture; the palette does not change in between
//   (4) speeds 1 to 4 (frames of 1 to 4 ticks) and four library clock phases
//   (5) 80x24 and 120x40 are unchanged: their key frame is the hard cut and no dissolve runs
//   (6) the insert timeline is not moved: skipping and the boot still start at the same time
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkShell, DT } from './helpers-shell.js';
import { dirs, pct, HARD_CEILING } from './helpers-night-drive-shell.js';
import { changedFraction } from './helpers-flash.js';
import { INSERT_END } from '../src/shell/insert.js';
import { sizeTier } from '../src/shell/ui.js';

const LIST_SIZES = [[41, 11], [40, 12], [44, 11], [40, 10], [60, 20], [77, 23], [77, 40], [50, 11]];
const TINY_SIZES = [[39, 11], [30, 8], [40, 9]];
const BIG_SIZES = [[80, 24], [120, 40], [79, 25]];
const CARTS = ['night-drive', 'delza'];

const grab = (c) => { const f = c.app.screenshot(); return { g: f.glyphs.slice(), s: f.shades.slice(), fg: f.fg ? f.fg.slice() : null, bg: f.bg ? f.bg.slice() : null, p: f.palette }; };
const diff = (a, b) => changedFraction(a.g, b.g, a.s, b.s);

// Library settled for `lead` seconds (the idle clock), the cursor on `id`, then Enter and `n` frames of `step` seconds each.
function insertSeries(cols, rows, { id = 'night-drive', lead = 2, step = DT, n = 8 } = {}) {
  const c = mkShell({ dirs, cols, rows, startScreen: { screen: 'library' } });
  try {
    c.app.start();
    c.tick(lead);
    if (!c.goto(id)) return null;
    c.tick(lead);
    const pre = grab(c);
    c.key('\r');
    const frames = [];
    let t = 0;
    for (let k = 0; k < n; k++) { c.tick(step); t += step; frames.push({ t, f: grab(c), screen: c.sh().screen }); }
    return { pre, frames };
  } finally { c.done(); }
}

for (const [cols, rows] of [...LIST_SIZES, ...TINY_SIZES]) {
  for (const id of CARTS) {
    test(`insert key frame ${cols}x${rows} (${sizeTier(cols, rows)}, ${id}): the first frame after Enter changes ${pct(HARD_CEILING)} or less of the cells`, () => {
      const s = insertSeries(cols, rows, { id });
      if (!s) return; // this install has no such cartridge on the shelf
      const key = diff(s.frames[0].f, s.pre);
      assert.equal(s.frames[0].screen, 'insert');
      console.log(`TABLE insert key frame\n  ${cols}x${rows} ${id}: ${pct(key)}`);
      assert.ok(key <= HARD_CEILING, `${cols}x${rows} ${id}: the insert key frame changed ${pct(key)}`);
    });
  }
}

for (const [cols, rows] of [[41, 11], [40, 12], [44, 11], [40, 10]]) {
  test(`insert dissolve ${cols}x${rows}: linear, 0.1 s < 0.2 s < 0.3 s, ending at the full insert picture`, () => {
    const s = insertSeries(cols, rows, { step: 0.05, n: 8 });
    const at = (t) => s.frames.find((x) => Math.abs(x.t - t) < 1e-6).f;
    const full = at(0.35); // past the dissolve: the plain insert picture
    const d = (t) => diff(at(t), s.pre);
    const D = diff(full, s.pre);
    assert.ok(D > 0.3, `${cols}x${rows}: the insert picture differs from the library (${pct(D)})`);
    const a = d(0.1), b = d(0.2), z = d(0.3);
    assert.ok(a < b && b < z, `${cols}x${rows}: ${pct(a)} < ${pct(b)} < ${pct(z)}`);
    // linear: each share is p x the full difference, p = t / 0.3
    for (const [t, got] of [[0.1, a], [0.2, b]]) assert.ok(Math.abs(got / D - t / 0.3) < 0.12, `${cols}x${rows}: at ${t} s ${pct(got)} of ${pct(D)} is ${(got / D).toFixed(2)}, linear is ${(t / 0.3).toFixed(2)}`);
    // by 0.3 s the picture is the insert picture (the cells that differ from the library are the ones the plain frame differs in)
    assert.ok(Math.abs(z - D) < 0.03, `${cols}x${rows}: at 0.3 s ${pct(z)} against the full ${pct(D)}`);
  });
}

test('insert dissolve 41x11: no palette change across the dissolve, and the first frame is mostly the library frame', () => {
  const s = insertSeries(41, 11, { step: DT, n: 12 });
  for (const x of s.frames) assert.equal(x.f.p, s.pre.p, `the palette is the library's at ${x.t.toFixed(2)} s`);
  const first = diff(s.frames[0].f, s.pre);
  assert.ok(first < 0.25, `first frame ${pct(first)}`);
});

for (const speed of [1, 2, 3, 4]) {
  for (const lead of [1.0, 1.25, 1.5, 1.75]) {
    test(`insert key frame 41x11 at speed ${speed}, library clock ${lead}: 40% or less, and rising to the full cut`, () => {
      const s = insertSeries(41, 11, { step: DT * speed, lead, n: Math.ceil(0.5 / (DT * speed)) + 1 });
      const key = diff(s.frames[0].f, s.pre);
      assert.ok(key <= HARD_CEILING, `speed ${speed}: ${pct(key)}`);
      // never a step back: each frame within the dissolve differs from the library at least as much as the one before it (a 2-point slack for the insert's own animation)
      let prev = 0;
      for (const x of s.frames) {
        if (x.t > 0.3) break;
        const d = diff(x.f, s.pre);
        assert.ok(d >= prev - 0.02, `speed ${speed} at ${x.t.toFixed(2)} s: ${pct(d)} after ${pct(prev)}`);
        prev = d;
      }
    });
  }
}

for (const [cols, rows] of BIG_SIZES) {
  test(`insert key frame ${cols}x${rows}: the compact and full tiers keep the hard cut (the frames do not depend on the library picture before Enter)`, () => {
    assert.ok(['compact', 'full'].includes(sizeTier(cols, rows)));
    // two library pictures (different idle clocks) before Enter: a hard cut draws the same insert frames after it
    const a = insertSeries(cols, rows, { lead: 1.0, step: DT, n: 6 }), b = insertSeries(cols, rows, { lead: 2.5, step: DT, n: 6 });
    a.frames.forEach((x, i) => assert.equal(diff(x.f, b.frames[i].f), 0, `${cols}x${rows}: frame ${i} is the plain insert frame`));
  });
}

test('insert timeline: the insert still ends at INSERT_END and the boot follows', async () => {
  const c = mkShell({ dirs, cols: 41, rows: 11, startScreen: { screen: 'library' } });
  try {
    c.app.start(); c.tick(2); c.goto('night-drive'); c.tick(1);
    c.key('\r');
    c.tick(INSERT_END - 0.1);
    assert.equal(c.sh().screen, 'insert');
    c.tick(0.2);
    assert.notEqual(c.sh().screen, 'insert');
  } finally { c.done(); }
});

// ---- the shell on its own (createShell, a seam for the insert picture): first and last frames, fg/bg, every tier
import { createShell, INSERT_DISSOLVE_SECONDS } from '../src/shell/shell.js';
import { newFrame } from '../src/shell/ui.js';
import { driftmanSkin } from '../src/shell/driftman.js';
import { glowFg, glowBg, RGB_CELL, GLOW_GLYPH } from './helpers-fullcolour.js';

// the seam paints every cell as a full-colour X, so a cell is the library's or the insert's by its glyph alone
const seam = (f) => { for (let i = 0; i < f.glyphs.length; i++) { f.glyphs[i] = GLOW_GLYPH; f.shades[i] = RGB_CELL; f.fg[i] = glowFg(i); f.bg[i] = glowBg(i); } };
function seamShell(cols, rows) {
  const manifest = { id: 'fx', title: 'Fixture', blurb: 'b', facts: [], programs: [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: ['a'], sceneSeconds: 20 }], start: 'main', scenes: [], labelHue: '#7FB069' };
  const cart = { id: 'fx', title: 'Fixture', manifest, locked: false, runtime: 'cartridge', label: ['+----+', '| FX |', '+----+'], labelInk: null, skin: driftmanSkin, boot: null, trusted: true };
  return createShell({
    cols, rows, cartridges: [cart], seed: 1, cmode: 'truecolor', loadScenes: async () => ({ scenes: [], errors: [] }), drawInsert: seam,
    host: { persist() {}, quit() {}, leaveToClassic() {} }, consts: { SPEEDS: [1], DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 },
  });
}
const copy = (f) => ({ g: f.glyphs.slice(), s: f.shades.slice(), fg: f.fg ? f.fg.slice() : null, bg: f.bg ? f.bg.slice() : null, p: f.palette });

for (const [cols, rows] of [[41, 11], [40, 12], [40, 10], [39, 11], [30, 8], [80, 24], [120, 40]]) {
  test(`insert dissolve ${cols}x${rows} (${sizeTier(cols, rows)}) shell: first and last frame, fg/bg, one palette`, () => {
    const sh = seamShell(cols, rows);
    sh.tick(1);
    const lib = copy(sh.frame());
    assert.equal(sh.state().screen, 'library');
    sh.actions.libInsert();
    assert.equal(sh.state().screen, 'insert');
    const n = cols * rows;
    const small = ['list', 'tiny'].includes(sizeTier(cols, rows));
    const first = copy(sh.frame());
    if (small) {
      // the very first insert frame is the library as last drawn, cell for cell (the kept copy, not the live buffer the insert just drew over)
      assert.deepEqual([...first.g], [...lib.g]);
      assert.deepEqual([...first.s], [...lib.s]);
    } else {
      assert.ok(first.g.every((g) => g === GLOW_GLYPH), 'compact and full: the first insert frame is the insert picture (the cut)');
    }
    // halfway through: a mix, and every insert cell carries its own fg/bg
    sh.tick(INSERT_DISSOLVE_SECONDS / 2);
    const mid = copy(sh.frame());
    let ins = 0;
    for (let i = 0; i < n; i++) if (mid.g[i] === GLOW_GLYPH && mid.s[i] === RGB_CELL) { ins++; assert.equal(mid.fg[i], glowFg(i)); assert.equal(mid.bg[i], glowBg(i)); }
    if (small) assert.ok(ins > n * 0.3 && ins < n * 0.7, `${ins} of ${n} cells are the insert's halfway`);
    else assert.equal(ins, n);
    // and at the end it is the plain insert picture, with its colours
    sh.tick(INSERT_DISSOLVE_SECONDS);
    const last = copy(sh.frame());
    assert.equal(sh.state().screen, 'insert');
    for (let i = 0; i < n; i++) { assert.equal(last.g[i], GLOW_GLYPH); assert.equal(last.fg[i], glowFg(i)); assert.equal(last.bg[i], glowBg(i)); }
    // the library and the insert share one palette: no jump in it anywhere in the dissolve
    assert.equal(first.p, lib.p); assert.equal(mid.p, lib.p); assert.equal(last.p, lib.p);
  });
}
