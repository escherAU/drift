// DRIFT-4 units under src/cartridge: the schema validators, the text scene, the skin palette.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ID_RE, RESERVED, FORMAT, LIMITS, validateManifest, validateSkin, parseTextAsset, isValidId } from '../src/cartridge/schema.js';
import { parseTextScene, makeTextScene, TYPE_CPS, HOLD_SECONDS, FADE_SECONDS, REST_SECONDS } from '../src/cartridge/textscene.js';
import { makeSkinPalette, relLuminance, paletteLength } from '../src/cartridge/palette.js';
import { renderScene } from '../src/cells.js';
import { sgrFor, parseHex } from '../src/color.js';
import { dataManifest, lockedManifest } from './helpers-cartridge.js';

test('schema constants: FORMAT 1, the id pattern, the reserved list', () => {
  assert.equal(FORMAT, 1);
  assert.equal(ID_RE.source, '^[a-z][a-z0-9-]{0,30}[a-z0-9]$');
  assert.deepEqual([...RESERVED].sort(), ['aux', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'con', 'last', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9', 'nul', 'prn']);
  for (const ok of ['ab', 'delza', 'night-drive', 'a1', 'x'.repeat(32)]) assert.ok(ID_RE.test(ok), ok);
  for (const bad of ['a', 'x'.repeat(33), 'A1', '1a', 'a-', '-a', 'a_b', 'a.b', 'a b', 'a/b', '..', '']) assert.ok(!ID_RE.test(bad), bad);
  assert.ok(isValidId('delza') && !isValidId('con') && !isValidId('last') && !isValidId(5));
});

test('validateManifest: locked manifests allow only format, id, title, version, author, blurb, code, facts, labelHue (and locked itself)', () => {
  assert.equal(validateManifest(lockedManifest('abc', { labelHue: '#112233' })).ok, true);
  for (const k of ['runtime', 'scenes', 'programs', 'start', 'menu']) {
    const r = validateManifest(lockedManifest('abc', { [k]: k === 'runtime' ? 'cartridge' : [] }));
    assert.equal(r.ok, false, k);
    assert.match(r.reason, new RegExp(`locked cartridges cannot have '${k}'`));
  }
  assert.match(validateManifest(lockedManifest('abc', { code: 'DM-1' })).reason, /exactly 5 characters/);
  assert.match(validateManifest(lockedManifest('abc', { code: 'DM-001' })).reason, /exactly 5 characters/);
  assert.match(validateManifest(lockedManifest('abc', { code: 'dm-01' })).reason, /exactly 5 characters/);
  assert.match(validateManifest(lockedManifest('abc', { facts: 'x' })).reason, /'facts' must list/);
  assert.match(validateManifest(lockedManifest('abc', { facts: ['x'.repeat(41)] })).reason, /facts\[0\] is 41 characters, max 40/);
  assert.match(validateManifest(lockedManifest('abc', { facts: Array(7).fill('x') })).reason, /at most 6/);
  assert.match(validateManifest({ ...lockedManifest('abc'), locked: 'yes' }).reason, /'locked' must be true or false/);
});

test('validateManifest: field checks (version, labelHue, text length and glyphs, non-objects)', () => {
  const ok = (over) => validateManifest(dataManifest('abc', over));
  assert.equal(ok({}).ok, true);
  assert.match(ok({ version: '1.0' }).reason, /'version' must look like 1\.0\.0/);
  assert.match(ok({ labelHue: 'red' }).reason, /labelHue/);
  assert.match(ok({ labelHue: '#12345' }).reason, /labelHue/);
  assert.equal(ok({ labelHue: '#7FB069' }).ok, true);
  assert.match(ok({ title: 'x'.repeat(31) }).reason, /title is 31 characters, max 30/);
  assert.match(ok({ blurb: 'x'.repeat(61) }).reason, /blurb is 61 characters, max 60/);
  assert.match(ok({ title: '' }).reason, /title must not be empty/);
  assert.match(ok({ title: 'Tab\there' }).reason, /U\+0009/);
  assert.match(ok({ title: String.fromCodePoint(0x1f600) }).reason, /U\+1F600/);
  assert.match(ok({ author: 5 }).reason, /author must be text/);
  for (const bad of [null, [], 'x', 5, undefined]) assert.equal(validateManifest(bad).ok, false);
  assert.match(ok({ format: 1.5 }).reason, /whole number/);
  assert.match(ok({ format: 0 }).reason, /whole number/);
  assert.match(ok({ format: 99 }).reason, /needs a newer Drift/);
  assert.match(ok({ runtime: 'native' }).reason, /'runtime' must be/);
  // code and facts are allowed on unlocked manifests too (a Classic-runtime one may carry them)
  const withCode = ok({ code: 'DM-01', facts: ['4 modes'] });
  assert.equal(withCode.ok, true);
  assert.equal(withCode.manifest.code, 'DM-01');
  assert.deepEqual(withCode.manifest.facts, ['4 modes']);
  assert.match(ok({ code: 'DM-1' }).reason, /exactly 5 characters/);
  assert.match(ok({ facts: ['x'.repeat(41)] }).reason, /facts\[0\] is 41 characters, max 40/);
  assert.match(ok({ facts: Array(7).fill('x') }).reason, /at most 6/);
  const cl = validateManifest({ format: 1, id: 'classic', title: 'Drift Classic', version: '1.0.0', author: 'Drift', blurb: 'b', runtime: 'classic', code: 'DM-00', facts: ['a'] }, { trusted: true });
  assert.equal(cl.ok, true);
  assert.equal(cl.manifest.code, 'DM-00');
});

test('validateManifest: the result is a normalised copy (defaults filled, extras impossible)', () => {
  const src = dataManifest('abc');
  const r = validateManifest(src);
  assert.equal(r.ok, true);
  assert.notEqual(r.manifest, src);
  assert.equal(r.manifest.locked, false);
  assert.deepEqual(r.manifest.programs[0], { id: 'main', title: 'Main', transition: 'dissolve', scenes: ['sandbox'], sceneSeconds: 180 });
  assert.deepEqual(r.manifest.scenes[0], { id: 'sandbox', kind: 'builtin', title: 'sandbox', ref: 'sand' });
  const cross = validateManifest(dataManifest('abc', { scenes: [{ id: 'pl', kind: 'builtin', ref: 'plasma' }], programs: [{ id: 'main', transition: 'crossfade', scenes: ['pl'] }] }));
  assert.equal(cross.manifest.programs[0].fadeSeconds, 15);
  assert.match(validateManifest(dataManifest('abc', { scenes: [{ id: 'dupe', kind: 'builtin', ref: 'sand' }, { id: 'dupe', kind: 'builtin', ref: 'bounce' }] })).reason, /duplicate scene id 'dupe'/);
  const twoPrograms = dataManifest('abc');
  twoPrograms.programs.push({ ...twoPrograms.programs[0] });
  assert.match(validateManifest(twoPrograms).reason, /duplicate program id 'main'/);
});

test('validateManifest: code scene kinds need trust, with the stated reason', () => {
  const m = dataManifest('abc', { scenes: [{ id: 'haze', kind: 'field' }], programs: [{ id: 'main', transition: 'crossfade', scenes: ['haze'], sceneSeconds: 60, fadeSeconds: 10 }] });
  assert.equal(validateManifest(m, { trusted: true }).ok, true);
  for (const kind of ['field', 'cells', 'sim']) {
    const x = dataManifest('abc', { scenes: [{ id: 'haze', kind }], programs: [{ id: 'main', transition: kind === 'field' ? 'crossfade' : 'dissolve', scenes: ['haze'], sceneSeconds: 60, fadeSeconds: kind === 'field' ? 10 : undefined }] });
    assert.match(validateManifest(x, { trusted: false }).reason, /user cartridges cannot contain code in this version/, kind);
  }
  assert.equal(validateManifest(m).ok, false, 'trusted defaults to false');
  const refOnText = dataManifest('abc', { scenes: [{ id: 'note', kind: 'text', ref: 'sand' }], programs: [{ id: 'main', transition: 'dissolve', scenes: ['note'] }] });
  assert.match(validateManifest(refOnText).reason, /only builtin scenes take a 'ref'/);
});

test('validateManifest: chapters are optional, each names a scene, and every field is checked', () => {
  const ch = (over = {}) => ({ id: 'sandbox', numeral: 'I', place: 'The Shore', line: 'A quiet beginning.', icon: ['/\\', '\\/'], minutes: 5, ...over });
  const withCh = (chapters) => validateManifest(dataManifest('abc', { chapters }));
  assert.equal(validateManifest(dataManifest('abc')).manifest.chapters, undefined, 'optional');
  const good = withCh([ch()]);
  assert.equal(good.ok, true);
  assert.deepEqual(good.manifest.chapters, [ch()]);
  assert.notEqual(good.manifest.chapters[0], undefined);
  assert.match(withCh([ch({ id: 'nowhere' })]).reason, /chapters\[0\]: unknown scene "nowhere"/);
  assert.match(withCh([ch({ id: 5 })]).reason, /chapters\[0\]: unknown scene 5/);
  assert.match(withCh([ch(), ch()]).reason, /chapters\[1\]: duplicate chapter 'sandbox'/);
  assert.match(withCh([ch({ line: 'x'.repeat(65) })]).reason, /chapters\[0\]\.line is 65 characters, max 64/);
  assert.equal(withCh([ch({ line: 'x'.repeat(64) })]).ok, true);
  assert.match(withCh([ch({ line: 'bad ' + String.fromCodePoint(0x2196) })]).reason, /U\+2196/);
  assert.match(withCh([ch({ place: String.fromCodePoint(0x1f600) })]).reason, /chapters\[0\]\.place has U\+1F600/);
  assert.match(withCh([ch({ numeral: '' })]).reason, /numeral must not be empty/);
  assert.match(withCh([ch({ icon: ['ab'] })]).reason, /icon must be two pieces of text/);
  assert.match(withCh([ch({ icon: 'ab' })]).reason, /icon must be two pieces of text/);
  assert.match(withCh([ch({ icon: ['abcdef', 'x'] })]).reason, /icon\[0\] is 6 characters, max 5/);
  assert.match(withCh([ch({ icon: ['ok', String.fromCodePoint(0x2196)] })]).reason, /icon\[1\] has U\+2196/);
  assert.match(withCh([ch({ minutes: 0 })]).reason, /minutes must be a whole number from 1 to 999/);
  assert.match(withCh([ch({ minutes: 1.5 })]).reason, /minutes must be a whole number/);
  assert.match(withCh([ch({ extra: 1 })]).reason, /unknown field 'extra' in chapters\[0\]/);
  assert.match(withCh([]).reason, /'chapters' must list/);
  assert.match(withCh('x').reason, /'chapters' must list/);
  assert.match(validateManifest(lockedManifest('abc', { chapters: [] })).reason, /locked cartridges cannot have 'chapters'/);
});

const skinOf = (over = {}) => ({ palette: { hue: '#7FB069', ...over } });

test('validateSkin: palette rules (extras cap, ui indexes, colours, background luminance)', () => {
  assert.equal(validateSkin(skinOf()).ok, true);
  assert.equal(validateSkin(skinOf({ colours: Array(48).fill('#FFFFFF') })).ok, true, '16 + 48 = 64 entries');
  assert.match(validateSkin(skinOf({ colours: Array(49).fill('#FFFFFF') })).reason, /at most 48/);
  assert.match(validateSkin(skinOf({ colours: ['red'] })).reason, /colours\[0\]/);
  assert.match(validateSkin(skinOf({ hue: 'green' })).reason, /palette\.hue/);
  assert.equal(validateSkin(skinOf({ colours: ['#112233'], ui: { text: 15, dim: 6, head: 16, accent: 16 } })).ok, true);
  assert.match(validateSkin(skinOf({ colours: ['#112233'], ui: { accent: 17 } })).reason, /palette\.ui\.accent must be a palette index from 0 to 16/);
  assert.match(validateSkin(skinOf({ ui: { text: -1 } })).reason, /palette\.ui\.text/);
  assert.match(validateSkin(skinOf({ ui: { text: 1.5 } })).reason, /palette\.ui\.text/);
  assert.match(validateSkin(skinOf({ ui: { glow: 1 } })).reason, /unknown field 'glow' in palette\.ui/);
  assert.match(validateSkin({}).reason, /missing required field 'palette'/);
  assert.match(validateSkin({ ...skinOf(), skins: 1 }).reason, /unknown field 'skins'/);
  // WCAG luminance gate: 0.05
  for (const [bg, ok] of [['#000000', true], ['#0B140C', true], ['#1A1A1A', true], ['#303030', true], ['#404040', false], ['#808080', false], ['#F0F0F0', false], ['#FFFFFF', false]]) {
    const r = validateSkin(skinOf({ bg }));
    assert.equal(r.ok, ok, bg);
    if (!ok) assert.match(r.reason, /background too light/);
  }
});

test('validateSkin: frame, menu, help, boot, insert and wording sections', () => {
  const box = '+-+|+-+|';
  const full = {
    ...skinOf(),
    frame: { show: 'menu', glyphs: box, title: 'Frame', colour: 3 },
    menu: { layout: 'grid', anchor: 'bottom', cursor: '>', title: 'Menu', box },
    help: { title: 'Keys', box },
    boot: { lines: ['one', 'two'], art: true, seconds: 3 },
    insert: { text: 'Insert' },
    wording: { keys: { eject: 'Take it out' }, menuHint: 'Arrows to move' },
  };
  assert.equal(validateSkin(full).ok, true);
  const bad = (patch, re) => assert.match(validateSkin({ ...full, ...patch }).reason, re);
  bad({ frame: { show: 'sometimes' } }, /frame\.show must be one of/);
  bad({ frame: { glyphs: '+-+' } }, /frame\.glyphs must be exactly 8 characters/);
  bad({ frame: { glyphs: 'abcdefg' + String.fromCodePoint(0x2196) } }, /U\+2196/);
  bad({ frame: { colour: 16 } }, /frame\.colour must be a palette index/);
  bad({ frame: { extra: 1 } }, /unknown field 'extra' in frame/);
  bad({ menu: { layout: 'banner' } }, /menu\.layout must be one of list, slots, grid/);
  bad({ menu: { layout: 'columns' } }, /menu\.layout must be one of list, slots, grid/);
  for (const layout of ['list', 'slots', 'grid']) assert.equal(validateSkin({ ...full, menu: { layout } }).ok, true, layout);
  bad({ menu: { anchor: 'top' } }, /menu\.anchor must be one of/);
  bad({ menu: { cursor: '>>' } }, /menu\.cursor must be exactly 1 characters/);
  bad({ help: { title: 'x'.repeat(31) } }, /help\.title is 31 characters, max 30/);
  bad({ boot: { lines: Array(9).fill('x') } }, /at most 8 lines/);
  bad({ boot: { lines: ['x'.repeat(61)] } }, /boot\.lines\[0\] is 61 characters, max 60/);
  bad({ boot: { seconds: 11 } }, /boot\.seconds must be 0\.5 to 10/);
  bad({ boot: { art: 'yes' } }, /boot\.art must be true or false/);
  assert.equal(validateSkin({ ...full, boot: { ...full.boot, valueColour: 3 } }).skin.boot.valueColour, 3, 'boot.valueColour is kept');
  assert.equal(validateSkin(full).skin.boot.valueColour, undefined, 'absent stays absent');
  bad({ boot: { valueColour: 16 } }, /boot.valueColour must be a palette index from 0 to 15/);
  bad({ boot: { valueColour: -1 } }, /boot.valueColour must be a palette index/);
  bad({ boot: { valueColour: 1.5 } }, /boot.valueColour must be a palette index/);
  bad({ boot: { valueColour: '3' } }, /boot.valueColour must be a palette index/);
  bad({ insert: { text: 'x'.repeat(41) } }, /insert\.text is 41 characters, max 40/);
  bad({ wording: { keys: { 'Bad Id': 'x' } } }, /is not a key id/);
  bad({ wording: { keys: { eject: 'x'.repeat(29) } } }, /wording\.keys\.eject is 29 characters, max 28/);
  bad({ wording: { menuHint: 'x'.repeat(61) } }, /wording\.menuHint/);
  bad({ wording: { rebind: {} } }, /unknown field 'rebind' in wording/);
});

test('parseTextAsset: LF and CRLF give the same lines, trailing spaces and blank lines go, limits are exact', () => {
  const lf = parseTextAsset('ab  \ncd\n\n\n');
  const crlf = parseTextAsset('ab  \r\ncd\r\n\r\n\r\n');
  assert.deepEqual(lf.lines, ['ab', 'cd']);
  assert.deepEqual(crlf.lines, ['ab', 'cd']);
  assert.deepEqual(parseTextAsset('﻿hi').lines, ['hi'], 'a byte-order mark is dropped');
  assert.deepEqual(parseTextAsset('a\n\nb').lines, ['a', '', 'b'], 'inner blank lines stay');
  assert.deepEqual(parseTextAsset('').lines, []);
  assert.equal(parseTextAsset('x'.repeat(24), { maxW: 24 }).ok, true);
  assert.match(parseTextAsset('x'.repeat(25), { maxW: 24 }).reason, /row 1 is 25 columns, max 24/);
  assert.equal(parseTextAsset('x\n'.repeat(10), { maxH: 10 }).ok, true);
  assert.match(parseTextAsset('x\n'.repeat(11), { maxH: 10 }).reason, /art is 11 rows, max 10/);
  assert.match(parseTextAsset('xxxxx', { maxBytes: 4 }).reason, /file is 5 bytes, max 4/);
  assert.match(parseTextAsset('a\u0007b').reason, /U\+0007/);
  assert.match(parseTextAsset(null).reason, /not text/);
  assert.equal(LIMITS.labelW, 24); assert.equal(LIMITS.labelH, 10); assert.equal(LIMITS.bootW, 76); assert.equal(LIMITS.bootH, 18);
});

// ---- text scenes

const CARD = ['abcdefghijklmnop']; // 16 characters: types for 2/3 s
const textScene = (cards = [CARD], id = 'note') => makeTextScene(parseTextScene(`title: T\n---\n${cards.map((c) => c.join('\n')).join('\n\n')}\n`), { id });
const litCount = (f) => f.glyphs.reduce((n, g) => n + (g !== 32 ? 1 : 0), 0);

test('text scene: types at 24 characters a second, holds 4 s, fades 1 s over levels 15 to 2, rests 0.5 s, loops', () => {
  assert.deepEqual([TYPE_CPS, HOLD_SECONDS, FADE_SECONDS, REST_SECONDS], [24, 4, 1, 0.5]);
  const s = textScene();
  const typeEnd = 16 / 24;
  assert.equal(litCount(renderScene(s, 0, 80, 24)), 0, 'nothing at t=0');
  assert.equal(litCount(renderScene(s, 0.5, 80, 24)), 12, '12 characters after 0.5 s');
  assert.equal(litCount(renderScene(s, 0.25, 80, 24)), 6);
  assert.equal(litCount(renderScene(s, typeEnd + 0.01, 80, 24)), 16);
  const hold = renderScene(s, typeEnd + 2, 80, 24);
  assert.equal(litCount(hold), 16);
  assert.ok(hold.colours.every((c) => c === 0 || c === 15), 'full level while holding');
  const levels = [];
  for (let k = 0; k <= 10; k++) {
    const f = renderScene(s, typeEnd + HOLD_SECONDS + k * 0.099, 80, 24);
    const lv = new Set(Array.from(f.colours).filter((c) => c > 0));
    assert.equal(lv.size, 1);
    levels.push([...lv][0]);
  }
  assert.equal(levels[0], 15);
  assert.ok(levels[10] >= 2 && levels[10] <= 3, `fade ends near level 2 (${levels[10]})`);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1], 'the fade only goes down');
  assert.equal(litCount(renderScene(s, typeEnd + HOLD_SECONDS + FADE_SECONDS + 0.2, 80, 24)), 0, 'rests blank');
  const cycle = typeEnd + HOLD_SECONDS + FADE_SECONDS + REST_SECONDS;
  assert.ok(Math.abs(s.cycleSeconds - cycle) < 1e-9);
  assert.deepEqual(Array.from(renderScene(s, 0.55 + cycle * 3, 80, 24).glyphs), Array.from(renderScene(s, 0.55, 80, 24).glyphs), 'loops');
});

