// DRIFT-7 C6: the Driftman 9000 cartridge (DM-9K), stage A: the shell (manifest, skin, label, foil) and a placeholder Rosette.
// The shared suites (cartridge-scenes, cartridges, shell-*) already run its scene through every check once it is installed;
// this file holds what is the 9000's own. Lists are read from the files, so it stays right as later stages add visions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverCartridges, loadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { validateSkin, validateManifest, parseTextAsset, LIMITS } from '../src/cartridge/schema.js';
import { paletteLength } from '../src/cartridge/palette.js';
import { renderScene } from '../src/cells.js';
import { relY } from '../src/pixels.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { knownKeyIds } from '../src/keymap.js';
import rosette, { MESSAGE, MIN_W, MIN_H } from '../cartridges/driftman-9000/scenes/rosette.js';
import { tmpRoot } from './helpers-cartridge.js';

const DIR = path.join(INSTALL_DIR, 'driftman-9000');
const readText = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const readJson = (f) => JSON.parse(readText(f));
const rows = (f) => { const l = readText(f).split(/\r?\n/); if (l[l.length - 1] === '') l.pop(); return l; };
const manifest = readJson('manifest.json');
const BANNED = ['∫', '≡', '◍', '◎', '◐', '◑', '◒', '◓', '◢', '◣'];

// ---- the loader and the shelf

test('driftman-9000: the install folder accepts it, with no errors, between Delza and Last Fantasy on the shelf', () => {
  const r = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
  assert.deepEqual(r.errors, []);
  const ids = r.cartridges.map((c) => c.id);
  const i = ids.indexOf('driftman-9000');
  assert.ok(i > 0, ids.join());
  assert.equal(ids[i - 1], 'delza');
  assert.equal(ids[i + 1], 'last-fantasy');
  const c = r.cartridges[i];
  assert.equal(c.locked, false);
  assert.equal(c.runtime, 'cartridge');
  assert.equal(c.trusted, true);
  assert.equal(c.manifest.code, 'DM-9K');
  assert.equal(c.manifest.format, 2);
  assert.equal(c.manifest.title, 'Driftman 9000');
});

test('driftman-9000 manifest: the designer\'s copy, foil and facts', () => {
  const v = validateManifest(manifest, { trusted: true });
  assert.equal(v.ok, true, v.reason);
  assert.equal(manifest.blurb, 'A cartridge from the far future. Handle with wonder.');
  assert.deepEqual(manifest.facts, ['3 visions · about 3 min · full colour', '1 of 1 · runs on light']);
  assert.equal(manifest.labelHue, '#3FE8FF');
  assert.deepEqual(manifest.foil, { hues: ['#3FE8FF', '#A77BFF', '#FF4FD8', '#FFD36B', '#5CFFB8'], style: 'holo' });
  assert.equal(manifest.locked, undefined, 'unlocked');
  assert.equal(manifest.console, undefined, 'no console hook yet (a later stage)');
});

test('driftman-9000 program: one program, "transmission", a dissolve through the scenes in menu order, 60 s each; no Eject entry', () => {
  assert.equal(manifest.programs.length, 1);
  const p = manifest.programs[0];
  assert.equal(p.id, 'transmission');
  assert.equal(p.transition, 'dissolve');
  assert.equal(p.sceneSeconds, 60);
  assert.equal(manifest.start, 'transmission');
  assert.deepEqual(p.scenes, manifest.menu.map((m) => m.scene), 'program order is the menu order');
  assert.deepEqual(p.scenes, manifest.scenes.map((s) => s.id), 'and the scene list order');
  assert.ok(manifest.menu.every((m) => m.program === 'transmission' && m.action === undefined), 'no Eject entry');
  assert.ok(manifest.menu.every((m) => [...m.note].length <= LIMITS.menuNote));
  assert.ok(manifest.scenes.every((s) => s.kind === 'cells' && s.rgb === true), 'every vision is a full-colour cells scene');
});

// ---- the trust wall (both arms)

