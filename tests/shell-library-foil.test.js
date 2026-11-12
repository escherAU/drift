// DRIFT-7 C12: the foil label on the shelf. The pass (foil.js applyFoil, called from drawShelf) turns the label cells of a foil
// cartridge into full-colour cells AFTER the card is drawn: fg = safeHue(ramp hue, lightness of the ink level's colour), bg =
// PALETTE_BG, shade = RGB_CELL. Brightness comes only from the ink level; only the hue moves. These tests drive drawLibrary /
// drawShelf directly with an exact idle clock (the shell's own flow is in foil-flash.test.js and foil-bandwidth.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { driftmanSkin } from '../src/shell/driftman.js';
import {
  drawLibrary, drawShelf, shelfLayout, idleSignature, makeLibraryMemo, ledLevelAt, cursorShadeAt, scanAt, rippleColAt, hasWater,
  CART_W, CART_H, LABEL_W, LABEL_H,
} from '../src/shell/library.js';
import { libraryPalette } from '../src/shell/shell.js';
import { FOIL_STYLES, FOIL_MIN_HUES, FOIL_MAX_HUES } from '../src/cartridge/schema.js';
import * as foilModule from '../src/shell/foil.js';
import { makeFoil, foilStep, foilTime, foilHue, foilColour, rampHue, hueOfRgb, applyFoil, FOIL_STEPS_PER_SECOND, RGB_CELL, PALETTE_BG } from '../src/shell/foil.js';
import { relY, safeHue } from '../src/pixels.js';
import { parseHex, shadeRGB } from '../src/color.js';
import { discoverCartridges } from '../src/cartridge/loader.js';
import { newFrame } from '../src/shell/ui.js';
import { foilRoot, SAM_HUES } from './helpers-foil.js';

const TINT_LEVELS = [4, 8, 12, 15];
const skin = driftmanSkin;

// The shelf of the fixture (aaa plain, foil-a holo, foil-b sweep, zzz plain) as the view's cartridges, the way shell.js builds them.
function viewCarts(root = foilRoot(), { strip = false } = {}) {
  const d = discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
  return d.cartridges.map((c, i) => {
    const hue = parseHex(c.manifest.labelHue || '#9DB8A8');
    return {
      id: c.id, title: c.title, code: c.manifest.code || '', blurb: c.manifest.blurb, facts: c.manifest.facts || [], locked: c.locked, label: c.label, ink: c.labelInk || null, tint: 20 + 4 * i,
      foil: !strip && c.manifest.foil ? makeFoil(c.manifest.foil, TINT_LEVELS.map((lv) => shadeRGB(hue, lv))) : undefined,
    };
  });
}
const CARTS = viewCarts();
const PLAIN = viewCarts(foilRoot({ withFoil: false }), { strip: true });
const IDX = { aaa: 0, 'foil-a': 1, 'foil-b': 2, zzz: 3 };
const view = (index, idle, over = {}, carts = CARTS) => ({ cartridges: carts, index, prev: index, slide: 1, message: '', dip: 0, idle, ...over });
const draw = (cols, rows, v) => { const f = newFrame(cols, rows); drawLibrary(f, v, skin); return f; };
const clone = (f) => ({ ...f, glyphs: f.glyphs.slice(), shades: f.shades.slice(), fg: f.fg.slice(), bg: f.bg.slice() });
const labelCells = (f, x0, y0) => {
  const out = [];
  for (let y = 0; y < LABEL_H; y++) for (let x = 0; x < LABEL_W; x++) out.push({ x, y, i: (y0 + 3 + y) * f.cols + x0 + 3 + x });
  return out;
};
const seatOf = (cols, rows, tier) => { const L = shelfLayout(cols, rows, tier); return { x: L.cartX, y: L.cartTop, L }; };
const sameCell = (a, b, i) => a.glyphs[i] === b.glyphs[i] && a.shades[i] === b.shades[i] && (a.shades[i] !== RGB_CELL || (a.fg[i] === b.fg[i] && a.bg[i] === b.bg[i]));
const rectSame = (a, b, x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (!sameCell(a, b, y * a.cols + x)) return false; return true; };
const clockOf = (step) => step / FOIL_STEPS_PER_SECOND + 0.01; // inside step `step`

// ---- the pieces

