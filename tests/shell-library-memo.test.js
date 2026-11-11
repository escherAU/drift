// DRIFT-4 F3: the library at rest is cheap. The shell hands drawLibrary a memo (view.memo) that keeps the
// art grids it has built (the cartridges, the console and its screen) and the water columns of each label, so a
// tick that only changes the idle picture rebuilds almost nothing. The memo must never change a drawn cell:
// every picture drawn with it is identical to a fresh draw, at every idle step.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { driftmanSkin } from '../src/shell/driftman.js';
import { drawLibrary, idleSignature, makeLibraryMemo } from '../src/shell/library.js';
import { newFrame } from '../src/shell/ui.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const labelOf = (id) => fs.readFileSync(path.join(ROOT, 'cartridges', id, 'label.txt'), 'utf8').split(/\r?\n/).map((l) => l.replace(/ +$/, '')).slice(0, 10);

const SHELF = [
  ['classic', 'Drift Classic', 'DM-00', false, "Today's Drift, exactly as you know it. Calm by default, four modes, 21 scenes.", ['4 modes', '21 scenes', 'the original']],
  ['night-drive', 'Night Drive', 'DM-02', true, 'Neon highway, endless dusk, and a car that never needs fuel.', []],
  ['last-fantasy', 'Last Fantasy', 'DM-04', true, 'Twin moons, a sea of cloud, and one beacon at the edge of the world.', []],
  ['arcade', 'Arcade', 'DM-03', true, 'Bricks, a ball, a paddle, and a high score nobody remembers setting.', []],
  ['delza', 'Delza', 'DM-01', false, "A lamplighter's apprentice crosses the Hollowmere Reach to relight a dark city.", ['6 scenes', 'woodsy fantasy', 'about 16 min']],
];
// one list of cartridge objects, as the shell has (it never changes them), so the memo can recognise them
const CARTS = SHELF.map(([id, title, code, locked, blurb, facts], i) => ({ id, title, code, locked, blurb, facts, label: labelOf(id === 'delza' ? 'classic' : id), ink: null, tint: 20 + 4 * i }));
const DT = 1 / 18;
const same = (a, b) => Buffer.from(a.glyphs.buffer).equals(Buffer.from(b.glyphs.buffer)) && Buffer.from(a.shades.buffer).equals(Buffer.from(b.shades.buffer));
const SIZES = [[240, 67], [120, 40], [80, 24], [60, 14]];

function fresh(cols, rows, v) { const f = newFrame(cols, rows); drawLibrary(f, v, driftmanSkin); return f; }
function cached(cols, rows, v, memo) { const f = newFrame(cols, rows); drawLibrary(f, { ...v, memo }, driftmanSkin); return f; }

test('memo: a library drawn with the memo is identical to a fresh draw at every idle step, every cartridge, every size', () => {
  for (const [cols, rows] of SIZES) {
    const memo = makeLibraryMemo();
    for (let index = 0; index < CARTS.length; index++) {
      for (let k = 1; k <= 18 * 50; k++) { // 50 s of idle at the shell's own tick rate, one memo throughout
        const v = { cartridges: CARTS, index, prev: index, slide: 1, dial: index, type: 1, message: '', dip: 0, idle: k * DT };
        assert.ok(same(fresh(cols, rows, v), cached(cols, rows, v, memo)), `${cols}x${rows} cartridge ${index} idle step ${k}`);
      }
    }
  }
});

test('memo: moves, typing, the locked dip and a message draw the same with the memo as without', () => {
  for (const [cols, rows] of SIZES) {
    const memo = makeLibraryMemo();
    for (let from = 0; from < CARTS.length; from++) {
      const to = (from + 1) % CARTS.length;
      for (let k = 0; k <= 8; k++) {
        const slide = k / 7;
        for (const dir of [1, -1]) {
          const v = { cartridges: CARTS, index: to, prev: from, slide: Math.min(1, slide), dir, dial: to + 3, type: Math.min(1, slide * 0.3 / 0.36 + 0.2), message: '', dip: 0, idle: 0 };
          assert.ok(same(fresh(cols, rows, v), cached(cols, rows, v, memo)), `${cols}x${rows} ${from}->${to} slide ${k}`);
        }
      }
      for (const dip of [0, 1]) {
        const v = { cartridges: CARTS, index: from, prev: from, slide: 1, dial: from, type: 1, message: dip ? 'This cartridge isn\'t ready yet.' : '', dip, idle: 0 };
        assert.ok(same(fresh(cols, rows, v), cached(cols, rows, v, memo)), `${cols}x${rows} dip ${dip} on ${from}`);
      }
    }
  }
});

test('memo: the idle signature is the same with and without the memo, at every step and tier', () => {
  const memo = makeLibraryMemo();
  for (const tier of ['full', 'compact', 'list', 'tiny']) {
    for (const sel of CARTS) {
      for (let k = 0; k <= 18 * 70; k++) {
        assert.equal(idleSignature(k * DT, sel, tier, memo), idleSignature(k * DT, sel, tier), `${tier} ${sel.id} step ${k}`);
      }
    }
  }
  assert.equal(idleSignature(3, { locked: false, label: undefined }, 'full', memo), idleSignature(3, { locked: false, label: undefined }, 'full'));
});

test('memo: a repeated picture builds no grid at all, and a minute of idle builds a few per drawn frame at most', () => {
  for (const [cols, rows] of SIZES.slice(0, 3)) {
    const memo = makeLibraryMemo();
    const v = { cartridges: CARTS, index: 0, prev: 0, slide: 1, dial: 0, type: 1, message: '', dip: 0, idle: 5.1 };
    cached(cols, rows, v, memo);
    const warm = memo.builds;
    assert.ok(warm > 0, 'the first draw builds the art');
    cached(cols, rows, v, memo);
    assert.equal(memo.builds, warm, `${cols}x${rows}: the same picture again builds nothing`);

    const memo2 = makeLibraryMemo();
    let frames = 0, last = '';
    for (let k = 1; k <= 18 * 60; k++) {
      const idle = k * DT;
      const sig = idleSignature(idle, CARTS[0], cols >= 88 ? 'full' : 'compact', memo2);
      if (sig === last) continue; // the shell draws only when the picture changes
      last = sig; frames++;
      cached(cols, rows, { cartridges: CARTS, index: 0, prev: 0, slide: 1, dial: 0, type: 1, message: '', dip: 0, idle }, memo2);
    }
    assert.ok(frames > 100, `${frames} idle frames in a minute`);
    const per = memo2.builds / frames;
    assert.ok(per <= 2.5, `${cols}x${rows}: ${per.toFixed(2)} grids built per idle frame (builds ${memo2.builds} over ${frames} frames)`);
  }
});

test('memo: a memo does not leak between cartridges that look alike (same id and tint, different label)', () => {
  const memo = makeLibraryMemo();
  const a = { ...CARTS[0], label: labelOf('classic') };
  const b = { ...CARTS[0], label: labelOf('arcade') };
  for (const c of [a, b, a]) {
    const v = { cartridges: [c, CARTS[4]], index: 0, prev: 0, slide: 1, dial: 0, type: 1, message: '', dip: 0, idle: 2.2 };
    assert.ok(same(fresh(120, 40, v), cached(120, 40, v, memo)));
  }
});
