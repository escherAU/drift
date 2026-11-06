import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, SYNC_BEGIN, SYNC_END, frameToText, frameToAnsi } from '../src/renderer.js';
import { makePalette, presetRGB } from '../src/color.js';

const PAL = makePalette(presetRGB('claude', 0), 'truecolor');

function mk(cols, rows, fill = 32, shade = 0) {
  return { cols, rows, glyphs: new Uint16Array(cols * rows).fill(fill), shades: new Uint8Array(cols * rows).fill(shade), palette: PAL };
}
function clone(f) { return { ...f, glyphs: f.glyphs.slice(), shades: f.shades.slice() }; }

test('R1 an identical frame renders as the empty string', () => {
  const r = createRenderer();
  const f = mk(20, 5, 0x2588, 9);
  assert.notEqual(r.render(f), '');
  assert.equal(r.render(clone(f)), '');
  assert.equal(r.render(clone(f)), '');
});

test('R2 one changed cell costs one cursor address + glyph (< 60 bytes)', () => {
  const r = createRenderer();
  const f = mk(40, 10, 0x2588, 9);
  r.render(f);
  const g = clone(f);
  g.glyphs[3 * 40 + 7] = 0x2592;
  const out = r.render(g);
  assert.ok(out.length < 60, `len ${out.length}`);
  assert.equal(out.split('\x1b[4;8H').length - 1, 1, 'exactly one CUP to row 4 col 8');
  assert.ok(out.includes('▒'));
  assert.equal((out.match(/\x1b\[\d+;\d+H/g) || []).length, 1);
});

test('R2b the renderer body carries no sync wrapper (the app adds it)', () => {
  const r = createRenderer();
  const out = r.render(mk(20, 5, 0x2588, 9));
  assert.ok(!out.includes('\x1b[?2026'));
  assert.equal(SYNC_BEGIN + SYNC_END, '\x1b[?2026h\x1b[?2026l');
});

test('R3 a resize forces a full repaint (clear + every lit cell)', () => {
  const r = createRenderer();
  r.render(mk(20, 5, 0x2588, 9));
  const bigger = mk(30, 8, 0x2588, 9);
  const out = r.render(bigger);
  assert.ok(out.startsWith('\x1b[2J'));
  const glyphs = (out.match(/█/g) || []).length;
  assert.equal(glyphs, 30 * 8 - 1, 'every cell but the guarded last one');
  // control: same size again is a no-op
  assert.equal(r.render(clone(bigger)), '');
});

test('R4 changing only one cell colour re-emits only that cell', () => {
  const r = createRenderer();
  const f = mk(30, 6, 0x2593, 5);
  r.render(f);
  const g = clone(f);
  g.shades[2 * 30 + 4] = 11;
  const out = r.render(g);
  assert.equal((out.match(/\x1b\[\d+;\d+H/g) || []).length, 1);
  assert.ok(out.includes(PAL.sgr[11]));
  assert.ok(out.includes('▓'));
  assert.equal((out.match(/▓/g) || []).length, 1);
});

test('R4 a palette change repaints lit cells but not blank ones', () => {
  const r = createRenderer();
  const f = mk(10, 4, 32, 0);
  f.glyphs[5] = 0x2588; f.shades[5] = 15;
  r.render(f);
  const g = clone(f);
  g.palette = makePalette([10, 200, 10], 'truecolor');
  const out = r.render(g);
  assert.ok(out.includes('\x1b[38;2;10;200;10m'));
  assert.equal((out.match(/█/g) || []).length, 1);
  assert.equal((out.match(/\x1b\[\d+;\d+H/g) || []).length, 1);
});

test('a cell becoming blank is emitted as a space; a colour change under a space is ignored', () => {
  const r = createRenderer();
  const f = mk(10, 3, 32, 0);
  f.glyphs[4] = 0x2588; f.shades[4] = 15;
  r.render(f);
  const g = clone(f); g.glyphs[4] = 32; g.shades[4] = 15;
  assert.ok(r.render(g).includes('\x1b[1;5H '));
  const h = clone(g); h.shades[4] = 3;
  assert.equal(r.render(h), '');
});

test('adjacent changed cells share one cursor move and one colour code', () => {
  const r = createRenderer();
  const f = mk(30, 3, 32, 0);
  r.render(f);
  const g = clone(f);
  for (let x = 5; x < 12; x++) { g.glyphs[30 + x] = 0x2588; g.shades[30 + x] = 7; }
  const out = r.render(g);
  assert.equal((out.match(/\x1b\[\d+;\d+H/g) || []).length, 1);
  assert.equal((out.match(/\x1b\[38;/g) || []).length, 1);
  assert.ok(out.includes('███████'));
});

test('R6 never writes beyond the last column/row; the bottom-right cell is never drawn', () => {
  const r = createRenderer();
  const f = mk(12, 4, 0x2588, 15);
  const out = r.render(f);
  for (const m of out.matchAll(/\x1b\[(\d+);(\d+)H/g)) {
    assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= 4);
    assert.ok(Number(m[2]) >= 1 && Number(m[2]) <= 12);
  }
  assert.equal((out.match(/█/g) || []).length, 12 * 4 - 1);
  // no run ever crosses a row end without a new cursor address
  const rows = out.split(/\x1b\[\d+;1H/);
  for (const seg of rows.slice(1)) assert.ok((seg.match(/█/g) || []).length <= 12);
  // 1x1 is safe
  assert.equal(createRenderer().render(mk(1, 1, 0x2588, 5)).includes('█'), false);
});

test('frameToText / frameToAnsi give rows of glyph characters', () => {
  const f = mk(4, 2, 0x2588, 15);
  f.glyphs[0] = 32;
  const txt = frameToText(f);
  assert.equal(txt, ' ███\n████');
  const ansi = frameToAnsi(f);
  assert.ok(ansi.includes(PAL.sgr[15]));
  assert.ok(ansi.split('\n').length === 2);
  assert.ok(ansi.endsWith('\x1b[0m'));
});
