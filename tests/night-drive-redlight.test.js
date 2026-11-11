// DRIFT-5 slice 2: scene B1, Red Light, Rain (a sim). The storyboard's promises, read off rendered frames:
//   - the view through a windscreen: roof liner, A-pillars (a quarter-block rounded corner), a mirror with two tail lights, a traffic
//     light blurred by rain into a 15x7 bokeh of concentric shades, reflections under it, a pedestrian with an umbrella, a dashboard
//     (dials, clock, radio, the top of the wheel) and one wiper whose pivot is at (34,31)
//   - the light is red until 58 s, ramps down (each shade held 8 steps, 0.27 s: longer than a 4x frame) and only then up in green from 59.2 s to 60.1 s; the reflections retint after it
//   - the wiper sweeps for 0.93 s every 2.4 s and clears what it crosses (a clean swath behind the blade, spray off its leading edge, the
//     glass refilling within a second); the downpour (owner change request): slanted red speed lines on one diagonal in a gusting wind,
//     far denser and faster than the first version, with a few highlights, near the lamp it turns green at 58 s and the far rain stays red
//   - the far buildings stand still until 62 s and then slide a column every 0.2 s
//   - busy but never a flash: the worst frame changes under 25% of the cells, at 1x and 4x (the shell's own bound is 30%)
//   - a sim is a pure function of (size, seed, step count): draw never changes the state, and the composer agrees with renderScene
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import redlight, { LAYOUTS, layoutFor, geometry, inSweep } from '../cartridges/night-drive/scenes/redlight.js';
import { CYCLE, SWEEP_AT, SWEEP_LEN, slopeAt, inBand, waterCap, sprayCap, LAND_RATE, RUN_SHARE, SPRAY_LIFE } from '../cartridges/night-drive/lib/rain.js';
import { windSlope, densityAt, lengthAt, streakOf, tintLevel, shownColour, SLOPE_MIN, SLOPE_MAX, SPEED_MIN, AIR_PER_CELL, REFILL_MIN, REFILL_SPAN, RAIN_GREEN_BY, GREEN_LAG, GAP_JITTER } from '../cartridges/night-drive/lib/downpour.js';
import { RED_OFF, GREEN_ON } from '../cartridges/night-drive/lib/bokeh.js';
import { onGlass, inZone } from '../cartridges/night-drive/lib/dash.js';
import { renderScene, createCellComposer } from '../src/cells.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { SUN, TANG, CORAL, MAG, CYAN, MINT, ICE, FAMILIES, FAR, NEAR, COUNT } from '../cartridges/night-drive/lib/palette.js';
import { changedFraction, lstarTable, brightnessJumps, snap } from './helpers-flash.js';

const BANNED = [0x25cd, 0x25ce, 0x25d1, 0x25e2, 0x25e3, 0x222b, 0x2261, 0x25d0, 0x25d3, 0x25d2]; // and ◐ ◓ ◒
const cp = (ch) => ch.codePointAt(0);
const width = (s) => [...s].length;
const FPS = 18;
const SKIN = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../cartridges/night-drive/skin.json', import.meta.url)), 'utf8'));
const LTAB = lstarTable(makeSkinPalette(SKIN, 'truecolor', 'night-drive'));
const DROPS = [cp('·'), cp('°'), cp("'"), cp(',')];
const RING = [cp('░'), cp('▒'), cp('▓'), cp('█')];
const ARM = cp('╱');
const ARM_GLYPHS = [cp('╱'), cp('│'), cp('\\')]; // the arm leans right, is upright, then leans left (a back slash, not the rain's ╲) at the top of its sweep
const SLANT = cp('╲'), SPARK = cp('*'), CROSS = cp('×');
const RAIN_GLYPHS = [SLANT, SPARK, CROSS, ...DROPS];
const SWEEP_END = SWEEP_AT + SWEEP_LEN; // the cycle step at which the blade is back at rest (the same step as 0 of the next cycle)
const SPRAY_MAX = SPRAY_LIFE[0] + SPRAY_LIFE[1] - 1;

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
const wet = (c) => CORAL.includes(c) || MINT.includes(c);
const isRain = (g, c) => RAIN_GLYPHS.includes(g) && wet(c); // a cell of the downpour: streak, spark, water on the glass, spray or a trail
const isDropCell = (g, c) => DROPS.includes(g) && wet(c);
// the first version of this scene, for the "heavier and faster" proofs: measured at 5dd697a through the same draw (colours ice.0/ice.1 inside the glass)
const OLD = { share: { '120x40': 0.0298, '80x24': 0.0512 }, rowsPerSecond: 2 }; // worst share of glass cells with rain; the fastest thing in it, a trickle, ran a row per 0.5 s at best

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

// ---- R9: the wiper

const waterIn = (st, inside) => st.drops.filter((d) => d.kind !== 2 && inBand(st.g, d.x, d.y) === inside).length; // drops and runners (not trails)
const glassCellsOf = (w, h) => {
  const g = geometry(w, h), out = [];
  for (let y = g.gTop; y < g.hoodTop; y++) for (let x = 0; x < w; x++) if (onGlass(g, x, y)) out.push([x, y]);
  return out;
};
const rainShare = (f, cells) => cells.filter(([x, y]) => isRain(f.g[y * f.w + x], f.c[y * f.w + x])).length / cells.length;

