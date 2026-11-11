// DRIFT-4 slice 2 (A3): the insert, boot and eject drawing, step by step (designer section 3, the 12-step 5.8 s
// timeline). Every step is checked at the time the designer gives it, on the real drawing functions, at 120x40 and
// 80x24; the glyph / palette / ownership contract is checked at every size down to 4x2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCartridges } from '../src/cartridge/loader.js';
import { validateSkin } from '../src/cartridge/schema.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { drawLibrary, shelfLayout, CONSOLE_W, CART_W, LABEL_H, MOUTH_X } from '../src/shell/library.js';
import {
  drawInsert, INSERT_END, INSERT_LIFT_END, INSERT_SLIDE_END, INSERT_DROP_END, INSERT_CLICK_END, BAND_W, cartridgeOffset, spreadAt, sweepStyle,
} from '../src/shell/insert.js';
import { driftmanSkin, classicBootSkin, DRIFTMAN_COLOURS } from '../src/shell/driftman.js';
import { libraryPalette, EJECT_SECONDS } from '../src/shell/shell.js';
import { newFrame, ramp } from '../src/shell/ui.js';
import { isWide, isInvisible } from './helpers-width.js';
import { frameLines } from './helpers-help.js';
import { makeRoot } from './helpers-shell.js';

const SIZES = [[240, 67], [120, 40], [80, 24], [30, 10], [4, 2]];
const FPS = 18;
const root = makeRoot();
const { cartridges } = discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
const lib = libraryPalette(cartridges, 'truecolor');
const LIB_LEN = lib.pal.sgr.length;
const fixture = cartridges.find((c) => c.id === 'fixture');
const entries = cartridges.map((c, i) => ({
  id: c.id, title: c.title, code: (c.manifest && c.manifest.code) || '', blurb: c.manifest.blurb, facts: c.manifest.facts || ['Genre: test', 'Players: 1'],
  locked: c.locked, label: c.label, ink: null, tint: lib.tints[i],
}));
const view = (index = 0, extra = {}) => ({ cartridges: entries, index, prev: index, slide: 1, message: '', dip: 0, ...extra });
const TAKEOVER = { show: 'always', glyphs: '+-+|+-+|', colour: 3 };
const skinned = { ...fixture.skin, frame: TAKEOVER };
assert.equal(validateSkin(JSON.parse(JSON.stringify(skinned))).ok, true);
const skinnedItem = { cartridge: entries[1], view: view(1), cartSkin: skinned, classic: false };
const classicItem = { cartridge: entries[0], view: view(0), cartSkin: null, classic: true };

const at = (cols, rows, t, item = classicItem) => { const f = newFrame(cols, rows); drawInsert(f, { item, t }, driftmanSkin); return f; };
const text = (f) => frameLines(f).join('\n');
const rowOf = (f, needle) => frameLines(f).findIndex((l) => l.includes(needle));
const cellAt = (f, x, y) => ({ g: String.fromCharCode(f.glyphs[y * f.cols + x]), s: f.shades[y * f.cols + x] });
const lit = (f) => f.glyphs.reduce((n, g) => n + (g !== 32 ? 1 : 0), 0);
const frameTimes = (a, b) => { const out = []; for (let t = a; t <= b + 1e-9; t += 1 / FPS) out.push(Math.min(t, b)); return out; };
const L = shelfLayout(120, 40, 'full');
const label = entries[0].label[1];

function dirty(cols, rows) {
  const f = newFrame(cols, rows);
  for (let i = 0; i < f.glyphs.length; i++) { f.glyphs[i] = 0x2588; f.shades[i] = 3; }
  return f;
}
function problems(f, palLen, name) {
  const bad = [];
  for (let i = 0; i < f.glyphs.length && bad.length < 4; i++) {
    const cp = f.glyphs[i];
    if (!isAllowedGlyph(cp)) bad.push(`${name}: cell ${i} has U+${cp.toString(16)} (not allowed)`);
    else if (isWide(cp) || isInvisible(cp)) bad.push(`${name}: cell ${i} U+${cp.toString(16)} is wide or invisible`);
    if (f.shades[i] >= palLen) bad.push(`${name}: cell ${i} shade ${f.shades[i]} >= ${palLen}`);
    if (cp === 32 && f.shades[i] !== 0) bad.push(`${name}: blank cell ${i} has shade ${f.shades[i]}`);
  }
  return bad;
}

