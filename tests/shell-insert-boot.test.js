// DRIFT-4 slice 2 (A3): the insert, boot and eject drawing, step by step (designer section 3, the 12-step 5.8 s
// timeline). Every step is checked at the time the designer gives it, on the real drawing functions, at 120x40 and
// 80x24; the glyph / palette / ownership contract is checked at every size down to 4x2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCartridges } from '../src/cartridge/loader.js';
import { validateSkin } from '../src/cartridge/schema.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { drawLibrary, shelfLayout, screenRect, CONSOLE_W, CART_W, MOUTH_X } from '../src/shell/library.js';
import {
  drawBoot, bootPhases, bootSeconds, bootLines, lineRuns, mergeBootPalette, titleOrnament, LINE_SECONDS,
} from '../src/shell/boot.js';
import { drawChrome } from '../src/shell/chrome.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import {
  drawInsert, INSERT_END, INSERT_LIFT_END, INSERT_SLIDE_END, INSERT_DROP_END, INSERT_CLICK_END, BAND_W, cartridgeOffset, spreadAt, sweepStyle,
} from '../src/shell/insert.js';
import { driftmanSkin, classicBootSkin, plainBootSkin, DRIFTMAN_COLOURS } from '../src/shell/driftman.js';
import { INSTALL_DIR } from '../src/cartridge/loader.js';
import { libraryPalette, createShell, EJECT_SECONDS } from '../src/shell/shell.js';
import { SPEEDS, DISSOLVE_SECONDS, DEFAULT_FADE_SECONDS } from '../src/app.js';
import { newFrame, ramp } from '../src/shell/ui.js';
import { isWide, isInvisible } from './helpers-width.js';
import { frameLines } from './helpers-help.js';
import { makeRoot, mkShell } from './helpers-shell.js';

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

// ---------------------------------------------------------------------------------------------------------------
// boot on the console (designer steps 6-12): the boot is drawn ON the console screen, not on a blank frame
// ---------------------------------------------------------------------------------------------------------------

const BOOT_SKIN = { ...skinned, boot: { lines: ['CARTRIDGE ...... FIXTURE', 'MEMORY 64K ..... OK', 'MAP ............ UNROLLED', 'The forest remembers you.'], art: false } };
const cartPal = makeSkinPalette(BOOT_SKIN, 'truecolor', 'fixture');
const merged = mergeBootPalette(cartPal, lib.pal, entries[1].tint);
const MAP = merged.map;
const EDGE = BOOT_SKIN.frame.colour; // the zoom edge's shade (a cartridge palette index, so no console cell can have it)
const ACCENT = cartPal.ui.accent;
const P = bootPhases(BOOT_SKIN);
const LINES = bootLines(BOOT_SKIN, driftmanSkin, 'Fixture');

const boot = (cols, rows, t, o = {}) => {
  const f = newFrame(cols, rows);
  drawBoot(f, { skin: BOOT_SKIN, item: skinnedItem, labelArt: fixture.label, t, loading: false, title: 'Fixture', consoleMap: MAP, ...o }, driftmanSkin);
  return f;
};
const bootAt120 = (t, o) => boot(120, 40, t, o);
const edgeCells = (f) => {
  const out = [];
  for (let y = 0; y < f.rows; y++) {
    for (let x = 0; x < f.cols; x++) {
      const i = y * f.cols + x;
      if (f.shades[i] === EDGE && '+-|'.includes(String.fromCharCode(f.glyphs[i]))) out.push({ x, y });
    }
  }
  return out;
};
const boxOf = (cells) => (cells.length ? {
  x0: Math.min(...cells.map((c) => c.x)), x1: Math.max(...cells.map((c) => c.x)), y0: Math.min(...cells.map((c) => c.y)), y1: Math.max(...cells.map((c) => c.y)),
} : null);
const rowText = (f, y, x0, x1) => String.fromCharCode(...f.glyphs.subarray(y * f.cols + x0, y * f.cols + x1 + 1));
const EIGHTHS = { '█': 8, '▉': 7, '▊': 6, '▋': 5, '▌': 4, '▍': 3, '▎': 2, '▏': 1 };

test('screenRect: the console screen is 46 x 9 at the full tier (bezel interior) and the 38 x 9 blurb box at the compact tier; nothing smaller', () => {
  const full = shelfLayout(120, 40, 'full');
  assert.deepEqual(screenRect(120, 40), { x: full.consoleX + 3, y: full.consoleTop + 4, w: 46, h: 9 });
  const compact = shelfLayout(80, 24, 'compact');
  assert.deepEqual(screenRect(80, 24), { x: compact.listX, y: compact.cartTop + 9, w: 38, h: 9 });
  const xl = shelfLayout(240, 67, 'full');
  assert.deepEqual(screenRect(240, 67), { x: xl.consoleX + 3, y: xl.consoleTop + 4, w: 46, h: 9 });
  assert.equal(screenRect(40, 10), null);
  assert.equal(screenRect(4, 2), null);
  // the rect is the bezel's interior: blank in the post-insert frame, with the bezel glyphs round it
  const f = at(120, 40, INSERT_END, skinnedItem);
  const R = screenRect(120, 40);
  for (let y = R.y; y < R.y + R.h; y++) assert.equal(rowText(f, y, R.x, R.x + R.w - 1).trim(), '', `row ${y} of the screen is blank`);
  assert.equal(cellAt(f, R.x - 1, R.y).g, '|', 'the bezel (skin glyphs) is just outside it');
});