test('redlight (R9 cadence): the wiper sweeps for 0.93 s every 2.4 s (constants exported), is still between, and the arm only moves in the sweep', () => {
  assert.ok(SWEEP_LEN / 30 >= 0.9 && SWEEP_LEN / 30 <= 1.0, `sweep ${SWEEP_LEN / 30} s`);
  assert.ok(CYCLE / 30 >= 2.2 && CYCLE / 30 <= 2.6, `cycle ${CYCLE / 30} s`);
  assert.ok(SWEEP_AT + SWEEP_LEN <= CYCLE && SWEEP_AT >= 30, 'the sweep fits in the cycle, after a rest');
  assert.ok(CYCLE / 30 < 4.2 && SWEEP_LEN / 30 < 1.2, 'faster than the first version (4.2 s cycle, 1.2 s sweep)');
  for (const seed of [1, 7, 23]) {
    const W = 120, H = 40;
    const s = stepper(W, H, seed);
    const arm = (f) => cellsWhere(f, (g, c) => ARM_GLYPHS.includes(g) && c === ICE[0]).map(([x, y]) => x + ',' + y + f.g[y * W + x]).join(' ');
    let prevArm = null;
    const changedAt = [];
    for (let n = 0; n <= CYCLE * 12; n++) {
      const a = arm(s.to(n).look());
      if (prevArm !== null && a !== prevArm) changedAt.push(n);
      prevArm = a;
    }
    const phases = new Set(changedAt.map((n) => n % CYCLE));
    for (const p of phases) assert.ok(p === 0 || p >= SWEEP_AT + 1, `seed ${seed}: the wiper moved at phase ${p}`);
    assert.ok(changedAt.length >= 12 * (SWEEP_LEN - 4), `seed ${seed}: it moved ${changedAt.length} times in 12 cycles`);
    const first = changedAt.find((n) => n > CYCLE), last = changedAt.find((n) => n > first + 5 && n % CYCLE === 0);
    assert.equal(last - first + 1, SWEEP_LEN, `seed ${seed}: one sweep is ${SWEEP_LEN} steps`);
  }
});

// Steps the state one at a time and says, for each, which water on the glass the step took before its time (still had life left) and which was inside the blade's band.
function wipeLog(w, h, seed, cycles, noWiper = false) {
  const st = redlight.init(w, h, seed);
  st.noWiper = noWiper;
  const g = st.g;
  const log = { sweeping: 0, insideTaken: 0, insideKept: 0, outsideTaken: 0, strayInSweep: 0, strayAtRest: 0, born: [] };
  for (let n = 1; n <= CYCLE * cycles; n++) {
    const before = st.drops.filter((d) => d.kind !== 2 && d.ttl > 1 && d.kind === 0).slice();
    const set0 = new Set(before);
    redlight.step(st);
    const s0 = slopeAt(g, n - 1), s1 = slopeAt(g, n), lo = Math.min(s0, s1), hi = Math.max(s0, s1);
    const now = new Set(st.drops);
    const sweeping = s0 !== s1;
    if (sweeping) log.sweeping++;
    for (const d of set0) {
      const gone = !now.has(d);
      const inside = inBand(g, d.x, d.y, lo, hi);
      if (gone && inside) log.insideTaken++;
      else if (gone && !inside) { if (sweeping) log.outsideTaken++; else log.strayAtRest++; }
      else if (!gone && inside && sweeping) log.insideKept++;
    }
    if (sweeping) for (const p of st.spray) if (p.age === 1) log.born.push({ n, p: { ...p }, lo, hi, dir: s1 < s0 ? -1 : 1 });
  }
  return log;
}

test('redlight (R9, both arms): the blade takes the water it crosses and only that: every drop inside the band of a step goes, none outside does, none goes when the arm is still; with the wiper off nothing is taken', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    for (const seed of [1, 9]) {
      const log = wipeLog(w, h, seed, 8);
      assert.ok(log.insideTaken >= 60, `${w}x${h} seed ${seed}: only ${log.insideTaken} drops were wiped in 8 sweeps`);
      assert.equal(log.insideKept, 0, `${w}x${h} seed ${seed}: drops inside the band survived`);
      assert.equal(log.outsideTaken, 0, `${w}x${h} seed ${seed}: drops outside the band were taken during a sweep`);
      assert.equal(log.strayAtRest, 0, `${w}x${h} seed ${seed}: drops were taken while the arm was still`);
    }
    const off = wipeLog(w, h, 1, 8, true);
    assert.equal(off.insideTaken + off.outsideTaken + off.strayAtRest, 0, `${w}x${h}: the control (wiper off) still lost drops early`);
    assert.ok(off.insideKept >= 60, `${w}x${h}: the control kept the drops that were in the band (${off.insideKept})`);
  }
});

test('redlight (R9): before a sweep the swept area holds at least 10 drops; a sweep later almost none (at most 30%) and the glass is the same water as before (the control without the wiper keeps it)', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    for (const seed of [1, 7, 23]) {
      const s = stepper(w, h, seed), c = stepper(w, h, seed);
      c.st.noWiper = true;
      for (let k = 2; k <= 9; k++) {
        const before = waterIn(s.to(CYCLE * k + SWEEP_AT).st, true);
        const after = waterIn(s.to(CYCLE * (k + 1)).st, true);
        const ctl = waterIn(c.to(CYCLE * (k + 1)).st, true);
        assert.ok(before >= 10, `${w}x${h} seed ${seed} cycle ${k}: ${before} drops in the swept area before the sweep`);
        assert.ok(after <= 0.3 * before, `${w}x${h} seed ${seed} cycle ${k}: ${after} of ${before} remain`);
        assert.ok(ctl >= 0.5 * before, `${w}x${h} seed ${seed} cycle ${k}: the control (no wiper) has ${ctl} of ${before}`);
      }
    }
  }
});

