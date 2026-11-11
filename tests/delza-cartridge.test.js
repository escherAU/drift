// DRIFT-4: Delza, the first real cartridge (woodsy fantasy). Loads from the install folder like any other, so the shared
// suites (cartridge-scenes, cartridges, shell-*) already cover her scenes, glyphs, imports and code uniqueness; this file
// holds what is Delza's own: the manifest, the skin (palette, console block, help wording, boot), the Journal menu at the
// sizes the designer drew, the countdown, the seasons key and a smoke render of every scene at 240x67.
//
// Every list is read from the manifest, so the file stays right as chapters are added.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverCartridges, loadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { validateSkin, validateManifest, LIMITS } from '../src/cartridge/schema.js';
import { makeSkinPalette, relLuminance, paletteLength } from '../src/cartridge/palette.js';
import { parseHex } from '../src/color.js';
import { renderScene } from '../src/cells.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { createCartridgeRuntime } from '../src/shell/runtime.js';
import { newFrame } from '../src/shell/ui.js';
import { SPEEDS, DISSOLVE_SECONDS, DEFAULT_FADE_SECONDS } from '../src/app.js';
import { mkShell } from './helpers-shell.js';
import { frameLines } from './helpers-help.js';
import * as P from '../cartridges/delza/lib/palette.js';

const DIR = path.join(INSTALL_DIR, 'delza');
const found = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
const cart = found.cartridges.find((c) => c.id === 'delza');
const manifest = cart.manifest;
const skin = cart.skin;
const LIB = { screen: 'library' };

test('delza: the install folder loads with no errors and Delza is unlocked with the shelf code DM-01', () => {
  assert.deepEqual(found.errors, []);
  assert.ok(cart, 'delza is on the shelf');
  assert.equal(cart.locked, false);
  assert.equal(cart.runtime, 'cartridge');
  assert.equal(manifest.code, 'DM-01');
  assert.equal(cart.trusted, true);
});

test('delza manifest: blurb, facts and label art fit their limits; every scene is a chapter and has a Journal entry; the menu ends with Eject', () => {
  assert.ok([...manifest.blurb].length <= LIMITS.blurb, manifest.blurb);
  assert.ok(manifest.facts.length >= 1 && manifest.facts.every((f) => [...f].length <= LIMITS.factChars));
  assert.equal(cart.label.length, 10, 'label is 10 rows');
  assert.ok(cart.label.every((r) => [...r].length <= 24));
  assert.equal(cart.labelInk.length, 10, 'label ink is 10 rows');
  const ink = fs.readFileSync(path.join(DIR, 'label-ink.txt'), 'utf8');
  assert.ok(!/[^0-3 \r\n]/.test(ink), 'ink is digits 0 to 3');
  assert.match(manifest.labelHue, /^#[0-9A-Fa-f]{6}$/);
  const sceneIds = manifest.scenes.map((s) => s.id);
  assert.deepEqual(manifest.chapters.map((c) => c.id), sceneIds, 'one chapter per scene, in order');
  const tale = manifest.programs.find((p) => p.id === 'tale');
  assert.equal(tale.transition, 'dissolve');
  assert.equal(manifest.start, 'tale');
  assert.deepEqual(tale.scenes, sceneIds, 'the tale plays every scene in order');
  const entries = manifest.menu;
  assert.ok(entries.length <= LIMITS.menuEntries);
  assert.deepEqual(entries.slice(0, -1).map((e) => e.scene), sceneIds, 'a Journal entry per scene');
  for (const e of entries.slice(0, -1)) { assert.equal(e.program, 'tale'); assert.ok(e.note && e.desc); }
  assert.deepEqual(entries[entries.length - 1], { label: 'Eject the cartridge', action: 'eject' });
  const numerals = manifest.chapters.map((c) => c.numeral);
  assert.deepEqual(numerals, ['I', 'II', 'III', 'IV', 'V', 'VI'].slice(0, numerals.length), 'Roman numerals in order');
  for (const c of manifest.chapters) assert.ok([...c.line].length <= 64 && [...c.place].length <= 30);
  assert.ok(validateManifest(JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')), { trusted: true }).ok);
});

test('delza skin: validates, the background is deep and dark, the console block and the help wording are the designer\'s', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'skin.json'), 'utf8'));
  const v = validateSkin(raw);
  assert.equal(v.ok, true, v.reason);
  assert.equal(skin.palette.bg.toUpperCase(), '#0F1A12');
  assert.ok(relLuminance(parseHex(skin.palette.bg)) <= 0.02, 'luminance 0.02 or less (the schema allows 0.05)');
  const c = skin.console;
  assert.equal(c.frame, '◆═◆║◆═◆║');
  assert.equal(c.grille, '▒');
  assert.match(c.stripe, /Ψ · Δ · Ξ · Φ · Ω/);
  assert.deepEqual(c.ink, { frame: 3, grille: 1, stripe: 2, led: 3, bar: 3 });
  assert.equal(c.title.ornament, 'Ψ · Δ · Ξ · Φ · Ω');
  assert.equal(skin.frame.title, "THE WAYFARER'S JOURNAL");
  assert.equal(skin.menu.layout, 'slots');
  assert.equal(skin.menu.title, "THE WAYFARER'S JOURNAL");
  assert.equal(skin.menu.autostartSeconds, 15);
  assert.equal(skin.help.modeLabel, 'tale');
  assert.equal(skin.help.sceneLabel, 'chapter');
  assert.deepEqual(skin.help.groups, { Cartridge: 'Chapters', Other: 'Camp' });
  assert.equal(skin.help.title, 'JOURNAL · how to travel');
  assert.equal(skin.insert.text.length > 0, true);
  assert.ok(skin.seasons.length >= 1, 'the c key has seasons');
  for (const s of skin.seasons) assert.ok(relLuminance(parseHex(skin.palette.bg)) <= 0.05, s.name);
});

