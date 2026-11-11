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
import { shellHelpLines } from '../src/keymap.js';
import { layoutFor } from '../src/overlay.js';
import { mkShell } from './helpers-shell.js';
import { cartridgeCodeProblems } from './cartridges.test.js';
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

// ---- the manifest and the loader

const found = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
const cart = found.cartridges.find((c) => c.id === 'night-drive');
const manifest = cart ? cart.manifest : null;
const skin = cart ? cart.skin : null;

test('night-drive (C1): loads through the real loader with no error, unlocked, code DM-02, label hue #FF3EC8, runtime cartridge', async () => {
  assert.deepEqual(found.errors, []);
  assert.ok(cart, 'night-drive is on the shelf');
  assert.equal(cart.locked, false);
  assert.equal(Object.prototype.hasOwnProperty.call(readJson('manifest.json'), 'locked'), false, 'no locked key left in the manifest file');
  assert.equal(cart.runtime, 'cartridge');
  assert.equal(cart.trusted, true);
  assert.equal(manifest.id, 'night-drive');
  assert.equal(manifest.title, 'Night Drive');
  assert.equal(manifest.code, 'DM-02');
  assert.equal(manifest.labelHue, '#FF3EC8');
  assert.equal(manifest.blurb, 'Neon highway, late radio, and a night that never ends.');
  assert.deepEqual(manifest.facts, ['80s neon highway · about 12 min', '8 tracks on one tape, sides A and B']);
  assert.ok(skin, 'the skin loaded');
  assert.ok(cart.boot && cart.boot.length > 0, 'the boot art loaded');
  assert.equal(cart.label.length, 10);
  assert.equal(cart.labelInk.length, 10);
  assert.equal(validateManifest(readJson('manifest.json'), { trusted: true }).ok, true);
  const loaded = await loadScenes(cart);
  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(loaded.scenes.map((s) => s.id), manifest.scenes.map((s) => s.id), 'every listed scene loads, in order');
});