test('redlight (R-wiper swath): at mid-stroke the swath behind the blade is clear of rain (at most a fifth of the density outside it); with the wiper disabled the same cells are as wet as the rest', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const g = geometry(w, h);
    const cells = glassCellsOf(w, h);
    const outside = (cur) => cells.filter(([x, y]) => !inBand(g, x, y, cur - 0.2, g.sRest + 0.5) && !inBand(g, x, y, g.sTop - 2, cur - 0.2) && !inZone(g, x, y));
    for (const seed of [1, 4]) {
      for (const k of [3, 6, 9]) {
        const n = CYCLE * k + SWEEP_AT + 7; // 7 steps into the stroke up
        const cur = slopeAt(g, n);
        assert.ok(cur < g.sRest - 1 && cur > g.sTop, `slope ${cur} at mid-stroke`);
        const swath = cells.filter(([x, y]) => inBand(g, x, y, cur + 0.3, g.sRest - 0.3) && !inZone(g, x, y));
        const rest = outside(cur);
        assert.ok(swath.length > 100 && rest.length > 100, `${w}x${h}: ${swath.length} swath cells, ${rest.length} others`);
        const f = frameAt(n, w, h, seed);
        const inS = rainShare(f, swath), outS = rainShare(f, rest);
        assert.ok(outS >= 0.12, `${w}x${h} seed ${seed} cycle ${k}: ${(outS * 100).toFixed(1)}% rain outside the swath`);
        assert.ok(inS <= 0.2 * outS, `${w}x${h} seed ${seed} cycle ${k}: swath ${(inS * 100).toFixed(1)}% against ${(outS * 100).toFixed(1)}% outside`);
        // control: the same step without the wiper
        const c = stepper(w, h, seed);
        c.st.noWiper = true;
        const fc = c.to(n).look();
        assert.ok(rainShare(fc, swath) >= 0.12, `${w}x${h} seed ${seed} cycle ${k}: control swath ${(rainShare(fc, swath) * 100).toFixed(1)}%`);
      }
    }
  }
});

test('redlight (R-wiper spray): spray is thrown only during a sweep, from the band of the step, along the sweep and up, lives at most 11 steps, and is capped', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const st = redlight.init(w, h, 1), g = st.g;
    let sprayed = 0, born = 0, maxSpray = 0;
    const sweepSteps = new Set();
    for (let n = 1; n <= CYCLE * 6; n++) {
      redlight.step(st);
      const c = n % CYCLE, s0 = slopeAt(g, n - 1), s1 = slopeAt(g, n), sweeping = s0 !== s1;
      if (sweeping) sweepSteps.add(c);
      maxSpray = Math.max(maxSpray, st.spray.length);
      if (sweeping && st.spray.length > 0) sprayed++;
      if (!sweeping && c > SPRAY_MAX && c <= SWEEP_AT) assert.equal(st.spray.length, 0, `${w}x${h} n=${n} (phase ${c}): spray with the arm at rest`);
      const lo = Math.min(s0, s1), hi = Math.max(s0, s1), dir = s1 < s0 ? -1 : 1;
      for (const p of st.spray) {
        assert.ok(p.age <= SPRAY_MAX, `spray older than ${SPRAY_MAX} steps`);
        if (p.age !== 1) continue;
        born++;
        assert.ok(sweeping, `${w}x${h} n=${n}: a particle was born with the arm still`);
        let near = false;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inBand(g, Math.round(p.x) + dx, Math.round(p.y) + dy, lo, hi)) near = true;
        assert.ok(near, `${w}x${h} n=${n}: a particle born at ${p.x.toFixed(1)},${p.y.toFixed(1)} is not on the blade's band`);
        assert.ok(p.vx * dir > 0 && p.vy < 0, `${w}x${h} n=${n}: thrown along the sweep (${dir}) and up: ${p.vx.toFixed(2)},${p.vy.toFixed(2)}`);
      }
    }
    assert.ok(sweepSteps.size >= SWEEP_LEN - 2, `${sweepSteps.size} sweeping phases`);
    assert.ok(sprayed >= 6 * (SWEEP_LEN - 6), `${w}x${h}: spray in the air for ${sprayed} of ${6 * SWEEP_LEN} sweeping steps`);
    assert.ok(born >= 6 * SWEEP_LEN, `${w}x${h}: ${born} particles born in 6 sweeps`);
    assert.ok(maxSpray <= sprayCap(g) && maxSpray >= 8, `${w}x${h}: at most ${maxSpray} particles (cap ${sprayCap(g)})`);
    // drawn: the spray shows as * then x then a degree sign in red
    const f = frameAt(CYCLE * 3 + SWEEP_AT + 7, w, h);
    assert.ok(cellsWhere(f, (g2, c) => (g2 === SPARK || g2 === CROSS) && wet(c)).length >= 5, `${w}x${h}: spray is on screen mid-stroke`);
  }
  // control: with the wiper disabled nothing is thrown
  const c = stepper(120, 40, 1);
  c.st.noWiper = true;
  for (let n = 1; n <= CYCLE * 3; n++) { c.to(n); assert.equal(c.st.spray.length, 0); }
});

test('redlight (R-wiper refill): once the sweep is over the glass fills again: within 1.0 s there is again at least 70% of the rain (and of the water on the glass) it had before the sweep; at the end of the sweep it has far less; the control that never wipes stays full', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const g = geometry(w, h);
    const wedge = glassCellsOf(w, h).filter(([x, y]) => inBand(g, x, y) && !inZone(g, x, y));
    assert.ok(wedge.length > 300);
    const rows = [];
    for (const seed of [1, 7, 23]) {
      const s = stepper(w, h, seed), c = stepper(w, h, seed);
      c.st.noWiper = true;
      for (let k = 2; k <= 8; k++) {
        const n0 = CYCLE * k + SWEEP_AT, n1 = CYCLE * (k + 1), n2 = n1 + 30;
        const pre = s.to(n0).look(), preWater = waterIn(s.st, true);
        const preN = wedge.filter(([x, y]) => isRain(pre.g[y * w + x], pre.c[y * w + x])).length;
        const end = s.to(n1).look(), endN = wedge.filter(([x, y]) => isRain(end.g[y * w + x], end.c[y * w + x])).length, endWater = waterIn(s.st, true);
        const post = s.to(n2).look(), postN = wedge.filter(([x, y]) => isRain(post.g[y * w + x], post.c[y * w + x])).length, postWater = waterIn(s.st, true);
        const ctl = c.to(n1).look(), ctlN = wedge.filter(([x, y]) => isRain(ctl.g[y * w + x], ctl.c[y * w + x])).length;
        rows.push(`${w}x${h} seed ${seed} cycle ${k}: rain ${preN} -> ${endN} -> ${postN}, glass water ${preWater} -> ${endWater} -> ${postWater}, control ${ctlN}`);
        assert.ok(postN >= 0.7 * preN, rows[rows.length - 1] + ' (rain not back to 70%)');
        assert.ok(postWater >= 0.7 * preWater, rows[rows.length - 1] + ' (glass water not back to 70%)');
        assert.ok(endN <= 0.6 * preN, rows[rows.length - 1] + ' (the sweep left the glass wet)');
        assert.ok(ctlN >= 0.6 * preN, rows[rows.length - 1] + ' (the control lost rain)');
      }
    }
    console.log('redlight refill\n  ' + rows.filter((_, i) => i % 7 === 0).join('\n  '));
  }
});

