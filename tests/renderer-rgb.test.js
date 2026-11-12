// DRIFT-7 C2: the renderer's full-colour branch (a frame carrying fg/bg Uint32 0xRRGGBB per cell).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, RGB_CELL, PALETTE_BG } from '../src/renderer.js';
import { makePalette, makeTwoTone, colourTables } from '../src/color.js';

const CLEAR = '\x1b[2J';
const RESET = '\x1b[0m';
const W = 6, H = 3;
const N = W * H;
const LAST = N - 1;

// A palette whose table values have the two low bits clear, so a 255 cell can equal a palette cell exactly.
const FGS = [[0, 0, 0], [64, 32, 16], [128, 96, 48], [252, 200, 100]];
const grid = { key: 'grid', sgr: FGS.map((c) => `\x1b[38;2;${c.join(';')}m`), ...colourTables(FGS, null) };
const calm = makePalette([200, 100, 50], 'truecolor');
const calm256 = makePalette([200, 100, 50], '256');
const dark = makeTwoTone(false, 'truecolor');
const light = makeTwoTone(true, 'truecolor');

function rgbFrame(o = {}) {
  const cols = o.cols || W, rows = o.rows || H, n = cols * rows;
  return {
    cols, rows, palette: o.palette || grid, mode: o.mode,
    glyphs: new Uint16Array(n).fill(o.g === undefined ? 0x78 : o.g),
    shades: new Uint8Array(n).fill(RGB_CELL),
    fg: new Uint32Array(n).fill(o.fg === undefined ? 0xfc0000 : o.fg),
    bg: new Uint32Array(n).fill(o.bg === undefined ? 0x0000fc : o.bg),
  };
}
function clone(f) {
  return { ...f, glyphs: f.glyphs.slice(), shades: f.shades.slice(), fg: f.fg && f.fg.slice(), bg: f.bg && f.bg.slice() };
}
function palFrame(palette, g = 0x78, shade = 1, cols = W, rows = H) {
  return { cols, rows, palette, glyphs: new Uint16Array(cols * rows).fill(g), shades: new Uint8Array(cols * rows).fill(shade) };
}

test('RGB1 an unchanged full-colour frame renders as the empty string', () => {
  const r = createRenderer();
  const f = rgbFrame();
  assert.notEqual(r.render(f), '');
  assert.equal(r.render(clone(f)), '');
  assert.equal(r.render(clone(f)), '');
});

test('RGB2 fg under a space is ignored; fg under a glyph is emitted (both arms)', () => {
  const r = createRenderer();
  const f = rgbFrame({ g: 32 });
  r.render(f);
  const g = clone(f);
  g.fg[2] = 0x00fc00;
  assert.equal(r.render(g), '', 'space: fg change writes nothing');
  const r2 = createRenderer();
  const h = rgbFrame({ g: 0x78 });
  r2.render(h);
  const k = clone(h);
  k.fg[2] = 0x00fc00;
  const out = r2.render(k);
  assert.ok(out.includes('38;2;0;252;0'), JSON.stringify(out));
  // and the space's bg does matter
  const r3 = createRenderer();
  r3.render(f);
  const m = clone(f);
  m.bg[2] = 0x00fc00;
  assert.ok(r3.render(m).includes('48;2;0;252;0'));
});

test('RGB3 bg under U+2588 is ignored; bg under another glyph is emitted (both arms)', () => {
  const r = createRenderer();
  const f = rgbFrame({ g: 0x2588 });
  r.render(f);
  const g = clone(f);
  g.bg[2] = 0x00fc00;
  assert.equal(r.render(g), '', 'full block: bg change writes nothing');
  const r2 = createRenderer();
  const h = rgbFrame({ g: 0x2580 });
  r2.render(h);
  const k = clone(h);
  k.bg[2] = 0x00fc00;
  assert.ok(r2.render(k).includes('48;2;0;252;0'));
  // and the block's fg does matter
  const r3 = createRenderer();
  r3.render(f);
  const m = clone(f);
  m.fg[2] = 0x00fc00;
  assert.ok(r3.render(m).includes('38;2;0;252;0'));
});

