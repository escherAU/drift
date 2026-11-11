// DRIFT-4 slice 2, A1: the Driftman 2000 library art (palette, labels, cartridge component, console, layout tiers).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSkin } from '../src/cartridge/schema.js';
import { relLuminance } from '../src/cartridge/palette.js';
import { parseHex } from '../src/color.js';
import { driftmanSkin, classicBootSkin, DRIFTMAN_COLOURS } from '../src/shell/driftman.js';

const contrast = (a, b) => {
  const la = relLuminance(parseHex(a)), lb = relLuminance(parseHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

test('driftman palette: silver, graphite, cyan, amber and dim on #0a0c10, 20 entries, valid skin, dim text >= 4.5:1', () => {
  const p = driftmanSkin.palette;
  assert.equal(p.bg.toLowerCase(), '#0a0c10');
  assert.equal(p.hue.toLowerCase(), '#c8ccd4', 'silver is the hue');
  assert.deepEqual(p.colours.map((c) => c.toLowerCase()), ['#ffb000', '#39d0ff', '#5d6474', '#8b93a1']);
  assert.equal(16 + p.colours.length, 20, 'the library palette is 20 entries');
  assert.equal(DRIFTMAN_COLOURS.amber, 16);
  assert.equal(DRIFTMAN_COLOURS.cyan, 17);
  assert.equal(DRIFTMAN_COLOURS.housing, 18, 'graphite');
  assert.equal(DRIFTMAN_COLOURS.dim, 19);
  assert.equal(p.ui.dim, DRIFTMAN_COLOURS.dim, 'dim text uses the dim colour');
  assert.equal(p.ui.accent, DRIFTMAN_COLOURS.amber);
  const dim = p.colours[DRIFTMAN_COLOURS.dim - 16];
  assert.ok(contrast(dim, p.bg) >= 4.5, `dim text contrast ${contrast(dim, p.bg).toFixed(2)}`);
  assert.ok(contrast(p.hue, p.bg) >= 4.5, 'silver text');
  assert.ok(contrast(p.colours[0], p.bg) >= 4.5 && contrast(p.colours[1], p.bg) >= 4.5, 'amber and cyan');
  assert.ok(contrast('#4a5060', p.bg) < 3, 'control: the rejected graphite really is too dark');
  assert.equal(validateSkin(JSON.parse(JSON.stringify(driftmanSkin))).ok, true);
  assert.equal(validateSkin(JSON.parse(JSON.stringify(classicBootSkin))).ok, true);
  assert.ok(relLuminance(parseHex(p.bg)) <= 0.02, 'dark background');
});
