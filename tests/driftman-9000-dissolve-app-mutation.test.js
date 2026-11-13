// DRIFT-8 r2: the app-driven dissolve arm (driftman-9000-dissolve-app.test.js) must be able to fail, and the 4x arm itself must be what fails. The fix is in
// src/shell/runtime.js: the dissolve runs on real time from 1x up (Scheduler.advance(d, min(speed, 1) / speed)), so at 4x it lasts 2 s, not 0.5 s. This copies src/ and
// cartridges/ to a temporary folder, takes the fix out of the copy (the fade scale becomes 1: the old behaviour), and runs the app from the copy at seed 8 in 256 colours,
// 80x24, the case that read 27.5 %:
//   - 4x: Bloomfall>Rosette fails the L2 rule (over 25 %), and the other two pairs stay under it;
//   - 1x (no `+` pressed): the same mutant passes everything, so it is the 4x press count that makes the arm fail, not the mutant breaking something at any speed;
//   - the real tree at 4x passes the same case.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAppDissolves, PLAN_1X } from './helpers-flash-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const pc = (x) => (100 * x).toFixed(1);
const CASE = { cols: 80, rows: 24, mode: '256', seed: 8 };

function mutant() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-dissolve-mutant-'));
  fs.cpSync(path.join(REPO, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(REPO, 'cartridges'), path.join(dir, 'cartridges'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(dir, 'package.json'));
  const f = path.join(dir, 'src', 'shell', 'runtime.js');
  const src = fs.readFileSync(f, 'utf8');
  const find = /sched\.advance\(d, Math\.min\(SPEEDS\[speedIdx\], 1\) \/ SPEEDS\[speedIdx\]\)/g;
  assert.equal((src.match(find) || []).length, 1, 'the fix is where this test expects it (src/shell/runtime.js)');
  fs.writeFileSync(f, src.replace(find, 'sched.advance(d, 1)'));
  return dir;
}

test('dissolve app arm mutation: with the real-time dissolve taken out, Bloomfall>Rosette at 4x, seed 8, 256 colours fails L2; at 1x the same mutant passes; the real tree passes at 4x', async () => {
  const dir = mutant();
  try {
    const bad = await runAppDissolves({ ...CASE, seconds: 62, count: 3, root: dir });
    const by = (r) => Object.fromEntries(r.dissolves.map((d) => [`${d.from}>${d.to}`, d]));
    const m = by(bad);
    const worst = m['bloomfall>rosette'];
    assert.ok(worst, 'the mutant run reached Bloomfall>Rosette');
    console.log(`MUTANT (no real-time dissolve) 4x seed 8 256 80x24: bloomfall>rosette L2 ${pc(worst.report.l2.x1.worstFraction)} % (limit 25), switches ${worst.sinceLast} s apart (the dissolve is 0.5 s: 15.5)`);
    assert.ok(failedRules(worst.report, { only: X1_RULE_IDS }).includes('l2.x1'), 'the mutant fails L2');
    assert.ok(worst.report.l2.x1.worstFraction > 0.25);
    assert.ok(Math.abs(worst.sinceLast - 15.5) <= 0.1, 'the mutant dissolves in 0.5 s at 4x');
    for (const k of ['rosette>cortex', 'cortex>bloomfall']) assert.deepEqual(failedRules(m[k].report, { only: X1_RULE_IDS }), [], `${k} is not what fails`);

    const one = await runAppDissolves({ ...CASE, seconds: 205, plan: PLAN_1X, speed: 1, count: 3, root: dir });
    for (const d of one.dissolves) assert.deepEqual(failedRules(d.report, { only: X1_RULE_IDS }), [], `1x ${d.from}>${d.to} on the mutant`);
    assert.equal(one.dissolves.length, 3);

    const good = await runAppDissolves({ ...CASE, seconds: 66, count: 3 });
    const g = by(good)['bloomfall>rosette'];
    console.log(`REAL TREE 4x seed 8 256 80x24: bloomfall>rosette L2 ${pc(g.report.l2.x1.worstFraction)} %, switches ${g.sinceLast} s apart`);
    assert.deepEqual(failedRules(g.report, { only: X1_RULE_IDS }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
