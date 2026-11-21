// DRIFT-12: the controls of tests/tunnel-flash*.test.js, tunnel-cycle and tunnel-look: the same real-app runs (tests/helpers-wb-flash.js go(), tests/tunnel-cycle.test.js) must FAIL on
//   (1) tunnel.js as it was at 1cb2b62 (tests/fixtures/tunnel-before-drift12.js, swapped into a copy of src/ by makeTree): at 2x and 4x with the numbers that were measured (80x24 and 40x10,
//       seed 1, 256 colours; truecolor reads the same), on the grid, q156 and jitter clocks, and as the whole cycle; at 1x on the grid the old look passes, the pair that shows the arm is fair
//   (2) a one-line mutant of each mechanism the fix has, built in a temporary copy of src/ (makeTree: a mutation that matches nothing throws), each against the same arm on the shipped tree
//       (which must pass: the pair), so it is the mutation that fails and not the arm
//   (3) a mutant that makes the scene strobe, so the meter is shown sensitive on this scene
// The mechanisms the fix has, and the ones it does not: (a) the scene is stepped from the REAL-TIME clock (realClock in tunnel.js, and `rt += dt * Math.min(speed, 1)` in src/app.js), so the speed
// keys no longer multiply its flow; (b) the flow is slower, FLY 0.55 rings a second (0.9 before), so that two paints between two reads of the viewer's grid cannot change 30 % of the cells (L3).
// There is NO follower, no per-cell hold gap and no per-frame cap in the tunnel: it was measured that the real-time clock alone (FLY 0.9, TURN 0.12) left L3 at 34.25 % on the q156 clock at --fps 10 on 40x10
// (and 33.48 % at 41x11; 29.06 % at 78x24), over seeds 1 to 8, and the slower flow is what removes that, so (b) is pinned and a follower is not a mechanism to mutate (the controls below say so by asserting the figures).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTree, rmTree, nums, runLife, PLAN, SPEED_OF, BEFORE12_EDITS } from './helpers-life-app.js';
import { go, whole, line } from './helpers-wb-flash.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';

const failing = (r) => failedRules(r.rep, { only: X1_RULE_IDS });
const pc = (v) => v.toFixed(2);
const at = (text, from, to) => text.replace(from, to);
const NO_REALCLOCK = { tunnel: (t) => at(t, 'realClock: true, ', '') };
const NO_MIN = { 'src/app.js': (t) => at(t, 'rt += dt * Math.min(SPEEDS[speedIdx], 1);', 'rt += dt * SPEEDS[speedIdx];') };
const FLY_BEFORE = { tunnel: (t) => at(t, 'export const FLY = 0.55;', 'export const FLY = 0.9;') };
const TURN_BEFORE = { tunnel: (t) => at(t, 'const TURN = 0.08;', 'const TURN = 0.12;') };
const STROBE = { tunnel: (t) => at(t, 'ideal(s.sub / STEP_HZ, s.w, s.h, params);', 'ideal(s.sub / STEP_HZ, s.w, s.h, params); if ((s.sub >> 1) & 1) params.glyphs.fill(0x2588);') };
const A = { cols: 80, rows: 24, mode: '256', clock: 'grid' };

// runs `arm` (runLife options) on the tree `root` over the seeds; returns the rule ids that failed and the worst of each rule
async function over(o, seeds, root = null) {
  const ids = new Set(), worst = {};
  for (const seed of seeds) {
    const oo = { ...o, seed, clockSeed: seed, root };
    const r = await go('tunnel', oo);
    whole(r, `tunnel seed ${seed}`, oo);
    for (const id of failing(r)) ids.add(id);
    const n = nums(r.rep);
    for (const k of Object.keys(n)) worst[k] = Math.max(worst[k] || 0, n[k]);
  }
  return { ids: [...ids].sort(), worst };
}

