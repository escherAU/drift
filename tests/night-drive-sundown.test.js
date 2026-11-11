// DRIFT-5 slice 2: scene A3, Sundown Grid (the sun going down over a neon grid). The storyboard's promises, read off rendered frames:
//   - the sun: a semicircle 52 wide by 13 rows centred on column 60 on the horizon at row 20 (120x40), half-width 2*sqrt(169-(19-y)^2),
//     coloured by row sun.3 -> tang.3 -> coral.3 -> mag.3, cut by gaps that widen toward the bottom and slide half a row a second
//   - the horizon (mag.3), a grid below it (cyan.1 horizontals that arrive every 0.8 s, nine cyan.0 verticals meeting at the horizon),
//     wireframe mountains (violet.2), palms (violet.1, full layout only)
//   - the sun sinks one row every 15 s for 60 s and rises back for 60 s, so the whole scene loops every 120 s
//   - calm: far under 30% of the cells change in a frame (Sam's budget is about 10% worst), nothing pulses, one background
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sundown, { LAYOUTS, layoutFor, lineRows } from '../cartridges/night-drive/scenes/sundown.js';
import { renderScene } from '../src/cells.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { SUN, TANG, CORAL, MAG, VIOLET, CYAN, ICE, COUNT, FAMILIES } from '../cartridges/night-drive/lib/palette.js';
import { changedFraction, FLASH_FRACTION } from './helpers-flash.js';

const BANNED = [0x25cd, 0x25ce, 0x25d1, 0x25e2, 0x25e3, 0x222b, 0x2261, 0x25d0, 0x25d3, 0x25d2]; // ◍ ◎ ◑ ◢ ◣ ∫ ≡ and ◐ ◓ ◒
const cp = (ch) => ch.codePointAt(0);
const width = (s) => [...s].length;
const FPS = 18;
const frame = (t, w = 120, h = 40, seed = 1, t0) => {
  const g = new Uint16Array(w * h), c = new Uint8Array(w * h);
  sundown(t, w, h, { seed, glyphs: g, colours: c, ...(t0 !== undefined ? { t0 } : {}) });
  return { g, c, w, h };
};
const rowText = (f, y) => String.fromCharCode(...f.g.slice(y * f.w, (y + 1) * f.w));
const cellsOf = (f, ch, col) => {
  const out = [];
  for (let i = 0; i < f.g.length; i++) if (f.g[i] === cp(ch) && (col === undefined || (Array.isArray(col) ? col.includes(f.c[i]) : f.c[i] === col))) out.push([i % f.w, Math.floor(i / f.w)]);
  return out;
};
// the sizes every promise is tested at: the three shipped sizes, plus just above, at and just below every breakpoint
const SIZES = [[120, 40], [80, 24], [240, 67]];
for (const l of LAYOUTS) {
  if (l.minCols > 0 && l.minRows > 0) SIZES.push([l.minCols, l.minRows], [l.minCols + 1, l.minRows + 1], [l.minCols - 1, l.minRows], [l.minCols, l.minRows - 1]);
}
const TIMES = [0, 0.7, 3.1, 12.5, 15, 33.3, 45, 60, 77.7, 119.9];
const SHIPPED = [[120, 40], [80, 24], [240, 67]];

// ---- independent readings of a picture (nothing here calls the scene's own helpers except lineRows, which is checked against the picture)
const hzOf = (h) => Math.floor(h / 2);
const SUNCOLS = [SUN[3], TANG[3], CORAL[3], MAG[3]];
const HALFS = [cp('▀'), cp('▄'), cp('█')];
const isSun = (f, i) => f.c[i] !== 0 && HALFS.includes(f.g[i]) && SUNCOLS.includes(f.c[i]) && Math.floor(i / f.w) < hzOf(f.h);
const sunRowsIn = (f) => {
  const rows = new Map(); // y -> [min x, max x, count]
  for (let i = 0; i < f.g.length; i++) {
    if (!isSun(f, i)) continue;
    const y = Math.floor(i / f.w), x = i % f.w;
    const r = rows.get(y) || [Infinity, -Infinity, 0];
    rows.set(y, [Math.min(r[0], x), Math.max(r[1], x), r[2] + 1]);
  }
  return rows;
};
const sunTop = (f) => { const ys = [...sunRowsIn(f).keys()]; return ys.length ? Math.min(...ys) : -1; };
const sunMask = (f) => { const out = []; for (let i = 0; i < f.g.length; i++) if (isSun(f, i)) out.push(i + ':' + f.g[i] + ':' + f.c[i]); return out.join(','); };
// the half-rows (upper, lower of each cell row) that are lit in the middle column: 1 = sun, 0 = gap or sky
const halfRows = (f) => {
  const x = Math.floor(f.w / 2), out = [];
  for (let y = 0; y < hzOf(f.h); y++) {
    const i = y * f.w + x, lit = isSun(f, i);
    out.push(lit && (f.g[i] === cp('▀') || f.g[i] === cp('█')) ? 1 : 0, lit && (f.g[i] === cp('▄') || f.g[i] === cp('█')) ? 1 : 0);
  }
  return out;
};
// gaps bounded by sun above and below (and, with `open`, one that runs down to the horizon): [{ start, len }] in half-rows from the top
const gapsOf = (bits, open = false) => {
  const out = [];
  const first = bits.indexOf(1);
  if (first < 0) return out;
  for (let i = first + 1; i < bits.length; i++) {
    if (bits[i] === 0 && bits[i - 1] === 1) {
      let j = i;
      while (j < bits.length && bits[j] === 0) j++;
      if (j < bits.length || open) out.push({ start: i, len: j - i });
      i = j;
    }
  }
  return out;
};
const horizRowsOf = (f) => {
  const hz = hzOf(f.h), out = [];
  for (let y = hz + 1; y < f.h; y++) {
    let n = 0;
    for (let x = 0; x < f.w; x++) if (f.g[y * f.w + x] === cp('─') && f.c[y * f.w + x] === CYAN[1]) n++;
    if (n >= 0.9 * f.w) out.push(y);
  }
  return out;
};
const tickOf = (T) => Math.floor(T * 15 + 1e-6);

