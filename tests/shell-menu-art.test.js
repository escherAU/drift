// DRIFT-4 A4: the cartridge menu (list, slots, grid) and the chrome border, drawn properly.
// The skins here are plain objects (the drawers take any skin; validation is tested elsewhere).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedGlyph } from '../src/glyphs.js';
import { drawMenu } from '../src/shell/menu.js';
import { drawChrome, chromeOrnament, drawEdgeOrnament } from '../src/shell/chrome.js';
import { newFrame } from '../src/shell/ui.js';
import { DEFAULT_UI } from '../src/cartridge/palette.js';
import { isWide, isInvisible } from './helpers-width.js';
import { frameLines } from './helpers-help.js';

const SIZES = [[240, 67], [120, 40], [80, 24], [30, 10], [4, 2]];
const UI = { text: 5, dim: 3, head: 9, accent: 12 };
const PAL_LEN = 20;
const mkSkin = (layout, menu = {}, ui = UI) => ({ palette: { ui }, menu: { layout, anchor: 'center', title: 'Menu title', ...menu } });
const mkEntries = (n) => Array.from({ length: n }, (_, i) => ({ label: `Program ${i + 1}`, ...(i === 1 ? { current: true } : {}) }));
const text = (f) => frameLines(f).join('\n');
const cell = (f, x, y) => y * f.cols + x;

function dirty(cols, rows) {
  const f = newFrame(cols, rows);
  for (let i = 0; i < f.glyphs.length; i++) { f.glyphs[i] = 0x2593; f.shades[i] = 1; }
  return f;
}
function problems(f, label) {
  const bad = [];
  for (let i = 0; i < f.glyphs.length && bad.length < 4; i++) {
    const cp = f.glyphs[i];
    if (!isAllowedGlyph(cp)) bad.push(`${label}: cell ${i} U+${cp.toString(16)} not allowed`);
    else if (isWide(cp) || isInvisible(cp)) bad.push(`${label}: cell ${i} U+${cp.toString(16)} wide or invisible`);
    if (f.shades[i] >= PAL_LEN) bad.push(`${label}: cell ${i} shade ${f.shades[i]}`);
    if (cp === 32 && f.shades[i] !== 0) bad.push(`${label}: blank cell ${i} has a shade`);
  }
  return bad;
}

test('menu: a skin naming only text and head gets the default dim and accent, never shade 0 text', () => {
  const sparse = { text: 5, head: 9 };
  for (const layout of ['list', 'slots', 'grid']) {
    const f = newFrame(120, 40);
    drawMenu(f, { entries: mkEntries(3), index: 0 }, mkSkin(layout, {}, sparse));
    const bad = [];
    for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] !== 32 && f.shades[i] === 0) bad.push(i);
    assert.deepEqual(bad.slice(0, 3), [], `${layout}: lit cells with shade 0`);
    const shades = new Set(); for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] !== 32) shades.add(f.shades[i]);
    assert.ok(shades.has(DEFAULT_UI.accent) || shades.has(DEFAULT_UI.dim), `${layout}: defaults used`);
    assert.ok(!shades.has(undefined));
  }
  const c = newFrame(40, 10);
  drawChrome(c, { palette: { ui: sparse }, frame: { glyphs: '+-+|+-+|', title: 'T' } });
  assert.ok(Array.from(c.glyphs).every((g, i) => g === 32 || c.shades[i] > 0), 'chrome too');
});

// ---- every layout at every size

