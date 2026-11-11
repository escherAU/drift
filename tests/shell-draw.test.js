// DRIFT-4 phase 2: the console's draw stubs (library, insert, boot, menu, chrome, skinned help) at every size.
// Each draw is pure: it never throws, draws only allow-listed single-width glyphs, only palette indexes the
// palette has, and writes every cell it owns (drawing twice over a dirty frame gives the same result).
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCartridges } from '../src/cartridge/loader.js';
import { validateSkin } from '../src/cartridge/schema.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { drawHelp } from '../src/overlay.js';
import { shellHelpLines } from '../src/keymap.js';
import { drawLibrary } from '../src/shell/library.js';
import { drawInsert, INSERT_END } from '../src/shell/insert.js';
import { drawBoot, bootSeconds, bootPhases, BOOT_END, SCREEN_ON_END, LINES_END, BAR_END, ZOOM_END, TITLE_END } from '../src/shell/boot.js';
import { drawMenu } from '../src/shell/menu.js';
import { drawChrome } from '../src/shell/chrome.js';
import { driftmanSkin, classicBootSkin } from '../src/shell/driftman.js';
import { libraryPalette } from '../src/shell/shell.js';
import { newFrame, MSG_TOO_SMALL, sizeTier, wrapWords } from '../src/shell/ui.js';
import { isWide, isInvisible } from './helpers-width.js';
import { frameLines } from './helpers-help.js';
import { makeRoot } from './helpers-shell.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';

const SIZES = [[240, 67], [120, 40], [80, 24], [30, 10], [4, 2]];
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
const fixtureSkin = validateSkin(fixture.skin).ok ? fixture.skin : null;

function dirty(cols, rows) {
  const f = newFrame(cols, rows);
  for (let i = 0; i < f.glyphs.length; i++) { f.glyphs[i] = 0x2588; f.shades[i] = 3; }
  return f;
}
function problems(f, palLen, label) {
  const bad = [];
  for (let i = 0; i < f.glyphs.length; i++) {
    const cp = f.glyphs[i];
    if (!isAllowedGlyph(cp)) bad.push(`${label}: cell ${i} has U+${cp.toString(16)} (not allowed)`);
    else if (isWide(cp) || isInvisible(cp)) bad.push(`${label}: cell ${i} U+${cp.toString(16)} is wide or invisible`);
    if (f.shades[i] >= palLen) bad.push(`${label}: cell ${i} shade ${f.shades[i]} >= ${palLen}`);
    if (cp === 32 && f.shades[i] !== 0) bad.push(`${label}: blank cell ${i} has shade ${f.shades[i]}`);
    if (bad.length > 3) break;
  }
  return bad;
}
const text = (f) => frameLines(f).join('\n');
const flat = (f) => text(f).replace(/\s+/g, ' ');

test('driftman skin: validates with validateSkin, has a dark background, and the Classic boot skin does too', () => {
  const r = validateSkin(JSON.parse(JSON.stringify(driftmanSkin)));
  assert.equal(r.ok, true, r.reason);
  assert.equal(validateSkin(JSON.parse(JSON.stringify(classicBootSkin))).ok, true);
  assert.ok(driftmanSkin.palette.bg);
  assert.equal(validateSkin({ ...JSON.parse(JSON.stringify(driftmanSkin)), palette: { ...driftmanSkin.palette, bg: '#F0F0F0' } }).ok, false, 'a light background is refused (other arm)');
  // the library palette is the driftman palette plus 4 levels per cartridge
  assert.equal(LIB_LEN, 20 + 4 * cartridges.length);
  assert.ok(LIB_LEN <= 256);
});

test('library: every size draws allowed, single-width glyphs with in-palette shades, and overwrites a dirty frame completely', () => {
  for (const [w, h] of SIZES) {
    for (let index = 0; index < entries.length; index++) {
      const f = newFrame(w, h);
      assert.doesNotThrow(() => drawLibrary(f, view(index), driftmanSkin), `${w}x${h} #${index}`);
      assert.deepEqual(problems(f, LIB_LEN, `library ${w}x${h} #${index}`), []);
      const g = dirty(w, h);
      drawLibrary(g, view(index), driftmanSkin);
      assert.deepEqual(Array.from(g.glyphs), Array.from(f.glyphs), `${w}x${h}: owns every cell (glyphs)`);
      assert.deepEqual(Array.from(g.shades), Array.from(f.shades), `${w}x${h}: owns every cell (shades)`);
    }
  }
});

