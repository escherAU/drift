// DRIFT-7 stage F, item 5: the truecolor .ansi captures of the Driftman 9000 (tools/capture-ansi.mjs -> captures-ansi/).
//   (1) the tool is deterministic: two runs give identical bytes, and they are the committed files (nothing stale, nothing missing, nothing extra)
//   (2) the bytes ARE the renderer's: each file is createRenderer().render(frame) of the app's own screenshot plus the tail, no second serialiser
//   (3) an independent reader (helpers-ansi.js, which knows nothing of the renderer) rebuilds each file's cell grid; it equals the frame the renderer was
//       given, cell for cell: glyph everywhere (but the bottom-right cell the renderer never draws), foreground under every drawn glyph that is not a blank,
//       background under every cell that is not a full block (the renderer's two "do not care" cases), 24-bit colours only, nothing off the grid
//   (4) the glyphs of each file equal its text capture (captures/cart-*.txt) where there is one, and the plain frame where not
//   (5) controls: a changed colour, a changed glyph and a shifted cursor in a file are each found by the same comparison
//   (6) `node tools/capture.mjs` regenerates every file of captures/ byte for byte (the folder stays clean)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRenderer, RGB_CELL, PALETTE_BG, frameToText } from '../src/renderer.js';
import { shelfLayout } from '../src/shell/library.js';
import { sizeTier } from '../src/shell/ui.js';
import { ansiSpecs, ANSI_NAMES, collectAnsiFrames, frameToAnsiFile, runCaptureAnsi } from '../tools/capture-ansi.mjs';
import { readAnsi, DEFAULT } from './helpers-ansi.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const COMMITTED = path.join(ROOT, 'captures-ansi');
const TEXT = path.join(ROOT, 'captures');
const CAPTURE_TOOL = path.join(ROOT, 'tools', 'capture.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'drift-ansi-'));

// Every frame once for the file (the tool's slow part); each test below reads this.
const FRAMES = await collectAnsiFrames();
const SPECS = ansiSpecs();

// What a cell should hold after the renderer's full paint, from the frame and its palette alone (the renderer's documented rules: a blank has no foreground to
// speak of, a full block has no background to speak of; a full-colour cell takes the 6-bit grid of fg/bg, PALETTE_BG means the palette's background).
export function expectedGrid(frame) {
  const { cols, rows, glyphs, shades, fg, bg, palette } = frame;
  const n = cols * rows;
  const g = new Uint16Array(n), f = new Int32Array(n), b = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    g[i] = glyphs[i];
    let s = shades ? shades[i] : RGB_CELL;
    if (glyphs[i] === 32 && s !== RGB_CELL) s = 0;
    let fv, bv;
    if (s === RGB_CELL && fg) { fv = fg[i] & 0xFCFCFC; bv = bg[i] === PALETTE_BG ? palette.bgRgb[0] : bg[i] & 0xFCFCFC; } else { fv = palette.fgRgb[s]; bv = palette.bg ? palette.bgRgb[s] : DEFAULT; }
    f[i] = glyphs[i] === 32 ? -2 : fv; // -2: do not compare
    b[i] = glyphs[i] === 0x2588 ? -2 : bv;
  }
  return { g, f, b };
}

// Compare a screen the reader rebuilt with the expected grid; -> list of problems (empty when equal).
export function compareScreen(screen, frame, limit = 10) {
  const exp = expectedGrid(frame);
  const n = frame.cols * frame.rows, last = n - 1;
  const bad = [];
  const note = (m) => { if (bad.length < limit) bad.push(m); };
  if (screen.overflow) note(`${screen.overflow} cells written off the grid`);
  if (screen.unknown.length) note(`unknown sequences: ${screen.unknown.slice(0, 3).join(' | ')}`);
  for (let i = 0; i < last; i++) {
    const at = `(${i % frame.cols},${Math.floor(i / frame.cols)})`;
    if (screen.glyphs[i] !== exp.g[i]) { note(`glyph ${at}: file ${screen.glyphs[i]}, frame ${exp.g[i]}`); continue; }
    if (exp.f[i] !== -2 && screen.fg[i] !== exp.f[i]) note(`fg ${at}: file ${screen.fg[i].toString(16)}, frame ${exp.f[i].toString(16)}`);
    if (exp.b[i] !== -2 && screen.bg[i] !== exp.b[i]) note(`bg ${at}: file ${screen.bg[i].toString(16)}, frame ${exp.b[i].toString(16)}`);
  }
  return bad;
}

const textOf = (screen) => { const rows = []; for (let y = 0; y < screen.rows; y++) rows.push(screen.row(y)); return rows; };