test('mergeBootPalette: the cartridge palette first (so the running cartridge\'s indices are untouched), the console\'s colours after it on the cartridge\'s background', () => {
  const off = cartPal.sgr.length;
  assert.deepEqual(merged.pal.sgr.slice(0, off), cartPal.sgr);
  assert.equal(merged.pal.base, cartPal.base);
  assert.deepEqual(merged.pal.ui, cartPal.ui);
  assert.notEqual(merged.pal.key, cartPal.key);
  assert.equal(MAP(0), off);
  assert.equal(MAP(DRIFTMAN_COLOURS.dim), off + 19);
  assert.equal(MAP(entries[1].tint + 2), off + 20 + 2);
  assert.ok(merged.pal.sgr.length <= off + 24, 'only the console\'s 20 colours and this cartridge\'s 4 tints');
  // the console entry is the library entry with the cartridge's background instead of the library's
  const libSgr = lib.pal.sgr[DRIFTMAN_COLOURS.housing];
  assert.ok(libSgr.endsWith(lib.pal.base));
  assert.equal(merged.pal.sgr[MAP(DRIFTMAN_COLOURS.housing)], libSgr.slice(0, -lib.pal.base.length) + cartPal.base);
  assert.ok(merged.pal.sgr.length <= 256, 'the merged palette does not grow with the number of cartridges on the shelf');
});

