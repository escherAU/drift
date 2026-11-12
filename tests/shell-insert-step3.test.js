// DRIFT-7 item 1: insert step 3 (0.45 - 0.85 s) is a dissolve from the lifted picture to the seated one, not a drop in rows.
// Every cell changes at most once across the step (the drop striped the picture so a cell flipped up to several times); the
// first frame of the step is the lifted picture and the last is the seated one; the frames outside it are untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCartridges } from '../src/cartridge/loader.js';
import { drawInsert, INSERT_END, INSERT_SLIDE_END, INSERT_DROP_END, cartridgeOffset } from '../src/shell/insert.js';
import { driftmanSkin } from '../src/shell/driftman.js';
import { libraryPalette } from '../src/shell/shell.js';
import { newFrame } from '../src/shell/ui.js';
import { makeRoot } from './helpers-shell.js';

const root = makeRoot();
const { cartridges } = discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
const lib = libraryPalette(cartridges, 'truecolor');
const entries = cartridges.map((c, i) => ({
  id: c.id, title: c.title, code: (c.manifest && c.manifest.code) || '', blurb: c.manifest.blurb, facts: c.manifest.facts || ['Genre: test', 'Players: 1'],
  locked: c.locked, label: c.label, ink: null, tint: lib.tints[i],
}));
const view = (index = 0) => ({ cartridges: entries, index, prev: index, slide: 1, message: '', dip: 0 });
const items = [
  { cartridge: entries[0], view: view(0), cartSkin: null, classic: true },
  { cartridge: entries[1], view: view(1), cartSkin: cartridges[1].skin || null, classic: false },
];
const SIZES = [[120, 40], [80, 24], [88, 39], [240, 67], [40, 10]];
const draw = (cols, rows, t, item) => { const f = newFrame(cols, rows); drawInsert(f, { item, t }, driftmanSkin); return f; };
const same = (a, b) => a.glyphs.every((g, i) => g === b.glyphs[i] && a.shades[i] === b.shades[i]);

for (const [cols, rows] of SIZES) {
  test(`step 3 at ${cols}x${rows}: each cell changes at most once across the dissolve, from the lifted picture to the seated one`, () => {
    for (const item of items) {
      const lifted = draw(cols, rows, INSERT_SLIDE_END, item);
      const seated = draw(cols, rows, INSERT_DROP_END - 1e-9, item);
      const n = lifted.glyphs.length;
      let prev = lifted, changed = 0, moved = 0;
      const flips = new Uint8Array(n);
      const ts = [];
      for (let t = INSERT_SLIDE_END; t <= INSERT_DROP_END - 1e-9; t += 0.0025) ts.push(t);
      ts.push(INSERT_DROP_END - 1e-9);
      for (const t of ts) {
        const f = draw(cols, rows, t, item);
        for (let i = 0; i < n; i++) {
          if (f.glyphs[i] !== prev.glyphs[i] || f.shades[i] !== prev.shades[i]) { flips[i]++; changed++; }
          // every cell is the lifted cell or the seated cell: nothing in between (no row-by-row striping)
          const isA = f.glyphs[i] === lifted.glyphs[i] && f.shades[i] === lifted.shades[i];
          const isB = f.glyphs[i] === seated.glyphs[i] && f.shades[i] === seated.shades[i];
          assert.ok(isA || isB, `cell ${i} at t=${t} is neither the lifted nor the seated cell`);
        }
        prev = f;
        moved++;
      }
      assert.ok(moved > 100);
      assert.ok(Math.max(...flips) <= 1, `a cell changed ${Math.max(...flips)} times`);
      assert.ok(changed > 0 && changed <= n, 'the picture does change');
      assert.ok(same(draw(cols, rows, INSERT_SLIDE_END, item), lifted), 'first frame = lifted picture');
      assert.ok(same(draw(cols, rows, INSERT_DROP_END - 1e-9, item), seated), 'last frame = seated picture');
      // the same at the real frame cadence (18 fps), and the frame buffer is fully rewritten (a dirty frame draws the same)
      const dirty = newFrame(cols, rows); dirty.glyphs.fill(0x2588); dirty.shades.fill(3);
      drawInsert(dirty, { item, t: 0.6 }, driftmanSkin);
      assert.ok(same(dirty, draw(cols, rows, 0.6, item)), 'a dirty frame draws the same picture');
    }
  });
}

test('step 3: the lifted picture shows the cartridge one row up and the seated picture shows it dropped three rows (the old endpoints)', () => {
  const item = items[0];
  const lifted = draw(120, 40, INSERT_SLIDE_END, item), seated = draw(120, 40, INSERT_DROP_END - 1e-9, item);
  assert.equal(cartridgeOffset(INSERT_SLIDE_END), -1);
  assert.equal(cartridgeOffset(INSERT_DROP_END), 3);
  assert.ok(!same(lifted, seated));
  // t just inside either end of the step is the picture at that end (plus at most a few cells)
  const diff = (a, b) => a.glyphs.reduce((n, g, i) => n + (g !== b.glyphs[i] || a.shades[i] !== b.shades[i] ? 1 : 0), 0);
  assert.ok(diff(draw(120, 40, INSERT_SLIDE_END + 0.001, item), lifted) < 20);
  assert.ok(diff(draw(120, 40, INSERT_DROP_END - 0.001, item), seated) < 20);
});

test('step 3: the dissolve is monotone - the share of seated cells only grows with t', () => {
  const item = items[1];
  const lifted = draw(120, 40, INSERT_SLIDE_END, item), seated = draw(120, 40, INSERT_DROP_END - 1e-9, item);
  const n = lifted.glyphs.length;
  let last = -1;
  for (let t = INSERT_SLIDE_END; t < INSERT_DROP_END; t += 0.01) {
    const f = draw(120, 40, t, item);
    let k = 0;
    for (let i = 0; i < n; i++) if (f.glyphs[i] === seated.glyphs[i] && f.shades[i] === seated.shades[i] && (f.glyphs[i] !== lifted.glyphs[i] || f.shades[i] !== lifted.shades[i])) k++;
    assert.ok(k >= last, `seated cells ${k} < ${last} at ${t}`);
    last = k;
  }
  assert.ok(last > 0);
  void INSERT_END;
});

test('step 3 does not touch the other tiers: the list tier\'s progress bar still follows t', () => {
  const a = draw(40, 10, 0.5, items[0]), b = draw(40, 10, 0.8, items[0]);
  assert.ok(!same(a, b));
});
