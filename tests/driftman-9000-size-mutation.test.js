// DRIFT-7 stage F, item 7: size coverage, proved by mutation, persistently. Each part of the Driftman 9000 that handles the size of the screen (the console's tier
// and clipping, the three visions' too-small guard, their last-row writes and Cortex's layout) is broken, one line at a time, in a COPY of src/, cartridges/ and
// tests/ in a temp folder; the size tests for that part are run there and must FAIL, and the same tests must pass on the unbroken copy (so a test that selects
// nothing, or a mutation that changes nothing, cannot pass for a kill). The repository's own files are never touched.
// A survivor is a size the tests do not cover: add the test, do not drop the mutant.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = 'cartridges/driftman-9000/scenes/rosette.js', B = 'cartridges/driftman-9000/scenes/bloomfall.js', C = 'cartridges/driftman-9000/scenes/cortex.js', K = 'cartridges/driftman-9000/console.js';
const GUARD = 'if (w < MIN_W || h < MIN_H) { message(w, h, params); return; }';
const GUARD_W = 'if (w < MIN_W) { message(w, h, params); return; }';

// part: what is under test; tests: the files and name pattern that must notice; mutants: [label, file, find, replace]
const PARTS = [
  {
    part: 'rosette', files: ['tests/driftman-9000-rosette.test.js'], pattern: 'rosette sizes',
    mutants: [
      ['drop the height half of the too-small guard', R, GUARD, GUARD_W],
      ['leave the last pixel row unwritten', R, 'pixelsToCells(params, w, h, pixels, w, 2 * h);', 'pixelsToCells(params, w, h - 1, pixels, w, 2 * h - 2);'],
    ],
  },
  {
    part: 'bloomfall', files: ['tests/driftman-9000-bloomfall.test.js'], pattern: 'bloomfall sizes',
    mutants: [
      ['drop the height half of the too-small guard', B, GUARD, GUARD_W],
      ['leave the last pixel row unwritten', B, 'pixelsToCells(params, w, h, pixels, w, hPx);', 'pixelsToCells(params, w, h - 1, pixels, w, hPx - 2);'],
    ],
  },
  {
    part: 'cortex', files: ['tests/driftman-9000-cortex.test.js'], pattern: 'cortex (sizes|layout)',
    mutants: [
      ['drop the height half of the too-small guard', C, GUARD, GUARD_W],
      ['size the panes from the whole screen, not the capped one', C, 'const availW = bw - 2 * mx - gapX,', 'const availW = W - 2 * mx - gapX,'],
      ['shrink the bottom panes by two rows', C, 'hB = availH - hT;', 'hB = availH - hT - 2;'],
    ],
  },
  {
    part: 'console', files: ['tests/driftman-9000-console.test.js', 'tests/driftman-9000-console-rest.test.js'], pattern: '9000 (console|size classes)',
    mutants: [
      ['stop clipping the old cells to the rect and the frame', K, 'if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;', 'if (false) continue;'],
      ['always draw the full tier, never the mini one', K, "const tier = ctx.tier === 'mini' ? 'mini' : 'full';", "const tier = 'full';"],
    ],
  },
];

const COPY_DIRS = ['src', 'cartridges', 'tests', 'tools'];
function copyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-mut-'));
  for (const d of COPY_DIRS) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  return dir;
}

function runTests(cwd, files, pattern) {
  return new Promise((resolve) => {
    // this file runs inside a test worker, whose NODE_TEST_CONTEXT would make the child a part of this run instead of a run of its own
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ['--test', `--test-name-pattern=${pattern}`, '--test-reporter=tap', ...files], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 150000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const num = (k) => { const m = new RegExp(`^# ${k} (\\d+)`, 'm').exec(out); return m ? +m[1] : null; };
      resolve({ code, pass: num('pass'), fail: num('fail'), failing: [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]) });
    });
  });
}

async function check(spec) {
  const control = copyProject();
  const results = { part: spec.part, mutants: [] };
  const dirs = [control];
  try {
    results.control = await runTests(control, spec.files, spec.pattern);
    await Promise.all(spec.mutants.map(async ([label, file, find, replace]) => {
      const dir = copyProject();
      dirs.push(dir);
      const p = path.join(dir, file);
      const src = fs.readFileSync(p, 'utf8');
      const at = src.indexOf(find);
      const mutated = at < 0 ? null : src.slice(0, at) + replace + src.slice(at + find.length);
      if (mutated !== null) fs.writeFileSync(p, mutated);
      results.mutants.push({ label, file, found: at >= 0, changed: mutated !== null && mutated !== src, run: mutated === null ? null : await runTests(dir, spec.files, spec.pattern) });
    }));
  } finally { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }
  return results;
}

const LINES = [];
for (const spec of PARTS) {
  test(`size mutation ${spec.part}: the size tests pass on the unbroken copy and FAIL on each of ${spec.mutants.length} one-line breakages of its size handling`, async () => {
    const r = await check(spec);
    assert.equal(r.control.code, 0, `${spec.part}: the unbroken copy's size tests must pass (${JSON.stringify(r.control)})`);
    assert.ok(r.control.pass >= 2, `${spec.part}: the pattern selects at least two tests (${r.control.pass})`);
    assert.equal(r.control.fail, 0);
    const survivors = [];
    for (const m of r.mutants) {
      assert.equal(m.found, true, `${spec.part}: '${m.label}': the text to break is in ${m.file} (the source changed: update the mutant)`);
      assert.equal(m.changed, true, `${spec.part}: '${m.label}' changes the file`);
      LINES.push(`${spec.part.padEnd(10)} ${m.label}: ${m.run.code === 0 ? 'SURVIVED' : `killed by ${m.run.failing.length} test(s)`}`);
      if (m.run.code === 0 || m.run.fail === 0) survivors.push(m.label);
      else assert.ok(m.run.failing.length >= 1, 'a named failing test');
    }
    assert.deepEqual(survivors, [], `${spec.part}: size handling the tests do not notice`);
  });
}

test('size mutation TABLE: every mutant and what killed it', () => {
  console.log(['TABLE size-coverage mutation', ...LINES.map((l) => '  ' + l)].join('\n'));
  assert.ok(LINES.length === 0 || LINES.length === PARTS.reduce((n, p) => n + p.mutants.length, 0));
});
