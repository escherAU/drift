// DRIFT-13 correction 1: the governor keeps its history across a reset that does not change the size (src/governor.js RESET). The case that found it: Desmond Hale pressed `i` in the middle
// of a dissolve; the app reset the governor, which gave every cell a fresh "changed just now" and forgot the changes before it, so the cells the dissolve was still moving could change a third
// time inside the second and L2 failed for 0.3 to 0.57 s afterwards (48 of his 240 runs, worst 33.93 %).
//
// HOW IT IS JUDGED. The flip FRAME itself swaps the palette under the indices the governor works on: every cell changes luminance at once (L3 reads 95 % at it, in every run), and a cell with
// two changes just before it is hot at it. No hold can prevent that: it is the flip guard's business (README). Those pre-flip doubles stay hot until their oldest change is a second old, so
// the reads just after the flip can be over the limit too, with no governor able to prevent it either. Measured with a per-read series (a scratch tool, not shipped) over 288 runs of the shipped
// governor (40x10 to 80x24, fps 9 18 30, seeds 1 2 3 4 6 7, presses at 31 45 61 62 63 94 95 s): 8 runs had a read over 25 % after the flip frame, the LATEST 0.22 s after it (41x11, fps 18,
// seed 1); the governor that forgets its history on every reset over-runs until 0.3 to 0.57 s. So the meter is told to forget its worst readings (meter.forgetWorst(): the transition history
// stays) AFTERMATH = 0.25 s after the event, and the five X1 rules are judged on the reads after that. The bound was found on seeds 1 and 6; seeds 2, 3, 4 and 7 and sizes 41x10, 43x12, 45x12,
// 50x16 (144 more runs) never had an over-limit read later than 0.07 s, and the matrix below uses seeds the bound was not tuned on too.
// The same for the way back from another mode and from the console: the frame that comes back is whole by design.
// The control is the shipped code with the reset made hard again (the history cleared: the code before this correction): the same cases FAIL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLife, nums, makeTree, rmTree } from './helpers-life-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';

const bad = (rep) => failedRules(rep, { only: X1_RULE_IDS });
const line = (rep) => { const n = nums(rep); return `L1 ${n.l1.toFixed(2)} L2 ${n.l2.toFixed(2)} L3 ${n.l3.toFixed(2)} R ${n.r.toFixed(2)} C ${n.c.toFixed(2)}`; };
const must = (text, from, to) => { const lf = text.replace(/\r\n/g, '\n'); assert.equal(lf.split(from).length, 2, `the mutation target occurs exactly once: ${from}`); return lf.replace(from, to); };
// the code before this correction: reset() always starts the history again
const HARD_RESET = { 'src/governor.js': (t) => must(t, 'if (opts.hard || !Gp) {', 'if (true) {') };

// what "the screen came back" means for each way of leaving: the flip of `i`, the way back from another mode, the way back from the console
const EVENTS = {
  flip: { seen: (st, prev) => st.light !== prev.light },
  mode: { seen: (st, prev) => st.mode === 'contrast' && prev.mode !== 'contrast' },
  console: { seen: (st, prev) => st.shell === null && prev.shell !== null },
};
const AFTERMATH = 0.25; // seconds, see above

// run one case; judge the reads more than AFTERMATH after the event. Returns { rep (the worst over those reads), at (the frame of the event), line, failed }
async function judgeAfter(o, event, root = null) {
  let prev = null, at = null;
  const r = await runLife({
    mode: '256', clock: 'grid', clockSeed: o.seed, feedAll: true, stopAtDissolve: false, sceneSeconds: 30, root, ...o,
    grab: (k, screen, app, f, meter) => {
      const st = app.getState();
      if (prev && at === null && EVENTS[event].seen(st, prev)) at = k;
      if (at !== null && k === at + Math.floor(AFTERMATH * o.fps)) meter.forgetWorst();
      prev = st;
    },
  });
  assert.notEqual(at, null, `the ${event} happened (${JSON.stringify(o.keys)})`);
  return { rep: r.rep, at, line: line(r.rep), failed: bad(r.rep) };
}

