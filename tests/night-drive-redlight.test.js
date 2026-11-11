// DRIFT-5 slice 2: scene B1, Red Light, Rain (a sim). The storyboard's promises, read off rendered frames:
//   - the view through a windscreen: roof liner, A-pillars (a quarter-block rounded corner), a mirror with two tail lights, a traffic
//     light blurred by rain into a 15x7 bokeh of concentric shades, reflections under it, a pedestrian with an umbrella, a dashboard
//     (dials, clock, radio, the top of the wheel) and one wiper whose pivot is at (34,31)
//   - the light is red until 58 s, ramps down (each shade held 8 steps, 0.27 s: longer than a 4x frame) and only then up in green from 59.2 s to 60.1 s; the reflections retint after it
//   - the wiper sweeps for 1.2 s, rests for 3 s, and clears the drops it crosses; drops land about 6 a second, 30% trickle
//   - the far buildings stand still until 62 s and then slide a column every 0.2 s
//   - calm: the worst frame changes only a few percent of the cells, at 1x and 4x
//   - a sim is a pure function of (size, seed, step count): draw never changes the state, and the composer agrees with renderScene
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import redlight, { LAYOUTS, layoutFor, geometry, inSweep } from '../cartridges/night-drive/scenes/redlight.js';
import { renderScene, createCellComposer } from '../src/cells.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { SUN, CORAL, MAG, CYAN, MINT, ICE, FAMILIES, FAR, NEAR, COUNT } from '../cartridges/night-drive/lib/palette.js';
import { changedFraction, lstarTable, brightnessJumps, snap } from './helpers-flash.js';

const BANNED = [0x25cd, 0x25ce, 0x25d1, 0x25e2, 0x25e3, 0x222b, 0x2261, 0x25d0, 0x25d3, 0x25d2]; // and ◐ ◓ ◒
const cp = (ch) => ch.codePointAt(0);
const width = (s) => [...s].length;
const FPS = 18;
const SKIN = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../cartridges/night-drive/skin.json', import.meta.url)), 'utf8'));
const LTAB = lstarTable(makeSkinPalette(SKIN, 'truecolor', 'night-drive'));
const DROPS = [cp('·'), cp('°'), cp("'"), cp(',')];
const RING = [cp('░'), cp('▒'), cp('▓'), cp('█')];
const TRICKLE = cp('╎');
const ARM = cp('╱');
const ARM_GLYPHS = [cp('╱'), cp('│'), cp('╲')]; // the arm leans right, is upright, then leans left at the top of its sweep

// ---- helpers: a stepper that draws any step, and a runner at 18 fps
const params = (w, h) => ({ glyphs: new Uint16Array(w * h), colours: new Uint8Array(w * h) });
function stepper(w, h, seed = 1) {
  const st = redlight.init(w, h, seed);
  const p = params(w, h);
  return {
    st, p, w, h,
    to(n) { while (st.steps < n) redlight.step(st); return this; },
    look() { redlight.draw(st, p); return { g: p.glyphs.slice(), c: p.colours.slice(), w, h, n: st.steps }; },
  };
}
const frameAt = (n, w = 120, h = 40, seed = 1) => stepper(w, h, seed).to(n).look();
const at = (f, x, y) => ({ g: f.g[y * f.w + x], c: f.c[y * f.w + x] });
const rowText = (f, y) => String.fromCharCode(...f.g.slice(y * f.w, (y + 1) * f.w));
const cellsWhere = (f, pred) => {
  const out = [];
  for (let i = 0; i < f.g.length; i++) if (pred(f.g[i], f.c[i], i % f.w, Math.floor(i / f.w))) out.push([i % f.w, Math.floor(i / f.w)]);
  return out;
};
const familyOf = (col) => Object.entries(FAMILIES).find(([, f]) => f.includes(col));
const isDropCell = (g, c) => DROPS.includes(g) && c === ICE[1];

// the sizes every promise is tested at: the shipped three, plus at, just above and one short of every breakpoint
const SHIPPED = [[120, 40], [80, 24], [240, 67]];
const SIZES = [...SHIPPED];
for (const l of LAYOUTS) {
  if (l.minCols > 0 && l.minRows > 0) SIZES.push([l.minCols, l.minRows], [l.minCols + 1, l.minRows + 1], [l.minCols - 1, l.minRows], [l.minCols, l.minRows - 1]);
}
// the bokeh box of a size: [x0, x1, y0, y1] (the light is at (cx, ly))
const lamp = (w, h) => {
  const L = layoutFor(w, h), g = geometry(w, h);
  const rx = L.name === 'full' ? 7 : 4, ry = L.name === 'full' ? 3 : 2;
  return { cx: g.cx, ly: g.ly, box: [g.cx - rx, g.cx + rx, g.ly - ry, g.ly + ry], rx, ry };
};
const boxCells = (f, b) => cellsWhere(f, (g, c, x, y) => x >= b[0] && x <= b[1] && y >= b[2] && y <= b[3]);
const coral = (c) => CORAL.includes(c);
const mint = (c) => MINT.includes(c);

// ---- R1