// ---- S1

test('sundown (S1): a cells scene called sundown whose LAYOUTS are listed widest first; the manifest lists it after onramp with its menu entry', () => {
  assert.equal(sundown.kind, 'cells');
  assert.equal(sundown.id, 'sundown');
  assert.ok(Array.isArray(LAYOUTS) && LAYOUTS.length >= 2);
  for (const l of LAYOUTS) assert.ok(Number.isInteger(l.minCols) && Number.isInteger(l.minRows), JSON.stringify(l));
  for (let i = 1; i < LAYOUTS.length; i++) assert.ok(LAYOUTS[i].minCols <= LAYOUTS[i - 1].minCols, 'sorted widest first');
  assert.deepEqual([LAYOUTS[LAYOUTS.length - 1].minCols, LAYOUTS[LAYOUTS.length - 1].minRows], [0, 0], 'the last layout takes every window');
  const [big] = LAYOUTS;
  assert.equal(layoutFor(120, 40).name, big.name);
  assert.equal(layoutFor(240, 67).name, big.name);
  assert.notEqual(layoutFor(80, 24).name, big.name);
  assert.equal(layoutFor(big.minCols, big.minRows).name, big.name, 'at the breakpoint: the big layout');
  assert.notEqual(layoutFor(big.minCols - 1, big.minRows).name, big.name, 'one column short: not');
  assert.notEqual(layoutFor(big.minCols, big.minRows - 1).name, big.name, 'one row short: not');
  // the first layout the window fits
  for (const [w, h] of SIZES) assert.equal(layoutFor(w, h), LAYOUTS.find((l) => w >= l.minCols && h >= l.minRows), `${w}x${h}`);
  const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../cartridges/night-drive/manifest.json', import.meta.url)), 'utf8'));
  const ids = manifest.scenes.map((s) => s.id);
  assert.ok(ids.includes('sundown'));
  assert.ok(ids.indexOf('sundown') > ids.indexOf('onramp'), 'after onramp');
  const entry = manifest.scenes.find((s) => s.id === 'sundown');
  assert.equal(entry.kind, 'cells');
  assert.ok(width(entry.title) <= 23, `title '${entry.title}'`);
  assert.equal(entry.title, 'Sundown Grid');
  const tape = manifest.programs.find((p) => p.id === 'tape');
  assert.ok(tape.scenes.includes('sundown'));
  assert.deepEqual(tape.scenes, ids, 'tape order is manifest scene order');
  const menu = manifest.menu.find((m) => m.scene === 'sundown');
  assert.equal(menu.label, 'A3  SUNDOWN GRID');
  assert.equal(menu.program, 'tape');
  assert.equal(menu.note, '1:30');
  assert.ok(menu.desc && width(menu.desc) <= 76, `desc is ${width(menu.desc || '')} wide`);
  assert.equal(manifest.menu[manifest.menu.length - 1].action, 'eject', 'Eject stays last');
  assert.ok(manifest.menu.indexOf(menu) < manifest.menu.length - 1, 'and the entry is before it');
});

// ---- S2

test('sundown (S2): the same (t, w, h, seed) draws the same frame; t0 shifts the scene\'s own clock; odd times and sizes do not throw; every cell is written', () => {
  for (const [w, h] of SIZES) {
    for (const t of [0, 5.3, 49.5, 101.1]) {
      const a = frame(t, w, h, 1), b = frame(t, w, h, 1);
      assert.deepEqual(a.g, b.g);
      assert.deepEqual(a.c, b.c);
    }
  }
  const early = frame(0), later = frame(100, 120, 40, 1, 100);
  assert.deepEqual(later.g, early.g, 't = 100 with t0 = 100 is t = 0');
  assert.deepEqual(later.c, early.c);
  const mid = frame(49.5), shifted = frame(149.5, 120, 40, 1, 100);
  assert.deepEqual(shifted.g, mid.g);
  assert.notDeepEqual(frame(17.3, 120, 40, 1, 0).g, frame(17.3, 120, 40, 1, 3).g, 'a different t0 is a different moment');
  for (const t of [0, -5, -0.001, NaN, Infinity, -Infinity, 1e6, 1e9]) assert.doesNotThrow(() => frame(t), String(t));
  assert.deepEqual(frame(-5).g, frame(0).g, 'a negative time is the start');
  assert.deepEqual(frame(NaN).g, frame(0).g);
  assert.notDeepEqual(frame(10, 120, 40, 1).g, frame(10, 120, 40, 2).g, 'the seed matters (the stars)');
  for (const [w, h] of [[0, 0], [1, 1], [3, 3], [12, 8], [2, 200], [200, 2], [120, 4], [5, 40]]) {
    assert.doesNotThrow(() => frame(30, w, h), `${w}x${h}`);
    assert.doesNotThrow(() => lineRows(30, w, h), `lineRows ${w}x${h}`);
  }
  // the scene writes every cell: a buffer pre-filled with junk comes back without any of it
  for (const [w, h] of [...SHIPPED, [100, 32], [2, 200], [1, 1]]) {
    const g = new Uint16Array(w * h).fill(0xffff), c = new Uint8Array(w * h).fill(0xff);
    sundown(12.3, w, h, { seed: 1, glyphs: g, colours: c });
    assert.ok(!g.includes(0xffff) && !c.includes(0xff), `${w}x${h}: every cell is written`);
  }
  const shared = renderScene(sundown, 12.5, 120, 40, 1);
  assert.deepEqual(Array.from(shared.glyphs), Array.from(frame(12.5).g), 'the shared renderer gives the same picture as a direct call');
});