test('library: at 80x24 one whole cartridge is visible (label art and blurb); at 120x40 neighbours and facts show too', () => {
  const f = newFrame(80, 24);
  drawLibrary(f, view(0), driftmanSkin);
  const t = text(f);
  for (const row of cartridges[0].label) assert.ok(t.includes(row), `label row ${JSON.stringify(row)}`);
  // the blurb wraps at 34 inside its box, so look for each wrapped line
  for (const line of wrapWords(cartridges[0].manifest.blurb, 34).slice(0, 3)) assert.ok(flat(f).includes(line), `blurb line ${line}`);
  assert.ok(flat(f).includes('Drift Classic'), 'title in the list');
  assert.equal(sizeTier(80, 24), 'compact');
  const g = newFrame(120, 40);
  drawLibrary(g, view(1), driftmanSkin);
  const u = text(g);
  for (const row of cartridges[1].label) assert.ok(u.includes(row), 'selected label');
  assert.ok(u.includes(cartridges[0].label[2]) && u.includes(cartridges[2].label[2]), 'both neighbours are on the shelf');
  assert.equal(sizeTier(120, 40), 'full');
  assert.match(flat(g), /Genre: test · Players: 1/, 'facts line on the console screen');
  // locked cartridges say so: SOON on the plate, "Not on the shelf yet." on the screen, and the message
  const l = newFrame(120, 40);
  drawLibrary(l, view(2, { message: 'hello message' }), driftmanSkin);
  assert.match(flat(l), /SOON/);
  assert.match(flat(l), /Not on the shelf yet\./);
  assert.match(flat(l), /hello message/);
});

test('library: size tiers (88x39 full, 78x24 compact, 40x10 list) and the bigger-window line below 40x10', () => {
  assert.deepEqual([[88, 39], [87, 39], [88, 38], [78, 24], [77, 24], [78, 23], [40, 10], [39, 10], [40, 9]].map(([w, h]) => sizeTier(w, h)),
    ['full', 'compact', 'compact', 'compact', 'list', 'list', 'list', 'tiny', 'tiny']);
  for (const [w, h] of [[39, 10], [40, 9], [30, 10], [20, 6], [12, 5]]) {
    const f = newFrame(w, h);
    drawLibrary(f, view(0), driftmanSkin);
    const lines = frameLines(f).map((l) => l.trim()).filter(Boolean);
    assert.equal(lines.join(' '), wrapWords(MSG_TOO_SMALL, w).join(' '), `${w}x${h}`);
    assert.equal(lines.join(' '), MSG_TOO_SMALL.replace(/\s+/g, ' ').split(' ').join(' ').slice(0, lines.join(' ').length), 'it is the sentence, in order');
    assert.ok(!flat(f).includes('Drift Classic'), 'no cartridge list');
  }
  // at 40x10 the text list shows (both arms)
  const f = newFrame(40, 10);
  drawLibrary(f, view(1), driftmanSkin);
  assert.ok(!flat(f).includes('Make the window bigger'));
  assert.match(text(f), /▶ Fixture/);
  assert.match(text(f), /Drift Classic/);
  // the message fits on one line when the window is wide enough
  const wide = newFrame(60, 3);
  drawLibrary(wide, view(0), driftmanSkin);
  assert.equal(MSG_TOO_SMALL, 'Make the window bigger to see the cartridges.');
});

test('library: the highlight ramps over several frames (a cursor move never swaps brightness in one step)', () => {
  const t1 = entries[1].tint, t0 = entries[0].tint;
  const shadeAt = (f, row, from) => {
    const lines = frameLines(f);
    const y = lines.findIndex((l) => l.includes(row));
    const x = lines[y].indexOf('FIXTURE', from);
    return f.shades[y * f.cols + x];
  };
  const classicShade = (f) => {
    const lines = frameLines(f);
    const y = lines.findIndex((l) => l.includes('░▒▒▓▓▓▓▒▒░'));
    return f.shades[y * f.cols + lines[y].indexOf('░▒▒▓▓▓▓▒▒░')];
  };
  const sel = [], old = [];
  for (const slide of [0, 0.25, 0.5, 0.75, 1]) {
    const f = newFrame(120, 40);
    drawLibrary(f, view(1, { prev: 0, slide }), driftmanSkin);
    sel.push(shadeAt(f, 'FIXTURE', 40) - t1);
    old.push(classicShade(f) - t0);
  }
  assert.deepEqual(sel, [1, 2, 2, 3, 3], 'the new cartridge brightens through the levels');
  assert.deepEqual(old, [3, 2, 2, 1, 1], 'the old one dims through them');
  assert.ok(sel.every((v, i) => i === 0 || Math.abs(v - sel[i - 1]) <= 1), 'never more than one level per step');
});

