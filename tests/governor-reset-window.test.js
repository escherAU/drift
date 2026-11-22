// DRIFT-13 correction 3: the reset paint of the governor does not use up the per-read cap of the paint after it.
// The defect of correction 1: the soft / other reset paint stamped tw[i] = now on every cell it counted. tw is the per-READ window (cells changed inside the last 1 / fps seconds); a cell
// stamped there counts as "already changed in this window" and is never held, so a paint within 1 / fps of the reset paint was uncapped. Desmond Hale pressed `i` and then `h` (the help panel)
// one frame later on the jitter clock: 5 of 108 runs read L3 33.85 to 49.00 % from the read AFTER the flip (the old hard reset read 25.00 in all of them).
// The fix: the reset paint stamps the per-cell history (t1 t2 t3: the L2 rule) as before and leaves tw alone, as the hard reset always did.
//
// HOW IT IS JUDGED: the read that caught the flip frame is the flip guard's (every cell changes at once: README); meter.forgetWorst() is called at the first frame whose screen differs from
// the one before it in more than 60 % of its cells, so the series judged is every read AFTER the flip read, and rule L3 must read 25 % or less on all of them (the governor's own cap).
// The control is the shipped tree with the stamp put back (a copy of src/, so nothing in the tree is touched): the same runs must fail it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLife, makeTree, rmTree } from './helpers-life-app.js';

const must = (text, from, to) => { const lf = text.replace(/\r\n/g, '\n'); assert.equal(lf.split(from).length, 2, `the mutation target occurs exactly once: ${from}`); return lf.replace(from, to); };
const STAMP_BACK = { 'src/governor.js': (t) => must(t, '        c++;', '        tw[i] = now; c++;') };
const CAP = 0.25;

// `i`, then `h` one frame later; judged on the reads after the flip read. Returns { l3 (worst fraction), at (the frame of the flip read), after (seconds from it to the worst read) }
async function iThenHelp({ cols, rows, fps, seed, press, root = null }) {
  let pf = null, at = null;
  const r = await runLife({
    cols, rows, fps, seed, clock: 'jitter', clockSeed: seed, mode: '256', feedAll: true, stopAtDissolve: false, sceneSeconds: 30, seconds: press + 3, root,
    keys: [{ at: press, key: 'i' }, { at: press + 1 / fps, key: 'h' }],
    grab: (k, screen, app, f, meter) => {
      if (at === null && pf) {
        let d = 0;
        for (let j = 0; j < f.bg.length; j++) if (f.bg[j] !== pf.bg[j] || f.fg[j] !== pf.fg[j]) d++;
        if (d > 0.6 * f.bg.length) { at = k; meter.forgetWorst(); }
      }
      pf = { bg: f.bg.slice(), fg: f.fg.slice() };
    },
  });
  assert.notEqual(at, null, `the flip read was found (${cols}x${rows} fps ${fps} seed ${seed} i at ${press})`);
  return { l3: r.rep.l3.worstFraction, at, after: r.rep.l3.details.timeS - at / fps };
}

// 3 sizes at 9 fps (where the defect shows: one frame is 0.111 s) x seeds 1 and 2 x presses at 31 s (a dissolve) and 45 s, and 18 and 30 fps at the two small sizes
const CASES = [];
for (const [cols, rows] of [[40, 10], [41, 11], [80, 24]]) for (const seed of [1, 2]) for (const press of [31, 45]) CASES.push({ cols, rows, fps: 9, seed, press });
for (const [cols, rows] of [[40, 10], [41, 11]]) for (const fps of [18, 30]) CASES.push({ cols, rows, fps, seed: 1, press: 31 });
// the cases the stamped tree failed when the defect was found (Desmond's 5 of 108, plus two more of these runs)
const DEFECT = [[40, 10, 9, 1, 31], [40, 10, 9, 2, 45], [41, 11, 9, 1, 31], [41, 11, 9, 2, 45], [80, 24, 9, 2, 45]].map(([cols, rows, fps, seed, press]) => ({ cols, rows, fps, seed, press }));

test(`DRIFT-13 reset window: \`i\` then \`h\` one frame later (jitter clock): L3 is ${CAP * 100} % or less on every read after the flip read (${CASES.length} runs: 40x10, 41x11, 80x24 at 9 fps, 40x10 and 41x11 at 18 and 30 fps, seeds 1 and 2)`, async () => {
  let worst = 0;
  for (const c of CASES) {
    const r = await iThenHelp(c);
    worst = Math.max(worst, r.l3);
    assert.ok(r.l3 <= CAP + 1e-9, `${c.cols}x${c.rows} fps ${c.fps} seed ${c.seed} i at ${c.press}: L3 ${(r.l3 * 100).toFixed(2)} % at +${r.after.toFixed(3)} s after the flip read`);
  }
  console.log(`DRIFT-13 reset window: ${CASES.length} runs of i then h one frame later, judged after the flip read: worst L3 ${(worst * 100).toFixed(2)} %`);
});

test('DRIFT-13 reset window control: with the reset paint stamping the per-read window again (the code before this correction) the same runs read L3 over 25 % after the flip read; the shipped tree reads 25 % or less on them', async () => {
  const root = makeTree('new', STAMP_BACK);
  try {
    const out = [];
    for (const c of DEFECT) {
      const shipped = await iThenHelp(c), mut = await iThenHelp({ ...c, root });
      assert.ok(shipped.l3 <= CAP + 1e-9, `shipped ${c.cols}x${c.rows} seed ${c.seed}: ${(shipped.l3 * 100).toFixed(2)} %`);
      assert.ok(mut.l3 > CAP + 1e-9, `the stamped tree fails L3 at ${c.cols}x${c.rows} fps ${c.fps} seed ${c.seed} i at ${c.press}: ${(mut.l3 * 100).toFixed(2)} %`);
      out.push(`${c.cols}x${c.rows} fps ${c.fps} seed ${c.seed} i@${c.press}: stamped ${(mut.l3 * 100).toFixed(2)} % at +${mut.after.toFixed(3)} s / shipped ${(shipped.l3 * 100).toFixed(2)} %`);
    }
    console.log(`CONTROL mutant reset paint stamps the per-read window:\n  ${out.join('\n  ')}`);
    assert.throws(() => makeTree('new', { 'src/governor.js': (t) => must(t, 'no such text', 'x') }), /exactly once/);
  } finally { rmTree(root); }
});
