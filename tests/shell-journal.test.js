// DRIFT-4 (Delza): the three small engine additions the Journal menu needs.
//   1. skin fields: menu.prompt, menu.autostartSeconds, frame.ornament
//   2. slots cards that show a chapter (icon, place, description line, own numeral)
//   3. the menu's start-by-itself countdown (any key cancels it)
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSkin } from '../src/cartridge/schema.js';
import { chromeOrnament, drawChrome } from '../src/shell/chrome.js';
import { newFrame } from '../src/shell/ui.js';
import { frameLines } from './helpers-help.js';

const base = { palette: { hue: '#7FB069', colours: ['#FF6B6B'] } };
const withMenu = (menu) => validateSkin({ ...base, menu });
const withFrame = (frame) => validateSkin({ ...base, frame });

// ---- 1. the skin fields

test('skin menu.prompt: kept when it is text of 1 to 60 allowed characters, refused otherwise', () => {
  const ok = withMenu({ layout: 'slots', prompt: 'Choose where the tale begins.' });
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(ok.skin.menu.prompt, 'Choose where the tale begins.');
  assert.match(withMenu({ prompt: '' }).reason, /menu\.prompt must not be empty/);
  assert.match(withMenu({ prompt: 'x'.repeat(61) }).reason, /menu\.prompt is 61 characters, max 60/);
  assert.match(withMenu({ prompt: 'arrow ' + String.fromCodePoint(0x2196) }).reason, /U\+2196/);
  assert.match(withMenu({ prompt: 42 }).reason, /menu\.prompt must be text/);
});

test('skin menu.autostartSeconds: a whole number of seconds from 5 to 60', () => {
  for (const n of [5, 15, 60]) {
    const r = withMenu({ autostartSeconds: n });
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.skin.menu.autostartSeconds, n);
  }
  for (const n of [4, 61, 0, -3, 7.5, '15', null, NaN]) assert.match(withMenu({ autostartSeconds: n }).reason, /menu\.autostartSeconds must be a whole number from 5 to 60/, String(n));
  assert.equal(withMenu({ layout: 'list' }).skin.menu.autostartSeconds, undefined, 'absent stays absent');
});

test('skin frame.ornament: short allowed text set into the bottom edge', () => {
  const r = withFrame({ show: 'menu', glyphs: '◆═◆║◆═◆║', ornament: 'Ψ · Δ · Ξ · Φ · Ω' });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.skin.frame.ornament, 'Ψ · Δ · Ξ · Φ · Ω');
  assert.match(withFrame({ ornament: 'x'.repeat(31) }).reason, /frame\.ornament is 31 characters, max 30/);
  assert.match(withFrame({ ornament: '' }).reason, /frame\.ornament must not be empty/);
  assert.match(withFrame({ ornament: 'bad ' + String.fromCodePoint(0x2197) }).reason, /U\+2197/);
});

test('chrome: the skin\'s frame ornament is centred in the bottom edge; without one nothing is drawn there', () => {
  const skin = { palette: { hue: '#7FB069' }, frame: { show: 'menu', glyphs: '◆═◆║◆═◆║', ornament: 'Ψ · Δ' } };
  assert.equal(chromeOrnament(skin), 'Ψ · Δ');
  assert.equal(chromeOrnament({ frame: { glyphs: '◆═◆║◆═◆║' } }), '');
  assert.equal(chromeOrnament({}), '');
  const f = newFrame(40, 8);
  drawChrome(f, skin);
  const last = frameLines(f)[7];
  assert.match(last, /^◆═+ Ψ · Δ ═+◆$/);
  const plain = newFrame(40, 8);
  drawChrome(plain, { ...skin, frame: { ...skin.frame, ornament: undefined } });
  assert.match(frameLines(plain)[7], /^◆═+◆$/);
});

// ---- 2. slots cards that show a chapter

import { drawMenu } from '../src/shell/menu.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { isWide, isInvisible } from './helpers-width.js';

