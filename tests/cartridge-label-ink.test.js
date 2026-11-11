// DRIFT-4 schema item 7: label-ink.txt, the per-glyph brightness map beside label.txt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';
import { cartridgeGrid, LABEL_W, LABEL_H } from '../src/shell/library.js';
import { driftmanSkin } from '../src/shell/driftman.js';
import { tmpRoot, writeCart, dataManifest, lockedManifest, LABEL } from './helpers-cartridge.js';

const ui = driftmanSkin.palette.ui;
const discover = (root, trusted = false) => discoverCartridges({ dirs: [{ dir: root, trusted }] });
const put = (files, id = 'c1') => { const root = tmpRoot(); writeCart(root, id, files); return discover(root); };
const base = (over = {}) => ({ 'manifest.json': dataManifest('c1'), 'label.txt': LABEL, ...over });
const lockedBase = (over = {}) => ({ 'manifest.json': lockedManifest('c1'), 'label.txt': LABEL, ...over });
const skipped = (r, re) => {
  assert.equal(r.cartridges.length, 0, 'the cartridge is skipped');
  assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
  assert.match(r.errors[0].reason, re);
};

// ---- the loader

test('label-ink.txt: a good file is read into cart.labelInk; a missing file is fine (null)', () => {
  const r = put(base({ 'label-ink.txt': '0123\n 321\n' }));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.cartridges[0].labelInk, ['0123', ' 321']);
  const none = put(base());
  assert.deepEqual(none.errors, []);
  assert.equal(none.cartridges[0].labelInk, null);
});

test('label-ink.txt: a 4 is rejected, the cartridge is skipped, and the message names the file', () => {
  skipped(put(base({ 'label-ink.txt': '0124\n' })), /label-ink\.txt.*row 1.*'4'/);
  skipped(put(base({ 'label-ink.txt': '012\n0x1\n' })), /label-ink\.txt.*row 2/);
});

test('label-ink.txt: rows wider than 24 or more than 10 rows fail', () => {
  skipped(put(base({ 'label-ink.txt': '1'.repeat(25) + '\n' })), /label-ink\.txt.*25 columns, max 24/);
  skipped(put(base({ 'label-ink.txt': '1\n'.repeat(11) })), /label-ink\.txt.*11 rows, max 10/);
  assert.deepEqual(put(base({ 'label-ink.txt': ('1'.repeat(24) + '\n').repeat(10) })).errors, [], 'control: 24x10 is fine');
});

test('label-ink.txt: a locked cartridge still has its ink file read, and a bad one skips it', () => {
  const ok = put(lockedBase({ 'label-ink.txt': '321\n' }));
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.cartridges[0].labelInk, ['321']);
  skipped(put(lockedBase({ 'label-ink.txt': '9\n' })), /label-ink\.txt/);
});

test('label-ink.txt: it must stay inside the cartridge folder (a link is not followed)', () => {
  const root = tmpRoot();
  const dir = writeCart(root, 'c1', base());
  const outside = path.join(root, 'outside.txt');
  fs.writeFileSync(outside, '123\n');
  try { fs.symlinkSync(outside, path.join(dir, 'label-ink.txt')); } catch { return; } // no symlink right on this machine: nothing to prove
  const r = discover(root);
  skipped(r, /label-ink\.txt is a link/);
});

// ---- the drawing rule: level = max(0, digit - (3 - level))

const cart = (over = {}) => ({ id: 'x', title: 'X', code: 'X-1', locked: false, label: ['abcd e'], ink: ['0123 '], tint: 20, ...over });
const cellsOf = (G, n) => Array.from({ length: n }, (_, c) => ({ g: String.fromCharCode(G.g[3 * G.w + 3 + c]), s: G.s[3 * G.w + 3 + c] }));

test('ink: selected (level 3) a cell is tint+digit; a neighbour (level 1) is tint+max(0, digit-2); spaces and no-digit cells keep the level', () => {
  const sel = cellsOf(cartridgeGrid(cart(), { selected: true, level: 3, ui }), 6);
  assert.deepEqual(sel.filter((c) => c.g !== ' ').map((c) => c.s - 20), [0, 1, 2, 3, 3], 'a 0 1 2 3 then the cell with no ink digit at level 3');
  const nb = cellsOf(cartridgeGrid(cart(), { selected: false, level: 1, ui }), 6);
  assert.deepEqual(nb.filter((c) => c.g !== ' ').map((c) => c.s - 20), [0, 0, 0, 1, 1], 'digits 0 1 2 3 become 0 0 0 1; the no-ink cell keeps level 1');
  const lv2 = cellsOf(cartridgeGrid(cart(), { selected: false, level: 2, ui }), 6);
  assert.deepEqual(lv2.filter((c) => c.g !== ' ').map((c) => c.s - 20), [0, 0, 1, 2, 2]);
});

