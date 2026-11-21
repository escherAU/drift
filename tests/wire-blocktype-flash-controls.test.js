// DRIFT-11: the controls of tests/wire-blocktype-flash*.test.js, wire-flash-fps, blocktype-flash-fps and wire-blocktype-cycle: the same real-app runs (tests/helpers-wb-flash.js) must FAIL on
//   (1) wire.js and blocktype.js as they were at 7c2f34c (tests/fixtures/wire-before-drift11.js, blocktype-before-drift11.js, swapped into a copy of src/ by makeTree), with the numbers that
//       were measured, at 1x, 2x, 4x and on the q156 and jitter clocks; the old looks read L1 40.74 / L2 98.61 (wire) and L2 81.02 (blocktype) over seeds 1 to 3 (tests/tools-life-matrix.test.js)
//   (2) a one-line mutant of each mechanism of the fix, built in a temporary copy of src/ (makeTree: a mutation that matches nothing throws), each against the same arm on the shipped tree
//       (which must pass: the pair), so it is the mutation that fails and not the arm
//   (3) a mutant that makes the scene strobe, so the meter is shown sensitive on these scenes
// The mechanisms: wire has TWO limits on how often a cell changes (the pose beat, SUBSTEPS 18 in wire.js, and the per-cell gap, FLIP_GAP 18 in follow.js) and either alone holds L1 and L2
// on every arm measured, so the pair is pinned the other way too (each alone passes, both removed fail, and the gap HALVED with the beat removed fails); both scenes have the per-step share and
// the per-frame cap (FLIP_SHARE, FRAME_SHARE in follow.js: L3 on small boards at low frame rates; the cap and the share each pinned) and ask for the real-time clock (realClock). Blocktype's
// limit on a cell is its picture: two changes at most in a transition, which the mutants take away (a wave and a scroll that move smoothly, as the old ones did).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTree, rmTree, nums } from './helpers-life-app.js';
import { go, whole, line, SEEDS } from './helpers-wb-flash.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';

const failing = (r) => failedRules(r.rep, { only: X1_RULE_IDS });
const pc = (v) => v.toFixed(2);
const FOLLOW = 'src/scenes/follow.js';
const at = (text, from, to) => text.replace(from, to);
const GAP = (to) => ({ [FOLLOW]: (t) => at(t, 'export const FLIP_GAP = 18;', `export const FLIP_GAP = ${to};`) });
const BEAT_3 = { wire: (t) => at(t, 'const SUBSTEPS = 18;', 'const SUBSTEPS = 3;') }; // the pose every 0.1 s instead of every 0.6 s: the ideal turns smoothly
const NO_CAP = { [FOLLOW]: (t) => at(t, 'Math.min(FLIP_SHARE, FRAME_SHARE / Math.max(1, n))', 'FLIP_SHARE') };
const NO_LIMITS = { [FOLLOW]: (t) => at(t, 'Math.min(FLIP_SHARE, FRAME_SHARE / Math.max(1, n))', '1') }; // the share and the cap both gone: a whole change in one step
const NO_REALCLOCK = (scene) => ({ [scene]: (t) => at(t, 'realClock: true, ', '') });
const STROBE = (scene) => ({ [scene]: (t) => at(t, 'params.glyphs.set(s.F.shown);', 'if ((s.sub >> 1) & 1) params.glyphs.fill(0x2588); else params.glyphs.set(s.F.shown);') });

// runs `arm` (scene, runLife options) on the tree `root`; returns the rule ids that failed over the seeds, and on the shipped tree for the pair
async function over(scene, o, seeds, root = null) {
  const ids = new Set(), worst = {};
  for (const seed of seeds) {
    const oo = { ...o, seed, clockSeed: seed, root };
    const r = await go(scene, oo);
    whole(r, `${scene} seed ${seed}`, oo);
    for (const id of failing(r)) ids.add(id);
    const n = nums(r.rep);
    for (const k of Object.keys(n)) worst[k] = Math.max(worst[k] || 0, n[k]);
  }
  return { ids: [...ids].sort(), worst };
}
async function mutant(name, { life = 'new', edits = {}, scenes = {} }, scene, o, seeds, expectIds) {
  const root = makeTree(life, edits, scenes);
  try {
    const bad = await over(scene, o, seeds, root);
    for (const id of expectIds) assert.ok(bad.ids.includes(id), `${name}: the mutant must fail ${id} (failed ${JSON.stringify(bad.ids)}; worst ${JSON.stringify(bad.worst)})`);
    const good = await over(scene, o, seeds, null);
    assert.deepEqual(good.ids, [], `${name}: the same arm on the shipped scene passes (${JSON.stringify(good.worst)})`);
    return bad;
  } finally { rmTree(root); }
}