test('redlight (R1): a sim called redlight with init, step and draw; LAYOUTS widest first; the manifest lists it after sundown with its menu entry', () => {
  assert.equal(redlight.kind, 'sim');
  assert.equal(redlight.id, 'redlight');
  for (const k of ['init', 'step', 'draw']) assert.equal(typeof redlight[k], 'function', k);
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
  const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../cartridges/night-drive/manifest.json', import.meta.url)), 'utf8'));
  const ids = manifest.scenes.map((s) => s.id);
  assert.ok(ids.includes('redlight'));
  assert.ok(ids.indexOf('redlight') > ids.indexOf('sundown'), 'after sundown');
  const entry = manifest.scenes.find((s) => s.id === 'redlight');
  assert.equal(entry.kind, 'sim');
  assert.equal(entry.title, 'Red Light, Rain');
  assert.ok(width(entry.title) <= 23);
  const tape = manifest.programs.find((p) => p.id === 'tape');
  assert.deepEqual(tape.scenes, ids, 'tape order is manifest scene order');
  const menu = manifest.menu.find((m) => m.scene === 'redlight');
  assert.equal(menu.label, 'B1  RED LIGHT, RAIN');
  assert.equal(menu.program, 'tape');
  assert.equal(menu.note, '1:30');
  assert.ok(menu.desc && width(menu.desc) <= 76, `desc is ${width(menu.desc || '')} wide`);
  assert.equal(manifest.menu[manifest.menu.length - 1].action, 'eject', 'Eject stays last');
  assert.ok(manifest.menu.indexOf(menu) < manifest.menu.length - 1);
  assert.ok(manifest.menu.indexOf(menu) > manifest.menu.indexOf(manifest.menu.find((m) => m.scene === 'sundown')));
});

// ---- R2

test('redlight (R2a): the same (size, seed) gives equal states and equal frames after N steps', () => {
  for (const [w, h] of SHIPPED) {
    const a = stepper(w, h, 5).to(777), b = stepper(w, h, 5).to(777);
    assert.deepEqual(a.st, b.st, `${w}x${h} state`);
    assert.deepEqual(a.look(), b.look(), `${w}x${h} frame`);
  }
});

test('redlight (R2b): draw does not change the state, and drawing twice gives the same frame', () => {
  for (const n of [0, 5, 300, 1745, 1900]) {
    const s = stepper(120, 40, 3).to(n);
    const before = structuredClone(s.st);
    const f1 = s.look();
    assert.deepEqual(s.st, before, `n=${n}: state after draw`);
    assert.deepEqual(s.look(), f1, `n=${n}: second draw`);
  }
});

test('redlight (R2c): a state stepped N times with draws in between equals one stepped N times with none', () => {
  const a = stepper(120, 40, 2), b = stepper(120, 40, 2);
  for (let i = 0; i < 900; i++) { redlight.step(a.st); if (i % 7 === 0) a.look(); }
  b.to(900);
  assert.deepEqual(a.st, b.st);
  assert.deepEqual(a.look(), b.look());
});

test('redlight (R2d): the composer at 1x and 4x, whenever it has taken N steps, shows what renderScene shows for N / 30 s (N = 600, 1800, 2700)', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    for (const speed of [1, 4]) {
      const cc = createCellComposer({ scenes: [redlight], cols: w, rows: h, seed: 1 });
      const want = new Map([600, 1800, 2700].map((n) => [n, null]));
      for (let k = 1; k <= 90 * FPS / speed + 5; k++) {
        const t = (k * speed) / FPS;
        const f = cc.frame({ a: 0, b: 0, p: 0 }, t);
        if (want.has(cc.stepsTotal) && want.get(cc.stepsTotal) === null) {
          const ref = renderScene(redlight, cc.stepsTotal / 30, w, h, 1);
          assert.deepEqual(Array.from(f.glyphs), Array.from(ref.glyphs), `${w}x${h} ${speed}x N=${cc.stepsTotal} glyphs`);
          assert.deepEqual(Array.from(f.shades), Array.from(ref.colours), `${w}x${h} ${speed}x N=${cc.stepsTotal} colours`);
          want.set(cc.stepsTotal, true);
        }
      }
      for (const [n, v] of want) assert.equal(v, true, `${w}x${h} ${speed}x never stopped at N=${n}`);
    }
  }
});

test('redlight (R2e/R2f): the seed changes the picture; odd sizes do not throw', () => {
  for (const n of [600, 1650]) {
    const a = frameAt(n, 120, 40, 1), b = frameAt(n, 120, 40, 2);
    assert.ok(cellsWhere(a, (g, c, x, y) => g !== b.g[y * 120 + x] || c !== b.c[y * 120 + x]).length > 20, `n=${n}: another seed differs`);
  }
  for (const [w, h] of [[1, 1], [0, 0], [2, 200], [200, 2], [5, 5]]) {
    const s = stepper(w, h);
    assert.doesNotThrow(() => { s.to(40); s.look(); renderScene(redlight, 70, w, h, 4); }, `${w}x${h}`);
  }
});

// ---- R3

test('redlight (R3): allowed glyphs, none of the banned set, colours inside the 52-entry palette, blank cells colour 0, lit cells a real colour', () => {
  const stepsList = [0, 1, 90, 600, 1739, 1745, 1756, 1800, 1860, 2400, 3600, 4500];
  for (const [w, h] of SIZES) {
    const s = stepper(w, h);
    for (const n of stepsList) {
      const f = s.to(n).look();
      let lit = 0;
      for (let i = 0; i < f.g.length; i++) {
        assert.ok(isAllowedGlyph(f.g[i]), `${w}x${h} n=${n}: U+${f.g[i].toString(16)}`);
        assert.ok(!BANNED.includes(f.g[i]), `${w}x${h} n=${n}: banned U+${f.g[i].toString(16)}`);
        assert.ok(f.c[i] < COUNT, `${w}x${h} n=${n}: colour ${f.c[i]}`);
        if (f.g[i] === 32) assert.equal(f.c[i], 0, `${w}x${h} n=${n}: blank cell colour`);
        else { assert.ok(f.c[i] >= 16, `${w}x${h} n=${n}: lit cell colour ${f.c[i]}`); lit++; }
      }
      assert.ok(lit > 0.05 * f.g.length, `${w}x${h} n=${n}: ${lit} lit`);
    }
  }
});

