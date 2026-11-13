// DRIFT-8 C4 (T4.2): rule C is proved by mutation, persistently. The meter and the replay helper are broken in a COPY of src/, cartridges/ and the flash helpers in a temp
// folder (the repository's own files are never touched); the focused tests that guard rule C (tests/flash-colour.test.js and tests/flash-colour-rosette.test.js, the
// 61x21 arms) are run there and must FAIL, and the same tests must pass on the unbroken copy (so a test that selects nothing, or a mutation that changes nothing, cannot
// pass for a kill). A probe (node, in the copy) then runs the must-fail controls through each copy's meter and prints their verdicts:
//   a/b only        the meter follows OKLab a and b and not the two diagonals. It is BLIND to the diagonal control (delta a = delta b = 0.09, which moves a and b by less than the
//                   0.10 swing and only the diagonal by 0.127): the probe shows it PASSING while the real meter fails it. (Hue-dependent blindness: a hue wobble along a diagonal.)
//   no rule C       the colour tracker never runs: the brightness and red rules only, which is the meter before C4. It passes EVERY colour control.
//   replay ignores tc   the replay helper drives frames with no colour clock (tc = scene time): the Rosette at real 4x reads as it did before C3, over the limit, and the
//                   Rosette tests that need it to pass at real 4x fail. (The meter itself knows no tc; the clock lives in the replay.)
//   loosened        swing 0.10 -> 0.13 and 7 swings -> 9: never loosened, so each must break a control.
// Cheap by design: the tests run are selected by name (the 61x21 arms), the copies run at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HF = 'tests/helpers-flash.js';
const HC = 'tests/helpers-flash-controls.js';
const COPY_DIRS = ['src', 'cartridges'];
const COPY_FILES = [HF, HC, 'tests/helpers-flash-halves.js', 'tests/helpers-flash-colour.js', 'tests/helpers-flash-scenes.js', 'tests/helpers-colour-clock.js',
  'tests/flash-colour.test.js', 'tests/flash-colour-rosette.test.js', 'package.json'];
const PATTERN = 'rule C constants|T4\\.1a 61x21|T4\\.1b 61x21|T4\\.1c 61x21|T4\\.1d 61x21|T4\\.1e 61x21|T4\\.1f 61x21|colourClockAt|control colours';

// [label, file, edits: [find, replace]...]
const MUTANTS = [
  ['a/b only (the two diagonals dropped)', HF, [['export const COLOUR_AXES = 4;', 'export const COLOUR_AXES = 2;']]],
  ['no rule C (the colour tracker never runs: the meter before C4)', HF, [['    putColour(i, a, bb, k) {\n', '    putColour(i, a, bb, k) {\n      return;\n']]],
  ['the replay helper ignores tc (frames driven with the colour clock = scene time)', HC, [['export const colourClockAt = (t, speed = 1) => (t * Math.min(speed, 1)) / speed;', 'export const colourClockAt = (t, speed = 1) => t;']]],
  ['loosened: swing 0.10 -> 0.13', HF, [['export const COLOUR_SWING = 0.10;', 'export const COLOUR_SWING = 0.13;']]],
  ['loosened: 7 swings -> 9', HF, [['export const C_COUNT = 7;', 'export const C_COUNT = 9;']]],
];

// the probe: the must-fail controls through the copy's meter; one JSON line
const PROBE = `
const { runControl } = await import('./tests/helpers-flash-controls.js');
const K = await import('./tests/helpers-flash-colour.js');
const { halvesSwap, TEAL, AMBER } = await import('./tests/helpers-flash-halves.js');
const { failedRules } = await import('./tests/helpers-flash.js');
const { runScene } = await import('./tests/helpers-flash-scenes.js');
const rosette = (await import('./cartridges/driftman-9000/scenes/rosette.js')).default;
const out = [];
const add = (name, size, rep) => out.push({ name, size, c: rep.c.worstFraction, pass: rep.pass, other: failedRules(rep, { not: ['c'] }) });
for (const [cols, rows] of [[61, 21], [120, 40]]) {
  const o = { cols, rows, seconds: 6 };
  const sz = cols + 'x' + rows;
  add('diagonal pair 4 Hz', sz, runControl(K.diagonalPair(cols, rows, { hz: 4 }), o));
  add('diagonal pair 6 Hz', sz, runControl(K.diagonalPair(cols, rows, { hz: 6 }), o));
  add('anti-diagonal pair 4 Hz', sz, runControl(K.diagonalPair(cols, rows, { hz: 4, anti: true }), o));
  add('hue wobble 45 +/- 40 deg 4 Hz', sz, runControl(K.hueWobble(cols, rows, { centre: 45 }), o));
  add('teal/amber 4 Hz', sz, runControl(K.colourPair(cols, rows, { c1: TEAL, c2: AMBER, hz: 4 }), o));
  add('hue turning 3.6 cycles/s', sz, runControl(K.hueSpin(cols, rows, { cps: 3.6 }), o));
  add('halves swap teal/amber 4 Hz', sz, runControl(halvesSwap(cols, rows, { hz: 4, a: TEAL, b: AMBER }), o));
  add('hue turning 2.6 cycles/s (pass arm)', sz, runControl(K.hueSpin(cols, rows, { cps: 2.6 }), o));
}
add('Rosette real 4x with the colour clock', '61x21', runScene(rosette, [61, 21], { speed: 4, seconds: 30 }));
console.log('PROBE ' + JSON.stringify(out));
`;

function copyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-colmut-'));
  for (const d of COPY_DIRS) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  for (const f of COPY_FILES) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)); }
  fs.writeFileSync(path.join(dir, 'probe.mjs'), PROBE);
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
  const { code, out, timedOut } = await run(cwd, ['--test', '--test-reporter=tap', `--test-name-pattern=${PATTERN}`, 'tests/flash-colour.test.js', 'tests/flash-colour-rosette.test.js']);
  if (timedOut) throw new Error(`child process hit the ${CHILD_CEILING_MS / 1000} s hang ceiling and was killed (an error, not a kill of the mutant): ${cwd}`);
  const num = (k) => { const m = new RegExp(`^# ${k} (\\d+)`, 'm').exec(out); return m ? +m[1] : null; };
  return { code, pass: num('pass'), fail: num('fail'), failing: [...out.matchAll(/^\s*not ok \d+ - (.*)$/gm)].map((m) => m[1]).filter((n) => !/\.test\.js$/.test(n)) };
}
async function probe(cwd) {
  const { code, out, timedOut } = await run(cwd, ['probe.mjs']);
  if (timedOut) throw new Error(`child process hit the ${CHILD_CEILING_MS / 1000} s hang ceiling and was killed (an error, not a kill of the mutant): ${cwd}`);
  const line = out.trim().split('\n').filter((l) => l.startsWith('PROBE ')).pop();
  return { code, rows: line ? JSON.parse(line.slice(6)) : null, out };
}

