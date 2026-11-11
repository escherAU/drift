// DRIFT-4 B1 (schema item 1): the skin's `console` block as DRAWN - the takeover style, the insert sweep and the eject
// that reverses it, the stripe and the grille, and the boot's title card (style, colour, ornament).
// The 'no console block' arm is pinned two ways: the style functions return exactly today's objects, and a digest of
// today's frames (recorded from the code before this change) still matches.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { discoverCartridges } from '../src/cartridge/loader.js';
import { validateSkin } from '../src/cartridge/schema.js';
import * as libMod from '../src/shell/library.js';
import { drawLibrary, shelfLayout, SLOT_BOX, CONSOLE_W } from '../src/shell/library.js';
import { drawBoot, bootPhases, titleOrnament, mergeBootPalette } from '../src/shell/boot.js';
import { drawInsert, INSERT_END, sweepStyle } from '../src/shell/insert.js';
import { driftmanSkin, DRIFTMAN_COLOURS } from '../src/shell/driftman.js';
import { libraryPalette } from '../src/shell/shell.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { newFrame } from '../src/shell/ui.js';
import { frameLines } from './helpers-help.js';
import { makeRoot } from './helpers-shell.js';

const root = makeRoot();
const { cartridges } = discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
const lib = libraryPalette(cartridges, 'truecolor');
const fixture = cartridges.find((c) => c.id === 'fixture');
const entries = cartridges.map((c, i) => ({
  id: c.id, title: c.title, code: '', blurb: c.manifest.blurb, facts: ['Genre: test', 'Players: 1'],
  locked: c.locked, label: c.label, ink: null, tint: lib.tints[i],
}));
const view = (index = 0) => ({ cartridges: entries, index, prev: index, slide: 1, message: '', dip: 0 });
const TINT = entries[1].tint;
const ui = driftmanSkin.palette.ui;

const FRAME_ONLY = { show: 'always', glyphs: '+-+|+-+|', colour: 3 };
const CONSOLE = {
  frame: '┏━┓┃┛━┗┃', grille: '═', stripe: '▁▂▃', ink: { frame: 1, grille: 0, stripe: 2, led: 2, bar: 1 },
  title: { style: 'spaced', ornament: '── ◆ ──', colour: 15, ornamentColour: 7 },
};
const valid = (s) => { const r = validateSkin(JSON.parse(JSON.stringify(s))); assert.equal(r.ok, true, r.reason); return r.skin; };
const plainSkin = valid({ ...fixture.skin, frame: FRAME_ONLY });
const consoleSkin = valid({ ...fixture.skin, frame: FRAME_ONLY, console: CONSOLE });
const item = (cartSkin, classic = false) => ({ cartridge: classic ? entries[0] : entries[1], view: view(classic ? 0 : 1), cartSkin, classic });
const L = shelfLayout(120, 40, 'full');

const insertAt = (cols, rows, t, it) => { const f = newFrame(cols, rows); drawInsert(f, { item: it, t }, driftmanSkin); return f; };
const cell = (f, x, y) => ({ g: String.fromCharCode(f.glyphs[y * f.cols + x]), s: f.shades[y * f.cols + x] });
const rowText = (f, y) => frameLines(f)[y];

// ---- the style function

