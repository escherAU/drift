// DRIFT-8 C2 (T2.5): the half-cell flash meter is proved by mutation, persistently. The meter is broken in a COPY of src/ and the flash helpers in a temp folder (the
// repository's own files are never touched); the tests that guard it (tests/flash-halves.test.js) are run there and must FAIL, and the same tests must pass on the unbroken
// copy (so a test that selects nothing, or a mutation that changes nothing, cannot pass for a kill).
//   blended halves   the pixel grid reads both halves of a cell with the whole glyph's coverage: the meter DRIFT-7 shipped. It is BLIND to the must-fail controls:
//                    the probe below runs the halves-swap controls through the copy and the mutant reads them as passing, 0.0 on every rule, while the real meter fails them.
//   pixels only      the report is the pixel grid alone (the straight switch to pixels that would loosen a thin feature): the worse-of test notices.
// Cheap by design: the copy is src/ plus four test files, the tests run are one file, and the three copies run at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HF = 'tests/helpers-flash.js';
const TEST = 'tests/flash-halves.test.js';
const COPY_FILES = [HF, 'tests/helpers-flash-controls.js', 'tests/helpers-flash-halves.js', TEST, 'package.json'];

// [label, edits: [find, replace]...]
const MUTANTS = [
  ['blended halves (the pixel grid reads both halves with the whole glyph\'s coverage: the meter before DRIFT-8)', [['const TOP = HALVES.top, BOT = HALVES.bot;', 'const TOP = COVERAGE, BOT = COVERAGE;']]],
  ['pixels only (the report is the pixel grid alone: a straight switch to pixels)', [
    ['const w = pixel.worstFraction > cell.worstFraction ? pixel : cell;', 'const w = pixel;'],
    ['return { ...w, pass: cell.pass && pixel.pass, details', 'return { ...w, pass: pixel.pass, details'],
    ['      pass: cell.pass && pixel.pass,\n      cell:', '      pass: pixel.pass,\n      cell:'],
  ]],
];

// the probe: the halves-swap controls (every frame and 4 Hz, 120x40 and 61x21) through the copy's meter; prints one JSON line
const PROBE = `
const { halvesSwap, runAt } = await import('./tests/helpers-flash-halves.js');
const out = [];
for (const [cols, rows] of [[120, 40], [61, 21]]) for (const hz of [9, 4]) {
  const rep = runAt(halvesSwap(cols, rows, { hz }), cols, rows, { seconds: 6 });
  out.push({ size: cols + 'x' + rows, hz, pass: rep.pass, l1: rep.l1.x1.worstFraction, l2: rep.l2.x1.worstFraction, l3: rep.l3.worstFraction });
}
console.log(JSON.stringify(out));
`;

function copyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-halvesmut-'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  for (const f of COPY_FILES) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)); }
  return dir;
}

const CHILD_CEILING_MS = 20 * 60 * 1000;
function run(cwd, args) {
  return new Promise((resolve) => {
    // this file runs inside a test worker, whose NODE_TEST_CONTEXT would make the child a part of this run instead of a run of its own
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    // A hang guard only, never a pass criterion: the suite takes minutes on a quiet machine and longer under load, so the ceiling is 20 minutes (several times the
    // observed time). If it ever fires, the run is reported as an ERROR (timedOut), never counted as a mutant killed.
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, CHILD_CEILING_MS);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, timedOut }); });
  });
}
async function runTests(cwd) {
  const { code, out, timedOut } = await run(cwd, ['--test', '--test-reporter=tap', TEST]);
  if (timedOut) throw new Error(`child process hit the ${CHILD_CEILING_MS / 1000} s hang ceiling and was killed (an error, not a kill of the mutant): ${cwd}`);
  const num = (k) => { const m = new RegExp(`^# ${k} (\\d+)`, 'm').exec(out); return m ? +m[1] : null; };
  return { code, pass: num('pass'), fail: num('fail'), failing: [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]) };
}
async function probe(cwd) {
  const { code, out, timedOut } = await run(cwd, ['--input-type=module', '-e', PROBE]);
  if (timedOut) throw new Error(`child process hit the ${CHILD_CEILING_MS / 1000} s hang ceiling and was killed (an error, not a kill of the mutant): ${cwd}`);
  const line = out.trim().split('\n').pop();
  return { code, rows: code === 0 ? JSON.parse(line) : null, out };
}

