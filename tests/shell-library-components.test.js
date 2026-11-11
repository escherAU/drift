// DRIFT-4 slice 2, A1: the library's components (cartridge 30x18, console 84x18, mini 38x4, spine 4x10)
// and its layout tiers (full 120x40, extra-large 240x67, compact 80x24, list, tiny).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAllowedGlyph } from '../src/glyphs.js';
import { driftmanSkin } from '../src/shell/driftman.js';
import {
  cartridgeGrid, consoleGrid, miniGrid, spineGrid, consoleStyle, gridRows, drawLibrary, shelfLayout, isExtraLarge,
  slideOffset, CART_W, CART_H, CONSOLE_W, CONSOLE_H, MINI_W, MINI_H, SPINE_W, SPINE_H, SOON_STRIP, DIAL_POSITIONS, XL_COLS, XL_ROWS, LIBRARY_HINT,
} from '../src/shell/library.js';
import { LOCKED_MESSAGE } from '../src/shell/shell.js';
import { newFrame, sizeTier } from '../src/shell/ui.js';
import { isWide, isInvisible } from './helpers-width.js';
import { frameLines } from './helpers-help.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const labelOf = (id) => fs.readFileSync(path.join(ROOT, 'cartridges', id, 'label.txt'), 'utf8').split(/\r?\n/).map((l) => l.replace(/ +$/, '')).slice(0, 10);
const ui = driftmanSkin.palette.ui;
const style = consoleStyle(driftmanSkin);

const TITLES = [
  ['classic', 'Drift Classic', 'DM-00', false, "Today's Drift, exactly as you know it. Calm by default, four modes, 21 scenes.", ['4 modes', '21 scenes', 'the original']],
  ['night-drive', 'Night Drive', 'DM-02', true, 'Neon highway, endless dusk, and a car that never needs fuel.', []],
  ['last-fantasy', 'Last Fantasy', 'DM-04', true, 'Twin moons, a sea of cloud, and one beacon at the edge of the world.', []],
  ['arcade', 'Arcade', 'DM-03', true, 'Bricks, a ball, a paddle, and a high score nobody remembers setting.', []],
  ['delza', 'Delza', 'DM-01', false, "A lamplighter's apprentice crosses the Hollowmere Reach to relight a dark city.", ['6 scenes', 'woodsy fantasy', 'about 16 min']],
];
// n cartridges: the five above, then numbered extras (playable and locked alternately)
function carts(n) {
  return Array.from({ length: n }, (_, i) => {
    const [id, title, code, locked, blurb, facts] = TITLES[i] || [`extra-${i}`, `Extra ${i}`, `EX-${String(i).padStart(2, '0')}`, i % 2 === 0, `Extra cartridge number ${i}.`, []];
    return { id, title, code, locked, blurb, facts, label: labelOf(TITLES[i] ? (id === 'delza' ? 'classic' : id) : 'arcade'), ink: null, tint: 20 + 4 * i };
  });
}
const view = (n, index = 0, extra = {}) => ({ cartridges: carts(n), index, prev: index, slide: 1, message: '', dip: 0, ...extra });
const draw = (cols, rows, v) => { const f = newFrame(cols, rows); drawLibrary(f, v, driftmanSkin); return f; };
const lines = (f) => frameLines(f);
const count = (s, sub) => s.split(sub).length - 1;

// ---- component sizes

