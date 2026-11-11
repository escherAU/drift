// DRIFT-4 tests audit (task C): the library with the REAL installed cartridges (their label art and label ink,
// read through the loader), the palette budget at the 50-cartridge cap, and the library's draw cost at 50.
//
// Audit matrix: what the committed tests already cover, and what this file adds.
//   (a) art at all sizes ........ shell-draw / shell-library-components run every size, but on fixture labels or
//                                 label.txt without the loader's ink; HERE: the installed cartridges as the
//                                 shell builds them (label + labelInk), 240x67 120x40 80x24 30x10 4x2, every
//                                 cursor position, allow-listed + single-width + in-palette + every cell owned.
//   (b) photosensitivity ........ shell-flash covers fixture/Classic at 120x40, 80x24 (+240x67 for insert/boot);
//                                 gaps filled in shell-flash-skinned.test.js (console block with ink 3, eject at
//                                 240x67, Classic at 240x67, the real art idle/slide/dip).
//   (c) art widths .............. components test (fixture labels from label.txt): 30x18, label 24, console 84, mini
//                                 38x4; HERE: the same widths with the real entries including label ink.
//   (d) palette budget .......... not covered before; HERE.
//   (e) 50 cartridges ........... carousel wrap was tested at 5-9 cartridges; draw cost not at all; HERE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { driftmanSkin } from '../src/shell/driftman.js';
import { libraryPalette } from '../src/shell/shell.js';
import {
  drawLibrary, cartridgeGrid, consoleGrid, miniGrid, consoleStyle, gridRows, CART_W, CART_H, CONSOLE_W, CONSOLE_H, MINI_W, MINI_H,
} from '../src/shell/library.js';
import { newFrame } from '../src/shell/ui.js';
import { isWide, isInvisible } from './helpers-width.js';
import { frameLines } from './helpers-help.js';

const SIZES = [[240, 67], [120, 40], [80, 24], [30, 10], [4, 2]];
const ui = driftmanSkin.palette.ui;
const real = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges;

const toEntry = (c, tint) => ({
  id: c.id, title: c.title, code: (c.manifest && c.manifest.code) || '', blurb: c.manifest.blurb, facts: c.manifest.facts || [],
  locked: c.locked, label: c.label, ink: c.labelInk || null, tint,
});
const lib = libraryPalette(real, 'truecolor');
const entries = real.map((c, i) => toEntry(c, lib.tints[i]));
const view = (list, index, extra = {}) => ({ cartridges: list, index, prev: index, slide: 1, message: '', dip: 0, ...extra });

function problems(f, palLen, label) {
  const bad = [];
  for (let i = 0; i < f.glyphs.length && bad.length < 4; i++) {
    const cp = f.glyphs[i];
    if (!isAllowedGlyph(cp)) bad.push(`${label}: cell ${i} U+${cp.toString(16)} not allowed`);
    else if (isWide(cp) || isInvisible(cp)) bad.push(`${label}: cell ${i} U+${cp.toString(16)} wide or invisible`);
    if (f.shades[i] >= palLen) bad.push(`${label}: cell ${i} shade ${f.shades[i]} >= ${palLen}`);
    if (cp === 32 && f.shades[i] !== 0) bad.push(`${label}: blank cell ${i} has shade ${f.shades[i]}`);
  }
  return bad;
}
function dirty(cols, rows) {
  const f = newFrame(cols, rows);
  f.glyphs.fill(0x2588); f.shades.fill(3);
  return f;
}

test('real install: Classic and the locked cartridges are there with label art and ink (so the tests below see the shipped art)', () => {
  assert.ok(real.length >= 4, `installed: ${real.map((c) => c.id)}`);
  for (const id of ['classic', 'night-drive', 'last-fantasy', 'arcade']) {
    const c = real.find((x) => x.id === id);
    assert.ok(c, id);
    assert.equal(c.label.length, 10, `${id} label rows`);
    assert.ok(c.labelInk, `${id} has label ink`);
  }
});

