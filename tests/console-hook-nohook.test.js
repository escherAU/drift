// DRIFT-7 C11: a cartridge WITHOUT the console field draws exactly as it did before the hook existed. Every frame of a whole run -
// insert, boot, running, eject, back to the library - through the real shell on the real installed cartridges, hashed (glyphs, shades,
// fg/bg when present, palette key). The expected hashes were recorded on the tree before the hook (705e471, DRIFT-7 C10) and are pinned
// here; a change in them is a change in what an existing cartridge draws, which this commit must not make.
//   DRIFT_PRINT_HASH=1 node --test tests/console-hook-nohook.test.js     prints the current hashes instead of checking them
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createShell } from '../src/shell/shell.js';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';

const FPS = 18;
const DT = 1 / FPS;
const SPEEDS = [1, 2, 3, 4];
const HOST = { persist() {}, quit() {}, leaveToClassic() {} };
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

async function runHash(cartId, cols, rows) {
  const d = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
  const sh = createShell({
    cols, rows, cartridges: d.cartridges, seed: 1, cmode: 'truecolor', host: HOST,
    consts: { SPEEDS, DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 },
    start: { cartridge: cartId },
  });
  await flush();
  const h = crypto.createHash('sha256');
  let frames = 0;
  const screens = [];
  const step = () => {
    const f = sh.frame();
    h.update(Buffer.from(f.glyphs.buffer, f.glyphs.byteOffset, f.glyphs.byteLength));
    h.update(Buffer.from(f.shades.buffer, f.shades.byteOffset, f.shades.byteLength));
    if (f.fg) { h.update('fg'); h.update(Buffer.from(f.fg.buffer, f.fg.byteOffset, f.fg.byteLength)); h.update(Buffer.from(f.bg.buffer, f.bg.byteOffset, f.bg.byteLength)); }
    h.update(f.palette.key);
    const s = sh.state().screen;
    if (screens[screens.length - 1] !== s) screens.push(s);
    frames++;
    sh.tick(DT);
  };
  for (let k = 0; k < 400 && sh.state().screen !== 'running' && sh.state().screen !== 'library'; k++) step();
  if (sh.state().screen === 'running') {
    for (let k = 0; k < 40; k++) step(); // a little of the running picture
    sh.key('e');
    for (let k = 0; k < 400 && sh.state().screen === 'eject'; k++) step();
    for (let k = 0; k < 8; k++) step(); // the library again
  }
  return { hash: h.digest('hex'), frames, screens: screens.join('>') };
}

// recorded on 705e471 (before the console hook): { frames, hash }
const EXPECTED = {
  'classic 120x40': { frames: 100, hash: '94140406cd2cba578354cbaa84a020540ef0a38a874004fa8da95efb5de724d4' },
  'classic 80x24': { frames: 100, hash: '7d10b53839ac42941923a50a25264e9afca6500954c0ffc3b5694a3cbc8358df' },
  'night-drive 120x40': { frames: 188, hash: '79b884b85f0e3bece8e1b582067b63d2293945ebd87fca1ed9e4cb86ade08f74' },
  'night-drive 80x24': { frames: 188, hash: '03f152551c133a9c00a879feeecbe4892deb07f34a78bf2c005fa28c5753df3c' },
  'delza 120x40': { frames: 188, hash: '61310defeeb1ee24a7833c36b6db1fb7d83983aba8d787b02462a6b79c2d917b' },
  'delza 80x24': { frames: 188, hash: '5c370437f010cda17179e46c22aa6399e0096201b847aecf04bdf7d66a3f6939' },
};

for (const key of Object.keys(EXPECTED)) {
  const [id, size] = key.split(' ');
  const [cols, rows] = size.split('x').map(Number);
  test(`no hook: ${key} draws byte-identical frames through insert, boot, running, eject and back to the library`, async () => {
    const r = await runHash(id, cols, rows);
    if (process.env.DRIFT_PRINT_HASH) { console.log(`HASH ${key} ${r.frames} ${r.hash} ${r.screens}`); return; }
    assert.ok(r.screens.startsWith('insert>boot'), r.screens);
    assert.deepEqual({ frames: r.frames, hash: r.hash }, EXPECTED[key]);
  });
}