test('cartridge component: exactly 30 columns x 18 rows in every variant, label window 24 wide, plate 19 + 5', () => {
  for (const c of carts(5)) {
    for (const selected of [true, false]) {
      const rows = gridRows(cartridgeGrid(c, { selected, level: selected ? 3 : 1, ui }));
      assert.equal(rows.length, CART_H, `${c.id} rows`);
      assert.ok(rows.every((r) => [...r].length === CART_W), `${c.id} widths ${rows.map((r) => [...r].length)}`);
      // S3..S12: the window is bordered at columns 2 and 27, the art sits in the 24 between
      for (let r = 3; r <= 12; r++) assert.equal([...rows[r]].slice(3, 27).length, 24, `${c.id} S${r}`);
      assert.equal([...rows[2]].slice(3, 27).length, 24);
      // S14: "V  " + name padded to 19 + code (5) + "  V"
      const plate = [...rows[14]];
      assert.equal(plate.slice(3, 22).join('').trimEnd(), c.title.toUpperCase());
      assert.equal(plate.slice(22, 27).join(''), c.locked ? 'SOON ' : c.code.padEnd(5));
      assert.equal(plate[1] + plate[2] + plate[27] + plate[28], '    ');
    }
  }
  // the shell rows follow the spec exactly (corners, tees, grip ridges, tongue)
  const r = gridRows(cartridgeGrid(carts(1)[0], { selected: true, level: 3, ui }));
  assert.equal(r[0], '╭' + '─'.repeat(28) + '╮');
  assert.equal(r[1].slice(0, 7), '│  ════');
  assert.equal(r[1][25], '●', 'shell LED, selected');
  assert.equal(r[2], '│ ┌' + '─'.repeat(24) + '┐ │');
  assert.equal(r[13], '│ └' + '─'.repeat(24) + '┘ │');
  assert.equal(r[15], '╰──┬' + '─'.repeat(22) + '┬──╯');
  assert.equal(r[16], '   │' + '▌'.repeat(22) + '│   ');
  assert.equal(r[17], '   ╰' + '─'.repeat(22) + '╯   ');
  // the tongue (columns 3-26) is the 24 wide mouth-sized part
  assert.equal([...r[15]].indexOf('┬'), 3);
  assert.equal([...r[15]].lastIndexOf('┬'), 26);
  const unsel = gridRows(cartridgeGrid(carts(1)[0], { selected: false, level: 1, ui }));
  assert.equal(unsel[1][25], '○', 'shell LED, not selected');
  // control: a hand-miscounted row would be caught by the same check
  assert.notEqual([...('│  ════' + ' '.repeat(17) + '●   │')].length, CART_W);
});

test('cartridge component, locked: dashed lines, LED off, no contacts, SOON, the strip replaces label row 4', () => {
  const locked = carts(5)[1];
  const rows = gridRows(cartridgeGrid(locked, { selected: true, level: 3, ui }));
  assert.equal(rows.length, CART_H);
  assert.ok(rows.every((r) => [...r].length === CART_W));
  assert.equal(rows[0], '╭' + '┄'.repeat(28) + '╮', 'corners stay, lines dash');
  assert.equal(rows[15], '╰┄┄┬' + '┄'.repeat(22) + '┬┄┄╯', 'tees stay');
  assert.equal(rows[17], '   ╰' + '┄'.repeat(22) + '╯   ');
  assert.equal(rows[16], '   ┆' + ' '.repeat(22) + '┆   ', 'no contacts');
  assert.ok(!rows.join('').includes('▌'), 'no contacts anywhere');
  assert.equal(rows[1][25], '○', 'LED off');
  assert.equal([...rows[14]].slice(22, 27).join(''), 'SOON ');
  for (let r = 1; r <= 14; r++) { assert.equal([...rows[r]][0], '┆'); assert.equal([...rows[r]][29], '┆'); }
  for (const r of [0, 2, 13, 15, 17]) assert.ok(!rows[r].includes('─'), `row ${r} has no solid line`);
  // the strip
  assert.equal([...SOON_STRIP].length, 24);
  assert.equal(SOON_STRIP, '────── COMING SOON ─────');
  assert.equal([...rows[3 + 4]].slice(3, 27).join(''), SOON_STRIP, 'label row 4');
  // the label is at the dimmest shade only (tint + 0), the strip in dim text
  const G = cartridgeGrid(locked, { selected: true, level: 3, ui });
  const shades = new Set();
  for (let r = 3; r <= 12; r++) for (let c = 3; c < 27; c++) { const i = r * G.w + c; if (G.g[i] !== 32 && r !== 7) shades.add(G.s[i]); }
  assert.deepEqual([...shades], [locked.tint], 'dimmest shade of the cartridge tint');
  // a playable cartridge with the same label keeps its solid lines and brighter shades
  const play = cartridgeGrid({ ...locked, locked: false }, { selected: true, level: 3, ui });
  assert.ok(gridRows(play).join('').includes('▌'));
  assert.ok(!gridRows(play)[7].includes('COMING'));
  assert.ok(play.s.some((s) => s === locked.tint + 3));
});

