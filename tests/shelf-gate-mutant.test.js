// DRIFT-9 item 3: the answers' own gate (shell.js treatment H) is what keeps the shelf under L2 25 %. Proved by mutation: in a COPY of src/, cartridges/, tools/ and tests/ in a temp
// folder the one condition `back = open && dimAge >= SCRUB_GATE_SECONDS` is taken down to `back = open` (the dissolve back to the full picture may start as soon as the art's own gate
// is open, whatever the age of the answers' last cut to dim), and the same real-app driver (tests/helpers-shelf-real.js) is run there. On all three clocks, at 40x10 and 81x24, in 256
// colours, with taps 0.44 s apart, the mutant must read L2 over 25 % (and fail l2.x1); the same cases on the unbroken copy and on the repository's own files must pass. The repository's
// own files are never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { showNums, caseSeeds, SHELF_SIZES, SHELF_TAPS } from './helpers-shelf-real.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SH = 'src/shell/shell.js';
const FIND = 'const back = open && dimAge >= SCRUB_GATE_SECONDS;';
const REPLACE = 'const back = open;';
const CLOCKS = ['grid', 'q156', 'jitter'];
const SIZES = [[40, 10], [81, 24]];
const TAP = 0.44;
const L2_LIMIT = 25;
const cases = CLOCKS.flatMap((clock) => SIZES.map(([cols, rows]) => ({ clock, cols, rows })));

const RUNNER = `import { runShelf } from './tests/helpers-shelf-real.js';
const spec = JSON.parse(process.argv[2]);
const out = [];
for (const k of spec) { const r = await runShelf(k); out.push({ k: k.label, screen: r.screen, fail: r.fail, nums: r.nums }); }
process.stdout.write('@@' + JSON.stringify(out) + '@@');
`;

function copyProject(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-gatemut-'));
  for (const d of ['src', 'cartridges', 'tests', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  const p = path.join(dir, SH);
  const src = fs.readFileSync(p, 'utf8');
  const at = src.indexOf(FIND);
  if (mutate) {
    if (at >= 0) fs.writeFileSync(p, src.slice(0, at) + REPLACE + src.slice(at + FIND.length));
  }
  return { dir, found: at >= 0 };
}

function runIn(dir) {
  fs.writeFileSync(path.join(dir, 'run-shelf.mjs'), RUNNER);
  const spec = cases.map(({ clock, cols, rows }) => {
    const si = SHELF_SIZES.findIndex(([a, b]) => a === cols && b === rows), ti = SHELF_TAPS.indexOf(TAP);
    return { label: `${clock} 256 ${cols}x${rows} tap ${TAP}`, clock, mode: '256', cols, rows, gap: TAP, ...caseSeeds(si, ti) };
  });
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ['run-shelf.mjs', JSON.stringify(spec)], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('close', () => {
      clearTimeout(timer);
      const m = /@@(.*)@@/s.exec(out);
      if (!m) return reject(new Error('the runner printed no result: ' + err.slice(0, 600)));
      resolve(JSON.parse(m[1]));
    });
  });
}

test('shelf gate mutant: with the answers\' own gate removed, 40x10 and 81x24 in 256 colours at taps 0.44 s read L2 over 25 % on all three clocks; unbroken they pass', async () => {
  const control = copyProject(false), mutant = copyProject(true);
  try {
    assert.equal(mutant.found, true, `the condition to break is in ${SH} (the source changed: update the mutant)`);
    const [good, bad] = await Promise.all([runIn(control.dir), runIn(mutant.dir)]);
    assert.equal(good.length, 6);
    assert.equal(bad.length, 6);
    for (const r of good) {
      assert.equal(r.screen, 'library');
      assert.deepEqual(r.fail, [], `unbroken ${r.k}: ${showNums(r.nums)}`);
    }
    const lines = [];
    for (const r of bad) {
      lines.push(`  ${r.k}: ${showNums(r.nums)} | ${r.fail.join(',') || 'pass'}`);
      assert.equal(r.screen, 'library');
      assert.ok(r.nums.l2 > L2_LIMIT, `mutant ${r.k}: L2 reads over ${L2_LIMIT} % (${showNums(r.nums)})`);
      assert.ok(r.fail.includes('l2.x1'), `mutant ${r.k}: fails l2.x1 (${r.fail.join(',')})`);
    }
    console.log('TABLE shelf gate mutant (back = open)\n' + lines.join('\n'));
  } finally {
    fs.rmSync(control.dir, { recursive: true, force: true });
    fs.rmSync(mutant.dir, { recursive: true, force: true });
  }
});