test('RGB4 the bottom-right cell is never drawn; a change elsewhere is (both arms)', () => {
  const r = createRenderer();
  const f = rgbFrame();
  r.render(f);
  const g = clone(f);
  g.glyphs[LAST] = 0x79; g.fg[LAST] = 0x00fc00; g.bg[LAST] = 0x00fc00;
  assert.equal(r.render(g), '');
  const h = clone(g);
  h.glyphs[LAST - 1] = 0x79;
  const out = r.render(h);
  assert.ok(out.includes('y'), JSON.stringify(out));
  // the first frame does not draw it either
  const first = createRenderer().render(rgbFrame({ g: 0x7a }));
  assert.equal(first.split('z').length - 1, N - 1);
});

test('RGB5 no clear in normal frames; first frame, invalidate and resize clear like the palette branch (both arms)', () => {
  for (const pal of [calm, dark]) {
    const prefix = createRenderer().render(palFrame(pal)).slice(0, (pal.bg ? pal.base.length : 0) + CLEAR.length);
    assert.ok(prefix.endsWith(CLEAR));
    const r = createRenderer();
    const f = rgbFrame({ palette: pal });
    const first = r.render(f);
    assert.ok(first.startsWith(prefix), JSON.stringify(first.slice(0, 30)));
    const g = clone(f);
    g.glyphs[1] = 0x79; g.fg[4] = 0x00fc00;
    assert.ok(!r.render(g).includes(CLEAR), 'normal frame: no clear');
    // the screen may hold a stale rgb background, so a non-bg palette gets the RESET the palette branch
    // sends after a bg palette (judgement call; the prefix proper is identical)
    const lead = pal.bg ? '' : RESET;
    r.invalidate();
    assert.ok(r.render(g).startsWith(lead + prefix), 'invalidate repaints with the palette prefix');
    const big = rgbFrame({ palette: pal, cols: W + 2, rows: H });
    assert.ok(r.render(big).startsWith(lead + prefix), 'resize repaints with the palette prefix');
    assert.ok(!r.render(clone(big)).includes(CLEAR));
  }
  // full repaint draws every cell but the last, spaces included
  const out = createRenderer().render(rgbFrame({ g: 32 }));
  assert.equal(out.split(' ').length - 1, N - 1);
});