for (const [cols, rows] of [[120, 40], [80, 24]]) {
  const R = screenRect(cols, rows);
  const barW = R.w - 6;
  const bootAt = (t, o) => boot(cols, rows, t, o);

  test(`boot ${cols}x${rows} step 6 (screen on, 0 - 0.2 s): a line grows from the centre of the console screen to its full width`, () => {
    const start = bootAt(0);
    const end = at(cols, rows, INSERT_END, skinnedItem);
    // the first frame is the console exactly as the insert left it (mapped to the boot palette)
    assert.deepEqual(Array.from(start.glyphs), Array.from(end.glyphs));
    assert.deepEqual(Array.from(start.shades), Array.from(end.shades, (s, i) => (end.glyphs[i] === 32 ? 0 : MAP(s))));
    assert.equal(edgeCells(start).length, 0, 'no line at t = 0');
    let prev = 0;
    for (const t of [0.04, 0.08, 0.12, 0.16, 0.2]) {
      const cells = edgeCells(bootAt(t));
      const b = boxOf(cells);
      assert.ok(cells.every((c) => c.y === R.y + 4), `one row, the middle of the screen (t=${t})`);
      const w = b.x1 - b.x0 + 1;
      assert.ok(w >= prev, 'grows');
      assert.ok(Math.abs((b.x0 - R.x) - (R.x + R.w - 1 - b.x1)) <= 1, 'from the centre');
      prev = w;
    }
    assert.equal(prev, R.w, 'full width at 0.2 s');
  });

  test(`boot ${cols}x${rows} step 7 (0.2 - 0.4 s): the line opens to the full screen height, the inside stays dark`, () => {
    let prev = 0;
    for (const t of [0.22, 0.26, 0.3, 0.34, 0.38, 0.4]) {
      const f = bootAt(t);
      const b = boxOf(edgeCells(f));
      const h = b.y1 - b.y0 + 1;
      assert.ok(h >= prev && h >= 1, 'opens');
      prev = h;
      assert.equal(b.x1 - b.x0 + 1, R.w);
      assert.ok(Math.abs((b.y0 - R.y) - (R.y + R.h - 1 - b.y1)) <= 1, 'from the middle');
      for (let y = b.y0 + 1; y < b.y1; y++) assert.equal(rowText(f, y, b.x0 + 1, b.x1 - 1).trim(), '', 'dark inside');
    }
    assert.equal(prev, R.h, 'the full height at 0.4 s');
    const f = bootAt(P.on);
    assert.equal(cellAt(f, R.x, R.y).g, '+');
    assert.equal(cellAt(f, R.x + R.w - 1, R.y + R.h - 1).g, '+');
    assert.equal(cellAt(f, R.x, R.y + 3).g, '|', 'the skin\'s frame glyphs');
    assert.equal(cellAt(f, R.x + 5, R.y).s, EDGE);
  });

  test(`boot ${cols}x${rows} step 8: the boot lines type out 0.25 s each in the console screen`, () => {
    assert.equal(LINE_SECONDS, 0.25);
    const textW = R.w - 4;
    for (let k = 0; k < LINES.length; k++) {
      const row = R.y + 1 + k;
      const done = bootAt(P.on + (k + 1) * LINE_SECONDS + 0.005);
      assert.equal(rowText(done, row, R.x + 2, R.x + 1 + textW).trimEnd(), [...LINES[k]].slice(0, textW).join(''), `line ${k} complete`);
      const half = bootAt(P.on + (k + 0.5) * LINE_SECONDS);
      const typed = rowText(half, row, R.x + 2, R.x + 1 + textW).trimEnd();
      assert.ok(typed.length > 0 && typed.length < LINES[k].length && LINES[k].startsWith(typed), `line ${k} half typed: ${JSON.stringify(typed)}`);
      const before = bootAt(P.on + k * LINE_SECONDS - 0.001);
      assert.equal(rowText(before, row, R.x + 2, R.x + 1 + textW).trim(), '', `line ${k} not started`);
    }
    // 'OK'-style words come in the accent colour: the text after a run of dots and a space
    const f = bootAt(P.on + LINES.length * LINE_SECONDS + 0.01);
    const lines = frameLines(f);
    const y = lines.findIndex((l) => l.includes('MEMORY 64K ..... OK'));
    assert.ok(y >= 0);
    const x = lines[y].indexOf('OK');
    assert.equal(f.shades[y * cols + x], ACCENT, 'OK in the accent colour');
    assert.equal(f.shades[y * cols + lines[y].indexOf('MEMORY')], cartPal.ui.text, 'the rest in the text colour');
    // the line runs the typed-line drawer is built on: text, dots, value
    assert.deepEqual(lineRuns('MEMORY 64K ..... OK'), [{ text: 'MEMORY 64K ', kind: 'text' }, { text: '..... ', kind: 'dots' }, { text: 'OK', kind: 'value' }]);
    assert.deepEqual(lineRuns('Nothing to do.'), [{ text: 'Nothing to do.', kind: 'text' }]);
    assert.deepEqual(lineRuns('Loading ...'), [{ text: 'Loading ...', kind: 'text' }], 'a dot run with nothing after it has no value');
    assert.deepEqual(lineRuns('v1.2 .. x'), [{ text: 'v1.2 .. x', kind: 'text' }], 'two dots are not a run');
  });

  test(`boot ${cols}x${rows} step 9 (progress bar, 3.4 - 3.8 s): fills monotonically in eighth-cell steps and holds just short of full while loading`, () => {
    const fill = (f) => {
      const y = R.y + R.h - 2;
      let sum = 0, partial = 0;
      for (let x = R.x + 3; x < R.x + 3 + barW; x++) { const e = EIGHTHS[String.fromCharCode(f.glyphs[y * cols + x])] || 0; sum += e; if (e > 0 && e < 8) partial++; }
      return { sum, partial, open: String.fromCharCode(f.glyphs[y * cols + R.x + 2]), close: String.fromCharCode(f.glyphs[y * cols + R.x + 3 + barW]) };
    };
    assert.equal(fill(bootAt(P.linesEnd - 0.01)).open, ' ', 'no bar before the lines are done');
    const sums = [];
    let sawPartial = false;
    for (let t = P.linesEnd; t <= P.barEnd + 1e-9; t += 1 / FPS) {
      const r = fill(bootAt(Math.min(t, P.barEnd)));
      sums.push(r.sum);
      sawPartial = sawPartial || r.partial > 0;
      assert.equal(r.open + r.close, '[]');
    }
    assert.ok(sums.every((s, i) => i === 0 || s >= sums[i - 1]), `monotone: ${sums}`);
    assert.ok(sawPartial, 'sub-cell steps are used');
    assert.equal(fill(bootAt(P.barEnd)).sum, barW * 8, 'full when the scenes are loaded');
    const held = fill(bootAt(P.barEnd, { loading: true })).sum;
    assert.ok(held < barW * 8 && held >= Math.floor(barW * 8 * 0.9), `held just short of full (${held} of ${barW * 8})`);
  });

  test(`boot ${cols}x${rows} step 10 (zoom, 3.8 - 4.6 s): the screen rectangle zooms ease in and out to the whole terminal; the last frame is drawChrome's border`, () => {
    let prev = { x0: R.x, x1: R.x + R.w - 1, y0: R.y, y1: R.y + R.h - 1 };
    for (let t = P.barEnd; t <= P.zoomEnd + 1e-9; t += 1 / FPS) {
      const b = boxOf(edgeCells(bootAt(Math.min(t, P.zoomEnd))));
      assert.ok(b.x0 <= prev.x0 && b.y0 <= prev.y0 && b.x1 >= prev.x1 && b.y1 >= prev.y1, `grows monotonically at ${t.toFixed(2)}`);
      prev = b;
    }
    assert.deepEqual([prev.x0, prev.y0, prev.x1, prev.y1], [0, 0, cols - 1, rows - 1], 'ends at the whole terminal');
    const span = P.zoomEnd - P.barEnd;
    const at25 = boxOf(edgeCells(bootAt(P.barEnd + 0.25 * span)));
    const at75 = boxOf(edgeCells(bootAt(P.barEnd + 0.75 * span)));
    assert.ok((R.x - at25.x0) / R.x < 0.25, 'ease in: slower than linear at the start');
    assert.ok((R.x - at75.x0) / R.x > 0.75, 'ease out: nearly there at 75%');
    // the final zoom frame IS drawChrome's output: this edge becomes the menu frame
    for (const o of [{}, { item: undefined }]) {
      const f = bootAt(P.zoomEnd, o);
      const ref = newFrame(cols, rows);
      drawChrome(ref, BOOT_SKIN);
      assert.deepEqual(Array.from(f.glyphs), Array.from(ref.glyphs), 'glyphs are drawChrome\'s');
      assert.deepEqual(Array.from(f.shades), Array.from(ref.shades), 'and so are the colours');
    }
    // the typed text clears away cell by cell during the zoom (never in one step)
    assert.ok(text(bootAt(P.barEnd)).includes('CARTRIDGE'));
    assert.ok(!text(bootAt(P.barEnd + 0.5)).includes('CARTRIDGE'));
  });
}