test('driftman-9000 trust: a copy in the user folder (data only) is refused for its code; the install folder takes the same files', async () => {
  const root = tmpRoot();
  fs.cpSync(DIR, path.join(root, 'driftman-9000'), { recursive: true });
  const user = discoverCartridges({ dirs: [{ dir: root, trusted: false }] });
  assert.equal(user.cartridges.length, 0, 'ignored in the user folder');
  assert.equal(user.errors.length, 1, JSON.stringify(user.errors));
  assert.match(user.errors[0].reason, /code|rgb|full-colour/i);
  const inst = discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
  assert.deepEqual(inst.errors, []);
  assert.equal(inst.cartridges.length, 1);
  assert.equal(inst.cartridges[0].trusted, true);
  // the scene code itself is loaded from the real install folder (a temp copy cannot reach ../../../src)
  const real = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.find((c) => c.id === 'driftman-9000');
  const res = await loadScenes(real);
  assert.deepEqual(res.errors, []);
  assert.equal(res.scenes.length, manifest.scenes.length);
  assert.ok(res.scenes.every((s) => s.rgb === true));
  const m = validateManifest(manifest, { trusted: false });
  assert.equal(m.ok, false);
  assert.match(m.reason, /code runs only from the install folder/, m.reason);
});

// ---- skin

test('driftman-9000 skin: validates, background #05060C, palette and every colour index as designed, wording within the limits', () => {
  const v = validateSkin(readJson('skin.json'));
  assert.equal(v.ok, true, v.reason);
  const s = v.skin;
  assert.equal(s.palette.bg.toUpperCase(), '#05060C');
  assert.equal(s.palette.hue.toUpperCase(), '#3FE8FF');
  assert.deepEqual(s.palette.colours.map((c) => c.toUpperCase()), ['#EAF2FF', '#8A9BC4', '#2A3A66', '#4A6AB0', '#A77BFF', '#FF4FD8', '#FFD36B', '#5CFFB8']);
  assert.deepEqual(s.palette.ui, { text: 16, dim: 17, head: 15, accent: 15 });
  assert.equal(s.boot.valueColour, 23);
  assert.equal(s.frame.colour, 19);
  assert.equal(paletteLength(s), 24);
  assert.deepEqual(s.frame, { show: 'menu', glyphs: '╭─╮│╯─╰│', title: 'DRIFTMAN 9000', colour: 19, ornament: '◇ ─── ◆ ─── ◇' });
  assert.equal(s.console.title.style, 'spaced');
  assert.equal(s.menu.layout, 'grid');
  assert.equal(s.menu.cursor, '◆');
  assert.equal(s.menu.title, 'THE THREE VISIONS');
  assert.equal(s.menu.autostartSeconds, 15);
  assert.deepEqual(s.help.groups, { Cartridge: 'Visions', Other: 'Machine' });
  assert.deepEqual(s.boot.lines, ['CORE 2.0 ....... SUPERSEDED', 'LUMEN CORE ..... 9.0', 'MEMORY ......... ALL OF IT', 'Good morning. It has been a while.']);
  assert.equal(s.boot.art, false);
  assert.equal(s.insert.text, 'SIGNAL FROM THE FAR FUTURE · HOLD STILL');
  assert.equal(s.wording.menuHint, 'arrows choose · Enter wakes it · e folds away · h keys');
  const keys = Object.entries(s.wording.keys);
  assert.deepEqual(keys.map(([k]) => k).sort(), ['close', 'eject', 'faster', 'help', 'menu', 'menu-next', 'menu-prev', 'pause', 'quit', 'scene-next', 'seasons', 'slower']);
  for (const [k, label] of keys) {
    assert.ok(knownKeyIds().has(k), k);
    assert.ok([...label].length <= 23, `${k}: '${label}' is ${[...label].length} characters`);
  }
});

// ---- label