// The cells a draw changed against a pre-filled scene frame, as a bounding box { x0, y0, x1, y1, count }.
function changedBox(base, f) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < f.rows; y++) for (let x = 0; x < f.cols; x++) {
    const i = cell(f, x, y);
    if (f.glyphs[i] !== base.glyphs[i] || f.shades[i] !== base.shades[i]) { count++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return { x0, y0, x1, y1, count };
}

test('menu: every layout at 240x67, 120x40, 80x24, 30x10 and 4x2 with 1, 3, 8 and 10 entries: no throw, allowed glyphs, in-palette shades, scene kept outside the box', () => {
  for (const layout of ['list', 'slots', 'grid']) {
    for (const [w, h] of SIZES) {
      for (const n of [1, 3, 8, 10]) {
        for (const index of [0, n - 1]) {
          const base = dirty(w, h), f = dirty(w, h);
          const label = `${layout} ${w}x${h} n=${n} index=${index}`;
          assert.doesNotThrow(() => drawMenu(f, { entries: mkEntries(n), index }, mkSkin(layout)), label);
          assert.deepEqual(problems(f, label), [], label);
          const b = changedBox(base, f);
          if (w < 6 || h < 3) { assert.equal(b.count, 0, `${label}: too small to draw`); continue; }
          assert.ok(b.count > 0, `${label}: something is drawn`);
          // list and slots own one rectangle (every cell in it is written); the grid owns its tiles only
          if (layout !== 'grid' || w < 100) {
            const area = (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
            if (layout === 'list') assert.equal(b.count, area, `${label}: the list owns its whole rectangle`);
          } else {
            assert.equal(b.count % (22 * 7), 0, `${label}: tiles are 22x7 cells, nothing else is written`);
          }
          // the selected entry's label is on screen whatever the window
          const t = text(f);
          if (h >= 4 && w >= 14) assert.ok(t.includes(`Program ${index + 1}`) || w < 30, `${label}: the selected entry is visible`);
        }
      }
    }
  }
});

// ---- list

test('list: frames in menu.box, else frame.glyphs, else the default box; the cursor glyph and the hint come from the skin', () => {
  const f = newFrame(80, 24);
  drawMenu(f, { entries: mkEntries(3), index: 2 }, { ...mkSkin('list', { cursor: '>' }), frame: { glyphs: '+-+|+-+|' }, wording: { menuHint: 'Pick one please' } });
  const t = text(f);
  assert.ok(t.includes('+'), 'frame.glyphs used when menu.box is absent');
  assert.match(t, /> Program 3/);
  assert.match(t, /Pick one please/);
  const g = newFrame(80, 24);
  drawMenu(g, { entries: mkEntries(3), index: 0 }, { ...mkSkin('list', { box: '#=#||#=#|' }), frame: { glyphs: '+-+|+-+|' } });
  assert.ok(text(g).includes('#') && !text(g).includes('+'), 'menu.box wins over frame.glyphs');
  const d = newFrame(80, 24);
  drawMenu(d, { entries: mkEntries(3), index: 0 }, mkSkin('list'));
  assert.ok(text(d).includes('┌') && text(d).includes('┘'), 'default box');
  // the playing program is marked
  assert.match(text(d), /Program 2 \*/);
});

test('list: title rule - set into the top border as ╡ TITLE ╞ when the box top is ═ or ━, a plain title row otherwise', () => {
  const rows = (box) => { const f = newFrame(80, 24); drawMenu(f, { entries: mkEntries(3), index: 0 }, mkSkin('list', { box, title: 'Journal' })); return frameLines(f); };
  const dbl = rows('╔═╗║╝═╚║');
  const top = dbl.find((l) => l.includes('╔'));
  assert.ok(top.includes('╡ Journal ╞'), `double top: ${top}`);
  const heavy = rows('┏━┓┃┛━┗┃').find((l) => l.includes('┏'));
  assert.ok(heavy.includes('┥ Journal ┝'), 'heavy top');
  const single = rows('┌─┐│┘─└│');
  const sTop = single.findIndex((l) => l.includes('┌'));
  assert.ok(!single[sTop].includes('Journal') && !single[sTop].includes('╡'), 'single top has no title in the border');
  assert.ok(single[sTop + 1].includes('Journal'), 'the title is the first row inside');
  assert.ok(single[sTop + 2].replace(/[│\s]/g, '') === '', 'then a blank row');
  assert.ok(single[sTop + 3].includes('Program 1'));
  // the edge title's spaces are blanks (the border does not show through them)
  const f = newFrame(80, 24);
  drawMenu(f, { entries: mkEntries(3), index: 0 }, mkSkin('list', { box: '╔═╗║╝═╚║', title: 'Journal' }));
  const lines = frameLines(f);
  const y = lines.findIndex((l) => l.includes('╡'));
  const cx = lines[y].indexOf('╡');
  assert.equal(f.glyphs[cell(f, cx + 1, y)], 32);
  assert.equal(f.shades[cell(f, cx + 1, y)], 0);
});

test('list: scrolls with ↑ N more and ↓ N more rows when the entries do not fit (10 entries, 80x16), the cursor row always shown', () => {
  const at = (index) => { const f = newFrame(80, 16); drawMenu(f, { entries: mkEntries(10), index }, mkSkin('list')); return text(f); };
  const first = at(0);
  assert.ok(!first.includes('↑'), 'nothing above the first window');
  assert.match(first, /↓ \d+ more/);
  const mid = at(5);
  assert.match(mid, /↑ \d+ more/);
  assert.match(mid, /↓ \d+ more/);
  const last = at(9);
  assert.match(last, /↑ \d+ more/);
  assert.ok(!last.includes('↓'), 'nothing below the last window');
  for (let i = 0; i < 10; i++) assert.ok(at(i).includes(`Program ${i + 1}`), `entry ${i + 1} reachable`);
  // the counts add up: shown + above + below = 10
  const m = /↑ (\d+) more/.exec(mid), k = /↓ (\d+) more/.exec(mid);
  const shown = (mid.match(/Program \d+/g) || []).length;
  assert.equal(shown + Number(m[1]) + Number(k[1]), 10);
  // and when everything fits there are no markers
  const roomy = newFrame(80, 24);
  drawMenu(roomy, { entries: mkEntries(10), index: 4 }, mkSkin('list'));
  assert.ok(!/more/.test(text(roomy)));
  // short windows: 4 rows still draw the cursor entry
  for (const rows of [3, 4, 5, 6, 7]) {
    const s = newFrame(60, rows);
    drawMenu(s, { entries: mkEntries(10), index: 6 }, mkSkin('list'));
    assert.ok(text(s).includes('Program 7'), `${rows} rows show the cursor entry`);
  }
});

test('list: the highlighted row is drawn in the accent shade and the others in the text shade', () => {
  const f = newFrame(80, 24);
  drawMenu(f, { entries: mkEntries(3), index: 2 }, mkSkin('list'));
  const shadeOfLabel = (s) => {
    const lines = frameLines(f);
    const y = lines.findIndex((l) => l.includes(s));
    return f.shades[cell(f, lines[y].indexOf(s), y)];
  };
  assert.equal(shadeOfLabel('Program 3'), UI.accent);
  assert.equal(shadeOfLabel('Program 1'), UI.text);
  assert.notEqual(shadeOfLabel('Program 3'), shadeOfLabel('Program 1'));
});

// ---- slots

const find = (f, s) => { const lines = frameLines(f); const y = lines.findIndex((l) => l.includes(s)); return y < 0 ? null : { x: lines[y].indexOf(s), y }; };
const count = (f, ch) => (text(f).split(ch).length - 1);

test('slots: 4-row cards at 30 rows, 2-row entries with a dashed rule at 29; Roman numerals I..X and the current mark', () => {
  const draw = (rows, n, index = 0, cols = 120) => { const f = newFrame(cols, rows); drawMenu(f, { entries: mkEntries(n), index }, mkSkin('slots')); return f; };
  const tall = draw(30, 3);
  assert.equal(count(tall, '╔') + count(tall, '┌'), 3, 'three boxed cards at 30 rows');
  assert.equal(count(tall, '┄'), 0);
  const topsOf = (f) => frameLines(f).map((l, y) => (/[┌╔]/.test(l) ? y : -1)).filter((y) => y >= 0);
  const tops = topsOf(tall);
  assert.deepEqual([tops[1] - tops[0], tops[2] - tops[1]], [4, 4], 'cards are 4 rows apart and 4 rows high');
  const bottoms = frameLines(tall).map((l, y) => (/[└╚]/.test(l) ? y : -1)).filter((y) => y >= 0);
  assert.equal(bottoms[0] - tops[0], 3, 'a card is 4 rows high');
  const short = draw(29, 3);
  assert.equal(count(short, '╔') + count(short, '┌'), 0, 'no boxes at 29 rows');
  assert.ok(count(short, '┄') > 0, 'dashed rule at 29 rows');
  const ls = frameLines(short);
  const y1 = ls.findIndex((l) => l.includes('Program 1')), y2 = ls.findIndex((l) => l.includes('Program 2'));
  assert.equal(y2 - y1, 3, 'a 2-row entry plus a rule row');
  assert.ok(/^\s*┄+\s*$/.test(ls[y1 + 2]), 'the rule sits between the entries');
  assert.ok(!/┄/.test(ls[y2 + 2 + 3] || ''), 'and not after the last');
  // numerals and the current mark
  for (const f of [tall, short]) {
    const t = text(f);
    assert.match(t, /\bI\s+Program 1/);
    assert.match(t, /\bII\s+Program 2 \*/);
    assert.match(t, /\bIII\s+Program 3/);
  }
  // ten entries: the numeral X; 4-row cards where they fit (240x67), 2-row entries where only those do (120x40)
  const big = draw(67, 10, 9, 240);
  assert.equal(count(big, '╔') + count(big, '┌'), 10);
  assert.match(text(big), /\bX\s+Program 10/);
  const mid = draw(40, 10, 9);
  assert.equal(count(mid, '╔') + count(mid, '┌'), 0, '10 entries at 120x40 are 2-row entries');
  assert.ok(count(mid, '┄') > 0);
  assert.match(text(mid), /\bX\s+Program 10/);
  // and where not even those fit (80x16) it is the scrolling list
  const small = draw(16, 10, 4, 80);
  assert.match(text(small), /↑ \d+ more|↓ \d+ more/);
});

test('slots: the selected card is a double line in the accent shade, the others single and dim; the selected label is distinguishable', () => {
  for (const [cols, rows] of [[120, 40], [240, 67], [80, 24]]) {
    const f = newFrame(cols, rows);
    drawMenu(f, { entries: mkEntries(3), index: 1 }, mkSkin('slots'));
    const sel = find(f, 'Program 2 *'), other = find(f, 'Program 1');
    assert.equal(f.shades[cell(f, sel.x, sel.y)], UI.accent, `${cols}x${rows} selected label`);
    assert.equal(f.shades[cell(f, other.x, other.y)], UI.text, `${cols}x${rows} other label`);
    const mark = find(f, '*');
    assert.equal(f.shades[cell(f, mark.x, mark.y)], UI.accent, 'the current mark follows its row');
    if (rows >= 30) {
      const dbl = find(f, '╔'), single = find(f, '┌');
      assert.equal(f.shades[cell(f, dbl.x, dbl.y)], UI.accent, 'double line in the accent colour');
      assert.equal(f.shades[cell(f, single.x, single.y)], UI.dim, 'single line dim');
      assert.equal(count(f, '╔'), 1);
    }
  }
  // the current mark when not selected uses the head shade, the same in every layout
  for (const layout of ['list', 'slots', 'grid']) {
    const f = newFrame(120, 40);
    drawMenu(f, { entries: mkEntries(3), index: 0 }, mkSkin(layout));
    const mark = find(f, '*');
    assert.equal(f.shades[cell(f, mark.x, mark.y)], UI.head, `${layout}: current mark`);
  }
});

// ---- grid

test('grid: 22x7 tiles, 3 per row from 120 columns and 2 from 100, a list below 100; up to 10 entries fit or fall back to the list', () => {
  const draw = (cols, rows, n, index = 0, layout = 'grid') => { const f = newFrame(cols, rows); drawMenu(f, { entries: mkEntries(n), index }, mkSkin(layout)); return f; };
  const tiles = (f) => frameLines(f).flatMap((l, y) => [...l].map((c, x) => (c === '╔' || c === '┌' ? { x, y } : null)).filter(Boolean));
  const t100 = tiles(draw(100, 40, 4));
  assert.equal(t100.filter((p) => p.y === t100[0].y).length, 2, '2 per row at 100 columns');
  const t120 = tiles(draw(120, 40, 4, 1));
  assert.equal(t120.filter((p) => p.y === t120[0].y).length, 3, '3 per row at 120 columns');
  const t99 = draw(99, 40, 4), list99 = draw(99, 40, 4, 0, 'list');
  assert.equal(text(t99), text(list99), 'grid at 99 columns is the list');
  assert.equal(count(t99, '╔'), 0);
  assert.notEqual(text(draw(100, 40, 4)), text(draw(100, 40, 4, 0, 'list')), 'grid at 100 columns is not');
  // tile size: 22 wide, 7 high, 2 apart
  const f = draw(120, 40, 4, 1);
  const lines = frameLines(f);
  const first = tiles(f)[0];
  assert.equal(lines[first.y].slice(first.x, first.x + 22), '┌' + '─'.repeat(20) + '┐');
  assert.equal(lines[first.y + 6][first.x], '└');
  assert.equal(lines[first.y + 7][first.x], ' ');
  assert.equal(tiles(f)[1].x - first.x, 24);
  // the label is centred in its tile, the current mark in the label
  const lab = find(f, 'Program 1');
  assert.ok(Math.abs((lab.x - first.x) - (22 - 9) / 2) <= 1);
  assert.equal(lab.y - first.y, 3);
  // 10 entries: 3 per row x 4 lines at 120 and 240 columns (31 rows) when the rows allow, else the list
  const ten = draw(240, 67, 10, 9);
  assert.equal(count(ten, '╔'), 1);
  assert.equal(count(ten, '┌'), 9);
  const tenShort = draw(120, 24, 10, 9);
  assert.match(text(tenShort), /↑|more|Program 10/);
  assert.equal(count(tenShort, '╔'), 0, 'rows do not fit: list');
  assert.ok(text(tenShort).includes('Program 10'));
  // selected tile: accent double line; the others dim single lines
  const dbl = find(f, '╔'), single = find(f, '┌');
  assert.equal(f.shades[cell(f, dbl.x, dbl.y)], UI.accent);
  assert.equal(f.shades[cell(f, single.x, single.y)], UI.dim);
  assert.equal(f.shades[cell(f, lab.x, lab.y)], UI.text);
  const sel = find(f, 'Program 2 *');
  assert.equal(f.shades[cell(f, sel.x, sel.y)], UI.accent);
  // a heavy/double skin box does not take the unselected tiles' single line away
  const g = newFrame(120, 40);
  drawMenu(g, { entries: mkEntries(3), index: 0 }, mkSkin('grid', { box: '╔═╗║╝═╚║' }));
  assert.equal(count(g, '╔'), 1);
});

// ---- chrome


test('chrome: the title sits in the top edge with spaces round it, as ╡ TITLE ╞ only when the top glyph is ═ or ━', () => {
  const top = (glyphs, title = 'Journal', cols = 60) => {
    const f = newFrame(cols, 10);
    drawChrome(f, { palette: { ui: UI }, frame: { glyphs, title, colour: 6 } });
    return { f, line: frameLines(f)[0] };
  };
  assert.ok(top('◆═◆║◆═◆║').line.includes('╡ Journal ╞'));
  assert.ok(top('┏━┓┃┛━┗┃').line.includes('┥ Journal ┝'));
  const plain = top('┌─┐│┘─└│').line;
  assert.ok(plain.includes(' Journal ') && !plain.includes('╡') && !plain.includes('╞'), plain);
  const { f } = top('◆═◆║◆═◆║');
  // border in the frame colour, title in the head shade, the spaces are blanks
  assert.equal(f.shades[cell(f, 0, 0)], 6);
  assert.equal(f.shades[cell(f, 59, 9)], 6);
  const x = frameLines(f)[0].indexOf('Journal');
  assert.equal(f.shades[cell(f, x, 0)], UI.head);
  assert.equal(f.glyphs[cell(f, x - 1, 0)], 32);
  assert.equal(f.shades[cell(f, x - 1, 0)], 0);
  assert.equal(f.glyphs[cell(f, x - 2, 0)], 0x2561, 'the cap');
  // the rest of the edge is the border glyph
  assert.equal(frameLines(f)[0][1], '═');
  assert.equal(frameLines(f)[9].slice(1, 59), '═'.repeat(58));
  // a title too long for the edge is cut, never overflows the corners; no colour falls back to the dim shade
  const long = top('◆═◆║◆═◆║', 'A very very long title indeed', 20);
  assert.equal(long.line[19], '◆');
  assert.equal(long.line[0], '◆');
  const dflt = newFrame(30, 6);
  drawChrome(dflt, { palette: { ui: UI }, frame: { glyphs: '+-+|+-+|' } });
  assert.equal(dflt.shades[0], UI.dim);
  // every size: no throw, allowed glyphs, in palette, interior untouched
  for (const [w, h] of SIZES) {
    const base = dirty(w, h), g = dirty(w, h);
    assert.doesNotThrow(() => drawChrome(g, { palette: { ui: UI }, frame: { glyphs: '◆═◆║◆═◆║', title: 'Journal', colour: 4 } }));
    assert.deepEqual(problems(g, `chrome ${w}x${h}`), []);
    for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) assert.equal(g.glyphs[cell(g, xx, y)], base.glyphs[cell(g, xx, y)]);
  }
});

test('chrome: the bottom-edge ornament hook is empty for now and draws centred in the bottom edge when it has text', () => {
  assert.equal(chromeOrnament({ frame: { glyphs: '◆═◆║◆═◆║' } }), '');
  const before = newFrame(40, 8), after = newFrame(40, 8);
  drawChrome(before, { palette: { ui: UI }, frame: { glyphs: '◆═◆║◆═◆║' } });
  drawChrome(after, { palette: { ui: UI }, frame: { glyphs: '◆═◆║◆═◆║' } });
  assert.deepEqual(Array.from(after.glyphs), Array.from(before.glyphs), 'an empty ornament changes nothing');
  drawEdgeOrnament(after, 'Ψ · Δ', 6);
  const bottom = frameLines(after)[7];
  assert.ok(bottom.includes(' Ψ · Δ '), bottom);
  assert.equal(bottom[0], '◆');
  assert.equal(bottom[39], '◆');
  assert.equal(Math.abs(bottom.indexOf('Ψ') - (40 - 5) / 2) <= 1, true, 'centred');
  const tiny = newFrame(6, 3);
  assert.doesNotThrow(() => drawEdgeOrnament(tiny, 'a long ornament that cannot fit', 6));
});

// ---- note and desc (DRIFT-4 item 4)

const withExtras = (n, over = {}) => Array.from({ length: n }, (_, i) => ({
  label: `Program ${i + 1}`,
  ...(i === 1 ? { current: true } : {}),
  ...(i % 2 === 0 ? { note: i === 0 ? 'jump' : 'sixteen chars ab' } : {}),
  desc: `Description number ${i + 1} says what this entry does, in a sentence or two.`,
  ...over,
}));
const shortHint = { wording: { menuHint: 'ok' } };

test('list note: right-aligned inside the box at 120x40 and 80x24, and the box widens by the note width plus 2', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const entries = [{ label: 'Alpha', note: 'jump' }, { label: 'Beta' }, { label: 'Gamma', note: 'sixteen chars ab' }];
    const skin = { ...mkSkin('list', { title: '' }), ...shortHint };
    const plain = newFrame(w, h), noted = newFrame(w, h);
    drawMenu(plain, { entries: entries.map(({ label }) => ({ label })), index: 0 }, skin);
    drawMenu(noted, { entries, index: 0 }, skin);
    const bp = changedBox(newFrame(w, h), plain), bn = changedBox(newFrame(w, h), noted);
    assert.equal((bn.x1 - bn.x0) - (bp.x1 - bp.x0), 16 + 2, `${w}x${h}: widens by the widest note + 2`);
    const lines = frameLines(noted);
    const a = lines.find((l) => l.includes('Alpha')).trimEnd();
    const g = lines.find((l) => l.includes('Gamma')).trimEnd();
    assert.ok(a.endsWith('jump │'), `${w}x${h}: note at the right edge: ${a}`);
    assert.ok(g.endsWith('sixteen chars ab │'), g);
    assert.equal(a.length, g.length, 'both rows end at the same edge');
    assert.ok(!lines.find((l) => l.includes('Beta')).includes('jump'));
    assert.deepEqual(problems(noted, `${w}x${h}`), []);
  }
});