// ---- R10: water on the glass, and the downpour

test('redlight (R10): water lands on the glass at LAND_RATE a cell a step (about 15 a step at 120x40, tens of times the first version), about 1 in 5 runs down and right a cell every 3 to 5 steps leaving a trail, and the pedestrian steps a column per 0.4 s', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    for (const seed of [1, 4]) {
      const s = stepper(w, h, seed), g = s.st.g;
      const area = s.st.area;
      const seen = new Map(); // entry -> { x, y, lastMove, born }
      let landed = 0, runners = 0, moves = 0;
      const gaps = [];
      for (let n = 1; n <= 1500; n++) {
        s.to(n);
        for (const d of s.st.drops) {
          let rec = seen.get(d);
          if (!rec) {
            rec = { x: d.x, y: d.y, last: n };
            seen.set(d, rec);
            if (d.kind !== 2 && n > 100) { landed++; if (d.kind === 1) runners++; }
            continue;
          }
          if (d.kind !== 2 && (d.x !== rec.x || d.y !== rec.y)) {
            assert.equal(d.y, rec.y + 1, `${w}x${h} seed ${seed}: a runner moves down one row`);
            assert.ok(d.x === rec.x || d.x === rec.x + 1, `${w}x${h} seed ${seed}: and not left (${rec.x} -> ${d.x})`);
            gaps.push(n - rec.last);
            rec.x = d.x; rec.y = d.y; rec.last = n;
            moves++;
          }
        }
      }
      const perCellStep = landed / (1400 * area);
      assert.ok(perCellStep >= 0.6 * LAND_RATE && perCellStep <= 1.05 * LAND_RATE, `${w}x${h} seed ${seed}: ${perCellStep.toFixed(5)} landings per cell per step (rate ${LAND_RATE})`);
      const perSecond = (landed / 1400) * 30;
      const oldPerSecond = 6.7; // the first version: about 6.7 drops a second
      assert.ok(perSecond >= 20 * oldPerSecond * (area / 2550) * 0.6, `${w}x${h} seed ${seed}: ${perSecond.toFixed(0)} drops a second`);
      assert.ok(runners / landed >= 0.15 && runners / landed <= 0.3, `${w}x${h} seed ${seed}: ${(100 * runners / landed).toFixed(0)}% runners (rate ${RUN_SHARE})`);
      assert.ok(moves >= 100, `${w}x${h} seed ${seed}: ${moves} runner moves`);
      // the first move comes a step early (the landing step already counts), so 2 to 5
      for (const gap of gaps) assert.ok(gap >= 2 && gap <= 5, `${w}x${h} seed ${seed}: a runner moved after ${gap} steps`);
      assert.ok(s.st.drops.some((d) => d.kind === 2 && d.gl === SLANT), 'a runner leaves ╲ trails');
      assert.ok(s.st.drops.length <= waterCap(g));
    }
  }
});

// ---- the downpour: slant, density, speed, red, highlights, gust

// The rain's mean slope in a frame: for every ╲ of the rain, the next row's ╲ one to the right, straight below, or two right (the nearest such, preferring the right)
const SLASH = (g, c) => g === SLANT && wet(c);
function meanSlope(f) {
  let sum = 0, pairs = 0;
  for (let y = 0; y < f.h - 1; y++) {
    for (let x = 0; x < f.w - 2; x++) {
      if (!SLASH(f.g[y * f.w + x], f.c[y * f.w + x])) continue;
      for (const dx of [1, 0, 2]) {
        const i = (y + 1) * f.w + x + dx;
        if (SLASH(f.g[i], f.c[i])) { sum += dx; pairs++; break; }
      }
    }
  }
  return { mean: sum / Math.max(1, pairs), pairs };
}
const slashShare = (f) => {
  let back = 0, fwd = 0;
  for (let i = 0; i < f.g.length; i++) {
    if (!wet(f.c[i])) continue;
    if (f.g[i] === SLANT) back++;
    else if (f.g[i] === cp('╱')) fwd++;
  }
  return { back, fwd, share: back / Math.max(1, back + fwd) };
};