// ---- R4

for (const n of [600, 1650]) {
  test(`redlight (R4): the 120x40 picture at ${n / 30} s: pillars, liner, mirror, light, reflections, pedestrian, dashboard and wiper`, () => {
    const f = frameAt(n);
    const W = 120;
    // the roof liner on row 0 and the A-pillars: a rounded outer corner and a slanted inner edge, never the triangle glyphs
    assert.equal(rowText(f, 0), '▀'.repeat(W));
    for (let x = 0; x < W; x++) assert.equal(f.c[x], NEAR);
    assert.deepEqual([at(f, 0, 1), at(f, 1, 1)], [{ g: cp('▟'), c: NEAR }, { g: cp('█'), c: NEAR }], 'left pillar is ▟█');
    assert.deepEqual([at(f, W - 2, 1), at(f, W - 1, 1)], [{ g: cp('█'), c: NEAR }, { g: cp('▙'), c: NEAR }], 'right pillar is █▙');
    for (const g of f.g) assert.ok(g !== 0x25e2 && g !== 0x25e3);
    let prev = 0;
    for (let y = 1; y <= 28; y++) { // the pillar widens as it goes down, the same on both sides
      let l = 0;
      while (l < W && f.g[y * W + l] !== 32 && f.c[y * W + l] === NEAR) l++;
      let r = 0;
      while (r < W && f.g[y * W + W - 1 - r] !== 32 && f.c[y * W + W - 1 - r] === NEAR) r++;
      assert.equal(l, r, `row ${y}: symmetric pillars`);
      assert.ok(l >= prev && l >= 3 && l <= 16, `row ${y}: pillar ${l} wide`);
      prev = l;
    }
    // the mirror at the top centre, with two coral tail lights
    const tails = cellsWhere(f, (g, c, x, y) => g === cp('▪') && coral(c) && y >= 1 && y <= 3);
    assert.equal(tails.length, 2, 'two tail lights');
    assert.ok(tails.every(([x, y]) => x > 44 && x < 76 && y === 2));
    assert.equal(tails[0][0] + tails[1][0], 119, 'symmetric about the middle');
    assert.ok(cellsWhere(f, (g, c, x, y) => y >= 1 && y <= 3 && x > 44 && x < 76 && c === NEAR).length > 40, 'a mirror frame');
    // the light: a bokeh 15x7 centred on (60,7), shade 0 at the rim to shade 3 in the core, glyphs ░ ▒ ▓ █
    const bokeh = cellsWhere(f, (g, c, x, y) => RING.includes(g) && coral(c) && x >= 44 && x <= 76 && y >= 2 && y <= 12);
    const xs = bokeh.map((p) => p[0]), ys = bokeh.map((p) => p[1]);
    assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [53, 67, 4, 10], 'a 15x7 box around (60,7)');
    assert.deepEqual(at(f, 60, 7), { g: cp('█'), c: CORAL[3] }, 'core');
    for (const [x, y] of bokeh) assert.equal(RING.indexOf(f.g[y * W + x]), CORAL.indexOf(f.c[y * W + x]), `glyph and shade agree at ${x},${y}`);
    assert.ok(bokeh.some(([x, y]) => f.c[y * W + x] === CORAL[0]), 'a rim in shade 0');
    const d2 = ([x, y]) => ((x - 60) / 7.5) ** 2 + ((y - 7) / 3.5) ** 2;
    for (const a of bokeh) for (const b of bokeh) if (d2(a) < d2(b) - 1e-9) assert.ok(CORAL.indexOf(f.c[a[1] * W + a[0]]) >= CORAL.indexOf(f.c[b[1] * W + b[0]]), 'concentric: brighter inside');
    // reflections under the light
    const refl = cellsWhere(f, (g, c, x, y) => (g === cp('╎') || g === cp('┊')) && c === CORAL[1]);
    assert.ok(refl.length >= 15 && refl.every(([x, y]) => y > 14 && y < 22 && x >= 56 && x <= 64), `${refl.length} reflection cells`);
    // the pedestrian: a canopy in mag.2, a body in far silhouette under it
    const canopy = cellsWhere(f, (g, c) => c === MAG[2]);
    assert.ok(canopy.length >= 4 && canopy.every(([, y]) => y === canopy[0][1]), `${canopy.length} canopy cells on one row`);
    const [cx0, cy0] = [Math.min(...canopy.map((p) => p[0])), canopy[0][1]];
    const bodies = cellsWhere(f, (g, c, x, y) => c === FAR && y === cy0 + 1 && x > cx0 && x < cx0 + 5);
    assert.equal(bodies.length, 1, 'one body cell under the canopy');
    assert.ok(cellsWhere(f, (g, c, x, y) => c === FAR && y === cy0 + 2 && x >= cx0 && x < cx0 + 5).length >= 2, 'legs');
    // the dashboard from row 31: two dials, the clock, the radio, the top of the wheel
    assert.equal(rowText(f, 31).split('╭──╮').length - 1, 2, 'two dials on row 31 (the clock and radio boxes are square)');
    for (const [x] of cellsWhere(f, (g, c, x, y) => g === cp('╭') && y === 31 && c === CYAN[2])) assert.equal(rowText(f, 31).slice(x, x + 4), '╭──╮');
    assert.equal(cellsWhere(f, (g, c, x, y) => g === cp('╭') && y === 31 && c === CYAN[2]).length, 2, 'dials in cyan.2');
    const textAt = (str, col) => {
      for (let y = 29; y < 40; y++) {
        for (let i = 0; i + str.length <= W; i++) {
          if ([...str].every((ch, k) => (ch === ' ' ? true : f.g[y * W + i + k] === cp(ch) && f.c[y * W + i + k] === col))) return [i, y];
        }
      }
      return null;
    };
    assert.ok(textAt('2:14', MINT[3]), 'clock 2:14 in mint.3');
    assert.ok(textAt('88.1 FM', CYAN[3]), 'radio 88.1 FM in cyan.3');
    const wheelRow = [29, 30, 31, 32, 33, 34, 35, 36].find((y) => /╭━{10,}╮/.test(rowText(f, y)));
    assert.equal(wheelRow, 34, 'wheel top on row 34');
    const wx = rowText(f, 34).indexOf('╭━');
    assert.ok(f.c.slice(34 * W + wx, 34 * W + wx + 12).every((c) => c === NEAR), 'wheel top in near silhouette');
    // the wiper: ╱ in ice.0 with its pivot at (34,31), reaching up
    assert.deepEqual(at(f, 34, 31), { g: ARM, c: ICE[0] }, 'pivot');
    const arm = cellsWhere(f, (g, c, x, y) => g === ARM && c === ICE[0] && y < 31);
    assert.ok(arm.length >= 8, `${arm.length} arm cells above the pivot`);
    for (let r = 1; r <= 6; r++) assert.ok(arm.some(([, y]) => y === 31 - r), `arm reaches row ${31 - r}`);
  });
}