// ---- `i` in the middle of a dissolve (30 to 32 s and 60 to 62 s of the cycle): four sizes, three frame rates, three seeds
const SIZES = [[40, 10], [41, 11], [42, 12], [80, 24]];
const FPS = [9, 18, 30];
const SEEDS = [1, 6, 2];
const PRESS = [31, 62];
test('DRIFT-13 `i` in a dissolve: the five X1 rules hold on every read more than 0.25 s after the flip (40x10 41x11 42x12 80x24, fps 9 18 30, seeds 1 6 2, presses at 31 s and 62 s, grid, 256 colours)', async () => {
  let runs = 0, worstL2 = 0, worstL3 = 0;
  for (const [cols, rows] of SIZES) for (const fps of FPS) for (const seed of SEEDS) for (const at of PRESS) {
    const o = { cols, rows, fps, seed, keys: [{ at, key: 'i' }], seconds: at + 4 };
    const j = await judgeAfter(o, 'flip');
    runs++;
    worstL2 = Math.max(worstL2, nums(j.rep).l2); worstL3 = Math.max(worstL3, nums(j.rep).l3);
    assert.deepEqual(j.failed, [], `${cols}x${rows} fps ${fps} seed ${seed} i at ${at} s: ${j.line}`);
  }
  console.log(`DRIFT-13 flip: ${runs} runs of \`i\` in a dissolve, judged from 0.25 s after the flip: worst L2 ${worstL2.toFixed(2)} %, worst L3 ${worstL3.toFixed(2)} %`);
});

// ---- the way back from another mode and from the console, on the busiest scene
const BACK = { cols: 40, rows: 10, fps: 18, seed: 1, scene: 'tunnel', startScene: 1, sceneSeconds: 1000, seconds: 13 };
const MODE_TRIP = { ...BACK, keys: [{ at: 8, key: '1' }, { at: 8.4, key: '3' }] }; // calm for 0.4 s and back to high contrast (the jump keys; chaos and experimental are neither governed nor quiet)
const CONSOLE_TRIP = { ...BACK, keys: [{ at: 8, key: 'l' }, { at: 8.6, key: '\x1b' }] }; // the library and back
test('DRIFT-13 the way back from another mode and from the console: the five X1 rules hold on the reads more than 0.25 s after it (the tunnel at 40x10)', async () => {
  for (const [label, o, ev] of [['mode round trip', MODE_TRIP, 'mode'], ['console and back', CONSOLE_TRIP, 'console']]) {
    const j = await judgeAfter(o, ev);
    assert.deepEqual(j.failed, [], `${label}: ${j.line}`);
    console.log(`DRIFT-13 flip: ${label} at frame ${j.at}, judged from 0.25 s after it: ${j.line}`);
  }
});

// ---- control: with the history cleared on every reset (the code before the correction) the same `i` cases fail
const CONTROL = [[40, 10, 18, 1], [40, 10, 30, 1], [41, 11, 18, 1], [41, 11, 30, 1], [42, 12, 9, 6], [42, 12, 30, 6]]; // each over 25 % for 0.33 to 0.57 s after the flip on the cleared-history governor
test('DRIFT-13 control: the governor that forgets its history on every reset fails L2 more than 0.25 s after an `i` in a dissolve (six cases, i at 31 s); the shipped governor passes the same runs', async () => {
  const root = makeTree('new', HARD_RESET);
  try {
    const out = [];
    for (const [cols, rows, fps, seed] of CONTROL) {
      const o = { cols, rows, fps, seed, keys: [{ at: 31, key: 'i' }], seconds: 35 };
      const shipped = await judgeAfter(o, 'flip');
      assert.deepEqual(shipped.failed, [], `shipped passes ${cols}x${rows} fps ${fps} seed ${seed}: ${shipped.line}`);
      const mut = await judgeAfter(o, 'flip', root);
      assert.ok(mut.failed.includes('l2.x1'), `the cleared-history governor fails L2 at ${cols}x${rows} fps ${fps} seed ${seed}: ${mut.line}`);
      out.push(`${cols}x${rows} fps ${fps} seed ${seed}: history cleared ${mut.line} FAILS ${mut.failed.join(' ')} / shipped ${shipped.line}`);
    }
    // the way back from another mode, on the tunnel: the history of the 0.4 s before it is what holds L2 (the console trip is not told apart: the library takes longer than a second to come back)
    const tripShipped = await judgeAfter(MODE_TRIP, 'mode'), tripMut = await judgeAfter(MODE_TRIP, 'mode', root);
    assert.deepEqual(tripShipped.failed, [], tripShipped.line);
    assert.ok(tripMut.failed.includes('l2.x1'), `the cleared-history governor fails L2 on the mode round trip: ${tripMut.line}`);
    out.push(`mode round trip 40x10 tunnel: history cleared ${tripMut.line} FAILS ${tripMut.failed.join(' ')} / shipped ${tripShipped.line}`);
    console.log(`CONTROL mutant governor reset clears the history, i in a dissolve at 31 s and a mode round trip, judged from 0.25 s after the event:\n  ${out.join('\n  ')}`);
    // the mutation target is real: the same tree edit matching nothing throws
    assert.throws(() => makeTree('new', { 'src/governor.js': (t) => must(t, 'no such text', 'x') }), /exactly once/);
  } finally { rmTree(root); }
});
