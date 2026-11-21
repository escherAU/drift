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

test('DRIFT-10 life-matrix --scene: the other contrast scenes, measured and pinned as NOT meeting the five rules where they do not (the README says so): wire and blocktype fail at 1x, tunnel and maze pass', () => {
  const worst = (scene) => {
    const r = run('--scene', scene, '--seeds', '1,2,3', '--clocks', 'grid', '--modes', '256', '--speeds', '1x', '--sizes', '80x24', '--summary-only');
    const line = r.stdout.trim().split('\n').pop();
    const m = /L1 +([\d.]+) L2 +([\d.]+) L3 +([\d.]+)/.exec(line);
    return { status: r.status, l1: Number(m[1]), l2: Number(m[2]), l3: Number(m[3]), line };
  };
  const wire = worst('wire'), block = worst('blocktype'), tunnel = worst('tunnel'), maze = worst('maze');
  assert.equal(wire.status, 1); assert.ok(wire.l1 > 25 && wire.l2 > 25, wire.line);
  assert.equal(block.status, 1); assert.ok(block.l2 > 25, block.line);
  assert.equal(tunnel.status, 0, tunnel.line);
  assert.equal(maze.status, 0, maze.line);
  console.log('NOT COVERED (pinned): ' + [wire, block, tunnel, maze].map((x) => x.line.replace(/ +/g, ' ')).join(' || '));
});