test('foil.js: the styles and hue counts are the one definition in the schema', () => {
  assert.deepEqual([foilModule.FOIL_STYLES.slice(), foilModule.FOIL_MIN_HUES, foilModule.FOIL_MAX_HUES], [FOIL_STYLES.slice(), FOIL_MIN_HUES, FOIL_MAX_HUES]);
  assert.deepEqual(foilModule.FOIL_STYLES.slice(), ['sweep', 'holo']);
});

test('foil.js: hue of a colour is its OKLCH angle (the ion cyan sits near 200 degrees); a grey reads as 0', () => {
  const h = hueOfRgb(0x3fe8ff);
  assert.ok(h > 195 && h < 215, String(h));
  assert.equal(hueOfRgb(0x808080), 0);
  assert.equal(hueOfRgb([0x3f, 0xe8, 0xff]), h);
  for (const c of [0xff0000, 0x00ff00, 0x0000ff, 0xffd36b]) { const v = hueOfRgb(c); assert.ok(v >= 0 && v < 360); }
});

test('foil.js: the ramp is cyclic through the hues, each blend along the shorter arc, pure in the phase', () => {
  const hues = [10, 130, 250];
  assert.equal(rampHue(hues, 0), 10);
  assert.ok(Math.abs(rampHue(hues, 1 / 3) - 130) < 1e-9);
  assert.ok(Math.abs(rampHue(hues, 2 / 3) - 250) < 1e-9);
  assert.equal(rampHue(hues, 1), rampHue(hues, 0), 'the ramp wraps');
  assert.ok(Math.abs(rampHue(hues, 1 / 6) - 70) < 1e-9, 'midway between 10 and 130');
  assert.ok(Math.abs(rampHue(hues, 5 / 6) - 310) < 1e-9, 'last hue back to the first: 250 -> 370 is the short way');
  assert.equal(rampHue(hues, -1 / 3 + 1), rampHue(hues, 2 / 3), 'negative phases wrap');
  // 350 -> 10 goes through 0, not back through 180
  assert.ok(Math.abs((((rampHue([350, 10], 0.25) % 360) + 360) % 360) - 0) < 1e-9);
  assert.deepEqual([0, 0.123, 0.5, 0.9].map((p) => rampHue(hues, p)), [0, 0.123, 0.5, 0.9].map((p) => rampHue(hues, p)));
});

test('foil.js: the styles are the rules in the ruling: holo frac((x + 2y) / 30 - t / 5), sweep frac(x / 24 - t / 4)', () => {
  const foil = makeFoil({ hues: SAM_HUES, style: 'holo' }, [[10, 10, 10], [20, 20, 20], [30, 30, 30], [40, 40, 40]]);
  const sweep = makeFoil({ hues: SAM_HUES, style: 'sweep' }, [[10, 10, 10], [20, 20, 20], [30, 30, 30], [40, 40, 40]]);
  for (const [x, y, t] of [[0, 0, 0], [5, 3, 1 / 6], [23, 9, 2.5], [12, 4, 4.833333333333333], [7, 0, 5]]) {
    assert.ok(Math.abs(foilHue(foil, x, y, t) - rampHue(foil.hues, (x + 2 * y) / 30 - t / 5)) < 1e-9, `holo ${x},${y},${t}`);
    assert.ok(Math.abs(foilHue(sweep, x, y, t) - rampHue(sweep.hues, x / 24 - t / 4)) < 1e-9, `sweep ${x},${y},${t}`);
  }
  // holo: the band repeats every 5 s, sweep every 4 s
  for (const t of [0, 1 / 6, 2.5]) { assert.equal(foilHue(foil, 9, 4, t), foilHue(foil, 9, 4, t + 5)); assert.equal(foilHue(sweep, 9, 4, t), foilHue(sweep, 9, 4, t + 4)); }
  // holo is diagonal: cells with the same x + 2y share a hue; sweep depends on x alone
  assert.equal(foilHue(foil, 8, 1, 0.5), foilHue(foil, 6, 2, 0.5));
  assert.equal(foilHue(sweep, 8, 1, 0.5), foilHue(sweep, 8, 9, 0.5));
  // the hues are the OKLCH angles of the manifest colours
  assert.deepEqual(foil.hues.slice(), SAM_HUES.map((h) => hueOfRgb(parseInt(h.slice(1), 16))));
});