test('console: 18 rows of exactly 84, each body row is "│ " + bezel(48) + "   " + panel(29) + " │"; mini 38x4; spine 4x10', () => {
  for (const [i, c] of carts(5).entries()) {
    const rows = gridRows(consoleGrid(c, { st: style, ui, n: 5, index: i }));
    assert.equal(rows.length, CONSOLE_H);
    assert.ok(rows.every((r) => [...r].length === CONSOLE_W), rows.map((r) => [...r].length).join());
    for (let k = 3; k <= 13; k++) {
      const row = [...rows[k]];
      assert.equal(row[0], '│'); assert.equal(row[1], ' ');
      const bezel = row.slice(2, 50);
      assert.equal(bezel.length, 48);
      assert.ok('╔║╚'.includes(bezel[0]) && '╗║╝'.includes(bezel[47]), `bezel edges row ${k}`);
      assert.equal(row.slice(50, 53).join(''), '   ');
      assert.equal(row.slice(53, 82).length, 29);
      assert.equal(row[82], ' '); assert.equal(row[83], '│');
    }
    assert.equal(rows[0].trim(), '▄'.repeat(28));
    assert.equal(rows[0].indexOf('▄'), 28);
    assert.equal(rows[1].slice(28, 30) + rows[1].slice(54, 56), '█▌▐█');
    assert.equal(rows[2][30], '▄');
    assert.equal(rows[14], '╞' + '═'.repeat(82) + '╡');
    assert.ok(rows[15].includes('D R I F T M A N   2 0 0 0') && rows[15].includes('MODEL DM-2000'));
    assert.ok(rows[15].includes('╱╱╱╱'));
    assert.equal(rows[16], '╰' + '─'.repeat(82) + '╯');
    assert.match(rows[17], /^ {3}▀{6} +▀{6} {3}$/);
  }
  const mini = gridRows(miniGrid({ st: style, ui }));
  assert.equal(mini.length, MINI_H);
  assert.ok(mini.every((r) => [...r].length === MINI_W), mini.map((r) => [...r].length).join());
  assert.equal(mini[0], '     ' + '▄'.repeat(28) + '     ');
  assert.equal(mini[1], '╭────█▌' + ' '.repeat(24) + '▐█────╮');
  assert.equal(mini[2], '│ ● PWR  ○ CART    DRIFTMAN 2000     │');
  assert.equal(mini[3], '╰' + '─'.repeat(36) + '╯');
  for (const c of carts(5)) for (const selected of [true, false]) {
    const sp = gridRows(spineGrid(c, { selected, ui }));
    assert.equal(sp.length, SPINE_H);
    assert.ok(sp.every((r) => [...r].length === SPINE_W), sp.join('|'));
  }
});

test('console screen: name and code, rule, blurb in 2 lines of 44, facts, the prompt; locked copy', () => {
  const [classic, nightDrive] = carts(2);
  const text = (c, n = 5) => gridRows(consoleGrid(c, { st: style, ui, n, index: 0 })).slice(3, 14).map((r) => [...r].slice(2, 50).join(''));
  const t = text(classic);
  assert.equal(t[0], '╔' + '═'.repeat(46) + '╗');
  assert.equal(t[1], '║ DRIFT CLASSIC' + ' '.repeat(44 - 13 - 5) + 'DM-00 ║');
  assert.equal(t[2], '║ ' + '─'.repeat(44) + ' ║');
  assert.equal(t[3].trim().slice(2, 12), "Today's Dr");
  assert.ok(t[3].length === 48 && t[4].length === 48);
  assert.equal(t[3].slice(2, 46).trimEnd(), "Today's Drift, exactly as you know it. Calm");
  assert.equal(t[4].slice(2, 46).trimEnd(), 'by default, four modes, 21 scenes.');
  assert.ok(t[6].includes('4 modes · 21 scenes · the original'), 'facts');
  assert.ok(t[8].includes('▶ Enter to insert▌'), 'prompt');
  assert.equal(t[10], '╚' + '═'.repeat(46) + '╝');
  const l = text(nightDrive);
  assert.ok(l[1].includes('NIGHT DRIVE') && l[1].includes('SOON'), 'name and SOON');
  assert.ok(l[6].includes('Not on the shelf yet.'));
  assert.ok(l[8].includes('◀ ▶ to browse'));
  assert.ok(!l.join('').includes('Enter to insert'));
  assert.ok(!text(nightDrive, 1).join('').includes('to browse'), 'nothing to browse with one cartridge');
});