// ---- (1) the old look
const OLD_ARMS = [
  // label, options, expected ids, then L1, L2, L3 in per cent (seed 1, 256 colours; measured on 1cb2b62)
  ['1x grid 80x24', { ...A }, [], '0.00', '10.65', '11.98'],
  ['2x grid 80x24', { ...A, speed: '2x' }, ['l2.x1'], '0.00', '43.98', '18.33'],
  ['4x grid 80x24', { ...A, speed: '4x' }, ['l2.x1', 'l3'], '7.41', '100.00', '30.99'],
  ['2x q156 80x24', { ...A, clock: 'q156', speed: '2x' }, ['l2.x1', 'l3'], '0.00', '43.52', '30.63'],
  ['4x q156 80x24', { ...A, clock: 'q156', speed: '4x' }, ['l2.x1', 'l3'], '4.63', '100.00', '51.72'],
  ['4x jitter 80x24', { ...A, clock: 'jitter', speed: '4x' }, ['l2.x1', 'l3'], '7.87', '100.00', '35.73'],
  ['2x grid 40x10', { ...A, cols: 40, rows: 10, speed: '2x' }, ['l2.x1'], '0.00', '57.14', '22.75'],
  ['4x grid 40x10', { ...A, cols: 40, rows: 10, speed: '4x' }, ['l2.x1', 'l3'], '12.50', '100.00', '37.75'],
];
test('DRIFT-12 the old tunnel (1cb2b62) fails the five rules in the real app at 2x and 4x, seed 1, 256 colours, with the numbers measured (80x24 and 40x10; grid, q156, jitter), and passes at 1x on the grid', async () => {
  const root = makeTree('new', {}, { tunnel: 'old' });
  try {
    for (const [label, o, ids, l1, l2, l3] of OLD_ARMS) {
      const r = await go('tunnel', { ...o, seed: 1, clockSeed: 1, root });
      whole(r, `old tunnel ${label}`, o);
      assert.deepEqual(failing(r), ids, `old tunnel ${label}: ${line(r.rep)}`);
      const n = nums(r.rep);
      assert.equal(pc(n.l1), l1, `old tunnel ${label} L1`);
      assert.equal(pc(n.l2), l2, `old tunnel ${label} L2`);
      assert.equal(pc(n.l3), l3, `old tunnel ${label} L3`);
    }
  } finally { rmTree(root); }
});

test('DRIFT-12 the whole cycle as it was at 1cb2b62 (the old tunnel, the dissolve at scene speed, no realTime composer) fails at 2x and 4x on the grid (80x24, seed 1, 256 colours) with the numbers measured, and passes at 1x', async () => {
  const root = makeTree('new', BEFORE12_EDITS, { tunnel: 'old' });
  try {
    for (const [speed, ids, l2, l3] of [['1x', [], '15.28', '13.44'], ['2x', ['l2.x1'], '46.76', '18.75'], ['4x', ['l2.x1', 'l3'], '100.00', '31.15']]) {
      const r = await runLife({ cols: 80, rows: 24, mode: '256', seed: 1, clock: 'grid', seconds: 170, sceneSeconds: 30 * SPEED_OF[speed], keys: PLAN[speed], feedAll: true, stopAtDissolve: false, scene: 'life', startScene: 0, root });
      assert.equal(r.frames, 170 * 18);
      assert.deepEqual(failing(r), ids, `old cycle ${speed}: ${line(r.rep)}`);
      const n = nums(r.rep);
      assert.equal(pc(n.l2), l2, `old cycle ${speed} L2`);
      assert.equal(pc(n.l3), l3, `old cycle ${speed} L3`);
    }
  } finally { rmTree(root); }
});

