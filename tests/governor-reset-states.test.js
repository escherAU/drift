// DRIFT-13 correction 2: the governor's reset state machine (src/governor.js, header table RESET STATES), proved over every ordering of reset calls between two paints.
// The defect of correction 1: a hard reset whose paint had not happened yet, followed by a soft or other request, left a stale soft flag that survived the first paint, so the NEXT paint
// was also whole and ungoverned. The rules pinned here:
//   1. hard dominates any later soft/other request made before the first paint; other dominates soft; the paint consumes the state
//   2. NO sequence of reset calls between two paints gives more than one ungoverned paint (stats.ungoverned goes up by exactly one for the paint after the resets, and not for the paints after that)
//   3. the history after the paint is the one the dominating kind says: hard starts again, soft keeps it and counts only the cells that changed, other keeps it and counts every cell
// Every test runs on the shipped module and, in the mutation block, on temporary copies of it with the old ordering restored (they must FAIL; the clean copy must pass).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as shipped from '../src/governor.js';
import { OLD_ORDERING, NO_HARD_DOMINANCE, NO_OTHER_DOMINANCE, NO_CONSUME } from './helpers-governor-reset.js';

const SOFT = { cols: 40, rows: 10, fps: 18 }; // 400 cells, W = 1 s, per-read cap 100
const N = 400;
const frame = () => ({ glyphs: new Uint16Array(N).fill(32), shades: new Uint8Array(N) });

// the dominating kind of a list of reset requests ('hard', 'soft', 'other', 'resize' is hard)
const kindOf = (list) => (list.some((r) => r === 'hard' || r === 'resize') ? 'hard' : list.includes('other') ? 'other' : list.length ? 'soft' : 'none');
const apply = (gov, r) => { if (r === 'hard') gov.reset({ hard: true }); else if (r === 'other') gov.reset({ other: true }); else if (r === 'soft') gov.reset(); else gov.resize(40, 10); };

// what the paints after the resets must do to two probe cells. Cells 5 and 6 changed at 0 and 0.3 before the resets; the paint after them (0.4) changes cell 5 only.
//   cell 6 changes at 0.5: allowed only when the history was thrown away (hard)
//   cell 7 changes at 0.5 and again at 0.6: the second is allowed unless the paint at 0.4 counted a change of every cell (hard or other)
const EXPECT = { hard: { c6: true, c7: false }, soft: { c6: false, c7: true }, other: { c6: false, c7: false } };

// the same shape of run for any module: two changes of cells 5 and 6 (at 0 and 0.3), the resets, the whole paint at 0.4, then 0.5 and 0.6
function scenario(mod, resets) {
  const gov = mod.createGovernor(SOFT), f = frame();
  gov.govern(f.glyphs, f.shades, -50);
  for (const [t, v] of [[0, 0x41], [0.3, 0x42]]) { f.glyphs[5] = v; f.glyphs[6] = v; gov.govern(f.glyphs, f.shades, t); }
  const base = gov.stats.ungoverned;
  for (const r of resets) apply(gov, r);
  f.glyphs[5] = 0x43;
  const p1 = gov.govern(f.glyphs, f.shades, 0.4);
  const whole = p1.glyphs[5] === 0x43;
  const afterP1 = gov.stats.ungoverned;
  f.glyphs[6] = 0x44; f.glyphs[7] = 0x45;
  const p2 = gov.govern(f.glyphs, f.shades, 0.5);
  const c6 = p2.glyphs[6] === 0x44;
  f.glyphs[7] = 0x46;
  const p3 = gov.govern(f.glyphs, f.shades, 0.6);
  const c7 = p3.glyphs[7] === 0x46;
  return { whole, ungovernedByP1: afterP1 - base, ungovernedAfter: gov.stats.ungoverned - afterP1, c6, c7 };
}
// the assertion every ordering must meet
function check(mod, resets, label) {
  const r = scenario(mod, resets), k = kindOf(resets), why = `${label} [${resets.join(', ')}]`;
  assert.ok(r.whole, `${why}: the paint after the resets is whole`);
  assert.equal(r.ungovernedByP1, 1, `${why}: exactly one ungoverned paint for the resets`);
  assert.equal(r.ungovernedAfter, 0, `${why}: the two paints after it are governed (no stale flag)`);
  assert.deepEqual({ c6: r.c6, c7: r.c7 }, EXPECT[k], `${why}: history of a ${k} reset`);
}

const ORDERS = [
  ['hard', 'soft'], ['soft', 'hard'], ['soft', 'soft'], ['other', 'hard'], ['hard', 'other'], ['soft', 'other'], ['other', 'soft'], ['other', 'other'], ['hard', 'hard'],
  ['hard', 'soft', 'other'], ['soft', 'other', 'hard', 'soft'], ['other', 'soft', 'soft', 'other', 'soft'], ['hard', 'other', 'soft', 'hard', 'other', 'soft'],
  ['soft'], ['other'], ['hard'], ['resize'], ['soft', 'resize'], ['resize', 'soft'], ['resize', 'other'], ['other', 'resize'], ['resize', 'hard', 'soft'],
];
const repeated = (r, n) => Array.from({ length: n }, () => r);
ORDERS.push(repeated('soft', 25), repeated('other', 25), [...repeated('soft', 10), 'hard', ...repeated('other', 10)], ['hard', ...repeated('soft', 30)], ['hard', ...repeated('other', 30)]);

for (const resets of ORDERS) {
  test(`DRIFT-13 reset states: [${resets.length > 8 ? resets.slice(0, 8).join(', ') + ', ... x' + resets.length : resets.join(', ')}] is one ungoverned paint with the ${kindOf(resets)} history`, () => check(shipped, resets, 'shipped'));
}

