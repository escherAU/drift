// DRIFT-13 phase 3: tools/contrast-matrix.mjs, the reviewer's matrix for the whole Classic high contrast cycle (not part of `npm test` itself). The pure parts (axes, the full-factorial count, the seeded
// stratified sample, the summary) are pinned in-process; the tool is run on a handful of lines: the shipped tree passes, the tree before the governor (--tree before13) fails one of Desmond's cases
// with the number the README cites, --jobs and --resume give the same lines, and a bad argument exits 2.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSizes, parseInts, parseSpeeds, fullFactorial, expandAll, drawSample, coverage, summarise, SPEED_KEYS } from './helpers-contrast-matrix.js';

const tool = fileURLToPath(new URL('../tools/contrast-matrix.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });

const FULL = {
  sizes: parseSizes('40-50x10-16,80x24,120x40,78x24,88x39'), fps: parseInts('8-30'), speeds: parseSpeeds('1x,1.5x,2x,3x,4x'),
  clocks: ['grid', 'q156', 'jitter'], modes: ['256', 'truecolor'], seeds: parseInts('1-8'),
};
const SB = { ...FULL, sizes: parseSizes('40x10,41x12,42x12,45x12,50x16,80x24,120x40,78x24,88x39') };

test('DRIFT-13 contrast-matrix axes: 40-50x10-16 is all 77 pairs, fps 8-30 is 23 rates, the five speeds press 0 to 4 plus keys, and the full cross is 447,120 lines (not millions)', () => {
  assert.equal(parseSizes('40-50x10-16').length, 77);
  assert.deepEqual(parseSizes('40x10,40x10,41x11'), ['40x10', '41x11'], 'duplicates fold');
  assert.equal(FULL.sizes.length, 81, '77 + 80x24, 120x40, 78x24, 88x39');
  assert.equal(FULL.fps.length, 23);
  assert.equal(fullFactorial(FULL), 81 * 23 * 5 * 3 * 2 * 8);
  assert.equal(fullFactorial(FULL), 447120);
  assert.equal(fullFactorial({ ...FULL, sizes: parseSizes('40-50x10-16') }), 425040, 'the 77 sizes alone');
  assert.deepEqual(Object.fromEntries(Object.entries(SPEED_KEYS).map(([k, v]) => [k, v.length])), { 1: 0, 1.5: 1, 2: 2, 3: 3, 4: 4 });
  assert.equal(expandAll({ ...FULL, sizes: ['80x24'], fps: [18], speeds: [1], clocks: ['grid'], modes: ['256'], seeds: [1, 2] }).length, 2);
  assert.throws(() => parseSizes('40by10'), /bad size/);
  assert.throws(() => parseSpeeds('5x'), /bad speed/);
});

test('DRIFT-13 contrast-matrix --sample: a seeded stratified draw: every (size, fps) pair twice at N = 2 x pairs, every size, fps, speed, clock and mode met, the same on every call, a different seed is a different draw, and the naive first-N draw (the control) misses most of the cross', () => {
  const pairs = SB.sizes.length * SB.fps.length;
  assert.equal(pairs, 207);
  const s = drawSample(SB, 2 * pairs, 1);
  assert.equal(s.length, 414);
  assert.equal(new Set(s.map((c) => JSON.stringify(c))).size, 414, 'no duplicate case');
  const cov = coverage(s, SB);
  assert.equal(cov.pairs.min, 2, 'every (size, fps) pair at least twice');
  assert.equal(cov.pairs.max, 2);
  for (const k of ['sizes', 'fps', 'speeds', 'clocks', 'modes', 'seeds']) assert.ok(cov[k].min >= 1, `${k}: every value met`);
  assert.ok(cov.speeds.min >= 414 / 5 - 1 && cov.clocks.min >= 414 / 3 - 1 && cov.modes.min >= 414 / 2 - 1, 'the other axes are even to within one');
  assert.deepEqual(drawSample(SB, 414, 1), s, 'seeded: the same draw every time');
  assert.notDeepEqual(drawSample(SB, 414, 2), s);
  const partial = drawSample(SB, 100, 1); // fewer than the pairs: sizes and rates come off decks
  assert.equal(partial.length, 100);
  const pc = coverage(partial, SB);
  assert.ok(pc.sizes.min >= 100 / 9 - 1 && pc.fps.min >= Math.floor(100 / 23) - 1 && pc.speeds.min >= 19 && pc.clocks.min >= 32);
  const naive = expandAll(SB).slice(0, 414); // control: the first N lines of the cross
  const nc = coverage(naive, SB);
  assert.equal(nc.sizes.min, 0, 'the naive draw never meets most sizes');
  assert.equal(nc.pairs.min, 0);
  assert.equal(drawSample({ ...SB, sizes: ['80x24'], fps: [18], speeds: [1], clocks: ['grid'], modes: ['256'], seeds: [1, 2] }, 99, 1).length, 2, 'N above the cross returns the whole cross');
});

test('DRIFT-13 contrast-matrix summary: lines, failing lines, the worst of each rule with where, and how many lines read within 1 point of the limit', () => {
  const r = [
    { size: '40x10', fps: 30, speed: 1, clock: 'grid', mode: '256', seed: 1, l1: 0, l2: 25, l3: 29.5, r: 0, c: 0, fails: [], ms: 1000 },
    { size: '41x11', fps: 9, speed: 2, clock: 'q156', mode: '256', seed: 2, l1: 0, l2: 26.1, l3: 10, r: 0, c: 0, fails: ['l2.x1'], ms: 500 },
    { size: '80x24', fps: 18, speed: 1, clock: 'grid', mode: '256', seed: 3, l1: 0, l2: 1, l3: 12, r: 0, c: 0, fails: [], ms: 500, error: undefined },
  ];
  const s = summarise(r);
  assert.equal(s.lines, 3);
  assert.equal(s.failing.length, 1);
  assert.equal(s.worst.l2.value, 26.1);
  assert.equal(s.worst.l2.at.size, '41x11');
  assert.equal(s.near.l3, 1, '29.5 is within 1 point of 30');
  assert.equal(s.near.l2, 2, '25.00 and 26.1 are within 1 point of 25');
  assert.equal(summarise([{ ...r[2], error: 'x' }]).failing.length, 1, 'an errored run counts as failing');
});

test('DRIFT-13 contrast-matrix --plan prints the FULL-FACTORIAL line count and the coverage and runs nothing; a bad argument exits 2', () => {
  const p = run('--plan', '--sizes', '40-50x10-16', '--fps', '9,12', '--speeds', '1x,4x', '--clocks', 'grid,q156', '--seeds', '1-2', '--sample', '100', '--sample-seed', '3');
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /FULL FACTORIAL of these axes: 77 sizes x 2 fps x 2 speeds x 2 clocks x 1 modes x 2 seeds = 1,232 lines; drawn: 100 of 1,232 \(--sample 100, sample seed 3, stratified\)/);
  assert.match(p.stdout, /coverage \(times met, min\.\.max\): sizes 1\.\.\d+, fps \d+\.\.\d+/);
  assert.equal(run('--sizes', '40by10').status, 2);
  assert.equal(run('--clocks', 'tick').status, 2);
});

test('DRIFT-13 contrast-matrix: the shipped tree passes Desmond\'s 42x12 fps 26 seed 6 case (exit 0); --tree before13 fails it on l2.x1 at 26.79 (exit 1); the summary says lines run, failing and the worst of each rule', () => {
  const o = ['--sizes', '42x12', '--fps', '26', '--seeds', '6', '--clocks', 'grid', '--modes', '256', '--speeds', '1x'];
  const after = run(...o);
  assert.equal(after.status, 0, after.stdout + after.stderr);
  assert.match(after.stdout, /^after +cycle grid +256 +1x 42x12 +fps 26 seed 6 \|.*\| pass$/m);
  assert.match(after.stdout, /lines run 1 \(1 this invocation, 0 resumed from nothing\); lines failing 0/);
  assert.match(after.stdout, /FAILING LINES: none/);
  const before = run(...o, '--tree', 'before13');
  assert.equal(before.status, 1, before.stdout + before.stderr);
  assert.match(before.stdout, /^before13 cycle grid +256 +1x 42x12 +fps 26 seed 6 \| .* L2 +26\.79 .*\| FAIL l2\.x1$/m);
  assert.match(before.stdout, /lines failing 1/);
  assert.match(before.stdout, /worst L2 26\.79 \(limit 25\) at 42x12 fps 26 1x grid 256 seed 6/);
  assert.match(before.stdout, /FAILING LINES \(1\):/);
});

test('DRIFT-13 contrast-matrix --jobs and --resume: two workers give the same lines as one, and a half-done --out file is continued (the lines already in it are not run again, the summary counts all)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-'));
  try {
    const out = path.join(dir, 'r.jsonl');
    const o = ['--sizes', '41x11,42x12', '--fps', '12,24', '--seeds', '1-2', '--clocks', 'grid', '--modes', '256', '--speeds', '1x', '--summary-only'];
    const one = run(...o, '--jobs', '1', '--out', out);
    assert.equal(one.status, 0, one.stdout + one.stderr);
    const lines = fs.readFileSync(out, 'utf8').trim().split('\n');
    assert.equal(lines.length, 8);
    const key = (l) => JSON.parse(l).key;
    assert.equal(new Set(lines.map(key)).size, 8);
    const half = path.join(dir, 'h.jsonl');
    fs.writeFileSync(half, lines.slice(0, 5).join('\n') + '\n{"key":"after|41x1'); // an interrupted run leaves a torn last line
    const resumed = run(...o, '--jobs', '2', '--out', half, '--resume');
    assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
    assert.match(resumed.stdout, /lines run 8 \(3 this invocation, 5 resumed from /);
    const got = fs.readFileSync(half, 'utf8').trim().split('\n').filter((l) => l.endsWith('}')).map((l) => JSON.parse(l)); // the torn line is skipped
    assert.equal(new Set(got.map((x) => x.key)).size, 8, 'all eight cases are in the file');
    const byKey = (ls) => Object.fromEntries(ls.map((l) => { const x = JSON.parse(l); return [x.key, [x.l1, x.l2, x.l3, x.r, x.c]]; }));
    assert.deepEqual(Object.fromEntries(got.map((x) => [x.key, [x.l1, x.l2, x.l3, x.r, x.c]])), byKey(lines), 'two workers read the same numbers as one (the run is deterministic)');
    const again = run(...o, '--out', out);
    assert.equal(again.status, 2, 'an existing --out without --resume is refused');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
