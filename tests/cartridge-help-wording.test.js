// DRIFT-4 B5 (schema item 5): the skin's help wording - group headings, the mode label and the scene label.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateSkin } from '../src/cartridge/schema.js';
import { shellHelpLines, shellGroupIds } from '../src/keymap.js';
import { drawHelp } from '../src/overlay.js';
import { mkShell, makeRoot, runCartridge } from './helpers-shell.js';
import { newFrame } from '../src/shell/ui.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { isWide, isInvisible } from './helpers-width.js';
import { frameLines } from './helpers-help.js';

const text = (f) => frameLines(f).join('\n');
function problems(f, palLen, label) {
  const bad = [];
  for (let i = 0; i < f.glyphs.length; i++) {
    const cp = f.glyphs[i];
    if (!isAllowedGlyph(cp) || isWide(cp) || isInvisible(cp)) bad.push(`${label}: cell ${i} has U+${cp.toString(16)}`);
    else if (f.shades[i] >= palLen) bad.push(`${label}: cell ${i} shade ${f.shades[i]}`);
    if (bad.length > 3) break;
  }
  return bad;
}

const base = { palette: { hue: '#7FB069' } };
const skinWith = (help) => ({ ...base, help });

test('shellGroupIds: the group names on the running screen', () => {
  assert.deepEqual(shellGroupIds(), ['Cartridge', 'Other']);
});

test('help wording: valid groups, modeLabel and sceneLabel are kept', () => {
  const help = { groups: { Cartridge: 'Tape deck', Other: 'Glovebox' }, modeLabel: 'tape', sceneLabel: 'track' };
  const r = validateSkin(skinWith(help));
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.skin.help, help);
  assert.equal(validateSkin(skinWith({ groups: {} })).ok, true);
  assert.equal(validateSkin(skinWith({ groups: { Other: 'x'.repeat(24) }, modeLabel: 'x'.repeat(12), sceneLabel: 'y'.repeat(12) })).ok, true);
});

test('help wording: a group that is not on the running screen, long headings and long labels fail', () => {
  assert.match(validateSkin(skinWith({ groups: { Modes: 'Moods' } })).reason, /help\.groups: 'Modes' is not a group on the running screen/);
  assert.match(validateSkin(skinWith({ groups: { Cartridges: 'x' } })).reason, /not a group on the running screen/, 'the library-only group is refused too');
  assert.match(validateSkin(skinWith({ groups: { Other: 'x'.repeat(25) } })).reason, /help\.groups\.Other is 25 characters, max 24/);
  assert.match(validateSkin(skinWith({ modeLabel: 'x'.repeat(13) })).reason, /help\.modeLabel is 13 characters, max 12/);
  assert.match(validateSkin(skinWith({ sceneLabel: 'x'.repeat(13) })).reason, /help\.sceneLabel is 13 characters, max 12/);
  assert.match(validateSkin(skinWith({ groups: 'Other' })).reason, /help\.groups must be an object/);
  assert.match(validateSkin(skinWith({ groups: { Other: '' } })).reason, /must not be empty/);
  assert.match(validateSkin(skinWith({ modeLabel: '' })).reason, /must not be empty/);
});

test('shellHelpLines: groups rename the headings only; keys and rows are untouched', () => {
  const plain = shellHelpLines('running', {});
  const skinned = shellHelpLines('running', skinWith({ groups: { Other: 'Glovebox' } }));
  const heads = (ls) => ls.filter((l) => l.style === 'head').map((l) => l.text);
  assert.deepEqual(heads(plain), ['Cartridge', 'Other']);
  assert.deepEqual(heads(skinned), ['Cartridge', 'Glovebox']);
  assert.deepEqual(plain.filter((l) => l.style !== 'head'), skinned.filter((l) => l.style !== 'head'));
  assert.deepEqual(shellHelpLines('running', undefined), plain);
});

async function runWith(help) {
  const root = makeRoot();
  const sp = path.join(root, 'fixture', 'skin.json');
  const skin = JSON.parse(fs.readFileSync(sp, 'utf8'));
  if (help) skin.help = help;
  fs.writeFileSync(sp, JSON.stringify(skin));
  const c = mkShell({ root, startScreen: { screen: 'library' } });
  c.app.start();
  await runCartridge(c, 'fixture');
  c.key('\x1b'); // close the menu
  c.tick(0.6);
  c.key('h');
  c.tick(0);
  return c;
}

test('help wording as drawn: the skinned arm shows Glovebox, tape: Fixture and track: Tide', async () => {
  const c = await runWith({ groups: { Other: 'Glovebox' }, modeLabel: 'tape', sceneLabel: 'track' });
  try {
    assert.equal(c.sh().help, true);
    assert.equal(c.sh().sceneId, 'tide');
    const t = c.text();
    assert.match(t, /Glovebox/);
    assert.ok(!/\bOther\b/.test(t));
    assert.match(t, /tape: Fixture {4}track: Tide/);
  } finally { c.done(); }
});

test('help wording as drawn: the default arm shows Cartridge, Other and cartridge: / scene: with the scene title', async () => {
  const c = await runWith(null);
  try {
    const t = c.text();
    assert.match(t, /Other/);
    assert.match(t, /cartridge: Fixture {4}scene: Tide/);
  } finally { c.done(); }
});

test('help wording: the longest allowed wording fits at 80x24 and 30x10 (no throw, allowed glyphs)', () => {
  const sk = skinWith({
    title: 'T'.repeat(30), groups: { Cartridge: 'C'.repeat(24), Other: 'O'.repeat(24) }, modeLabel: 'M'.repeat(12), sceneLabel: 'S'.repeat(12),
  });
  assert.equal(validateSkin(sk).ok, true);
  const modeLine = `${'M'.repeat(12)}: ${'x'.repeat(30)}    ${'S'.repeat(12)}: ${'y'.repeat(30)}`;
  for (const [w, h] of [[80, 24], [30, 10], [120, 40], [10, 4]]) {
    const f = newFrame(w, h);
    assert.doesNotThrow(() => drawHelp(f.glyphs, f.shades, w, h, {
      mode: 'running', modeName: 'running', sceneName: 'y', ui: { text: 1, dim: 2, head: 3 }, title: sk.help.title, lines: shellHelpLines('running', sk), modeLine,
    }), `${w}x${h}`);
    assert.deepEqual(problems(f, 4, `help ${w}x${h}`), []);
  }
  const f = newFrame(80, 24);
  drawHelp(f.glyphs, f.shades, 80, 24, { mode: 'running', modeName: 'running', sceneName: 'y', ui: { text: 1, dim: 2, head: 3 }, title: 'T', lines: shellHelpLines('running', sk), modeLine });
  assert.ok(text(f).includes('C'.repeat(24)));
});