// ---- S3

test('sundown (S3): at the shipped sizes and at, just above and one short of every breakpoint: allowed glyphs only, none banned, colours inside the palette, blanks are colour 0; mountain bodies use only the safe blocks', () => {
  assert.ok(SIZES.length >= 7);
  const mountain = new Set();
  for (const [w, h] of SIZES) {
    for (const t of TIMES) {
      const f = frame(t, w, h);
      for (let i = 0; i < f.g.length; i++) {
        assert.ok(isAllowedGlyph(f.g[i]), `${w}x${h} t=${t} U+${f.g[i].toString(16)}`);
        assert.ok(!BANNED.includes(f.g[i]), `banned U+${f.g[i].toString(16)}`);
        if (f.g[i] === 32) assert.equal(f.c[i], 0, 'a blank cell is the background');
        else assert.ok(f.c[i] >= 16 && f.c[i] < COUNT, `${w}x${h} t=${t}: colour ${f.c[i]}`);
        if (f.c[i] === VIOLET[2]) mountain.add(String.fromCharCode(f.g[i]));
      }
    }
  }
  assert.deepEqual([...mountain].filter((ch) => !'▟▙▗▖▄█╱╲'.includes(ch)), [], 'mountains: safe blocks and the two wireframe edges only');
  for (const ch of '▟▙▗▖╱╲') assert.ok(mountain.has(ch), `the mountains use ${ch}`);
  assert.equal(COUNT, 52);
});

// ---- S4

