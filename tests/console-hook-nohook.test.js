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
  // DRIFT-7: the frames of insert step 3 (0.45 - 0.85 s, now a dissolve, see shell-insert-step3.test.js) and of the eject frames that play
  // it backwards are counted but not hashed; every other frame is still pinned to the hashes recorded before the hook (705e471).
  let ejectAt = -1;
  const inStep3 = (screen, k) => {
    if (screen === 'insert') { const t = k * DT; return t > 0.45 && t < 0.85; }
    if (screen === 'eject') { const a = (k - ejectAt) * DT - 0.3, T = 1.5 * (1 - a / 1.6); return a >= 0 && T > 0.45 && T < 0.85; }
    return false;
  };
  const step = () => {
    const f = sh.frame();
    if (inStep3(sh.state().screen, frames)) { frames++; sh.tick(DT); return; }
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
    ejectAt = frames;
    for (let k = 0; k < 400 && sh.state().screen === 'eject'; k++) step();
    for (let k = 0; k < 8; k++) step(); // the library again
  }
  return { hash: h.digest('hex'), frames, screens: screens.join('>') };
}

// recorded before the console hook (705e471 rules) and re-recorded on 47597de (the tree before DRIFT-7 item 1) with the step 3 frames skipped: { frames, hash }
const EXPECTED = {
  'classic 120x40': { frames: 100, hash: '91f875e624cdaa1a63bab7a034c1e3c0741fa30aea4a285bb3f6a937aafd719c' },
  'classic 80x24': { frames: 100, hash: '077e5829328ec99f9c872b3845b6bd85c11addefebbbe9286e47159b120463d9' },
  'night-drive 120x40': { frames: 188, hash: '2194ac25c43533b5d9b38abbe0fea33f757127826c580ff485c2800009d7d3dc' },
  'night-drive 80x24': { frames: 188, hash: 'd7c007e7230aa8050c654b94670b29ca97c4dc990f43f5f1e1804cfedcd71ee8' },
  'delza 120x40': { frames: 188, hash: 'f78a6c3908ba79581ad51289b1d7e27f42a59cde0ed7390d735e290945bd9faf' },
  'delza 80x24': { frames: 188, hash: 'c3dc624a53f8e1cd0d7996ddaedf9628b4316dd202307b8e047401c1b8bcf379' },
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