test('list note: a width with no room for label and note keeps the whole label and drops the note', () => {
  const entries = [{ label: 'Long label here ok', note: 'abcdefgh' }];
  const f = newFrame(30, 12);
  drawMenu(f, { entries, index: 0 }, { ...mkSkin('list', { title: '' }), ...shortHint });
  const t = text(f);
  assert.ok(t.includes('Long label here ok'), 'label whole');
  assert.ok(!t.includes('abcdefgh'), 'note dropped');
  const roomy = newFrame(60, 12);
  drawMenu(roomy, { entries, index: 0 }, { ...mkSkin('list', { title: '' }), ...shortHint });
  assert.ok(text(roomy).includes('abcdefgh'), 'control: the same entry shows its note when there is room');
});

test('slots note: right-aligned on the label row; dropped (label intact) when the card has no room', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const f = newFrame(w, h);
    drawMenu(f, { entries: [{ label: 'Alpha', note: 'new' }, { label: 'Beta with a longer label', note: 'sixteen chars ab' }], index: 0 }, mkSkin('slots'));
    const lines = frameLines(f);
    const a = lines.find((l) => l.includes('Alpha')).trimEnd();
    // 120x40 draws boxed 4-row cards (the note sits one cell from the border); 80x24 draws flat 2-row entries
    assert.match(a, h >= 30 ? /Alpha\s+new ║$/ : /Alpha\s+new$/, `${w}x${h}: right-aligned: ${a}`);
    const b = lines.find((l) => l.includes('Beta'));
    assert.ok(b.includes('Beta with a longer label'), 'label intact');
    assert.ok(!text(f).includes('sixteen chars ab'), 'a note too wide for the card is dropped');
    assert.deepEqual(problems(f, `slots ${w}x${h}`), []);
  }
});

