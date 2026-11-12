// DRIFT-7 C1: every palette carries fgRgb / bgRgb / fg256 / bg256 tables that agree, entry by entry, with its sgr strings.
// The sgr strings are parsed HERE ONLY, to check the tables; the source builds both side by side and never parses them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makePalette, makeMultiPalette, makeTwoTone, PRESETS, CHAOS_PALETTES, presetRGB, rgbTo256 } from '../src/color.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { libraryPalette } from '../src/shell/shell.js';
import { mergeBootPalette } from '../src/shell/boot.js';
import { driftmanSkin } from '../src/shell/driftman.js';
import { LIMITS } from '../src/cartridge/schema.js';
import { LEVELS } from '../src/ramp.js';

const unpack = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const pack = (c) => ((c[0] << 16) | (c[1] << 8) | c[2]) >>> 0;

// The colour an sgr string sets for ground '38' (fg) or '48' (bg): { rgb } in truecolor, { idx } in 256, null when absent.
function parseGround(s, ground) {
  let m = new RegExp(`\\x1b\\[${ground};2;(\\d+);(\\d+);(\\d+)m`).exec(s);
  if (m) return { rgb: [+m[1], +m[2], +m[3]] };
  m = new RegExp(`\\x1b\\[${ground};5;(\\d+)m`).exec(s);
  if (m) return { idx: +m[1] };
  return null;
}

// Returns a list of mismatch descriptions (empty = the tables agree with the sgr strings).
function checkTables(pal, mode) {
  const bad = [];
  const n = pal.sgr.length;
  for (const k of ['fgRgb', 'bgRgb']) if (!(pal[k] instanceof Uint32Array) || pal[k].length !== n) bad.push(`${k} is not a Uint32Array of ${n}`);
  for (const k of ['fg256', 'bg256']) if (!(pal[k] instanceof Uint8Array) || pal[k].length !== n) bad.push(`${k} is not a Uint8Array of ${n}`);
  if (bad.length) return bad;
  for (let i = 0; i < n; i++) {
    const f = parseGround(pal.sgr[i], '38'), b = parseGround(pal.sgr[i], '48');
    if (!f) { bad.push(`[${i}] sgr has no foreground`); continue; }
    if (mode === 'truecolor') {
      if (pal.fgRgb[i] !== pack(f.rgb)) bad.push(`[${i}] fgRgb ${pal.fgRgb[i].toString(16)} != sgr ${pack(f.rgb).toString(16)}`);
      if (pal.fg256[i] !== rgbTo256(f.rgb)) bad.push(`[${i}] fg256 ${pal.fg256[i]} != rgbTo256(sgr) ${rgbTo256(f.rgb)}`);
    } else {
      if (pal.fg256[i] !== f.idx) bad.push(`[${i}] fg256 ${pal.fg256[i]} != sgr ${f.idx}`);
      if (rgbTo256(unpack(pal.fgRgb[i])) !== f.idx) bad.push(`[${i}] fgRgb ${pal.fgRgb[i].toString(16)} does not map to sgr index ${f.idx}`);
    }
    if (b) {
      if (mode === 'truecolor') {
        if (pal.bgRgb[i] !== pack(b.rgb)) bad.push(`[${i}] bgRgb ${pal.bgRgb[i].toString(16)} != sgr ${pack(b.rgb).toString(16)}`);
        if (pal.bg256[i] !== rgbTo256(b.rgb)) bad.push(`[${i}] bg256 ${pal.bg256[i]} != rgbTo256(sgr) ${rgbTo256(b.rgb)}`);
      } else {
        if (pal.bg256[i] !== b.idx) bad.push(`[${i}] bg256 ${pal.bg256[i]} != sgr ${b.idx}`);
        if (rgbTo256(unpack(pal.bgRgb[i])) !== b.idx) bad.push(`[${i}] bgRgb does not map to sgr index ${b.idx}`);
      }
    } else {
      // No background in the sgr: the palette has no bg of its own, so the table says black.
      if (pal.bgRgb[i] !== 0) bad.push(`[${i}] no bg in sgr but bgRgb ${pal.bgRgb[i].toString(16)}`);
      if (pal.bg256[i] !== rgbTo256([0, 0, 0])) bad.push(`[${i}] no bg in sgr but bg256 ${pal.bg256[i]}`);
      if (pal.bg) bad.push(`[${i}] palette says bg but the sgr carries none`);
    }
  }
  return bad;
}