test('foil.js: time is quantised to 6 steps a second: floor(clock * 6) / 6, and a clock built from frame times stays on its step', () => {
  assert.equal(FOIL_STEPS_PER_SECOND, 6);
  assert.deepEqual([0, 0.1, 0.1666, 0.17, 0.3, 0.34, 1, 5].map(foilStep), [0, 0, 0, 1, 1, 2, 6, 30]);
  assert.equal(foilStep(-3), 0);
  assert.equal(foilStep(NaN), 0);
  assert.equal(foilTime(0.34), 2 / 6);
  let clock = 0;
  for (let k = 0; k < 18 * 7; k++) { clock += 1 / 18; if ((k + 1) % 3 === 0) assert.equal(foilStep(clock), (k + 1) / 3, `frame ${k + 1}`); }
});

test('foil.js: the lightness handed to safeHue is the cube root of the luminance of the ink level colour, so a foil cell shows that level\'s brightness', () => {
  const levels = TINT_LEVELS.map((lv) => shadeRGB(parseHex('#7FB069'), lv));
  const foil = makeFoil({ hues: SAM_HUES, style: 'holo' }, levels);
  assert.equal(foil.L.length, 4);
  for (let lv = 0; lv < 4; lv++) {
    const y = relY(((levels[lv][0] << 16) | (levels[lv][1] << 8) | levels[lv][2]) >>> 0);
    assert.ok(Math.abs(foil.L[lv] ** 3 - y) < 1e-12, `level ${lv}`);
  }
  assert.ok(foil.L[0] < foil.L[1] && foil.L[1] < foil.L[2] && foil.L[2] < foil.L[3]);
  assert.throws(() => { foil.L[0] = 1; foil.hues.push(1); }, TypeError, 'frozen');
});

test('foil.js: every hue at every level is a red-safe colour on the 2-bit grid (linear red share at most 0.75, never a saturated red); Sam\'s five hues are measured', () => {
  const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const share = (c) => { const r = lin((c >>> 16) & 255), g = lin((c >>> 8) & 255), b = lin(c & 255); return r / (r + g + b); };
  let worst = 0;
  for (let h = 0; h < 360; h += 1) for (const L of [0.375, 0.5, 0.63, 0.71, 0.92]) {
    const c = safeHue(h, L);
    assert.equal(c & 0x030303, 0, 'on the 6-bit grid');
    worst = Math.max(worst, share(c));
  }
  assert.ok(worst <= 0.75 + 1e-9, 'worst red share ' + worst);
  // the ruling asks every hue to have a red share of 0.57 or less; safeHue's own ceiling is 0.75, and the foil shows safeHue's colour
  const samIn = SAM_HUES.map((h) => share(parseInt(h.slice(1), 16)));
  assert.ok(samIn.every((s) => s <= 0.57), 'Sam\'s input hues: ' + samIn.map((s) => s.toFixed(3)).join(' '));
  console.log(`foil red share: safeHue worst over 360 hues x 5 levels ${worst.toFixed(3)}; Sam's hues as written ${samIn.map((s) => s.toFixed(3)).join(' ')}`);
});

// ---- the label cells

test('label: at 120x40 every label cell of the selected card is a full-colour cell with the palette background; glyphs and the rest of the card are untouched', () => {
  const sel = IDX['foil-a'];
  const { x, y, L } = seatOf(120, 40, 'full');
  assert.equal(L.cartX, 45);
  const withFoil = draw(120, 40, view(sel, clockOf(7))), plain = draw(120, 40, view(sel, clockOf(7), {}, PLAIN));
  const nb = shelfLayout(120, 40, 'full').step; // the foil neighbour on the right (foil-b) is a foil card too
  const cells = new Set([...labelCells(withFoil, x, y), ...labelCells(withFoil, x + nb, y)].map((c) => c.i));
  for (const c of labelCells(withFoil, x, y)) {
    assert.equal(withFoil.shades[c.i], RGB_CELL, `cell ${c.x},${c.y}`);
    assert.equal(withFoil.bg[c.i], PALETTE_BG);
    assert.equal(withFoil.glyphs[c.i], plain.glyphs[c.i]);
  }
  // everywhere else the two frames are the same cell for cell (a foil changes the label and nothing else)
  for (let i = 0; i < withFoil.glyphs.length; i++) {
    if (cells.has(i)) continue;
    assert.ok(sameCell(withFoil, plain, i), `cell ${i % 120},${Math.floor(i / 120)} outside the label`);
  }
});