const MIRROR = { '▗': '▖', '▖': '▗', '▝': '▘', '▘': '▝', '▟': '▙', '▙': '▟', '▐': '▌', '▌': '▐', '▜': '▛', '▛': '▜', '◀': '▶', '▶': '◀', '╲': '╱', '╱': '╲', '◣': '◢', '◢': '◣' };
const mirrorOf = (ch) => MIRROR[ch] ?? ch;
const TEXT_ROW = 8; // "9 · 0 · 0 · 0": 13 columns, digits do not mirror, centred as near as 13 in 24 allows

test('driftman-9000 label: 24x10, allowed glyphs only, none of the banned ones, the centre mark is the cool diamond', () => {
  const lines = rows('label.txt');
  assert.equal(lines.length, 10);
  assert.ok(lines.every((l) => [...l].length <= 24));
  assert.equal(Math.max(...lines.map((l) => [...l].length)), 24, 'reaches the right edge');
  const r = parseTextAsset(lines.join('\n'), { maxW: 24, maxH: 10 });
  assert.equal(r.ok, true, r.reason);
  for (const l of lines) for (const ch of l) { assert.ok(isAllowedGlyph(ch.codePointAt(0)), ch); assert.ok(!BANNED.includes(ch), `banned ${ch}`); }
  assert.ok(lines[3].includes('◆◆'), 'the centre mark is the diamond pair on the middle row');
  for (const ch of ['●', '○', '◉']) assert.ok(!lines.join('').includes(ch), 'no round eye');
});

test('driftman-9000 label: symmetric about the line between columns 11 and 12 (glyph-mirrored: ▗ with ▖, ◀ with ▶, ╲ with ╱), digits row centred within one column', () => {
  const lines = rows('label.txt').map((l) => [...l.padEnd(24, ' ')]);
  assert.ok(lines.every((l) => l.length === 24));
  for (let r = 0; r < lines.length; r++) {
    if (r === TEXT_ROW) continue;
    for (let c = 0; c < 12; c++) assert.equal(mirrorOf(lines[r][c]), lines[r][23 - c], `row ${r}: column ${c} (${lines[r][c]}) against column ${23 - c} (${lines[r][23 - c]})`);
  }
  const t = lines[TEXT_ROW].join('');
  const left = t.length - t.trimStart().length, right = t.length - t.trimEnd().length;
  assert.equal(t.trim(), '9 · 0 · 0 · 0');
  assert.ok(Math.abs(left - right) <= 1, `padding ${left} / ${right}`);
  // control: the mirror check does see a broken label
  const broken = lines[3].slice(); broken[9] = '▶';
  assert.notEqual(mirrorOf(broken[9]), broken[14], 'control: a wrong glyph is caught');
});

test('driftman-9000 label ink: same shape as the label, digits 0 to 3 where the label has ink, symmetric', () => {
  const lab = rows('label.txt'), ink = rows('label-ink.txt');
  assert.equal(ink.length, lab.length);
  for (let r = 0; r < lab.length; r++) {
    const L = [...lab[r].padEnd(24, ' ')], I = [...ink[r].padEnd(24, ' ')];
    for (let c = 0; c < 24; c++) {
      assert.ok(/[0-3 ]/.test(I[c]), `row ${r} col ${c}`);
      if (L[c] !== ' ') assert.ok(I[c] !== ' ', `row ${r} col ${c}: '${L[c]}' has no ink digit`);
      if (L[c] === ' ') assert.equal(I[c], ' ', `row ${r} col ${c}: ink where the label is blank`);
    }
    if (r !== TEXT_ROW) for (let c = 0; c < 12; c++) assert.equal(I[c], I[23 - c], `ink row ${r} col ${c}`);
  }
});

test('driftman-9000: no banned glyph anywhere in the cartridge folder, comments included', () => {
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };
  const files = walk(DIR);
  assert.ok(files.length >= 5);
  for (const f of files) for (const g of BANNED) assert.ok(!fs.readFileSync(f, 'utf8').includes(g), `${f}: ${g}`);
});

// ---- the placeholder Rosette

const text = (f, w) => { const out = []; for (let y = 0; y < f.rows; y++) out.push(String.fromCodePoint(...f.glyphs.slice(y * w, (y + 1) * w))); return out; };