test('boot step 11 (title card, 4.6 - 5.2 s): the title is revealed left to right over 0.3 s; the ornament row only if the skin has one', () => {
  const [cols, rows] = [120, 40];
  const full = bootAt120(P.titleEnd);
  const cellsOf = (f) => {
    const out = new Set();
    for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) if (f.glyphs[y * cols + x] === 0x2588 && f.shades[y * cols + x] === cartPal.ui.head) out.add(y * cols + x);
    return out;
  };
  const total = cellsOf(full);
  assert.ok(total.size > 100, 'big block letters');
  const colOf = (i) => i % cols;
  let prevSize = 0, prevSet = new Set();
  for (const dt of [0.02, 0.06, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4]) {
    const set = cellsOf(bootAt120(P.zoomEnd + dt));
    assert.ok(set.size >= prevSize, 'reveals');
    for (const i of prevSet) assert.ok(set.has(i), 'a revealed cell stays');
    // left to right: the revealed cells are exactly the title's cells up to some column
    const c = Math.max(...[...set].map(colOf));
    for (const i of total) if (colOf(i) < c) assert.ok(set.has(i), `column ${colOf(i)} is revealed before column ${c} (dt ${dt})`);
    for (const i of set) assert.ok(total.has(i));
    prevSize = set.size; prevSet = set;
  }
  assert.equal(cellsOf(bootAt120(P.zoomEnd + 0.3)).size, total.size, 'complete after 0.3 s');
  const part = cellsOf(bootAt120(P.zoomEnd + 0.1)).size;
  assert.ok(part < total.size && part > 0, 'partial part-way');
  // the ornament hook: nothing under the title today; a skin with an ornament field gets its row
  assert.equal(titleOrnament(BOOT_SKIN), null);
  const titleRows = [...total].map((i) => Math.floor(i / cols));
  const top = Math.min(...titleRows), bottom = Math.max(...titleRows);
  assert.equal(frameLines(full)[bottom + 2].slice(1, -1).trim(), '', 'no ornament row without a field');
  const orn = { ...BOOT_SKIN, menu: { ...(BOOT_SKIN.menu || {}), ornament: '── ◆ ──' } };
  assert.equal(titleOrnament(orn), '── ◆ ──');
  const f = bootAt120(P.titleEnd, { skin: orn });
  assert.ok(frameLines(f)[bottom + 2].includes('── ◆ ──'), 'the ornament row under the title');
  // nothing else is on the title card but the border, the title, its ornament and the label above it
  const stray = [];
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      if (f.glyphs[i] !== 32 && f.glyphs[i] !== 0x2588 && y !== bottom + 2 && !(y >= 1 && y <= top - 1)) stray.push(`${x},${y}`);
    }
  }
  assert.deepEqual(stray, [], 'nothing but the title, its ornament and the label');
});

test('boot: the label is drawn above the title card at the cartridge\'s tint when there is room (10 rows plus a margin), and boot art takes its place', () => {
  const labelRow = fixture.label[1].trim();
  assert.ok(labelRow.length > 10);
  const big = bootAt120(P.titleEnd);
  assert.ok(text(big).includes(labelRow), 'label shown at 120x40');
  const ys = frameLines(big);
  const y = ys.findIndex((l) => l.includes(labelRow));
  assert.equal(big.shades[y * 120 + ys[y].indexOf(labelRow)], MAP(entries[1].tint + 1), 'tint level 1');
  const tall = Array.from({ length: 10 }, (_, i) => 'LABEL ROW ' + i + ' ~~~~~~');
  assert.ok(text(boot(120, 40, P.titleEnd, { labelArt: tall })).includes('LABEL ROW 0 ~~~~~~'), 'a full 24 x 10 label fits at 120x40');
  assert.ok(!text(boot(80, 24, P.titleEnd, { labelArt: tall })).includes('LABEL ROW 0'), '80x24 has rows >= 24 but no room above the title for 10 rows, so no label');
  assert.ok(!text(bootAt120(P.zoomEnd)).includes(labelRow), 'not before the zoom has ended');
  // boot art replaces the label
  const artSkin = { ...BOOT_SKIN, boot: { ...BOOT_SKIN.boot, art: true } };
  const withArt = bootAt120(P.titleEnd, { skin: artSkin, bootArt: ['<< BOOT ART >>'] });
  assert.ok(text(withArt).includes('<< BOOT ART >>'));
  assert.ok(!text(withArt).includes(labelRow));
  // a label is optional
  assert.ok(!text(bootAt120(P.titleEnd, { labelArt: undefined })).includes(labelRow));
});