test('label: brightness is the ink level\'s and only that: relative luminance of fg is constant across 5 s of steps while the hue moves (>= 2 hues per cell, all 4 levels)', () => {
  const sel = IDX['foil-a'];
  const { x, y } = seatOf(120, 40, 'full');
  const foil = CARTS[sel].foil;
  const plain = draw(120, 40, view(sel, 1, {}, PLAIN));
  const cells = labelCells(plain, x, y);
  const lvOf = (c) => plain.shades[c.i] - CARTS[sel].tint;
  assert.deepEqual([...new Set(cells.map(lvOf))].sort(), [0, 1, 2, 3], 'the fixture uses all four ink levels');
  const seen = new Map(cells.map((c) => [c.i, new Set()])), yOf = new Map(cells.map((c) => [c.i, []]));
  let prev = null, minChanged = Infinity, maxChanged = 0;
  const STEPS = 30; // 5 s
  for (let k = 0; k < STEPS; k++) {
    const f = draw(120, 40, view(sel, clockOf(k)));
    let changed = 0;
    for (const c of cells) {
      const fg = f.fg[c.i];
      seen.get(c.i).add(fg);
      yOf.get(c.i).push(relY(fg));
      assert.equal(f.shades[c.i], RGB_CELL);
      if (prev && prev.fg[c.i] !== fg) changed++;
    }
    if (prev) { minChanged = Math.min(minChanged, changed); maxChanged = Math.max(maxChanged, changed); }
    prev = f;
  }
  let worstSpread = 0, worstOff = 0;
  for (const c of cells) {
    const target = foil.L[lvOf(c)] ** 3, ys = yOf.get(c.i);
    worstOff = Math.max(worstOff, ...ys.map((v) => Math.abs(v - target)));
    worstSpread = Math.max(worstSpread, Math.max(...ys) - Math.min(...ys));
    assert.ok(seen.get(c.i).size >= 2, `cell ${c.x},${c.y} saw ${seen.get(c.i).size} colour(s)`);
  }
  // safeHue's luminance is L^3 to within the 6-bit grid: the largest miss over 360 hues and these levels is under 0.012, 8x under the meter's 0.10 swing
  assert.ok(worstOff < 0.02, 'luminance off the level target by ' + worstOff);
  assert.ok(worstSpread < 0.02, 'luminance spread across the animation ' + worstSpread);
  assert.ok(minChanged >= 40, `holo changes only ${minChanged} of 240 label cells in the quietest step`);
  console.log(`foil label 120x40 holo: fg changes per step ${minChanged}..${maxChanged} of 240; luminance off target at most ${worstOff.toFixed(4)}, spread at most ${worstSpread.toFixed(4)}`);
  // the control: a brightness that moves with time is caught by the same measure
  const wobble = { ...foil, L: [0, 1, 2, 3].map(() => 0) };
  const bad = [];
  for (let k = 0; k < 4; k++) { wobble.L = foil.L.map((v) => Math.min(0.9, Math.max(0.1, v + (k % 2 ? 0.2 : -0.2)))); bad.push(relY(foilColour(wobble, 2, 5, 5, k / 6))); }
  assert.ok(Math.max(...bad) - Math.min(...bad) > 0.05, 'the spread measure bites on a foil that modulates its lightness');
});

test('label: sweep colours depend on the column and the ink level only; holo on x + 2y and the level (the styles are what they say, in the frame)', () => {
  const { x, y } = seatOf(120, 40, 'full');
  for (const [name, style, key] of [['foil-b', 'sweep', (c) => c.x], ['foil-a', 'holo', (c) => c.x + 2 * c.y]]) {
    const sel = IDX[name];
    assert.equal(CARTS[sel].foil.style, style);
    const f = draw(120, 40, view(sel, clockOf(11)));
    const plain = draw(120, 40, view(sel, 1, {}, PLAIN));
    const byKey = new Map();
    for (const c of labelCells(f, x, y)) {
      const k = key(c) + '/' + (plain.shades[c.i] - CARTS[sel].tint);
      if (byKey.has(k)) assert.equal(f.fg[c.i], byKey.get(k), `${style} ${k}`);
      byKey.set(k, f.fg[c.i]);
    }
    assert.ok(byKey.size > 24);
  }
});