// ---- insert, steps 1-5

test('insert step 1 (0 - 0.15 s): the cartridge lifts one row (by 0.1 s) and its shell LED is solid', () => {
  assert.equal(INSERT_END, 1.5);
  const r0 = rowOf(at(120, 40, 0), label);
  assert.equal(rowOf(at(120, 40, 0.1), label), r0 - 1, 'lifted one row at 0.1 s');
  assert.equal(rowOf(at(120, 40, 0.14), label), r0 - 1);
  assert.equal(cartridgeOffset(0), 0);
  assert.equal(cartridgeOffset(0.1), -1);
  // the shell LED (row 1, column 25 of the cartridge) is the solid ●, lit, and does not breathe
  const led = (t) => cellAt(at(120, 40, t), L.cartX + 25, L.cartTop + 1 - (t >= 0.1 ? 1 : 0));
  assert.equal(led(0).g, '●');
  assert.equal(led(0.1).g, '●');
  assert.equal(led(0.1).s, led(0.4).s, 'steady: the same shade through the lift and the slide');
});

test('insert step 2 (0.15 - 0.45 s): neighbours slide off to their sides and fade out; dots, hint and details dissolve', () => {
  const t0 = at(120, 40, 0);
  const t45 = at(120, 40, INSERT_SLIDE_END);
  const fixtureRow = entries[1].label[1];
  const count = (f, sub) => text(f).split(sub).length - 1;
  assert.equal(count(t0, fixtureRow), 2, 'both neighbours at the start');
  assert.equal(count(t45, fixtureRow), 0, 'gone by 0.45');
  assert.match(text(t0), /◀ ▶ choose/);
  assert.ok(!/◀ ▶ choose/.test(text(t45)), 'hint gone by 0.45');
  assert.ok(!/● ○ ○ ○/.test(text(t45)), 'dots gone');
  // they move outward: the lit cells right of the centre cartridge drift right and those left of it drift left
  const side = (f, right) => {
    let n = 0, sum = 0;
    for (let y = 0; y < L.consoleTop; y++) {
      for (let x = 0; x < f.cols; x++) {
        if (f.glyphs[y * f.cols + x] === 32) continue;
        if (right ? x >= L.cartX + CART_W : x < L.cartX) { n++; sum += x; }
      }
    }
    return sum / n;
  };
  const f20 = at(120, 40, 0.2), f33 = at(120, 40, 0.33);
  assert.ok(side(f33, true) > side(f20, true), 'right neighbour slides right');
  assert.ok(side(f33, false) < side(f20, false), 'left neighbour slides left');
  // the slide is a ramp: spread grows monotonically from 0 to its end value, the lit cells thin out
  let prev = 0;
  for (const t of frameTimes(INSERT_LIFT_END, INSERT_SLIDE_END)) { const s = spreadAt(t); assert.ok(s >= prev); prev = s; }
  assert.equal(spreadAt(0.1), 0);
  assert.ok(spreadAt(INSERT_SLIDE_END) >= 6, 'they travel a visible distance');
  let litPrev = Infinity;
  for (const t of frameTimes(INSERT_LIFT_END, INSERT_SLIDE_END)) { const n = lit(at(120, 40, t)); assert.ok(n <= litPrev + 0, `lit cells never grow while they fade (${n} > ${litPrev} at ${t})`); litPrev = n; }
});

