// DRIFT-7 C12: what the foil costs. A fake terminal counts the bytes the app writes (the same harness as shell-library-bandwidth.test.js).
//   rest    the selected card is a foil: it redraws its 240 label cells 6 times a second, each cell with its own 24-bit colour. Measured on
//           the densest label (every cell inked) and on the real art of Delza, at three sizes, with the same shelf without the foil beside it.
//   hot     a library whose selected card has no foil redraws exactly as often as before, foil neighbours or not (the idle signature).
//   slides  the shelf of shell-library-bandwidth.test.js (the shipped cartridges and three clones) plus two foil cartridges, four slides.
// shell-library-bandwidth.test.js itself is NOT changed and its bounds are NOT touched: its shelf has no foil, and a selected foil cannot fit
// them by construction (80x24: the bound allows 5 KB/s, the shimmer alone is 22 KB/s). The numbers below are the foil's own, with their own
// bounds (the measurement plus 10%).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { INSTALL_DIR } from '../src/cartridge/loader.js';
import { mkShell, DT } from './helpers-shell.js';
import { tmpRoot } from './helpers-cartridge.js';
import { writeFoilCart, foilRoot, foilShell, SAM_HUES, DT as FDT } from './helpers-foil.js';

const RIGHT = '\x1b[C';
const bytesOf = (c) => c.stdout.writes.reduce((a, s) => a + Buffer.byteLength(s), 0);
const SIZES = [[120, 40], [240, 67], [80, 24]];