test('RGB6 branch switch writes the empty string for identical content (palette to rgb)', () => {
  const r = createRenderer();
  const p = palFrame(grid, 0x78, 2);
  p.glyphs[1] = 32; p.glyphs[2] = 0x2588; p.shades[3] = 3;
  assert.notEqual(r.render(p), '');
  const asRgb = { ...clone(p), fg: new Uint32Array(N), bg: new Uint32Array(N) };
  assert.equal(r.render(asRgb), '', 'same glyphs and palette shades, no 255 cell');
  // 255 cells whose fg/bg equal the old tables' values for the previous cells
  const r2 = createRenderer();
  r2.render(p);
  const q = { ...clone(p), fg: new Uint32Array(N), bg: new Uint32Array(N) };
  for (let i = 0; i < N; i++) {
    const s = p.glyphs[i] === 32 ? 0 : p.shades[i];
    q.shades[i] = RGB_CELL; q.fg[i] = grid.fgRgb[s]; q.bg[i] = grid.bgRgb[s];
  }
  assert.equal(r2.render(q), '', '255 cells equal to the table values');
  // a real difference is drawn, and only that cell
  const d = clone(q);
  d.fg[4] = 0x00fc00;
  const out = r2.render(d);
  assert.equal((out.match(/\x1b\[\d+;\d+H/g) || []).length, 1);
  assert.ok(out.includes('38;2;0;252;0'));
});

test('RGB6b takeover is correct for any content, including a different palette', () => {
  const r = createRenderer();
  r.render(palFrame(grid, 0x78, 1));
  const f = { ...palFrame(grid, 0x78, 2), fg: new Uint32Array(N), bg: new Uint32Array(N) }; // shade 1 -> 2 everywhere
  const out = r.render(f);
  assert.equal((out.match(/\x1b\[\d+;\d+H/g) || []).length, H, 'one cursor run per row: all cells change');
  assert.equal(out.split('x').length - 1, N - 1);
  assert.ok(!out.includes(CLEAR));
  // a palette swap on the way in redraws the cells whose resolved colour changed
  const r2 = createRenderer();
  r2.render(palFrame(grid, 0x78, 1));
  const other = { key: 'other', sgr: ['', ''], ...colourTables([[0, 0, 0], [8, 8, 8]], null) };
  const g = { ...palFrame(other, 0x78, 1), fg: new Uint32Array(N), bg: new Uint32Array(N) };
  const out2 = r2.render(g);
  assert.ok(out2.includes('38;2;8;8;8'), JSON.stringify(out2.slice(0, 60)));
});

test('RGB7 palette cells emit exactly their table values; 255 cells lose the two low bits (one frame)', () => {
  const r = createRenderer();
  const f = rgbFrame({ palette: calm, g: 0x78, bg: 0x0a0b0e, fg: 0x0b0c0d });
  const tv = calm.fgRgb[2]; // 200,100,50 at shade 2: not a multiple of 4
  assert.notEqual(tv & 0x030303, 0, 'the table value has low bits set');
  f.shades[0] = 2; // palette cell
  f.shades[1] = RGB_CELL; f.fg[1] = tv; f.bg[1] = 0x0a0b0e;
  const out = r.render(f);
  const [tr, tg, tb] = [(tv >> 16) & 255, (tv >> 8) & 255, tv & 255];
  const cell0 = out.indexOf(`38;2;${tr};${tg};${tb}`);
  assert.ok(cell0 >= 0, 'palette cell: exact table fg');
  const dropped = `38;2;${tr & 0xfc};${tg & 0xfc};${tb & 0xfc}`;
  assert.notEqual(dropped, `38;2;${tr};${tg};${tb}`);
  assert.ok(out.includes(dropped), '255 cell: low bits dropped');
  assert.ok(out.includes('48;2;0;0;0'), 'palette cell bg is the table bg, exact');
  assert.ok(out.includes('48;2;8;8;12'), '255 cell bg: low bits dropped');
});

test('RGB8 PALETTE_BG resolves to the palette background; fg is independent', () => {
  const r = createRenderer();
  const f = rgbFrame({ palette: light, fg: 0x102030, bg: PALETTE_BG });
  const out = r.render(f);
  assert.ok(out.includes('\x1b[38;2;16;32;48;48;2;255;255;255mx'), JSON.stringify(out));
  const g = clone(f);
  g.fg[2] = 0x405060;
  const out2 = r.render(g);
  assert.equal(out2, '\x1b[1;3H\x1b[38;2;64;80;96mx', 'only fg changed; the bg is still the palette bg');
  const noBg = createRenderer().render(rgbFrame({ palette: calm, bg: PALETTE_BG }));
  assert.ok(noBg.includes('48;2;0;0;0'), 'a palette without a bg resolves to its table entry (black)');
  assert.ok(PALETTE_BG > 0xffffff);
});

test('RGB9 leaving: rgb to palette starts with RESET, leaks no rgb background, then settles to empty', () => {
  const r = createRenderer();
  r.render(rgbFrame({ palette: calm, bg: 0x2040fc }));
  const out = r.render(palFrame(calm, 0x2588, 3));
  assert.ok(out.startsWith(RESET + CLEAR), JSON.stringify(out.slice(0, 20)));
  assert.ok(!out.includes('48;2'), 'no stale rgb background');
  assert.equal(r.render(palFrame(calm, 0x2588, 3)), '');
  // a palette that has its own bg: its base wins, still no stale rgb background
  const r2 = createRenderer();
  r2.render(rgbFrame({ palette: dark, bg: 0x2040fc }));
  const o2 = r2.render(palFrame(dark, 0x78, 0));
  assert.ok(o2.startsWith(dark.base + CLEAR));
  assert.ok(!o2.includes('48;2;32;64;252'));
  // palette-only output never gets a reset (the new code leaves it alone)
  const r3 = createRenderer();
  assert.ok(!r3.render(palFrame(calm)).includes(RESET));
  // rgb -> rgb after invalidate also resets before it clears
  const r4 = createRenderer();
  r4.render(rgbFrame({ palette: calm, bg: 0x2040fc }));
  r4.invalidate();
  assert.ok(r4.render(rgbFrame({ palette: calm })).startsWith(RESET + CLEAR));
});

// ---- 256-colour mode

const CUBE = [0, 95, 135, 175, 215, 255];
function xterm(i) {
  if (i < 232) { const k = i - 16; return [CUBE[Math.floor(k / 36)], CUBE[Math.floor(k / 6) % 6], CUBE[k % 6]]; }
  const v = 8 + (i - 232) * 10;
  return [v, v, v];
}
function lab(rgb) {
  const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
const LABS = [];
for (let i = 16; i < 256; i++) LABS[i] = lab(xterm(i));
// The documented rule: judge the colour at the centre of its 5-bit-per-channel cell.
function expectedIndex(c) {
  const ch = [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) => { const q = v >> 3; return (q << 3) | (q >> 2); });
  const L = lab(ch);
  let best = -1, bd = Infinity;
  for (let i = 16; i < 256; i++) {
    const d = (4 * (L[0] - LABS[i][0])) ** 2 + (L[1] - LABS[i][1]) ** 2 + (L[2] - LABS[i][2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function indexFor(c) {
  const f = { ...rgbFrame({ cols: 3, rows: 1, palette: calm256, mode: '256', g: 0x2588 }) };
  f.fg[0] = c;
  const out = createRenderer().render(f);
  const m = /38;5;(\d+)m/.exec(out);
  assert.ok(m, JSON.stringify(out));
  return Number(m[1]);
}

test('RGB10 256 mode: only 38;5 / 48;5 forms; fine changes collapse to nothing; big ones emit', () => {
  const r = createRenderer();
  const f = rgbFrame({ palette: calm256, mode: '256', fg: 0x808080, bg: 0x203040 });
  f.shades[1] = 2; // a palette cell in the same frame
  const first = r.render(f);
  assert.ok(!/(?:38|48);2;/.test(first), JSON.stringify(first.slice(0, 80)));
  assert.ok(/38;5;\d+/.test(first) && /48;5;\d+/.test(first));
  assert.ok(first.includes(`38;5;${calm256.fg256[2]}`), 'palette cell uses fg256');
  const tiny = clone(f);
  tiny.fg.fill(0x828282);
  assert.equal(r.render(tiny), '', 'a tiny fg change collapses to the same index');
  const big = clone(f);
  big.fg.fill(0xfc2000);
  const out = r.render(big);
  assert.ok(out.includes('38;5;'));
  assert.ok(!/(?:38|48);2;/.test(out));
});

test('RGB10b 256 lookup: black and white, and equals brute-force OKLab (L x4) for 300 seeded colours', () => {
  assert.equal(indexFor(0x000000), 16);
  assert.equal(indexFor(0xffffff), 231);
  let seed = 12345;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const seen = new Set();
  for (let k = 0; k < 300; k++) {
    const c = next() & 0xffffff;
    const got = indexFor(c);
    seen.add(got);
    assert.equal(got, expectedIndex(c), `colour ${c.toString(16)}`);
    assert.ok(got >= 16 && got <= 255);
  }
  assert.ok(seen.size > 40, `sample covers many indexes (${seen.size})`);
  // one renderer, same colours again: the lazily built table gives the same answers
  const r = createRenderer();
  const f = rgbFrame({ cols: 3, rows: 1, palette: calm256, mode: '256', g: 0x2588, fg: 0x123456 });
  const a = r.render(f);
  r.invalidate();
  assert.equal(r.render(f), RESET + a);
});

// ---- combined codes

test('RGB11 fg and bg both change: one SGR with both; only fg changes: only 38;2', () => {
  const r = createRenderer();
  const f = rgbFrame({ cols: 4, rows: 2 });
  r.render(f);
  const g = clone(f);
  g.fg[1] = 0x102030; g.bg[1] = 0x405060;
  assert.equal(r.render(g), '\x1b[1;2H\x1b[38;2;16;32;48;48;2;64;80;96mx');
  const h = clone(g);
  h.fg[1] = 0x708090;
  assert.equal(r.render(h), '\x1b[1;2H\x1b[38;2;112;128;144mx');
  const k = clone(h);
  k.bg[1] = 0x0000fc;
  assert.equal(r.render(k), '\x1b[1;2H\x1b[48;2;0;0;252mx');
});

test('RGB12 adjacent changed cells share one cursor move and skip repeated codes', () => {
  const r = createRenderer();
  const f = rgbFrame({ cols: 8, rows: 2 });
  r.render(f);
  const g = clone(f);
  for (let i = 2; i < 5; i++) g.glyphs[i] = 0x79;
  // the terminal already holds these colours from the last cell drawn, so no code at all
  assert.equal(r.render(g), '\x1b[1;3Hyyy');
  const h = clone(g);
  h.fg[3] = 0x00fc00;
  assert.equal(r.render(h), '\x1b[1;4H\x1b[38;2;0;252;0my');
});