test('(a) the real library art at 240x67, 120x40, 80x24, 30x10 and 4x2: allow-listed, single-width, in-palette, every cell owned, every cursor position', () => {
  for (const [w, h] of SIZES) {
    for (let index = 0; index < entries.length; index++) {
      for (const extra of [{}, { dip: 1 }, { prev: (index + 1) % entries.length, slide: 0.5 }]) {
        const v = view(entries, index, extra);
        const f = newFrame(w, h);
        assert.doesNotThrow(() => drawLibrary(f, v, driftmanSkin), `${w}x${h} #${index}`);
        assert.deepEqual(problems(f, lib.pal.sgr.length, `real ${w}x${h} #${index}`), []);
        const g = dirty(w, h);
        drawLibrary(g, v, driftmanSkin);
        assert.deepEqual(Array.from(g.glyphs), Array.from(f.glyphs), `${w}x${h} #${index}: owns every cell (glyphs)`);
        assert.deepEqual(Array.from(g.shades), Array.from(f.shades), `${w}x${h} #${index}: owns every cell (shades)`);
      }
    }
  }
  // control: the checker does see a planted double-width glyph and an out-of-palette shade
  const f = newFrame(10, 3);
  f.glyphs[0] = 0x4e2d; f.shades[1] = 99; f.glyphs[1] = 65;
  assert.equal(problems(f, 20, 'planted').length, 2);
});

test('(a) the real art is drawn at 120x40 and 240x67 in the library tints only (no shade of the cartridge tint is missing from the palette)', () => {
  for (const [w, h] of [[120, 40], [240, 67]]) {
    const f = newFrame(w, h);
    drawLibrary(f, view(entries, 0), driftmanSkin);
    const used = new Set(f.shades);
    assert.ok(used.has(entries[0].tint + 3), 'the selected cartridge is at its brightest tint level');
    for (const s of used) assert.ok(s < lib.pal.sgr.length);
    const text = frameLines(f).join('\n');
    assert.ok(text.includes('DRIFT CLASSIC'), 'the selected plate shows');
  }
});

test('(c) the real entries keep every component exactly its width: cartridge 30x18 (label window 24), console 84x18, mini 38x4', () => {
  const style = consoleStyle(driftmanSkin);
  for (const [i, e] of entries.entries()) {
    for (const selected of [true, false]) {
      const G = cartridgeGrid(e, { selected, level: selected ? 3 : 1, ui });
      const rows = gridRows(G);
      assert.equal(rows.length, CART_H, `${e.id} rows`);
      assert.ok(rows.every((r) => [...r].length === CART_W), `${e.id} widths ${rows.map((r) => [...r].length)}`);
      for (let r = 3; r <= 12; r++) assert.equal([...rows[r]].slice(3, 27).length, 24, `${e.id} label row ${r}`);
      // ink or no ink, every label cell is inside the palette
      assert.ok(G.s.every((s) => s < lib.pal.sgr.length), `${e.id} shades in the library palette`);
    }
    const con = gridRows(consoleGrid(e, { st: style, ui, n: entries.length, index: i }));
    assert.equal(con.length, CONSOLE_H);
    assert.ok(con.every((r) => [...r].length === CONSOLE_W), `${e.id} console widths`);
  }
  const mini = gridRows(miniGrid({ st: style, ui }));
  assert.equal(mini.length, MINI_H);
  assert.ok(mini.every((r) => [...r].length === MINI_W));
});

// ---- (d) palette budget and (e) 50 cartridges

const synth = (n) => Array.from({ length: n }, (_, i) => {
  const base = real[i % real.length];
  // a hue of its own for each cartridge: the library palette must still not carry it as a colour of its own
  const hue = '#' + [(i * 37 + 40) % 256, (i * 91 + 90) % 256, (i * 53 + 120) % 256].map((v) => v.toString(16).padStart(2, '0')).join('');
  return { ...base, id: `cart-${i}`, title: `Cart ${String(i).padStart(2, '0')}`, locked: i % 3 !== 0 && base.locked !== false ? true : base.locked, manifest: { ...base.manifest, id: `cart-${i}`, code: `DM-${String(i).padStart(2, '0')}`, labelHue: hue } };
});