// ---- R5, R6

const boxMap = (f, b) => {
  const m = new Map();
  for (const [x, y] of boxCells(f, b)) {
    const g = f.g[y * f.w + x];
    if (RING.includes(g)) m.set(x + ',' + y, [g, f.c[y * f.w + x]]);
  }
  return m;
};
const reflCells = (f, w, h) => {
  const { cx, ly } = lamp(w, h);
  return cellsWhere(f, (g, c, x, y) => (g === cp('╎') || g === cp('┊')) && x >= cx - 3 && x <= cx + 3 && y > ly + 6 && c !== ICE[0]);
};

test('redlight (R5, red arm): at 20 s and 55 s every bokeh cell is coral, no mint is in the bokeh box, and the reflections are coral.1', () => {
  for (const [w, h] of [[120, 40], [80, 24], [240, 67]]) {
    const { box } = lamp(w, h);
    for (const n of [600, 1650, 1739]) {
      const f = frameAt(n, w, h);
      const cells = boxMap(f, box);
      assert.ok(cells.size >= (w === 80 ? 20 : 60), `${w}x${h} n=${n}: ${cells.size} bokeh cells`);
      for (const [k, [, c]] of cells) assert.ok(coral(c), `${w}x${h} n=${n}: ${k} is colour ${c}`);
      assert.equal(boxCells(f, box).filter(([x, y]) => mint(f.c[y * w + x])).length, 0, `${w}x${h} n=${n}: no mint in the box`);
      const refl = reflCells(f, w, h);
      assert.ok(refl.length >= 8, `${w}x${h}: ${refl.length} reflection cells`);
      for (const [x, y] of refl) assert.equal(f.c[y * w + x], CORAL[1], `${w}x${h} n=${n}: reflection colour`);
    }
  }
});

test('redlight (R6, green arm): at 62 s and 80 s the same bokeh cells are mint with the same glyphs, no coral is in the box, the reflections are mint.1 (never mint before 58 s)', () => {
  for (const [w, h] of [[120, 40], [80, 24], [240, 67]]) {
    const { box } = lamp(w, h);
    const red = boxMap(frameAt(1650, w, h), box);
    for (const n of [1860, 2400, 3300]) {
      const f = frameAt(n, w, h);
      const green = boxMap(f, box);
      assert.deepEqual([...green.keys()], [...red.keys()], `${w}x${h} n=${n}: same cells`);
      for (const [k, [g, c]] of green) {
        assert.equal(g, red.get(k)[0], `${w}x${h} n=${n}: ${k} same glyph`);
        assert.equal(MINT.indexOf(c), CORAL.indexOf(red.get(k)[1]), `${w}x${h} n=${n}: ${k} same shade, in mint`);
      }
      assert.equal(boxCells(f, box).filter(([x, y]) => coral(f.c[y * w + x])).length, 0, `${w}x${h} n=${n}: no coral in the box`);
      const refl = reflCells(f, w, h);
      assert.ok(refl.length >= 8);
      for (const [x, y] of refl) assert.equal(f.c[y * w + x], MINT[1], `${w}x${h} n=${n}: reflection colour`);
    }
    // before 58 s no mint anywhere in the reflections; the retint is done by 61.7 s (1850; each level now holds 8 steps)
    const s = stepper(w, h);
    for (let n = 0; n < 1740; n += 5) assert.equal(reflCells(s.to(n).look(), w, h).filter(([x, y]) => mint(s.p.colours[y * w + x])).length, 0, `${w}x${h} n=${n}: mint before 58 s`);
    const f61 = frameAt(1850, w, h);
    for (const [x, y] of reflCells(f61, w, h)) assert.equal(f61.c[y * w + x], MINT[1], `${w}x${h}: retinted by 61.7 s`);
  }
});

// ---- R7

