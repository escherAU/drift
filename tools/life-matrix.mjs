#!/usr/bin/env node
// DRIFT-10: reviewer tool, NOT part of `npm test`. Classic high contrast (the Life scene) on the REAL app, metered on the viewer's 18 Hz grid against the five rules
// (L1, L2, L3, R, C at their 1x views). One line per case with the five worst values in per cent and the rules that fail, then one summary line per clock / colour mode / speed
// with the worst of every rule over the seeds. The runs are the ones tests/life-flash*.test.js assert (tests/helpers-life-app.js runLife).
//   node tools/life-matrix.mjs [--tree after|before|before11|before12|<dir>] [--seeds 1,2,...,8] [--clocks grid,q156,jitter] [--modes 256,truecolor] [--speeds 1x,4x] [--sizes 80x24,...]
//                              [--seconds 32] [--fps 18] [--scene life|tunnel|wire|maze|blocktype] [--whole-cycle] [--invert] [--summary-only] [--x4]
// --x4 adds the x4 views of L1 and L2 (the same frames played four times as fast, tests/helpers-flash.js), which the tests do NOT assert for Life.
// --scene reads another scene of the contrast playlist (default life, the one the tests assert; the others are measured here and not asserted by any life-flash test).
// --whole-cycle meters every frame of a 170 s run from Life on (all five scenes and the four dissolves between them, scene length 30 s, speed 1x), not one scene.
// --invert runs with the config's invert on (white on black becomes black on white, as the `i` key leaves it).
// --tree before runs a copy of src/ with the Life scene as it was at a8b63a3 (tests/fixtures/life-before-drift10.js); after (default) is this tree; a directory runs the src/ in it.
// --tree before11 (DRIFT-11) runs a copy of src/ with the wire and blocktype scenes as they were at 7c2f34c (tests/fixtures/wire-before-drift11.js, blocktype-before-drift11.js) and everything else as shipped:
// the control for --scene wire, --scene blocktype and --whole-cycle. --fps takes a list (8,10,12,...): one line per fps.
// --tree before12 (DRIFT-12) runs a copy of src/ as Classic high contrast was at 1cb2b62: the tunnel scene (tests/fixtures/tunnel-before-drift12.js, pure in t: its flow follows the speed keys), the
// scheduler's cross-fade at scene speed and the composer without realTime (BEFORE12_EDITS in tests/helpers-life-app.js): the control for --scene tunnel and --whole-cycle at 2x and 4x.
// DRIFT-12: sizes below 40x10 are the size card (Classic's minimum window): the tool runs them as such and says so on stderr; the old small-board readings are not reachable.
// A speed's runs hold the Life scene for 30 REAL seconds (the scheduler's scene length is 30 s of scene time, which runs `speed` times faster: sceneSeconds = 30 * speed).
import { runLife, makeTree, rmTree, nums, PLAN, SPEED_OF, isCardBoard, BEFORE12_EDITS } from '../tests/helpers-life-app.js';
import { failedRules, X1_RULE_IDS } from '../tests/helpers-flash.js';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const list = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);
const tree = opt('tree', 'after');
const seeds = list(opt('seeds', '1,2,3,4,5,6,7,8')).map(Number);
const clocks = list(opt('clocks', 'grid,q156,jitter')), modes = list(opt('modes', '256,truecolor')), speeds = list(opt('speeds', '1x,4x')), sizes = list(opt('sizes', '80x24'));
const summaryOnly = argv.includes('--summary-only'), withX4 = argv.includes('--x4');
const fpsList = list(opt('fps', 18)).map(Number);
const scene = opt('scene', 'life'), whole = argv.includes('--whole-cycle'), invert = argv.includes('--invert');
const seconds = Number(opt('seconds', whole ? 170 : 32));
const SCENE_INDEX = { life: 0, tunnel: 1, wire: 2, maze: 3, blocktype: 4 }; // the contrast playlist in src/scenes/index.js
if (!(scene in SCENE_INDEX)) { console.error(`unknown scene ${scene}`); process.exit(2); }

const root = tree === 'after' ? null : tree === 'before' ? makeTree('old') : tree === 'before11' ? makeTree('new', {}, { wire: 'old', blocktype: 'old' }) : tree === 'before12' ? makeTree('new', BEFORE12_EDITS, { tunnel: 'old' }) : tree;
const pct = (v) => v.toFixed(2).padStart(6);
let anyFail = false;
try {
  for (const fps of fpsList) for (const clock of clocks) for (const mode of modes) for (const speed of speeds) for (const size of sizes) {
    const worst = { l1: 0, l2: 0, l3: 0, r: 0, c: 0, l1x4: 0, l2x4: 0 };
    const fails = new Set();
    const [cols, rows] = size.split('x').map(Number);
    if (isCardBoard(cols, rows)) console.error(`note: ${size} is below Classic's 40x10 minimum: Classic shows the size card there, so these runs are the card (static, nothing to flash), not the scene`);
    for (const seed of seeds) {
      const r = await runLife({ cols, rows, mode, seed, clock, clockSeed: seed, keys: PLAN[speed], seconds, sceneSeconds: 30 * SPEED_OF[speed], root, fps, scene, startScene: SCENE_INDEX[scene], invert, card: isCardBoard(cols, rows), ...(whole ? { feedAll: true, stopAtDissolve: false } : {}) });
      const n = nums(r.rep), bad = failedRules(r.rep, { only: X1_RULE_IDS });
      n.l1x4 = r.rep.l1.x4.worstFraction * 100; n.l2x4 = r.rep.l2.x4.worstFraction * 100;
      for (const k of Object.keys(worst)) worst[k] = Math.max(worst[k], n[k]);
      for (const b of bad) fails.add(b);
      if (bad.length) anyFail = true;
      if (!summaryOnly) console.log(`${tree.padEnd(6)} ${(whole ? 'cycle' : scene).padEnd(5)} ${clock.padEnd(6)} ${mode.padEnd(9)} ${speed} ${size.padEnd(7)} fps ${String(fps).padStart(2)} seed ${seed} | L1 ${pct(n.l1)} L2 ${pct(n.l2)} L3 ${pct(n.l3)} R ${pct(n.r)} C ${pct(n.c)}${withX4 ? ` | x4 views L1 ${pct(n.l1x4)} L2 ${pct(n.l2x4)}` : ''} | ${bad.length ? 'FAIL ' + bad.join(' ') : 'pass'}`);
    }
    console.log(`${tree.padEnd(6)} ${(whole ? 'cycle' : scene).padEnd(5)} ${clock.padEnd(6)} ${mode.padEnd(9)} ${speed} ${size.padEnd(7)} fps ${String(fps).padStart(2)} WORST of seeds ${seeds.join(',')} | L1 ${pct(worst.l1)} L2 ${pct(worst.l2)} L3 ${pct(worst.l3)} R ${pct(worst.r)} C ${pct(worst.c)}${withX4 ? ` | x4 views L1 ${pct(worst.l1x4)} L2 ${pct(worst.l2x4)}` : ''} | ${fails.size ? 'FAIL ' + [...fails].join(' ') : 'pass'}`);
  }
} finally {
  if (root && (tree === 'before' || tree === 'before11' || tree === 'before12')) rmTree(root);
}
process.exitCode = anyFail ? 1 : 0;