test('delza palette: lib/palette.js names the skin\'s colours - each family\'s shades are 38, 58, 80 and 100 percent of its hue', () => {
  assert.equal(paletteLength(skin), P.COUNT);
  const hex = (i) => skin.palette.colours[i - 16].toUpperCase();
  const base = { MOSS: '#3F7A4A', BARK: '#8A5A3B', PARCH: '#E8D9B0', GOLD: '#D9A441', EMBER: '#E0663A', DUSK: '#8D6BB3', STONE: '#9AA3A8' };
  for (const [name, h] of Object.entries(base)) {
    const fam = P[name];
    assert.equal(fam.length, 4, name);
    const rgb = parseHex(h);
    [0.38, 0.58, 0.8, 1].forEach((f, s) => {
      const want = '#' + rgb.map((v) => Math.round(v * f).toString(16).padStart(2, '0')).join('').toUpperCase();
      assert.equal(hex(fam[s]), want, `${name} shade ${s}`);
    });
  }
  assert.equal(hex(P.DIM), '#8F8466');
  assert.equal(skin.palette.ui.text, P.PARCH[3]);
  assert.equal(skin.palette.ui.dim, P.DIM);
  assert.equal(skin.palette.ui.head, P.GOLD[3]);
  assert.equal(skin.palette.ui.accent, P.GOLD[3]);
  // the leaf family comes from the hue ramp (so the seasons recolour it): four increasing levels
  assert.ok(P.LEAF.every((v, i) => v < 16 && (i === 0 || v > P.LEAF[i - 1])));
  // brighter() climbs a family one shade at a time and stops at the top; entries outside a family do not move
  assert.equal(P.brighter(P.EMBER[1]), P.EMBER[2]);
  assert.equal(P.brighter(P.EMBER[1], 2), P.EMBER[3]);
  assert.equal(P.brighter(P.EMBER[2], 5), P.EMBER[3]);
  assert.equal(P.brighter(P.LEAF[0]), P.LEAF[1]);
  assert.equal(P.brighter(0), 0);
  assert.equal(P.brighter(P.DIM), P.DIM);
  assert.equal(P.brighter(P.GOLD[1], 0), P.GOLD[1]);
});

// ---- the scenes, at the largest size

const loaded = await loadScenes(cart);
test('delza scenes: every scene in the manifest loads (smoke render at 20x8 passes the loader)', () => {
  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(loaded.scenes.map((s) => s.id), manifest.scenes.map((s) => s.id));
});