const result = {};
async function check() {
  if (result.done) return result;
  const dirs = [];
  try {
    const control = copyProject(); dirs.push(control);
    const copies = MUTANTS.map(([label, edits]) => {
      const dir = copyProject(); dirs.push(dir);
      const p = path.join(dir, HF);
      const lf = (t) => t.replace(/\r\n/g, '\n'); // a checkout or an export of this repository may carry CRLF (git archive on Windows does); the finds are written with LF
      const original = lf(fs.readFileSync(p, 'utf8'));
      let src = original;
      const found = [];
      for (const [find, replace] of edits) { const at = src.indexOf(find); found.push(at >= 0); if (at >= 0) src = src.slice(0, at) + replace + src.slice(at + find.length); }
      fs.writeFileSync(p, src);
      return { label, dir, found, changed: src !== original };
    });
    const [ctl, ctlProbe, ...mut] = await Promise.all([runTests(control), probe(control), ...copies.map(async (c) => ({ ...c, run: await runTests(c.dir), probe: await probe(c.dir) }))]);
    Object.assign(result, { done: true, control: ctl, controlProbe: ctlProbe, mutants: mut });
  } finally { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }
  return result;
}

test('T2.5 mutation: the half-cell meter\'s tests pass on the unbroken copy and FAIL on each mutant; the blended-halves meter PASSES the controls the real meter fails', async () => {
  const r = await check();
  assert.equal(r.control.code, 0, `the unbroken copy's tests must pass (${JSON.stringify(r.control)})`);
  assert.ok(r.control.pass >= 10 && r.control.fail === 0, `the file selects its tests (${r.control.pass} pass)`);
  // the real meter fails every control: pass false, L1, L2 and L3 at 100 %
  assert.equal(r.controlProbe.code, 0, r.controlProbe.out);
  assert.equal(r.controlProbe.rows.length, 4);
  for (const row of r.controlProbe.rows) {
    assert.equal(row.pass, false, `the real meter fails the halves swap ${JSON.stringify(row)}`);
    assert.ok(row.l1 > 0.99 && row.l2 > 0.99 && row.l3 > 0.99, JSON.stringify(row));
  }
  const lines = [];
  for (const m of r.mutants) {
    assert.ok(m.found.every(Boolean), `'${m.label}': the text to break is in ${HF} (the source changed: update the mutant)`);
    assert.equal(m.changed, true);
    lines.push(`${m.label.slice(0, 40).padEnd(40)} ${m.run.code === 0 ? 'SURVIVED' : `killed by ${m.run.failing.length} test(s): ${m.run.failing.map((f) => f.slice(0, 48)).join(' | ')}`}`);
    assert.notEqual(m.run.code, 0, `'${m.label}' survived: the tests do not notice it`);
    assert.ok(m.run.fail >= 1 && m.run.failing.length >= 1, 'a named failing test');
  }
  // the first mutant is blind: the same controls read 0.0 on every rule and pass
  const blind = r.mutants[0];
  assert.equal(blind.probe.code, 0, blind.probe.out);
  for (const row of blind.probe.rows) {
    assert.equal(row.pass, true, `the blended meter passes the halves swap ${JSON.stringify(row)}`);
    assert.equal(row.l1 + row.l2 + row.l3, 0, JSON.stringify(row));
  }
  lines.push('blended meter on the controls: ' + blind.probe.rows.map((x) => `${x.size} ${x.hz}Hz pass=${x.pass} L1 ${x.l1}`).join(', '));
  lines.push('real meter on the controls:    ' + r.controlProbe.rows.map((x) => `${x.size} ${x.hz}Hz pass=${x.pass} L1 ${(x.l1 * 100).toFixed(0)}%`).join(', '));
  console.log('\nTABLE flash halves mutation\n  ' + lines.join('\n  '));
  // the pixels-only mutant: the thin-feature test is what notices
  assert.ok(r.mutants[1].run.failing.some((f) => /T2\.3/.test(f)), 'the pixels-only meter is caught by a worse-of test (T2.3)');
  // the blended mutant: the must-fail controls and the pixel reading notice
  assert.ok(blind.run.failing.some((f) => /T2\.4 must-fail/.test(f)), 'the blended meter is caught by the must-fail controls (T2.4)');
});