test('redlight (R-rain-slant): the rain is one diagonal: at least 90% of its slash glyphs are the same slant, and the mean slope is within the wind\'s stated range, at 120x40 and 80x24 and at every phase of the gust', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const s = stepper(w, h);
    for (const n of [CYCLE * 4 + 30, CYCLE * 10 + 36, CYCLE * 15 + 30, CYCLE * 21 + 34, CYCLE * 32 + 30, CYCLE * 40 + 38, CYCLE * 51 + 32]) { // a wet moment of each cycle, so the gust is at all its phases
      const f = s.to(n).look();
      const sh = slashShare(f), ms = meanSlope(f);
      assert.ok(sh.back >= 40, `${w}x${h} n=${n}: ${sh.back} slashes`);
      assert.ok(sh.share >= 0.9, `${w}x${h} n=${n}: ${(sh.share * 100).toFixed(0)}% on the main slant (${sh.back} against ${sh.fwd})`);
      assert.ok(ms.pairs >= 30, `${w}x${h} n=${n}: ${ms.pairs} connected pairs`);
      assert.ok(ms.mean >= SLOPE_MIN && ms.mean <= SLOPE_MAX, `${w}x${h} n=${n}: mean slope ${ms.mean.toFixed(2)} columns a row, wind ${windSlope(n, 1).toFixed(2)}`);
      assert.ok(Math.abs(ms.mean - windSlope(n, 1)) <= 0.3, `${w}x${h} n=${n}: mean slope ${ms.mean.toFixed(2)} against the wind ${windSlope(n, 1).toFixed(2)}`);
    }
  }
  // controls: vertical sticks are not one slant at slope 1; a frame of the other slant has no main slant
  const mk = (glyphAt) => { const f = { w: 40, h: 12, g: new Uint16Array(480).fill(32), c: new Uint8Array(480) }; for (let y = 0; y < 12; y++) for (let x = 0; x < 40; x++) { const gl = glyphAt(x, y); if (gl) { f.g[y * 40 + x] = gl; f.c[y * 40 + x] = CORAL[0]; } } return f; };
  const sticks = mk((x) => (x % 5 === 0 ? SLANT : 0));
  assert.ok(meanSlope(sticks).mean < SLOPE_MIN, 'the control (vertical sticks) reads a slope under the stated range');
  const wrong = mk((x, y) => ((x + y) % 5 === 0 ? cp('╱') : 0));
  assert.ok(slashShare(wrong).share < 0.9, 'the control (the other slant) is not on the main slant');
});

test('redlight (R-rain-density): the downpour is much denser than the first version: rain covers at least 15% of the glass just before every sweep and 10% on average, never more than 40%; the first version peaked at 3% and 5%', () => {
  assert.ok(OLD.share['120x40'] < 0.06 && OLD.share['80x24'] < 0.06);
  for (const [w, h] of [[120, 40], [80, 24], [240, 67]]) {
    const cells = glassCellsOf(w, h);
    const s = stepper(w, h);
    const pre = [], all = [];
    for (let n = 200; n <= 3300; n++) {
      s.to(n);
      if (n >= RED_OFF - 40 && n <= RAIN_GREEN_BY + 40) continue; // the colour change near the lamp has its own test
      if (n % CYCLE === SWEEP_AT) pre.push(rainShare(s.look(), cells));
      else if (n % 7 === 0) all.push(rainShare(s.look(), cells));
    }
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    const min = Math.min(...pre), max = Math.max(...all, ...pre);
    console.log(`redlight rain share ${w}x${h}: before a sweep ${(min * 100).toFixed(1)}% to ${(Math.max(...pre) * 100).toFixed(1)}%, mean ${(mean * 100).toFixed(1)}%, max ${(max * 100).toFixed(1)}% (first version: peak ${(OLD.share[`${w}x${h}`] * 100 || 0).toFixed(1)}%)`);
    assert.ok(min >= 0.15, `${w}x${h}: ${(min * 100).toFixed(1)}% just before a sweep`);
    assert.ok(mean >= 0.1, `${w}x${h}: mean ${(mean * 100).toFixed(1)}%`);
    assert.ok(max <= 0.4, `${w}x${h}: ${(max * 100).toFixed(1)}% at most`);
    if (OLD.share[`${w}x${h}`]) assert.ok(min > 3 * OLD.share[`${w}x${h}`], `${w}x${h}: more than 3 times the first version's peak`);
  }
});

test('redlight (R-rain-speed): every streak head falls at least 24 cells a second along the diagonal (the first version\'s fastest thing moved 2 a second), and is on screen where the model says', () => {
  const MIN_PER_SECOND = 24;
  assert.ok(MIN_PER_SECOND > 10 * OLD.rowsPerSecond);
  assert.ok(SPEED_MIN * 30 >= MIN_PER_SECOND, `slot speeds start at ${SPEED_MIN * 30} cells a second`);
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const s = stepper(w, h, 1);
    const rates = [];
    let heads = 0, drawn = 0;
    for (const n of [400, 900, 1300, 2500, 3100]) {
      s.to(n);
      const a = s.st.slots.map((_, j) => streakOf(s.st, j, n));
      const b = s.st.slots.map((_, j) => streakOf(s.st, j, n + 10));
      a.forEach((p, j) => { if (p && b[j] && b[j].k === p.k) rates.push((b[j].y - p.y) * 3); }); // rows in one second, from a third of a second
      const f = s.look();
      a.forEach((p, j) => {
        const gg = s.st.g;
        // a head that something else is drawn over (water on the glass, the wire, the crossing, the light's street) or the blade has dried does not count
        if (!p || !onGlass(gg, p.x, p.y) || s.st.wipe[p.y * w + p.x] > n - 25 || s.st.occ[p.y * w + p.x] || inZone(gg, p.x, p.y) || p.y === gg.wireRow || (p.y >= gg.pedRow && p.y <= gg.zebraRow)) return;
        const i = p.y * w + p.x;
        heads++;
        if ((f.g[i] === SLANT || f.g[i] === SPARK) && wet(f.c[i])) drawn++;
      });
    }
    assert.ok(rates.length > 100, `${rates.length} heads followed`);
    assert.ok(Math.min(...rates) >= MIN_PER_SECOND - 1, `${w}x${h}: the slowest head fell ${Math.min(...rates)} rows in a second`);
    assert.ok(Math.max(...rates) <= 52, `${w}x${h}: and the fastest ${Math.max(...rates)}`);
    assert.ok(heads > 40 && drawn >= 0.85 * heads, `${w}x${h}: ${drawn} of ${heads} heads are drawn where the model puts them`);
  }
});

