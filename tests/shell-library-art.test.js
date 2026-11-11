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

// ---- labels and manifests

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTextAsset, validateManifest } from '../src/cartridge/schema.js';
import { isAllowedGlyph } from '../src/glyphs.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLAGGED = ['◍', '◎', '◑', '◢', '◣', '∫', '≡']; // the designer's glyphs we avoid
const IDS = ['classic', 'night-drive', 'last-fantasy', 'arcade'];
const rawLabel = (id) => {
  const lines = fs.readFileSync(path.join(ROOT, 'cartridges', id, 'label.txt'), 'utf8').split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

test('label.txt files: 10 rows, nothing wider than 24, the art fills the width, allowed glyphs only', () => {
  for (const id of IDS) {
    const lines = rawLabel(id);
    assert.equal(lines.length, 10, `${id} rows`);
    const widths = lines.map((l) => [...l].length);
    assert.ok(widths.every((w) => w <= 24), `${id} widths ${widths}`);
    assert.equal(Math.max(...widths), 24, `${id}: some row reaches the right edge`);
    const r = parseTextAsset(lines.join('\n'), { maxW: 24, maxH: 10 });
    assert.equal(r.ok, true, `${id}: ${r.reason}`);
    for (const l of lines) for (const ch of l) assert.ok(isAllowedGlyph(ch.codePointAt(0)), `${id}: U+${ch.codePointAt(0).toString(16)}`);
  }
});

test('labels: Classic is sun over water, Last Fantasy has a beacon tower and no sword, none uses a flagged glyph', () => {
  const classic = rawLabel('classic').join('\n');
  assert.ok(classic.includes('▄▄▓▓▓▓▄▄') && classic.includes('≈≈≈≈≈') && classic.includes('~ ≈ ~'), 'sun, horizon, water');
  const lf = rawLabel('last-fantasy').join('\n');
  assert.ok(lf.includes('▐█▌') && lf.includes('●'), 'a beacon tower with its light');
  assert.ok(!lf.includes('┼'), 'the sword cross-guard is gone');
  assert.ok(rawLabel('arcade')[0].includes('1P 004200') && rawLabel('arcade')[1].includes('▐█▌'), 'score line and bricks');
  assert.ok(rawLabel('night-drive')[5].includes('╱ ▐▌ ╲') && rawLabel('night-drive')[0].includes('▄▄██████▄▄'), 'the road with a car ahead on it, under the sun (DRIFT-5)');
});

test('no flagged glyph anywhere in src/shell or cartridges/ (control: the scan does see a planted one)', () => {
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out); else out.push(p);
    }
    return out;
  };
  const scan = (text) => FLAGGED.filter((g) => text.includes(g));
  const files = [...walk(path.join(ROOT, 'src', 'shell')), ...walk(path.join(ROOT, 'cartridges'))];
  assert.ok(files.length >= 10);
  for (const f of files) assert.deepEqual(scan(fs.readFileSync(f, 'utf8')), [], f);
  assert.deepEqual(scan('a ◢ b'), ['◢'], 'control');
});

test('install manifests: reconciled codes, the designer copy where the schema allows it', () => {
  const m = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'cartridges', id, 'manifest.json'), 'utf8'));
  for (const id of IDS) assert.equal(validateManifest(m(id), { trusted: true }).ok, true, id);
  assert.equal(m('night-drive').code, 'DM-02');
  assert.equal(m('arcade').code, 'DM-03');
  assert.equal(m('last-fantasy').code, 'DM-04');
  assert.equal(m('night-drive').blurb, 'Neon highway, endless dusk, and a car that never needs fuel.');
  assert.ok(!/sword/i.test(JSON.stringify(m('last-fantasy'))), 'no sword in the Last Fantasy manifest');
  assert.equal(m('classic').code, 'DM-00');
  assert.deepEqual(m('classic').facts, ['4 modes · 21 scenes · the original']);
  assert.ok([...m('classic').blurb].length <= 60);
});