test('text scene: cards follow each other; colours stay in 0..15; the card is centred', () => {
  const s = textScene([['first'], ['second', 'card']]);
  const c1 = 5 / 24 + 5.5;
  const f1 = renderScene(s, 1, 40, 10);
  const row = Array.from(f1.glyphs).findIndex((g) => g !== 32);
  assert.equal(Math.floor(row / 40), 4, 'one line in a 10-row screen sits on row 4');
  assert.equal(row % 40, Math.floor((40 - 5) / 2), 'centred across');
  const f2 = renderScene(s, c1 + 2, 40, 10);
  const rows = new Set();
  f2.glyphs.forEach((g, i) => { if (g !== 32) rows.add(Math.floor(i / 40)); });
  assert.equal(rows.size, 2, 'the second card has two lines');
  for (let t = 0; t < 40; t += 0.37) assert.ok(Math.max(...renderScene(s, t, 40, 10).colours) <= 15);
});

test('text scene: pure in t - t0 (t0 comes from the composer), uses t when t0 is missing, ignores the seed', () => {
  const s = textScene();
  const run = (t, t0, seed = 1) => {
    const g = new Uint16Array(80 * 24), c = new Uint8Array(80 * 24);
    s(t, 80, 24, { seed, glyphs: g, colours: c, ...(t0 === undefined ? {} : { t0 }) });
    return [Array.from(g).join(), Array.from(c).join()];
  };
  assert.deepEqual(run(103.5, 100), run(3.5, 0), 't0 shifts the clock');
  assert.deepEqual(run(2, undefined), run(2, 0), 'no t0 means 0');
  assert.deepEqual(run(2, 0, 1), run(2, 0, 99));
  assert.notDeepEqual(run(0.4, 0), run(1.5, 0));
  assert.deepEqual(run(-5, 0), run(0, 0), 'a time before t0 is the start');
  assert.deepEqual(run(NaN, 0), run(0, 0));
});