test('rosette: any size, 0x0 and 1x1 included, draws without throwing and fills every buffer', () => {
  for (const [w, h] of [[0, 0], [1, 1], [0, 30], [30, 0], [2, 200], [59, 19], [60, 20], [61, 21], [120, 40], [240, 67]]) {
    for (const t of [0, 3.3, 15, 44.9, 61]) {
      const f = renderScene(rosette, t, w, h, 1);
      assert.equal(f.glyphs.length, w * h);
      for (let i = 0; i < f.glyphs.length; i++) {
        assert.ok(isAllowedGlyph(f.glyphs[i]));
        assert.equal(f.colours[i], 255, 'every cell is a full-colour cell');
        assert.ok(f.fg[i] <= 0xffffff && f.bg[i] <= 0xffffff);
      }
    }
  }
});

test('rosette: below 60 x 20 one centred dim line "This vision needs 60 x 20."; at 60 x 20 the picture instead (both arms)', () => {
  assert.equal(MESSAGE, 'This vision needs 60 x 20.');
  assert.equal(MIN_W, 60); assert.equal(MIN_H, 20);
  for (const [w, h] of [[59, 19], [59, 40], [100, 19], [40, 12]]) {
    const f = renderScene(rosette, 5, w, h, 1);
    const lines = text(f, w);
    const at = lines.map((l, y) => ({ y, x: l.indexOf(MESSAGE) })).filter((p) => p.x >= 0);
    assert.equal(at.length, 1, `${w}x${h}: the message is drawn once`);
    assert.equal(at[0].y, Math.floor(h / 2), `${w}x${h}: middle row`);
    const left = at[0].x, right = w - left - MESSAGE.length;
    assert.ok(Math.abs(left - right) <= 1, `${w}x${h}: centred (${left} / ${right})`);
    // nothing else is drawn
    for (let i = 0; i < w * h; i++) if (Math.floor(i / w) !== at[0].y) assert.equal(f.glyphs[i], 32);
    // dim: the letters are dimmer than the skin's mist
    const li = at[0].y * w + left;
    assert.ok(relY(f.fg[li]) < relY(0x8a9bc4), 'dim');
  }
  for (const [w, h] of [[60, 20], [120, 40]]) {
    const f = renderScene(rosette, 5, w, h, 1);
    assert.ok(!text(f, w).some((l) => l.includes('This vision')), `${w}x${h}: the picture, not the message`);
  }
  // a window narrower than the line clips it without throwing
  const narrow = renderScene(rosette, 0, 10, 5, 1);
  assert.equal(narrow.glyphs.length, 50);
});

test('rosette: deterministic in (seed, t - t0): same inputs same frame, a later t0 shifts the picture, another seed differs, no state between calls', () => {
  const grab = (t, seed, t0) => {
    const w = 80, h = 24, n = w * h;
    const params = { seed, t0, glyphs: new Uint16Array(n), colours: new Uint8Array(n).fill(255), fg: new Uint32Array(n), bg: new Uint32Array(n) };
    rosette(t, w, h, params);
    return JSON.stringify([Array.from(params.glyphs), Array.from(params.fg), Array.from(params.bg)]);
  };
  const a = grab(12.5, 1, 0);
  assert.equal(grab(12.5, 1, 0), a);
  assert.equal(grab(22.5, 1, 10), a, 'depends on t - t0 only');
  assert.notEqual(grab(12.5, 2, 0), a, 'seed matters');
  assert.notEqual(grab(13.5, 1, 0), a, 'time matters');
  assert.equal(grab(12.5, 1, 0), a, 'and nothing was left over from the calls in between');
});

test('rosette: the fold count and hue move over 60 s (not frozen) and the manifest scene and module agree on rgb', () => {
  assert.equal(rosette.rgb, true);
  assert.equal(rosette.kind, 'cells');
  assert.equal(rosette.id, 'rosette');
  const sig = (t) => { const f = renderScene(rosette, t, 100, 30, 1); return Array.from(f.fg).join(); };
  assert.equal(new Set([0, 7, 14, 16, 31, 46, 59].map(sig)).size, 7);
});