// ---- (2) the mechanisms
async function mutant(name, { edits = {}, scenes = {} }, arms, expectIds, seeds) {
  const root = makeTree('new', edits, scenes);
  try {
    for (const o of arms) {
      const bad = await over(o, seeds, root);
      for (const id of expectIds) assert.ok(bad.ids.includes(id), `${name} ${JSON.stringify(o)}: the mutant must fail ${id} (failed ${JSON.stringify(bad.ids)}; worst ${JSON.stringify(bad.worst)})`);
      const good = await over(o, seeds, null);
      assert.deepEqual(good.ids, [], `${name} ${JSON.stringify(o)}: the same arm on the shipped scene passes (${JSON.stringify(good.worst)})`);
    }
  } finally { rmTree(root); }
}
// With the slower flow the speed keys alone do not fail every arm: at 2x the flow without realClock is 1.1 rings a second, about the old 1x flow (L2 21.76 % over seeds 1 to 3, under 25 %), so the
// pair that fails is 4x (2.2 rings a second); 2x is pinned as passing so nobody reads the 4x pair as a 2x one.
test('DRIFT-12 mutant: realClock removed from the tunnel, so the speed keys make it flow faster again: L2 over the limit at 4x (2x and 1x still pass, pinned); the shipped scene passes 4x', async () => {
  const root = makeTree('new', {}, NO_REALCLOCK);
  try {
    const bad = await over({ ...A, speed: '4x' }, [1, 2, 3], root);
    assert.ok(bad.ids.includes('l2.x1') && bad.worst.l2 > 25, `4x: ${JSON.stringify(bad)}`);
    const good = await over({ ...A, speed: '4x' }, [1, 2, 3], null);
    assert.deepEqual(good.ids, [], `4x on the shipped tunnel: ${JSON.stringify(good.worst)}`);
    const two = await over({ ...A, speed: '2x' }, [1, 2, 3], root);
    assert.deepEqual(two.ids, [], `at 2x the mutant passes (a flow of 1.1 rings a second): ${JSON.stringify(two.worst)}`);
    assert.equal(pc(two.worst.l2), '21.76', 'the 2x number measured');
    const one = await over(A, [1, 2, 3], root);
    assert.deepEqual(one.ids, [], `at 1x the mutant is the shipped scene: ${JSON.stringify(one.worst)}`);
  } finally { rmTree(root); }
});
test('DRIFT-12 mutant: the app\'s real-time clock runs at the full speed (no min(speed, 1)) instead of min(speed, 1): L2 over the limit at 4x on the tunnel (2x passes with the slower flow, as in the realClock pair); the shipped tree passes the same arm', async () => {
  await mutant('rt = speed', { edits: NO_MIN }, [{ ...A, speed: '4x' }], ['l2.x1'], [1, 2, 3]);
});
test('DRIFT-12 mutant: the old flow (FLY 0.9 rings a second) reads L3 over the limit on the q156 clock at --fps 10 on 40x10 and 41x11 (seeds 1 to 8, 1x, 2x and 4x), 35.25 % and 32.59 % measured; the shipped flow passes', async () => {
  const arms = [{ cols: 40, rows: 10, mode: '256', clock: 'q156', fps: 10 }, { cols: 41, rows: 11, mode: '256', clock: 'q156', fps: 10 }, { cols: 40, rows: 10, mode: '256', clock: 'q156', fps: 10, speed: '4x' }];
  const root = makeTree('new', {}, FLY_BEFORE);
  try {
    const worst = [];
    for (const o of arms) {
      const bad = await over(o, [1, 2, 3, 4, 5, 6, 7, 8], root);
      assert.ok(bad.ids.includes('l3'), `${JSON.stringify(o)}: ${JSON.stringify(bad)}`);
      worst.push(pc(bad.worst.l3));
      const good = await over(o, [1, 2, 3, 4, 5, 6, 7, 8], null);
      assert.deepEqual(good.ids, [], `${JSON.stringify(o)} on the shipped tunnel: ${JSON.stringify(good.worst)}`);
      assert.ok(good.worst.l3 < 25, `the shipped flow leaves L3 under 25 %: ${pc(good.worst.l3)}`);
    }
    assert.deepEqual(worst, ['35.25', '32.59', '35.25'], 'the numbers measured');
  } finally { rmTree(root); }
});
test('DRIFT-12 the real-time clock alone is not enough: the flow and the turn of 1cb2b62 (FLY 0.9, TURN 0.12) on the real-time clock read L3 34.25 % and 33.48 % on the q156 clock at --fps 10 on 40x10 and 41x11 (seeds 1 to 8, 1x)', async () => {
  const root = makeTree('new', {}, { tunnel: (t) => at(at(t, 'export const FLY = 0.55;', 'export const FLY = 0.9;'), 'const TURN = 0.08;', 'const TURN = 0.12;') });
  try {
    const worst = [];
    for (const [cols, rows] of [[40, 10], [41, 11]]) {
      const r = await over({ cols, rows, mode: '256', clock: 'q156', fps: 10 }, [1, 2, 3, 4, 5, 6, 7, 8], root);
      assert.deepEqual(r.ids, ['l3'], `${cols}x${rows}: ${JSON.stringify(r.worst)}`);
      worst.push(pc(r.worst.l3));
    }
    assert.deepEqual(worst, ['34.25', '33.48'], 'the numbers measured');
  } finally { rmTree(root); }
});
test('DRIFT-12 the spokes\' turn (TURN 0.08, 0.12 before) is not a mechanism by itself: with the old turn and the new flow every arm of the pair above still passes (so only FLY is pinned)', async () => {
  const root = makeTree('new', {}, TURN_BEFORE);
  try {
    for (const o of [{ cols: 40, rows: 10, mode: '256', clock: 'q156', fps: 10 }, { cols: 41, rows: 11, mode: '256', clock: 'q156', fps: 10 }]) {
      const r = await over(o, [1, 2, 3, 4, 5, 6, 7, 8], root);
      assert.deepEqual(r.ids, [], `${JSON.stringify(o)}: ${JSON.stringify(r.worst)}`);
    }
  } finally { rmTree(root); }
});

