// DRIFT-13 correction 1: an engagement regression guard. Until now the only assertion about how often the governor holds cells was "held > 0" (tests/governor-app.test.js). This one counts, per
// scene, how much the governor holds on the whole 170 s Classic high contrast cycle (the real app, a spy tree; tests/helpers-governor-engage.js; the same measure as tools/governor-wired.mjs, whose
// aggregate is the README's engagement table) at three sizes (80x24, 40x10, 42x12) and three frame rates (12, 18, 30), grid clock, seed 1, 1x:
//   cells held per 100 cells the composer changed, and the share of paints with a held cell, for life, tunnel, wire, maze, blocktype and the dissolve out of each.
// The ceilings are the committed baseline (tests/fixtures/governor-engagement.json, counted on the tree this guard was written on: the wired numbers at the 25 % cap) plus a stated margin: 25 % over it
// and half a point (a count of 0 allows 0.5). Blocktype never engages and may not start to: its ceiling is exactly 0. Counted, never timed. A scene that gets busier (or a governor that holds
// more) raises these and fails here; the control is the tunnel made twice as fast, which does. When a scene or the governor changes ON PURPOSE, regenerate the fixture and say why.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { engagement } from './helpers-governor-engage.js';
import { makeTree, rmTree } from './helpers-life-app.js';

const BASE = JSON.parse(fs.readFileSync(new URL('./fixtures/governor-engagement.json', import.meta.url), 'utf8'));
const REL = 1.25, ABS = 0.5; // the margin
const ceilingOf = (base, label) => (label.endsWith('blocktype') ? 0 : base * REL + ABS);
const must = (text, from, to) => { const lf = text.replace(/\r\n/g, '\n'); assert.equal(lf.split(from).length, 2, `the mutation target occurs exactly once: ${from}`); return lf.replace(from, to); };
const numbers = (m) => { const o = {}; for (const [l, v] of m) o[l] = [100 * v.held / Math.max(1, v.changed), 100 * v.heldPaints / v.paints]; return o; };

// the over-ceiling lines of one config
function overOf(key, got) {
  const [c, rest] = key.split('x'); const [r, fps] = rest.split('@');
  const base = BASE.configs[key], over = [];
  assert.deepEqual(Object.keys(got).sort(), Object.keys(base).sort(), `${key}: the same scenes and dissolves as the baseline`);
  for (const l of Object.keys(base)) for (const [j, what] of [[0, 'cells held per 100 changed'], [1, '% of paints with a held cell']]) {
    const ceil = ceilingOf(base[l][j], l);
    if (got[l][j] > ceil) over.push(`${key} ${l}: ${what} ${got[l][j].toFixed(2)} over its ceiling ${ceil.toFixed(2)} (baseline ${base[l][j]})`);
  }
  return over;
}
const dims = (key) => { const [c, rest] = key.split('x'); const [r, fps] = rest.split('@'); return { cols: +c, rows: +r, fps: +fps }; };

test('DRIFT-13 engagement: per scene, the cells held per 100 changed and the share of paints with a hold stay under the baseline plus 25 % and half a point (9 configs, the whole cycle); blocktype holds nothing', async () => {
  let scenes = 0;
  for (const key of Object.keys(BASE.configs)) {
    const got = numbers(await engagement(dims(key)));
    const over = overOf(key, got);
    assert.deepEqual(over, [], over.join('\n'));
    scenes += Object.keys(got).length;
    assert.equal(got.blocktype[0], 0, `${key}: blocktype holds nothing`);
    assert.equal(got['dis:blocktype'][0], 0, `${key}: the dissolve out of blocktype holds nothing`);
    assert.ok(got['dis:tunnel'][0] > 5, `${key}: the guard is looking at an engaged scene (the dissolve out of the tunnel holds ${got['dis:tunnel'][0].toFixed(2)} per 100)`);
  }
  console.log(`DRIFT-13 engagement: ${Object.keys(BASE.configs).length} configs, ${scenes} scene rows, all under their ceilings (baseline x ${REL} + ${ABS})`);
});

test('DRIFT-13 control: the same guard fails on a tunnel that flows twice as fast (FLY 0.55 to 1.1): a busier scene is caught, and the baseline passes on the unmutated tree', async () => {
  const edits = { 'src/scenes/tunnel.js': (t) => must(t, 'export const FLY = 0.55;', 'export const FLY = 1.1;') };
  rmTree(makeTree('new', edits)); // the edit matches (a copy that changes nothing throws)
  {
    const lines = [];
    let failing = 0;
    for (const key of ['80x24@18', '40x10@12', '42x12@30']) {
      const got = numbers(await engagement({ ...dims(key), edits }));
      const over = overOf(key, got);
      if (over.length) failing++;
      lines.push(`${key}: ${over.length ? over.join('; ') : 'passes'}`);
    }
    assert.equal(failing, 3, `the busier tunnel is over its ceiling at all three configs:\n${lines.join('\n')}`);
    console.log(`CONTROL mutant tunnel FLY 1.1:\n  ${lines.join('\n  ')}`);
  }
  assert.equal(ceilingOf(0, 'blocktype'), 0);
  assert.equal(ceilingOf(0, 'life'), 0.5);
});