test('capture-ansi: the specs are the 32 files the brief names, with the sizes in their names', () => {
  assert.equal(SPECS.length, 32);
  for (const s of SPECS) {
    const m = /(\d+)x(\d+)$/.exec(s.name);
    assert.ok(m, `${s.name}: the size is in the name`);
    assert.deepEqual([s.cols, s.rows], [+m[1], +m[2]], s.name);
  }
  const names = new Set(SPECS.map((s) => s.name));
  for (const want of ['label-24x10', 'console-rest-120x40', 'console-rest-80x24', 'menu-grid-120x40', 'menu-list-80x24', 'help-120x40', 'help-80x24',
    'rosette-120x40', 'rosette-80x24', 'cortex-120x40', 'cortex-80x24', 'bloomfall-120x40', 'bloomfall-80x24', 'library-driftman-9000-selected-120x40',
    'morph-insert-t1000-120x40', 'morph-insert-t1100-120x40', 'morph-insert-t1200-120x40', 'morph-insert-t1300-120x40', 'morph-insert-t1400-120x40', 'morph-insert-t1500-120x40',
    'morph-boot-t1700-120x40', 'morph-rest-t2000-120x40']) assert.ok(names.has(want), want);
  assert.deepEqual([...FRAMES.keys()], SPECS.map((s) => s.name), 'a frame for every name, in order');
  for (const s of SPECS) {
    const f = FRAMES.get(s.name);
    assert.deepEqual([f.cols, f.rows], [s.cols, s.rows], `${s.name}: the frame is the size in its name`);
  }
});

test('capture-ansi: deterministic - a second run gives the same bytes - and the committed captures-ansi folder is exactly those files', async () => {
  const again = await collectAnsiFrames();
  for (const [name, frame] of FRAMES) assert.equal(frameToAnsiFile(again.get(name)), frameToAnsiFile(frame), `${name}: second run`);
  assert.deepEqual(fs.readdirSync(COMMITTED).sort(), ANSI_NAMES().sort(), 'nothing stale, nothing missing');
  for (const [name, frame] of FRAMES) assert.equal(fs.readFileSync(path.join(COMMITTED, `${name}.ansi`), 'utf8'), frameToAnsiFile(frame), `${name}: the committed file is the tool's output`);
});