test('shimmer: 6 steps a second on the selected card at rest: clock 0.00 and 0.10 look the same, 0.17 is different, and a whole step looks the same throughout', () => {
  const sel = IDX['foil-a'];
  const { x, y } = seatOf(120, 40, 'full');
  const at = (clock) => draw(120, 40, view(sel, clock));
  const rect = (a, b) => rectSame(a, b, x, y, CART_W, CART_H);
  assert.equal(rect(at(0.00001), at(0.10)), true, '0.00 and 0.10');
  assert.equal(rect(at(0.10), at(0.17)), false, '0.10 and 0.17 differ');
  // idle 0 (not yet at rest) is step 0 as well
  assert.equal(rectSame(at(0), at(0.10), x, y + 3, CART_W, 10), true, 'the label at idle 0 is step 0');
  // inside every step of 20 s the label does not change; across every step edge it does
  for (let k = 0; k < 120; k++) {
    const a = at(k / 6 + 0.002), b = at((k + 1) / 6 - 0.002), c = at((k + 1) / 6 + 0.002);
    assert.equal(rectSame(a, b, x + 3, y + 3, LABEL_W, LABEL_H), true, `step ${k} is steady`);
    assert.equal(rectSame(b, c, x + 3, y + 3, LABEL_W, LABEL_H), false, `step ${k} -> ${k + 1} changes the label`);
  }
});

test('neighbours: a foil neighbour shows the foil still (frozen at t = 0), at its own dimmer level, whatever the clock; the selected card moves', () => {
  const sel = IDX['foil-a'];
  const { x, y, L } = seatOf(120, 40, 'full');
  const nbX = x + L.step; // foil-b, the card on the right
  const times = [0, 0.4, 1.01, 3.3, 5.0, 17.77];
  const frames = times.map((t) => draw(120, 40, view(sel, t)));
  const foil = CARTS[IDX['foil-b']].foil;
  // the neighbour card's rect (the whole 30x18) is identical in every frame
  for (const f of frames.slice(1)) assert.equal(rectSame(frames[0], f, nbX, y, CART_W, CART_H), true);
  // and what it shows is the t = 0 foil at the dim level
  const plain = draw(120, 40, view(sel, 1, {}, PLAIN));
  let dimmer = 0;
  for (const c of labelCells(frames[0], nbX, y)) {
    const lv = plain.shades[c.i] - CARTS[IDX['foil-b']].tint;
    assert.ok(lv >= 0 && lv <= 1, 'a neighbour is at level 1 at most: ink level ' + lv);
    assert.equal(frames[0].shades[c.i], RGB_CELL);
    assert.equal(frames[0].fg[c.i], foilColour(foil, lv, c.x, c.y, 0));
    dimmer++;
  }
  assert.equal(dimmer, 240);
  // the neighbour is dimmer than the selected card: its brightest cell is below the selected's brightest
  const maxY = (f, x0) => Math.max(...labelCells(f, x0, y).map((c) => relY(f.fg[c.i])));
  assert.ok(maxY(frames[0], nbX) < maxY(frames[0], x) - 0.1, 'neighbour brightest ' + maxY(frames[0], nbX) + ' vs selected ' + maxY(frames[0], x));
  // the selected card does move
  assert.equal(rectSame(frames[0], frames[3], x + 3, y + 3, LABEL_W, LABEL_H), false);
  // the same at 240x67 (extra-large: two whole neighbours each side), for each neighbour that has a foil
  const big = [0, 3.3, 9.9].map((t) => draw(240, 67, view(sel, t)));
  const B = seatOf(240, 67, 'full');
  for (const dx of [-2, -1, 1, 2]) for (const f of big.slice(1)) assert.equal(rectSame(big[0], f, B.x + dx * B.L.step, B.y, CART_W, CART_H), true, 'neighbour at ' + dx);
  assert.equal(rectSame(big[0], big[1], B.x + 3, B.y + 3, LABEL_W, LABEL_H), false, 'selected moves at 240x67');
});