test('the TUNE dial has 8 pointer positions driven by the cartridge index', () => {
  assert.equal(DIAL_POSITIONS, 8);
  const dial = (i) => gridRows(consoleGrid(carts(1)[0], { st: style, ui, n: 9, index: i })).slice(5, 10).map((r) => r.slice(54, 63)).join('\n');
  const seen = new Set(Array.from({ length: 8 }, (_, i) => dial(i)));
  assert.equal(seen.size, 8, 'eight different dials');
  assert.equal(dial(8), dial(0), 'and it wraps');
  assert.match(dial(2), /●──/, 'right: a pointer to the right of the centre');
  assert.match(dial(6), /──●/, 'left');
  assert.ok(dial(0).split('\n')[1].includes('│') && dial(4).split('\n')[3].includes('│'), 'up and down are bars');
  assert.ok(dial(1).includes('╱') && dial(3).includes('╲') && dial(5).includes('╱') && dial(7).includes('╲'));
});

// ---- layout tiers

test('120x40 follows the designer row plan: dots 0, cartridges 2-19, console 20-37, hints 38; the cartridge sits over the slot mouth', () => {
  const f = draw(120, 40, view(5, 4));
  const L = lines(f);
  assert.equal(sizeTier(120, 40), 'full');
  assert.match(L[0], /^ +○ ○ ○ ○ ● +$/, 'dots on row 0');
  assert.equal(L[1].trim(), '');
  assert.equal(L[2].slice(45, 75), '╭' + '─'.repeat(28) + '╮', 'selected cartridge top at row 2, columns 45-74');
  assert.equal(L[19].slice(48, 72), '╰' + '─'.repeat(22) + '╯', 'tongue bottom, columns 48-71');
  assert.equal(L[17][48], '┬'); assert.equal(L[17][71], '┬');
  assert.equal(L[20].slice(46, 74), '▄'.repeat(28), 'console housing row 20');
  assert.equal(L[21].slice(46, 48) + L[21].slice(72, 74), '█▌▐█', 'the mouth is columns 48-71');
  assert.equal(L[22][18], '╭'); assert.equal(L[22][101], '╮', 'console columns 18-101');
  assert.equal(L[37].slice(21, 27), '▀▀▀▀▀▀', 'feet are the last console row');
  assert.equal(L[38].trim(), '◀ ▶ choose   Enter insert   h help   q quit');
  assert.equal(L[38].trim(), LIBRARY_HINT);
  assert.equal(L[39].trim(), '');
  // the mouth is under the middle of the tongue: centred on the screen too
  assert.equal(45 + 15, 60);
  assert.equal(shelfLayout(120, 40, 'full').cartX, 45);
  assert.equal(shelfLayout(120, 40, 'full').consoleX, 18);
  // hint colours: keys silver (ui.text), words dim
  const y = 38;
  const keyX = L[y].indexOf('Enter'), wordX = L[y].indexOf('insert');
  assert.equal(f.shades[y * 120 + keyX], ui.text);
  assert.equal(f.shades[y * 120 + wordX], ui.dim);
  // neighbours: dimmed chrome (graphite), the far ones as 7 column slivers at the screen edges
  assert.equal(L[2].slice(0, 7).trim().length, 7);
  assert.equal(f.shades[2 * 120 + 11 + 5], 18, 'neighbour chrome is graphite');
  assert.equal(L[2].slice(113, 120), '╭┄┄┄┄┄┄', 'right sliver: the left 7 columns of the far neighbour');
  assert.equal(L[2].slice(0, 7), '┄┄┄┄┄┄╮', 'left sliver: the right 7 columns of the far neighbour');
  // locked selected: dashed, SOON
  const g = draw(120, 40, view(5, 1));
  assert.equal(lines(g)[2].slice(45, 75), '╭' + '┄'.repeat(28) + '╮');
  assert.ok(lines(g)[16].includes('SOON'));
});