test('text scene: clips on small screens, fills every cell, kind and id', () => {
  const s = textScene([['this line is far too long for the screen'], ['b']]);
  assert.equal(s.kind, 'cells');
  assert.equal(s.id, 'note');
  for (const [w, h] of [[10, 3], [1, 1], [0, 0], [2, 200], [5, 0]]) {
    const f = renderScene(s, 1.5, w, h, 1, new Uint16Array(w * h).fill(7), new Uint8Array(w * h).fill(9));
    assert.equal(f.glyphs.length, w * h);
    assert.ok(f.glyphs.every((g) => g === 32 || g >= 0x61));
    assert.ok(f.colours.every((c, i) => (f.glyphs[i] === 32 ? c === 0 : c === 15)), 'spaces are colour 0, text is full level');
  }
});

test('parseTextScene errors are specific, and LF and CRLF give the same cards', () => {
  const lf = parseTextScene('title: A\n---\none\ntwo\n\nthree\n');
  const crlf = parseTextScene('title: A\r\n---\r\none\r\ntwo\r\n\r\nthree\r\n');
  assert.deepEqual(lf, crlf);
  assert.deepEqual(lf.cards, [['one', 'two'], ['three']]);
  assert.equal(lf.title, 'A');
  assert.match(parseTextScene('title: ' + 'x'.repeat(31) + '\n---\na\n').reason, /title is 31 characters/);
  assert.match(parseTextScene(5).reason, /not text/);
  assert.equal(parseTextScene('title: A\n---\n   \n\n  a  \n').cards[0][0], '  a', 'leading spaces stay, trailing go, whitespace-only lines are blank');
});