test('night-drive manifest (C6): every scene file exists and is the kind the manifest says, titles fit the help panel, every menu entry is in the program, labels fit, the last entry is Eject', async () => {
  const loaded = await loadScenes(cart);
  assert.ok(manifest.scenes.length >= 1 && manifest.scenes.length <= 8);
  const ids = manifest.scenes.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of manifest.scenes) {
    assert.ok(['cells', 'sim'].includes(s.kind), `${s.id}: a code scene`);
    assert.ok(fs.existsSync(path.join(DIR, 'scenes', s.id + '.js')), `scenes/${s.id}.js exists`);
    const entry = loaded.scenes.find((x) => x.id === s.id);
    assert.equal(entry.scene.kind, s.kind, `${s.id}: the scene's kind is the manifest's`);
    assert.equal(entry.scene.id, s.id);
    assert.ok(s.title && width(s.title) <= 23, `${s.id}: title '${s.title}' fits the help panel's mode line`);
  }
  // the scenes the design lists, in the design's order (a slice has an in-order subsequence of them: sundown comes before skyline exists)
  const ORDER = ['onramp', 'skyline', 'sundown', 'coast', 'redlight', 'diner', 'caller', 'overdrive'];
  const at = ids.map((id) => ORDER.indexOf(id));
  assert.ok(at.every((i) => i >= 0), 'every scene is one of the eight tracks');
  assert.ok(at.every((i, k) => k === 0 || i > at[k - 1]), 'in tape order (their indexes strictly increase)');
  assert.equal(manifest.programs.length, 1);
  const tape = manifest.programs[0];
  assert.equal(tape.id, 'tape');
  assert.equal(tape.transition, 'dissolve');
  assert.equal(tape.sceneSeconds, 90);
  assert.equal(manifest.start, 'tape');
  assert.deepEqual(tape.scenes, ids, 'the tape plays every scene in order');
  for (const id of Object.keys(tape.seconds || {})) assert.ok(ids.includes(id), `seconds names ${id}`);
  const entries = manifest.menu;
  assert.ok(entries.length <= LIMITS.menuEntries);
  for (const e of entries) assert.ok(width(e.label) <= LIMITS.menuLabel, `'${e.label}' is ${width(e.label)} wide`);
  const last = entries[entries.length - 1];
  assert.equal(last.action, 'eject', 'the last entry ejects');
  const tracks = entries.slice(0, -1);
  assert.equal(tracks.length, ids.length, 'one entry per track');
  tracks.forEach((e, i) => {
    assert.equal(e.program, 'tape');
    assert.equal(e.scene, ids[i], 'in tape order');
    assert.ok(tape.scenes.includes(e.scene), `${e.label} is in the program`);
    assert.match(e.label, /^[AB][1-4]  [A-Z][A-Z0-9 ,'-]+$/, 'side, number, name');
    assert.ok(e.note && width(e.note) <= LIMITS.menuNote);
    assert.ok(e.desc && width(e.desc) <= LIMITS.menuDesc);
    const secs = (tape.seconds && tape.seconds[e.scene]) ?? tape.sceneSeconds;
    assert.equal(e.note, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, 'the note is the track length');
  });
  assert.ok([...manifest.blurb].length <= LIMITS.blurb);
  assert.ok(manifest.facts.length >= 1 && manifest.facts.every((f) => width(f) <= LIMITS.factChars));
  // once the whole tape is on, the shelf says what it really lasts: seven tracks of 90 s and the 75 s call
  if (ids.length === ORDER.length) {
    const total = ids.reduce((n, id) => n + ((tape.seconds && tape.seconds[id]) ?? tape.sceneSeconds), 0);
    assert.equal(total, 705);
    assert.match(manifest.facts[0], new RegExp('about ' + Math.round(total / 60) + ' min'));
    assert.deepEqual(manifest.scenes.map((s) => s.kind), ['cells', 'cells', 'cells', 'cells', 'sim', 'cells', 'cells', 'sim']);
  }
});

test('night-drive help (C7): at 80x23 the Owner\'s Manual shows every row with the real titles and no "enlarge window" line; the same in the real shell', async () => {
  const sk = skin;
  const lines = shellHelpLines('running', sk);
  for (const s of manifest.scenes) {
    const info = {
      mode: 'running', modeName: 'running', sceneName: s.id, ui: sk.palette.ui,
      title: sk.help.title, box: sk.help.box, lines,
      modeLine: `${sk.help.modeLabel}: ${manifest.title}    ${sk.help.sceneLabel}: ${s.title}`,
    };
    // the row counts first (layoutFor): 18 text rows, so the roomy layout (a blank pad row inside the box) needs 22 rows and the
    // tight one 20; the engine only cuts the panel and says "enlarge window" below 17 rows
    const roomy = layoutFor(info);
    assert.equal(roomy.lines.length, 18);
    assert.ok(roomy.lines.length + 4 <= 23, '80x23 gets the roomy layout');
    assert.ok(layoutFor(info, 14).lines.some((l) => /enlarge window/.test(l.text)), 'control: at 14 rows the same panel IS cut, so the check below can fail');
    for (const rows of [23, 24, 30, 18]) {
      const lay = layoutFor(info, rows);
      assert.ok(lay.lines.length + 2 <= rows, `${rows} rows: ${lay.lines.length} text rows fit`);
      assert.ok(!lay.lines.some((l) => /enlarge window|\(\+\d+ more/.test(l.text)), `${rows} rows: nothing cut`);
      const body = lay.lines.map((l) => l.text).join('\n');
      assert.ok(body.includes(info.modeLine) || body.includes(info.title + '  ' + info.modeLine), `${s.id}: the mode line shows the real titles at ${rows} rows`);
      for (const label of Object.values(sk.wording.keys)) assert.ok(body.includes(label), `${rows} rows: '${label}'`);
      for (const g of ['Tracks', 'Glovebox']) assert.ok(body.includes(g), g);
    }
    // the real shell at 80x23, with this scene playing
    const c = mkShell({ cols: 80, rows: 23, dirs: [{ dir: INSTALL_DIR, trusted: true }], startScreen: { screen: 'library' } });
    c.app.start();
    assert.ok(c.goto('night-drive'));
    c.key('\r');
    c.tick(1.6);
    await c.settle();
    for (let i = 0; i < 400 && c.sh().screen !== 'running'; i++) c.tick(0.1);
    assert.equal(c.sh().screen, 'running');
    const idx = manifest.menu.findIndex((e) => e.scene === s.id);
    for (let k = 0; k < idx; k++) c.key('\x1b[B');
    c.key('\r');
    c.tick(0.5);
    c.key('h');
    c.tick(0.3);
    const text = c.text();
    assert.equal(c.sh().sceneId, s.id);
    assert.ok(text.includes(`tape: Night Drive    track: ${s.title}`), `${s.id}: mode line`);
    assert.ok(text.includes("OWNER'S MANUAL · keys"));
    assert.ok(!/enlarge window|\(\+\d+ more/.test(text), 'nothing is cut at 80x23');
    for (const label of Object.values(sk.wording.keys)) assert.ok(text.includes(label), `'${label}' is on the panel`);
    assert.ok(!/Modes|cartridge:|scene:/.test(text), "Classic's words are gone");
    c.done();
  }
});

test('night-drive menu: the tape deck opens on arrival with its prompt and a countdown, lists every track and Eject, and plays on by itself after 15 s', async () => {
  const c = mkShell({ cols: 120, rows: 40, dirs: [{ dir: INSTALL_DIR, trusted: true }], startScreen: { screen: 'library' } });
  c.app.start();
  assert.ok(c.goto('night-drive'));
  c.key('\r');
  c.tick(1.6);
  await c.settle();
  for (let i = 0; i < 400 && c.sh().screen !== 'running'; i++) c.tick(0.1);
  assert.equal(c.sh().cartridge, 'night-drive');
  assert.equal(c.sh().menu, true);
  const text = c.text();
  assert.ok(text.includes('TAPE DECK · SIDE A / SIDE B'));
  assert.ok(text.includes('Pick a track, or let it play.'));
  assert.match(text, /starts by itself in 1[45] s/);
  for (const e of manifest.menu) assert.ok(text.includes(e.label), `${e.label} is visible`);
  c.tick(15.5);
  assert.equal(c.sh().menu, false, 'the tape began by itself');
  assert.equal(c.sh().program, 'tape');
  c.done();
});

test('night-drive code (C8): nothing under cartridges/night-drive contains a banned glyph, and no script imports anything outside its own lib and the four permitted src modules', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = walk(DIR);
  assert.ok(files.length >= 10, `${files.length} files`);
  assert.ok(files.some((f) => f.endsWith('onramp.js')) && files.some((f) => f.endsWith('sprites.js')), 'the scan reaches scenes and lib');
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const ch of '◍◎◑◢◣∫≡') assert.ok(!text.includes(ch), `${path.relative(DIR, f)} contains ${ch}`);
    if (f.endsWith('.js')) {
      const rel = 'cartridges/night-drive/' + path.relative(DIR, f).split(path.sep).join('/');
      assert.deepEqual(cartridgeCodeProblems(text, rel), [], rel);
    }
  }
  // control: the scanner does see a planted import of another cartridge's lib, and a planted banned glyph is caught by the same loop
  assert.ok(cartridgeCodeProblems("import { x } from '../../delza/lib/canvas.js';\n", 'cartridges/night-drive/scenes/onramp.js').length > 0);
  assert.ok(cartridgeCodeProblems("import { x } from '../../../src/app.js';\n", 'cartridges/night-drive/scenes/onramp.js').length > 0);
  assert.ok('a ◢ b'.includes('◢'));
});