test('boot, LINK LED: the console\'s LINK LED turns cyan as the last line lands (full tier); CART stays on in the accent colour', () => {
  const ledX = L.consoleX + 53 + 19, ledY = L.consoleTop + 3;
  const landed = P.on + LINES.length * LINE_SECONDS;
  const before = cellAt(boot(120, 40, landed - 0.02), ledX, ledY);
  const after = cellAt(boot(120, 40, landed + 0.01), ledX, ledY);
  assert.deepEqual([before.g, after.g], ['○', '●']);
  assert.equal(after.s, MAP(DRIFTMAN_COLOURS.cyan));
  assert.equal(cellAt(boot(120, 40, P.on), L.consoleX + 53 + 9, ledY).s, MAP(driftmanSkin.palette.ui.accent), 'CART LED on in the accent colour');
});

test('boot, Classic: the console keeps its own frame (a shimmer only), and the zoom edge is the console skin\'s frame glyphs - drawChrome\'s output', () => {
  const f = newFrame(120, 40);
  drawBoot(f, { skin: classicBootSkin, item: classicItem, labelArt: entries[0].label, t: 0.3, title: 'Drift Classic' }, driftmanSkin);
  assert.ok(text(f).includes('╔'), 'bezel unchanged');
  assert.ok(text(f).includes('DRIFT CLASSIC'), 'the seated cartridge\'s name plate');
  const z = newFrame(120, 40);
  drawBoot(z, { skin: classicBootSkin, item: classicItem, t: bootPhases(classicBootSkin).zoomEnd, title: 'Drift Classic' }, driftmanSkin);
  const ref = newFrame(120, 40);
  drawChrome(ref, classicBootSkin);
  assert.deepEqual(Array.from(z.glyphs), Array.from(ref.glyphs));
  assert.deepEqual(Array.from(z.shades), Array.from(ref.shades));
});

test('boot without an item behaves as before: the centred rectangle, no console, the same phases', () => {
  const f = newFrame(120, 40);
  drawBoot(f, { skin: BOOT_SKIN, t: P.linesEnd, title: 'Fixture' }, driftmanSkin);
  assert.ok(text(f).includes('CARTRIDGE'));
  assert.ok(!text(f).includes('PWR'), 'no console');
  const z = newFrame(120, 40);
  drawBoot(z, { skin: BOOT_SKIN, t: P.zoomEnd, title: 'Fixture' }, driftmanSkin);
  const ref = newFrame(120, 40);
  drawChrome(ref, BOOT_SKIN);
  assert.deepEqual(Array.from(z.glyphs), Array.from(ref.glyphs));
});

test('boot: every phase at every size draws allowed single-width glyphs in palette, owns every cell, and never throws (item or not, loading or not, down to 4x2)', () => {
  const variants = [
    { name: 'skinned item', skin: BOOT_SKIN, item: skinnedItem, map: MAP, len: merged.pal.sgr.length },
    { name: 'skinned plain', skin: BOOT_SKIN, item: undefined, map: undefined, len: cartPal.sgr.length },
    { name: 'classic item', skin: classicBootSkin, item: classicItem, map: undefined, len: LIB_LEN },
    { name: 'console skin', skin: driftmanSkin, item: classicItem, map: undefined, len: LIB_LEN },
  ];
  for (const [w, h] of SIZES) {
    for (const v of variants) {
      const total = bootSeconds(v.skin);
      for (const loading of [true, false]) {
        for (let t = 0; t <= total + 0.3; t += 0.1) {
          const args = { skin: v.skin, item: v.item, consoleMap: v.map, labelArt: fixture.label, bootArt: ['ART'], t, loading, title: 'Fixture' };
          const f = newFrame(w, h);
          assert.doesNotThrow(() => drawBoot(f, args, driftmanSkin), `${v.name} ${w}x${h} t=${t}`);
          assert.deepEqual(problems(f, v.len, `boot ${v.name} ${w}x${h} t=${t.toFixed(2)}`), []);
          const g = dirty(w, h);
          drawBoot(g, args, driftmanSkin);
          assert.deepEqual(Array.from(g.glyphs), Array.from(f.glyphs), `${v.name} ${w}x${h} t=${t}: owns every cell`);
          assert.deepEqual(Array.from(g.shades), Array.from(f.shades));
        }
      }
      const e = newFrame(w, h);
      assert.doesNotThrow(() => drawBoot(e, { skin: v.skin, item: v.item, t: 0, error: 'something went wrong in the scene file'.repeat(3), title: 'x' }, driftmanSkin));
      assert.deepEqual(problems(e, v.len, `boot error ${v.name} ${w}x${h}`), []);
    }
  }
  for (const bad of [NaN, -3, 1e9, undefined]) assert.doesNotThrow(() => drawBoot(newFrame(120, 40), { skin: BOOT_SKIN, item: skinnedItem, consoleMap: MAP, t: bad, title: 'T' }, driftmanSkin));
});

