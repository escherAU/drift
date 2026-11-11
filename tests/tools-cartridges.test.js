// DRIFT-4: the cartridge captures (tools/capture.mjs runCaptureCartridges). Its own names list and its own
// test; the K3 mode-capture test in tools.test.js pins a different list and is not touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCaptureCartridges, cartridgeCaptureNames, INSERT_MOMENTS, BOOT_MOMENTS, MODE_CAPTURE_NAMES } from '../tools/capture.mjs';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';
import { isAllowedGlyph } from '../src/glyphs.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'drift-tools-cart-'));
const blocks = (text) => text.split(/=== [^\n]*\n/).slice(1);

test('cartridge captures: library for every install cartridge, insert and boot for the unlocked ones, plain text 120x40', async () => {
  const dir = tmp();
  try {
    const files = await runCaptureCartridges({ outDir: dir });
    const carts = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges;
    assert.ok(carts.some((c) => c.id === 'classic') && carts.some((c) => c.locked), 'install has classic and locked cartridges');
    const want = [];
    for (const c of carts) {
      want.push(`cart-library-${c.id}.txt`);
      if (!c.locked) want.push(`cart-insert-${c.id}.txt`, `cart-boot-${c.id}.txt`);
    }
    assert.deepEqual(cartridgeCaptureNames().sort(), want.slice().sort());
    assert.deepEqual(fs.readdirSync(dir).sort(), want.slice().sort());
    assert.equal(files.length, want.length);
    for (const f of want) {
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.ok(!t.includes('\x1b'), `${f}: plain text`);
      const body = blocks(t);
      const frames = f.startsWith('cart-insert-') ? INSERT_MOMENTS.length : f.startsWith('cart-boot-') ? BOOT_MOMENTS.length : 1;
      assert.equal(body.length, frames, f);
      for (const b of body) {
        const lines = b.replace(/\n$/, '').split('\n');
        assert.equal(lines.length, 40, f);
        for (const l of lines) {
          assert.equal([...l].length, 120, f);
          for (const ch of l) assert.ok(isAllowedGlyph(ch.codePointAt(0)), `${f} U+${ch.codePointAt(0).toString(16)}`);
        }
      }
    }
    // each cartridge has its own library page; the animation moves; the names do not collide with K3's list
    const libs = carts.map((c) => fs.readFileSync(path.join(dir, `cart-library-${c.id}.txt`), 'utf8'));
    assert.equal(new Set(libs).size, libs.length, 'library pages differ per cartridge');
    for (const c of carts.filter((x) => !x.locked)) {
      for (const kind of ['insert', 'boot']) {
        const b = blocks(fs.readFileSync(path.join(dir, `cart-${kind}-${c.id}.txt`), 'utf8'));
        assert.ok(new Set(b).size >= 3, `${kind}: the frames change over time (${new Set(b).size} distinct of ${b.length})`);
      }
    }
    for (const n of want) assert.ok(!MODE_CAPTURE_NAMES.includes(n), n);
    // locked cartridges have no insert or boot file
    for (const c of carts.filter((x) => x.locked)) assert.ok(!fs.existsSync(path.join(dir, `cart-insert-${c.id}.txt`)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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

// ---- tools/measure.mjs console options (DRIFT-4)
import { runMeasure, cartridgeTargets } from '../tools/measure.mjs';
import { tmpRoot, makeFixtureCartridge } from './helpers-cartridge.js';

const fixtureDirs = () => { const root = tmpRoot('drift-measure-fx-'); makeFixtureCartridge(root, 'fixture'); return [{ dir: root, trusted: true }]; };

test('measure --library: a still library draws once; arrow presses every cycle redraw it; the start-up load is reported', async () => {
  const idle = await runMeasure({ seconds: 2.2, cols: 80, rows: 24, library: true, quiet: true });
  const cyc = await runMeasure({ seconds: 2.2, cols: 80, rows: 24, library: true, cycle: 0.5, quiet: true });
  assert.ok(idle.frames >= 1 && idle.frames <= 3, `idle library frames ${idle.frames}`);
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
