// DRIFT-7 C3a: src/pixels.js - half-block and braille helpers, safeHue (same-brightness, red-safe colour),
// staggerTime, relY. The safeHue table is checked against an exact (table-free) computation at every entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  RGB_CELL as P_RGB_CELL, PALETTE_BG as P_PALETTE_BG, pixelsToCells, brailleToCells, safeHue, safeHueExact,
  safeHueLinear, staggerTime, relY, HUE_COLS, L_ROWS,
} from '../src/pixels.js';
import { RGB_CELL, PALETTE_BG } from '../src/renderer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// independent luminance formula (not the one in pixels.js)
function indepY(rgb) {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((rgb >>> 16) & 255) + 0.7152 * f((rgb >>> 8) & 255) + 0.0722 * f(rgb & 255);
}
const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const drop = (c) => c & 0xFCFCFC;

const mk = (cols, rows) => ({
  glyphs: new Uint16Array(cols * rows).fill(32), colours: new Uint8Array(cols * rows),
  fg: new Uint32Array(cols * rows), bg: new Uint32Array(cols * rows),
});

test('re-exports: RGB_CELL and PALETTE_BG are the renderer values (one definition)', () => {
  assert.equal(P_RGB_CELL, RGB_CELL);
  assert.equal(P_PALETTE_BG, PALETTE_BG);
  assert.equal(RGB_CELL, 255);
  assert.equal(PALETTE_BG, 0x1000000);
});

test('relY: matches an independent formula, and the end points', () => {
  assert.equal(relY(0x000000), 0);
  assert.ok(Math.abs(relY(0xFFFFFF) - 1) < 1e-12);
  for (const c of [0x123456, 0xFF0000, 0x00FF00, 0x0000FF, 0x808080, 0xD97757, 0x0A0A0A, 0xFEDCBA]) {
    assert.ok(Math.abs(relY(c) - indepY(c)) < 1e-9, c.toString(16));
  }
  assert.ok(Math.abs(relY(0xFF0000) - 0.2126) < 1e-9);
  assert.ok(Math.abs(relY(0x00FF00) - 0.7152) < 1e-9);
  assert.ok(Math.abs(relY(0x0000FF) - 0.0722) < 1e-9);
});

// ---- pixelsToCells --------------------------------------------------------------------------------

test('pixelsToCells: two vertical pixels per cell, upper half block, fg = top, bg = bottom', () => {
  const p = mk(3, 2);
  const px = Uint32Array.from([0x112233, 0x445566, 0x778899, 0xAABBCC, 0xDDEEFF, 0x102030]);
  // 3 wide x 2 high: one cell row
  pixelsToCells(p, 3, 2, px, 3, 2, 0, 0);
  assert.equal(p.glyphs[0], 0x2580);
  assert.equal(p.fg[0], 0x112233); assert.equal(p.bg[0], 0xAABBCC);
  assert.equal(p.fg[1], 0x445566); assert.equal(p.bg[1], 0xDDEEFF);
  assert.equal(p.fg[2], 0x778899); assert.equal(p.bg[2], 0x102030);
  for (let i = 0; i < 3; i++) assert.equal(p.colours[i], 255);
  for (let i = 3; i < 6; i++) { assert.equal(p.colours[i], 0); assert.equal(p.glyphs[i], 32); }
});

test('pixelsToCells: equal halves become a space with bg = the pixel colour', () => {
  const p = mk(2, 1);
  pixelsToCells(p, 2, 1, Uint32Array.from([0x336699, 0x336699, 0x336699, 0x336698]), 2, 2, 0, 0);
  assert.equal(p.glyphs[0], 32); assert.equal(p.bg[0], 0x336699); assert.equal(p.colours[0], 255);
  assert.equal(p.glyphs[1], 0x2580); assert.equal(p.fg[1], 0x336699); assert.equal(p.bg[1], 0x336698);
});

test('pixelsToCells: an odd height leaves the last cell row half-drawn (top pixel only, bg kept)', () => {
  const p = mk(1, 2);
  p.bg[1] = 0x010203;
  pixelsToCells(p, 1, 2, Uint32Array.from([1, 2, 3]), 1, 3, 0, 0);
  assert.equal(p.glyphs[0], 0x2580); assert.equal(p.fg[0], 1); assert.equal(p.bg[0], 2);
  assert.equal(p.glyphs[1], 0x2580); assert.equal(p.fg[1], 3); assert.equal(p.bg[1], 0x010203);
  assert.equal(p.colours[1], 255);
});