const MODES = ['truecolor', '256'];
const skinFile = (id) => JSON.parse(fs.readFileSync(new URL(`../cartridges/${id}/skin.json`, import.meta.url), 'utf8'));
const hex = (i) => '#' + ((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, '0');
// A synthetic skin at the schema maximum (16 levels + paletteColours extras), with or without a background.
const maxSkin = (withBg) => ({ palette: { hue: '#7FB069', colours: Array.from({ length: LIMITS.paletteColours }, (_, i) => hex(i + 1)), ...(withBg ? { bg: '#102030' } : {}) } });

const sizes = {};
const note = (name, pal) => { sizes[name] = Math.max(sizes[name] || 0, pal.sgr.length); assert.ok(pal.sgr.length < 256, `${name}: ${pal.sgr.length} entries leaves no room for index 255`); };

for (const mode of MODES) {
  test(`makePalette tables match sgr (${mode}): every preset and a blend sample`, () => {
    for (const p of PRESETS) {
      const times = p.blend ? [0, 7, 30, 60, 90, 119] : [0];
      for (const t of times) {
        const pal = makePalette(presetRGB(p.id, t), mode);
        assert.deepEqual(checkTables(pal, mode), [], `${p.id} t=${t}`);
        assert.equal(pal.sgr.length, LEVELS);
        note('calm', pal);
      }
    }
  });
  test(`makeMultiPalette tables match sgr (${mode}): neon and every chaos palette`, () => {
    for (const c of CHAOS_PALETTES) {
      const pal = makeMultiPalette(c.id, mode);
      assert.deepEqual(checkTables(pal, mode), [], c.id);
      note('multi', pal);
    }
  });
  test(`makeTwoTone tables match sgr (${mode}): normal and inverted`, () => {
    for (const inv of [false, true]) {
      const pal = makeTwoTone(inv, mode);
      assert.deepEqual(checkTables(pal, mode), [], inv ? 'inverted' : 'normal');
      assert.equal(pal.bgRgb[0], inv ? 0xffffff : 0x000000);
      assert.equal(pal.fgRgb[0], inv ? 0x000000 : 0xffffff);
      note('twotone', pal);
    }
  });
  test(`makeSkinPalette tables match sgr (${mode}): delza, night-drive, driftman, synthetic max skin with and without bg`, () => {
    const skins = { delza: skinFile('delza'), 'night-drive': skinFile('night-drive'), driftman: driftmanSkin, 'max-bg': maxSkin(true), 'max-nobg': maxSkin(false) };
    for (const [id, skin] of Object.entries(skins)) {
      const pal = makeSkinPalette(skin, mode, id);
      assert.deepEqual(checkTables(pal, mode), [], id);
      note('skin', pal);
    }
    assert.equal(makeSkinPalette(maxSkin(true), mode, 'm').sgr.length, LEVELS + LIMITS.paletteColours);
  });
  test(`libraryPalette tables match sgr (${mode}): empty, three cartridges, and LIMITS.cartridges of them`, () => {
    for (const n of [0, 3, LIMITS.cartridges]) {
      const carts = Array.from({ length: n }, (_, i) => ({ manifest: i % 3 === 2 ? {} : { labelHue: hex(i + 7) } }));
      const { pal, tints } = libraryPalette(carts, mode);
      assert.deepEqual(checkTables(pal, mode), [], `${n} cartridges`);
      assert.equal(tints.length, n);
      note('library', pal);
    }
    assert.equal(libraryPalette(Array.from({ length: LIMITS.cartridges }, () => ({ manifest: {} })), mode).pal.sgr.length, 20 + 4 * LIMITS.cartridges);
  });
  test(`mergeBootPalette tables match sgr (${mode}): cartridge skins with and without a background`, () => {
    const carts = Array.from({ length: 5 }, (_, i) => ({ manifest: { labelHue: hex(i + 3) } }));
    const lib = libraryPalette(carts, mode);
    const cartSkins = { delza: skinFile('delza'), 'night-drive': skinFile('night-drive'), 'max-bg': maxSkin(true), 'max-nobg': maxSkin(false) };
    for (const [id, skin] of Object.entries(cartSkins)) {
      for (const ti of [0, 4]) {
        const cartPal = makeSkinPalette(skin, mode, id);
        const { pal } = mergeBootPalette(cartPal, lib.pal, lib.tints[ti]);
        assert.deepEqual(checkTables(pal, mode), [], `${id} tint ${ti}`);
        // the cartridge's own entries are untouched
        for (const k of ['fgRgb', 'bgRgb', 'fg256', 'bg256']) assert.deepEqual([...pal[k].slice(0, cartPal.sgr.length)], [...cartPal[k]], `${id} ${k} head`);
        note('boot', pal);
      }
    }
    assert.equal(mergeBootPalette(makeSkinPalette(maxSkin(true), mode, 'm'), lib.pal, lib.tints[0]).pal.sgr.length, 88);
  });
}

test('the tables do not depend on the colour mode', () => {
  const a = makeSkinPalette(skinFile('delza'), 'truecolor', 'd'), b = makeSkinPalette(skinFile('delza'), '256', 'd');
  for (const k of ['fgRgb', 'bgRgb', 'fg256', 'bg256']) assert.deepEqual([...a[k]], [...b[k]], k);
});

test('existing palette properties are unchanged: key, sgr, ui, bg, base', () => {
  const p = makeSkinPalette(skinFile('delza'), 'truecolor', 'delza');
  assert.deepEqual(Object.keys(p).filter((k) => !['fgRgb', 'bgRgb', 'fg256', 'bg256'].includes(k)).sort(), ['base', 'bg', 'key', 'sgr', 'ui']);
  assert.deepEqual(Object.keys(makePalette([1, 2, 3], 'truecolor')).sort(), ['bg256', 'bgRgb', 'fg256', 'fgRgb', 'key', 'sgr']);
});

test('maximum palette sizes stay under 256 so index 255 is never a real shade', () => {
  assert.equal(sizes.skin, LEVELS + LIMITS.paletteColours); // 64
  assert.equal(sizes.library, 20 + 4 * LIMITS.cartridges); // 220
  assert.equal(sizes.boot, 88);
  assert.equal(sizes.multi, 35);
  assert.equal(sizes.calm, 16);
  assert.equal(sizes.twotone, 1);
  for (const [k, v] of Object.entries(sizes)) assert.ok(v < 256, k);
});

test('schema invariants: the sums the palettes rely on fit in 255', () => {
  assert.ok(LEVELS + LIMITS.paletteColours + 24 <= 255, '16 + 48 + 24');
  assert.ok(20 + 4 * LIMITS.cartridges <= 255, '20 + 4 * 50');
});

test('control: the checker fails when one table entry is wrong', () => {
  for (const mode of MODES) {
    for (const k of ['fgRgb', 'bgRgb', 'fg256', 'bg256']) {
      const pal = makeSkinPalette(skinFile('delza'), mode, 'delza');
      assert.deepEqual(checkTables(pal, mode), []);
      // the Rgb tables are checked exactly in truecolor and by their 256 mapping in 256 mode, so flip enough to change that
      pal[k][20] = pal[k][20] ^ (k.endsWith('Rgb') ? 0xffffff : 0x01);
      assert.notDeepEqual(checkTables(pal, mode), [], `${mode} ${k}`);
    }
  }
  const lib = libraryPalette([{ manifest: { labelHue: '#aabbcc' } }], 'truecolor').pal;
  lib.fgRgb[lib.sgr.length - 1] ^= 0x010000;
  assert.notDeepEqual(checkTables(lib, 'truecolor'), []);
});
