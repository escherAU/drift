// DRIFT-5: Night Drive (DM-02), the 80s neon highway cartridge. The shared suites (cartridge-scenes, cartridges, shell-*)
// already cover its scenes, glyphs, imports and code uniqueness once it is unlocked; this file holds what is Night
// Drive's own: the skin, the palette in lib/palette.js, the label, the boot art, the manifest and the help panel.
//
// Every list is read from the manifest or the files, so the file stays right as slices 2 and 3 add scenes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverCartridges, loadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { validateSkin, validateManifest, parseTextAsset, LIMITS } from '../src/cartridge/schema.js';
import { relLuminance, paletteLength } from '../src/cartridge/palette.js';
import { parseHex } from '../src/color.js';
import { renderScene } from '../src/cells.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { mkShell } from './helpers-shell.js';
import * as P from '../cartridges/night-drive/lib/palette.js';

const DIR = path.join(INSTALL_DIR, 'night-drive');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const readLines = (f) => {
  const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};
const BANNED = [0x25cd, 0x25ce, 0x25d1, 0x25e2, 0x25e3, 0x222b, 0x2261]; // ◍ ◎ ◑ ◢ ◣ ∫ ≡
const width = (s) => [...s].length;

test('night-drive skin (C2): validates, the background is deep and dark, 36 extra colours, every ui index is inside the palette', () => {
  const raw = readJson('skin.json');
  const v = validateSkin(raw);
  assert.equal(v.ok, true, v.reason);
  const skin = v.skin;
  assert.equal(skin.palette.bg.toUpperCase(), '#0D0820');
  assert.ok(relLuminance(parseHex(skin.palette.bg)) <= LIMITS.bgLuminance, 'inside the schema limit');
  assert.ok(relLuminance(parseHex(skin.palette.bg)) <= 0.01, 'and deeper than that: a violet black');
  assert.equal(skin.palette.hue.toUpperCase(), '#FF3EC8');
  assert.equal(skin.palette.colours.length, 36);
  const len = paletteLength(skin);
  assert.equal(len, 16 + 36);
  for (const [k, i] of Object.entries(skin.palette.ui)) assert.ok(Number.isInteger(i) && i >= 0 && i < len, `ui.${k} = ${i}`);
  for (const i of [skin.frame.colour, skin.console.title.colour, skin.console.title.ornamentColour, skin.boot.valueColour]) assert.ok(i >= 0 && i < len);
  assert.equal(skin.boot.art, true, 'the cassette shows above the title card');
  assert.equal(skin.frame.title, 'NIGHT DRIVE');
  assert.equal(skin.menu.layout, 'list');
  assert.equal(skin.menu.autostartSeconds, 15);
  assert.equal(skin.insert.text, 'CLUNK · TAPE IN · AUTO-REVERSE ON');
  assert.deepEqual(skin.help.groups, { Cartridge: 'Tracks', Other: 'Glovebox' });
  assert.equal(skin.help.modeLabel, 'tape');
  assert.equal(skin.help.sceneLabel, 'track');
  assert.deepEqual(skin.console.ink, { frame: 3, grille: 1, stripe: 2, led: 3, bar: 3 });
});

test('night-drive palette (C3): lib/palette.js names the skin\'s colours - each family\'s shades are 38, 58, 80 and 100 percent of its hue', () => {
  const skin = validateSkin(readJson('skin.json')).skin;
  assert.equal(paletteLength(skin), P.COUNT);
  const hex = (i) => skin.palette.colours[i - 16].toUpperCase();
  const base = { SUN: '#FFE45C', TANG: '#FF8A3D', CORAL: '#FF3D6E', MAG: '#FF3EC8', VIOLET: '#9B5CFF', CYAN: '#22E6FF', MINT: '#3DFFB0', ICE: '#E8F0FF' };
  let next = 16;
  for (const [name, h] of Object.entries(base)) {
    const fam = P[name];
    assert.equal(fam.length, 4, name);
    assert.deepEqual([...fam], [next, next + 1, next + 2, next + 3], `${name} indexes run on from the one before`);
    next += 4;
    const rgb = parseHex(h);
    [0.38, 0.58, 0.8, 1].forEach((f, s) => {
      const want = '#' + rgb.map((v) => Math.round(v * f).toString(16).padStart(2, '0')).join('').toUpperCase();
      assert.equal(hex(fam[s]), want, `${name} shade ${s}`);
    });
  }
  assert.equal(hex(P.TEXT), '#EDE6FF');
  assert.equal(hex(P.DIM), '#8576B0');
  assert.equal(hex(P.FAR), '#2A1E5C');
  assert.equal(hex(P.NEAR), '#1A1240');
  assert.equal(skin.palette.ui.text, P.TEXT);
  assert.equal(skin.palette.ui.dim, P.DIM);
  assert.equal(skin.palette.ui.head, P.CYAN[3]);
  assert.equal(skin.palette.ui.accent, P.MAG[3]);
  assert.equal(skin.frame.colour, P.MAG[3]);
  // colour(name, shade) clamps the shade and falls back to ice for a name it does not know
  assert.equal(P.colour('sun', 0), P.SUN[0]);
  assert.equal(P.colour('mag', 3), P.MAG[3]);
  assert.equal(P.colour('mag', 9), P.MAG[3]);
  assert.equal(P.colour('mag', -2), P.MAG[0]);
  assert.equal(P.colour('nope', 1), P.ICE[1]);
});