test('sundown (S4): at 120x40 t=0 the sun is a 52x13 semicircle on the horizon at row 20, coloured sun/tang/coral/mag by row and cut by gaps; the horizon, nine verticals, wireframe mountains and palms are where the storyboard puts them', () => {
  const f = frame(0, 120, 40);
  const hz = 20;
  assert.equal(hzOf(40), hz);
  // the horizon
  for (let x = 0; x < 120; x++) { assert.equal(f.g[hz * 120 + x], cp('━'), `horizon at ${x}`); assert.equal(f.c[hz * 120 + x], MAG[3]); }
  // the sun: rows 7..19, half-width 2*sqrt(169-(19-y)^2), centred on column 60
  const rows = sunRowsIn(f);
  assert.ok(rows.size >= 8 && rows.size <= 13, `${rows.size} sun rows are lit (the rest are gaps)`);
  assert.equal(Math.min(...rows.keys()), 7, 'the top row is row 7');
  assert.equal(Math.max(...rows.keys()), 19, 'the bottom row is row 19, on the horizon');
  let widest = 0;
  for (const [y, [lo, hi, n]] of rows) {
    const hw = Math.round(2 * Math.sqrt(169 - (19 - y) ** 2));
    assert.equal(lo, 60 - hw, `row ${y} left edge`);
    assert.equal(hi, 60 + hw - 1, `row ${y} right edge`);
    assert.equal(n, 2 * hw, `row ${y}: no holes inside the row`);
    widest = Math.max(widest, hi - lo + 1);
  }
  assert.equal(widest, 52, '52 wide');
  assert.equal(rows.get(19)[0], 34);
  // colour by row: sun.3, tang.3, coral.3, mag.3, in that order and never going back
  const bandOf = (col) => SUNCOLS.indexOf(col);
  let last = 0;
  const seen = new Set();
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const cols = new Set();
    for (let x = 0; x < 120; x++) if (isSun(f, y * 120 + x)) cols.add(f.c[y * 120 + x]);
    assert.equal(cols.size, 1, `row ${y}: one colour`);
    const b = bandOf([...cols][0]);
    assert.ok(b >= last, `row ${y}: ${b} after ${last}: the colour never goes back up`);
    last = b;
    seen.add(b);
  }
  assert.deepEqual([...seen], [0, 1, 2, 3], 'sun.3, then tang.3, coral.3, mag.3');
  assert.equal(f.c[7 * 120 + 60], SUN[3]);
  assert.equal(f.c[19 * 120 + 60], MAG[3]);
  // cut by gaps
  const bits = halfRows(f);
  const gaps = gapsOf(bits);
  assert.ok(gaps.length >= 2, `${gaps.length} closed gaps`);
  assert.ok(bits.slice(24).includes(0) && bits.slice(24).filter((b) => b === 0).length >= 5, 'the gaps are in the lower part');
  assert.ok(bits.slice(14, 24).every((b) => b === 1), 'the top of the sun is whole (rows 7 to 11)');
  // the grid: nine verticals in cyan.0 meeting at (60, 20), horizontals in cyan.1
  const hrows = horizRowsOf(f);
  assert.deepEqual(hrows, lineRows(0, 120, 40), 'the horizontals are where lineRows says');
  assert.equal(hrows[0], 21, 'a horizontal at row 21');
  const want = new Set();
  for (let y = 21; y < 40; y++) {
    if (hrows.includes(y)) continue;
    for (let k = -4; k <= 4; k++) {
      const x = Math.round(60 + (15 * k * (y - 20)) / 19);
      if (x < 0 || x > 119) continue;
      want.add(y * 120 + x);
      assert.equal(f.c[y * 120 + x], CYAN[0], `vertical ${k} at row ${y}: (${x},${y})`);
      assert.equal(f.g[y * 120 + x], k === 0 ? cp('│') : k < 0 ? cp('╱') : cp('╲'));
    }
  }
  const cyan0 = [];
  for (let i = 0; i < f.g.length; i++) if (f.c[i] === CYAN[0]) cyan0.push(i);
  assert.deepEqual(new Set(cyan0), want, 'and no other cyan.0 cell');
  assert.equal(new Set(cyan0.filter((i) => Math.floor(i / 120) === 39).map((i) => i % 120)).size, 8, 'eight of the nine reach the bottom row on screen (the ninth is at column 120)');
  assert.ok(cyan0.some((i) => Math.floor(i / 120) === 22 && Math.abs((i % 120) - 60) <= 4), 'all of them are bunched at the horizon');
  for (const y of hrows) for (let x = 0; x < 120; x++) { assert.equal(f.g[y * 120 + x], cp('─')); assert.equal(f.c[y * 120 + x], CYAN[1]); }
  for (let y = 0; y < 40; y++) if (y !== hz && !hrows.includes(y)) assert.ok(rowText(f, y).split('').filter((ch) => ch === '─').length < 30, `row ${y} is not a horizontal`);
  // wireframe mountains in violet.2, on both sides of the sun, standing on the horizon, clear of the sun
  const mt = [];
  for (let i = 0; i < f.g.length; i++) if (f.c[i] === VIOLET[2]) mt.push([i % 120, Math.floor(i / 120)]);
  const edge = (side) => mt.filter(([x, y]) => (side < 0 ? x < 60 : x >= 60) && (f.g[y * 120 + x] === cp('╱') || f.g[y * 120 + x] === cp('╲')));
  assert.ok(edge(-1).length >= 8 && edge(1).length >= 8, `wireframe edges: ${edge(-1).length} left, ${edge(1).length} right`);
  assert.ok(mt.every(([x, y]) => y < hz && y >= hz - 9), 'between the sky and the horizon');
  assert.ok(mt.every(([x]) => x < 34 || x > 85), 'clear of the sun');
  assert.ok(mt.some(([, y]) => y === hz - 1), 'standing on the horizon');
  // palms in violet.1: one at each edge, a crown and a trunk, nothing in the middle
  const pm = [];
  for (let i = 0; i < f.g.length; i++) if (f.c[i] === VIOLET[1]) pm.push([i % 120, Math.floor(i / 120)]);
  const left = pm.filter(([x]) => x < 60), right = pm.filter(([x]) => x >= 60);
  assert.ok(left.length >= 20 && right.length >= 20, `palms: ${left.length} and ${right.length} cells`);
  assert.ok(left.every(([x]) => x <= 20) && right.every(([x]) => x >= 99), 'at the two edges');
  assert.ok(pm.every(([, y]) => y < hz), 'above the horizon');
  assert.ok(pm.some(([, y]) => y === hz - 1), 'the trunks stand on the horizon');
  assert.ok(Math.max(...left.map(([, y]) => y)) - Math.min(...left.map(([, y]) => y)) >= 10, 'a tall palm');
  // the stars: static dots in ice, in the sky above everything
  const stars = [...cellsOf(f, '·'), ...cellsOf(f, '°')];
  assert.ok(stars.length >= 6, `${stars.length} stars`);
  assert.ok(stars.every(([, y]) => y < 6), 'in the top rows');
  for (const [x, y] of stars) assert.ok([ICE[0], ICE[1]].includes(f.c[y * 120 + x]));
});

// ---- S5

const sinkExpected = (T) => { const c = Math.floor((T % 120) / 15); return c <= 4 ? c : 8 - c; };