test('pixelsToCells: offsets, and clipping at every buffer edge writes nothing outside', () => {
  const cols = 4, rows = 3;
  const px = new Uint32Array(6 * 8).fill(0xABCDEF);
  px[0] = 0x111111;
  const check = (ox, oy) => {
    const p = mk(cols, rows);
    pixelsToCells(p, cols, rows, px, 6, 8, ox, oy);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const inside = x - ox >= 0 && x - ox < 6 && y - oy >= 0 && y - oy < 4;
      assert.equal(p.colours[y * cols + x], inside ? 255 : 0, `ox=${ox} oy=${oy} cell ${x},${y}`);
    }
    return p;
  };
  check(0, 0); check(-2, -1); check(2, 1); check(-10, 0); check(0, 10); check(3, 2); check(-5, -3);
  const p = check(-1, 0);
  assert.equal(p.glyphs[0], 32); // pixel (1,0)/(1,1) equal halves
  const q = mk(cols, rows);
  pixelsToCells(q, cols, rows, px, 6, 8, 0, 0);
  assert.equal(q.fg[0], 0x111111); assert.equal(q.bg[0], 0xABCDEF); assert.equal(q.glyphs[0], 0x2580);
});

test('pixelsToCells: empty or degenerate input draws nothing and does not throw', () => {
  const p = mk(2, 2);
  pixelsToCells(p, 2, 2, new Uint32Array(0), 0, 0, 0, 0);
  pixelsToCells(p, 0, 0, new Uint32Array(4), 2, 2, 0, 0);
  assert.ok(p.colours.every((v) => v === 0));
});

// ---- brailleToCells -------------------------------------------------------------------------------

test('brailleToCells: the eight dots map to the standard braille bits', () => {
  // [dx, dy, bit]: dots 1..8 of Unicode braille
  const MAP = [[0, 0, 0x01], [0, 1, 0x02], [0, 2, 0x04], [1, 0, 0x08], [1, 1, 0x10], [1, 2, 0x20], [0, 3, 0x40], [1, 3, 0x80]];
  for (const [dx, dy, bit] of MAP) {
    const p = mk(1, 1);
    const dots = new Uint8Array(8); dots[dy * 2 + dx] = 1;
    brailleToCells(p, 1, 1, dots, 2, 4, 0xFFFFFF, 0x000010, 0, 0);
    assert.equal(p.glyphs[0], 0x2800 + bit, `dot at ${dx},${dy}`);
    assert.equal(p.fg[0], 0xFFFFFF); assert.equal(p.bg[0], 0x000010); assert.equal(p.colours[0], 255);
  }
  const all = mk(1, 1);
  brailleToCells(all, 1, 1, new Uint8Array(8).fill(1), 2, 4, 1, 2, 0, 0);
  assert.equal(all.glyphs[0], 0x28FF);
});

test('brailleToCells: an empty cell is a space with a bg only; per-cell colours; offsets and clipping', () => {
  const p = mk(3, 2);
  const dots = new Uint8Array(4 * 4); // 4 dots wide = 2 cells, 4 high = 1 cell row
  dots[0] = 1; // cell 0 has dot 1; cell 1 empty
  brailleToCells(p, 3, 2, dots, 4, 4, Uint32Array.from([0xAA0000, 0x00AA00]), Uint32Array.from([0x000001, 0x000002]), 1, 0);
  assert.equal(p.glyphs[0], 32); assert.equal(p.colours[0], 0);
  assert.equal(p.glyphs[1], 0x2801); assert.equal(p.fg[1], 0xAA0000); assert.equal(p.bg[1], 0x000001);
  assert.equal(p.glyphs[2], 32); assert.equal(p.bg[2], 0x000002); assert.equal(p.colours[2], 255);
  assert.equal(p.colours[3], 0);
  // clipped at the right edge
  const q = mk(2, 1);
  brailleToCells(q, 2, 1, new Uint8Array(16).fill(1), 4, 4, 5, 6, 1, 0);
  assert.equal(q.colours[0], 0); assert.equal(q.glyphs[1], 0x28FF);
  const r = mk(2, 1);
  brailleToCells(r, 2, 1, new Uint8Array(16).fill(1), 4, 4, 5, 6, -1, 0);
  assert.equal(r.glyphs[0], 0x28FF); assert.equal(r.colours[1], 0);
});

