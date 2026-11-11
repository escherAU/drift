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