test('grid note: a row under the label inside the tile; dropped when wider than the tile', () => {
  const f = newFrame(120, 40);
  drawMenu(f, { entries: [{ label: 'Alpha', note: 'jump' }, { label: 'Beta', note: 'sixteen chars ab' }, { label: 'Gamma' }], index: 0 }, mkSkin('grid'));
  const lines = frameLines(f);
  const ya = lines.findIndex((l) => l.includes('Alpha'));
  assert.ok(lines[ya + 1].includes('jump'), 'the note is on the row under the label');
  assert.ok(lines[ya + 1].indexOf('jump') > lines[ya].indexOf('Alpha') - 8 && lines[ya + 1].indexOf('jump') < lines[ya].indexOf('Alpha') + 8, 'and sits under it');
  const yb = lines.findIndex((l) => l.includes('Beta'));
  assert.ok(lines[yb + 1].includes('sixteen chars ab'), '16 characters fit a 22-wide tile');
  assert.deepEqual(problems(f, 'grid'), []);
});

test('list desc: the selected entry text, wrapped to 2 lines above the hint, follows the cursor; dropped at 80x16 before the title', () => {
  const entries = withExtras(10);
  const skin = mkSkin('list', { title: 'Menu title' });
  const at = (index, w, h) => { const f = newFrame(w, h); drawMenu(f, { entries, index }, skin); return f; };
  for (const [w, h] of [[120, 40], [80, 24]]) {
    for (const index of [0, 3, 9]) {
      const f = at(index, w, h);
      const lines = frameLines(f);
      const hintY = lines.findIndex((l) => l.includes('Up and down choose'));
      assert.ok(hintY > 2, 'hint present');
      const want = entries[index].desc;
      const first = lines.findIndex((l) => l.includes(`Description number ${index + 1}`));
      assert.ok(first >= 0, `${w}x${h} index ${index}: desc shown`);
      assert.ok(first + 1 < hintY, 'two lines, above the hint');
      const joined = (lines[first] + ' ' + lines[first + 1]).replace(/[│\s]+/g, ' ');
      assert.ok(joined.includes(want.slice(0, 30)) && joined.includes(want.slice(-20)), `all of the text shows in 2 lines: ${joined}`);
      for (let other = 0; other < 10; other++) if (other !== index) assert.ok(!text(f).includes(`Description number ${other + 1} `), 'only the selected entry text');
      assert.deepEqual(problems(f, `desc ${w}x${h}`), []);
    }
    // the box does not change height when the cursor moves
    const hOf = (index) => { const b = changedBox(newFrame(w, h), at(index, w, h)); return b.y1 - b.y0; };
    assert.equal(hOf(0), hOf(5));
  }
  const short = at(2, 80, 16);
  assert.ok(!text(short).includes('Description number'), '80x16: desc dropped');
  assert.ok(text(short).includes('Menu title'), 'the title stays');
  assert.ok(text(short).includes('Up and down choose'), 'and the hint');
  assert.ok(text(short).includes('Program 3'), 'and the selected entry');
  // control: an entry list with no desc draws no extra rows
  const plain = newFrame(80, 24);
  drawMenu(plain, { entries: mkEntries(10), index: 0 }, skin);
  const withD = changedBox(newFrame(80, 24), at(0, 80, 24)), noD = changedBox(newFrame(80, 24), plain);
  assert.equal((withD.y1 - withD.y0) - (noD.y1 - noD.y0), 3, 'desc takes 3 rows: a spacer and its 2 lines');
});

test('a 10-entry menu with notes and descriptions in each layout at 120x40 and 80x24 draws allowed glyphs only', () => {
  for (const layout of ['list', 'slots', 'grid']) {
    for (const [w, h] of [[120, 40], [80, 24]]) {
      for (const index of [0, 4, 9]) {
        const base = dirty(w, h), f = dirty(w, h);
        const label = `${layout} ${w}x${h} index ${index}`;
        assert.doesNotThrow(() => drawMenu(f, { entries: withExtras(10), index }, mkSkin(layout)), label);
        assert.deepEqual(problems(f, label), [], label);
        assert.ok(changedBox(base, f).count > 0, label);
        assert.ok(text(f).includes(`Program ${index + 1}`), `${label}: selected entry visible`);
      }
    }
  }
});
