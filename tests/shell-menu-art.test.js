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