// ---- (2b) the cycle at speed: the dissolve in real time, and the maze on the real-time clock (two mechanisms, each pinned on its own, and both removed)
// With the tunnel fixed the whole cycle still read over the limit at 2x and 4x. Two lines fix it, in src/app.js: (1) the scheduler's cross-fade runs in real time in contrast mode (the fadeScale of
// advance: at 4x a 0.5 s dissolve put the outgoing scene's last change, the cell's flip and the incoming scene's first change inside one second, rule L2) and (2) the contrast composer steps
// every sim from the real-time clock (realTime, src/cells.js; the maze did not ask for realClock, its file is not edited, and at 4x it read L3 over the limit on the q156 clock and, with a faster
// dissolve, L2 in its dissolves). Each alone leaves an arm over the limit (cycle, grid, 256 colours, seeds 1 to 3): without (1) 4x on 41x11 reads L2 30.36 %; without (2) 4x on 41x11 reads L2 28.57 %
// and, on the q156 clock at 18 fps over seeds 1 to 8, L3 31.71 % (the maze alone, 4x: the erase wipe four times as fast); without both, 2x on 40x10 reads L2 30.36 % and 4x on 79x25 39.09 %.
const must = (text, from, to) => { if (!text.includes(from)) throw new Error('mutation matches nothing: ' + from); return text.replace(from, to); };
const FS_LINE = "advance(d, shown.mode === 'contrast' ? Math.min(SPEEDS[speedIdx], 1) / SPEEDS[speedIdx] : 1);";
const RT_LINE = "realTime: mode === 'contrast'";
const NO_FADE_SCALE = { 'src/app.js': (t) => must(t, FS_LINE, 'advance(d);') };
const NO_REAL_TIME = { 'src/app.js': (t) => must(t, RT_LINE, 'realTime: false') };
const NEITHER = { 'src/app.js': (t) => must(must(t, FS_LINE, 'advance(d);'), RT_LINE, 'realTime: false') };
async function cycleWorst(speed, cols, rows, root, o = {}) {
  const worst = { l2: 0, l3: 0 }, ids = new Set();
  for (const seed of o.seeds || [1, 2, 3]) {
    const r = await runLife({ cols, rows, mode: '256', seed, clock: o.clock || 'grid', clockSeed: seed, seconds: 170, sceneSeconds: 30 * SPEED_OF[speed], keys: PLAN[speed], feedAll: true, stopAtDissolve: false, scene: 'life', startScene: 0, root });
    assert.equal(r.frames, 170 * 18);
    for (const k of ['l2', 'l3']) worst[k] = Math.max(worst[k], nums(r.rep)[k]);
    for (const id of failing(r)) ids.add(id);
  }
  return { l2: pc(worst.l2), l3: pc(worst.l3), ids: [...ids].sort() };
}
for (const [name, edits, arms] of [
  ['the scheduler\'s cross-fade is not scaled to real time', NO_FADE_SCALE, [['4x', 41, 11, '30.36']]],
  ['the contrast composer does not step its sims from the real-time clock', NO_REAL_TIME, [['4x', 41, 11, '28.57']]],
  ['neither mechanism', NEITHER, [['2x', 40, 10, '30.36'], ['4x', 79, 25, '39.09']]],
]) {
  test(`DRIFT-12 mutant: ${name}: the whole cycle reads L2 over the limit (${arms.map((a) => `${a[0]} ${a[1]}x${a[2]} ${a[3]} %`).join(', ')}, seeds 1 to 3, grid, 256 colours); the shipped tree passes the same arms`, async () => {
    const root = makeTree('new', edits);
    try {
      for (const [speed, cols, rows, l2] of arms) {
        const bad = await cycleWorst(speed, cols, rows, root);
        assert.deepEqual(bad.ids, ['l2.x1'], `${name} ${speed} ${cols}x${rows}: ${JSON.stringify(bad)}`);
        assert.equal(bad.l2, l2, `${name} ${speed} ${cols}x${rows} L2`);
        const good = await cycleWorst(speed, cols, rows, null);
        assert.deepEqual(good.ids, [], `the shipped tree ${speed} ${cols}x${rows}: ${JSON.stringify(good)}`);
      }
    } finally { rmTree(root); }
  });
}
test('DRIFT-12 mutant: the contrast composer does not step its sims from the real-time clock: the maze at 4x reads L3 31.71 % on the q156 clock at 18 fps on 41x11 (seeds 1 to 8, the whole cycle); the shipped tree passes', async () => {
  const root = makeTree('new', NO_REAL_TIME);
  try {
    const bad = await cycleWorst('4x', 41, 11, root, { clock: 'q156', seeds: [1, 2, 3, 4, 5, 6, 7, 8] });
    assert.ok(bad.ids.includes('l3'), JSON.stringify(bad));
    assert.equal(bad.l3, '31.71');
    const good = await cycleWorst('4x', 41, 11, null, { clock: 'q156', seeds: [1, 2, 3, 4, 5, 6, 7, 8] });
    assert.deepEqual(good.ids, [], JSON.stringify(good));
  } finally { rmTree(root); }
});