test('redlight (R7): nothing in the bokeh changes before 58.0 s; the red ramps down by 58.9 s (each shade held 8 steps, 0.27 s, more than a 4x frame), the green ramps up from 59.2 s to 60.1 s; no frame holds both; every ramp goes through each shade in single steps and holds each one 8 steps', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const { box } = lamp(w, h);
    const s = stepper(w, h);
    const base = boxMap(s.to(1600).look(), box);
    const key = (m) => [...m].map(([k, v]) => k + ':' + v.join('.')).join('|');
    const baseKey = key(base);
    const seq = new Map(); // cell -> [colour per step from 1739]
    let firstChange = -1, redGone = -1, greenOn = -1;
    const finalGreen = boxMap(frameAt(1840, w, h), box);
    for (let n = 1600; n <= 1840; n++) {
      const m = boxMap(s.to(n).look(), box);
      const cs = [...m.values()].map((v) => v[1]);
      assert.ok(!(cs.some(coral) && cs.some(mint)), `${w}x${h} n=${n}: coral and mint together`);
      if (n < 1740) assert.equal(key(m), baseKey, `${w}x${h} n=${n}: the bokeh changed before 58.0 s`);
      if (firstChange < 0 && key(m) !== baseKey) firstChange = n;
      if (redGone < 0 && n > 1740 && !cs.some(coral)) redGone = n;
      if (greenOn < 0 && n > 1740 && key(m) === key(finalGreen)) greenOn = n;
      for (const [k, v] of base) seq.set(k, [...(seq.get(k) || []), m.has(k) ? CORAL.concat(MINT).indexOf(m.get(k)[1]) : -1]);
    }
    assert.ok(firstChange > 0, 'the light does change');
    assert.ok(firstChange >= 1739 && firstChange <= 1743, `first change at step ${firstChange}`);
    assert.ok(redGone <= 1767, `${w}x${h}: red gone at step ${redGone} (58.9 s is 1767)`);
    assert.ok(greenOn > 1776 && greenOn <= 1803, `${w}x${h}: green fully on at step ${greenOn} (60.1 s is 1803)`);
    // every level of every cell between its first change and its final colour is held at least 8 steps (0.267 s), longer than a 4x frame of 0.222 s
    for (const [k] of base) {
      const col = seq.get(k);
      let run = 0, last = col[0];
      const runs = [];
      for (const c of col) { if (c === last) run++; else { runs.push([last, run]); last = c; run = 1; } }
      for (const [c, len] of runs.slice(1)) assert.ok(len >= 8, `${w}x${h} cell ${k}: level ${c} held only ${len} steps`);
    }
    // each cell: shades t, t-1 .. 0, blank, then 0 .. t in mint, one change at a time
    for (const [k, v] of base) {
      const t = CORAL.indexOf(v[1]);
      const runs = seq.get(k).filter((c, i, a) => i === 0 || c !== a[i - 1]);
      const want = [];
      for (let q = t; q >= 0; q--) want.push(q);
      want.push(-1);
      for (let q = 0; q <= t; q++) want.push(4 + q);
      assert.deepEqual(runs, want, `${w}x${h} cell ${k} (shade ${t})`);
    }
  }
});

// ---- R8

function walk(w, h, seconds, each, seed = 1) {
  const s = stepper(w, h, seed);
  let owed = 0, prev = null;
  for (let k = 0; k < seconds * FPS; k++) {
    owed += 30 / FPS;
    while (owed >= 1) { redlight.step(s.st); owed -= 1; }
    const cur = s.look();
    if (prev) each(prev, cur, k / FPS);
    prev = cur;
  }
}

test('redlight (R8): over 90 s no cell that keeps its glyph changes family or moves more than one shade; the L* step stays under 28 at the hand-over (brightnessJumps)', () => {
  let ramps = 0, jumps = 0;
  for (const [w, h] of [[120, 40], [80, 24], [240, 67]]) {
    walk(w, h, 90, (a, b, t) => {
      for (let i = 0; i < a.g.length; i++) {
        if (a.g[i] === 32 || a.g[i] !== b.g[i] || a.c[i] === b.c[i]) continue;
        const fa = familyOf(a.c[i]), fb = familyOf(b.c[i]);
        assert.ok(fa && fb && fa[0] === fb[0], `${w}x${h} t=${t.toFixed(2)} cell ${i}: colour ${a.c[i]} -> ${b.c[i]} changes family under the same glyph`);
        assert.equal(Math.abs(fa[1].indexOf(a.c[i]) - fb[1].indexOf(b.c[i])), 1, `${w}x${h} t=${t.toFixed(2)} cell ${i}: more than one shade`);
        ramps++;
      }
      const j = brightnessJumps({ ...a, L: LTAB }, { ...b, L: LTAB }, w);
      assert.equal(j.length, 0, `${w}x${h} t=${t.toFixed(2)}: ${JSON.stringify(j.slice(0, 3))}`);
      jumps++;
    });
  }
  assert.ok(ramps > 200, `${ramps} ramp steps were checked`);
  assert.ok(jumps > 4000);
});

test('redlight (R8): the centre of the lamp goes coral, then nothing, then mint: a glyph that is blank at the switch', () => {
  const s = stepper(120, 40);
  const seen = [];
  for (let n = 1736; n <= 1840; n++) { const f = s.to(n).look(); seen.push(f.g[7 * 120 + 60] === 32 ? 'blank' : coral(f.c[7 * 120 + 60]) ? 'coral' : mint(f.c[7 * 120 + 60]) ? 'mint' : '?'); }
  const runs = seen.filter((c, i) => i === 0 || c !== seen[i - 1]);
  assert.deepEqual(runs, ['coral', 'blank', 'mint']);
});

// ---- R9