test('120x40 stays centred and whole at the full-tier minimum 88x39 and at odd sizes', () => {
  for (const [w, h] of [[88, 39], [89, 41], [120, 45], [131, 40]]) {
    const L = lines(draw(w, h, view(4, 0)));
    const y0 = Math.floor((h - 39) / 2);
    const sx = Math.floor(w / 2) - 15;
    assert.equal(L[y0 + 2].slice(sx, sx + 30), '╭' + '─'.repeat(28) + '╮', `${w}x${h}`);
    assert.ok(L[y0 + 38].includes('Enter insert'));
    assert.equal(L[y0 + 20].indexOf('▄'), Math.floor(w / 2) - 14, 'housing centred');
  }
});

test('240x67: five cartridges, a spine shelf and a desk line, centred, nothing scaled or duplicated', () => {
  assert.ok(isExtraLarge(240, 67) && !isExtraLarge(175, 67) && !isExtraLarge(240, 57));
  assert.equal(XL_COLS, 176); assert.equal(XL_ROWS, 58);
  const f = draw(240, 67, view(5, 2));
  const L = lines(f);
  const all = L.join('\n');
  // 5 cartridges, each name plate exactly once, plus 5 spines; the console is one
  for (const c of carts(5)) assert.equal(count(all, `  ${c.title.toUpperCase()}`.padEnd(21)), 1, c.title);
  assert.equal(count(all, '╭' + '─'.repeat(28) + '╮') + count(all, '╭' + '┄'.repeat(28) + '╮'), 5);
  assert.equal(count(all, '█▙' + '▄'.repeat(24) + '▟█'), 1, 'one console');
  // geometry: y0 = (67 - 53) / 2 = 7: dots 7, spines 9-18, shelf 19, cartridges 21-38, console 39-56, desk 57, hint 59
  const lay = shelfLayout(240, 67, 'full');
  assert.deepEqual([lay.y0, lay.dotsY, lay.spineY, lay.shelfY, lay.cartTop, lay.consoleTop, lay.deskY, lay.hintY], [7, 7, 9, 19, 21, 39, 57, 59]);
  assert.match(L[7], /○ ○ ● ○ ○/);
  // spines: 5 of 4x10 at a pitch of 5, centred
  const spineRow = L[9];
  assert.equal(count(spineRow, '╭──╮') + count(spineRow, '╭┄┄╮'), 5);
  assert.equal(spineRow.indexOf('╭'), Math.floor((240 - 24) / 2), 'the spine shelf is centred');
  assert.equal(L[18].indexOf('╰'), spineRow.indexOf('╭'));
  assert.ok(/^ *▁+ *$/.test(L[19]), 'a shelf board under the spines');
  // the lit spine is the selected one (index 2): silver frame, tint letters
  const spineX = spineRow.indexOf('╭') + 2 * 5;
  assert.equal(f.shades[10 * 240 + spineX], 13, 'lit spine frame');
  assert.equal(f.shades[10 * 240 + spineX + 2], carts(5)[2].tint + 3, 'lit spine letter (the selected one is locked: dashed, no stripe)');
  assert.equal(f.shades[10 * 240 + spineRow.indexOf('╭')], 18, 'unlit spine frame is graphite');
  // the cluster of 5 cartridges is 166 columns, centred: first column 37, last 202
  assert.equal(L[21].indexOf('╭'), 37);
  assert.equal(L[21].lastIndexOf('╮'), 202);
  assert.equal(L[21].slice(105, 135), '╭' + '┄'.repeat(28) + '╮', 'centre cartridge (locked, dashed), normal size 30 wide');
  // the console is the normal 84 wide, 102 / 156 centred; the desk line is under the feet
  assert.equal(L[41].indexOf('╭'), 78);
  assert.equal(L[41].lastIndexOf('╮'), 161);
  assert.equal(L[56].indexOf('▀'), 81);
  const desk = L[57];
  assert.equal(count(desk, '▔'), 100);
  assert.equal(desk.indexOf('▔'), 70);
  assert.equal(L[59].trim(), LIBRARY_HINT);
  // the same cartridge two places over wraps: with 4 cartridges nothing is drawn twice
  const four = lines(draw(240, 67, view(4, 0))).join('\n');
  for (const c of carts(4)) assert.equal(count(four, `  ${c.title.toUpperCase()}`.padEnd(21)), 1, `${c.title} once with 4`);
  // below the thresholds the same cluster is the plain full tier (no spines, no desk line)
  const plain = lines(draw(175, 67, view(5, 2))).join('\n');
  assert.ok(!plain.includes('▁▁▁▁') && !plain.includes('▔'));
});