// ---- skin palette

test('makeSkinPalette: 16 hue levels like Classic, then the skin colours; ui defaults and overrides; key', () => {
  const skin = validateSkin({ palette: { hue: '#7FB069', colours: ['#FF6B6B', '#4ECDC4'], ui: { accent: 17 } } }).skin;
  const pal = makeSkinPalette(skin, 'truecolor', 'delza');
  assert.equal(pal.sgr.length, 18);
  assert.equal(paletteLength(skin), 18);
  for (let l = 0; l < 16; l++) assert.equal(pal.sgr[l], sgrFor(parseHex('#7FB069'), l, 'truecolor'));
  assert.equal(pal.sgr[16], '\x1b[38;2;255;107;107m');
  assert.equal(pal.sgr[17], '\x1b[38;2;78;205;196m');
  assert.deepEqual(pal.ui, { text: 15, dim: 7, head: 15, accent: 17 });
  assert.equal(pal.key, 'skin:delza:truecolor');
  assert.equal(pal.bg, undefined);
  assert.equal(pal.base, undefined);
  assert.notEqual(makeSkinPalette(skin, '256', 'delza').key, pal.key);
  assert.ok(makeSkinPalette(skin, '256', 'delza').sgr.every((s) => s.startsWith('\x1b[38;5;')));
  assert.equal(paletteLength(null), 16);
  assert.equal(paletteLength({ palette: { hue: '#000000' } }), 16);
});