test('brailleToCells: a partial last cell (grid not a multiple of 2x4) treats missing dots as off', () => {
  const p = mk(1, 1);
  const dots = Uint8Array.from([1, 1, 1]); // 3 wide... 1 row of 3 dots -> cells 2 wide, 1 high
  const q = mk(2, 1);
  brailleToCells(q, 2, 1, dots, 3, 1, 9, 8, 0, 0);
  assert.equal(q.glyphs[0], 0x2800 + 0x01 + 0x08);
  assert.equal(q.glyphs[1], 0x2801);
  void p;
});

// ---- safeHue --------------------------------------------------------------------------------------

test('safeHue: after the 2-bit drop, luminance is within 0.015 of L^3 for all hues and L 0.18..0.85', () => {
  // L is rounded to one of 64 rows, so the target is the ROW's L^3. Against the continuous L^3 the 64-row
  // rounding alone is up to 0.5/63 * 3 L^2 (0.020 at L 0.92), so that figure is logged, not asserted.
  let worst = 0, at = '', worstCont = 0, atCont = '';
  for (let h = 0; h < 360; h++) for (let li = 18; li <= 85; li++) {
    const L = li / 100;
    const c = drop(safeHue(h, L));
    assert.equal(c, safeHue(h, L), 'the table already holds grid colours: the drop changes nothing');
    const rowL = Math.round(L * 63) / 63;
    const err = Math.abs(relY(c) - rowL * rowL * rowL);
    const cont = Math.abs(relY(c) - L * L * L);
    if (err > worst) { worst = err; at = `h=${h} L=${L}`; }
    if (cont > worstCont) { worstCont = cont; atCont = `h=${h} L=${L}`; }
    assert.ok(err <= 0.015, `h=${h} L=${L} |Y-rowL^3|=${err.toFixed(4)}`);
    assert.ok(Math.abs(relY(c) - indepY(c)) < 1e-9);
  }
  console.log(`# worst |Y-rowL^3| after 2-bit drop: ${worst.toFixed(5)} at ${at}; vs continuous L^3: ${worstCont.toFixed(5)} at ${atCont}`);
});

test('safeHue: linear red share <= 0.75 at EVERY table entry (8-bit output, and again after the 2-bit drop)', () => {
  const share = (c) => { const r = lin((c >>> 16) & 255), g = lin((c >>> 8) & 255), b = lin(c & 255); const s = r + g + b; return s === 0 ? 0 : r / s; };
  let worst8 = 0, worstDrop = 0, at8 = '', atDrop = '';
  const over = [];
  for (let row = 0; row < L_ROWS; row++) for (let h = 0; h < HUE_COLS; h++) {
    const c = safeHueExact(h, row / 63);
    const s8 = share(c), sd = share(drop(c));
    if (s8 > worst8) { worst8 = s8; at8 = `row=${row} h=${h}`; }
    if (sd > worstDrop) { worstDrop = sd; atDrop = `row=${row} h=${h}`; }
    if (s8 > 0.75) over.push(`8-bit row=${row} h=${h} share=${s8.toFixed(4)}`);
    if (sd > 0.75) over.push(`dropped row=${row} h=${h} share=${sd.toFixed(4)}`);
    assert.equal(safeHue(h, row / 63), c);
  }
  console.log(`# worst red share: 8-bit ${worst8.toFixed(4)} at ${at8}; after 2-bit drop ${worstDrop.toFixed(4)} at ${atDrop}`);
  assert.deepEqual(over.slice(0, 10), [], `${over.length} entries exceed 0.75 (first 10 shown)`);
});

