import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYMAP, KEY_TO_ENTRY, buildKeyMap, helpLines, rowFor, cliKeysText, activeIn, GROUPS, NOT_HERE } from '../src/keymap.js';
import { MODES } from '../src/modes.js';
import { isAllowedGlyph, allowedList } from '../src/glyphs.js';

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
  for (const ch of 'aZ09~ ·°±×÷ΑΩαω←↙─╿▀▟⠀⣿∂∅∆∇∈∏∑−√∞∧∨∩∪∫≈≠≡≤≥■□▪▫▲△▶▷▼▽◀◁◆◇○●◌◍◎◐◑◒◓◔◕◢◣◤◥') {
    assert.ok(isAllowedGlyph(ch.codePointAt(0)), `${ch} U+${ch.codePointAt(0).toString(16)}`);
  }
  for (const cp of [0x1f600, 0x10000, 0x2300, 0x23ff, 0x2600, 0x2705, 0x27bf, 0x2b00, 0x2bff, 0x300, 0x36f, 0xfe0f, 0xfe00, 0x200d, 0x0, 0x1f, 0x7f, 0x3a2, 0x21a0, 0x2203, 0x25fd, 0x25fe, 0x2b50, 0x3042]) {
    assert.ok(!isAllowedGlyph(cp), `U+${cp.toString(16)} must be banned`);
  }
  assert.ok(allowedList().every((cp) => cp < 0x10000), 'all BMP');
});
