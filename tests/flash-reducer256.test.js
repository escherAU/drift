// DRIFT-7 item 3: makeReducer256 must show the meter exactly the colours renderRgb emits in mode '256'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, RGB_CELL, PALETTE_BG } from '../src/renderer.js';
import { makePalette, makeTwoTone, colourTables } from '../src/color.js';
import { newFrame, makeReducer256, rgbOf256 } from './helpers-flash-controls.js';

// A tiny terminal: follows cursor moves and SGR 38;5 / 48;5, records the fg/bg index in force for each printed glyph.
function emulate(out, cols, rows) {
  const fg = new Array(cols * rows).fill(null), bg = new Array(cols * rows).fill(null);
  let x = 0, y = 0, cf = null, cb = null;
  const re = /\x1b\[([0-9;?]*)([A-Za-z])|([^\x1b])/g;
  let m;
  while ((m = re.exec(out))) {
    if (m[3] !== undefined) { fg[y * cols + x] = cf; bg[y * cols + x] = cb; x++; continue; }
    const [, args, cmd] = m;
    if (cmd === 'H') { const [r, c] = args.split(';').map(Number); y = r - 1; x = c - 1; }
    else if (cmd === 'm') {
      const p = args === '' ? [0] : args.split(';').map(Number);
      for (let i = 0; i < p.length; i++) {
        if (p[i] === 0) { cf = null; cb = null; }
        else if (p[i] === 38 && p[i + 1] === 5) { cf = p[i + 2]; i += 2; }
        else if (p[i] === 48 && p[i + 1] === 5) { cb = p[i + 2]; i += 2; }
      }
    }
  }
  return { fg, bg };
}

const W = 24, H = 8, N = W * H;
const palettes = [
  makePalette([200, 100, 50], '256'),
  makePalette([40, 220, 180], '256'),
  makeTwoTone(false, '256'),
  makeTwoTone(true, '256'),
];

function mixedFrame(palette, seed) {
  const f = newFrame(W, H);
  f.palette = palette; f.mode = '256';
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s; };
  const nShades = palette.fg256.length;
  for (let i = 0; i < N; i++) {
    f.glyphs[i] = 0x41 + (i % 20);
    const kind = i % 4;
    if (kind === 0) { f.shades[i] = RGB_CELL; f.fg[i] = rnd() & 0xffffff; f.bg[i] = rnd() & 0xffffff; }
    else if (kind === 1) { f.shades[i] = RGB_CELL; f.fg[i] = rnd() & 0xffffff; f.bg[i] = PALETTE_BG; }
    else { f.shades[i] = rnd() % Math.min(nShades, 254); f.fg[i] = 0; f.bg[i] = 0; }
  }
  return f;
}

test('makeReducer256 colour indexes equal what renderRgb emits in mode 256 (mixed frames, several palettes)', () => {
  for (const [pi, palette] of palettes.entries()) {
    for (const seed of [1, 7, 12345]) {
      const f = mixedFrame(palette, seed + pi);
      const emitted = emulate(createRenderer().render(f), W, H);
      const r = makeReducer256(W, H)(f, palette);
      const pal = r.palette;
      let checked = 0, cube = 0;
      for (let i = 0; i < N - 1; i++) { // the renderer skips the bottom-right cell
        const s = r.frame.shades[i];
        let fgRgb, bgRgb;
        if (s === RGB_CELL) {
          fgRgb = r.frame.fg[i];
          bgRgb = r.frame.bg[i] === PALETTE_BG ? pal.bgRgb[0] : r.frame.bg[i];
          cube++;
        } else { fgRgb = pal.fgRgb[s]; bgRgb = pal.bgRgb[s]; }
        assert.equal(fgRgb, rgbOf256(emitted.fg[i]), `palette ${pi} seed ${seed} cell ${i} fg`);
        assert.equal(bgRgb, rgbOf256(emitted.bg[i]), `palette ${pi} seed ${seed} cell ${i} bg`);
        checked++;
      }
      assert.ok(checked === N - 1 && cube > 0);
    }
  }
});

test('makeReducer256 passes palette tables through as the palette\'s own 256 indexes', () => {
  const FGS = [[0, 0, 0], [64, 32, 16], [128, 96, 48], [252, 200, 100]];
  const pal = { key: 'g', ...colourTables(FGS, [[10, 20, 30], [40, 50, 60], [70, 80, 90], [100, 110, 120]]) };
  const r = makeReducer256(2, 2)(Object.assign(newFrame(2, 2), {}), pal);
  for (let s = 0; s < 4; s++) {
    assert.equal(r.palette.fgRgb[s], rgbOf256(pal.fg256[s]));
    assert.equal(r.palette.bgRgb[s], rgbOf256(pal.bg256[s]));
  }
});