test('night-drive label (C4): 10 rows, one exactly 24 wide, none wider; allowed glyphs only and none of the banned set; the ink is digits 0-3 exactly where the art is', () => {
  const label = readLines('label.txt');
  assert.equal(label.length, 10, 'ten rows');
  const widths = label.map(width);
  assert.ok(widths.every((n) => n <= 24), `widths ${widths}`);
  assert.equal(widths.filter((n) => n === 24).length >= 1, true, 'at least one row is exactly 24 wide');
  assert.equal(parseTextAsset(label.join('\n'), { maxW: 24, maxH: 10 }).ok, true);
  for (const row of label) for (const ch of row) {
    assert.ok(isAllowedGlyph(ch.codePointAt(0)), `U+${ch.codePointAt(0).toString(16)} is not allowed`);
    assert.ok(!BANNED.includes(ch.codePointAt(0)), `banned glyph ${ch}`);
  }
  for (const ch of '◍◎◑◢◣∫≡') assert.ok(!label.join('').includes(ch), `banned ${ch}`);
  const ink = readLines('label-ink.txt');
  assert.equal(ink.length, label.length, 'ink has the same rows');
  assert.ok(ink.every((r) => /^[0-3 ]*$/.test(r)), 'digits 0 to 3 and spaces only');
  assert.ok(ink.every((r) => width(r) <= 24));
  label.forEach((row, j) => {
    const cells = [...row], inks = [...(ink[j] || '')];
    for (let i = 0; i < Math.max(cells.length, inks.length); i++) {
      const art = cells[i] !== undefined && cells[i] !== ' ', dig = inks[i] !== undefined && inks[i] !== ' ';
      assert.equal(dig, art, `row ${j} column ${i}: ink ${dig ? 'is' : 'is not'} there but the art ${art ? 'is' : 'is not'}`);
    }
  });
  // the picture: a sun, mountains, a horizon, a road to a point, a car ahead on it
  const all = label.join('\n');
  for (const part of ['▄▄██████▄▄', '▟', '▙', '╱╲', '▐░░░░▌', '▐█━━━━█▌']) assert.ok(all.includes(part), part);
  // the old locked card is gone
  assert.ok(!all.includes('│ │'));
});

test('night-drive boot art (C5): at most 56 columns by 6 rows (it must fit above the title card at 80x24), one shade, allowed glyphs only, switched on in the skin', () => {
  const boot = readLines('boot.txt');
  assert.ok(boot.length >= 3 && boot.length <= 6, `${boot.length} rows`);
  assert.ok(boot.every((r) => width(r) <= 56), `widths ${boot.map(width)}`);
  assert.equal(new Set(boot.map(width)).size, 1, 'a clean rectangle');
  assert.equal(parseTextAsset(boot.join('\n'), { maxW: LIMITS.bootW, maxH: LIMITS.bootH }).ok, true);
  for (const row of boot) for (const ch of row) {
    assert.ok(isAllowedGlyph(ch.codePointAt(0)), `U+${ch.codePointAt(0).toString(16)} is not allowed`);
    assert.ok(!BANNED.includes(ch.codePointAt(0)), `banned glyph ${ch}`);
  }
  assert.equal(fs.existsSync(path.join(DIR, 'boot-ink.txt')), false, 'boot art has no ink file: it is drawn in one shade');
  assert.equal(validateSkin(readJson('skin.json')).skin.boot.art, true);
  // the art shows only if it fits floor((rows - 7) / 2) - 2 rows: 6 at 80x24
  assert.equal(Math.floor((24 - 7) / 2) - 2, 6);
  assert.ok(boot.length <= Math.floor((24 - 7) / 2) - 2);
  // and it is a cassette: two reels and the name of the tape
  assert.ok(boot.join('\n').includes('NIGHT DRIVE'));
  assert.equal(boot.join('\n').split('●').length - 1, 2, 'two reels');
  // the four typed lines fit the boot screen (40 columns, the part after the dots is the value)
  const skin = validateSkin(readJson('skin.json')).skin;
  assert.equal(skin.boot.lines.length, 4);
  assert.ok(skin.boot.lines.every((l) => width(l) <= 40));
});