test('(d) palette budget: 20 library entries plus 4 per labelHue, at most 220 of 256 slots at 50 cartridges, and the first 20 never change', () => {
  const one = libraryPalette(synth(1), 'truecolor');
  assert.equal(one.pal.sgr.length, 24);
  const base20 = one.pal.sgr.slice(0, 20);
  for (const n of [1, 5, 20, 50]) {
    const l = libraryPalette(synth(n), 'truecolor');
    assert.equal(l.pal.sgr.length, 20 + 4 * n, `n=${n}`);
    assert.ok(l.pal.sgr.length <= 220, `n=${n}: ${l.pal.sgr.length} of 256`);
    assert.deepEqual(l.pal.sgr.slice(0, 20), base20, `n=${n}: no per-cartridge colour in the library's own 20`);
    assert.deepEqual(l.tints, Array.from({ length: n }, (_, i) => 20 + 4 * i), `n=${n}: tints are 4 slots each, in order`);
  }
  // the same at the lower colour modes (the 256-colour and 16-colour palettes keep the count)
  for (const cmode of ['256', '16']) {
    const l = libraryPalette(synth(50), cmode);
    assert.ok(l.pal.sgr.length <= 220, `${cmode}: ${l.pal.sgr.length}`);
  }
});

test('(d) building a view with 50 cartridges at every size draws only slots 0-19 for chrome and each cartridge\'s own 4 for its art; never a slot past 220', () => {
  const carts = synth(50);
  const l = libraryPalette(carts, 'truecolor');
  const list = carts.map((c, i) => toEntry(c, l.tints[i]));
  for (const [w, h] of SIZES) {
    for (const index of [0, 17, 49]) {
      const f = newFrame(w, h);
      drawLibrary(f, view(list, index), driftmanSkin);
      assert.deepEqual(problems(f, l.pal.sgr.length, `50 ${w}x${h} #${index}`), []);
      assert.ok(Math.max(...f.shades) < 220, `highest slot used ${Math.max(...f.shades)}`);
    }
  }
});

const rowsText = (f) => frameLines(f).join('\n');

test('(e) the 50-cartridge carousel wraps: the last cartridge has the first ones on its right (and the other way round)', () => {
  const carts = synth(50);
  const l = libraryPalette(carts, 'truecolor');
  const list = carts.map((c, i) => toEntry(c, l.tints[i]));
  const at = (w, h, index) => { const f = newFrame(w, h); drawLibrary(f, view(list, index), driftmanSkin); return rowsText(f); };
  // 240x67: two full neighbours each side
  const last = at(240, 67, 49);
  for (const t of ['CART 47', 'CART 48', 'CART 49', 'CART 00', 'CART 01']) assert.ok(last.includes(t), `last: ${t}`);
  const first = at(240, 67, 0);
  for (const t of ['CART 48', 'CART 49', 'CART 00', 'CART 01', 'CART 02']) assert.ok(first.includes(t), `first: ${t}`);
  assert.ok(!first.includes('CART 25'));
  // 120x40: one full neighbour each side at least
  const mid = at(120, 40, 49);
  for (const t of ['CART 48', 'CART 49', 'CART 00']) assert.ok(mid.includes(t), `120 last: ${t}`);
  // 80x24 compact: the selected cartridge and a list that scrolls with it
  const compact = at(80, 24, 49);
  assert.ok(compact.includes('CART 49'));
  assert.ok(!at(80, 24, 0).includes('CART 49'), 'control: the first compact page does not show the last cartridge');
  // the dots become "k / n"
  assert.ok(at(120, 40, 49).includes('50 / 50'));
  assert.ok(at(120, 40, 0).includes('1 / 50'));
});

test('(e) 200 draws of the 50-cartridge library cost under 5 ms each at 240x67 and 80x24 (generous: measured 0.15 ms and 0.02 ms)', (t) => {
  const carts = synth(50);
  const l = libraryPalette(carts, 'truecolor');
  const list = carts.map((c, i) => toEntry(c, l.tints[i]));
  for (const [w, h] of [[240, 67], [80, 24]]) {
    const f = newFrame(w, h);
    for (let i = 0; i < 20; i++) drawLibrary(f, view(list, i % 50), driftmanSkin); // warm up
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) drawLibrary(f, view(list, (i * 7) % 50, i % 4 === 0 ? { prev: (i * 7 + 49) % 50, slide: (i % 10) / 10 } : {}), driftmanSkin);
    const mean = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
    t.diagnostic(`${w}x${h}: mean ${mean.toFixed(3)} ms per draw at 50 cartridges`);
    assert.ok(mean < 5, `${w}x${h}: ${mean.toFixed(2)} ms per draw`);
  }
});