test('safeHue: every entry is in gamut before rounding (no channel is clamped), and sits on the 6-bit grid', () => {
  for (let row = 0; row < L_ROWS; row++) for (let h = 0; h < HUE_COLS; h++) {
    const { r, g, b, chroma, codes } = safeHueLinear(h, row / 63);
    for (const v of [r, g, b]) assert.ok(v >= 0 && v <= 1, `row=${row} h=${h} chroma=${chroma} channel ${v}`);
    const c = safeHueExact(h, row / 63);
    assert.equal(c, ((codes[0] << 16) | (codes[1] << 8) | codes[2]) >>> 0);
    assert.equal(c & 0xFCFCFC, c, 'the renderer drops the 2 low bits; the table already has them clear');
    // the grid codes are the unrounded channels to within one grid step (4 codes) in sRGB
    const enc = (v) => Math.min(252, 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
    [r, g, b].forEach((v, i) => assert.ok(Math.abs(codes[i] - enc(v)) <= 4, `row=${row} h=${h} channel ${i}: ${codes[i]} vs ${enc(v).toFixed(1)}`));
    assert.ok(chroma === 0 || chroma === 0.2 / Math.pow(2, Math.round(Math.log2(0.2 / chroma))), 'chroma is 0.2 halved k times');
  }
});

test('safeHue: the lazy table equals the exact computation at all 64 x 360 entries', () => {
  let n = 0;
  for (let row = 0; row < L_ROWS; row++) for (let h = 0; h < HUE_COLS; h++) {
    assert.equal(safeHue(h, row / 63), safeHueExact(h, row / 63), `row=${row} h=${h}`);
    n++;
  }
  assert.equal(n, 64 * 360);
});

test('safeHue: hue wraps and rounds to whole degrees; L clamps to 0.05..0.92 and rounds to 64 rows', () => {
  assert.equal(safeHue(-1, 0.5), safeHue(359, 0.5));
  assert.equal(safeHue(360, 0.5), safeHue(0, 0.5));
  assert.equal(safeHue(720.2, 0.5), safeHue(0, 0.5));
  assert.equal(safeHue(-361, 0.5), safeHue(359, 0.5));
  assert.equal(safeHue(359.6, 0.5), safeHue(0, 0.5));
  assert.equal(safeHue(0.4, 0.5), safeHue(0, 0.5));
  assert.equal(safeHue(0.6, 0.5), safeHue(1, 0.5));
  assert.equal(safeHueExact(-1, 0.5), safeHueExact(359, 0.5));
  assert.equal(safeHueExact(0.6, 0.5), safeHueExact(1, 0.5));
  // rounding to whole degrees, over many hues (neighbouring degrees often share a grid colour, so one pair proves little)
  let distinct = 0;
  for (let h = 0; h < 360; h++) for (const L of [0.3, 0.5, 0.7]) {
    assert.equal(safeHue(h + 0.4, L), safeHue(h, L), `table ${h}+0.4`);
    assert.equal(safeHue(h + 0.6, L), safeHue((h + 1) % 360, L), `table ${h}+0.6`);
    assert.equal(safeHueExact(h + 0.4, L), safeHueExact(h, L), `exact ${h}+0.4`);
    assert.equal(safeHueExact(h + 0.6, L), safeHueExact((h + 1) % 360, L), `exact ${h}+0.6`);
    if (safeHue(h, L) !== safeHue((h + 1) % 360, L)) distinct++;
  }
  assert.ok(distinct > 200, `control: adjacent degrees differ at ${distinct} of 1080 places`);
  for (const h of [0, 90, 200, 300]) {
    assert.equal(safeHue(h, 0), safeHue(h, 0.05));
    assert.equal(safeHue(h, -3), safeHue(h, 0.05));
    assert.equal(safeHue(h, 1), safeHue(h, 0.92));
    assert.equal(safeHue(h, 7), safeHue(h, 0.92));
    assert.equal(safeHueExact(h, 1), safeHueExact(h, 0.92));
    assert.equal(safeHueExact(h, 0), safeHueExact(h, 0.05));
  }
  // 64 rows: L within half a row of row k/63 gives row k
  assert.equal(safeHue(10, 0.5), safeHue(10, Math.round(0.5 * 63) / 63));
  assert.equal(safeHue(10, 0.5 + 0.004), safeHue(10, 0.5));
  assert.equal(safeHue(10, 0.5 + 1 / 63), safeHue(10, Math.round(0.5 * 63 + 1) / 63));
  assert.notEqual(safeHue(10, 0.5), safeHue(10, 0.5 + 1 / 63));
  // junk in
  assert.equal(safeHue(NaN, NaN), safeHue(0, 0.05));
  assert.equal(safeHue(Infinity, 0.5), safeHue(0, 0.5));
});

// Cost of a call, judged against the table-free computation measured in the same moment (so machine load cancels out), not against a wall-time budget (DRIFT-8 r6).
// A table lookup is about 20 times cheaper than safeHueExact; the bound is 4 times cheaper (ratio < 0.25). A safeHue that rebuilt a row every call, or allocated per call,
// is hundreds of times slower than a lookup, and fails by a wide margin (the mutation test below).
function costRatio(mod) {
  const { safeHue: hue, safeHueExact: exact, L_ROWS: rows } = mod;
  for (let row = 0; row < rows; row++) hue(0, row / 63); // warm all rows
  const per = (fn, n) => {
    let acc = 0;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) acc ^= fn(i * 0.37, 0.05 + ((i * 7) % 900) / 1000);
    return { us: Number(process.hrtime.bigint() - t0) / 1e3 / n, acc };
  };
  const ratios = [];
  for (let k = 0; k < 3; k++) { // alternate the two so a load spike hits both
    const e = per(exact, 4000), h = per(hue, 200000);
    ratios.push(h.us / e.us);
  }
  return { ratios, best: Math.min(...ratios) };
}