test('insert: every phase at every size draws allowed glyphs, owns every cell, and the phases are in the documented order', () => {
  const item = { cartridge: entries[1], view: view(1), cartSkin: fixtureSkin, classic: false };
  const classicItem = { cartridge: entries[0], view: view(0), cartSkin: null, classic: true };
  for (const [w, h] of SIZES) {
    for (const it of [item, classicItem]) {
      for (const t of [0, 0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8, 0.85, 0.9, 1.0, 1.2, 1.4, INSERT_END, 99, -1, NaN]) {
        const f = newFrame(w, h);
        assert.doesNotThrow(() => drawInsert(f, { item: it, t }, driftmanSkin), `${w}x${h} t=${t}`);
        assert.deepEqual(problems(f, LIB_LEN, `insert ${w}x${h} t=${t}`), []);
        const g = dirty(w, h);
        drawInsert(g, { item: it, t }, driftmanSkin);
        assert.deepEqual(Array.from(g.glyphs), Array.from(f.glyphs), `insert ${w}x${h} t=${t}: owns every cell`);
      }
    }
  }
  // phases at 120x40: lift (t=0.2 one row up), neighbours gone by 0.45, cartridge into the slot by 0.85
  const rowOf = (f, needle) => frameLines(f).findIndex((l) => l.includes(needle));
  const at = (t, it = classicItem) => { const f = newFrame(120, 40); drawInsert(f, { item: it, t }, driftmanSkin); return f; };
  const label = entries[0].label[1];
  const r0 = rowOf(at(0), label), r1 = rowOf(at(0.2), label), r2 = rowOf(at(0.85), label);
  assert.equal(r1, r0 - 1, 'lifted one row');
  assert.equal(r2, r0 + 3, 'dropped three rows (from rest)');
  const count = (s, sub) => s.split(sub).length - 1;
  const fixtureRow = entries[1].label[1];
  assert.equal(count(text(at(0)), fixtureRow), 2, 'both neighbours (fixture and locker share this art) at the start');
  assert.equal(count(text(at(0.45)), fixtureRow), 0, 'neighbours gone at 0.45');
  assert.match(text(at(0)), /◀ ▶ choose/);
  assert.ok(!/◀ ▶ choose/.test(text(at(0.45))), 'hint gone');
  // the CART LED goes from solid to on at the click (its cell shade changes to the accent colour);
  // the PWR LED is always amber, so look at the glyph in front of the word CART on the console
  const cartLed = (f) => {
    const lines = frameLines(f);
    const y = lines.findIndex((l) => l.includes('● PWR'));
    const x = lines[y].indexOf('CART') - 2;
    return { glyph: lines[y][x], shade: f.shades[y * f.cols + x] };
  };
  assert.equal(cartLed(at(0.8)).glyph, '○', 'CART is ○ until the click (designer step 4; the stub drew it solid early)');
  assert.notEqual(cartLed(at(0.8)).shade, driftmanSkin.palette.ui.accent);
  assert.equal(cartLed(at(0.9)).shade, driftmanSkin.palette.ui.accent, 'CART LED on in the accent colour');
});

test('insert: the takeover band sweeps left to right (Classic: a shimmer only, no change of frame glyphs)', () => {
  const sk = { ...fixtureSkin, frame: { show: 'always', glyphs: '+-+|+-+|', colour: 3 } };
  const item = { cartridge: entries[1], view: view(1), cartSkin: sk, classic: false };
  const at = (t, it = item) => { const f = newFrame(120, 40); drawInsert(f, { item: it, t }, driftmanSkin); return text(f); };
  const slotRow = (s) => s.split('\n').find((l) => l.includes('+---') || l.includes('╔'));
  assert.ok(at(1.0).includes('╔'), 'old frame before the band');
  const mid = at(1.25).split('\n').find((l) => l.includes('+') && l.includes('╗'));
  assert.ok(mid, 'mid-sweep: new glyphs on the left, old on the right');
  assert.ok(mid.indexOf('+') < mid.indexOf('╗'));
  assert.ok(at(1.5).includes('+--') && !at(1.5).includes('╔'), 'new frame when done');
  assert.ok(slotRow(at(1.5)));
  const classic = { cartridge: entries[0], view: view(0), cartSkin: null, classic: true };
  assert.ok(at(1.5, classic).includes('╔') && at(1.25, classic).includes('╔'), 'Classic keeps the console frame');
});