// DRIFT-12: the small boards these controls used (10x4 to 25x5, and 20x6) are below Classic's 40x10 minimum, where Classic shows the size card and neither scene runs (go() tells runLife, and
// whole() asserts the card run). Measured over seeds 1 to 8 at 40x10 and 41x11 (grid at 8 and 18 fps, q156 at 10 and 12 fps): the per-frame cap removed, the cap and the share removed, and
// (blocktype, 4x, q156) realClock removed ALL pass the five rules, so no art size is left where those mutants fail; the old looks, the beat, the gap, the wave, the scroll and realClock on
// wire still fail at 40x10 and above. So the controls that needed a small board now assert what is true (mutantOnCard): the mutant shows the card at the old boards, passes at 40x10; the caps
// are pinned on the composer by tests/life-frame-cap.test.js and the scenes' own tests.
async function mutantOnCard(name, mk, scene, boards, art) {
  const root = mk();
  try {
    for (const o of boards) {
      const oo = { ...o, seed: 1, clockSeed: 1, root };
      const r = await go(scene, oo);
      whole(r, `${name} ${scene} ${JSON.stringify(o)}`, oo);
      assert.equal(r.card, true, `${name}: ${JSON.stringify(o)} is the size card`);
    }
    const ok = await over(scene, art, SEEDS, root);
    assert.deepEqual(ok.ids, [], `${name} ${scene}: the mutant passes at ${JSON.stringify(art)} (${JSON.stringify(ok.worst)})`);
  } finally { rmTree(root); }
}

// ---- (1) the old looks
const OLD = { wire: 'old', blocktype: 'old' };
const OLD_ARMS = [
  // scene, label, options, expected ids, L1, L2 (per cent, seed 1, 80x24, 256 colours; truecolor reads the same)
  ['wire', '1x grid', { clock: 'grid' }, ['l1.x1', 'l2.x1'], '37.04', '93.98'],
  ['wire', '2x grid', { clock: 'grid', speed: '2x' }, ['l1.x1', 'l2.x1'], '72.69', '100.00'],
  ['wire', '4x grid', { clock: 'grid', speed: '4x' }, ['l1.x1', 'l2.x1'], '85.19', '100.00'],
  ['wire', '1x q156', { clock: 'q156' }, ['l1.x1', 'l2.x1'], '28.24', '91.67'],
  ['wire', '1x jitter', { clock: 'jitter' }, ['l1.x1', 'l2.x1'], '38.43', '93.52'],
  ['blocktype', '1x grid', { clock: 'grid' }, ['l2.x1'], '3.70', '77.78'],
  ['blocktype', '2x grid', { clock: 'grid', speed: '2x' }, ['l2.x1'], '0.00', '52.31'],
  ['blocktype', '4x grid', { clock: 'grid', speed: '4x' }, ['l2.x1'], '0.00', '29.63'],
  ['blocktype', '1x q156', { clock: 'q156' }, ['l2.x1'], '1.85', '70.83'],
  ['blocktype', '1x jitter', { clock: 'jitter' }, ['l2.x1'], '5.56', '77.78'],
];
test('DRIFT-11 the old wire and blocktype (7c2f34c) fail the five rules in the real app at 80x24, seed 1, 256 colours: 1x, 2x and 4x on the grid, 1x on q156 and jitter, with the numbers measured', async () => {
  const root = makeTree('new', {}, OLD);
  try {
    for (const [scene, label, o, ids, l1, l2] of OLD_ARMS) {
      const r = await go(scene, { ...o, cols: 80, rows: 24, mode: '256', seed: 1, clockSeed: 1, root });
      whole(r, `old ${scene} ${label}`, o);
      assert.deepEqual(failing(r), ids, `old ${scene} ${label}: ${line(r.rep)}`);
      const n = nums(r.rep);
      assert.equal(pc(n.l1), l1, `old ${scene} ${label} L1`);
      assert.equal(pc(n.l2), l2, `old ${scene} ${label} L2`);
    }
  } finally { rmTree(root); }
});

test('DRIFT-11 the old wire and blocktype also fail on the small boards at --fps 8 (DRIFT-12: the smallest board Classic shows, 40x10, since 20x6 is the size card now; the shipped ones pass the same arm: tests/wire-flash-fps.test.js, blocktype-flash-fps.test.js)', async () => {
  const root = makeTree('new', {}, OLD);
  try {
    for (const scene of ['wire', 'blocktype']) {
      const bad = await over(scene, { cols: 40, rows: 10, mode: '256', clock: 'grid', fps: 8 }, [1, 2, 3], root);
      assert.ok(bad.ids.includes('l2.x1'), `old ${scene} 40x10 fps 8: ${JSON.stringify(bad)}`);
      const good = await over(scene, { cols: 40, rows: 10, mode: '256', clock: 'grid', fps: 8 }, [1, 2, 3], null);
      assert.deepEqual(good.ids, [], `shipped ${scene} 40x10 fps 8: ${JSON.stringify(good.worst)}`);
    }
  } finally { rmTree(root); }
});