test('redlight (R-red): before 58 s the rain is all coral; after the light goes green only the rain near the lamp is mint, the far rain stays coral; the falloff is in whole shade steps', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const g = geometry(w, h);
    const tint = (x, y) => tintLevel(g, x, y);
    const s = stepper(w, h);
    for (const n of [CYCLE * 4 + 34, CYCLE * 12 + 34, CYCLE * 20 + 34, CYCLE * 24 + 34]) {
      const f = s.to(n).look();
      const rain = cellsWhere(f, (gl, c) => isRain(gl, c));
      assert.ok(rain.length > 200, `${w}x${h} n=${n}: ${rain.length} rain cells`);
      const red = rain.filter(([x, y]) => CORAL.includes(f.c[y * w + x])).length;
      assert.ok(red >= 0.9 * rain.length, `${w}x${h} n=${n}: ${red} of ${rain.length} rain cells are coral`);
      assert.equal(rain.filter(([x, y]) => MINT.includes(f.c[y * w + x])).length, 0, `${w}x${h} n=${n}: no green before 58 s`);
    }
    const tot = { inner: 0, ring: 0, far: 0 };
    for (const n of [CYCLE * 26 + 34, CYCLE * 27 + 34, CYCLE * 28 + 34, CYCLE * 30 + 34, CYCLE * 31 + 34, CYCLE * 40 + 34, CYCLE * 45 + 34, CYCLE * 60 + 34]) { // 60.5 s on
      assert.ok(n > RAIN_GREEN_BY + 6);
      const f = s.to(n).look();
      const rain = cellsWhere(f, (gl, c) => isRain(gl, c) && gl !== SPARK);
      const inner = rain.filter(([x, y]) => tint(x, y) === 2), ring = rain.filter(([x, y]) => tint(x, y) === 1), far = rain.filter(([x, y]) => tint(x, y) === 0);
      tot.inner += inner.length; tot.ring += ring.length; tot.far += far.length;
      for (const [x, y] of inner) assert.ok(MINT.includes(f.c[y * w + x]), `${w}x${h} n=${n}: rain at ${x},${y} inside the lamp's reach is colour ${f.c[y * w + x]}`);
      for (const [x, y] of ring) assert.ok(MINT.includes(f.c[y * w + x]), `${w}x${h} n=${n}: rain in the ring at ${x},${y} is colour ${f.c[y * w + x]}`);
      for (const [x, y] of far) assert.ok(CORAL.includes(f.c[y * w + x]), `${w}x${h} n=${n}: far rain at ${x},${y} is colour ${f.c[y * w + x]}`);
      // whole shade steps: the ring is one shade lower than the inside for the same glyph and kind of rain
      for (let shade = 0; shade <= 3; shade++) {
        const inside = shownColour({ g, seed: 1 }, g.tint[0], g.tint[1], n, shade), outer = shownColour({ g, seed: 1 }, g.tint[0] + Math.ceil(g.tint[2] * 1.3), g.tint[1], n, shade);
        assert.equal(inside, MINT[shade]);
        assert.equal(outer, MINT[Math.max(0, shade - 1)]);
      }
    }
    assert.ok(tot.inner >= 40 && tot.ring >= 80 && tot.far >= 1000, `${w}x${h}: ${tot.inner} inside, ${tot.ring} in the ring, ${tot.far} far (over 8 frames)`);
    // the picture before the change near the lamp is red: control for the checks above
    const before = frameAt(1730, w, h);
    assert.ok(cellsWhere(before, (gl, c) => isRain(gl, c)).filter(([x, y]) => tint(x, y) === 2).every(([x, y]) => CORAL.includes(before.c[y * w + x])));
  }
});

// The rain near the lamp goes red, then dark, then green. A cell may not jump from one straight to the other under a kept glyph: it is dark for at least 8 steps (longer than a 4x frame, 6.7 steps)
function darkGapOk(seq) { // seq: 'r' red, 'd' dark, 'g' green, one per step
  const runs = [];
  for (const ch of seq) if (runs.length && runs[runs.length - 1][0] === ch) runs[runs.length - 1][1]++; else runs.push([ch, 1]);
  const kinds = runs.map((r) => r[0]).join('');
  if (kinds !== 'rdg') return false;
  return runs[1][1] >= 8;
}

test('redlight (R-green gap): every cell of rain near the lamp goes red, then dark for at least 8 steps, then green; no cell changes colour in place; far cells never change', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const st = redlight.init(w, h, 1), g = st.g;
    const [cx, cy, rx, ry] = g.tint;
    let near = 0, far = 0;
    for (let y = g.gTop; y < g.hoodTop; y++) {
      for (let x = 0; x < w; x++) {
        if (!onGlass(g, x, y)) continue;
        const lvl = tintLevel(g, x, y);
        const seq = [];
        for (let n = RED_OFF - 20; n <= RAIN_GREEN_BY + 20; n++) {
          const c = shownColour(st, x, y, n, 1);
          seq.push(c < 0 ? 'd' : CORAL.includes(c) ? 'r' : MINT.includes(c) ? 'g' : '?');
        }
        const text = seq.join('');
        if (lvl === 0) { assert.ok(/^r+$/.test(text), `${w}x${h} far cell ${x},${y} changed: ${text}`); far++; } else { assert.ok(darkGapOk(text), `${w}x${h} cell ${x},${y}: ${text}`); near++; }
      }
    }
    assert.ok(near > 200 && far > 500, `${near} near and ${far} far cells`);
    assert.ok(cx === g.cx && Math.abs(cy - g.ly) < 1e-9 && rx > 0 && ry > 0);
    // the rule bites: red straight to green fails it, and so does a 5-step dark gap
    assert.ok(!darkGapOk('rrrrgggg'), 'control: red straight to green');
    assert.ok(!darkGapOk('rrrdddddggg'), 'control: dark for 5 steps');
    assert.ok(darkGapOk('rrrdddddddddggg'));
    assert.ok(GREEN_ON + GREEN_LAG - RED_OFF - GAP_JITTER >= 8, 'the gap is longer than a 4x frame whatever the cell\'s delay');
  }
});