test('redlight (R9): the wiper sweeps for 1.2 s in a cycle of 4.2 s and is still for the 3 s between; the drops it crosses are cleared and the rest are not', () => {
  for (const seed of [1, 7, 23]) {
    const W = 120, H = 40;
    const s = stepper(W, H, seed);
    const arm = (f) => cellsWhere(f, (g, c) => ARM_GLYPHS.includes(g) && c === ICE[0]).map(([x, y]) => x + ',' + y + f.g[y * W + x]).join(' ');
    const dropsIn = (f, inside) => new Set(cellsWhere(f, (g, c, x, y) => isDropCell(g, c) && inSweep(W, H, x, y) === inside).map(([x, y]) => x + ',' + y));
    let prevArm = null, changedAt = [];
    const frames = new Map();
    for (let n = 0; n <= 126 * 10 + 126; n++) {
      const f = s.to(n).look();
      const a = arm(f);
      if (prevArm !== null && a !== prevArm) changedAt.push(n);
      prevArm = a;
      if (n % 126 === 89 || n % 126 === 0 || n % 126 === 29) frames.set(n, f);
    }
    const phases = new Set(changedAt.map((n) => n % 126));
    for (const p of phases) assert.ok(p === 0 || (p >= 91 && p <= 125), `seed ${seed}: the wiper moved at phase ${p}`);
    assert.ok(changedAt.length >= 10 * 30, `seed ${seed}: it moved ${changedAt.length} times in 10 cycles`);
    const first = changedAt.find((n) => n > 126), last = changedAt.find((n) => n > first + 5 && n % 126 === 0);
    assert.equal(last - first + 1, 36, `seed ${seed}: one sweep is 36 steps (1.2 s)`);
    for (let k = 2; k <= 9; k++) {
      const n0 = 126 * k + 89, n1 = 126 * (k + 1);
      const before = dropsIn(frames.get(n0), true), after = dropsIn(frames.get(n1), true);
      assert.ok(before.size >= 10, `seed ${seed} cycle ${k}: ${before.size} drops in the swept area before the sweep`);
      assert.ok(after.size <= 0.3 * before.size, `seed ${seed} cycle ${k}: ${after.size} of ${before.size} remain`);
    }
  }
});

test('redlight (R9, both arms): drops outside the swept area are not cleared by a sweep; the ones inside are', () => {
  const W = 120, H = 40;
  for (const seed of [1, 9]) {
    const s = stepper(W, H, seed);
    const snapAt = (n) => s.to(n).look();
    for (const k of [3, 5, 8]) {
      const early = snapAt(126 * k + 89 - 60), n0 = snapAt(126 * k + 89), n1 = snapAt(126 * (k + 1));
      const was = (f, x, y) => isDropCell(f.g[y * W + x], f.c[y * W + x]);
      const old = cellsWhere(n0, (g, c, x, y) => isDropCell(g, c) && was(early, x, y));
      const inside = old.filter(([x, y]) => inSweep(W, H, x, y)), outside = old.filter(([x, y]) => !inSweep(W, H, x, y));
      assert.ok(outside.length >= 10 && inside.length >= 3, `seed ${seed} cycle ${k}: ${outside.length} outside, ${inside.length} inside`);
      const kept = (list) => list.filter(([x, y]) => was(n1, x, y)).length / list.length;
      assert.ok(kept(outside) >= 0.85, `seed ${seed} cycle ${k}: only ${kept(outside).toFixed(2)} of the drops outside survive`);
      assert.ok(kept(inside) <= 0.2, `seed ${seed} cycle ${k}: ${kept(inside).toFixed(2)} of the drops inside survive`);
    }
  }
});

// ---- R10

test('redlight (R10): about 6 drops land a second, about 30% trickle down a row per 0.5-1.5 s, and the pedestrian steps a column per 0.4 s', () => {
  for (const seed of [1, 4]) {
    const s = stepper(120, 40, seed);
    let prev = s.look();
    let landed = 0, born = 0;
    const heads = new Map(); // "x,y" -> step of its last event
    const gaps = [];
    for (let n = 1; n <= 1800; n++) {
      const f = s.to(n).look();
      for (let i = 0; i < f.g.length; i++) {
        const now = isDropCell(f.g[i], f.c[i]), was = isDropCell(prev.g[i], prev.c[i]);
        if (now && !was && n <= 900) landed++;
        const isT = f.g[i] === TRICKLE && f.c[i] === ICE[0], wasT = prev.g[i] === TRICKLE && prev.c[i] === ICE[0];
        if (isT && !wasT) {
          const x = i % 120, y = Math.floor(i / 120);
          const above = (y - 1) * 120 + x;
          if (heads.has(x + ',' + (y - 1)) && prev.g[above] === TRICKLE) {
            gaps.push(n - heads.get(x + ',' + (y - 1)));
            heads.set(x + ',' + y, n);
          } else {
            assert.ok(isDropCell(f.g[above], f.c[above]), 'a trickle is born under a drop, which stays');
            born++;
            heads.set(x + ',' + y, n);
          }
        }
      }
      for (const k of [...heads.keys()]) { const [x, y] = k.split(',').map(Number); if (!(f.g[y * 120 + x] === TRICKLE)) heads.delete(k); }
      prev = f;
    }
    const perSecond = landed / 30;
    assert.ok(perSecond >= 4 && perSecond <= 8, `seed ${seed}: ${perSecond.toFixed(2)} drops a second`);
    assert.ok(gaps.length >= 20, `seed ${seed}: ${gaps.length} trickle moves seen`);
    for (const g of gaps) assert.ok(g >= 15 && g <= 45, `seed ${seed}: a trickle moved after ${g} steps`);
    assert.ok(Math.min(...gaps) <= 20 && Math.max(...gaps) >= 40, 'the gaps use the range (0.5 to 1.5 s)');
    const share = born / (landed * 2); // 60 s of rain, 30 s of landings counted
    assert.ok(share >= 0.2 && share <= 0.4, `seed ${seed}: ${(share * 100).toFixed(0)}% of the drops trickle`);
  }
});