test('80x24 compact: the cartridge, the list and the mini console, side by side, no overlap', () => {
  const f = draw(80, 24, view(5, 4));
  const L = lines(f);
  assert.equal(sizeTier(80, 24), 'compact');
  const lay = shelfLayout(80, 24, 'compact');
  assert.deepEqual([lay.cartX, lay.cartTop, lay.listX, lay.miniX, lay.miniTop], [4, 1, 40, 0, 19]);
  assert.equal(L[1].slice(4, 34), '╭' + '─'.repeat(28) + '╮');
  assert.equal(L[18].slice(7, 31), '╰' + '─'.repeat(22) + '╯');
  assert.equal(L[19].slice(5, 33), '▄'.repeat(28));
  assert.equal(L[21], '│ ● PWR  ○ CART    DRIFTMAN 2000     │' + ' '.repeat(42));
  assert.match(L[1], /CARTRIDGES +5 \/ 5 *$/);
  assert.ok(L[2].slice(40, 78) === '─'.repeat(38));
  const names = L.slice(4, 9).map((l) => l.slice(40, 78).trim());
  assert.ok(names[0].startsWith('Drift Classic') && names[0].endsWith('DM-00'));
  assert.ok(names[1].startsWith('Night Drive') && names[1].endsWith('soon'));
  assert.ok(L[8][40] === '▶' && names[4].includes('Delza'), 'cursor on Delza');
  assert.equal(L[10].slice(40, 78), '┌' + '─'.repeat(36) + '┐', 'the blurb box');
  assert.equal(L[18].slice(40, 78), '└' + '─'.repeat(36) + '┘');
  assert.ok(L[17].includes('▶ Enter to insert'));
  assert.equal(L[23].trim(), '↑ ↓ choose   Enter insert   h help   q quit');
  // no overlap: cartridge (4..33 x 1..18), list pane (40..77 x 1..18), mini (0..37 x 19..22) are disjoint rectangles
  const rects = [[4, 1, 30, 18], [40, 1, 38, 18], [0, 19, 38, 4]];
  for (let a = 0; a < rects.length; a++) {
    const [x, y, w, h] = rects[a];
    assert.ok(x >= 0 && y >= 0 && x + w <= 80 && y + h <= 24);
    for (let b = a + 1; b < rects.length; b++) {
      const [x2, y2, w2, h2] = rects[b];
      assert.ok(x + w <= x2 || x2 + w2 <= x || y + h <= y2 || y2 + h2 <= y, `rects ${a} and ${b} overlap`);
    }
  }
  // the glyph budget: the right column holds nothing left of column 40 on rows 1-18 beyond the cartridge
  for (let y = 1; y <= 18; y++) assert.equal(L[y].slice(34, 40).trim(), '', `gap row ${y}`);
  // locked: copy in the box
  const g = lines(draw(80, 24, view(5, 1))).join('\n');
  assert.ok(g.includes('Not on the shelf yet.') && g.includes('↑ ↓ to browse'));
  assert.ok(!g.includes('Enter to insert'));
});