const UI = { text: 5, dim: 3, head: 9, accent: 12 };
const slotsSkin = (menu = {}) => ({ palette: { ui: UI }, menu: { layout: 'slots', anchor: 'center', title: 'Menu', ...menu } });
const CH = [
  { numeral: 'I', place: 'Thornwell Wood', line: 'Orrin sets out with the Ember Lantern and a moth named Pim.', icon: ['▲ ▲ ▲', '█ █ █'] },
  { numeral: 'II', place: 'Lowmarrow', line: 'Warm ale, a crackling hearth, and a rumour about the Lamp.', icon: ['┌▲▲┐', '└▓▓┘'] },
  { numeral: 'III', place: 'Ashen Clearing', line: 'A stag of embers blocks the road. Orrin stands his ground.', icon: ['ψ  ψ', '▀██▀'] },
];
const chapEntries = () => [
  ...CH.map((c, i) => ({ label: ['The Thornwell Path', 'The Tallow & Tin', 'The Cinderhorn'][i], note: '3 min', chapter: c, ...(i === 0 ? { current: true } : {}) })),
  { label: 'Eject the cartridge' },
];
const lines = (f) => frameLines(f).map((l) => l.trimEnd());
const allOk = (f) => { for (let i = 0; i < f.glyphs.length; i++) { const cp = f.glyphs[i]; assert.ok(isAllowedGlyph(cp) && !isWide(cp) && !isInvisible(cp), `cell ${i} U+${cp.toString(16)}`); } };

test('slots chapter card (120x40): icon on both rows, the chapter\'s own numeral, place at the right of the label row, line and note on the row under', () => {
  const f = newFrame(120, 40);
  drawMenu(f, { entries: chapEntries(), index: 1 }, slotsSkin());
  allOk(f);
  const ls = lines(f);
  const y1 = ls.findIndex((l) => l.includes('The Thornwell Path'));
  assert.ok(y1 > 0);
  assert.match(ls[y1], /▲ ▲ ▲\s+I\s+The Thornwell Path \*\s+Thornwell Wood\s*│$/, ls[y1]);
  assert.match(ls[y1 + 1], /█ █ █\s+Orrin sets out with the Ember Lantern and a moth named Pim\.\s+3 min\s*│$/, ls[y1 + 1]);
  const y2 = ls.findIndex((l) => l.includes('The Tallow & Tin'));
  assert.equal(y2 - y1, 4, 'cards are 4 rows apart');
  assert.match(ls[y2], /▶\s+┌▲▲┐\s+II\s+The Tallow & Tin\s+Lowmarrow\s*║$/, ls[y2]);
  assert.match(ls[y2 + 1], /└▓▓┘\s+Warm ale, a crackling hearth, and a rumour about the Lamp\.\s+3 min\s*║$/, ls[y2 + 1]);
  // the entry with no chapter has no numeral and no icon, and its label starts in the same column as the others
  const y4 = ls.findIndex((l) => l.includes('Eject the cartridge'));
  assert.ok(!/\b(I|II|III|IV)\b/.test(ls[y4]), ls[y4]);
  assert.equal(ls[y4].indexOf('Eject'), ls[y1].indexOf('The Thornwell'), 'labels share a column');
  // selected card: accent for icon, place and numeral; description in the text shade; others dim
  const at = (y, s) => y * f.cols + ls[y].indexOf(s);
  assert.equal(f.shades[at(y2, 'II')], UI.accent);
  assert.equal(f.shades[at(y2, 'Lowmarrow')], UI.accent);
  assert.equal(f.shades[at(y2 + 1, 'Warm ale')], UI.text);
  assert.equal(f.shades[at(y1, 'Thornwell Wood')], UI.dim);
  assert.equal(f.shades[at(y1 + 1, 'Orrin sets')], UI.dim);
});