test('redlight (R10): the pedestrian under the umbrella moves one column every 12 steps (0.4 s) and goes round again', () => {
  const W = 120, s = stepper(120, 40);
  let last = null, moves = 0, vanished = 0, appeared = 0;
  const canopyX = (f) => { const c = cellsWhere(f, (g, col) => col === MAG[2]); return c.length ? Math.min(...c.map((p) => p[0])) : null; };
  for (let n = 0; n <= 126 * 30; n++) {
    const f = s.to(n).look();
    if (n % 126 >= 85) { last = null; continue; } // the wiper may cover a cell while it sweeps (and is parked at the end of the cycle)
    const x = canopyX(f);
    if (last !== null && last.n === n - 1) {
      if (x !== null && last.x !== null) {
        if (n % 12 === 0) { assert.equal(x, last.x + 1, `n=${n}: steps a column on the 12th step`); moves++; } else assert.equal(x, last.x, `n=${n}: still between steps`);
      } else if (x === null && last.x !== null) vanished++;
      else if (x !== null && last.x === null) appeared++;
    }
    last = { n, x };
  }
  assert.ok(moves >= 100, `${moves} column steps`);
  assert.ok(vanished >= 1 && appeared >= 1, 'it leaves at one side and comes round again');
});

// ---- R11

test('redlight (R11): the far buildings stand still until 62 s, then move one column left every 6 steps until the end', () => {
  const W = 120, H = 40, s = stepper(W, H);
  const solid = (g, c) => g === 32 || (g === cp('█') && c === FAR) || (g === cp('▪') && c === SUN[0]);
  const band = (f, x, y) => y >= 4 && y <= 10 && x >= 20 && x < W - 20 && !(x >= 50 && x <= 70);
  const same = (a, b, dx) => { // compare a(x + dx) with b(x) where both are plain building cells; returns [equal, different]
    let eq = 0, ne = 0;
    for (let y = 4; y <= 10; y++) {
      for (let x = 20; x < W - 20; x++) {
        if (!band(a, x, y) || !band(a, x + dx, y)) continue;
        const A = at(a, x + dx, y), B = at(b, x, y);
        if (!solid(A.g, A.c) || !solid(B.g, B.c)) continue;
        if (A.g === B.g && A.c === B.c) eq++; else ne++;
      }
    }
    return [eq, ne];
  };
  // still: frames 6 steps apart from 0 to 61 s are the same picture
  for (let n = 0; n < 1860 - 6; n += 37) {
    const [eq, ne] = same(s.to(n).look(), s.to(n + 6).look(), 0);
    assert.ok(eq > 300 && ne === 0, `n=${n}: ${ne} building cells moved`);
  }
  // moving: from step 1860 the picture shifts by one column per 6 steps
  for (const n0 of [1860, 1863, 1866, 1901, 2300, 2705, 3000, 4400]) {
    const a = frameAt(n0, W, H);
    const b = frameAt(n0 + 6, W, H);
    const [eq, ne] = same(a, b, 1);
    assert.ok(eq > 300 && ne === 0, `n=${n0}: after 6 steps the buildings are one column left (${ne} cells disagree)`);
    const [eq0, ne0] = same(a, b, 0);
    assert.ok(ne0 > 6, `n=${n0}: control: they did move (${ne0} cells differ at no shift)`);
    const c = frameAt(n0 + 12, W, H);
    assert.ok(same(a, c, 2)[1] === 0, `n=${n0}: two columns after 12 steps`);
  }
  // the change happens at steps 1860, 1866 .. and at no step between
  // (a drop landing on or leaving a building cell is rain, not the building: only cells that are plain building in both frames count)
  const moved = (a, b) => cellsWhere(b, (g, c, x, y) => band(b, x, y) && solid(g, c) && solid(a.g[y * W + x], a.c[y * W + x]) && (g !== a.g[y * W + x] || c !== a.c[y * W + x])).length;
  const s2 = stepper(W, H);
  let prev = s2.to(1850).look();
  const when = [];
  for (let n = 1851; n <= 1900; n++) { const f = s2.to(n).look(); if (moved(prev, f) > 0) when.push(n); prev = f; }
  for (const n of when) assert.equal((n - 1860) % 6, 0, `building cells moved at step ${n}`);
  assert.ok(when.length >= 5 && when[0] === 1860, `moves at ${when.join(',')}`);
});

// ---- R12