// ---- (3) the meter sees a strobe on this scene
test('DRIFT-12 tunnel mutant: the picture strobes (every other pair of steps a full screen) reads L1, L2 and L3 over their limits', async () => {
  const root = makeTree('new', {}, STROBE);
  try {
    const r = await go('tunnel', { ...A, seed: 1, root });
    assert.deepEqual(failing(r), ['l1.x1', 'l2.x1', 'l3'], `tunnel strobe: ${line(r.rep)}`);
  } finally { rmTree(root); }
});

// ---- the controls are real: a mutation that matches nothing is an error, not a silent pass
test('DRIFT-12 makeTree: a mutation of tunnel.js or app.js that changes nothing throws (a mutant that is the shipped scene cannot pass for a control)', () => {
  assert.throws(() => makeTree('new', {}, { tunnel: (t) => t }), /changed nothing/);
  assert.throws(() => makeTree('new', {}, { tunnel: (t) => at(t, 'this text is nowhere in the file', 'x') }), /changed nothing/);
  assert.throws(() => makeTree('new', { 'src/app.js': (t) => at(t, 'rt += dt * Math.min(SPEEDS[speedIdx], 99);', 'x') }), /changed nothing/);
  for (const e of [NO_FADE_SCALE, NO_REAL_TIME, NEITHER]) rmTree(makeTree('new', e)); // the cycle mutations match too
  for (const m of [NO_REALCLOCK.tunnel, FLY_BEFORE.tunnel, TURN_BEFORE.tunnel, STROBE.tunnel]) rmTree(makeTree('new', {}, { tunnel: m })); // each of the real mutations matches
  rmTree(makeTree('new', NO_MIN));
});

// ---- the speed keys still shorten the scene's turn, as they do for Life
test('DRIFT-12 the speed keys still shorten the tunnel\'s turn: with a scene length of 30 s the scene is held for about 30 real seconds at 1x, 15 at 2x and 7.5 at 4x (the flow itself does not speed up)', async () => {
  const frames = {};
  for (const speed of ['1x', '2x', '4x']) {
    const r = await runLife({ cols: 80, rows: 24, mode: '256', seed: 1, clock: 'grid', seconds: 36, keys: PLAN[speed], sceneSeconds: 30, scene: 'tunnel', startScene: 1 });
    frames[speed] = r.frames / 18;
  }
  assert.ok(frames['1x'] > 29 && frames['1x'] <= 30.1, `1x: ${frames['1x']} s`);
  assert.ok(frames['2x'] > 15 && frames['2x'] < 22, `2x: ${frames['2x']} s (the key presses come in the second second)`);
  assert.ok(frames['4x'] > 7.4 && frames['4x'] < 17, `4x: ${frames['4x']} s`);
  assert.ok(frames['1x'] > frames['2x'] && frames['2x'] > frames['4x'], `${JSON.stringify(frames)}`);
});
