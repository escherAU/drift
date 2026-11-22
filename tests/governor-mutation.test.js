// DRIFT-13 phase 1: the flash governor proved by mutation, persistently. Each limit is broken in a COPY of src/governor.js (in a temporary folder; the repository's file is never
// touched) and the adversarial probes (tests/helpers-governor.js runArm: the real meter, the app's loop schedule on the grid, q156 and jitter clocks) are run through the copy. Every
// mutant must FAIL at least one probe, and the unbroken copy must pass all of them (so a probe that checks nothing, or a mutation that changes nothing, cannot pass for a kill).
//   per-cell limit 3 -> 4 changes        the third-to-last change is replaced by the fourth-to-last in the per-cell test
//   W halved                             a cell waits half as long between its changes
//   per-read cap 0.25 -> 0.31            the cap moved past the meter's L3 limit of 0.30 (the margin itself, 0.25 against 0.30, is pinned by tests/governor.test.js, not by the meter)
//   per-read cap one cell over the limit the meter's own limit of 0.30 plus one cell (121 of 400 is 30.25 %)
//   read window 0                        two paints inside one 1 / fps no longer share a budget
//   first-paint exemption on every paint every paint is treated as a fresh screen
//   budgets: nbhd cap doubled; blocks cap K instead of K / 4   the relaxed variants' budgets
//   time from scene time                 not a text edit: the governor is fed `now * 2` (a scene clock at 2x) instead of real time
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { runArm, failed, numbers } from './helpers-governor.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'governor.js');
const text = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

let dir = null;
test.before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-govmut-')); });
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

const CLOCKS = ['grid', 'q156', 'jitter'];
// probes: [size, fps, clock, adversary] per variant; every one passes on the unbroken copy
const PER_CELL = [];
for (const fps of [8, 18, 26, 30]) for (const kind of ['flip', 'checker', 'noise']) PER_CELL.push({ cols: 42, rows: 12, fps, clock: CLOCKS[fps % 3], kind });
const PER_READ = [];
for (const fps of [8, 13, 18, 26, 30]) for (const clock of CLOCKS) for (const kind of ['flip', 'noise']) for (const [cols, rows] of [[40, 10], [80, 24]]) for (const paintRate of [1, 1.5]) PER_READ.push({ cols, rows, fps, clock, kind, paintRate }); // paintRate 1.5: some reads catch two paints
const BUDGET = [];
for (const fps of [8, 18, 30]) for (const kind of ['flip', 'noise', 'lockstep56', 'sweep']) for (const clock of CLOCKS) BUDGET.push({ cols: 42, rows: 12, fps, clock, kind });

const MUTANTS = [
  { label: 'per-cell limit 3 -> 4 changes (strict)', variant: 'strict', probes: PER_CELL, edits: [['if (t2[i] <= age) candE', 'if (t3[i] <= age) candE']] },
  { label: 'per-cell limit 3 -> 4 changes (nbhd)', variant: 'nbhd', probes: PER_CELL, edits: [['if (t2[i] <= age) candE', 'if (t3[i] <= age) candE']] },
  { label: 'W halved (strict)', variant: 'strict', probes: PER_CELL, edits: [['const W = Math.max(1, win1 / fps);', 'const W = Math.max(1, win1 / fps) / 2;']] },
  { label: 'W halved (nbhd)', variant: 'nbhd', probes: PER_CELL, edits: [['const W = Math.max(1, win1 / fps);', 'const W = Math.max(1, win1 / fps) / 2;']] },
  { label: 'per-read cap 0.25 -> 0.31', variant: 'strict', probes: PER_READ, edits: [['export const READ_CAP = 0.25;', 'export const READ_CAP = 0.31;']] },
  { label: 'per-read cap one cell over the meter limit', variant: 'strict', probes: PER_READ, edits: [['STEP_CAP = n > 0 ? Math.max(1, exactCap(n, READ_CAP)) : 0;', 'STEP_CAP = n > 0 ? Math.max(1, exactCap(n, STEP_LIMIT)) + 1 : 0;']] },
  { label: 'read window dropped to 0 (two paints inside 1/fps no longer share)', variant: 'strict', probes: PER_READ, edits: [['const READ_WINDOW = 1 / fps;', 'const READ_WINDOW = 0;']] },
  { label: 'first-paint exemption extended to every paint', variant: 'strict', probes: PER_CELL, edits: [['if (first) {', 'if (first || true) {']] },
  { label: 'nbhd budget doubled', variant: 'nbhd', probes: BUDGET, edits: [['CON_CAP = K;', 'CON_CAP = K * 2;']] },
  { label: 'blocks budget K instead of K / 4', variant: 'blocks', probes: BUDGET, edits: [['CON_CAP = Math.floor(K / 4);', 'CON_CAP = K;']] },
];

test('DRIFT-13 mutation: the unbroken copy passes every probe (so a kill is a kill)', async () => {
  const mod = await load('clean', []);
  for (const [variant, probes] of [['strict', PER_CELL], ['strict', PER_READ], ['nbhd', PER_CELL], ['nbhd', PER_READ], ['nbhd', BUDGET], ['blocks', BUDGET]]) {
    for (const pr of probes) {
      const r = runArm({ ...pr, seed: pr.fps, seconds: 12, governor: { variant, mod } });
      assert.deepEqual(failed(r.rep), [], `clean ${variant} ${pr.cols}x${pr.rows} fps ${pr.fps} ${pr.clock} ${pr.kind}: ${numbers(r.rep)}`);
    }
  }
});

for (const m of MUTANTS) {
  test(`DRIFT-13 mutation: ${m.label} fails a probe`, async () => {
    const mod = await load(m.label.replace(/[^a-z0-9]+/gi, '-'), m.edits);
    const hits = [];
    for (const pr of m.probes) {
      const r = runArm({ ...pr, seed: pr.fps, seconds: 12, governor: { variant: m.variant, mod } });
      const bad = failed(r.rep);
      if (bad.length) hits.push(`${pr.cols}x${pr.rows} fps ${pr.fps} ${pr.clock} ${pr.kind}: ${bad.join(' ')}`);
    }
    assert.ok(hits.length > 0, `${m.label}: no probe failed (the probes cannot see this mutation)`);
    console.log(`MUTANT KILLED ${m.label}: ${hits.length} of ${m.probes.length} probes fail, first ${hits[0]}`);
  });
}

test('DRIFT-13 mutation: time taken from scene time (a scene clock at 2x fed instead of real time) fails a probe', async () => {
  const mod = await load('scenetime', []);
  const hits = [];
  for (const pr of PER_CELL) {
    const r = runArm({ ...pr, seed: pr.fps, seconds: 12, governor: { variant: 'strict', mod, timeScale: 2 } });
    const bad = failed(r.rep);
    if (bad.length) hits.push(`${pr.cols}x${pr.rows} fps ${pr.fps} ${pr.clock} ${pr.kind}: ${bad.join(' ')}`);
  }
  assert.ok(hits.length > 0, 'scene time must fail a probe');
  console.log(`MUTANT KILLED scene time x2: ${hits.length} of ${PER_CELL.length} probes fail, first ${hits[0]}`);
});
