// DRIFT-4: the cartridge captures (tools/capture.mjs runCaptureCartridges). Its own names list and its own
// test; the K3 mode-capture test in tools.test.js pins a different list and is not touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCaptureCartridges, cartridgeCaptureNames, CART_MOMENTS, EJECT_MOMENTS, MODE_CAPTURE_NAMES, CAPTURE_NAMES } from '../tools/capture.mjs';
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
    }
    assert.deepEqual(cartridgeCaptureNames().sort(), want.slice().sort());
    assert.deepEqual(fs.readdirSync(dir).sort(), want.slice().sort());
    assert.equal(files.length, want.length);
    // the moments the task names: about 0.4, 0.9, 1.25, 1.6, 2.5, 3.6, 4.2, 5.0, 5.6 s from Enter
    assert.deepEqual(CART_MOMENTS, [0.4, 0.9, 1.25, 1.6, 2.5, 3.6, 4.2, 5.0, 5.6]);
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

test('measure --cartridge all: one target per unlocked scene (each with a program that holds it); the install has none yet', () => {
  const t = cartridgeTargets(fixtureDirs());
  assert.deepEqual(t.map((x) => x.scene).sort(), ['drops', 'haze', 'note', 'plasma-ref', 'sandbox', 'swell', 'tide']);
  assert.deepEqual(t.find((x) => x.scene === 'haze'), { cartridge: 'fixture', program: 'calm', scene: 'haze' });
  assert.deepEqual(t.find((x) => x.scene === 'tide'), { cartridge: 'fixture', program: 'mix', scene: 'tide' });
  assert.deepEqual(cartridgeTargets(), [], 'only Classic and locked cartridges are installed so far (this fails the day a real cartridge lands: update it then)');
});