test('sundown (S5): the sun sinks a row every 15 s for 60 s and rises back the same way, and is where it started at 120 s (both arms pinned); it never pulses', () => {
  for (const [w, h] of [[120, 40], [240, 67], [101, 33]]) {
    const r0 = sunTop(frame(0, w, h));
    assert.equal(r0, hzOf(h) - 13, `${w}x${h}: r0`);
    const tops = [];
    for (let T = 0; T <= 120; T += 0.5) tops.push([T, sunTop(frame(T, w, h))]);
    for (const [T, top] of tops) assert.equal(top, r0 + sinkExpected(T), `${w}x${h} t=${T}`);
    // the named instants
    const at = (T) => sunTop(frame(T, w, h));
    assert.equal(at(14.9), r0);
    assert.equal(at(15), r0 + 1);
    assert.equal(at(29.9), r0 + 1);
    assert.equal(at(30), r0 + 2);
    assert.equal(at(45), r0 + 3);
    assert.equal(at(60), r0 + 4);
    assert.equal(at(74.9), r0 + 4);
    assert.equal(at(75), r0 + 3, 'rising');
    assert.equal(at(90), r0 + 2);
    assert.equal(at(105), r0 + 1);
    assert.equal(at(119.9), r0 + 1);
    assert.equal(at(120), r0);
    // arm one: monotone down on 0 to 60 s with a one-row step every 15 s; arm two: monotone up on 60 to 120 s
    const down = tops.filter(([T]) => T <= 60).map(([, v]) => v), up = tops.filter(([T]) => T >= 60).map(([, v]) => v);
    for (let i = 1; i < down.length; i++) assert.ok(down[i] >= down[i - 1] && down[i] - down[i - 1] <= 1, `${w}x${h} sinking, sample ${i}`);
    for (let i = 1; i < up.length; i++) assert.ok(up[i] <= up[i - 1] && up[i - 1] - up[i] <= 1, `${w}x${h} rising, sample ${i}`);
    assert.equal(new Set(down).size, 5, 'five positions on the way down');
    assert.equal(down.filter((v, i) => i > 0 && v !== down[i - 1]).length, 4, 'four one-row steps down');
    assert.equal(up.filter((v, i) => i > 0 && v !== up[i - 1]).length, 4, 'four one-row steps up');
  }
  // the sun is cut by the horizon as it sinks: its widest row narrows
  const widest = (T) => Math.max(...[...sunRowsIn(frame(T)).values()].map(([lo, hi]) => hi - lo + 1));
  assert.equal(widest(0), 52);
  assert.ok(widest(60) < 52 && widest(60) >= 48, `at 60 s the widest row is ${widest(60)}`);
  // compact: the sun is lower (8 rows) and sinks the same way
  const c0 = sunTop(frame(0, 80, 24));
  for (const T of [0, 14.9, 15, 44.9, 45, 60, 80, 119.9, 120]) assert.equal(sunTop(frame(T, 80, 24)), c0 + sinkExpected(T), `80x24 t=${T}`);
});

test('sundown (S5): the sun never pulses: its picture changes only at the gap slides and at the 15 s row steps, never in between (120 s at 120x40)', () => {
  let prev = sunMask(frame(0));
  const changes = [];
  for (let k = 1; k <= 120 * FPS; k++) {
    const t = k / FPS;
    const cur = sunMask(frame(t));
    if (cur !== prev) changes.push(t);
    prev = cur;
  }
  assert.ok(changes.length >= 100 && changes.length <= 128, `${changes.length} changes in 120 s: one a second, the 15 s steps among them`);
  for (let i = 1; i < changes.length; i++) assert.ok(changes[i] - changes[i - 1] >= 0.1, `change at ${changes[i]} follows one at ${changes[i - 1]}: nothing flickers`);
  for (const t of changes) {
    const slide = (t % 1) >= 0.05 && (t % 1) <= 0.15;
    const step = t % 15 <= 1 / FPS + 1e-9 || 15 - (t % 15) < 1e-9;
    assert.ok(slide || step, `the sun changed at ${t.toFixed(3)} s, which is neither a slide nor a row step`);
  }
  // between slides the sun is exactly still
  assert.equal(sunMask(frame(2.3)), sunMask(frame(2.9)));
  assert.equal(sunMask(frame(20.2)), sunMask(frame(20.9)));
  // control: a sun whose colour pulsed would be seen by the same mask
  const a = frame(2.3);
  const b = { ...a, c: a.c.map((v) => (v === SUN[3] ? SUN[2] : v)) };
  assert.notEqual(sunMask(a), sunMask(b));
});

// ---- S6