test('boot timeline: bootPhases (skin.boot.seconds) is unchanged', () => {
  assert.equal(Math.round(bootPhases({ palette: driftmanSkin.palette }).end * 100) / 100, 4.3);
  assert.equal(Math.round(bootPhases({ palette: driftmanSkin.palette, boot: { seconds: 3 } }).linesEnd * 100) / 100, 3.4);
});

// ---- the boot text (designer section 3): the console's voice

const CORE = ['DRIFTMAN 2000 · CORE 2.0', 'MEMORY 64K ..... OK'];
const CLASSIC_OWN = ['CARTRIDGE ...... DRIFT CLASSIC', 'SIGNAL ......... CALM', 'Nothing to do. Watch it drift.'];

test('boot text: every cartridge starts with the console\'s two core lines; Classic continues with its three; lines are at most 40 characters', () => {
  assert.deepEqual(driftmanSkin.boot.lines, CORE);
  assert.deepEqual(classicBootSkin.boot.lines, CLASSIC_OWN);
  assert.deepEqual(bootLines(classicBootSkin, driftmanSkin, 'Drift Classic'), [...CORE, ...CLASSIC_OWN], 'core lines first, then the cartridge\'s');
  for (const l of [...CORE, ...CLASSIC_OWN]) assert.ok([...l].length <= 40, l);
  assert.equal(validateSkin(JSON.parse(JSON.stringify(driftmanSkin))).ok, true, 'the console skin still validates');
  assert.equal(validateSkin(JSON.parse(JSON.stringify(classicBootSkin))).ok, true);
  // every one of the install's cartridges (and Delza's, when it comes): own boot lines fit the 40 characters and the validator's limit of 4 extra lines
  for (const c of discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges) {
    if (c.skin && c.skin.boot && c.skin.boot.lines) assert.ok(c.skin.boot.lines.length <= 4 && c.skin.boot.lines.every((l) => [...l].length <= 40), c.id);
  }
});

test('boot text: a cartridge with its own lines gets core + own; one without gets core + a CARTRIDGE line from its title; the console skin alone is core + that line', () => {
  assert.deepEqual(bootLines(BOOT_SKIN, driftmanSkin, 'Fixture'), [...CORE, ...BOOT_SKIN.boot.lines]);
  assert.equal(bootLines(BOOT_SKIN, driftmanSkin, 'Fixture').length, 6, 'two core lines and four of its own is the six lines the timeline is built on');
  const bare = { ...BOOT_SKIN, boot: undefined };
  assert.deepEqual(bootLines(bare, driftmanSkin, 'Fixture'), [...CORE, 'CARTRIDGE ...... FIXTURE']);
  assert.deepEqual(bootLines(bare, driftmanSkin, undefined), CORE, 'no title, no cartridge line');
  assert.deepEqual(bootLines(driftmanSkin, driftmanSkin, 'Fixture'), [...CORE, 'CARTRIDGE ...... FIXTURE'], 'the console skin is not counted twice');
  assert.deepEqual(bootLines(bare, undefined, 'Fixture'), ['CARTRIDGE ...... FIXTURE'], 'no console skin: just the cartridge line');
  assert.deepEqual(bootLines(plainBootSkin('A very long cartridge title indeed, longer than the screen'), driftmanSkin, 'x').slice(2).map((l) => [...l].length <= 40), [true]);
  assert.equal(plainBootSkin('Fixture').boot.seconds, undefined, 'a cartridge without a boot section keeps the normal 5.8 s timeline');
  assert.deepEqual(bootLines(plainBootSkin('Fixture'), driftmanSkin, 'Fixture'), [...CORE, 'CARTRIDGE ...... FIXTURE']);
  assert.equal(validateSkin(JSON.parse(JSON.stringify(plainBootSkin('Fixture')))).ok, true);
});

test('boot text, Classic: five lines at 0.25 s each (boot.seconds = 1.25), so the Classic boot ends with its five lines done; the shell passes it the whole sequence', () => {
  assert.equal(classicBootSkin.boot.seconds, 5 * LINE_SECONDS);
  const PC = bootPhases(classicBootSkin);
  assert.equal(PC.linesEnd - PC.on, 5 * LINE_SECONDS);
  // all five lines are on the console screen when the bar starts, the values in the accent colour
  const f = newFrame(120, 40);
  drawBoot(f, { skin: classicBootSkin, item: classicItem, t: PC.linesEnd + 0.01, title: 'Drift Classic' }, driftmanSkin);
  const ls = frameLines(f);
  for (const l of [...CORE, ...CLASSIC_OWN]) assert.ok(ls.some((x) => x.includes(l)), `on screen: ${l}`);
  const shadeOf = (word) => { const y = ls.findIndex((x) => x.includes(word) && x.includes('...')); return f.shades[y * 120 + ls[y].indexOf(word)]; };
  assert.equal(shadeOf('CALM'), driftmanSkin.palette.ui.accent);
  assert.equal(shadeOf('OK'), driftmanSkin.palette.ui.accent);
  assert.equal(shadeOf('DRIFT CLASSIC'), driftmanSkin.palette.ui.accent);
  const y1 = ls.findIndex((x) => x.includes('Nothing to do.'));
  assert.equal(f.shades[y1 * 120 + ls[y1].indexOf('Nothing')], driftmanSkin.palette.ui.text, 'a line with no dots stays in the text colour');
  // five lines then the bar: the Classic boot lasts the lines plus the 1.8 s of bar, zoom and title
  assert.ok(Math.abs(bootSeconds(classicBootSkin) - (0.4 + 1.25 + 0.4 + 0.8 + 0.6 + 0.6)) < 1e-9);
  // 80x24: the lines are clipped to the blurb box (34 columns), never wrapped over the edge
  const g = newFrame(80, 24);
  drawBoot(g, { skin: classicBootSkin, item: classicItem, t: PC.linesEnd + 0.01, title: 'Drift Classic' }, driftmanSkin);
  assert.ok(frameLines(g).some((x) => x.includes('Nothing to do. Watch it drift.')));
});