test('only the selected card at REST shimmers: not while the shelf slides, not in the insert steps, not with the dip (all draw the foil at t = 0)', () => {
  const sel = IDX['foil-a'];
  const f0 = (v, o = {}) => { const f = newFrame(120, 40); drawShelf(f, { tier: 'full', ...v }, skin, o); return f; };
  const labelColours = (f) => {
    const out = [];
    for (let i = 0; i < f.glyphs.length; i++) if (f.shades[i] === RGB_CELL) out.push(i, f.fg[i]);
    return out.join(',');
  };
  // sliding (slide < 1 with a different prev): two clocks, the same picture of the foil
  const moving = (idle) => labelColours(f0(view(sel, idle, { prev: IDX.aaa, slide: 0.4 })));
  assert.equal(moving(1.0), moving(7.3));
  assert.equal(moving(1.0), labelColours(f0(view(sel, 0, { prev: IDX.aaa, slide: 0.4 }))));
  // control: the same two clocks at rest differ
  assert.notEqual(labelColours(f0(view(sel, 1.0))), labelColours(f0(view(sel, 7.3))));
  // the insert steps: lift, drop, dissolve, spread, a sweep and a console takeover all draw t = 0
  for (const o of [{ lift: 1 }, { drop: 2 }, { fadeP: 0.3 }, { spread: 3 }, { sweep: { x: 40, style: {}, band: { w: 4, style: {} } } }, { body: { shade: 7 } }]) {
    assert.equal(labelColours(f0(view(sel, 1.0), o)), labelColours(f0(view(sel, 7.3), o)), JSON.stringify(o));
  }
  // the dip (a locked card pressed down) is not rest either
  assert.equal(labelColours(f0(view(sel, 1.0, { dip: 1 }))), labelColours(f0(view(sel, 7.3, { dip: 1 }))));
});

test('locked: a locked cartridge never gets a foil, even if its view entry carries one (and the schema refuses it for real: foil-schema.test.js)', () => {
  const carts = CARTS.map((c, i) => (i === IDX['foil-a'] ? { ...c, locked: true } : c));
  for (const [cols, rows] of [[120, 40], [80, 24]]) {
    const f = draw(cols, rows, { ...view(IDX['foil-a'], 3.3, {}, carts) });
    for (let i = 0; i < f.glyphs.length; i++) if (f.shades[i] === RGB_CELL) {
      // a full-colour cell, if any, must belong to a foil neighbour, never the locked card
      const x = i % cols, yy = Math.floor(i / cols), s = seatOf(cols, rows, cols >= 88 ? 'full' : 'compact');
      assert.ok(!(x >= s.x && x < s.x + CART_W && yy >= s.y && yy < s.y + CART_H), `locked selected card has a full-colour cell at ${x},${yy}`);
    }
  }
  assert.doesNotMatch(idleSignature(3.3, carts[IDX['foil-a']], 'full'), /foil/);
});

// ---- the tiers: where the label is drawn

test('tiers: full and extra-large draw the label of the selected card at the centre cartridge (neighbours ±34 columns, foil frozen); compact draws one card at the left; list and tiny draw no label art and no foil', () => {
  const sel = IDX['foil-a'];
  const count = (f) => { let n = 0; for (let i = 0; i < f.shades.length; i++) if (f.shades[i] === RGB_CELL) n++; return n; };
  // full 120x40: the selected 240 plus the foil neighbour (foil-b, to the right) 240
  const full = draw(120, 40, view(sel, 3.3));
  assert.equal(count(full), 480);
  // extra-large 240x67: selected + the neighbours that carry a foil. Order aaa foil-a foil-b zzz: -1 aaa (plain), +1 foil-b, +2 zzz (plain)
  const xl = draw(240, 67, view(sel, 3.3));
  assert.equal(shelfLayout(240, 67, 'full').xl, true);
  assert.equal(count(xl), 480);
  // compact 80x24: one cartridge on the left, the label at its window; no neighbours
  const comp = draw(80, 24, view(sel, 3.3));
  const C = seatOf(80, 24, 'compact');
  assert.equal(count(comp), 240);
  for (const c of labelCells(comp, C.x, C.y)) assert.equal(comp.shades[c.i], RGB_CELL);
  // list tier (60x14, 41x11) and tiny: text only
  for (const [cols, rows] of [[60, 14], [41, 11], [40, 10], [30, 8]]) {
    const f = draw(cols, rows, view(sel, 3.3));
    assert.equal(count(f), 0, `${cols}x${rows} has full-colour cells`);
  }
  // the signature: full and compact carry the foil step; list and tiny draw nothing that moves
  assert.match(idleSignature(3.3, CARTS[sel], 'full'), /foil:19/);
  assert.match(idleSignature(3.3, CARTS[sel], 'compact'), /foil:19/);
  assert.equal(idleSignature(3.3, CARTS[sel], 'list'), '');
  assert.equal(idleSignature(3.3, CARTS[sel], 'tiny'), '');
});