test('insert step 3 (0.45 - 0.85 s): the cartridge drops three rows accelerating; the tongue is hidden from the slot floor down; S15 on the housing row, S16 in the mouth', () => {
  const r0 = rowOf(at(120, 40, 0), label);
  const rows = frameTimes(INSERT_SLIDE_END, INSERT_DROP_END).map((t) => rowOf(at(120, 40, t), label) - r0);
  assert.ok(rows.every((r, i) => i === 0 || r >= rows[i - 1]), `monotone: ${rows}`);
  assert.deepEqual([...new Set(rows)].filter((r) => r >= 0), [0, 1, 2, 3], 'passes through 0, 1, 2 and 3 rows');
  assert.equal(rows[rows.length - 1], 3);
  // accelerating: each row is crossed faster than the one before (checked on the continuous timeline)
  const dwell = new Map();
  for (let t = INSERT_SLIDE_END; t < INSERT_DROP_END; t += 0.0005) dwell.set(cartridgeOffset(t), (dwell.get(cartridgeOffset(t)) || 0) + 0.0005);
  assert.ok(dwell.get(0) > dwell.get(1) && dwell.get(1) > dwell.get(2), `dwell times ${[0, 1, 2].map((k) => dwell.get(k).toFixed(3))}`);
  assert.equal(cartridgeOffset(INSERT_DROP_END), 3);
  // at rest in the slot (0.85): S15 is the tongue's bottom edge row on the housing row (console row 0), S16 inside the mouth (row 1)
  const f = at(120, 40, INSERT_DROP_END);
  const lines = frameLines(f);
  assert.ok(lines[L.consoleTop].includes('╰──┬' + '─'.repeat(22) + '┬──╯'), 'S15 on the housing row');
  assert.ok(lines[L.consoleTop + 1].includes('│' + '▌'.repeat(22) + '│'), 'S16 inside the mouth');
  assert.ok(!lines.some((l) => l.includes('╰' + '─'.repeat(22) + '╯')), 'S17 (the tongue bottom) is hidden: the slot floor hides it');
  // the slot floor row (console row 2) shows the console, not the cartridge's tongue
  assert.equal(lines[L.consoleTop + 2].includes('▌'), false);
  assert.equal(cellAt(f, L.consoleX + MOUTH_X + 2, L.consoleTop + 2).g, '▄', 'the mouth floor');
});

test('insert step 4 (0.85 - 1.0 s): the click - the housing brightens one shade then eases back, and the CART LED turns on in the accent colour', () => {
  const housing = (t) => cellAt(at(120, 40, t, skinnedItem), L.consoleX + 28, L.consoleTop + 1).s; // the housing wall beside the mouth
  const base = housing(0.8);
  assert.equal(base, DRIFTMAN_COLOURS.housing);
  assert.equal(housing(0.86), DRIFTMAN_COLOURS.dim, 'one shade brighter right after the click');
  assert.equal(housing(0.99), base, 'and back to where it was by 1.0');
  const seq = frameTimes(INSERT_DROP_END, INSERT_CLICK_END).map(housing);
  assert.ok(seq.some((s) => s === DRIFTMAN_COLOURS.dim) && seq.some((s, i) => i > 0 && s === base), `up then down: ${seq}`);
  const ledShade = (t) => { const ls = frameLines(at(120, 40, t)); const y = ls.findIndex((l) => l.includes('PWR')); const x = ls[y].indexOf('CART') - 2; return cellAt(at(120, 40, t), x, y); };
  assert.equal(ledShade(0.8).g, '○', 'CART is ○ until the click');
  assert.equal(ledShade(0.9).g, '●');
  assert.equal(ledShade(0.9).s, driftmanSkin.palette.ui.accent, 'CART LED on in the accent colour');
  // the click is gentle: the mouth floor goes from dark to the housing shade over more than one frame
  const mouth = (t) => cellAt(at(120, 40, t), L.consoleX + MOUTH_X + 2, L.consoleTop + 2).s;
  assert.equal(mouth(0.8), DRIFTMAN_COLOURS.dark);
  assert.equal(mouth(1.0), DRIFTMAN_COLOURS.housing);
});

// console rows are scanned along the bottom edge (console row 16): old border cells, the band, the swapped ones behind it
function bandScan(f, cartTint) {
  const y = L.consoleTop + 16;
  const out = [];
  for (let x = L.consoleX + 1; x < L.consoleX + CONSOLE_W - 1; x++) {
    const c = cellAt(f, x, y);
    out.push({ x, g: c.g, s: c.s });
  }
  return out.map((c) => ({ ...c, kind: c.g === '-' ? (c.s === cartTint + 3 ? 'band' : 'behind') : c.s === DRIFTMAN_COLOURS.dim ? 'band' : 'old' }));
}