test('takeoverStyle: without a console block it returns exactly what the old sweepStyle returned', () => {
  assert.equal(typeof libMod.takeoverStyle, 'function');
  const a = libMod.takeoverStyle(plainSkin, TINT, false, undefined, ui);
  assert.deepEqual(a, { style: { box: '+-+|+-+|', shade: TINT + 2, bar: TINT + 3 }, band: { box: '+-+|+-+|', shade: TINT + 3, bar: ui.head } });
  assert.deepEqual(libMod.takeoverStyle(null, TINT, false, undefined, ui),
    { style: { box: SLOT_BOX, shade: TINT + 2, bar: TINT + 3 }, band: { box: SLOT_BOX, shade: TINT + 3, bar: ui.head } }, 'no skin: the bezel');
  assert.deepEqual(libMod.takeoverStyle({}, TINT, false, {}, ui),
    { style: { box: SLOT_BOX, shade: TINT + 2, bar: TINT + 3 }, band: { box: SLOT_BOX, shade: TINT + 3, bar: ui.head } }, 'an empty block changes nothing');
  assert.deepEqual(libMod.takeoverStyle(consoleSkin, TINT, true, consoleSkin.console, ui),
    { style: {}, band: { shade: DRIFTMAN_COLOURS.dim, bar: ui.head } }, 'Classic keeps today\'s values whatever the skin says');
  assert.deepEqual(sweepStyle(item(plainSkin), ui), libMod.takeoverStyle(plainSkin, TINT, false, undefined, ui), 'sweepStyle is takeoverStyle');
  assert.deepEqual(sweepStyle(item(null, true), ui), { style: {}, band: { shade: DRIFTMAN_COLOURS.dim, bar: ui.head } });
});

test('takeoverStyle: a console block gives the box, the shades and the glyphs; the band is one level up (capped at 3)', () => {
  const t = libMod.takeoverStyle(consoleSkin, TINT, false, consoleSkin.console, ui);
  assert.equal(t.style.box, '┏━┓┃┛━┗┃', 'console.frame wins over frame.glyphs');
  assert.equal(t.style.shade, TINT + 1);
  assert.equal(t.style.bar, TINT + 1);
  assert.equal(t.style.grille, 0x2550);
  assert.equal(t.style.grilleShade, TINT + 0);
  assert.equal(t.style.stripe, '▁▂▃');
  assert.equal(t.style.stripeShade, TINT + 2);
  assert.equal(t.style.ledShade, TINT + 2);
  assert.equal(t.band.shade, TINT + 2);
  assert.equal(t.band.grilleShade, TINT + 1);
  assert.equal(t.band.stripeShade, TINT + 3);
  assert.equal(t.band.ledShade, TINT + 3);
  assert.equal(t.band.bar, ui.head);
  const three = libMod.takeoverStyle(valid({ ...fixture.skin, console: { ink: { frame: 3, grille: 3, stripe: 3, led: 3, bar: 3 } } }), TINT, false, { ink: { frame: 3, grille: 3, stripe: 3, led: 3, bar: 3 } }, ui);
  assert.equal(three.band.shade, TINT + 3, 'a band cannot go past level 3');
  assert.equal(three.band.ledShade, TINT + 3);
  // frame.glyphs is used when there is no console.frame; ink left out keeps today's levels and the accent LED
  const g = libMod.takeoverStyle(plainSkin, TINT, false, { stripe: '╱' }, ui);
  assert.equal(g.style.box, '+-+|+-+|');
  assert.equal(g.style.shade, TINT + 2);
  assert.equal(g.style.bar, TINT + 3);
  assert.equal(g.style.ledShade, undefined, 'the LED stays the accent colour unless ink.led is given');
  assert.equal(g.style.stripeShade, undefined);
});

// ---- the drawing

test('insert sweep: at 1.5 s the console shows console.frame, the stripe and the grille at their ink levels; at 1.0 s none of them', () => {
  const it = item(consoleSkin);
  const row2 = L.consoleTop + 2;
  const done = insertAt(120, 40, 1.5, it), before = insertAt(120, 40, 1.0, it);
  assert.equal(cell(done, L.consoleX, row2).g, '┏');
  assert.equal(cell(done, L.consoleX, row2).s, TINT + 1, 'slot row in tint + ink.frame');
  assert.equal(cell(before, L.consoleX, row2).g, '╭');
  assert.ok(!rowText(before, row2).includes('┏'));
  const band = L.consoleTop + 15;
  assert.ok(rowText(done, band).includes('▁▂▃▁▂▃▁▂▃'), 'the stripe is tiled across the band row');
  assert.ok(!rowText(before, band).includes('▁▂▃'), 'and is not there before the sweep');
  assert.equal(cell(done, L.consoleX + 31, band).s, TINT + 2, 'stripe in tint + ink.stripe');
  const gx = L.consoleX + 53 + 14, gy = L.consoleTop + 6;
  assert.equal(cell(done, gx, gy).g, '═');
  assert.equal(cell(done, gx, gy).s, TINT + 0, 'grille in tint + ink.grille');
  assert.equal(cell(before, gx, gy).g, '▒', 'today\'s grille before the sweep');
  // the title bar text takes ink.bar
  const barRow = L.consoleTop + 15;
  assert.equal(cell(done, L.consoleX + 3, barRow).s, TINT + 1);
});