// the shipped cartridges and three clones (shell-library-bandwidth.test.js), plus two foil cartridges that sort after delza
function shelfRoot(art, withFoil) {
  const root = tmpRoot('drift-foil-bw-');
  fs.cpSync(INSTALL_DIR, root, { recursive: true });
  for (const [src, hue, code] of [['arcade', '#44CCAA', 'DM-11'], ['last-fantasy', '#CC66FF', 'DM-12'], ['night-drive', '#FF8855', 'DM-13']]) {
    fs.cpSync(path.join(INSTALL_DIR, src), path.join(root, src + '-b'), { recursive: true });
    const mf = path.join(root, src + '-b', 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    Object.assign(m, { id: src + '-b', title: m.title + ' B', labelHue: hue, code });
    fs.writeFileSync(mf, JSON.stringify(m));
  }
  writeFoilCart(root, 'foil-a', { foil: withFoil ? { hues: SAM_HUES, style: 'holo' } : undefined, code: 'FX-01' }, art);
  writeFoilCart(root, 'foil-b', { foil: withFoil ? { hues: SAM_HUES.slice().reverse(), style: 'sweep' } : undefined, labelHue: '#4ECDC4', code: 'FX-02' }, art);
  return root;
}

function measure(cols, rows, art, withFoil, select = 'foil-a') {
  const c = mkShell({ startScreen: { screen: 'library' }, cols, rows, dirs: [{ dir: shelfRoot(art, withFoil), trusted: true }] });
  c.app.start();
  c.tick(1);
  assert.equal(c.goto(select), true);
  c.tick(3); // the slide is over and the idle clock is running
  const b0 = bytesOf(c);
  c.tick(10);
  const rest = (bytesOf(c) - b0) / 10;
  const slides = [];
  for (let k = 0; k < 4; k++) { const before = bytesOf(c); c.key(RIGHT); c.tick(2); slides.push(bytesOf(c) - before); }
  c.done();
  return { rest, slides };
}

const TABLE = [];
// [cols, rows, art, rest bound B/s, slide bound B]: the measurement plus 10% (measured: see TABLE)
const BOUNDS = [
  [120, 40, 'dense', 33000, 126000], [240, 67, 'dense', 33000, 122000], [80, 24, 'dense', 32000, 73000],
  [120, 40, 'delza', 25500, 117000], [240, 67, 'delza', 25500, 106500], [80, 24, 'delza', 24500, 58000],
];
for (const [cols, rows, art, restBound, slideBound] of BOUNDS) {
  test(`foil bandwidth ${cols}x${rows} (${art} label): the selected foil costs under ${restBound} B/s at rest (the design's worst case is about 50 KB/s) and the same shelf without it under 1000; four slides stay under ${slideBound} bytes each`, () => {
    const withFoil = measure(cols, rows, art, true), without = measure(cols, rows, art, false);
    TABLE.push(`${cols}x${rows}`.padEnd(8) + art.padEnd(6) + ` rest ${(withFoil.rest / 1024).toFixed(1)} KB/s with the foil, ${(without.rest / 1024).toFixed(1)} KB/s without | slides with ${withFoil.slides.join(' ')} | without ${without.slides.join(' ')}`);
    assert.ok(withFoil.rest < restBound, `rest ${withFoil.rest} B/s`);
    assert.ok(withFoil.rest < 50 * 1024, 'inside the design\'s 50 KB/s worst case');
    assert.ok(without.rest < 1000, `without the foil rest is ${without.rest} B/s`);
    assert.ok(withFoil.rest > 5 * without.rest, 'the foil is what costs');
    for (const b of withFoil.slides) assert.ok(b < slideBound, `a slide wrote ${b} bytes (bound ${slideBound})`);
  });
}

test('foil bandwidth: a PLAIN card selected beside foil cards costs nothing extra at rest (the neighbours are frozen), at all three sizes', () => {
  for (const [cols, rows] of SIZES) {
    const a = measure(cols, rows, 'delza', true, 'classic'), b = measure(cols, rows, 'delza', false, 'classic');
    TABLE.push(`${cols}x${rows}`.padEnd(8) + `plain card selected: rest ${a.rest.toFixed(0)} B/s with foil neighbours, ${b.rest.toFixed(0)} B/s without`);
    assert.ok(a.rest < 2000, `${cols}x${rows}: ${a.rest} B/s (the existing idle movements: LED, cursor, scanline)`);
    assert.ok(Math.abs(a.rest - b.rest) < 100, `${cols}x${rows}: ${a.rest} vs ${b.rest}`);
  }
});

// ---- the hot path: the library's idle redraws

function dirtyCount(root, select, cols, rows, seconds = 60) {
  const { sh } = foilShell(cols, rows, { root, select });
  let n = 0;
  for (let k = 0; k < seconds / FDT; k++) {
    if (sh.dirty()) n++;
    sh.frame();
    sh.tick(FDT);
  }
  return n;
}

test('hot path: the idle redraws of a library whose selected card has no foil are unchanged by foil neighbours (60 s, three sizes, full and compact tiers); a selected foil adds about 6 a second', () => {
  const withFoil = foilRoot({ withFoil: true }), without = foilRoot({ withFoil: false });
  for (const [cols, rows] of [[120, 40], [240, 67], [80, 24], [60, 14]]) {
    const plainWith = dirtyCount(withFoil, 'aaa', cols, rows), plainWithout = dirtyCount(without, 'aaa', cols, rows);
    const foilSel = dirtyCount(withFoil, 'foil-a', cols, rows), foilOff = dirtyCount(without, 'foil-a', cols, rows);
    TABLE.push(`${cols}x${rows}`.padEnd(8) + `idle redraws in 60 s: plain card selected ${plainWith} (foil neighbours) / ${plainWithout} (none); foil card selected ${foilSel} / ${foilOff} without the foil`);
    assert.equal(plainWith, plainWithout, `${cols}x${rows}: foil neighbours change the redraw count of a plain card`);
    assert.equal(foilOff, plainWithout, `${cols}x${rows}: the shelf without foil redraws the same for any card`);
    if (cols >= 78) assert.ok(foilSel - foilOff >= 300 && foilSel - foilOff <= 380, `${cols}x${rows}: a selected foil adds ${foilSel - foilOff} redraws in 60 s (6 a second = 360, less where a step lands on a redraw the idle beats make anyway)`);
    else assert.equal(foilSel, foilOff, `${cols}x${rows}: the list tier draws no foil, so a selected foil adds nothing`);
  }
});

test("speed: the library clock is the shell's real clock, not the playback speed (app.js hands shell.tick the raw dt), so 4x playback does not change the foil's 6 steps a second", () => {
  const writes = (speedUps) => {
    const c = mkShell({ startScreen: { screen: 'library' }, cols: 120, rows: 40, dirs: [{ dir: shelfRoot('delza', true), trusted: true }] });
    c.app.start();
    c.tick(1);
    c.goto('foil-a');
    c.tick(3);
    for (let k = 0; k < speedUps; k++) c.app.actions.speedUp();
    const w0 = c.writes(), b0 = bytesOf(c);
    c.tick(10);
    const out = { writes: c.writes() - w0, bytes: bytesOf(c) - b0, speed: c.app.getState().speed };
    c.done();
    return out;
  };
  const one = writes(0), four = writes(8);
  TABLE.push(`speed 1x: ${one.writes} writes, ${one.bytes} bytes in 10 s; speed ${four.speed}x: ${four.writes} writes, ${four.bytes} bytes`);
  assert.equal(four.speed, 4);
  assert.equal(four.writes, one.writes);
  assert.equal(four.bytes, one.bytes);
});

test('foil bandwidth TABLE: every measured value', () => {
  console.log(['TABLE foil bandwidth', ...TABLE.map((l) => '  ' + l)].join('\n'));
  assert.ok(TABLE.length === 0 || TABLE.length >= BOUNDS.length);
});
