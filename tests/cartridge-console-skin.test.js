// DRIFT-4 B1 (schema item 1): the skin's `console` block - the cartridge restyles the console itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSkin } from '../src/cartridge/schema.js';

const skinWith = (consoleBlock, palette = {}) => ({ palette: { hue: '#7FB069', ...palette }, console: consoleBlock });
const FULL = {
  frame: '┏━┓┃┛━┗┃',
  grille: '═',
  stripe: '▁▂▃▄▅▆▇█',
  ink: { frame: 3, grille: 1, stripe: 2, led: 3, bar: 3 },
  title: { style: 'spaced', ornament: '── ◆ ──', colour: 15, ornamentColour: 7 },
};

test('console block: a full block validates and is kept as given', () => {
  const r = validateSkin(skinWith(FULL));
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.skin.console, FULL);
});

test('console block: every field is optional, an empty block is kept empty, and a skin without one has none', () => {
  const r = validateSkin(skinWith({}));
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.skin.console, {});
  assert.equal(validateSkin({ palette: { hue: '#7FB069' } }).skin.console, undefined);
  for (const part of [{ frame: '┏━┓┃┛━┗┃' }, { grille: '▒' }, { stripe: '╱' }, { ink: { led: 2 } }, { title: { style: 'plain' } }, { ink: {} }, { title: {} }]) {
    assert.equal(validateSkin(skinWith(part)).ok, true, JSON.stringify(part));
  }
});

test('console block: each bad field fails with its own message', () => {
  const bad = (block, re, palette) => {
    const r = validateSkin(skinWith(block, palette));
    assert.equal(r.ok, false, JSON.stringify(block));
    assert.match(r.reason, re, JSON.stringify(block));
  };
  bad({ frame: '┏━┓┃┛━┗' }, /console\.frame must be exactly 8 characters/);
  bad({ frame: '┏━┓┃┛━┗┃┃' }, /console\.frame must be exactly 8 characters/);
  bad({ frame: '┏━┓┃┛━┗\u{1F600}' }, /console\.frame has U\+1F600/);
  bad({ grille: '══' }, /console\.grille must be exactly 1 characters/);
  bad({ grille: '' }, /console\.grille must be exactly 1 characters/);
  bad({ grille: '\u{1F600}' }, /console\.grille has U\+1F600/);
  bad({ stripe: '▁'.repeat(25) }, /console\.stripe is 25 characters, max 24/);
  bad({ stripe: '' }, /console\.stripe must not be empty/);
  bad({ stripe: '▁▂\u{1F600}' }, /console\.stripe has U\+1F600/);
  bad({ stripe: 5 }, /console\.stripe must be text/);
  bad({ ink: { frame: 4 } }, /^console\.ink\.frame must be 0 to 3$/);
  bad({ ink: { led: -1 } }, /console\.ink\.led must be 0 to 3/);
  bad({ ink: { bar: 1.5 } }, /console\.ink\.bar must be 0 to 3/);
  bad({ ink: { grille: '2' } }, /console\.ink\.grille must be 0 to 3/);
  bad({ ink: { glow: 1 } }, /unknown field 'glow' in console\.ink/);
  bad({ ink: 3 }, /console\.ink must be an object/);
  bad({ title: { style: 'neon' } }, /console\.title\.style must be one of block, spaced, plain/);
  bad({ title: { ornament: 'x'.repeat(41) } }, /console\.title\.ornament is 41 characters, max 40/);
  bad({ title: { ornament: '\u{1F600}' } }, /console\.title\.ornament has U\+1F600/);
  bad({ title: { colour: 16 } }, /console\.title\.colour must be a palette index from 0 to 15/);
  bad({ title: { ornamentColour: -1 } }, /console\.title\.ornamentColour must be a palette index from 0 to 15/);
  bad({ title: { shout: 1 } }, /unknown field 'shout' in console\.title/);
  bad({ extra: 1 }, /unknown field 'extra' in console/);
  bad('x', /console must be an object/);
  bad([], /console must be an object/);
});

test('console block: title colours are skin palette indexes, so extra colours widen the range', () => {
  assert.equal(validateSkin(skinWith({ title: { colour: 16 } }, { colours: ['#112233'] })).ok, true);
  assert.equal(validateSkin(skinWith({ title: { ornamentColour: 17 } }, { colours: ['#112233'] })).ok, false);
});