test('insert sweep: at 1.25 s the swapped frame shows behind the band and the old one ahead of it (the ┏ sits left of the ╮)', () => {
  const f = insertAt(120, 40, 1.25, item(consoleSkin));
  const row2 = rowText(f, L.consoleTop + 2);
  const a = row2.indexOf('┏'), b = row2.indexOf('╮');
  assert.ok(a >= 0 && b >= 0, `both frames are on the row: ${row2}`);
  assert.ok(a < b);
  assert.equal(row2.indexOf('╭'), -1);
  assert.equal(row2.indexOf('┓'), -1, 'the right corner is not swapped yet');
  // the stripe tiles from the left: swapped behind the band, today's glyphs ahead of it
  const bandRow = rowText(f, L.consoleTop + 15);
  assert.ok(bandRow.indexOf('▁▂▃') >= 0 && bandRow.indexOf('▁▂▃') < bandRow.indexOf('╱'));
});

test('eject reverses it: the same frames play backwards and the console comes back whole', () => {
  // eject draws drawInsert at INSERT_END * (1 - u); so the frame at t reversed equals the frame at t going in
  const it = item(consoleSkin);
  const rest = newFrame(120, 40);
  drawLibrary(rest, view(1), driftmanSkin);
  const f0 = insertAt(120, 40, 0, it);
  assert.equal(frameLines(f0).join('\n'), frameLines(rest).join('\n').replace(/\n$/, ''), 'nothing of the console skin at t = 0');
  let swapped = -1;
  for (let t = 1.0; t <= INSERT_END + 1e-9; t += 0.05) {
    const f = insertAt(120, 40, Math.min(t, INSERT_END), it);
    const n = [...rowText(f, L.consoleTop + 2)].filter((c) => c === '┏' || c === '━').length;
    assert.ok(n >= swapped, 'the swapped frame only grows going in (so only shrinks coming out)');
    swapped = n;
  }
});

test('a compact console (80x24) takes the frame and the LED too, and draws without a stripe or grille', () => {
  const f = insertAt(80, 24, INSERT_END, item(consoleSkin));
  const lines = frameLines(f);
  assert.ok(lines.some((l) => l.includes('┏')), 'the mini console is re-framed');
  assert.ok(!lines.some((l) => l.includes('▁▂▃')));
});

// ---- the pinned default arm: today's frames