test('list tier (>= 40x10): the list and a hint, no art; below it one line asking for a bigger window', () => {
  const f = draw(40, 10, view(5, 2));
  const t = lines(f).join('\n');
  assert.ok(t.includes('CARTRIDGES') && t.includes('3 / 5') && t.includes('▶ Last Fantasy'));
  assert.ok(!t.includes('╭') && !t.includes('▄'), 'no art');
  assert.ok(lines(f)[9].includes('Enter insert'));
  const tiny = lines(draw(39, 10, view(5, 2))).join(' ').replace(/\s+/g, ' ').trim();
  assert.equal(tiny, 'Make the window bigger to see the cartridges.'.slice(0, tiny.length), 'wrapped, in order');
  assert.ok(tiny.length >= 40 && !tiny.includes('Drift Classic'));
});

test('one cartridge: no neighbours, no dots, the hint drops "choose"', () => {
  const f = draw(120, 40, view(1, 0));
  const L = lines(f);
  assert.equal(L[0].trim(), '', 'no dots');
  assert.equal(count(L[2], '╭'), 1, 'one cartridge on the shelf');
  assert.equal(L[2].slice(45, 75), '╭' + '─'.repeat(28) + '╮');
  assert.equal(L[38].trim(), 'Enter insert   h help   q quit');
  assert.ok(!L.join('\n').includes('choose'));
  const c = lines(draw(80, 24, view(1, 0)));
  assert.equal(c[23].trim(), 'Enter insert   h help   q quit');
  assert.ok(!c.join('\n').includes('choose'));
  // two cartridges: the one neighbour is on the right, none on the left
  const two = lines(draw(120, 40, view(2, 0)))[2];
  assert.equal(two.slice(79, 109), '╭' + '┄'.repeat(28) + '╮');
  assert.equal(two.slice(0, 41).trim(), '');
});

test('more than 5 cartridges: the carousel wraps, dots become "k / n", the compact list scrolls with "N more" rows', () => {
  const n = 14;
  const f = draw(120, 40, view(n, 2));
  assert.equal(lines(f)[0].trim(), '3 / 14');
  const wrapped = lines(draw(120, 40, view(n, n - 1)));
  assert.ok(wrapped[2].includes('╭'), 'cursor on the last: draws, with the first on its right');
  assert.equal(wrapped[0].trim(), '14 / 14');
  // compact list: 5 slots; the window follows the cursor and the first/last slot say how many are hidden
  const mid = lines(draw(80, 24, view(n, 6))).slice(4, 9).map((l) => l.slice(40, 78).trim());
  assert.match(mid[0], /^↑ \d+ more$/);
  assert.match(mid[4], /^↓ \d+ more$/);
  assert.ok(mid.slice(1, 4).some((l) => l.includes('Extra 6')), 'the cursor row is on screen');
  const up = Number(mid[0].match(/\d+/)[0]), down = Number(mid[4].match(/\d+/)[0]);
  assert.equal(up + down + 3, n, 'hidden + shown = all');
  const top = lines(draw(80, 24, view(n, 0))).slice(4, 9).map((l) => l.slice(40, 78).trim());
  assert.ok(top[0].includes('Drift Classic') && /^↓ \d+ more$/.test(top[4]) && !top.join('').includes('↑'));
  const end = lines(draw(80, 24, view(n, n - 1))).slice(4, 9).map((l) => l.slice(40, 78).trim());
  assert.match(end[0], /^↑ \d+ more$/);
  assert.ok(end[4].includes('Extra 13') && !end.join('').includes('↓'));
  // every cursor position keeps its row on screen, in both list tiers
  for (let i = 0; i < n; i++) {
    for (const [w, h] of [[80, 24], [40, 10]]) assert.ok(lines(draw(w, h, view(n, i))).join('\n').includes(i < 5 ? TITLES[i][1] : `Extra ${i}`), `${w}x${h} #${i}`);
  }
});

