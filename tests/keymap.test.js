import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYMAP, KEY_TO_ENTRY, buildKeyMap, helpLines, rowFor, cliKeysText, activeIn, GROUPS, NOT_HERE } from '../src/keymap.js';
import { MODES } from '../src/modes.js';
import { isAllowedGlyph, allowedList, REMOVED_FOR_FONT } from '../src/glyphs.js';
import fs from 'node:fs';
import path from 'node:path';

test('keymap: no key is bound twice (table-wide), and the guard throws if one is', () => {
  const seen = new Set();
  for (const e of KEYMAP) for (const k of e.keys) {
    assert.ok(!seen.has(k), `key ${JSON.stringify(k)} twice`);
    seen.add(k);
  }
  assert.equal(KEY_TO_ENTRY.size, seen.size);
  assert.throws(() => buildKeyMap([...KEYMAP, { id: 'dup', keys: ['m'], display: 'm', label: 'x', group: 'other', modes: 'all', action: 'x' }]), /bound twice/);
  assert.equal(new Set(KEYMAP.map((e) => e.id)).size, KEYMAP.length, 'ids unique');
});

test('keymap: every entry is well formed and the required keys exist', () => {
  for (const e of KEYMAP) {
    assert.ok(GROUPS.includes(e.group), e.id);
    assert.ok(e.modes === 'all' || (Array.isArray(e.modes) && e.modes.every((m) => MODES.includes(m))), e.id);
    assert.ok(e.keys.length > 0 && e.display && e.label && e.action, e.id);
  }
  for (const k of ['m', '1', '2', '3', '4', ' ', 'c', 'i', '+', '-', 'p', 'h', '\x1b', 'q', '\x03']) assert.ok(KEY_TO_ENTRY.has(k), JSON.stringify(k));
});

test('keymap: help rows are generated once per entry for every mode, inactive rows marked per mode', () => {
  for (const mode of MODES) {
    const lines = helpLines(mode);
    for (const e of KEYMAP) {
      const row = rowFor(e, mode);
      assert.equal(lines.filter((l) => l.text === row.text).length, 1, `${mode} ${e.id}`);
    }
  }
  const colour = KEYMAP.find((e) => e.id === 'colour');
  assert.equal(activeIn(colour, 'contrast'), false);
  assert.ok(rowFor(colour, 'contrast').text.endsWith(NOT_HERE), 'two-tone: suffix, not dim');
  assert.equal(rowFor(colour, 'contrast').style, 'text');
  assert.equal(rowFor(colour, 'calm').style, 'text');
  const invert = KEYMAP.find((e) => e.id === 'invert');
  assert.equal(rowFor(invert, 'chaos').style, 'dim', 'inactive rows are dimmed in chaos');
  assert.equal(rowFor(invert, 'calm').style, 'dim', 'and in calm');
  assert.ok(!rowFor(invert, 'chaos').text.includes('not in this mode'));
  assert.equal(rowFor(invert, 'contrast').style, 'text');
  assert.ok(!rowFor(invert, 'contrast').text.includes('not in this mode'), 'i is active in contrast');
});

test('keymap: --help keys block comes from the table (every display and label appears)', () => {
  const txt = cliKeysText();
  for (const e of KEYMAP) {
    assert.ok(txt.includes(e.display), e.id);
    assert.ok(txt.includes(e.label), e.id);
  }
});

test('glyph allow-list: ASCII, the named sets in, and the banned areas out', () => {
  for (const ch of 'aZ09~ ·°±×÷ΑΩαω←↓─╿▀▟⠀⣿∂∆∏∑−√∞∩∫≈≠≡≤≥■□▪▫▲△▶▷▼▽◀◁◆◇○●◌◍◎◐◑◒◓◔◕◢◣◤◥') {
    assert.ok(isAllowedGlyph(ch.codePointAt(0)), `${ch} U+${ch.codePointAt(0).toString(16)}`);
  }
  for (const cp of [0x1f600, 0x10000, 0x2300, 0x23ff, 0x2600, 0x2705, 0x27bf, 0x2b00, 0x2bff, 0x300, 0x36f, 0xfe0f, 0xfe00, 0x200d, 0x0, 0x1f, 0x7f, 0x3a2, 0x21a0, 0x2203, 0x25fd, 0x25fe, 0x2b50, 0x3042]) {
    assert.ok(!isAllowedGlyph(cp), `U+${cp.toString(16)} must be banned`);
  }
  assert.ok(allowedList().every((cp) => cp < 0x10000), 'all BMP');
});

test('font: the ten code points Cascadia Mono lacks are off the allow-list (both arms: neighbours stay in)', () => {
  assert.deepEqual(REMOVED_FOR_FONT, [0x2196, 0x2197, 0x2198, 0x2199, 0x2205, 0x2207, 0x2208, 0x2227, 0x2228, 0x222a]);
  for (const cp of REMOVED_FOR_FONT) assert.ok(!isAllowedGlyph(cp) && !allowedList().includes(cp), `U+${cp.toString(16)} banned`);
  for (const cp of [0x2195, 0x2206, 0x2229, 0x222b, 0x2202]) assert.ok(isAllowedGlyph(cp), `U+${cp.toString(16)} stays`);
  assert.equal(allowedList().length, 614, 'pinned allow-list size (624 before the ten were removed)');
});

test('font: no file under src/ (scenes, pieces, panels) contains a removed character, literally or as an escape sequence', () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  walk(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  assert.ok(files.length > 20 && files.some((f) => f.endsWith('owl.txt')));
  const hex = REMOVED_FOR_FONT.map((c) => c.toString(16));
  for (const f of files) {
    if (f.endsWith('glyphs.js')) continue; // the list of removed code points lives there
    const s = fs.readFileSync(f, 'utf8');
    for (const ch of s) assert.ok(!REMOVED_FOR_FONT.includes(ch.codePointAt(0)), `${f} has U+${ch.codePointAt(0).toString(16)}`);
    for (const h of hex) assert.ok(!new RegExp('\\\\u\\{?' + h, 'i').test(s), `${f} escapes U+${h}`);
  }
});