const hashFrames = (frames) => {
  const h = crypto.createHash('sha1');
  for (const f of frames) { h.update(Buffer.from(f.glyphs.buffer, f.glyphs.byteOffset, f.glyphs.byteLength)); h.update(Buffer.from(f.shades.buffer, f.shades.byteOffset, f.shades.byteLength)); }
  return h.digest('hex');
};
const TIMES = [0, 0.3, 0.6, 0.9, 1.0, 1.1, 1.25, 1.4, 1.5];
const BOOT_SKIN_PLAIN = { ...plainSkin, boot: { lines: ['CARTRIDGE ...... FIXTURE', 'MEMORY 64K ..... OK'], art: false } };
const bootFrame = (cols, rows, t, skin, it, o = {}) => {
  const cartPal = makeSkinPalette(skin, 'truecolor', 'fixture');
  const merged = mergeBootPalette(cartPal, lib.pal, TINT);
  const f = newFrame(cols, rows);
  drawBoot(f, { skin, item: it, t, loading: false, title: 'Fixture', consoleMap: merged.map, ...o }, driftmanSkin);
  return f;
};
const BP = bootPhases(BOOT_SKIN_PLAIN);
const digests = () => ({
  insertSkinned: hashFrames([[120, 40], [80, 24], [30, 10]].flatMap(([c, r]) => TIMES.map((t) => insertAt(c, r, t, item(plainSkin))))),
  insertClassic: hashFrames([[120, 40], [80, 24]].flatMap(([c, r]) => TIMES.map((t) => insertAt(c, r, t, item(null, true))))),
  boot: hashFrames([[120, 40], [80, 24], [40, 12]].flatMap(([c, r]) => [0.1, BP.on + 0.5, BP.zoomEnd - 0.1, BP.zoomEnd + 0.1, BP.titleEnd].map((t) => bootFrame(c, r, t, BOOT_SKIN_PLAIN, item(plainSkin))))),
});
const GOLDEN = {
  insertSkinned: 'bb7474c93f67454444eec5ca6031b3759a49acbb',
  insertClassic: '54d028d23be6d9a8499d8e4900d3711e2bd76fe9',
  // DRIFT-4 flash fix: the 40x12 (list tier) boot frames of the rectangle opening and zooming are now a dissolve, not
  // moving edges (tests/shell-flash-sizes.test.js); the 120x40 and 80x24 frames in this hash are byte-identical to before
  // (the old digest e25276f4631c8574cfe955a3a91e07d3b5788e0d is the same three sizes with the old 40x12 frames).
  boot: '0450278317c0c67ba8816c85fc75e94ccc09aad5',
};

test('the no-console-block arm: insert, Classic insert and boot frames are byte-identical to the ones drawn before this change', () => {
  const d = digests();
  if (process.env.PRINT_DIGESTS) console.log('DIGESTS', JSON.stringify(d));
  assert.deepEqual(d, GOLDEN);
  // and an empty console block is the same thing
  const empty = valid({ ...fixture.skin, frame: FRAME_ONLY, console: {} });
  assert.equal(hashFrames(TIMES.map((t) => insertAt(120, 40, t, item(empty)))), hashFrames(TIMES.map((t) => insertAt(120, 40, t, item(plainSkin)))));
});

// ---- the boot's title card

const SKIN_B = (title) => valid({ ...fixture.skin, frame: FRAME_ONLY, boot: { lines: ['CARTRIDGE ...... FIXTURE'], art: false }, console: { title } });
const titleFrame = (cols, rows, skin, t, extra = {}) => bootFrame(cols, rows, t, skin, item(skin), extra);
const TP = bootPhases(SKIN_B({}));
const head = (skin) => makeSkinPalette(skin, 'truecolor', 'fixture').ui;
const rowsWith = (f, re) => frameLines(f).map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);

test('boot title card: style block is today\'s; spaced is single-spaced plain text with no block glyph; plain is centred text', () => {
  const block = titleFrame(120, 40, SKIN_B({ style: 'block' }), TP.titleEnd);
  const dflt = titleFrame(120, 40, SKIN_B({}), TP.titleEnd);
  assert.deepEqual(Array.from(block.glyphs), Array.from(dflt.glyphs), 'block = the default');
  assert.ok(block.glyphs.includes(0x2588), 'block letters');
  const spaced = titleFrame(120, 40, SKIN_B({ style: 'spaced' }), TP.titleEnd);
  assert.ok(frameLines(spaced).some((l) => l.includes('F I X T U R E')), 'F I X T U R E');
  assert.ok(!spaced.glyphs.includes(0x2588), 'no block glyph anywhere');
  const plain = titleFrame(120, 40, SKIN_B({ style: 'plain' }), TP.titleEnd);
  const pr = rowsWith(plain, /FIXTURE/);
  assert.equal(pr.length, 1);
  assert.ok(!plain.glyphs.includes(0x2588));
  // centred: the text's left and right margins differ by at most 1
  const line = frameLines(plain)[pr[0]];
  const left = line.indexOf('FIXTURE'), right = line.length - (left + 7);
  assert.ok(Math.abs(left - right) <= 1, `centred (${left} / ${right})`);
  const sp = frameLines(spaced).find((l) => l.includes('F I X T U R E'));
  const sl = sp.indexOf('F I X T U R E');
  assert.ok(Math.abs(sl - (sp.length - (sl + 13))) <= 1, 'spaced is centred too');
});