test('sundown (S6): a new horizontal appears at row 21 every 0.8 s; the picture of horizontals is a pure function of t with period 0.8 s; each only moves toward the viewer and they accelerate', () => {
  for (const [w, h] of SIZES) {
    const hz = hzOf(h);
    for (const T of [0, 0.13, 0.4, 0.79, 1.17, 5.55, 12.9, 33.3, 61.07, 119.99]) {
      const f = frame(T, w, h);
      assert.deepEqual(horizRowsOf(f), lineRows(T, w, h), `${w}x${h} t=${T}: lineRows is the picture`);
      assert.deepEqual(lineRows(T + 0.8, w, h), lineRows(T, w, h), `${w}x${h}: t=${T} and t=${T + 0.8} show the same horizontals`);
      assert.deepEqual(horizRowsOf(frame(T + 0.8, w, h)), horizRowsOf(f));
      assert.deepEqual(horizRowsOf(frame(T + 80, w, h)), horizRowsOf(f), 'and 80 s later');
    }
    // the same number in flight all the time, in distinct rows, all below the horizon
    const counts = new Set();
    for (let k = 0; k <= 20 * FPS; k++) {
      const r = lineRows(k / FPS, w, h);
      counts.add(r.length);
      assert.ok(r[0] >= hz + 1 && r[r.length - 1] <= h - 1, `${w}x${h}: rows ${r}`);
      for (let i = 1; i < r.length; i++) assert.ok(r[i] > r[i - 1], `${w}x${h} t=${k / FPS}: distinct rows ${r}`);
    }
    assert.equal(counts.size, 1, `${w}x${h}: always ${[...counts]} horizontals`);
  }
  // follow them for 20 s at 18 fps at the shipped sizes
  for (const [w, h] of SHIPPED) {
    const hz = hzOf(h);
    let prev = lineRows(0, w, h), prevPic = horizRowsOf(frame(0, w, h));
    const appeared = [];
    let worst = 0, worstPic = 0;
    for (let k = 1; k <= 20 * FPS; k++) {
      const T = k / FPS;
      const cur = lineRows(T, w, h), pic = horizRowsOf(frame(T, w, h));
      const sameSlot = Math.floor(tickOf(T) / 12) === Math.floor(tickOf((k - 1) / FPS) / 12);
      let moved = 0;
      if (sameSlot) {
        for (let j = 0; j < cur.length; j++) { assert.ok(cur[j] >= prev[j], `${w}x${h} t=${T}: line ${j} went up the screen`); if (cur[j] !== prev[j]) moved++; }
      } else {
        for (let j = 0; j + 1 < cur.length; j++) { assert.ok(cur[j + 1] >= prev[j], `${w}x${h} t=${T}: line ${j} went up the screen`); if (cur[j + 1] !== prev[j]) moved++; }
        assert.equal(cur[0], hz + 1, 'the new one is at row 21 (just under the horizon)');
        moved++; // the new one
        appeared.push(T);
      }
      assert.ok(moved <= 2, `${w}x${h} t=${T}: ${moved} horizontals moved`);
      worst = Math.max(worst, moved);
      const arrivals = pic.filter((y) => !prevPic.includes(y)).length;
      worstPic = Math.max(worstPic, arrivals);
      assert.ok(arrivals <= 2, `${w}x${h} t=${T}: ${arrivals} rows gained a horizontal`);
      prev = cur; prevPic = pic;
    }
    assert.equal(appeared.length, 25, `${w}x${h}: one new horizontal every 0.8 s (25 in 20 s)`);
    for (let i = 1; i < appeared.length; i++) assert.ok(Math.abs(appeared[i] - appeared[i - 1] - 0.8) <= 1 / FPS + 1e-9, `gap ${appeared[i] - appeared[i - 1]}`);
    assert.ok(worst >= 1, 'they do move');
  }
  // each one covers more ground per 0.8 s the nearer it is: the gaps between neighbouring rows only grow, and the last is bigger than the first
  for (const [w, h] of SHIPPED) {
    for (const T of [0.01, 0.8 * 7 + 0.01, 0.8 * 31 + 0.01]) {
      const r = lineRows(T, w, h);
      const d = r.slice(1).map((v, i) => v - r[i]);
      assert.ok(d.every((v, i) => i === 0 || v >= d[i - 1]), `${w}x${h}: spacings ${d}`);
      assert.ok(d[d.length - 1] > d[0], `${w}x${h}: the nearest gap ${d[d.length - 1]} is bigger than the farthest ${d[0]}`);
    }
  }
  // the sun's gaps slide half a row (one half-row) a second, and widen toward the bottom
  const g0 = frame(0.1), g1 = frame(1.1), g2 = frame(2.1), g3 = frame(3.1);
  const starts = [g0, g1, g2, g3].map((f) => gapsOf(halfRows(f), true).map((x) => x.start));
  for (let i = 0; i + 1 < starts.length; i++) {
    assert.ok(starts[i].length >= 2);
    for (const s of starts[i]) if (s + 1 <= 2 * 20 - 1) assert.ok(starts[i + 1].includes(s + 1), `a gap that started at half-row ${s} starts at ${s + 1} a second later`);
  }
  const lens = gapsOf(halfRows(g0)).map((x) => x.len);
  assert.ok(lens.every((v, i) => i === 0 || v >= lens[i - 1]) && lens[lens.length - 1] > lens[0], `gap sizes grow toward the bottom: ${lens}`);
  assert.ok(lens.every((v) => v >= 1 && v <= 4));
});

// ---- S7

test('sundown (S7 LOOP): the frame at T + 120 s equals the frame at T, at 120x40, 80x24 and 240x67, for seeds 1 and 7; and the frame at 30 s is not the frame at 0', () => {
  let checked = 0;
  for (const [w, h] of SHIPPED) {
    for (const seed of [1, 7]) {
      for (const T of [0, 0.4, 33.3, 61.1]) {
        const a = frame(T, w, h, seed), b = frame(T + 120, w, h, seed);
        assert.deepEqual(b.g, a.g, `${w}x${h} seed ${seed} t=${T}: glyphs`);
        assert.deepEqual(b.c, a.c, `${w}x${h} seed ${seed} t=${T}: colours`);
        checked++;
      }
      const z = frame(0, w, h, seed), half = frame(30, w, h, seed), sunk = frame(60, w, h, seed);
      assert.notDeepEqual(half.g, z.g, `${w}x${h} seed ${seed}: the frame at 30 s differs from the frame at 0 (control: the loop check can fail)`);
      assert.notDeepEqual(sunk.g, z.g, 'and so does the frame at 60 s');
      assert.notDeepEqual(frame(0.4 + 60, w, h, seed).g, frame(0.4, w, h, seed).g, 'half a loop is not a loop');
      assert.notDeepEqual(frame(33.3 + 119, w, h, seed).g, frame(33.3, w, h, seed).g, 'nor is 119 s');
    }
  }
  assert.equal(checked, 24);
  // every sway of the palms is inside the 120 s too
  assert.deepEqual(frame(10.6 + 120).g, frame(10.6).g);
  assert.deepEqual(frame(30.6 + 120).g, frame(30.6).g);
  assert.deepEqual(frame(119.99).g.length, 4800);
});