test('compact: the foil shimmers on the one cartridge (6 steps a second) and its neighbours in the list do not exist as cards', () => {
  const sel = IDX['foil-a'];
  const C = seatOf(80, 24, 'compact');
  const a = draw(80, 24, view(sel, clockOf(3))), b = draw(80, 24, view(sel, clockOf(4)));
  assert.equal(rectSame(a, b, C.x + 3, C.y + 3, LABEL_W, LABEL_H), false);
  assert.equal(rectSame(a, draw(80, 24, view(sel, clockOf(3) + 0.1)), C.x + 3, C.y + 3, LABEL_W, LABEL_H), true);
});

// ---- no foil: today

test('no foil anywhere: the pictures have no full-colour cell at any size or clock, and the idle signature is exactly what it was', () => {
  for (const [cols, rows] of [[120, 40], [240, 67], [80, 24], [60, 14], [88, 39], [176, 58], [78, 24]]) {
    for (const index of [0, 1, 2, 3]) for (const t of [0, 0.4, 3.3, 11.1]) {
      const f = draw(cols, rows, view(index, t, {}, PLAIN));
      assert.equal(f.shades.includes(RGB_CELL), false, `${cols}x${rows} #${index} t=${t}`);
    }
  }
  for (const tier of ['full', 'compact']) for (const idle of [0, 0.4, 1.7, 3.3, 20.9]) {
    const sel = PLAIN[0];
    const expect = [];
    if (idle > 0) {
      expect.push('led:' + ledLevelAt(idle));
      if (hasWater(sel.label)) { const col = rippleColAt(idle); expect.push('rip:' + (/[~≈]/.test([...(sel.label[0] || '')][col] || '') ? col : -1)); }
      if (tier === 'full') expect.push('cur:' + cursorShadeAt(idle));
      if (tier === 'full') { const s = scanAt(idle); expect.push('scan:' + (s ? `${s.row},${s.from},${s.p}` : '-')); }
    }
    const got = idleSignature(idle, sel, tier);
    assert.doesNotMatch(got, /foil/);
    if (!hasWater(sel.label)) assert.equal(got, expect.join('|'), `${tier} ${idle}`);
  }
  // a foil card on the shelf does not change the signature of a plain selected card
  for (const idle of [0, 1.7, 3.3, 20.9]) for (const tier of ['full', 'compact']) assert.equal(idleSignature(idle, { ...CARTS[0] }, tier), idleSignature(idle, { ...PLAIN[0] }, tier));
  // and the plain shelf draws the same with or without the (absent) field
  const a = draw(120, 40, view(0, 3.3, {}, PLAIN));
  const b = draw(120, 40, view(0, 3.3, {}, PLAIN.map((c) => { const { foil, ...rest } = c; return rest; })));
  assert.deepEqual(Array.from(a.glyphs), Array.from(b.glyphs));
  assert.deepEqual(Array.from(a.shades), Array.from(b.shades));
});

test('signature: a foil card adds exactly one "foil:<step>" part, which changes 6 times a second at rest and is empty-clock safe', () => {
  const sigs = [];
  for (let k = 0; k < 18 * 10; k++) sigs.push(idleSignature(0.001 + k / 18, CARTS[IDX['foil-a']], 'full'));
  const foilParts = sigs.map((s) => (/foil:(\d+)/.exec(s) || [])[1]);
  assert.ok(foilParts.every((v) => v !== undefined));
  assert.equal(new Set(foilParts).size, 60, '10 s = 60 steps');
  assert.equal(sigs.every((s) => s.split('|').filter((p) => p.startsWith('foil:')).length === 1), true);
  assert.equal(idleSignature(0, CARTS[IDX['foil-a']], 'full'), '', 'not at rest yet');
  assert.doesNotMatch(idleSignature(0.05, CARTS[IDX['foil-a']], 'full').split('|').filter((p) => p.startsWith('foil:')).join(), /[1-9]/);
});

// ---- the memo and the palette