test('boot title card: the title colour is title.colour (else the head colour)', () => {
  const skin = SKIN_B({ style: 'plain', colour: 6 });
  const f = titleFrame(120, 40, skin, TP.titleEnd);
  const y = rowsWith(f, /FIXTURE/)[0];
  const x = frameLines(f)[y].indexOf('FIXTURE');
  assert.equal(cell(f, x, y).s, 6);
  const d = titleFrame(120, 40, SKIN_B({ style: 'plain' }), TP.titleEnd);
  assert.equal(cell(d, x, y).s, head(SKIN_B({})).head, 'the head colour by default');
  // block letters take it too
  const b = titleFrame(120, 40, SKIN_B({ colour: 6 }), TP.titleEnd);
  const shades = new Set();
  for (let i = 0; i < b.glyphs.length; i++) if (b.glyphs[i] === 0x2588) shades.add(b.shades[i]);
  assert.ok(shades.has(6));
});

test('boot title card: the ornament row sits under the title, in ornamentColour (else dim), revealed with the title; skipped when there is no room', () => {
  const orn = '── ◆ ──';
  for (const style of ['block', 'spaced', 'plain']) {
    const skin = SKIN_B({ style, ornament: orn, ornamentColour: 7 });
    assert.equal(titleOrnament(skin), orn);
    const f = titleFrame(120, 40, skin, TP.titleEnd);
    const ys = rowsWith(f, /── ◆ ──/);
    assert.equal(ys.length, 1, `${style}: ornament row`);
    const titleRows = style === 'block' ? rowsWith(f, /█/) : rowsWith(f, /FIXTURE|F I X/);
    assert.ok(ys[0] > Math.max(...titleRows), `${style}: under the title`);
    assert.ok(ys[0] - Math.max(...titleRows) <= 2);
    const x = frameLines(f)[ys[0]].indexOf('◆');
    assert.equal(cell(f, x, ys[0]).s, 7, `${style}: ornamentColour`);
    // revealed with the title: part-way it is shorter
    const part = titleFrame(120, 40, skin, TP.zoomEnd + 0.1);
    const shown = (g) => (frameLines(g)[ys[0]].match(/[─◆]/g) || []).length;
    assert.ok(shown(part) < shown(f), `${style}: dissolves in`);
    // no ornamentColour: the dim colour
    const dflt = titleFrame(120, 40, SKIN_B({ style, ornament: orn }), TP.titleEnd);
    assert.equal(cell(dflt, x, ys[0]).s, head(SKIN_B({})).dim);
  }
  // no room: 6 rows leaves nowhere for it, and nothing throws
  const small = titleFrame(30, 6, SKIN_B({ style: 'plain', ornament: orn }), TP.titleEnd);
  assert.equal(rowsWith(small, /── ◆ ──/).length, 0);
});

test('boot title card: sizes down to 4x2, 40x12 and tiny tiers never throw, with and without a console block', () => {
  const sizes = [[240, 67], [120, 40], [80, 24], [40, 12], [30, 10], [12, 5], [7, 4], [6, 3], [5, 3], [4, 2], [1, 1]];
  const skins = ['block', 'spaced', 'plain'].map((style) => SKIN_B({ style, ornament: '── ◆ ──', colour: 3, ornamentColour: 4 }));
  for (const [c, r] of sizes) {
    for (const skin of [...skins, plainSkin]) {
      for (const t of [0, TP.zoomEnd, TP.zoomEnd + 0.1, TP.titleEnd, 99]) {
        assert.doesNotThrow(() => titleFrame(c, r, skin, t), `${c}x${r}`);
        assert.doesNotThrow(() => titleFrame(c, r, skin, t, { labelArt: fixture.label }), `${c}x${r} with the label`);
      }
    }
  }
});