test('locked Enter message copy', () => {
  assert.equal(LOCKED_MESSAGE, "This cartridge isn't ready yet. Pick another with ◀ ▶.");
  const f = lines(draw(120, 40, view(5, 1, { message: LOCKED_MESSAGE })));
  assert.ok(f[1].includes(LOCKED_MESSAGE), 'shown on the row between the dots and the cartridges');
  const c = lines(draw(80, 24, view(5, 1, { message: LOCKED_MESSAGE })));
  assert.ok(c[23].includes(LOCKED_MESSAGE), 'compact: in place of the hint');
});

// ---- contract at every size

function problems(f, palLen, label) {
  const bad = [];
  for (let i = 0; i < f.glyphs.length; i++) {
    const cp = f.glyphs[i];
    if (!isAllowedGlyph(cp)) bad.push(`${label}: cell ${i} U+${cp.toString(16)} not allowed`);
    else if (isWide(cp) || isInvisible(cp)) bad.push(`${label}: cell ${i} U+${cp.toString(16)} wide or invisible`);
    if (f.shades[i] >= palLen) bad.push(`${label}: cell ${i} shade ${f.shades[i]} >= ${palLen}`);
    if (cp === 32 && f.shades[i] !== 0) bad.push(`${label}: blank cell ${i} has shade ${f.shades[i]}`);
    if (bad.length > 3) break;
  }
  return bad;
}
function dirty(cols, rows) {
  const f = newFrame(cols, rows);
  f.glyphs.fill(0x2588); f.shades.fill(3);
  return f;
}

test('every size draws only allowed single-width glyphs, in-palette shades, owns every cell and never throws', () => {
  for (const [w, h] of [[240, 67], [120, 40], [80, 24], [30, 10], [4, 2], [88, 39], [176, 58], [175, 57], [78, 24], [40, 10], [1, 1], [0, 0]]) {
    for (const n of [1, 2, 3, 5, 9]) {
      for (const index of [0, n - 1, Math.floor(n / 2)]) {
        for (const extra of [{}, { message: LOCKED_MESSAGE }, { dip: 1 }, { prev: (index + 1) % n, slide: 0.5 }]) {
          const v = view(n, index, extra);
          const pal = 20 + 4 * n;
          const f = newFrame(w, h);
          assert.doesNotThrow(() => drawLibrary(f, v, driftmanSkin), `${w}x${h} n=${n} #${index}`);
          assert.deepEqual(problems(f, pal, `${w}x${h} n=${n} #${index}`), []);
          const g = dirty(w, h);
          drawLibrary(g, v, driftmanSkin);
          assert.deepEqual(Array.from(g.glyphs), Array.from(f.glyphs), `${w}x${h} n=${n}: owns every cell (glyphs)`);
          assert.deepEqual(Array.from(g.shades), Array.from(f.shades), `${w}x${h} n=${n}: owns every cell (shades)`);
        }
      }
    }
  }
});

test('the brightness ramp: the cursor cartridge brightens and the previous one dims, one level per step', () => {
  const tintAt = (slide) => {
    const f = draw(120, 40, view(5, 4, { prev: 0, slide }));
    // label shade of a cell in the middle of each cartridge's art (row 8 of the frame = label row 5)
    // (the shelf is displaced while it slides: 5 cartridges, 0 -> 4 is the short way left, so dir -1)
    const shift = slideOffset(slide, -1);
    const cell = (x) => f.shades[10 * 120 + x + shift];
    return [cell(45 + 3 + 11), cell(79 + 3 + 11)];
  };
  const steps = [0, 0.25, 0.5, 0.75, 1].map(tintAt);
  const tint = (i) => carts(5)[i].tint;
  assert.deepEqual(steps.map((s) => s[0] - tint(4)), [1, 2, 2, 3, 3]);
  assert.deepEqual(steps.map((s) => s[1] - tint(0)), [3, 2, 2, 1, 1]);
});