// ---- (2) wire: what limits how often a cell changes
const W = { cols: 80, rows: 24, mode: '256', clock: 'grid' };
test('DRIFT-11 wire mutant: the beat AND the per-cell gap removed (FLIP_GAP 0, SUBSTEPS 3) reads L2 over the limit; the shipped scene passes the same arm', async () => {
  const bad = await mutant('no beat, no gap', { edits: GAP(0), scenes: BEAT_3 }, 'wire', W, [1, 2, 3], ['l2.x1']);
  assert.ok(bad.worst.l2 > 25, `L2 ${pc(bad.worst.l2)}`);
});
test('DRIFT-11 wire mutant: the gap HALVED (FLIP_GAP 9) with the beat removed reads L2 over the limit (the gap alone is the limit there, and 9 steps is too few)', async () => {
  const bad = await mutant('gap 9, no beat', { edits: GAP(9), scenes: BEAT_3 }, 'wire', W, [1, 2, 3], ['l2.x1']);
  assert.ok(bad.worst.l2 > 25, `L2 ${pc(bad.worst.l2)}`);
});
test('DRIFT-11 wire pair: either limit alone holds L1 and L2 (the gap with the beat removed, the beat with the gap removed): the two are redundant on every arm measured, by design', async () => {
  for (const [name, edits, scenes] of [['beat removed, gap 18', {}, BEAT_3], ['gap removed, beat 18', GAP(0), {}]]) {
    const root = makeTree('new', edits, scenes);
    try {
      for (const o of [W, { ...W, speed: '4x' }, { cols: 40, rows: 10, mode: '256', clock: 'q156', fps: 12 }]) {
        const r = await over('wire', o, [1, 2, 3, 4], root);
        assert.deepEqual(r.ids, [], `${name} ${JSON.stringify(o)}: ${JSON.stringify(r.worst)}`);
      }
    } finally { rmTree(root); }
  }
});
test('DRIFT-12 wire mutant: the per-frame cap removed used to read L3 over the limit at --fps 8 to 12 on small boards; those boards are the size card now, so it cannot fail through the app and passes at 40x10', async () => {
  await mutantOnCard('no frame cap', () => makeTree('new', NO_CAP), 'wire', [{ cols: 10, rows: 4, clock: 'q156', fps: 10 }, { cols: 15, rows: 5, clock: 'grid', fps: 8 }, { cols: 13, rows: 4, clock: 'q156', fps: 10 }], { cols: 40, rows: 10, mode: '256', clock: 'q156', fps: 10 });
});
test('DRIFT-12 wire mutant: the share and the cap both removed used to read L3 over the limit on small boards; those boards are the size card now (unreachable) and the mutant passes at 40x10 at 8 and 18 fps', async () => {
  await mutantOnCard('no limits', () => makeTree('new', NO_LIMITS), 'wire', [{ cols: 20, rows: 6, clock: 'grid', fps: 18 }, { cols: 10, rows: 4, clock: 'grid', fps: 8 }], { cols: 40, rows: 10, mode: '256', clock: 'grid', fps: 8 });
  await mutantOnCard('no limits', () => makeTree('new', NO_LIMITS), 'wire', [], { cols: 40, rows: 10, mode: '256', clock: 'grid', fps: 18 });
});
test('DRIFT-11 wire mutant: realClock removed, so the speed keys turn the shape and its beat faster: L2 over the limit at 2x and 4x; the pair at 1x (the same tree) passes', async () => {
  const root = makeTree('new', {}, NO_REALCLOCK('wire'));
  try {
    for (const speed of ['2x', '4x']) {
      const bad = await over('wire', { ...W, speed }, [1, 2, 3], root);
      assert.ok(bad.ids.includes('l2.x1') && bad.worst.l2 > 25, `${speed}: ${JSON.stringify(bad)}`);
    }
    const one = await over('wire', W, [1, 2, 3], root);
    assert.deepEqual(one.ids, [], `at 1x the mutant is the shipped scene: ${JSON.stringify(one.worst)}`);
  } finally { rmTree(root); }
});

