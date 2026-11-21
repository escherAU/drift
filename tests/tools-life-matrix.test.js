// DRIFT-10: tools/life-matrix.mjs, the reviewer's before/after table for Classic high contrast (not part of `npm test` itself). One small matrix each way: the Life scene as shipped
// passes (exit 0) and the old one (--tree before: a copy of src/ with tests/fixtures/life-before-drift10.js) fails seed 2 on L1 and L2 with the numbers the other life-flash tests assert.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = fileURLToPath(new URL('../tools/life-matrix.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });

test('DRIFT-10 life-matrix: the shipped Life passes seed 2 at 1x and 4x and the tool exits 0, one line per seed and one WORST line', () => {
  const r = run('--seeds', '1,2', '--clocks', 'grid', '--modes', '256', '--speeds', '1x,4x', '--sizes', '80x24');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 6, 'two speeds x (two seeds + a WORST line)');
  assert.equal(lines.filter((l) => l.includes('WORST')).length, 2);
  for (const l of lines) { assert.match(l, /^after +life /); assert.match(l, /\| pass$/); assert.match(l, /L1 +0\.00 L2 +0\.00 L3 +\d+\.\d\d R +0\.00 C +0\.00/); }
});

test('DRIFT-10 life-matrix: --tree before reads the old Life over the limits (seed 2 at 1x: L1 27.78 %, L2 34.26 %) and exits 1', () => {
  const r = run('--tree', 'before', '--seeds', '2', '--clocks', 'grid', '--modes', '256', '--speeds', '1x', '--sizes', '80x24');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const seedLine = r.stdout.split('\n').find((l) => l.includes('seed 2 |'));
  assert.match(seedLine, /^before +life /);
  assert.match(seedLine, /L1 +27\.78 L2 +34\.26/);
  assert.match(seedLine, /FAIL l1\.x1 l2\.x1$/);
});

test('DRIFT-10 life-matrix: the speed arm holds Life for 30 real seconds (the 4x line reads a whole scene: same numbers as the 1x one on the same seed)', () => {
  const out = execFileSync(process.execPath, [tool, '--seeds', '2', '--clocks', 'grid', '--modes', '256', '--speeds', '1x,4x', '--sizes', '80x24', '--summary-only'], { encoding: 'utf8' }).trim().split('\n');
  const num = (l) => l.split('|')[1].trim();
  assert.equal(out.length, 2);
  assert.equal(num(out[0]), num(out[1]), 'Life steps 10 generations a real second at any speed, so the two runs read the same');
});


// DRIFT-11: wire and blocktype now pass; the old looks are the control (--tree before11: a copy of src/ with wire.js and blocktype.js as they were at 7c2f34c)
const worst = (scene, over = {}) => {
  const o = { scene, seeds: '1,2,3', clocks: 'grid', modes: '256', speeds: '1x', sizes: '80x24', ...over };
  const r = run(...Object.entries(o).flatMap(([k, v]) => ['--' + k, v]), '--summary-only');
  const line = r.stdout.trim().split('\n').pop();
  const m = /L1 +([\d.]+) L2 +([\d.]+) L3 +([\d.]+)/.exec(line);
  return { status: r.status, l1: Number(m[1]), l2: Number(m[2]), l3: Number(m[3]), line };
};

test('DRIFT-11 life-matrix --scene: the shipped wire, blocktype, tunnel, maze and life all pass the five rules at 80x24, 1x, seeds 1 to 3 (exit 0), under every limit', () => {
  for (const scene of ['wire', 'blocktype', 'tunnel', 'maze', 'life']) {
    const w = worst(scene);
    assert.equal(w.status, 0, w.line);
    assert.match(w.line, /\| pass$/);
    assert.ok(w.l1 <= 25 && w.l2 <= 25 && w.l3 <= 30, w.line);
  }
});

test('DRIFT-11 life-matrix --tree before11: the old wire and blocktype read over the limits (wire L1 40.74 and L2 98.61, blocktype L2 81.02, seeds 1 to 3) and the tool exits 1; Life, tunnel and maze are the same tree and still pass', () => {
  const wire = worst('wire', { tree: 'before11' }), block = worst('blocktype', { tree: 'before11' });
  assert.equal(wire.status, 1);
  assert.match(wire.line, /^before11 wire +grid .* L1 +40\.74 L2 +98\.61 L3 +16\.51 .*FAIL l1\.x1 l2\.x1$/);
  assert.equal(block.status, 1);
  assert.match(block.line, /^before11 blocktype +grid .* L1 +3\.70 L2 +81\.02 L3 +23\.44 .*FAIL l2\.x1$/);
  for (const scene of ['life', 'tunnel', 'maze']) assert.equal(worst(scene, { tree: 'before11' }).status, 0, scene);
});

test('DRIFT-11 life-matrix --whole-cycle: the shipped cycle (Life, tunnel, wire, maze, blocktype and the four dissolves, 170 s) reads under every limit on grid, q156 and jitter, seeds 1 to 3, 80x24, and exits 0; the old looks read L1 43.52 and L2 99.54 and the tool exits 1', () => {
  const r = run('--whole-cycle', '--seeds', '1,2,3', '--clocks', 'grid,q156,jitter', '--modes', '256', '--speeds', '1x', '--sizes', '80x24', '--summary-only');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 3);
  for (const l of lines) {
    assert.match(l, /^after +cycle /);
    const m = /L1 +([\d.]+) L2 +([\d.]+) L3 +([\d.]+) R +([\d.]+) C +([\d.]+)/.exec(l);
    const [l1, l2, l3, rr, c] = m.slice(1).map(Number);
    assert.ok(l1 <= 25 && l2 <= 25 && l3 <= 30 && rr <= 25 && c <= 25, l);
    assert.match(l, /\| pass$/);
  }
  const old = run('--whole-cycle', '--tree', 'before11', '--seeds', '1,2,3', '--clocks', 'grid', '--modes', '256', '--speeds', '1x', '--sizes', '80x24', '--summary-only');
  assert.equal(old.status, 1);
  assert.match(old.stdout.trim(), /^before11 cycle +grid .* L1 +43\.52 L2 +99\.54 .*FAIL l1\.x1 l2\.x1$/);
});