test('ink: no ink at all draws every cell at the plain level (default arm unchanged)', () => {
  for (const level of [1, 2, 3]) {
    const g = cellsOf(cartridgeGrid(cart({ ink: null }), { selected: level === 3, level, ui }), 6);
    assert.ok(g.filter((c) => c.g !== ' ').every((c) => c.s === 20 + level));
  }
});

test('ink: a locked cartridge stays at its dimmest level whatever the ink says', () => {
  for (const level of [1, 3]) {
    const withInk = cartridgeGrid(cart({ locked: true, ink: ['3333 3'] }), { selected: level === 3, level, ui });
    const without = cartridgeGrid(cart({ locked: true, ink: null }), { selected: level === 3, level, ui });
    assert.deepEqual(Array.from(withInk.s), Array.from(without.s), 'the ink changes nothing');
    assert.ok(cellsOf(withInk, 6).filter((c) => c.g !== ' ').every((c) => c.s === 20), 'tint+0 only');
  }
});

test('ink: the idle ripple still swaps water glyphs on an inked label', () => {
  const c = cart({ label: ['~~~~'], ink: ['0123'] });
  const still = cartridgeGrid(c, { selected: true, level: 3, ui, ripple: -1 });
  const rip = cartridgeGrid(c, { selected: true, level: 3, ui, ripple: 0 });
  assert.notEqual(rip.g[3 * rip.w + 3], still.g[3 * still.w + 3]);
  assert.equal(rip.s[3 * rip.w + 3], still.s[3 * still.w + 3], 'the glyph swaps, the shade stays');
});

// ---- the shipped cartridges use it

test('shipped labels: classic, night-drive, arcade and last-fantasy each carry a label-ink.txt inside 24x10, digits 0-3 only', () => {
  const r = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
  assert.deepEqual(r.errors, []);
  for (const id of ['classic', 'night-drive', 'arcade', 'last-fantasy']) {
    const c = r.cartridges.find((x) => x.id === id);
    assert.ok(c.labelInk && c.labelInk.length > 0, `${id} has ink`);
    assert.ok(c.labelInk.length <= LABEL_H && c.labelInk.every((l) => [...l].length <= LABEL_W && /^[0-3 ]*$/.test(l)), id);
    assert.ok(c.labelInk.some((l) => /[0-3]/.test(l)));
  }
});

test('shipped classic: the sun is brighter than the horizon, and the water is dimmer toward the bottom', () => {
  const c = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.find((x) => x.id === 'classic');
  const mean = (rows) => { const d = rows.join('').replace(/[^0-3]/g, '').split('').map(Number); return d.reduce((a, b) => a + b, 0) / d.length; };
  const ink = c.labelInk.concat(Array(LABEL_H).fill('')).slice(0, LABEL_H);
  assert.ok(mean(ink.slice(1, 4)) > mean(ink.slice(4, 5)), 'sun rows beat the horizon row');
  assert.ok(mean(ink.slice(5, 7)) > mean(ink.slice(8, 10)), 'water fades toward the bottom');
});

test('shipped locked labels: the ink never lifts a locked card above its dim level in the real library', () => {
  const r = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
  for (const c of r.cartridges.filter((x) => x.locked)) {
    for (const level of [1, 3]) {
      const v = { id: c.id, title: c.title, code: 'X', locked: true, label: c.label, tint: 20 };
      const a = cartridgeGrid({ ...v, ink: c.labelInk }, { selected: level === 3, level, ui });
      const b = cartridgeGrid({ ...v, ink: null }, { selected: level === 3, level, ui });
      assert.deepEqual(Array.from(a.s), Array.from(b.s), c.id);
    }
  }
});

// ---- through the shell: discovered ink reaches the library view

import { createShell } from '../src/shell/shell.js';
test('shell: the loaded ink reaches the library view (the same cartridge with and without ink draws different shades)', () => {
  const frameWith = (files) => {
    const root = tmpRoot();
    writeCart(root, 'c1', { 'manifest.json': dataManifest('c1'), 'label.txt': '#### ####\n', ...files });
    const found = discover(root);
    assert.deepEqual(found.errors, []);
    const sh = createShell({ cols: 120, rows: 40, cartridges: found.cartridges, consts: {}, host: { quit() {}, persist() {}, leaveToClassic() {} } });
    sh.tick(2);
    const f = sh.frame();
    return Array.from(f.shades);
  };
  const plain = frameWith({});
  const inked = frameWith({ 'label-ink.txt': '0123 0123\n' });
  assert.notDeepEqual(inked, plain);
});