for (const entry of loaded.scenes) {
  test(`delza/${entry.id}: renders at 240x67 and 80x24 over a minute with allowed glyphs, palette-valid colours and plenty on screen`, () => {
    const palLen = paletteLength(skin);
    for (const [w, h] of [[240, 67], [80, 24]]) {
      for (const t of [0, 3.3, 12, 47, 61.5]) {
        const f = renderScene(entry.scene, t, w, h, 1);
        let lit = 0;
        for (let i = 0; i < f.glyphs.length; i++) {
          assert.ok(isAllowedGlyph(f.glyphs[i]), `${w}x${h} t=${t} U+${f.glyphs[i].toString(16)}`);
          assert.ok(f.colours[i] < palLen);
          if (f.glyphs[i] !== 32) lit++;
        }
        assert.ok(lit > w * h * 0.04, `${entry.id} ${w}x${h} t=${t}: ${lit} cells lit`);
        assert.ok(lit < w * h * 0.9, `${entry.id} ${w}x${h} t=${t}: not a wall`);
      }
    }
  });
}

// ---- the Journal and the boot, in the real shell

// library -> Enter on Delza -> through insert and boot, stopping at the first screen named by `until` (default running)
async function insertDelza(c, until = 'running') {
  assert.ok(c.goto('delza'), 'Delza is on the shelf');
  c.key('\r');
  c.tick(1.6);
  await c.settle();
  for (let i = 0; i < 400 && c.sh().screen !== until; i++) c.tick(0.1);
  assert.equal(c.sh().screen, until);
}
const realDirs = [{ dir: INSTALL_DIR, trusted: true }];
const shellFor = (cols, rows) => mkShell({ cols, rows, dirs: realDirs, startScreen: LIB });

for (const [cols, rows] of [[120, 40], [80, 24]]) {
  test(`delza Journal at ${cols}x${rows}: the frame, title, prompt and countdown are up; every chapter and Eject is visible; the selected one is framed`, async () => {
    const c = shellFor(cols, rows);
    c.app.start();
    await insertDelza(c);
    assert.equal(c.sh().cartridge, 'delza');
    assert.equal(c.sh().menu, true, 'the Journal is open on arrival');
    const text = c.text();
    assert.ok(text.includes("THE WAYFARER'S JOURNAL"), 'title in the frame');
    assert.ok(text.includes('Choose where the tale begins.'), 'prompt');
    assert.match(text, /starts by itself in 1[45] s/);
    for (const ch of manifest.chapters) {
      const entry = manifest.menu.find((e) => e.scene === ch.id);
      assert.ok(text.includes(entry.label), `${entry.label} is visible`);
      assert.ok(text.includes(ch.numeral), 'its numeral');
      assert.ok(text.includes(ch.line), `${ch.id}: its line is whole`);
    }
    assert.ok(text.includes('Eject the cartridge'));
    assert.ok(text.includes('Ψ · Δ · Ξ · Φ · Ω'), 'the ornament in the bottom edge');
    const lines = frameLines(c.app.screenshot());
    assert.equal(lines[0][0], '◆');
    assert.equal(lines[rows - 1][cols - 1], '◆');
    if (rows >= 30) assert.ok(text.includes('╔') && text.split('╔').length === 2, 'exactly one double-line card: the selected one');
    else assert.ok(/▶\s+▲ ▲ ▲/.test(text), 'the cursor sits on the first chapter');
    // the arrow keys move the cursor down the chapters and wrap past Eject
    c.key('\x1b[B');
    c.tick(0.3);
    const second = c.text();
    assert.ok(!/starts by itself/.test(second), 'a key cancels the countdown');
    const secondLabel = manifest.menu[1].label;
    const row = frameLines(c.app.screenshot()).find((l) => l.includes(secondLabel));
    assert.ok(row && row.indexOf('▶') >= 0 && row.indexOf('▶') < row.indexOf(secondLabel), `the cursor is on ${secondLabel}: ${row}`);
    c.done();
  });
}

test('delza Journal: drawn by the runtime at 30x10 and 4x2 without throwing (and at 120x40 again after a resize)', async () => {
  const pal = makeSkinPalette(skin, 'truecolor', 'delza');
  const rt = createCartridgeRuntime(cart, loaded.scenes, pal, { cols: 120, rows: 40, seed: 1, skin, cmode: 'truecolor', SPEEDS, DISSOLVE_SECONDS, DEFAULT_FADE_SECONDS });
  rt.open();
  rt.startAuto();
  for (const [cols, rows] of [[120, 40], [30, 10], [4, 2], [80, 24], [1, 1]]) {
    rt.resize(cols, rows);
    const f = newFrame(cols, rows);
    assert.doesNotThrow(() => { rt.advance(0.3); rt.frame(f); }, `${cols}x${rows}`);
    for (let i = 0; i < f.glyphs.length; i++) assert.ok(isAllowedGlyph(f.glyphs[i]) && f.shades[i] < paletteLength(skin), `${cols}x${rows} cell ${i}`);
  }
});

