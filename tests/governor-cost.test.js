// DRIFT-13 phase 3: the per-frame cost of the flash governor at 400x100 (40,000 cells), as COUNTED operations, asserted. The counts do not depend on the machine: cells examined, cells changed,
// and histogram buckets cleared (the priority counting sort, src/governor.js prioritise(): hist.fill(0) clears BUCKETS + 1 = 4097 entries and the prefix sum then walks 4096 of them,
// every time a sort runs; a paint runs it at most three times, and not at all when every cell that wants to change may). The milliseconds are INFORMATIONAL: printed, never asserted
// (a wall clock is not a test result).
//
// The bucket count needs a counter the shipped governor does not have (it keeps no such statistic), so the test runs a COPY of src/governor.js in a temporary folder with ONE counting
// statement added after hist.fill(0); nothing else differs (the copy is also checked to give the same output as the shipped file on the same frames).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createGovernor } from '../src/governor.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'governor.js');
const text = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const HIST_FILL = 'hist.fill(0);';
const COLS = 400, ROWS = 100, N = COLS * ROWS, SP = 32, FULL = 0x2588;
const rngOf = (seed) => { let s = (Math.imul(seed + 1, 2654435761) >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };

let dir = null, counted = null;
test.before(async () => {
  assert.equal(text.split(HIST_FILL).length - 1, 1, 'the counting statement goes after the one hist.fill(0)');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-govcost-'));
  const file = path.join(dir, 'governor-counted.mjs');
  fs.writeFileSync(file, text.replace(HIST_FILL, `${HIST_FILL} globalThis.__govCost.sorts++; globalThis.__govCost.cleared += hist.length;`));
  counted = (await import(pathToFileURL(file).href)).createGovernor;
});
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

// load(p, rnd, g): the composed frame of paint p: `share` of the cells take a random new glyph each paint
function run(createG, variant, share, paints = 60) {
  const rnd = rngOf(7);
  const gov = createG({ cols: COLS, rows: ROWS, fps: 18, variant });
  const g = new Uint16Array(N).fill(SP), s = new Uint8Array(N);
  gov.govern(g, s, -50); // the first paint: ungoverned
  const per = [];
  let t = 0;
  for (let p = 0; p < paints; p++) {
    t += 1 / 18;
    for (let i = 0; i < N; i++) if (rnd() < share) g[i] = g[i] === FULL ? SP : FULL;
    if (globalThis.__govCost) { globalThis.__govCost.sorts = 0; globalThis.__govCost.cleared = 0; }
    const t0 = performance.now();
    gov.govern(g, s, t);
    const ms = performance.now() - t0;
    const l = gov.stats.last;
    per.push({ examined: l.examined, wanted: l.wanted, changed: l.changed, held: l.held, sorts: globalThis.__govCost ? globalThis.__govCost.sorts : 0, cleared: globalThis.__govCost ? globalThis.__govCost.cleared : 0, ms });
  }
  return { per, cap: gov.limits.stepCap };
}
const max = (per, k) => Math.max(...per.map((x) => x[k]));
const sum = (per, k) => per.reduce((a, x) => a + x[k], 0);
const pct = (per, p) => per.map((x) => x.ms).sort((a, b) => a - b)[Math.min(per.length - 1, Math.floor(p * per.length))];

for (const variant of ['nbhd', 'strict', 'blocks']) {
  test(`DRIFT-13 cost at 400x100, ${variant}: every paint examines exactly 40,000 cells, changes at most the cap (10,000) and clears at most 3 x 4,097 histogram buckets; an idle-ish screen sorts at most once`, () => {
    globalThis.__govCost = { sorts: 0, cleared: 0 };
    try {
      const busy = run(counted, variant, 0.5), quiet = run(counted, variant, 0.01);
      assert.equal(busy.cap, 10000, '25 % of 40,000');
      for (const [name, r] of [['busy (half the cells change glyph each paint)', busy], ['quiet (1 % of the cells change each paint)', quiet]]) {
        for (const x of r.per) assert.equal(x.examined, N, `${name}: every paint looks at every cell once`);
        assert.ok(max(r.per, 'changed') <= r.cap, `${name}: changed at most the cap`);
        assert.ok(max(r.per, 'sorts') <= 3, `${name}: at most three sorts a paint`);
        for (const x of r.per) assert.equal(x.cleared, x.sorts * 4097, `${name}: 4,097 buckets cleared per sort`);
      }
      assert.ok(max(busy.per, 'sorts') >= 1, 'the busy load does sort (the counter counts)');
      assert.ok(max(quiet.per, 'sorts') <= 1, 'the quiet load sorts at most once a paint');
      for (const [name, r] of [['busy', busy], ['quiet', quiet]]) {
        console.log(`GOVERNOR COST 400x100 ${variant} ${name}: per paint examined ${max(r.per, 'examined')} (= every cell), wanted at most ${max(r.per, 'wanted')}, changed at most ${max(r.per, 'changed')} (cap ${r.cap}), sorts at most ${max(r.per, 'sorts')} (${max(r.per, 'cleared')} buckets cleared); over ${r.per.length} paints changed ${sum(r.per, 'changed')}, held ${sum(r.per, 'held')} | INFORMATIONAL ms per paint, incl. the counting copy: median ${pct(r.per, 0.5).toFixed(2)}, p99 ${pct(r.per, 0.99).toFixed(2)}, max ${max(r.per, 'ms').toFixed(2)}`);
      }
    } finally { globalThis.__govCost = undefined; }
  });
}

test('DRIFT-13 cost: the counting copy gives exactly the shipped governor\'s output (same frames in, same screens out), so the counts are the shipped file\'s counts', () => {
  globalThis.__govCost = { sorts: 0, cleared: 0 };
  try {
    for (const variant of ['nbhd', 'blocks', 'strict']) {
      const a = createGovernor({ cols: 80, rows: 24, fps: 18, variant }), b = counted({ cols: 80, rows: 24, fps: 18, variant });
      const rnd = rngOf(11), n = 80 * 24, g = new Uint16Array(n).fill(SP), s = new Uint8Array(n);
      a.govern(g, s, -50); b.govern(g, s, -50);
      for (let p = 0; p < 40; p++) {
        for (let i = 0; i < n; i++) if (rnd() < 0.4) g[i] = g[i] === FULL ? SP : FULL;
        const oa = a.govern(g, s, (p + 1) / 18), ob = b.govern(g, s, (p + 1) / 18);
        assert.deepEqual(Array.from(oa.glyphs), Array.from(ob.glyphs), `${variant}: paint ${p}`);
      }
    }
  } finally { globalThis.__govCost = undefined; }
});