// ---- S8

test('sundown (S8): every 20 s one palm frond sways one cell and back (the left palm, then the right, alternately); nothing else sways; no palms at 80x24', () => {
  const base = frame(0.2);
  const palmCells = (f, side) => {
    const out = [];
    for (let i = 0; i < f.g.length; i++) if (f.c[i] === VIOLET[1] && ((i % 120 < 60) === (side === 0))) out.push([i % 120, Math.floor(i / 120)]);
    return out;
  };
  const box = (side) => {
    const cells = palmCells(base, side);
    return { x0: Math.min(...cells.map((c) => c[0])) - 2, x1: Math.max(...cells.map((c) => c[0])) + 2, y0: Math.min(...cells.map((c) => c[1])), y1: 19 };
  };
  const boxes = [box(0), box(1)];
  const diffIn = (f, b) => {
    const out = [];
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) { const i = y * 120 + x; if (f.g[i] !== base.g[i] || f.c[i] !== base.c[i]) out.push([x, y]); }
    return out;
  };
  for (let n = 0; n < 6; n++) {
    const side = n % 2;
    for (const off of [10.2, 11.0]) {
      const f = frame(20 * n + off);
      assert.equal(diffIn(f, boxes[side]).length, 2, `t=${20 * n + off}: one frond cell moves (one blank, one drawn)`);
      assert.equal(diffIn(f, boxes[1 - side]).length, 0, 'the other palm stays');
      const moved = diffIn(f, boxes[side]);
      assert.equal(moved[0][1], moved[1][1], 'on one row');
      assert.equal(Math.abs(moved[0][0] - moved[1][0]), 1, 'by one cell');
    }
    for (const off of [0.2, 5, 9.9, 12, 15, 19.9]) {
      const f = frame(20 * n + off);
      assert.equal(diffIn(f, boxes[0]).length + diffIn(f, boxes[1]).length, 0, `t=${20 * n + off}: still (it has swayed back)`);
    }
  }
  // 120 s at 18 fps: six sways, alternating
  let prevOn = -1, count = 0;
  const order = [];
  for (let k = 0; k <= 120 * FPS; k++) {
    const f = frame(k / FPS);
    const on = diffIn(f, boxes[0]).length ? 0 : diffIn(f, boxes[1]).length ? 1 : -1;
    if (on >= 0 && prevOn < 0) { count++; order.push(on); }
    prevOn = on;
  }
  assert.equal(count, 6, 'six sways in 120 s');
  assert.deepEqual(order, [0, 1, 0, 1, 0, 1]);
  // compact: no palms at all
  for (const T of [0, 10.2, 30.2, 50]) assert.equal(frame(T, 80, 24).c.filter((v) => v === VIOLET[1]).length, 0, `80x24 t=${T}`);
  assert.ok(frame(0, 100, 32).c.filter((v) => v === VIOLET[1]).length > 20, 'palms from the big layout up (100x32)');
  assert.equal(frame(0, 99, 32).c.filter((v) => v === VIOLET[1]).length, 0, 'none one column short');
  assert.equal(frame(0, 100, 31).c.filter((v) => v === VIOLET[1]).length, 0, 'none one row short');
});

// ---- S9