test('slots chapter card (80x24): 2-row entries inside the window, icon, numeral, place and the line all shown, label never cut for the place', () => {
  const f = newFrame(80, 24);
  drawMenu(f, { entries: chapEntries(), index: 0 }, slotsSkin());
  allOk(f);
  const ls = lines(f);
  const y = ls.findIndex((l) => l.includes('The Thornwell Path'));
  assert.match(ls[y], /▶\s+▲ ▲ ▲\s+I\s+The Thornwell Path \*\s+Thornwell Wood$/, ls[y]);
  assert.match(ls[y + 1], /█ █ █\s+Orrin sets out/, ls[y + 1]);
  assert.ok(/^\s*┄+\s*$/.test(ls[y + 2]), 'dashed rule between entries');
  for (const l of frameLines(f)) assert.ok(l.length === 80, 'frame width');
  const cols = ls.map((l) => [...l].findIndex((c) => c !== ' ')).filter((c) => c >= 0);
  assert.ok(Math.min(...cols) >= 2, 'the block stays two columns inside the window');
  // a window too narrow for the place drops it, never the label
  const g = newFrame(46, 24);
  drawMenu(g, { entries: chapEntries(), index: 0 }, slotsSkin());
  const t = lines(g).join('\n');
  assert.ok(t.includes('The Thornwell Path'));
  assert.ok(!t.includes('Thornwell Wood'), 'place dropped when there is no room');
});

test('slots: an entry\'s own desc wins over its chapter line; entries with no chapter and no desc draw exactly as before', () => {
  const f = newFrame(120, 40);
  drawMenu(f, { entries: [{ label: 'One', desc: 'Own words', chapter: CH[0] }], index: 0 }, slotsSkin());
  const t = lines(f).join('\n');
  assert.ok(t.includes('Own words') && !t.includes('Orrin sets out'));
  const a = newFrame(120, 40), b = newFrame(120, 40);
  const plain = [{ label: 'Alpha', note: 'new' }, { label: 'Beta', current: true }];
  drawMenu(a, { entries: plain, index: 1 }, slotsSkin());
  drawMenu(b, { entries: plain.map((e) => ({ ...e, chapter: undefined, desc: undefined })), index: 1 }, slotsSkin());
  assert.deepEqual(Array.from(a.glyphs), Array.from(b.glyphs));
  assert.match(lines(a).find((l) => l.includes('Alpha')), /\bI\s+Alpha/, 'a menu with no chapters keeps its Roman numerals');
});

// ---- the prompt line above the menu

test('menu header: the prompt sits two rows above the cards, the countdown text at the right of the same row; both vanish when there is no room', () => {
  const f = newFrame(120, 40);
  drawMenu(f, { entries: chapEntries(), index: 0, prompt: 'Choose where the tale begins.', countdown: 'starts by itself in 15 s' }, slotsSkin());
  const ls = lines(f);
  const yp = ls.findIndex((l) => l.includes('Choose where the tale begins.'));
  const y1 = ls.findIndex((l) => l.includes('The Thornwell Path'));
  assert.ok(yp >= 1 && y1 - yp === 3, `prompt row ${yp}, first card label row ${y1}`);
  assert.match(ls[yp], /Choose where the tale begins\.\s+starts by itself in 15 s\s*$/);
  const nothing = newFrame(120, 40);
  drawMenu(nothing, { entries: chapEntries(), index: 0 }, slotsSkin());
  assert.ok(!lines(nothing).join('\n').includes('Choose'), 'no prompt unless asked');
  const tight = newFrame(80, 9);
  assert.doesNotThrow(() => drawMenu(tight, { entries: [{ label: 'A' }], index: 0, prompt: 'p', countdown: 'c' }, slotsSkin()));
  const tiny = newFrame(4, 2);
  assert.doesNotThrow(() => drawMenu(tiny, { entries: chapEntries(), index: 0, prompt: 'p', countdown: 'c' }, slotsSkin()));
});

// ---- 3. the start-by-itself countdown

import fs from 'node:fs';
import path from 'node:path';
import { mkShell, makeRoot } from './helpers-shell.js';

// A root whose fixture cartridge's skin has the Journal's countdown (and a prompt) in its menu.
function autoRoot(seconds) {
  const root = makeRoot();
  const file = path.join(root, 'fixture', 'skin.json');
  const skin = JSON.parse(fs.readFileSync(file, 'utf8'));
  skin.menu = { layout: 'slots', title: 'Menu', ...(seconds ? { autostartSeconds: seconds, prompt: 'Choose where the tale begins.' } : {}) };
  fs.writeFileSync(file, JSON.stringify(skin));
  return root;
}
// library -> Enter on the fixture -> tick until the cartridge is running (the menu is open over it)
async function arrive(c) {
  c.goto('fixture');
  c.key('\r');
  c.tick(1.6);
  await c.settle();
  for (let i = 0; i < 400 && c.sh().screen !== 'running'; i++) c.tick(0.1);
  assert.equal(c.sh().screen, 'running');
  assert.equal(c.sh().menu, true);
}