test('memo: the foil is applied to the frame, not stored in the cached card grids; the memo is built exactly as often with a foil as without', () => {
  const run = (carts) => {
    const memo = makeLibraryMemo();
    const frames = [];
    for (let k = 0; k < 60; k++) { const f = newFrame(120, 40); drawLibrary(f, { ...view(IDX['foil-a'], 0.2 + k * 0.25, {}, carts), memo }, skin); frames.push(f); }
    return { memo, frames };
  };
  const withFoil = run(CARTS), plain = run(PLAIN);
  assert.equal(withFoil.memo.builds, plain.memo.builds, 'same number of grid builds');
  for (const c of CARTS) {
    const m = withFoil.memo.carts.get(c);
    if (!m) continue;
    for (const G of m.values()) assert.equal(G.s.includes(RGB_CELL), false, 'a cached card grid holds no full-colour shade');
  }
  // memo or none: the same picture (foil included)
  for (const t of [0.2, 3.3, 9.7]) {
    const a = draw(120, 40, view(IDX['foil-a'], t)), b = newFrame(120, 40);
    drawLibrary(b, { ...view(IDX['foil-a'], t), memo: makeLibraryMemo() }, skin);
    assert.equal(rectSame(a, b, 0, 0, 120, 40), true, 't=' + t);
  }
  // the foil frames of the memo run differ from step to step (it did animate), the plain frames differ only by the old beats
  assert.ok(new Set(withFoil.frames.map((f) => Array.from(f.fg.slice(5 * 120 + 45, 5 * 120 + 75)).join())).size >= 18, 'the holo repeats every 5 s = 20 of these samples');
});

test('palette: the library palette is byte-identical with and without a foil cartridge (the foil takes no palette slot) and stays within the 255 cap', () => {
  const rootA = foilRoot({ withFoil: true }), rootB = foilRoot({ withFoil: false });
  for (const cmode of ['truecolor', '256']) {
    const a = libraryPalette(discoverCartridges({ dirs: [{ dir: rootA, trusted: true }] }).cartridges, cmode);
    const b = libraryPalette(discoverCartridges({ dirs: [{ dir: rootB, trusted: true }] }).cartridges, cmode);
    assert.deepEqual(a.tints, b.tints);
    assert.deepEqual(a.pal.sgr, b.pal.sgr);
    for (const k of ['fgRgb', 'bgRgb', 'fg256', 'bg256']) assert.deepEqual(Array.from(a.pal[k]), Array.from(b.pal[k]), k);
    assert.equal(a.pal.key, b.pal.key);
    assert.ok(a.pal.sgr.length <= 255, 'palette size ' + a.pal.sgr.length);
  }
});

test('applyFoil is a no-op without a foil, on a locked card, on blank cells and on cells outside the card\'s four tint shades; it is idempotent', () => {
  const sel = IDX['foil-a'];
  const f = newFrame(60, 30);
  const cart = CARTS[sel];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 24; x++) { const i = (3 + y) * 60 + 3 + x; f.glyphs[i] = 0x2588; f.shades[i] = cart.tint + (x % 4); }
  f.glyphs[3 * 60 + 3] = 32; f.shades[3 * 60 + 3] = 0; // a blank cell
  f.shades[3 * 60 + 4] = cart.tint + 9; // not a tint shade of this card
  f.shades[3 * 60 + 5] = 7; // a palette shade of the console
  const before = clone(f);
  applyFoil(f, { ...cart, foil: undefined }, 0, 0, 1);
  applyFoil(f, { ...cart, locked: true }, 0, 0, 1);
  assert.deepEqual(Array.from(f.shades), Array.from(before.shades));
  applyFoil(f, cart, 0, 0, 1);
  assert.equal(f.shades[3 * 60 + 3], 0);
  assert.equal(f.shades[3 * 60 + 4], cart.tint + 9);
  assert.equal(f.shades[3 * 60 + 5], 7);
  const once = clone(f);
  applyFoil(f, cart, 0, 0, 1);
  assert.deepEqual(Array.from(f.fg), Array.from(once.fg));
  assert.deepEqual(Array.from(f.shades), Array.from(once.shades));
  // clipped like the card was: rows at or below clipY are left alone
  const g = clone(before);
  applyFoil(g, cart, 0, 0, 1, { clipY: 8 });
  for (let y = 3; y < 13; y++) assert.equal(g.shades[y * 60 + 10] === RGB_CELL, y < 8, 'row ' + y);
});