test('safeHue: a call costs under a quarter of the table-free computation, measured in the same moment', () => {
  const { ratios, best } = costRatio({ safeHue, safeHueExact, L_ROWS });
  console.log(`safeHue cost / safeHueExact cost: ${ratios.map((x) => x.toFixed(4)).join(' / ')} (best of 3 ${best.toFixed(4)}; bound 0.25)`);
  assert.ok(best < 0.25, `best of 3 ratio = ${best.toFixed(4)}`);
});

test('safeHue: the cost test fails for a safeHue that rebuilds its row on every call (control; the same output, hundreds of times the cost)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-pixels-mutant-'));
  try {
    fs.cpSync(path.join(HERE, '..', 'src'), path.join(dir, 'src'), { recursive: true });
    fs.copyFileSync(path.join(HERE, '..', 'package.json'), path.join(dir, 'package.json'));
    const f = path.join(dir, 'src', 'pixels.js');
    const raw = fs.readFileSync(f, 'utf8');
    const find = 'if (BUILT[row] === 0) buildRow(row);';
    assert.equal(raw.split(find).length, 2, 'the lookup guard is where this test expects it');
    fs.writeFileSync(f, raw.replace(find, () => 'buildRow(row);'));
    const mod = await import(pathToFileURL(f).href);
    assert.equal(mod.safeHue(10, 0.5), safeHue(10, 0.5), 'the mutant returns the same colours');
    const { ratios, best } = costRatio(mod);
    console.log(`safeHue MUTANT (row rebuilt every call) cost ratio: ${ratios.map((x) => x.toFixed(2)).join(' / ')} (best of 3 ${best.toFixed(2)})`);
    assert.ok(best > 0.25, `the mutant is caught: best ratio ${best.toFixed(2)} would fail the bound 0.25`);
    assert.ok(best > 5, `and by a wide margin: ${best.toFixed(2)} (the real tree is about 0.05)`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('safeHue: deterministic - two fresh module instances build identical tables', async () => {
  const a = await import('../src/pixels.js?fresh=a');
  const b = await import('../src/pixels.js?fresh=b');
  assert.notEqual(a.safeHue, b.safeHue);
  for (let row = 0; row < 64; row++) for (let h = 0; h < 360; h++) {
    assert.equal(a.safeHue(h, row / 63), b.safeHue(h, row / 63), `row=${row} h=${h}`);
  }
});

// ---- staggerTime ----------------------------------------------------------------------------------

test('staggerTime: pure, monotone per row, parities one tick apart, every row updated within 2 ticks', () => {
  const fps = 18;
  for (let y = 0; y < 6; y++) {
    let prev = -Infinity;
    for (let i = 0; i < 400; i++) {
      const t = i / 97; // a time step finer and unrelated to the tick rate
      const a = staggerTime(t, y, fps);
      assert.equal(a, staggerTime(t, y, fps)); // pure
      assert.ok(a >= prev, `row ${y} t=${t}`);
      assert.ok(a <= t + 1e-12, 'never in the future');
      assert.ok(t - a < 2 / fps + 1e-9, 'refreshed within two ticks');
      prev = a;
    }
  }
  for (let n = 0; n < 40; n++) {
    const t = (n + 0.5) / fps;
    const e = staggerTime(t, 0, fps), o = staggerTime(t, 1, fps);
    assert.ok(Math.abs(Math.abs(e - o) - 1 / fps) < 1e-9, `tick ${n}: parities differ by exactly one tick`);
    assert.equal(staggerTime(t, 2, fps), e); assert.equal(staggerTime(t, 3, fps), o);
    // even rows move on even ticks, odd rows on odd ticks
    if (n % 2 === 0) assert.ok(Math.abs(e - n / fps) < 1e-9); else assert.ok(Math.abs(o - n / fps) < 1e-9);
  }
  // half the rows change on each tick
  for (let n = 1; n < 20; n++) {
    let changed = 0;
    for (let y = 0; y < 10; y++) if (staggerTime((n + 0.5) / fps, y, fps) !== staggerTime((n - 0.5) / fps, y, fps)) changed++;
    assert.equal(changed, 5);
  }
  assert.equal(staggerTime(0, 0), 0);
  assert.equal(staggerTime(NaN, 3), staggerTime(0, 3));
  assert.ok(Number.isFinite(staggerTime(5, -3)));
});
