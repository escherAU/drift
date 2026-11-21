// DRIFT-10: must-fail controls for tests/life-flash.test.js and tests/life-flash-speed.test.js. The same runs (tests/helpers-life-app.js runLife: the real app, contrast mode, Life first, the
// viewer's 18 Hz grid, the five 1x rules), on a COPY of src/ in a temporary folder with one thing changed, and each must FAIL, so the passes in the other two files are shown to come from the fix.
//   old Life        src/scenes/life.js as it was at a8b63a3 (tests/fixtures/life-before-drift10.js): fails seed 2 at 1x and at 4x on the grid, q156 and jitter clocks, and fails the 1x matrix
//                   (80x24: seeds 2, 3, 4 and 8; and at least one seed at 40x10, 78x24, 88x39 and 120x40)
//   mutants         of the new Life, one line each: the flip gap removed (0), halved (9 steps), the speed lever removed from the scene (realClock) or from the app (rt), and the per-step
//                   share limit taken out (a reseed on a 20x6 board then moves more than 30 % of the screen in one frame)
// A passing control prints its numbers only after the assertion that it fails has passed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLife, makeTree, rmTree, nums, PLAN, SPEED_OF } from './helpers-life-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const fmt = (rep) => { const n = nums(rep); return `L1 ${n.l1.toFixed(2)} L2 ${n.l2.toFixed(2)} L3 ${n.l3.toFixed(2)} R ${n.r.toFixed(2)} C ${n.c.toFixed(2)}`; };
const bad = (rep) => failedRules(rep, { only: X1_RULE_IDS });
const go = (root, o) => runLife({ root, seconds: 36, keys: PLAN[o.speed || '1x'], sceneSeconds: 30 * SPEED_OF[o.speed || '1x'], mode: '256', ...o });

let OLD = null;
test.before(() => { OLD = makeTree('old'); });
test.after(() => { if (OLD) rmTree(OLD); });

for (const speed of ['1x', '4x']) {
  for (const clock of ['grid', 'q156', 'jitter']) {
    test(`DRIFT-10 control: the old Life fails seed 2 at ${speed} on the ${clock} clock (L2, and L1 at 1x too)`, async () => {
      const r = await go(OLD, { speed, clock, clockSeed: 2, seed: 2 });
      assert.ok(r.frames >= 538, 'the whole scene was read');
      const b = bad(r.rep);
      assert.ok(b.includes('l2.x1'), `old Life, ${speed}, ${clock}: L2 fails (${fmt(r.rep)})`);
      assert.ok(b.includes('l1.x1'), `old Life, ${speed}, ${clock}: L1 fails (${fmt(r.rep)})`);
      console.log(`CONTROL old Life seed 2 ${speed} ${clock} 256 80x24: ${fmt(r.rep)} FAILS ${b.join(' ')}`);
    });
  }
}

test('DRIFT-10 control: the old Life fails the 1x matrix: 80x24 on seeds 2, 3, 4 and 8, and somewhere at every size up to 120x40', async () => {
  const failing = {};
  for (const [cols, rows] of [[80, 24], [40, 10], [78, 24], [88, 39], [120, 40]]) {
    failing[`${cols}x${rows}`] = [];
    for (const seed of SEEDS) {
      const r = await go(OLD, { cols, rows, seed, clock: 'grid' });
      if (bad(r.rep).length) failing[`${cols}x${rows}`].push(seed);
    }
  }
  assert.deepEqual(failing['80x24'], [2, 3, 4, 8]);
  for (const size of ['40x10', '78x24', '88x39', '120x40']) assert.ok(failing[size].length >= 1, `${size}: some seed fails (${failing[size]})`);
  console.log(`CONTROL old Life 1x grid 256, seeds that fail the five rules: ${Object.entries(failing).map(([k, v]) => `${k} [${v}]`).join(' ')}`);
});