test('boot text: a line of more than 40 characters or more lines than the screen has rows are clipped, never overflow', () => {
  const sk = { ...BOOT_SKIN, boot: { lines: ['x'.repeat(60), ...Array.from({ length: 7 }, (_, i) => 'LINE ' + i)], art: false } };
  for (const [w, h] of [[120, 40], [80, 24], [30, 10]]) {
    const f = newFrame(w, h);
    assert.doesNotThrow(() => drawBoot(f, { skin: sk, item: skinnedItem, consoleMap: MAP, t: bootPhases(sk).linesEnd, title: 'T' }, driftmanSkin));
    assert.deepEqual(problems(f, merged.pal.sgr.length, `clip ${w}x${h}`), []);
  }
  const f = newFrame(120, 40);
  drawBoot(f, { skin: sk, item: skinnedItem, consoleMap: MAP, t: bootPhases(sk).linesEnd, title: 'T' }, driftmanSkin);
  const R = screenRect(120, 40);
  assert.equal(rowText(f, R.y + 3, R.x + 2, R.x + R.w - 3).trim(), 'x'.repeat(R.w - 4), 'the 60-character line is cut at the screen text width');
  assert.equal(rowText(f, R.y + 4, R.x + 2, R.x + R.w - 3).trim(), 'LINE 0');
  assert.equal(rowText(f, R.y + 6, R.x + 2, R.x + R.w - 3).trim(), 'LINE 2', 'six rows of text; the rest are dropped');
  assert.equal(cellAt(f, R.x + 2, R.y + 7).g, '[', 'and the last row is for the bar');
  assert.equal(cellAt(f, R.x + R.w - 1, R.y + 3).g, '|', 'the right edge of the screen is still the edge');});

// ---- through the real shell: it hands the boot the console and a palette that holds both

function directShell(startId, cols = 120, rows = 40) {
  const log = { left: false };
  const sh = createShell({
    cols, rows, cmode: 'truecolor', seed: 1, cartridges, lastCartridge: startId,
    consts: { SPEEDS, DISSOLVE_SECONDS, DEFAULT_FADE_SECONDS },
    host: { persist() {}, quit() {}, leaveToClassic() { log.left = true; } },
  });
  return { sh, log };
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 40)); };
const tickFor = (sh, seconds) => { for (let t = 0; t < seconds - 1e-9; t += 1 / FPS) sh.tick(Math.min(1 / FPS, seconds - t)); };

test('the shell boots on the console: the console stays on screen through the boot, in a palette holding the console\'s colours and the cartridge\'s; the running cartridge gets its own palette back', async () => {
  const { sh } = directShell('fixture');
  sh.key('enter');
  await settle();
  tickFor(sh, INSERT_END + 0.3);
  assert.equal(sh.screen, 'boot');
  const cartLen = makeSkinPalette(JSON.parse(JSON.stringify(fixture.skin)), 'truecolor', 'x').sgr.length;
  const shot = sh.frame();
  assert.ok(frameLines(shot).join('\n').includes('PWR'), 'the console is on screen during the boot');
  assert.equal(shot.palette.sgr.length, cartLen + 24, 'the cartridge palette, the console\'s 20 colours and the 4 tints');
  assert.ok(Math.max(...shot.shades) < shot.palette.sgr.length);
  tickFor(sh, bootSeconds(fixture.skin) + 0.5);
  await settle();
  tickFor(sh, 1);
  assert.equal(sh.screen, 'running');
  assert.equal(sh.frame().palette.sgr.length, cartLen, 'the running cartridge has its own palette (no console colours)');
});