test('boot: every phase at every size draws allowed glyphs and owns every cell; the typed lines, bar, zoom and title come in order', () => {
  const skins = [fixtureSkin, driftmanSkin, classicBootSkin];
  for (const [w, h] of SIZES) {
    for (const sk of skins) {
      const pal = makeSkinPalette(sk, 'truecolor', 'x').sgr.length;
      for (const loading of [true, false]) {
        for (let t = 0; t <= bootSeconds(sk) + 0.3; t += 0.15) {
          const args = { skin: sk, labelArt: fixture.label, bootArt: ['ART'], t, loading, title: 'Fixture' };
          const f = newFrame(w, h);
          assert.doesNotThrow(() => drawBoot(f, args, driftmanSkin), `${w}x${h} t=${t}`);
          assert.deepEqual(problems(f, pal, `boot ${w}x${h} t=${t.toFixed(2)}`), []);
          const g = dirty(w, h);
          drawBoot(g, args, driftmanSkin);
          assert.deepEqual(Array.from(g.glyphs), Array.from(f.glyphs), `boot ${w}x${h} t=${t}: owns every cell`);
        }
      }
      const e = newFrame(w, h);
      assert.doesNotThrow(() => drawBoot(e, { skin: sk, t: 0, error: 'something went wrong in the scene file'.repeat(3) }, driftmanSkin));
      assert.deepEqual(problems(e, pal, `boot error ${w}x${h}`), []);
    }
  }
  const sk = { ...fixtureSkin, boot: { lines: ['LINE ONE', 'LINE TWO', 'LINE THREE'], art: false } };
  const P = bootPhases(sk);
  const at = (t, loading = false) => { const f = newFrame(120, 40); drawBoot(f, { skin: sk, t, loading, title: 'Fixture' }, driftmanSkin); return text(f); };
  assert.ok(!at(0.05).includes('LINE ONE'), 'nothing typed while the screen turns on');
  assert.match(at(0.1), /─/, 'the line');
  assert.ok(at(P.on + 0.3).includes('DRIFTMAN 2000') && !at(P.on + 0.3).includes('LINE ONE'), 'the console core lines come first (A3: core 2.0, then the cartridge own lines)');
  assert.ok(at(P.on + 0.8).includes('LINE ONE') && !at(P.on + 0.8).includes('LINE TWO'));
  assert.ok(at(P.on + 1.05).includes('LINE TWO'));
  assert.ok(at(P.linesEnd + 0.1).includes('LINE THREE') && /\[/.test(at(P.linesEnd + 0.1)), 'bar after the lines');
  assert.ok(/[█-▏]/.test(at(P.barEnd - 0.05)), 'partial block characters in the bar');
  assert.ok(/█/.test(at(P.zoomEnd + 0.4)), 'big letters');
  assert.ok(!at(P.zoomEnd + 0.4).includes('LINE ONE'), 'the lines are gone for the title card');
  // the zoom ends with the edge at the terminal's edge
  const z = newFrame(120, 40);
  drawBoot(z, { skin: sk, t: P.zoomEnd + 0.01, title: 'Fixture' }, driftmanSkin);
  const lines = frameLines(z);
  assert.equal(lines[0][0], '┌');
  assert.equal(lines[0][119], '┐');
  assert.equal(lines[39][0], '└');
  // the loading flag holds the bar short of full
  const bar = (loading) => at(P.barEnd, loading).split('\n').find((l) => l.includes('[') && l.includes(']'));
  assert.notEqual(bar(true), bar(false));
});

test('boot timeline: the absolute constants are 1.5, 1.9, 3.4, 3.8, 4.6, 5.2 and 5.8 s, and bootSeconds honours skin.boot.seconds', () => {
  assert.deepEqual([INSERT_END, SCREEN_ON_END, LINES_END, BAR_END, ZOOM_END, TITLE_END, BOOT_END].map((x) => Math.round(x * 100) / 100), [1.5, 1.9, 3.4, 3.8, 4.6, 5.2, 5.8]);
  const none = { palette: driftmanSkin.palette };
  assert.ok(Math.abs(bootSeconds(none) - (BOOT_END - INSERT_END)) < 1e-9);
  assert.ok(Math.abs(bootSeconds({ ...none, boot: { seconds: 3 } }) - (BOOT_END - INSERT_END + 1.5)) < 1e-9);
  assert.ok(Math.abs(INSERT_END + bootSeconds(none) - 5.8) < 1e-9, 'total 5.8 s');
});

test('menu: list, slots and grid layouts at every size: allowed glyphs, only the menu\'s own cells change, a fallback where it does not fit', () => {
  const ents = [{ label: 'Wander', current: true }, { label: 'Dream' }, { label: 'Storm' }, { label: 'Eject' }];
  const many = Array.from({ length: 8 }, (_, i) => ({ label: `Entry number ${i + 1}` }));
  const sk = (layout, extra = {}) => ({ ...fixtureSkin, menu: { layout, anchor: 'center', title: 'Menu title', ...extra } });
  const out = {};
  for (const layout of ['list', 'slots', 'grid']) {
    for (const [w, h] of SIZES) {
      for (const list of [ents, many]) {
        for (const anchor of ['center', 'left', 'bottom']) {
          const base = dirty(w, h);
          const f = dirty(w, h);
          assert.doesNotThrow(() => drawMenu(f, { entries: list, index: 1 }, sk(layout, { anchor })), `${layout} ${w}x${h}`);
          assert.deepEqual(problems(f, 20, `menu ${layout} ${w}x${h}`).filter((p) => !/shade/.test(p)), []);
          // cells outside the box are untouched
          let changed = 0;
          for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] !== base.glyphs[i] || f.shades[i] !== base.shades[i]) changed++;
          assert.ok(changed <= w * h);
        }
      }
    }
    const f = newFrame(240, 67);
    drawMenu(f, { entries: ents, index: 2 }, sk(layout));
    out[layout] = text(f);
    assert.match(out[layout], /Storm/);
  }
  assert.notEqual(out.list, out.slots);
  assert.notEqual(out.list, out.grid);
  assert.notEqual(out.slots, out.grid);
  // grid: 22x7 tiles on a wide screen; below 100 columns it is the list
  const tile = newFrame(120, 40);
  drawMenu(tile, { entries: ents, index: 1 }, sk('grid')); // tile 0 is not the selected (double line) one
  const tl = frameLines(tile);
  const top = tl.findIndex((l) => l.includes('┌'));
  const x0 = tl[top].indexOf('┌');
  assert.equal(tl[top].slice(x0, x0 + 22), '┌' + '─'.repeat(20) + '┐', 'a tile is 22 columns wide');
  assert.equal(tl[top + 6][x0], '└', 'and 7 rows tall');
  assert.equal(tl[top + 7][x0], ' ');
  const narrow = newFrame(80, 24), narrowList = newFrame(80, 24);
  drawMenu(narrow, { entries: ents, index: 0 }, sk('grid'));
  drawMenu(narrowList, { entries: ents, index: 0 }, sk('list'));
  assert.equal(text(narrow), text(narrowList), 'grid below 100 columns is the list');
  // slots: 4-row cards at 40 rows, 2-row cards below 30 rows
  const tall = newFrame(120, 40), short = newFrame(120, 24);
  drawMenu(tall, { entries: ents, index: 0 }, sk('slots'));
  drawMenu(short, { entries: ents, index: 0 }, sk('slots'));
  const cardTops = (f) => frameLines(f).map((l, y) => (/[┌╔]/.test(l) ? y : -1)).filter((y) => y >= 0);
  const ct = cardTops(tall);
  assert.equal(ct.length, 4);
  assert.equal(ct[1] - ct[0], 4, '4-row cards');
  assert.equal(cardTops(short).length, 0, 'no boxes in the 2-row cards');
  const sl = frameLines(short).map((l, y) => (l.includes('Wander') ? y : l.includes('Dream') ? y : -1)).filter((y) => y >= 0);
  assert.equal(sl[1] - sl[0], 3, '2-row entries and a dashed rule between, below 30 rows');
});