test('night-drive scenes (C9): every scene in the manifest, at 120x40, 80x24 and 240x67 over a spread of times, draws allowed glyphs in colours inside the palette', async () => {
  const loaded = await loadScenes(cart);
  const len = paletteLength(skin);
  assert.ok(loaded.scenes.length >= 1);
  for (const entry of loaded.scenes) {
    for (const [w, h] of [[120, 40], [80, 24], [240, 67]]) {
      for (const t of [0, 1.7, 8.3, 30, 49.5, 61, 88]) {
        const f = renderScene(entry.scene, t, w, h, 1);
        let lit = 0;
        for (let i = 0; i < f.glyphs.length; i++) {
          assert.ok(isAllowedGlyph(f.glyphs[i]), `${entry.id} ${w}x${h} t=${t} U+${f.glyphs[i].toString(16)}`);
          assert.ok(!BANNED.includes(f.glyphs[i]));
          assert.ok(f.colours[i] < len, `${entry.id}: colour ${f.colours[i]}`);
          if (f.glyphs[i] !== 32) lit++;
        }
        assert.ok(lit > w * h * 0.03 && lit < w * h * 0.9, `${entry.id} ${w}x${h} t=${t}: ${lit} cells lit`);
      }
    }
  }
});

test('night-drive palette (C10): none of its colours is in the library palette or anywhere in src/ (the skin is the cartridge\'s own)', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const src = walk(path.join(DIR, '..', '..', 'src')).filter((f) => /\.(js|mjs|json)$/.test(f));
  assert.ok(src.length > 30);
  const mine = ['#0D0820', '#FF3EC8', '#EDE6FF', '#8576B0', '#2A1E5C', '#1A1240', '#22E6FF', '#3DFFB0', '#FFE45C', '#FF8A3D', '#FF3D6E', '#9B5CFF', '#E8F0FF', '#5A3594', '#CC32A0'];
  for (const f of src) {
    const text = fs.readFileSync(f, 'utf8').toUpperCase();
    for (const hex of mine) assert.ok(!text.includes(hex), `${path.basename(f)} holds ${hex}`);
    assert.ok(!text.includes('NITE86') && !text.includes('NIGHT-DRIVE'), `${path.basename(f)} names the cartridge`);
  }
});