test('DRIFT-11 life-matrix --fps takes a list: one line per fps, the rate in the line, and the smallest boards at --fps 8 pass for both scenes (DRIFT-12: they are the size card there, and the tool says so)', () => {
  for (const scene of ['wire', 'blocktype']) {
    const r = run('--scene', scene, '--seeds', '1,2', '--clocks', 'q156', '--modes', '256', '--speeds', '1x', '--sizes', '10x4,25x5', '--fps', '8,12', '--summary-only');
    assert.equal(r.status, 0, r.stdout);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 4, 'two fps x two sizes');
    assert.match(r.stderr, /10x4 is below Classic's 40x10 minimum/);
    assert.deepEqual(lines.map((l) => /fps +(\d+)/.exec(l)[1]), ['8', '8', '12', '12']);
  }
});

test('DRIFT-12 life-matrix: the boards below 40x10 are not reachable: Classic shows the size card there, every scene reads 0 on every rule at 10x4 (the tunnel and maze L2 readings of 37.50 and 50.00 per cent the README used to cite are history), and the tool says so', () => {
  for (const scene of ['wire', 'blocktype', 'life', 'tunnel', 'maze']) {
    const w = worst(scene, { sizes: '10x4' });
    assert.equal(w.status, 0, w.line);
    assert.equal(w.l1 + w.l2 + w.l3, 0, `${scene}: a static card does not change: ${w.line}`);
  }
  const r = run('--scene', 'tunnel', '--seeds', '1', '--clocks', 'grid', '--modes', '256', '--speeds', '1x', '--sizes', '10x4', '--summary-only');
  assert.match(r.stderr, /note: 10x4 is below Classic's 40x10 minimum: Classic shows the size card there/);
});

// DRIFT-12: the tunnel and the whole cycle at 2x and 4x. The old looks are the control (--tree before12: a copy of src/ as it was at 1cb2b62 where DRIFT-12 changed it: tests/fixtures/tunnel-before-drift12.js,
// the dissolve at scene speed and no realTimeIds: BEFORE12_EDITS in tests/helpers-life-app.js)
test('DRIFT-12 life-matrix --scene tunnel at 1x, 2x and 4x: the shipped tunnel passes (exit 0; the three speeds read the same, as the real-time clock runs the same flow); --tree before12 reads L2 50.46 and 100.00 and L3 31.09 at 2x and 4x and exits 1', () => {
  const o = { scene: 'tunnel', seeds: '1,2,3', clocks: 'grid', modes: '256', speeds: '1x,2x,4x', sizes: '80x24,40x10' };
  const flags = (x) => Object.entries(x).flatMap(([k, v]) => ['--' + k, v]);
  const now = run(...flags(o), '--summary-only');
  assert.equal(now.status, 0, now.stdout);
  const lines = now.stdout.trim().split('\n');
  assert.equal(lines.length, 6);
  for (const l of lines) assert.match(l, /\| pass$/);
  assert.equal(lines[0].split('|')[1], lines[2].split('|')[1], 'the 1x and 2x readings are the same run of the flow');
  assert.equal(lines[2].split('|')[1], lines[4].split('|')[1], 'and the 4x');
  const old = run(...flags({ ...o, tree: 'before12', sizes: '80x24' }), '--summary-only');
  assert.equal(old.status, 1, old.stdout);
  const [one, two, four] = old.stdout.trim().split('\n');
  assert.match(one, /^before12 tunnel .* 1x .* \| pass$/);
  assert.match(two, /^before12 tunnel .* 2x .* L1 +0\.46 L2 +50\.46 L3 +18\.91 .*FAIL l2\.x1$/);
  assert.match(four, /^before12 tunnel .* 4x .* L1 +7\.41 L2 +100\.00 L3 +31\.09 .*FAIL l2\.x1 l3$/);
});

test('DRIFT-12 life-matrix --whole-cycle at 1x, 2x and 4x: the shipped cycle passes (exit 0) on seeds 1 to 3 at 80x24; --tree before12 reads L2 49.54 at 2x and L2 100.00, L3 31.15 at 4x and exits 1', () => {
  const o = { 'whole-cycle': null, seeds: '1,2,3', clocks: 'grid', modes: '256', speeds: '1x,2x,4x', sizes: '80x24' };
  const flags = (x) => Object.entries(x).flatMap(([k, v]) => (v === null ? ['--' + k] : ['--' + k, v]));
  const now = run(...flags(o), '--summary-only');
  assert.equal(now.status, 0, now.stdout);
  const lines = now.stdout.trim().split('\n');
  assert.equal(lines.length, 3);
  for (const l of lines) { assert.match(l, /^after +cycle /); assert.match(l, /\| pass$/); }
  const old = run(...flags({ ...o, tree: 'before12', speeds: '2x,4x' }), '--summary-only');
  assert.equal(old.status, 1, old.stdout);
  const [two, four] = old.stdout.trim().split('\n');
  assert.match(two, /^before12 cycle .* 2x .* L1 +0\.46 L2 +49\.54 L3 +19\.06 .*FAIL l2\.x1$/);
  assert.match(four, /^before12 cycle .* 4x .* L1 +8\.80 L2 +100\.00 L3 +31\.15 .*FAIL l2\.x1 l3$/);
});