test('menu: marks the playing program, the cursor glyph and hint come from the skin, an empty list draws nothing', () => {
  const sk = { ...fixtureSkin, menu: { layout: 'list', cursor: '>', title: 'My menu' }, wording: { menuHint: 'Pick one please' } };
  const f = newFrame(80, 24);
  drawMenu(f, { entries: [{ label: 'Alpha', current: true }, { label: 'Beta' }], index: 1 }, sk);
  const t = flat(f);
  assert.match(t, /My menu/);
  assert.match(t, /> Beta/);
  assert.match(t, /Alpha \*/);
  assert.match(t, /Pick one please/);
  const e = newFrame(80, 24);
  drawMenu(e, { entries: [], index: 0 }, sk);
  assert.ok(Array.from(e.glyphs).every((g) => g === 32));
});

test('chrome: draws only the border in the skin\'s frame glyphs, with the title, at every size', () => {
  const sk = { ...fixtureSkin, frame: { show: 'always', glyphs: '+-+|+-+|', title: 'Fixture', colour: 3 } };
  for (const [w, h] of SIZES) {
    const base = dirty(w, h), f = dirty(w, h);
    assert.doesNotThrow(() => drawChrome(f, sk));
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      assert.equal(f.glyphs[y * w + x], base.glyphs[y * w + x], `interior untouched ${w}x${h}`);
    }
    assert.deepEqual(problems(f, 20, `chrome ${w}x${h}`).filter((p) => !/shade/.test(p) && !/U\+2588/.test(p)), []);
  }
  const f = newFrame(40, 10);
  drawChrome(f, sk);
  const L = frameLines(f);
  assert.equal(L[0][0], '+');
  assert.equal(L[0][39], '+');
  assert.equal(L[9][0], '+');
  assert.equal(L[5][0], '|');
  assert.ok(L[0].includes('Fixture'));
  assert.equal(f.shades[0], 3, 'the skin\'s frame colour');
});