test('delza help panel: tale and chapter labels, the Journal title, group headings Chapters and Camp, no mode keys', async () => {
  const c = shellFor(120, 40);
  c.app.start();
  await insertDelza(c);
  c.key('h');
  c.tick(0.3);
  const t = c.text();
  assert.match(t, /tale: Delza/);
  assert.match(t, new RegExp('chapter: ' + manifest.scenes.find((s) => s.id === c.sh().sceneId).title));
  assert.ok(t.includes('JOURNAL · how to travel'));
  assert.match(t, /\bChapters\b/);
  assert.match(t, /\bCamp\b/);
  assert.ok(!/Modes|cartridge:|scene:/.test(t), 'Classic\'s words are gone');
  for (const row of ['next chapter', 'rest (pause) or carry on', 'show or hide these keys', 'open the journal, or choose', 'next season (colours)', 'eject the cartridge']) assert.ok(t.includes(row), row);
  c.done();
});

test('delza boot: four lines of her own after the two core lines, all 40 characters or fewer, typed in order on the console screen', async () => {
  assert.equal(skin.boot.lines.length, 4);
  assert.ok(skin.boot.lines.every((l) => [...l].length <= 40));
  assert.equal(skin.boot.valueColour, P.GOLD[3]);
  const c = shellFor(120, 40);
  c.app.start();
  assert.ok(c.goto('delza'));
  c.key('\r');
  c.tick(1.6);
  await c.settle();
  const want = ['DRIFTMAN 2000 · CORE 2.0', 'MEMORY 64K ..... OK', ...skin.boot.lines];
  let all = null;
  for (let i = 0; i < 80 && !all; i++) {
    c.tick(0.1);
    const lines = frameLines(c.app.screenshot());
    const ys = want.map((w) => lines.findIndex((l) => l.includes(w)));
    if (ys.every((y) => y >= 0)) all = ys;
  }
  assert.ok(all, 'all six boot lines appeared on the boot screen');
  assert.deepEqual(all, [...all].sort((a, b) => a - b), 'in order, top to bottom');
  assert.equal(new Set(all).size, 6, 'six distinct rows');
  c.done();
});

test('delza countdown: the Journal starts by itself after 15 s, any key cancels it', async () => {
  const a = shellFor(120, 40);
  a.app.start();
  await insertDelza(a);
  a.tick(15.5);
  assert.equal(a.sh().menu, false, 'the tale began by itself');
  assert.equal(a.sh().program, 'tale');
  a.done();
  const b = shellFor(120, 40);
  b.app.start();
  await insertDelza(b);
  b.tick(5);
  b.key('x');
  b.key('\x1b[B');
  b.tick(14);
  assert.equal(b.sh().menu, true, 'cancelled: still open after 19 s of play');
  b.done();
});

test('delza seasons: c walks the skin\'s hue through Autumn and Moonlit and back; the glyphs do not change, only the leaf colours', async () => {
  const c = shellFor(120, 40);
  c.app.start();
  await insertDelza(c);
  c.key('\x1b'); // close the Journal so the scene is bare
  c.tick(0.5);
  const before = c.app.screenshot();
  const sgr0 = before.palette.sgr[P.LEAF[3]];
  c.key('c');
  c.tick(1);
  const sgr1 = c.app.screenshot().palette.sgr[P.LEAF[3]];
  assert.notEqual(sgr0, sgr1, 'Autumn recolours the leaf');
  assert.equal(c.app.screenshot().palette.sgr[P.GOLD[3]], before.palette.sgr[P.GOLD[3]], 'gold stays gold');
  assert.equal(c.app.screenshot().palette.sgr[P.MOSS[1]], before.palette.sgr[P.MOSS[1]], 'moss stays moss');
  c.key('c');
  c.tick(1);
  const sgr2 = c.app.screenshot().palette.sgr[P.LEAF[3]];
  assert.notEqual(sgr2, sgr1);
  c.key('c');
  c.tick(1);
  assert.equal(c.app.screenshot().palette.sgr[P.LEAF[3]], sgr0, 'and round to the start');
  c.done();
});