test('makeSkinPalette: with a background every entry carries it and base is the background alone', () => {
  const skin = validateSkin({ palette: { hue: '#7FB069', colours: ['#FF6B6B'], bg: '#0B140C' } }).skin;
  const tc = makeSkinPalette(skin, 'truecolor', 'x1');
  assert.equal(tc.bg, true);
  assert.equal(tc.base, '\x1b[48;2;11;20;12m');
  assert.ok(tc.sgr.every((s) => s.endsWith(tc.base)));
  assert.ok(tc.sgr.every((s) => s.startsWith('\x1b[38;')));
  const c256 = makeSkinPalette(skin, '256', 'x1');
  assert.ok(c256.base.startsWith('\x1b[48;5;') && c256.sgr.every((s) => s.endsWith(c256.base)));
});

test('relLuminance is the WCAG formula', () => {
  assert.equal(relLuminance([0, 0, 0]), 0);
  assert.ok(Math.abs(relLuminance([255, 255, 255]) - 1) < 1e-12);
  assert.ok(Math.abs(relLuminance([255, 0, 0]) - 0.2126) < 1e-9);
  assert.ok(Math.abs(relLuminance([0, 255, 0]) - 0.7152) < 1e-9);
  assert.ok(Math.abs(relLuminance([0, 0, 255]) - 0.0722) < 1e-9);
  assert.ok(Math.abs(relLuminance([128, 128, 128]) - 0.2158) < 1e-3);
  assert.ok(relLuminance(parseHex('#F0F0F0')) > 0.8);
  assert.ok(relLuminance(parseHex('#0B140C')) < 0.01);
});