function rngOf(seed) { let s = (Math.imul(seed + 1, 2654435761) >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const KINDS = ['soft', 'other', 'hard', 'resize'];
function randomOrders(seed, count) {
  const rnd = rngOf(seed), out = [];
  for (let i = 0; i < count; i++) { const len = 1 + Math.floor(rnd() * 10); out.push(Array.from({ length: len }, () => KINDS[Math.floor(rnd() * 4)])); }
  return out;
}
test('DRIFT-13 reset states: 300 random orderings of up to 10 resets between paints (seeds 1 to 3) all give one ungoverned paint and the dominating history', () => {
  for (const seed of [1, 2, 3]) for (const o of randomOrders(seed, 100)) check(shipped, o, `seed ${seed}`);
});

test('DRIFT-13 reset states: a reset before any paint (a new governor, then every kind) is still one ungoverned paint, and the paint after it is governed', () => {
  for (const o of [['soft'], ['other'], ['hard'], ['soft', 'other', 'hard'], ['resize']]) {
    const gov = shipped.createGovernor(SOFT), f = frame();
    for (const r of o) apply(gov, r);
    gov.govern(f.glyphs, f.shades, 0);
    assert.equal(gov.stats.ungoverned, 1, `[${o}]: the first paint`);
    gov.govern(f.glyphs, f.shades, 0.1); gov.govern(f.glyphs, f.shades, 0.2);
    assert.equal(gov.stats.ungoverned, 1, `[${o}]: and no other paint is ungoverned`);
  }
});

test('DRIFT-13 reset states: the reviewer\'s sequence (paint, hard, other, three paints) is one ungoverned paint, and the third paint does not change every cell', () => {
  const gov = shipped.createGovernor(SOFT), f = frame();
  gov.govern(f.glyphs, f.shades, 0);
  gov.reset({ hard: true }); gov.reset({ other: true });
  const a = new Uint16Array(N), b = new Uint16Array(N);
  const shade = new Uint8Array(N);
  for (let i = 0; i < N; i++) { a[i] = 0x41; b[i] = 0x42; }
  gov.govern(a, shade, 1);
  gov.govern(b, shade, 1.06);
  const painted = gov.govern(a, shade, 1.12);
  let changed = 0; for (let i = 0; i < N; i++) if (painted.glyphs[i] === 0x41) changed++;
  assert.equal(gov.stats.ungoverned, 2, 'the construction paint and the one for the resets: two in all');
  assert.ok(changed < N, `the third paint is governed: ${changed} of ${N} cells moved back (all of them would be the stale-flag defect)`);
});

test('DRIFT-13 reset states: every request between two paints is consumed by the paint, in a second round as in the first (two rounds, two ungoverned paints)', () => {
  for (const [r1, r2] of [['hard', 'soft'], ['soft', 'hard'], ['other', 'soft'], ['soft', 'other']]) {
    const gov = shipped.createGovernor(SOFT), f = frame(), g = frame();
    gov.govern(f.glyphs, f.shades, 0);
    apply(gov, r1); apply(gov, r1 === 'hard' ? 'other' : 'soft'); g.glyphs[1] = 0x41; gov.govern(g.glyphs, g.shades, 1);
    gov.govern(g.glyphs, g.shades, 1.1);
    apply(gov, r2); apply(gov, r2 === 'hard' ? 'soft' : 'other'); g.glyphs[2] = 0x42; gov.govern(g.glyphs, g.shades, 2);
    gov.govern(g.glyphs, g.shades, 2.1); gov.govern(g.glyphs, g.shades, 2.2);
    assert.equal(gov.stats.ungoverned, 3, `[${r1}] then [${r2}]: the first paint and one per round`);
  }
});

// ---- the mutants: the old ordering restored in a copy of the governor, which the same checks must fail
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'governor.js');
const text = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
let dir = null;
test.before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-govreset-')); });
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
async function load(name, edits) {
  let t = text;
  for (const [from, to] of edits) {
    assert.equal(t.split(from).length - 1, 1, `the mutation target occurs exactly once: ${from}`);
    t = t.replace(from, () => to);
  }
  if (edits.length) assert.notEqual(t, text, 'the mutation changed the file');
  const file = path.join(dir, name + '.mjs');
  fs.writeFileSync(file, t);
  return import(pathToFileURL(file).href);
}
const MUTANTS = [
  { label: 'the old ordering: a soft or other request made while a hard paint is pending survives that paint', edits: OLD_ORDERING },
  { label: 'hard does not dominate: a later soft or other request turns the pending hard paint into a soft one', edits: NO_HARD_DOMINANCE },
  { label: 'other does not dominate soft: a soft request after an other one downgrades it', edits: NO_OTHER_DOMINANCE },
  { label: 'the soft paint does not consume its state: every later paint is whole as well', edits: NO_CONSUME },
];
test('DRIFT-13 reset states mutation: the unbroken copy passes every ordering (so a kill is a kill)', async () => {
  const mod = await load('clean', []);
  for (const o of [...ORDERS, ...randomOrders(7, 60)]) check(mod, o, 'clean copy');
});
for (const m of MUTANTS) {
  test(`DRIFT-13 reset states mutation: ${m.label} fails`, async () => {
    const mod = await load(m.label.replace(/[^a-z0-9]+/gi, '-').slice(0, 40), m.edits);
    const hits = [];
    for (const o of [...ORDERS, ...randomOrders(7, 60)]) { try { check(mod, o, 'mutant'); } catch (e) { hits.push(`[${o.slice(0, 6).join(', ')}]: ${String(e.message).split(':').slice(1, 3).join(':').trim()}`); } }
    assert.ok(hits.length > 0, `${m.label}: no ordering failed`);
    console.log(`MUTANT KILLED ${m.label}: ${hits.length} orderings fail, first ${hits[0]}`);
  });
}