test('redlight (R-highlights): the brightest coral is for a few highlights: coral.3 is at most 1.5% of the cells and coral.2 and 3 together at most 5% in every frame of 90 s, at both speeds and all three sizes; highlights exist', () => {
  for (const [w, h] of SHIPPED) {
    let max3 = 0, max23 = 0, spark3 = 0, mid = null;
    const n = w * h;
    walk(w, h, 90, (a, b) => {
      let c3 = 0, c2 = 0, sp = 0;
      for (let i = 0; i < b.g.length; i++) {
        if (b.c[i] === CORAL[3]) { c3++; if (b.g[i] === SPARK) sp++; } else if (b.c[i] === CORAL[2]) c2++;
      }
      if (c3 / n > max3) max3 = c3 / n;
      if ((c3 + c2) / n > max23) max23 = (c3 + c2) / n;
      if (sp > spark3) spark3 = sp;
      if (!mid) mid = { c3, c2 };
    });
    console.log(`redlight highlights ${w}x${h}: coral.3 at most ${(max3 * 100).toFixed(2)}%, coral.2+3 at most ${(max23 * 100).toFixed(2)}%, most hot sparks at once ${spark3}`);
    assert.ok(max3 <= 0.015, `${w}x${h}: coral.3 ${(max3 * 100).toFixed(2)}%`);
    assert.ok(max23 <= 0.05, `${w}x${h}: coral.2+3 ${(max23 * 100).toFixed(2)}%`);
    assert.ok(spark3 >= 3, `${w}x${h}: only ${spark3} hot sparks at most`);
  }
  // control: the limit means something: if every rain cell were coral.3 the share would be far over it
  const f = frameAt(900, 120, 40);
  assert.ok(cellsWhere(f, (g, c) => isRain(g, c)).length / (120 * 40) > 0.1, 'a tenth of the screen is rain, so a rain of coral.3 would break the 1.5% bound');
});

test('redlight (R-gust): the wind gusts slowly: the slope varies over the stated range and never reverses, the density and the length breathe too, none of it changes brightness', () => {
  for (const seed of [1, 2, 3]) {
    let lo = 9, hi = -9, maxStep = 0, turns = 0, prev = windSlope(0, seed), dir = 0;
    for (let n = 1; n <= 5400; n++) {
      const v = windSlope(n, seed);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
      maxStep = Math.max(maxStep, Math.abs(v - prev));
      const d = Math.sign(v - prev);
      if (d !== 0 && d !== dir) { if (dir !== 0) turns++; dir = d; }
      prev = v;
    }
    assert.ok(lo >= SLOPE_MIN && hi <= SLOPE_MAX, `seed ${seed}: slope ${lo.toFixed(2)} to ${hi.toFixed(2)} outside ${SLOPE_MIN}-${SLOPE_MAX}`);
    assert.ok(lo > 0, 'the slope never reverses');
    assert.ok(hi - lo >= 0.2, `seed ${seed}: it only varies by ${(hi - lo).toFixed(2)}`);
    assert.ok(maxStep < 0.01, `seed ${seed}: a step of ${maxStep.toFixed(4)} is not slow`);
    assert.ok(turns >= 8, `seed ${seed}: ${turns} turns in 3 minutes`);
    const dens = [], lens = [];
    for (let n = 0; n <= 5400; n += 10) { dens.push(densityAt(n, seed)); lens.push(lengthAt(n, seed)); }
    assert.ok(Math.min(...dens) >= 0.7 && Math.max(...dens) <= 1 && Math.max(...dens) - Math.min(...dens) >= 0.1, `density ${Math.min(...dens).toFixed(2)} to ${Math.max(...dens).toFixed(2)}`);
    assert.ok(Math.min(...lens) >= 0.8 && Math.max(...lens) <= 1.2 && Math.max(...lens) - Math.min(...lens) >= 0.2, `length ${Math.min(...lens).toFixed(2)} to ${Math.max(...lens).toFixed(2)}`);
  }
  // the rendered slope follows the wind: the mean slope of the picture moves with it, and the colours of the rain are the same four shades at every phase of the gust
  const s = stepper(120, 40);
  const seen = [];
  const colours = new Set();
  for (let n = 300; n <= 1700; n += 100) {
    const f = s.to(n).look();
    seen.push(meanSlope(f).mean);
    for (const [x, y] of cellsWhere(f, (g, c) => isRain(g, c))) colours.add(f.c[y * 120 + x]);
  }
  assert.ok(Math.max(...seen) - Math.min(...seen) >= 0.12, `the picture's slope moves by only ${(Math.max(...seen) - Math.min(...seen)).toFixed(2)}`);
  assert.ok([...colours].every((c) => CORAL.includes(c)), `colours in the rain: ${[...colours]}`);
});

// ---- bounded and cheap

test('redlight (R-bounded): 20,000 steps keep the state under the caps: the water on the glass, the spray and the slots stay under the area-based limits and no array or grid grows', () => {
  for (const [w, h] of SHIPPED) {
    const s = stepper(w, h);
    const g = s.st.g;
    const lens = (st) => Object.entries(st).filter(([, v]) => Array.isArray(v) || ArrayBuffer.isView(v)).map(([k, v]) => k + ':' + (ArrayBuffer.isView(v) ? v.length : '')).join(',');
    const fixed = lens(s.st);
    const slots = s.st.slots.length;
    let maxWater = 0, maxSpray = 0;
    for (let n = 1; n <= 20000; n++) {
      s.to(n);
      if (s.st.drops.length > maxWater) maxWater = s.st.drops.length;
      if (s.st.spray.length > maxSpray) maxSpray = s.st.spray.length;
      if (n % 2500 === 0) { assert.equal(lens(s.st), fixed, `${w}x${h} n=${n}: a grid changed size`); assert.equal(s.st.slots.length, slots); }
    }
    assert.ok(maxWater <= waterCap(g), `${w}x${h}: ${maxWater} drops (cap ${waterCap(g)})`);
    assert.ok(maxSpray <= sprayCap(g), `${w}x${h}: ${maxSpray} particles (cap ${sprayCap(g)})`);
    assert.ok(slots <= Math.round(s.st.area * AIR_PER_CELL * 1.25) + 8, `${w}x${h}: ${slots} slots for ${s.st.area} cells of glass`);
    assert.ok(maxWater > 50 && maxSpray >= 8, `${w}x${h}: the sim did run (${maxWater} drops, ${maxSpray} particles)`);
    assert.ok(s.st.occ.reduce((a, b) => a + b, 0) === s.st.drops.length, `${w}x${h}: the occupancy grid matches the water on the glass`);
    // after 20,000 steps the picture is still a picture
    const f = s.to(20000 - (20000 % CYCLE) + CYCLE + SWEEP_AT).look();
    for (let i = 0; i < f.g.length; i++) assert.ok(isAllowedGlyph(f.g[i]) && f.c[i] < COUNT);
    assert.ok(rainShare(f, glassCellsOf(w, h)) > 0.15);
  }
});

