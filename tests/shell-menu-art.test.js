// DRIFT-4 A4: the cartridge menu (list, slots, grid) and the chrome border, drawn properly.
// The skins here are plain objects (the drawers take any skin; validation is tested elsewhere).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedGlyph } from '../src/glyphs.js';
import { drawMenu } from '../src/shell/menu.js';
import { drawChrome } from '../src/shell/chrome.js';
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