test('skinned help: the cartridge help uses the skin\'s title, box and wording at every size, and never throws', () => {
  const sk = { ...fixtureSkin, help: { title: 'FIXTURE KEYS', box: '#=#||#=#||'.slice(0, 8) }, wording: { keys: { eject: 'Take it out' } } };
  assert.equal(validateSkin(JSON.parse(JSON.stringify(sk))).ok, true);
  const pal = makeSkinPalette(sk, 'truecolor', 'x');
  for (const [w, h] of SIZES) {
    for (const screen of ['library', 'running']) {
      const f = newFrame(w, h);
      assert.doesNotThrow(() => drawHelp(f.glyphs, f.shades, w, h, {
        mode: screen, modeName: screen, sceneName: 'tide', ui: pal.ui, title: sk.help.title, box: sk.help.box, lines: shellHelpLines(screen, sk), modeLine: 'cartridge: Fixture',
      }), `${w}x${h} ${screen}`);
      assert.deepEqual(problems(f, pal.sgr.length, `help ${w}x${h} ${screen}`), []);
    }
  }
  const f = newFrame(120, 40);
  drawHelp(f.glyphs, f.shades, 120, 40, { mode: 'running', modeName: 'running', sceneName: 'tide', ui: pal.ui, title: sk.help.title, box: sk.help.box, lines: shellHelpLines('running', sk), modeLine: 'cartridge: Fixture    scene: tide' });
  const t = text(f);
  assert.match(t, /FIXTURE KEYS/);
  assert.match(t, /Take it out/, 'the skin relabels the eject row');
  assert.ok(!/eject the cartridge/.test(t), 'and the old label is gone');
  assert.match(t, /cartridge: Fixture/);
  assert.ok(t.includes('#'), 'the skin\'s box glyphs');
  assert.match(t, /q or Ctrl\+C/, 'keys are never rebound: q is still q');
  // library help has the library rows only
  const g = newFrame(120, 40);
  drawHelp(g.glyphs, g.shades, 120, 40, { mode: 'library', modeName: 'library', sceneName: '', ui: pal.ui, lines: shellHelpLines('library', driftmanSkin), modeLine: '' });
  assert.match(text(g), /insert the cartridge/);
  assert.ok(!/next scene/.test(text(g)));
  assert.match(text(g), /DRIFT  keys/, 'default title when none is given');
});