test('sundown (S9): at 80x24 the sun is 34x8, there are no palms and four horizontals', () => {
  const hz = hzOf(24);
  for (const T of [0, 0.7, 3.1, 12.5]) {
    const f = frame(T, 80, 24);
    const rows = sunRowsIn(f);
    const top = Math.min(...rows.keys());
    assert.equal(top, hz - 8, 'eight rows tall');
    assert.ok(Math.max(...rows.keys()) <= hz - 1, 'above the horizon line');
    assert.ok(Math.max(...[...rows.values()].map(([lo, hi]) => hi - lo + 1)) <= 34, 'never wider than 34');
    for (const [y, [lo, hi]] of rows) assert.equal(lo + hi + 1, 80, `row ${y} is centred`);
    assert.equal(f.c.filter((v) => v === VIOLET[1]).length, 0, 'no palms');
    assert.equal(horizRowsOf(f).length, 4, 'four horizontals');
    assert.equal(lineRows(T, 80, 24).length, 4);
    assert.equal(horizRowsOf(f)[0] > hz, true);
    for (let x = 0; x < 80; x++) assert.equal(f.g[hz * 80 + x], cp('━'));
  }
  const t0 = frame(0, 80, 24), rows0 = sunRowsIn(t0);
  assert.equal(Math.max(...rows0.keys()), hz - 1, 'at t=0 the sun reaches down to the horizon');
  assert.equal(Math.max(...[...rows0.values()].map(([lo, hi]) => hi - lo + 1)), 34, 'and is 34 wide');
  assert.equal(rows0.size >= 6 && rows0.size <= 8, true, 'in up to 8 rows');
  for (let k = 0; k <= 10 * FPS; k++) assert.equal(horizRowsOf(frame(k / FPS, 80, 24)).length, 4, `four at ${k / FPS}`);
  // the big layout: 52x13 and more horizontals than four
  assert.ok(horizRowsOf(frame(0, 120, 40)).length > 4);
  assert.equal(Math.max(...[...sunRowsIn(frame(0, 100, 32)).values()].map(([lo, hi]) => hi - lo + 1)), 52, 'the 52 wide sun from 100x32');
  // the verticals still meet at the horizon centre at 80x24
  const f = frame(0, 80, 24);
  const cyan0 = [];
  for (let i = 0; i < f.g.length; i++) if (f.c[i] === CYAN[0]) cyan0.push([i % 80, Math.floor(i / 80)]);
  assert.ok(cyan0.length > 20);
  assert.ok(cyan0.filter(([, y]) => y === hz + 2).every(([x]) => Math.abs(x - 40) <= 5));
});

// ---- S10

const walk = (w, h, seconds, each) => {
  let prev = frame(0, w, h);
  for (let k = 1; k <= seconds * FPS; k++) { const cur = frame(k / FPS, w, h); each(prev, cur, k / FPS); prev = cur; }
};
const familyOf = (col) => Object.entries(FAMILIES).find(([, f]) => f.includes(col));

test('sundown (S10): under 12% of the cells change in any frame over 120 s (Sam\'s figure is about 10%), at every size; it does move; the background is never drawn and no frame is blank', () => {
  const worstBy = [];
  for (const [w, h] of SIZES) {
    let worst = 0, at = 0;
    const blank = (f) => f.g.reduce((n, v) => n + (v === 32 ? 1 : 0), 0);
    let blanks = blank(frame(0, w, h));
    walk(w, h, 120, (a, b, t) => {
      const share = changedFraction(b.g, a.g, b.c, a.c);
      if (share > worst) { worst = share; at = t; }
      const nb = blank(b);
      assert.ok(Math.abs(nb - blanks) / b.g.length < 0.06, `${w}x${h} t=${t.toFixed(2)}: the blank share jumps`);
      blanks = nb;
    });
    worstBy.push(`${w}x${h} ${(worst * 100).toFixed(2)}% at ${at.toFixed(2)} s`);
    assert.ok(worst < FLASH_FRACTION, `${w}x${h}: ${worst}`);
    assert.ok(worst < 0.12, `${w}x${h}: worst frame changed ${(worst * 100).toFixed(2)}% at ${at.toFixed(2)} s`);
    assert.ok(worst > 0.001, 'it does move');
    for (const t of [0, 7.7, 41.3, 60, 99]) {
      const f = frame(t, w, h);
      const lit = f.g.length - blank(f);
      assert.ok(lit > w * h * 0.03 && lit < w * h * 0.6, `${w}x${h} t=${t}: ${lit} of ${w * h} cells lit`);
    }
  }
  console.log('# sundown worst frame: ' + worstBy.join(' | '));
});

test('sundown (S10 control): a scene that redraws every cell every frame breaks the same bound', () => {
  const flicker = Object.assign((t, w, h, p) => { p.glyphs.fill(cp('█')); p.colours.fill(Math.floor(t * 18) & 1 ? SUN[1] : SUN[2]); }, { id: 'flicker' });
  const a = renderScene(flicker, 0, 120, 40), b = renderScene(flicker, 1 / 18, 120, 40);
  const share = changedFraction(b.glyphs, a.glyphs, b.colours, a.colours);
  assert.ok(share > 0.9);
  assert.ok(!(share < 0.12), 'the 12% bound refuses it');
});

test('sundown (S10): no cell that keeps its glyph changes family or moves more than one shade in a frame, over 120 s at every size', () => {
  let ramps = 0, same = 0;
  for (const [w, h] of SIZES) {
    walk(w, h, 120, (a, b, t) => {
      for (let i = 0; i < a.g.length; i++) {
        if (a.g[i] === 32 || a.g[i] !== b.g[i]) continue;
        same++;
        if (a.c[i] === b.c[i]) continue;
        const fa = familyOf(a.c[i]), fb = familyOf(b.c[i]);
        assert.ok(fa && fb && fa[0] === fb[0], `${w}x${h} t=${t.toFixed(2)} cell ${i}: colour ${a.c[i]} -> ${b.c[i]} changes family under the same glyph`);
        assert.equal(Math.abs(fa[1].indexOf(a.c[i]) - fb[1].indexOf(b.c[i])), 1, `${w}x${h} t=${t.toFixed(2)} cell ${i}: more than one shade`);
        ramps++;
      }
    });
  }
  assert.ok(same > 100000, `${same} cells held their glyph`);
  // control: the checker does see a family change
  assert.notEqual(familyOf(SUN[3])[0], familyOf(TANG[3])[0]);
  assert.ok(ramps >= 0);
});
