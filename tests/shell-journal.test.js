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