test('redlight (R-cost): a step and a draw at 240x67 stay cheap (under 12 ms together, averaged over 600 steps; a scan of every cell for every cell is far over it)', () => {
  const w = 240, h = 67;
  const s = stepper(w, h);
  s.to(200);
  s.look();
  const t0 = process.hrtime.bigint();
  for (let n = 201; n <= 800; n++) { redlight.step(s.st); redlight.draw(s.st, s.p); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 600;
  console.log(`redlight cost at ${w}x${h}: ${ms.toFixed(2)} ms per step and draw`);
  assert.ok(ms < 12, `${ms.toFixed(2)} ms per step and draw`);
  // control: a runaway scan (every cell against every cell) costs more than the bound
  const t1 = process.hrtime.bigint();
  let hit = 0;
  const g = s.p.glyphs;
  for (let i = 0; i < g.length; i++) for (let j = 0; j < g.length; j += 2) if (g[i] === g[j]) hit++;
  const scan = Number(process.hrtime.bigint() - t1) / 1e6;
  assert.ok(hit > 0 && scan > 12, `the control scan took ${scan.toFixed(1)} ms`);
});

test('redlight (R10): the pedestrian under the umbrella moves one column every 12 steps (0.4 s) and goes round again', () => {
  const W = 120, s = stepper(120, 40);
  let last = null, moves = 0, vanished = 0, appeared = 0, lastSeen = null; // lastSeen: was the pedestrian on screen in the last frame the wiper left alone (the lap of 1152 steps is a multiple of the wiper's cycle, so the step it leaves and re-enters at always falls in a sweep)
  const canopyX = (f) => { const c = cellsWhere(f, (g, col) => col === MAG[2]); return c.length ? Math.min(...c.map((p) => p[0])) : null; };
  for (let n = 0; n <= CYCLE * 100; n++) {
    const f = s.to(n).look();
    if (n % CYCLE >= SWEEP_AT - 1) { last = null; continue; } // the wiper may cover a cell while it sweeps (and is parked at the end of the cycle)
    const x = canopyX(f);
    if (lastSeen !== null && lastSeen !== (x !== null)) { if (x === null) vanished++; else appeared++; }
    lastSeen = x !== null;
    if (last !== null && last.n === n - 1) {
      if (x !== null && last.x !== null) {
        if (n % 12 === 0) { assert.equal(x, last.x + 1, `n=${n}: steps a column on the 12th step`); moves++; } else assert.equal(x, last.x, `n=${n}: still between steps`);
      }
    }
    last = { n, x };
  }
  assert.ok(moves >= 100, `${moves} column steps`);
  assert.ok(vanished >= 1 && appeared >= 1, 'it leaves at one side and comes round again');
});

// ---- R11

test('redlight (R11): the far buildings stand still until 62 s, then move one column left every 6 steps until the end', () => {
  const W = 120, H = 40, s = stepper(W, H);
  const solid = (g, c) => g === 32 || (g === cp('▚') && c === CORAL[0]) || (g === cp('▪') && c === TANG[0]); // the buildings are dark red now: a ▚ in coral.0, windows in tang.0
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
    assert.ok(eq > 100 && ne === 0, `n=${n}: ${eq} building cells held, ${ne} moved`);
  }
  // moving: from step 1860 the picture shifts by one column per 6 steps
  let moved0 = 0;
  for (const n0 of [1860, 1863, 1866, 1901, 2300, 2705, 3000, 4400]) {
    const a = frameAt(n0, W, H);
    const b = frameAt(n0 + 6, W, H);
    const [eq, ne] = same(a, b, 1);
    assert.ok(eq > 100 && ne === 0, `n=${n0}: after 6 steps the buildings are one column left (${ne} cells disagree)`);
    const [eq0, ne0] = same(a, b, 0);
    moved0 += ne0;
    assert.ok(eq0 + ne0 > 100, `n=${n0}: ${eq0 + ne0} cells to compare`);
    const c = frameAt(n0 + 12, W, H);
    assert.ok(same(a, c, 2)[1] === 0, `n=${n0}: two columns after 12 steps`);
  }
  assert.ok(moved0 >= 20, `control: they did move (${moved0} cells differ at no shift, over 8 frames)`);
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
    test(`redlight (R13): ${w}x${h} at ${speed}x: the worst frame changes under 25% of the cells over 90 s (the shell's own bound is 30%), and more than 1%; nothing is blank or a bright block`, () => {
      const frames = composerRun(w, h, speed, 90);
      const { worst, at: k } = worstOf(frames);
      console.log(`redlight worst frame ${w}x${h} ${speed}x: ${(worst * 100).toFixed(2)}% (frame ${k}, ${((k * speed) / FPS).toFixed(1)} s)`);
      assert.ok(worst < 0.25, `worst frame changed ${(worst * 100).toFixed(2)}%`);
      assert.ok(worst > 0.01, `and it does move (${(worst * 100).toFixed(3)}%)`);
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
  assert.ok(worstOf(frames).worst > 0.25);
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
    assert.ok(Math.max(...maxDrops) <= waterCap(s.st.g), `${w}x${h}: ${Math.max(...maxDrops)} drops`);
    const f = s.look();
    for (let i = 0; i < f.g.length; i++) assert.ok(isAllowedGlyph(f.g[i]) && f.c[i] < COUNT);
  }
});
