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
