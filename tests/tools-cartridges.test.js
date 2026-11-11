// DRIFT-4: the cartridge captures (tools/capture.mjs runCaptureCartridges). Its own names list and its own
// test; the K3 mode-capture test in tools.test.js pins a different list and is not touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCaptureCartridges, cartridgeCaptureNames, CART_MOMENTS, EJECT_MOMENTS, MODE_CAPTURE_NAMES, CAPTURE_NAMES, FIGHT_MOMENTS, CUTSCENE_MOMENTS, HINT_MOMENT } from '../tools/capture.mjs';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { INSERT_END } from '../src/shell/insert.js';
import { EJECT_SECONDS } from '../src/shell/shell.js';
import { makeRoot } from './helpers-shell.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'drift-tools-cart-'));
const blocks = (text) => text.split(/=== [^\n]*\n/).slice(1);
const CAPTURE_TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'capture.mjs');
// the size a capture file is drawn at, from its name
const sizeOf = (name) => { const m = /(\d+)x(\d+)(?:-t\d+)?\.txt$/.exec(name); return m ? [+m[1], +m[2]] : [120, 40]; };

test('cartridge captures: the names list is the files written - library at 120x40 and 80x24 per cartridge, 240x67, the list tier, insert/boot at the moments, the Classic help', async () => {
  const dir = tmp();
  try {
    const files = await runCaptureCartridges({ outDir: dir });
    const carts = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges;
    assert.ok(carts.some((c) => c.id === 'classic') && carts.some((c) => c.locked), 'install has classic and locked cartridges');
    const want = ['cart-library-240x67.txt', 'cart-library-list-60x14.txt', 'cart-help-classic-120x40.txt'];
    for (const c of carts) {
      for (const sz of ['120x40', '80x24']) want.push(`cart-library-${c.id}-${sz}.txt`);
      if (c.locked) continue;
      for (const m of CART_MOMENTS) {
        const ms = Math.round(m * 1000);
        const kind = m < INSERT_END ? 'insert' : 'boot';
        want.push(`cart-${kind}-${c.id}-t${ms}.txt`, `cart-${kind}-${c.id}-80x24-t${ms}.txt`);
      }
      // a cartridge that runs in the shell (Delza) also gets eject files at both sizes; Classic has none
      if (c.runtime !== 'classic') for (const m of EJECT_MOMENTS) { const ms = Math.round(m * 1000); want.push(`cart-eject-${c.id}-t${ms}.txt`, `cart-eject-${c.id}-80x24-t${ms}.txt`); }
    }
    // Delza's own set (cart-delza-*): written out by hand, not read from the tool's list
    const ms = (s) => Math.round(s * 1000);
    want.push('cart-delza-library-240x67.txt', `cart-delza-boot-hint-t${ms(HINT_MOMENT)}.txt`,
      'cart-delza-journal-120x40.txt', 'cart-delza-journal-80x24.txt', 'cart-delza-help-120x40.txt', 'cart-delza-help-80x24.txt');
    for (const id of ['thornwell', 'tallow', 'cinderhorn', 'reach', 'highcandle', 'lampwarden']) for (const sec of [2, 20, 40]) want.push(`cart-delza-scene-${id}-t${sec}.txt`);
    for (const m of FIGHT_MOMENTS) want.push(`cart-delza-fight-t${ms(m)}.txt`);
    for (const m of CUTSCENE_MOMENTS) want.push(`cart-delza-cutscene-t${ms(m)}.txt`);
    assert.equal(FIGHT_MOMENTS.length, 5);
    assert.equal(CUTSCENE_MOMENTS.length, 4);
    assert.deepEqual(cartridgeCaptureNames().sort(), want.slice().sort());
    assert.deepEqual(fs.readdirSync(dir).sort(), want.slice().sort());
    assert.equal(files.length, want.length);
    // the moments the task names: about 0.4, 0.9, 1.25, 1.6, 2.5, 3.4, 4.2, 5.0, 5.6 s from Enter (3.4, not 3.6: Classic's bar is whole there)
    assert.deepEqual(CART_MOMENTS, [0.4, 0.9, 1.25, 1.6, 2.5, 3.4, 4.2, 5.0, 5.6]);
    assert.ok(CART_MOMENTS.some((m) => m < INSERT_END) && CART_MOMENTS.some((m) => m >= INSERT_END), 'insert before 1.5 s, boot after');
    for (const f of want) {
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.ok(t.length > 500, `${f}: not empty`);
      assert.ok(!t.includes('\x1b'), `${f}: plain text`);
      const body = blocks(t);
      assert.equal(body.length, 1, `${f}: one frame`);
      const [cols, rows] = sizeOf(f);
      const lines = body[0].replace(/\n$/, '').split('\n');
      assert.equal(lines.length, rows, f);
      for (const l of lines) {
        assert.equal([...l].length, cols, f);
        for (const ch of l) assert.ok(isAllowedGlyph(ch.codePointAt(0)), `${f} U+${ch.codePointAt(0).toString(16)}`);
      }
      assert.ok(body[0].trim().length > 0, `${f}: something is drawn`);
    }
    // each cartridge has its own library page at each size; the animations move; the names do not collide with K3's lists
    for (const sz of ['120x40', '80x24']) {
      const libs = carts.map((c) => fs.readFileSync(path.join(dir, `cart-library-${c.id}-${sz}.txt`), 'utf8'));
      assert.equal(new Set(libs).size, libs.length, `${sz}: library pages differ per cartridge`);
    }
    for (const c of carts.filter((x) => !x.locked)) {
      for (const tag of ['', '-80x24']) {
        const seq = (kind) => CART_MOMENTS.filter((m) => (m < INSERT_END) === (kind === 'insert'))
          .map((m) => fs.readFileSync(path.join(dir, `cart-${kind}-${c.id}${tag}-t${Math.round(m * 1000)}.txt`), 'utf8'));
        assert.equal(new Set(seq('insert')).size, 3, `insert${tag}: three distinct frames`);
        assert.ok(new Set(seq('boot')).size >= 5, `boot${tag}: the frames change over time`);
      }
    }
    const others = [...CAPTURE_NAMES, ...MODE_CAPTURE_NAMES];
    for (const n of want) assert.ok(!others.includes(n), n);
    // locked cartridges have no insert, boot or eject file
    for (const c of carts.filter((x) => x.locked)) assert.ok(!fs.readdirSync(dir).some((f) => /^cart-(insert|boot|eject)-/.test(f) && f.includes(`-${c.id}-`)));
    // the extra-large and list files really are those tiers
    assert.ok(fs.readFileSync(path.join(dir, 'cart-library-list-60x14.txt'), 'utf8').includes('CARTRIDGES'));
    assert.ok(/ DM-0\d/.test(fs.readFileSync(path.join(dir, 'cart-library-240x67.txt'), 'utf8')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cartridge captures: the Classic help is the Classic help panel with the l row, drawn by the real app after the console hands back', async () => {
  const dir = tmp();
  try {
    await runCaptureCartridges({ outDir: dir });
    const help = fs.readFileSync(path.join(dir, 'cart-help-classic-120x40.txt'), 'utf8').split('\n');
    const calm = fs.readFileSync(new URL('../captures/help-calm.txt', import.meta.url), 'utf8').split('\n');
    assert.ok(help.join('\n').includes('l             cartridge library'));
    // the panel (rows 4-34, columns 38-80) is the same panel; only the scene behind it differs
    for (let r = 4; r <= 34; r++) assert.equal([...help[r]].slice(38, 81).join(''), [...calm[r]].slice(38, 81).join(''), `row ${r}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const HINT_TEXT = 'e ejects · h shows the keys';
const BAR_WHOLE = /\[█*[▉▊▋▌▍▎▏]? *\]/; // filled cells, at most one partial cell, then empty: no hole in the bar

test('cartridge captures: every insert/boot file shows the plain bar (the first-insert hint is spent first); only cart-delza-boot-hint carries it; Classic\'s bar is whole at 3.4 s', async () => {
  const dir = tmp();
  try {
    await runCaptureCartridges({ outDir: dir });
    const files = fs.readdirSync(dir);
    for (const f of files.filter((n) => /^cart-(insert|boot)-/.test(n))) assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes(HINT_TEXT), `${f}: no hint`);
    const hint = fs.readFileSync(path.join(dir, `cart-delza-boot-hint-t${Math.round(HINT_MOMENT * 1000)}.txt`), 'utf8');
    assert.ok(hint.includes(HINT_TEXT), 'the hint capture has the hint');
    // the same moment without the hint is the plain boot file, and differs from it
    const plain = fs.readFileSync(path.join(dir, `cart-boot-delza-t${Math.round(HINT_MOMENT * 1000)}.txt`), 'utf8');
    assert.notEqual(blocks(hint)[0], blocks(plain)[0]);
    assert.deepEqual(files.filter((n) => fs.readFileSync(path.join(dir, n), 'utf8').includes(HINT_TEXT)), [`cart-delza-boot-hint-t${Math.round(HINT_MOMENT * 1000)}.txt`], 'exactly one file shows the hint');
    // Classic: the bar is whole at 3.4 s, in both sizes (control: the line the old 3.6 s capture held fails the pattern)
    for (const n of ['cart-boot-classic-t3400.txt', 'cart-boot-classic-80x24-t3400.txt']) {
      const bar = fs.readFileSync(path.join(dir, n), 'utf8').split('\n').find((l) => /\[[█▉▊▋▌▍▎▏ ]+\]/.test(l));
      assert.ok(bar && BAR_WHOLE.test(bar), `${n}: a whole bar, got ${bar}`);
    }
    assert.ok(!BAR_WHOLE.test('│ ║│ [███████████████████████████████████ ████] │║'), 'control: a bar with a hole is rejected');
    assert.ok(!files.some((n) => n.includes('t3600')), 'no 3.6 s files are left');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cartridge captures: Delza\'s set shows what it says - the Journal, the help words, every scene moving over 2, 20 and 40 s, five different fight frames, four different cut-scene text states', async () => {
  const dir = tmp();
  try {
    await runCaptureCartridges({ outDir: dir });
    const read = (n) => fs.readFileSync(path.join(dir, n), 'utf8');
    for (const sz of ['120x40', '80x24']) {
      const j = read(`cart-delza-journal-${sz}.txt`);
      assert.ok(j.includes('THE WAYFARER\'S JOURNAL') && j.includes('THORNWELL') && j.includes('LAMPWARDEN'), `journal ${sz}`);
      assert.ok(read(`cart-delza-help-${sz}.txt`).includes('JOURNAL · how to travel'), `help ${sz}: Delza's own words`);
    }
    assert.ok(/ DM-01/.test(read('cart-delza-library-240x67.txt')) || read('cart-delza-library-240x67.txt').includes('DELZA'), 'the XL library has Delza on it');
    const bodies = new Map();
    for (const id of ['thornwell', 'tallow', 'cinderhorn', 'reach', 'highcandle', 'lampwarden']) {
      const three = [2, 20, 40].map((s) => blocks(read(`cart-delza-scene-${id}-t${s}.txt`))[0]);
      assert.equal(new Set(three).size, 3, `${id}: the three moments differ`);
      for (const b of three) { assert.ok(b.includes('\n') && b.replace(/[\s░▒▓█·]/g, '').length > 0, `${id}: more than a wash of shade`); bodies.set(b, id); }
    }
    assert.equal(bodies.size, 18, 'no two scene captures are the same picture');
    const fight = FIGHT_MOMENTS.map((m) => blocks(read(`cart-delza-fight-t${Math.round(m * 1000)}.txt`))[0]);
    assert.equal(new Set(fight).size, 5, 'five different fight frames');
    assert.ok(fight.every((b) => b.includes('Swing lantern') && b.includes('ORRIN') && b.includes('CINDERHORN')), 'the command box and both health bars in every frame');
    assert.ok(fight[2].includes('12'), 'the frame just after the lantern lands shows the damage number');
    const cut = CUTSCENE_MOMENTS.map((m) => blocks(read(`cart-delza-cutscene-t${Math.round(m * 1000)}.txt`))[0]);
    assert.equal(new Set(cut).size, 4, 'four different cut-scene frames');
    assert.ok(cut[0].includes('MAREN') && cut[0].includes('You came') && !cut[0].includes('Lowmarrow?'), 'line 1 is half typed');
    assert.ok(cut[1].includes('Moonwax Key'), 'line 3 is whole');
    assert.ok(cut[2].includes('PIM'), 'Pim speaks');
    assert.ok(cut[3].includes('Highcandle was whole'), 'the last line is whole');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the committed captures folder holds exactly the cartridge files the tool writes (nothing stale, nothing missing)', () => {
  const have = fs.readdirSync(new URL('../captures/', import.meta.url)).filter((n) => n.startsWith('cart-')).sort();
  assert.deepEqual(have, cartridgeCaptureNames().sort());
});

test('cartridge captures: a cartridge that runs in the shell also gets eject files at the matching fractions of the 1.6 s eject (fixture root)', async () => {
  const dir = tmp();
  const root = makeRoot();
  try {
    const dirs = [{ dir: root, trusted: true }];
    const files = await runCaptureCartridges({ outDir: dir, dirs });
    const names = new Set(fs.readdirSync(dir));
    assert.deepEqual([...names].sort(), cartridgeCaptureNames({ dirs }).sort());
    assert.equal(files.length, names.size);
    assert.deepEqual(EJECT_MOMENTS.map((m) => Math.round((m / EJECT_SECONDS) * 1000)), CART_MOMENTS.filter((m) => m < INSERT_END).map((m) => Math.round((m / INSERT_END) * 1000)), 'the same fractions');
    const eject = [...names].filter((n) => n.startsWith('cart-eject-'));
    assert.equal(eject.length, EJECT_MOMENTS.length * 2, 'three per size for the fixture; none for Classic');
    assert.ok(!eject.some((n) => n.includes('classic')), 'Classic has no eject');
    const ej = EJECT_MOMENTS.map((m) => fs.readFileSync(path.join(dir, `cart-eject-fixture-t${Math.round(m * 1000)}.txt`), 'utf8'));
    assert.equal(new Set(ej).size, ej.length, 'the eject frames differ');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
});

test('cartridge captures are deterministic (second run is byte-identical)', async () => {
  const d1 = tmp(), d2 = tmp();
  try {
    await runCaptureCartridges({ outDir: d1 });
    await runCaptureCartridges({ outDir: d2 });
    const names = fs.readdirSync(d1).sort();
    assert.deepEqual(names, fs.readdirSync(d2).sort());
    for (const f of names) assert.equal(fs.readFileSync(path.join(d1, f), 'utf8'), fs.readFileSync(path.join(d2, f), 'utf8'), f);
  } finally {
    fs.rmSync(d1, { recursive: true, force: true });
    fs.rmSync(d2, { recursive: true, force: true });
  }
});

test('capture.mjs --cartridges writes only the cartridge files (a cheap run) and says how many', () => {
  const dir = tmp();
  try {
    const r = spawnSync(process.execPath, [CAPTURE_TOOL, '--cartridges', '--out', dir], { encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /wrote \d+ cartridge files/);
    assert.deepEqual(fs.readdirSync(dir).sort(), cartridgeCaptureNames().sort());
    assert.ok(fs.readdirSync(dir).every((f) => f.startsWith('cart-')), 'nothing but cart-* files');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- tools/measure.mjs console options (DRIFT-4)
import { runMeasure, cartridgeTargets } from '../tools/measure.mjs';
import { tmpRoot, makeFixtureCartridge } from './helpers-cartridge.js';

const fixtureDirs = () => { const root = tmpRoot('drift-measure-fx-'); makeFixtureCartridge(root, 'fixture'); return [{ dir: root, trusted: true }]; };

test('measure --library: a resting library draws only its small idle movements; arrow presses every cycle redraw it; the start-up load is reported', async () => {
  const idle = await runMeasure({ seconds: 2.2, cols: 80, rows: 24, library: true, quiet: true });
  const cyc = await runMeasure({ seconds: 2.2, cols: 80, rows: 24, library: true, cycle: 0.5, quiet: true });
  assert.ok(idle.frames >= 1 && idle.frames <= 14, `idle library frames ${idle.frames} (of about 40 ticks)`);
  assert.ok(cyc.frames > idle.frames + 5, `cycling library redraws: ${cyc.frames} vs ${idle.frames}`);
  assert.ok(Number.isFinite(idle.loadMs) && idle.loadMs >= 0);
  assert.equal(idle.samples.length >= 2, true);
});

test('measure --cartridge: sampling starts after the cartridge runs; --program and --scene are honoured; bad ones are errors (both arms)', async () => {
  const dirs = fixtureDirs();
  const r = await runMeasure({ seconds: 2.2, cols: 80, rows: 24, cartridge: { id: 'fixture', program: 'mix', scene: 'drops' }, dirs, quiet: true });
  assert.ok(r.frames > 5, `frames ${r.frames}`);
  assert.ok(r.bytes > 500);
  assert.ok(Number.isFinite(r.loadMs) && r.loadMs >= 0 && r.loadMs < 5000, `load_ms ${r.loadMs}`);
  assert.equal(r.firstWrite, '\x1b[?1049h\x1b[?25l', 'through the real terminal-enter path');
  await runMeasure({ seconds: 1.2, cols: 80, rows: 24, cartridge: { id: 'fixture', program: 'calm' }, dirs, quiet: true }); // a program switch, then the start scene
  await assert.rejects(runMeasure({ seconds: 1, cols: 80, rows: 24, cartridge: { id: 'fixture', program: 'nope' }, dirs, quiet: true }), /no program 'nope'/);
  await assert.rejects(runMeasure({ seconds: 1, cols: 80, rows: 24, cartridge: { id: 'fixture', program: 'mix', scene: 'haze' }, dirs, quiet: true }), /does not hold scene 'haze'/);
  await assert.rejects(runMeasure({ seconds: 1, cols: 80, rows: 24, cartridge: { id: 'nope' }, dirs, quiet: true }), /no cartridge called 'nope'/);
  await assert.rejects(runMeasure({ seconds: 1, cols: 80, rows: 24, cartridge: { id: 'classic' }, dirs: [{ dir: INSTALL_DIR, trusted: true }], quiet: true }), /Classic: use --scene/);
  await assert.rejects(runMeasure({ seconds: 1, cols: 80, rows: 24, cartridge: { id: 'arcade' }, dirs: [{ dir: INSTALL_DIR, trusted: true }], quiet: true }), /it is locked/);
});

test('measure --cartridge all: one target per unlocked scene (each with a program that holds it); the install has Delza\'s scenes', () => {
  const t = cartridgeTargets(fixtureDirs());
  assert.deepEqual(t.map((x) => x.scene).sort(), ['drops', 'haze', 'note', 'plasma-ref', 'sandbox', 'swell', 'tide']);
  assert.deepEqual(t.find((x) => x.scene === 'haze'), { cartridge: 'fixture', program: 'calm', scene: 'haze' });
  assert.deepEqual(t.find((x) => x.scene === 'tide'), { cartridge: 'fixture', program: 'mix', scene: 'tide' });
  const delza = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.find((c) => c.id === 'delza');
  assert.deepEqual(cartridgeTargets(), delza.manifest.scenes.map((s) => ({ cartridge: 'delza', program: 'tale', scene: s.id })), 'the install holds one real cartridge: Delza, one target per scene, in her tale');
});