// ---- mutants of the new Life
async function mutantFails(label, life, edits, runs) {
  const root = makeTree(life, edits);
  try {
    const failed = [];
    for (const o of runs) {
      const r = await go(root, o);
      const b = bad(r.rep);
      if (b.length) failed.push({ o, b, nums: fmt(r.rep) });
    }
    assert.ok(failed.length >= 1, `${label}: some run fails`);
    console.log(`CONTROL mutant ${label}: ${failed.length} of ${runs.length} runs fail, e.g. ${JSON.stringify(failed[0].o)} ${failed[0].nums} FAILS ${failed[0].b.join(' ')}`);
    return failed;
  } finally { rmTree(root); }
}
const grid80 = SEEDS.map((seed) => ({ seed, clock: 'grid' }));

test('DRIFT-10 control: the flip gap removed (FLIP_GAP 0): the drawn picture is the board again and fails at 1x', async () => {
  const failed = await mutantFails('FLIP_GAP 0', (t) => t.replace('const FLIP_GAP = 18;', 'const FLIP_GAP = 0;'), {}, grid80);
  assert.ok(failed.some((f) => f.o.seed === 2), 'seed 2 fails');
});

test('DRIFT-10 control: the flip gap halved (FLIP_GAP 9, 0.3 s): fails somewhere at 1x on 80x24 and 40x10', async () => {
  await mutantFails('FLIP_GAP 9', (t) => t.replace('const FLIP_GAP = 18;', 'const FLIP_GAP = 9;'), {}, [...grid80, ...SEEDS.map((seed) => ({ seed, clock: 'grid', cols: 40, rows: 10 }))]);
});

test('DRIFT-10 control: the speed lever removed from the scene (no realClock): passes at 1x, fails at 4x', async () => {
  const noReal = (t) => t.replace('realClock: true, ', '');
  const root = makeTree(noReal);
  try {
    for (const seed of [2, 4, 8]) {
      const one = await go(root, { seed, clock: 'grid' });
      assert.deepEqual(bad(one.rep), [], `1x seed ${seed} still passes: ${fmt(one.rep)}`);
    }
  } finally { rmTree(root); }
  const failed = await mutantFails('no realClock, 4x', noReal, {}, [2, 4, 8].map((seed) => ({ seed, clock: 'grid', speed: '4x' })));
  assert.equal(failed.length, 3, 'seeds 2, 4 and 8 all fail at 4x');
});

test('DRIFT-10 control: the speed lever removed from the app (the real-time clock not handed to the composer): fails at 4x on every clock', async () => {
  const edits = { 'src/app.js': (t) => t.replace('.frame(sc.state(), t, rt);', '.frame(sc.state(), t);') };
  const failed = await mutantFails('app passes no tc, 4x', 'new', edits, ['grid', 'q156', 'jitter'].map((clock) => ({ seed: 2, clock, clockSeed: 2, speed: '4x' })));
  assert.equal(failed.length, 3);
});

test('DRIFT-10 control: the per-step share limit taken out: a reseed on a 20x6 board moves more than 30 % of the screen in one frame (L3)', async () => {
  const noShare = (t) => t.replace('const FLIP_SHARE = 0.08;', 'const FLIP_SHARE = 1;');
  const failed = await mutantFails('FLIP_SHARE 1', noShare, {}, SEEDS.map((seed) => ({ seed, clock: 'grid', cols: 20, rows: 6 })));
  assert.ok(failed.some((f) => f.b.includes('l3')), 'L3 is the rule that fails');
  // and the real one passes the same runs
  for (const seed of SEEDS) {
    const r = await runLife({ cols: 20, rows: 6, seed, mode: '256', clock: 'grid', seconds: 32 });
    assert.deepEqual(bad(r.rep), [], `the real Life, 20x6 seed ${seed}: ${fmt(r.rep)}`);
  }
});

test('DRIFT-10 control: a mutation that changes nothing is refused (the harness cannot pass a control by matching no text)', () => {
  assert.throws(() => makeTree((t) => t.replace('this text is nowhere in life.js', 'x')), /changed nothing/);
  assert.throws(() => makeTree('new', { 'src/app.js': (t) => t }), /changed nothing/);
});