// ---- (2) blocktype: its pictures, the per-frame limits and the clock
const B = { cols: 80, rows: 24, mode: '256', clock: 'grid' };
test('DRIFT-11 blocktype mutant: the wave ripples with the front again (a column changes with every step of the ripple, as the old wave did) reads L2 over the limit at 80x24, 120x40 and 40x10 (20x6 until DRIFT-12: it is the size card now)', async () => {
  const scenes = { blocktype: (t) => at(t, 'Math.round(amp * Math.sin(x * 0.55))', 'Math.round(amp * Math.sin((x - front) * 0.55))') };
  for (const o of [B, { ...B, cols: 120, rows: 40 }, { ...B, cols: 40, rows: 10 }]) {
    const bad = await mutant('wave moves', { scenes }, 'blocktype', o, [1, 2, 3], ['l2.x1']);
    assert.ok(bad.worst.l2 > 25, `${JSON.stringify(o)}: L2 ${pc(bad.worst.l2)}`);
  }
});
test('DRIFT-11 blocktype mutant: the scroll slides smoothly again (every pixel of the letters\' travel is a change) reads L2 over the limit at 80x24, 120x40 and 40x10 (20x6 until DRIFT-12: it is the size card now)', async () => {
  const scenes = { blocktype: (t) => at(at(t, 'dy: -half }', 'dy: -Math.round(travel * e) }'), 'dy: travel - half }', 'dy: Math.round(travel * (1 - e)) }') };
  for (const o of [B, { ...B, cols: 120, rows: 40 }, { ...B, cols: 40, rows: 10 }]) {
    const bad = await mutant('scroll slides', { scenes }, 'blocktype', o, [1, 2, 3], ['l2.x1']);
    assert.ok(bad.worst.l2 > 25, `${JSON.stringify(o)}: L2 ${pc(bad.worst.l2)}`);
  }
});
test('DRIFT-12 blocktype mutant: the per-frame cap removed used to read L3 over the limit on a 13x4 board at --fps 12 on q156; that board is the size card now (unreachable) and the mutant passes at 40x10', async () => {
  await mutantOnCard('no frame cap', () => makeTree('new', NO_CAP), 'blocktype', [{ cols: 13, rows: 4, clock: 'q156', fps: 12 }], { cols: 40, rows: 10, mode: '256', clock: 'q156', fps: 12 });
});
test('DRIFT-12 blocktype mutant: the share and the cap both removed used to read L3 over the limit on small boards; those boards are the size card now (unreachable) and the mutant passes at 40x10', async () => {
  await mutantOnCard('no limits', () => makeTree('new', NO_LIMITS), 'blocktype', [{ cols: 10, rows: 4, clock: 'grid', fps: 8 }, { cols: 20, rows: 6, clock: 'grid', fps: 8 }, { cols: 13, rows: 4, clock: 'q156', fps: 12 }], { cols: 40, rows: 10, mode: '256', clock: 'grid', fps: 8 });
});
test('DRIFT-12 blocktype mutant: realClock removed used to read L3 over the limit at 4x on a 10x4 board on q156 at --fps 18; that board is the size card now (unreachable); at 40x10 and at 80x24 the mutant passes', async () => {
  await mutantOnCard('no realClock', () => makeTree('new', {}, NO_REALCLOCK('blocktype')), 'blocktype', [{ cols: 10, rows: 4, clock: 'q156', fps: 18, speed: '4x' }], { cols: 40, rows: 10, mode: '256', clock: 'q156', fps: 18, speed: '4x' });
  const root = makeTree('new', {}, NO_REALCLOCK('blocktype'));
  try {
    const big = await over('blocktype', { ...B, speed: '4x' }, [1, 2, 3], root);
    assert.deepEqual(big.ids, [], `at 80x24 the mutant passes: ${JSON.stringify(big.worst)}`);
  } finally { rmTree(root); }
});

// ---- (3) the meter sees a strobe on these scenes
for (const scene of ['wire', 'blocktype']) {
  test(`DRIFT-11 ${scene} mutant: the picture strobes (every other pair of steps a full screen) reads L1, L2 and L3 over their limits`, async () => {
    const root = makeTree('new', {}, STROBE(scene));
    try {
      const r = await go(scene, { ...B, seed: 1, root });
      assert.deepEqual(failing(r), ['l1.x1', 'l2.x1', 'l3'], `${scene} strobe: ${line(r.rep)}`);
    } finally { rmTree(root); }
  });
}

// ---- the controls are real: a mutation that matches nothing is an error, not a silent pass
test('DRIFT-11 makeTree: a mutation of wire.js, blocktype.js or follow.js that changes nothing throws (a mutant that is the shipped scene cannot pass for a control)', () => {
  assert.throws(() => makeTree('new', {}, { wire: (t) => t }), /changed nothing/);
  assert.throws(() => makeTree('new', {}, { blocktype: (t) => at(t, 'this text is nowhere in the file', 'x') }), /changed nothing/);
  assert.throws(() => makeTree('new', { [FOLLOW]: (t) => at(t, 'export const FLIP_GAP = 99;', 'x') }), /changed nothing/);
});