const result = {};
async function check() {
  if (result.done) return result;
  const dirs = [];
  try {
    const control = copyProject(); dirs.push(control);
    const copies = MUTANTS.map(([label, file, edits]) => {
      const dir = copyProject(); dirs.push(dir);
      const p = path.join(dir, file);
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

const byName = (rows, name, size) => rows.find((r) => r.name === name && (!size || r.size === size));
const COLOUR_CONTROLS = ['diagonal pair 4 Hz', 'diagonal pair 6 Hz', 'anti-diagonal pair 4 Hz', 'hue wobble 45 +/- 40 deg 4 Hz', 'teal/amber 4 Hz', 'hue turning 3.6 cycles/s', 'halves swap teal/amber 4 Hz'];

test('T4.2 mutation: the rule C tests pass on the unbroken copy and FAIL on each mutant; the control probe fails every colour control on the real meter', async () => {
  const r = await check();
  assert.equal(r.control.code, 0, `the unbroken copy's tests must pass (${JSON.stringify(r.control)})`);
  assert.ok(r.control.pass === 9 && r.control.fail === 0, `the patterns select tests (${r.control.pass} pass)`);
  assert.equal(r.controlProbe.code, 0, r.controlProbe.out);
  for (const sz of ['61x21', '120x40']) {
    for (const name of COLOUR_CONTROLS) {
      const row = byName(r.controlProbe.rows, name, sz);
      assert.ok(row, `${name} ${sz}`);
      assert.ok(row.c > 0.99 && row.pass === false, `the real meter fails '${name}' ${sz}: ${JSON.stringify(row)}`);
      assert.deepEqual(row.other, [], `and only rule C does: ${JSON.stringify(row)}`);
    }
    assert.equal(byName(r.controlProbe.rows, 'hue turning 2.6 cycles/s (pass arm)', sz).pass, true);
  }
  const ros = byName(r.controlProbe.rows, 'Rosette real 4x with the colour clock');
  assert.ok(ros.c < 0.1 && ros.pass, JSON.stringify(ros));
  const lines = [];
  for (const m of r.mutants) {
    assert.ok(m.found.every(Boolean), `'${m.label}': the text to break is in the file (the source changed: update the mutant)`);
    assert.equal(m.changed, true);
    lines.push(`${m.label.slice(0, 60).padEnd(60)} ${m.run.code === 0 ? 'SURVIVED' : `killed by ${m.run.failing.length} test(s): ${m.run.failing.map((f) => f.slice(0, 40)).join(' | ')}`}`);
    assert.notEqual(m.run.code, 0, `'${m.label}' survived: the tests do not notice it`);
    assert.ok(m.run.fail >= 1 && m.run.failing.length >= 1, 'a named failing test');
  }
  const [axes, noC, noTc, swing, count] = r.mutants;

  // (i) the a/b-only meter is blind to the diagonal control and nothing else
  for (const sz of ['61x21', '120x40']) {
    for (const name of ['diagonal pair 4 Hz', 'diagonal pair 6 Hz', 'anti-diagonal pair 4 Hz']) {
      const row = byName(axes.probe.rows, name, sz);
      assert.ok(row.pass === true && row.c === 0, `the a/b-only meter PASSES '${name}' ${sz} (real: fails): ${JSON.stringify(row)}`);
    }
    for (const name of ['teal/amber 4 Hz', 'hue turning 3.6 cycles/s', 'halves swap teal/amber 4 Hz']) assert.ok(byName(axes.probe.rows, name, sz).c > 0.99, `${name}: a and b still see a change that moves them`);
  }
  assert.ok(axes.run.failing.some((f) => /T4\.1a/.test(f)), 'the a/b-only meter is caught by the diagonal control (T4.1a)');

  // (ii) the brightness-only meter passes every colour control
  for (const sz of ['61x21', '120x40']) {
    for (const name of COLOUR_CONTROLS) {
      const row = byName(noC.probe.rows, name, sz);
      assert.ok(row.pass === true && row.c === 0, `the brightness-only meter PASSES '${name}' ${sz}: ${JSON.stringify(row)}`);
    }
  }
  for (const id of ['T4.1a', 'T4.1b', 'T4.1c', 'T4.1d', 'T4.1e']) assert.ok(noC.run.failing.some((f) => f.includes(id)), `no rule C is caught by ${id}`);

  // (iii) a replay that ignores tc: the Rosette at real 4x is over the limit again
  const rosNoTc = byName(noTc.probe.rows, 'Rosette real 4x with the colour clock');
  assert.ok(rosNoTc.c > 0.25 && rosNoTc.pass === false, `the replay with no colour clock reads the Rosette at real 4x over the limit: ${JSON.stringify(rosNoTc)}`);
  assert.ok(noTc.run.failing.some((f) => /T4\.1f|colourClockAt/.test(f)), 'the replay that ignores tc is caught by the Rosette 4x tests (T4.1f) and the runtime-clock check');

  // loosened thresholds: caught
  assert.ok(byName(swing.probe.rows, 'diagonal pair 4 Hz', '61x21').c === 0, 'a swing of 0.13 would let the diagonal pair (0.127) through');
  assert.ok(byName(count.probe.rows, 'hue turning 3.6 cycles/s', '61x21').c === 0, 'nine swings a second would let the 3.6 cycles/s turn (7.2 swings) through');
  lines.push('real meter on the colour controls:        ' + r.controlProbe.rows.filter((x) => x.size === '61x21' && COLOUR_CONTROLS.includes(x.name)).map((x) => `${x.name}=${(x.c * 100).toFixed(0)}%`).join(', '));
  lines.push('a/b-only meter on the diagonal controls:  ' + axes.probe.rows.filter((x) => x.size === '61x21' && /diagonal/.test(x.name)).map((x) => `${x.name}=${(x.c * 100).toFixed(0)}% pass=${x.pass}`).join(', '));
  lines.push('brightness-only meter on the colour ones: ' + noC.probe.rows.filter((x) => x.size === '61x21' && COLOUR_CONTROLS.includes(x.name)).map((x) => `${x.name}=${(x.c * 100).toFixed(0)}% pass=${x.pass}`).join(', '));
  lines.push(`Rosette real 4x: with the clock ${(ros.c * 100).toFixed(1)}%, replay ignoring tc ${(rosNoTc.c * 100).toFixed(1)}%`);
  console.log('\nTABLE flash colour mutation\n  ' + lines.join('\n  '));
});