test('insert step 5 (1.0 - 1.5 s): a 6-column band sweeps left to right; behind it the console shows the cartridge\'s frame glyphs and colour', () => {
  assert.equal(BAND_W, 6);
  const tint = entries[1].tint;
  let prevEdge = -Infinity;
  const widths = [];
  for (const t of frameTimes(INSERT_CLICK_END + 0.05, INSERT_END - 0.01)) {
    const scan = bandScan(at(120, 40, t, skinnedItem), tint);
    const idx = (k) => scan.map((c, i) => (c.kind === k ? i : -1)).filter((i) => i >= 0);
    const band = idx('band'), behind = idx('behind'), old = idx('old');
    if (band.length) {
      widths.push(band.length);
      assert.ok(band.length <= BAND_W, `band ${band.length} wide at ${t}`);
      assert.ok(band[band.length - 1] - band[0] + 1 === band.length, 'the band is contiguous');
      assert.ok(band[band.length - 1] > prevEdge, 'the band moves right');
      prevEdge = band[band.length - 1];
      assert.ok(behind.every((i) => i < band[0]) && old.every((i) => i > band[band.length - 1]), 'swapped behind the band, old ahead of it');
    }
  }
  assert.ok(widths.some((w) => w === BAND_W), 'a whole 6-column band is seen');
  assert.ok(widths.length >= 5, `the band is seen in several frames (${widths.length})`);
  // before it starts nothing is swapped; once it is done everything is, and no band is left
  assert.ok(bandScan(at(120, 40, 1.0, skinnedItem), tint).every((c) => c.kind === 'old'));
  const done = bandScan(at(120, 40, INSERT_END, skinnedItem), tint);
  assert.ok(done.every((c) => c.kind === 'behind'), 'all swapped at 1.5');
  assert.ok(!text(at(120, 40, INSERT_END, skinnedItem)).includes('╔'), 'the bezel glyphs are the skin\'s');
  // the colour moves to the skin's: the border is in the cartridge tint, not the console graphite
  assert.equal(done[0].s, tint + 2);
});

test('insert step 5, Classic: the band is a one-shade shimmer only - the console glyphs never change', () => {
  const still = at(120, 40, 1.0);
  const done = at(120, 40, INSERT_END);
  assert.equal(text(still), text(done), 'same glyphs before and after');
  assert.deepEqual(Array.from(still.shades), Array.from(done.shades), 'and the same colours: nothing is left behind the band');
  let seen = 0;
  for (const t of frameTimes(1.05, 1.45)) {
    const f = at(120, 40, t);
    assert.equal(text(f), text(still), `glyphs unchanged at ${t}`);
    const scan = bandScan(f, 0);
    const band = scan.filter((c) => c.kind === 'band');
    assert.ok(band.length <= BAND_W);
    if (band.length) seen++;
    assert.ok(scan.every((c) => c.kind !== 'behind'));
  }
  assert.ok(seen >= 4, `the shimmer is seen in ${seen} frames`);
});

test('sweepStyle: ONE pure function builds the takeover style (schema item 1 replaces it)', () => {
  const ui = driftmanSkin.palette.ui;
  const a = sweepStyle(skinnedItem, ui), b = sweepStyle(skinnedItem, ui);
  assert.deepEqual(a, b, 'pure');
  assert.equal(a.style.box, '+-+|+-+|');
  assert.equal(a.style.shade, entries[1].tint + 2);
  assert.equal(a.band.shade, entries[1].tint + 3, 'the band is one shade brighter');
  const c = sweepStyle(classicItem, ui);
  assert.ok(c.style.box === undefined || c.style.box === '╔═╗║╝═╚║', 'Classic keeps the bezel');
  assert.ok(c.style.shade === undefined, 'and the console colour');
  assert.equal(c.band.shade, DRIFTMAN_COLOURS.dim, 'but the band is one shade up');
});

test('insert t = 0 is the library at rest, and the timeline is not changed by the new drawing', () => {
  const f = newFrame(120, 40);
  drawLibrary(f, view(0), driftmanSkin);
  const g = at(120, 40, 0);
  assert.equal(text(g), text(f).replace(/\n$/, ''));
  assert.deepEqual([INSERT_LIFT_END, INSERT_SLIDE_END, INSERT_DROP_END, INSERT_CLICK_END, INSERT_END], [0.15, 0.45, 0.85, 1.0, 1.5]);
});

// ---- eject: the insert played backwards

const ejectT = (st) => INSERT_END * (1 - ramp(st, 0, EJECT_SECONDS));