test('the shell boots Classic on the console too, in the library palette, and hands back to the Classic path when the boot ends', () => {
  const { sh, log } = directShell('classic');
  sh.key('enter');
  tickFor(sh, INSERT_END + 0.5);
  assert.equal(sh.screen, 'boot');
  const shot = sh.frame();
  assert.ok(frameLines(shot).join('\n').includes('PWR'));
  assert.equal(shot.palette.sgr.length, LIB_LEN);
  assert.equal(log.left, false);
  tickFor(sh, bootSeconds(classicBootSkin) - 0.5 - 0.15);
  assert.equal(log.left, false, 'still booting 0.15 s before the end (INSERT_END + the five lines, the bar, the zoom and the title)');
  assert.equal(sh.screen, 'boot');
  tickFor(sh, 0.3);
  assert.equal(log.left, true, 'the Classic path takes over when the boot ends');
});

// ---- boot.valueColour (schema item 8): the words after a run of dots and a space take the skin's own shade

const VC = 5; // a palette index that is none of the fixture's text, dim or accent
const VC_SKIN = { ...BOOT_SKIN, boot: { ...BOOT_SKIN.boot, valueColour: VC } };
const vcBoot = (skin, t, cols = 120, rows = 40) => {
  const f = newFrame(cols, rows);
  drawBoot(f, { skin, item: skinnedItem, labelArt: fixture.label, t, loading: false, title: 'Fixture', consoleMap: MAP }, driftmanSkin);
  return f;
};
const shadesOf = (f, word, rowHas = word) => {
  const ls = frameLines(f);
  const y = ls.findIndex((l) => l.includes(rowHas));
  assert.ok(y >= 0, word + ' is on screen');
  const x = ls[y].indexOf(word);
  return [...word].map((_, i) => f.shades[y * f.cols + x + i]);
};

test('boot.valueColour: the skin validates, and the colour is distinct from text, dim and accent in the fixture (so the test can tell)', () => {
  assert.equal(validateSkin(JSON.parse(JSON.stringify(VC_SKIN))).ok, true);
  assert.equal(validateSkin(JSON.parse(JSON.stringify({ ...driftmanSkin, boot: { ...driftmanSkin.boot, valueColour: 17 } }))).ok, true, 'the console skin may set it too');
  assert.ok(![cartPal.ui.text, cartPal.ui.dim, cartPal.ui.accent].includes(VC));
});

test('boot.valueColour: "MEMORY 64K ..... OK" has its OK in that shade; the words, dots and plain lines keep text and dim', () => {
  const f = vcBoot(VC_SKIN, P.on + LINES.length * LINE_SECONDS + 0.01);
  assert.deepEqual(shadesOf(f, 'OK', 'MEMORY 64K'), [VC, VC]);
  assert.deepEqual(shadesOf(f, 'FIXTURE', 'CARTRIDGE ...'), Array(7).fill(VC));
  assert.deepEqual(shadesOf(f, 'UNROLLED', 'MAP ...'), Array(8).fill(VC));
  assert.deepEqual(shadesOf(f, 'MEMORY', 'MEMORY 64K'), Array(6).fill(cartPal.ui.text), 'the text before the dots is untouched');
  assert.deepEqual(shadesOf(f, '.....'), Array(5).fill(cartPal.ui.dim), 'the dots are untouched');
  assert.deepEqual(shadesOf(f, 'forest'), Array(6).fill(cartPal.ui.text), 'a line without dots is all text');
});

test('boot.valueColour: absent, the value words keep the accent exactly, and the frames equal those of a skin that never heard of it', () => {
  const absent = { ...BOOT_SKIN, boot: { ...BOOT_SKIN.boot } };
  for (const t of [P.on + 0.3, P.on + LINES.length * LINE_SECONDS + 0.01, P.linesEnd + 0.2]) {
    const a = vcBoot(BOOT_SKIN, t), b = vcBoot(absent, t);
    assert.deepEqual(Array.from(a.shades), Array.from(b.shades));
    assert.deepEqual(Array.from(a.glyphs), Array.from(b.glyphs));
  }
  assert.deepEqual(shadesOf(vcBoot(BOOT_SKIN, P.on + LINES.length * LINE_SECONDS + 0.01), 'OK', 'MEMORY 64K'), [ACCENT, ACCENT]);
  const withColour = vcBoot(VC_SKIN, P.on + LINES.length * LINE_SECONDS + 0.01), without = vcBoot(BOOT_SKIN, P.on + LINES.length * LINE_SECONDS + 0.01);
  assert.deepEqual(Array.from(withColour.glyphs), Array.from(without.glyphs), 'only shades change, never glyphs');
});

test('boot.valueColour: the console skin own value colour is used when it is the boot skin (Classic path)', () => {
  const cs = { ...classicBootSkin, boot: { ...classicBootSkin.boot, valueColour: 17 } };
  const f = newFrame(120, 40);
  const PC = bootPhases(cs);
  drawBoot(f, { skin: cs, item: classicItem, t: PC.linesEnd + 0.01, title: 'Drift Classic' }, driftmanSkin);
  const ls = frameLines(f);
  const y = ls.findIndex((x) => x.includes('CALM') && x.includes('...'));
  assert.equal(f.shades[y * 120 + ls[y].indexOf('CALM')], 17);
  const y0 = ls.findIndex((x) => x.includes('Nothing to do.'));
  assert.equal(f.shades[y0 * 120 + ls[y0].indexOf('Nothing')], driftmanSkin.palette.ui.text);
});