test('capture-ansi: runCaptureAnsi writes the files (and the CLI says how many)', async () => {
  const dir = tmp();
  try {
    const files = await runCaptureAnsi({ outDir: dir });
    assert.equal(files.length, SPECS.length);
    assert.deepEqual(fs.readdirSync(dir).sort(), ANSI_NAMES().sort());
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'capture-ansi.mjs'), '--out', dir], { encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^wrote 32 \.ansi files \(\d+ bytes\) to /);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('capture-ansi: each file is the renderer\'s own first paint of the app\'s screenshot (clear, every cell addressed, 24-bit colour) plus the colour reset and the cursor on the last row', () => {
  for (const [name, frame] of FRAMES) {
    const t = fs.readFileSync(path.join(COMMITTED, `${name}.ansi`), 'utf8');
    const paint = createRenderer().render(frame);
    assert.equal(t, `${paint}\x1b[0m\x1b[${frame.rows};1H`, name);
    assert.ok(t.includes('\x1b[2J'), `${name}: clears the screen first`);
    assert.ok(!/\x1b\[(?:38|48);5;/.test(t), `${name}: 24-bit colour only (no 256-colour index)`);
    assert.ok(/\x1b\[38;2;\d+;\d+;\d+/.test(t), `${name}: 24-bit foreground`);
    assert.ok(!t.includes('\n'), `${name}: no newline to scroll the screen`);
  }
});

test('capture-ansi: an independent reader rebuilds every file\'s screen and it equals the renderer\'s frame (glyph, foreground, background) in all 32 files', () => {
  let cells = 0, fgChecked = 0;
  for (const [name, frame] of FRAMES) {
    const t = fs.readFileSync(path.join(COMMITTED, `${name}.ansi`), 'utf8');
    const screen = readAnsi(t, frame.cols, frame.rows);
    const bad = compareScreen(screen, frame);
    assert.deepEqual(bad, [], `${name}: ${bad.length} problem(s)`);
    cells += frame.cols * frame.rows - 1;
    for (let i = 0; i < frame.cols * frame.rows - 1; i++) if (frame.glyphs[i] !== 32) fgChecked++;
    // the tail left the cursor on the last row, first column
    assert.deepEqual([screen.x, screen.y], [0, frame.rows - 1], `${name}: cursor parked on the last row`);
  }
  console.log(`TABLE capture-ansi reader: ${FRAMES.size} files, ${cells} cells compared, ${fgChecked} foregrounds compared`);
});

test('capture-ansi: the glyphs of each file are its text capture (captures/cart-*.txt, minus the header, bottom-right cell not drawn); the label is the label window of the library capture', () => {
  let twins = 0;
  for (const s of SPECS) {
    const screen = readAnsi(fs.readFileSync(path.join(COMMITTED, `${s.name}.ansi`), 'utf8'), s.cols, s.rows);
    const got = textOf(screen);
    let want;
    if (s.twin) {
      const body = fs.readFileSync(path.join(TEXT, s.twin), 'utf8').split('\n').slice(1, 1 + s.rows);
      assert.equal(body.length, s.rows, `${s.name}: text capture rows`);
      want = body;
      twins++;
    } else if (s.name === 'label-24x10') {
      const lib = fs.readFileSync(path.join(TEXT, 'cart-library-driftman-9000-120x40.txt'), 'utf8').split('\n').slice(1, 41);
      const L = shelfLayout(120, 40, sizeTier(120, 40));
      want = lib.slice(L.cartTop + 3, L.cartTop + 13).map((l) => [...l].slice(L.cartX + 3, L.cartX + 27).join(''));
      twins++;
    } else {
      want = frameToText(FRAMES.get(s.name)).split('\n'); // no text capture: the plain frame itself
    }
    for (let y = 0; y < s.rows; y++) {
      const a = got[y], b = want[y];
      assert.equal([...b].length, s.cols, `${s.name} row ${y} width`);
      if (y === s.rows - 1) assert.equal(a.slice(0, -1), [...b].slice(0, -1).join(''), `${s.name} row ${y} (but the bottom-right cell)`);
      else assert.equal(a, b, `${s.name} row ${y}`);
    }
  }
  assert.equal(twins, 23, 'the shelf, 3 insert, 6 morph, 3 boot, 2 console-rest, 2 menu, 2 help, 3 eject files and the label have a text capture');
});

test('capture-ansi controls: a changed colour, a changed glyph and a stray cursor move in a file are each found by the comparison; the untouched file passes', () => {
  const name = 'menu-grid-120x40';
  const frame = FRAMES.get(name);
  const t = fs.readFileSync(path.join(COMMITTED, `${name}.ansi`), 'utf8');
  const ok = (str) => compareScreen(readAnsi(str, frame.cols, frame.rows), frame);
  assert.deepEqual(ok(t), [], 'control: untouched');
  // 1. the first 24-bit foreground, one channel changed
  const m = /\x1b\[38;2;(\d+);(\d+);(\d+)/.exec(t);
  const tampered = t.slice(0, m.index) + `\x1b[38;2;${(+m[1] + 8) % 256};${m[2]};${m[3]}` + t.slice(m.index + m[0].length);
  assert.ok(ok(tampered).some((p) => p.startsWith('fg') || p.startsWith('bg')), 'a changed colour is found');
  // 2. one printable glyph replaced (the first letter after the last escape sequence of a run)
  const i = t.search(/ROSETTE/);
  assert.ok(i > 0);
  assert.ok(ok(t.slice(0, i) + 'X' + t.slice(i + 1)).some((p) => p.startsWith('glyph')), 'a changed glyph is found');
  // 3. a cursor move to the wrong column
  const h = /\x1b\[(\d+);(\d+)H/.exec(t.slice(10));
  assert.ok(h);
  const at = t.indexOf(h[0], 10);
  assert.ok(ok(t.slice(0, at) + `\x1b[${h[1]};${+h[2] + 1}H` + t.slice(at + h[0].length)).length > 0, 'a shifted cursor is found');
});

test('capture-ansi: node tools/capture.mjs regenerates every file of captures/ byte for byte (the folder stays clean)', () => {
  const dir = tmp();
  try {
    const r = spawnSync(process.execPath, [CAPTURE_TOOL, '--out', dir], { encoding: 'utf8', timeout: 300000 });
    assert.equal(r.status, 0, r.stderr);
    const made = fs.readdirSync(dir).sort();
    const have = fs.readdirSync(TEXT).filter((n) => /\.(txt|ansi)$/.test(n)).sort();
    assert.deepEqual(made.filter((n) => !have.includes(n)), [], 'every regenerated file is in captures/');
    const differ = made.filter((n) => fs.existsSync(path.join(TEXT, n)) && !fs.readFileSync(path.join(dir, n)).equals(fs.readFileSync(path.join(TEXT, n))));
    assert.deepEqual(differ, [], 'regenerated files that differ from the committed ones');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