test('eject (insert backwards, 1.6 s): the console reverts, the cartridge pops up, the neighbours slide back - all monotone', () => {
  assert.equal(EJECT_SECONDS, 1.6);
  const times = [];
  for (let st = 0; st <= EJECT_SECONDS + 1e-9; st += 1 / FPS) times.push(Math.min(st, EJECT_SECONDS));
  const tint = entries[1].tint;
  const frames = times.map((st) => at(120, 40, ejectT(st), skinnedItem));
  // the cartridge never goes down while ejecting
  const rowsOf = frames.map((f) => rowOf(f, entries[1].label[1].trim()));
  const cart = frames.map((f) => { const ls = frameLines(f); return ls.findIndex((l) => l.includes('│ │') && l.includes(entries[1].label[1])); });
  const rising = cart.filter((r, i) => ejectT(times[i]) >= INSERT_LIFT_END / 2);
  assert.ok(rising.every((r, i) => i === 0 || r <= rising[i - 1]), `the cartridge only rises while it comes out: ${cart}`);
  assert.equal(cart[cart.length - 1], cart[cart.length - 2] + 1, 'and is set back on the shelf by the last frame');
  void rowsOf;
  // the band sweeps the other way: swapped cells shrink back from the right, monotonically
  const swapped = frames.map((f) => bandScan(f, tint).filter((c) => c.kind === 'behind').length);
  assert.ok(swapped.every((n, i) => i === 0 || n <= swapped[i - 1]), `swapped columns only shrink: ${swapped}`);
  assert.equal(swapped[0], CONSOLE_W - 2);
  assert.equal(swapped[swapped.length - 1], 0);
  // the neighbours return: lit cells outside the console and the centre cartridge never fall
  const outside = frames.map((f) => { let n = 0; for (let y = 0; y < L.consoleTop; y++) for (let x = 0; x < f.cols; x++) if (f.glyphs[y * f.cols + x] !== 32 && (x < L.cartX || x >= L.cartX + CART_W)) n++; return n; });
  assert.equal(outside[0], 0);
  assert.ok(outside[outside.length - 1] > 400, 'the neighbours are back');
  assert.ok(outside.every((n, i) => i === 0 || n >= outside[i - 1] - 0), `neighbours only come back: ${outside}`);
  // the last eject frame is the library at rest
  const rest = newFrame(120, 40);
  drawLibrary(rest, view(1), driftmanSkin);
  assert.equal(text(frames[frames.length - 1]), text(rest).replace(/\n$/, ''));
});

// ---- the contract at every size

test('insert: every size draws allowed single-width glyphs, in-palette shades, and owns every cell (steps 1-5, skinned and Classic)', () => {
  for (const [w, h] of SIZES) {
    for (const it of [skinnedItem, classicItem]) {
      for (const t of [0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8, 0.86, 0.95, 1.0, 1.1, 1.25, 1.4, INSERT_END, 99, -1, NaN]) {
        const f = newFrame(w, h);
        assert.doesNotThrow(() => drawInsert(f, { item: it, t }, driftmanSkin), `${w}x${h} t=${t}`);
        assert.deepEqual(problems(f, LIB_LEN, `insert ${w}x${h} t=${t}`), []);
        const g = dirty(w, h);
        drawInsert(g, { item: it, t }, driftmanSkin);
        assert.deepEqual(Array.from(g.glyphs), Array.from(f.glyphs), `insert ${w}x${h} t=${t}: owns every cell`);
        assert.deepEqual(Array.from(g.shades), Array.from(f.shades));
      }
    }
  }
});

test('insert at 80x24: the compact tier plays the same steps (lift, drop, click, band over the mini console)', () => {
  const C = shelfLayout(80, 24, 'compact');
  const lab = entries[0].label[1];
  const r0 = rowOf(at(80, 24, 0), lab);
  assert.equal(rowOf(at(80, 24, 0.1), lab), r0 - 1);
  assert.equal(rowOf(at(80, 24, INSERT_DROP_END), lab), r0 + 3);
  assert.ok(!/CARTRIDGES/.test(text(at(80, 24, INSERT_SLIDE_END))), 'the list is gone by 0.45');
  const edge = (t) => cellAt(at(80, 24, t, skinnedItem), C.miniX + 1, C.miniTop + 3);
  assert.equal(edge(1.0).g, '─');
  assert.equal(edge(INSERT_END).g, '-', 'the mini console takes the skin\'s glyphs');
  assert.equal(cellAt(at(80, 24, 0.9), C.miniX + 9, C.miniTop + 2).g, '●', 'CART LED on');
});

void classicBootSkin; void lit; void LABEL_H;
