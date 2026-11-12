// DRIFT-7 item 2b: the scrub is proved by mutation, persistently. Each part of it is broken, one line at a time, in a COPY of src/, cartridges/, tools/ and
// tests/ in a temp folder; the tests that guard that part are run there and must FAIL, and the same tests must pass on the unbroken copy (so a test that selects
// nothing, or a mutation that changes nothing, cannot pass for a kill). The repository's own files are never touched.
//   dissolve into the strip   the full picture cuts to the dim strip in one frame
//   dissolve back to full     the dim strip cuts to the full art in one frame
//   dimming                   the strip is drawn at full contrast (the frame is not passed through the cap)
//   flash gate                the art changes at full contrast on every press, as fast as the presses come
//   drop a press              a press that comes in a hurry is ignored (the lock-out of item 2)
//   strip pace                the dim strip is redrawn on every frame, not twice a second (the bandwidth of a held key goes over its bound)
//   midway step               a same-glyph cell jumps from bright to dim in one frame (the brightness-ramp rule of the real library runs)
// A survivor is something the tests do not cover: add the test, do not drop the mutant.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SH = 'src/shell/shell.js', SC = 'src/shell/scrub.js';
const MOVE = 'tests/shell-shelf-move.test.js';
const WALK = 'shelf (80x24|88x39|120x40): a held-key walk';
const SHAPE = 'dissolve shape';
const DIM = 'the dim strip';
const ALLOWS = 'every press of a held key';

// part: what is under test; files + pattern: the tests that must notice; mutants: [label, file, find, replace]
const PARTS = [
  {
    part: 'dissolves', files: [MOVE], pattern: SHAPE,
    mutants: [
      ['cut into the dim strip (no dissolve in)', SH, 'inT = ok ? 0 : SCRUB_IN_SECONDS;', 'inT = SCRUB_IN_SECONDS;'],
      ['cut back to the full art (no dissolve out)', SH, 'dissolveScrub(fb2, fbh, ramp(outT, 0, SCRUB_OUT_SECONDS), thr, f, lib.scrub, lstar);', 'dissolveScrub(fb2, fbh, 1, thr, f, lib.scrub, lstar);'],
    ],
  },
  {
    part: 'dimming', files: [MOVE], pattern: DIM,
    mutants: [
      ['the strip is drawn at full contrast', SC, 's[i] = isBlockGlyph(cp) ? bl[sh] : tx[sh];', 's[i] = sh;'],
      ['the block glyphs get the text cap (too bright for a full block)', SC, 's[i] = isBlockGlyph(cp) ? bl[sh] : tx[sh];', 's[i] = tx[sh];'],
    ],
  },
  {
    part: 'gate', files: [MOVE], pattern: WALK,
    mutants: [
      ['the art changes as soon as a press comes (no flash gate)', SC, 'export const SCRUB_GATE_SECONDS = 1.05;', 'export const SCRUB_GATE_SECONDS = 0;'],
    ],
  },
  {
    part: 'presses', files: [MOVE], pattern: ALLOWS,
    mutants: [
      ['drop a press that comes in a hurry', SH, "const lone = phase === 'rest' && evAge1 >= SCRUB_GATE_SECONDS;", "const lone = phase === 'rest' && evAge1 >= SCRUB_GATE_SECONDS; if (!lone) return;"],
      ['move the cursor by one fewer on a hurried press (a press registers as nothing)', SH, "index = (index + carts.length + dir) % carts.length; dial += dir; message = '';", "dial += dir; message = '';"],
    ],
  },
  {
    part: 'strip pace', files: ['tests/shell-library-bandwidth.test.js'], pattern: 'a held key',
    mutants: [
      ['the strip follows the cursor on every frame', SC, 'export const SCRUB_STRIP_SECONDS = 0.5;', 'export const SCRUB_STRIP_SECONDS = 0;'],
    ],
  },
  {
    part: 'ramps', files: ['tests/shell-flash-skinned.test.js'], pattern: 'the REAL installed library - the same run, every brightness change a ramp',
    mutants: [
      ['no midway step for a same-glyph cell that jumps bright to dim', SC, 'const m = twins.text[lstar[sa] > lstar[sb] ? sa : sb];', 'const m = sa;'],
    ],
  },
];

const COPY_DIRS = ['src', 'cartridges', 'tests', 'tools'];
function copyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-scrubmut-'));
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
    const timer = setTimeout(() => child.kill('SIGKILL'), 170000);
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
  test(`scrub mutation ${spec.part}: the tests pass on the unbroken copy and FAIL on each of ${spec.mutants.length} one-line breakage(s)`, async () => {
    const r = await check(spec);
    assert.equal(r.control.code, 0, `${spec.part}: the unbroken copy's tests must pass (${JSON.stringify(r.control)})`);
    assert.ok(r.control.pass >= 1, `${spec.part}: the pattern selects at least one test (${r.control.pass})`);
    assert.equal(r.control.fail, 0);
    const survivors = [];
    for (const m of r.mutants) {
      assert.equal(m.found, true, `${spec.part}: '${m.label}': the text to break is in ${m.file} (the source changed: update the mutant)`);
      assert.equal(m.changed, true, `${spec.part}: '${m.label}' changes the file`);
      LINES.push(`${spec.part.padEnd(10)} ${m.label}: ${m.run.code === 0 ? 'SURVIVED' : `killed by ${m.run.failing.length} test(s): ${m.run.failing.map((f) => f.slice(0, 40)).join(' | ')}`}`);
      if (m.run.code === 0 || m.run.fail === 0) survivors.push(m.label);
      else assert.ok(m.run.failing.length >= 1, 'a named failing test');
    }
    assert.deepEqual(survivors, [], `${spec.part}: scrub behaviour the tests do not notice`);
  });
}

test('scrub mutation TABLE: every mutant and what killed it', () => {
  console.log(['TABLE scrub mutation', ...LINES.map((l) => '  ' + l)].join('\n'));
  assert.ok(LINES.length === 0 || LINES.length === PARTS.reduce((n, p) => n + p.mutants.length, 0));
});