test('programs: per-scene seconds (keyed by scene id, 20 to 3600, kept only when given)', () => {
  const two = [{ id: 'aa', kind: 'builtin', ref: 'sand' }, { id: 'bb', kind: 'builtin', ref: 'bounce' }];
  const prog = (over) => validateManifest(dataManifest('abc', { scenes: two, programs: [{ id: 'main', transition: 'dissolve', scenes: ['aa', 'bb'], ...over }] }));
  const good = prog({ seconds: { aa: 20, bb: 3600 } });
  assert.equal(good.ok, true);
  assert.deepEqual(good.manifest.programs[0].seconds, { aa: 20, bb: 3600 });
  assert.equal(good.manifest.programs[0].sceneSeconds, 180);
  assert.equal('seconds' in prog({}).manifest.programs[0], false, 'absent unless given');
  assert.match(prog({ seconds: { xx: 30 } }).reason, /seconds names 'xx', which is not in this program/);
  assert.match(prog({ seconds: { aa: 19 } }).reason, /seconds/);
  assert.match(prog({ seconds: { aa: 3601 } }).reason, /seconds/);
  assert.match(prog({ seconds: { aa: 'x' } }).reason, /seconds/);
  assert.match(prog({ seconds: [30] }).reason, /seconds/);
  // a scene named by the manifest but outside this program is also refused
  const three = [...two, { id: 'cc', kind: 'builtin', ref: 'sand' }];
  assert.match(validateManifest(dataManifest('abc', { scenes: three, programs: [{ id: 'main', transition: 'dissolve', scenes: ['aa', 'bb'], seconds: { cc: 30 } }] })).reason, /seconds names 'cc', which is not in this program/);
  // crossfade: the fade must be shorter than the shortest scene time
  const fieldScenes = [{ id: 'pp', kind: 'builtin', ref: 'plasma' }, { id: 'qq', kind: 'builtin', ref: 'plasma' }];
  const cross = (over) => validateManifest(dataManifest('abc', { scenes: fieldScenes, programs: [{ id: 'main', transition: 'crossfade', scenes: ['pp', 'qq'], sceneSeconds: 60, fadeSeconds: 10, ...over }] }));
  assert.equal(cross({ seconds: { pp: 30 } }).ok, true);
  assert.match(cross({ seconds: { pp: 20 }, fadeSeconds: 20 }).reason, /fadeSeconds must be shorter than sceneSeconds/);
  assert.match(cross({ seconds: { qq: 20 }, fadeSeconds: 20 }).reason, /fadeSeconds must be shorter than sceneSeconds/);
  assert.equal(cross({ seconds: { qq: 20 }, fadeSeconds: 19 }).ok, true);
});