test('redlight (R12): the compact rule: at 80x24 no mirror, a 9x5 bokeh and a 2-row dashboard; at 120x40 none of those differ', () => {
  const box = (f, w, h) => {
    const { cx, ly } = lamp(w, h);
    const c = cellsWhere(f, (g, col, x, y) => RING.includes(g) && coral(col) && Math.abs(x - cx) <= 9 && Math.abs(y - ly) <= 4);
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
    return [Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1];
  };
  const mirror = (f, w, cx) => cellsWhere(f, (g, c, x, y) => y >= 1 && y <= 3 && Math.abs(x - cx) <= 13 && c === NEAR);
  for (const [w, h] of SIZES) {
    const f = frameAt(1650, w, h);
    const L = layoutFor(w, h), cx = Math.floor(w / 2);
    if (L.name === LAYOUTS[0].name) {
      assert.deepEqual(box(f, w, h), [15, 7], `${w}x${h}: bokeh 15x7`);
      assert.ok(mirror(f, w, cx).length > 40, `${w}x${h}: a mirror`);
      assert.equal(L.dashRows, 9);
      assert.ok(cellsWhere(f, (g, c, x, y) => g === cp('╭') && c === CYAN[2]).length === 2, `${w}x${h}: two dials`);
    } else {
      assert.deepEqual(box(f, w, h), [9, 5], `${w}x${h}: bokeh 9x5`);
      assert.equal(mirror(f, w, cx).length, 0, `${w}x${h}: no mirror`);
      assert.equal(L.dashRows, 2);
      assert.equal(cellsWhere(f, (g, c, x, y) => g === cp('╭') && c === CYAN[2]).length, 0, `${w}x${h}: no dials`);
      assert.equal(rowText(f, h - 3).trim().replace(/[^▄]/g, '').length > 10, true, `${w}x${h}: the dashboard's top edge`);
      const has = (y, str, col) => { for (let x = 0; x + str.length <= w; x++) if ([...str].every((ch, k) => ch === ' ' || (f.g[y * w + x + k] === cp(ch) && f.c[y * w + x + k] === col))) return true; return false; };
      assert.ok(has(h - 2, '2:14', MINT[3]), `${w}x${h}: the clock in the two rows`);
      assert.ok(has(h - 2, '88.1 FM', CYAN[3]), `${w}x${h}: the radio in the two rows`);
      for (let y = 0; y < h - 3; y++) assert.ok(!has(y, '2:14', MINT[3]) && !has(y, '88.1 FM', CYAN[3]), `${w}x${h}: nothing of the dashboard on row ${y}`);
    }
  }
});

// ---- R13

function composerRun(w, h, speed, seconds) {
  const cc = createCellComposer({ scenes: [redlight], cols: w, rows: h, seed: 1 });
  const out = [];
  const total = Math.ceil((seconds * FPS) / speed);
  for (let k = 1; k <= total; k++) {
    const f = cc.frame({ a: 0, b: 0, p: 0 }, (k * speed) / FPS);
    out.push({ g: f.glyphs.slice(), c: f.shades.slice() });
  }
  return out;
}
const worstOf = (frames) => {
  let worst = 0, at = 0;
  for (let k = 1; k < frames.length; k++) {
    const f = changedFraction(frames[k].g, frames[k - 1].g, frames[k].c, frames[k - 1].c);
    if (f > worst) { worst = f; at = k; }
  }
  return { worst, at };
};

for (const [w, h] of SHIPPED) {
  for (const speed of [1, 4]) {
    test(`redlight (R13): ${w}x${h} at ${speed}x: the worst frame changes under 6% of the cells over 90 s, and more than 0.1%; nothing is blank or a bright block`, () => {
      const frames = composerRun(w, h, speed, 90);
      const { worst, at: k } = worstOf(frames);
      console.log(`redlight worst frame ${w}x${h} ${speed}x: ${(worst * 100).toFixed(2)}% (frame ${k}, ${((k * speed) / FPS).toFixed(1)} s)`);
      assert.ok(worst < 0.06, `worst frame changed ${(worst * 100).toFixed(2)}%`);
      assert.ok(worst > 0.001, `and it does move (${(worst * 100).toFixed(3)}%)`);
      for (const f of frames) {
        let lit = 0, bright = 0;
        for (let i = 0; i < f.g.length; i++) {
          if (f.g[i] !== 32) lit++;
          if ((f.g[i] === cp('█') || f.g[i] === cp('▓')) && LTAB[f.c[i]] >= 60) bright++;
        }
        assert.ok(lit > 0.05 * f.g.length, 'a frame is not blank');
        assert.ok(bright < 0.25 * f.g.length, `${bright} bright solid cells`);
      }
    });
  }
}

test('redlight (R13 control): a scene that redraws every cell every frame fails the same bound', () => {
  const noisy = {
    id: 'noisy', kind: 'sim',
    init: () => ({ n: 0 }), step: (s) => { s.n++; },
    draw: (s, p) => { for (let i = 0; i < p.glyphs.length; i++) { p.glyphs[i] = 0x2591 + ((i + s.n) % 3); p.colours[i] = 20 + ((i + s.n) % 4); } },
  };
  const cc = createCellComposer({ scenes: [noisy], cols: 120, rows: 40, seed: 1 });
  const frames = [];
  for (let k = 1; k <= 40; k++) frames.push(snap({ glyphs: cc.frame({ a: 0, b: 0, p: 0 }, k / FPS).glyphs, shades: cc.shades }));
  assert.ok(worstOf(frames).worst > 0.06);
});

test('redlight (R13): stays valid and bounded to 150 s: no array grows', () => {
  for (const [w, h] of SHIPPED) {
    const s = stepper(w, h);
    const sizes = (st) => Object.entries(st).filter(([, v]) => Array.isArray(v) || ArrayBuffer.isView(v)).map(([k, v]) => [k, v.length]);
    const at90 = (s.to(2700), sizes(s.st));
    const maxDrops = [];
    for (let n = 2700; n <= 4500; n += 30) { s.to(n); maxDrops.push(s.st.drops.length); }
    const at150 = sizes(s.st);
    for (const [k, len] of at150) {
      const l90 = at90.find(([kk]) => kk === k)[1];
      assert.ok(len <= Math.max(2 * l90, l90 + 100), `${w}x${h}: ${k} grew from ${l90} to ${len}`);
    }
    assert.ok(Math.max(...maxDrops) <= 400, `${w}x${h}: ${Math.max(...maxDrops)} drops`);
    const f = s.look();
    for (let i = 0; i < f.g.length; i++) assert.ok(isAllowedGlyph(f.g[i]) && f.c[i] < COUNT);
  }
});