test('countdown: the menu opens with "starts by itself in 15 s" and counts down once a second; at zero the menu closes and the tale plays', async () => {
  const c = mkShell({ root: autoRoot(15), startScreen: { screen: 'library' } });
  c.app.start();
  await arrive(c);
  assert.match(c.text(), /starts by itself in 15 s/);
  c.tick(5.2);
  assert.match(c.text(), /starts by itself in 10 s/);
  c.tick(9);
  assert.match(c.text(), /starts by itself in 1 s/);
  assert.equal(c.sh().menu, true, 'still open at 14.2 s');
  c.tick(1.5);
  assert.equal(c.sh().menu, false, 'closed at zero');
  assert.equal(c.sh().screen, 'running');
  assert.ok(!/starts by itself/.test(c.text()));
  assert.equal(c.sh().program, 'mix', 'the program that was playing behind the menu goes on');
  c.done();
});

test('countdown: any key cancels it - a key that does nothing, an arrow, and the help key - and the menu then stays until its 20 s idle close', async () => {
  for (const [name, key] of [['an unmapped key', 'x'], ['an arrow', '\x1b[B'], ['the help key', 'h']]) {
    const c = mkShell({ root: autoRoot(15), startScreen: { screen: 'library' } });
    c.app.start();
    await arrive(c);
    c.tick(3);
    assert.match(c.text(), /starts by itself/, name);
    c.key(key);
    if (key === 'h') c.key('h'); // close the help again
    c.tick(0.3);
    assert.ok(!/starts by itself/.test(c.text()), `${name}: the countdown text is gone`);
    c.key('\x1b[A'); // resets the idle clock too
    c.tick(16);
    assert.equal(c.sh().menu, true, `${name}: no longer closing at 15 s`);
    c.tick(5);
    assert.equal(c.sh().menu, false, `${name}: the ordinary 20 s idle close still applies`);
    c.done();
  }
});

test('countdown: a skin without autostartSeconds has none, and a menu opened with Enter during play never counts down', async () => {
  const c = mkShell({ root: autoRoot(0), startScreen: { screen: 'library' } });
  c.app.start();
  await arrive(c);
  assert.ok(!/starts by itself|Choose where/.test(c.text()));
  c.done();
  const d = mkShell({ root: autoRoot(15), startScreen: { screen: 'library' } });
  d.app.start();
  await arrive(d);
  d.key('\x1b'); // close
  d.tick(0.5);
  d.key('\r'); // open again by hand
  d.tick(1);
  assert.equal(d.sh().menu, true);
  assert.ok(!/starts by itself/.test(d.text()), 'no countdown on a menu the viewer opened');
  d.tick(16);
  assert.equal(d.sh().menu, true, 'and no auto-close at 15 s');
  d.done();
});

test('countdown: a paused program keeps counting (the countdown is wall time) and an ejected cartridge has none left on the next insert', async () => {
  const c = mkShell({ root: autoRoot(15), startScreen: { screen: 'library' } });
  c.app.start();
  await arrive(c);
  c.tick(2);
  c.key('p'); // pause is a key: it cancels the countdown
  c.tick(0.3);
  assert.ok(!/starts by itself/.test(c.text()));
  c.key('e');
  c.tick(2);
  await c.settle();
  assert.equal(c.sh().screen, 'library');
  await arrive(c);
  assert.match(c.text(), /starts by itself in 15 s/, 'a fresh insert starts a fresh countdown');
  c.done();
});

test('menu header: when the card block is too narrow for both, the countdown stays and the prompt is dropped', () => {
  const f = newFrame(120, 40);
  drawMenu(f, { entries: [{ label: 'Mix' }, { label: 'Calm' }], index: 0, prompt: 'Choose where the tale begins.', countdown: 'starts by itself in 15 s' }, slotsSkin());
  const t = lines(f).join('\n');
  assert.ok(t.includes('starts by itself in 15 s'));
  assert.ok(!t.includes('Choose where'));
});
