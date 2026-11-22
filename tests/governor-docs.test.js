// DRIFT-13 phase 3: the README's governor section is pinned the way DRIFT-12's was. Every number in it is either (a) a constant of the code, derived here (the cap, the cost counts, the sample's
// size, the full-factorial arithmetic), (b) a number of tests/fixtures/governor-sweeps.json, the committed record of the reviewer's sweeps (tools/contrast-matrix.mjs and tools/governor-wired.mjs
// are not part of `npm test`, so their results are kept in this file and the README is checked against it), or (c) a number another test asserts (the help panel's paints: governor-app; the render
// hash: render-hash). The README may not claim more than the fixture says: the claims about the full cross are checked to be about the lines drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { READ_CAP, STEP_LIMIT, createGovernor } from '../src/governor.js';
import { SAMPLE, SWEEP_SIZES, SWEEP_FPS, SWEEP_SPEEDS, DESMOND } from './helpers-governor-app.js';
import { fullFactorial, parseSizes, parseInts, parseSpeeds } from './helpers-contrast-matrix.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const README = read('../README.md');
const FIX = JSON.parse(read('./fixtures/governor-sweeps.json'));
const flat = (t) => t.replace(/\n\s*(\/\/)?\s*/g, ' ');
const R = flat(README);
const fmt = (n) => n.toLocaleString('en-US');
const SECTION_HEAD = '**Classic high contrast: the flash governor (DRIFT-13).';
const sectionOf = (t) => { const a = t.indexOf(SECTION_HEAD); assert.ok(a >= 0, 'the README has the governor section'); return t.slice(a, t.indexOf('**Still not covered after DRIFT-13:**', a) + 4000); };
const S = sectionOf(R);

test('DRIFT-13 README: what the governor limits, the neighbourhood arithmetic, by construction against measured, and the cap (25 % = READ_CAP, under the meter\'s 30 %)', () => {
  assert.equal(READ_CAP, 0.25);
  assert.equal(STEP_LIMIT, 0.30);
  for (const need of [
    '`src/governor.js` sits between what the scenes and the dissolves compose', 'REAL time', 'never a third picture', 'No meter and no limit was changed',
    'A cell may not change a third time within one second', 'No more than 25 % of the cells may change inside one read', '`READ_CAP`, five points under L3\'s limit of 30 %',
    'The shipped variant is `nbhd`', '2 x 2 neighbourhood of blocks', '14 of the 56 cells of a field at 40x10 to 42x12', 'A hot cell is always a triple cell', 'at most 2K hot pixels',
    '**What is covered by construction and what is not.**', 'R holds because the two-tone palette has no saturated red', 'The x4 views of L1 and L2', 'are not governed and not asserted',
    'The `i` key swaps the palette', 'the guard bounds how often a flip happens', 'governed like any other change, with no exemption',
    'whole after 1 paint at 80x24 and 3 at 40x10', '12 paints (0.67 s) at 80x24, 11 (0.61 s) at 40x10 and 10 (0.56 s) at 120x40', 'after 2 and 4 paints at 80x24 and 40x10 when the clock was paused first',
    '**Why the cap is 25 % and not 30 %.**',
  ]) assert.ok(S.includes(need), `the README says: ${need}`);
});

test('DRIFT-13 README: the help panel paint counts are the ones governor-app pins', () => {
  const t = read('./governor-app.test.js');
  for (const [k, v] of [['80x24 life --fps 18', 1], ['40x10 life --fps 18', 3], ['80x24 tunnel --fps 18', 12], ['40x10 tunnel --fps 18', 11], ['120x40 tunnel --fps 18', 10], ['61x21 tunnel --fps 12', 8], ['80x24 tunnel (paused first) --fps 18', 2], ['40x10 tunnel (paused first) --fps 18', 4]]) {
    assert.ok(t.includes(`'${k}': ${v}`), `governor-app pins ${k}: ${v} paints`);
  }
});

test('DRIFT-13 README: the per-frame cost numbers are counted by governor-cost and the code (40,000 examined, a cap of 10,000, 4,097 buckets a sort, three sorts)', () => {
  const g = createGovernor({ cols: 400, rows: 100, fps: 18 });
  assert.equal(g.limits.stepCap, 10000);
  const src = read('../src/governor.js');
  assert.match(src, /BUCKET_BITS = 12, BUCKETS = 1 << BUCKET_BITS/);
  assert.match(src, /hist = new Int32Array\(BUCKETS \+ 1\)/);
  const cost = read('./governor-cost.test.js');
  assert.ok(cost.includes('N = COLS * ROWS') && cost.includes('x.sorts * 4097') && cost.includes("max(r.per, 'sorts') <= 3"));
  assert.equal(400 * 100, 40000);
  assert.equal(3 * 4097, 12291);
  for (const need of ['(40,000 cells)', '40,000 examined', '(10,000 cells, 25 %)', '4,097 histogram buckets', 'at most three sorts a paint (12,291 buckets)', 'Informational only']) assert.ok(S.includes(need), `the README says: ${need}`);
});

test('DRIFT-13 README: the asserted sample is the governor-sweep sample (87 cases, its sizes, rates and speeds)', () => {
  assert.equal(SAMPLE.length, 87);
  assert.equal(DESMOND.length, 12);
  assert.equal(SWEEP_SIZES.length, 17);
  for (const need of ['`governor-sweep` (87 whole-cycle runs', ...SWEEP_SIZES.map(([c, r]) => `${c}x${r}`), `(${SWEEP_FPS.join(', ')})`, `(${SWEEP_SPEEDS.map((s) => `${s}x`).join(', ').replace(/, ([^,]*)$/, ', $1')})`, '9 of the 87 fail on the tree before the governor']) {
    assert.ok(S.includes(need), `the README says: ${need}`);
  }
});

test('DRIFT-13 README: the full-cross arithmetic is the tool\'s (447,120 lines; 425,040 on the 77 sizes) and the matrix tool is described by what it does', () => {
  const FULL = { sizes: parseSizes('40-50x10-16,breakpoints'), fps: parseInts('8-30'), speeds: parseSpeeds('1x,1.5x,2x,3x,4x'), clocks: ['grid', 'q156', 'jitter'], modes: ['256', 'truecolor'], seeds: parseInts('1-8') };
  assert.equal(fullFactorial(FULL), 447120);
  assert.equal(fullFactorial({ ...FULL, sizes: parseSizes('40-50x10-16') }), 425040);
  assert.equal(FIX.factorial.full, 447120);
  assert.equal(FIX.factorial.sizes77, 425040);
  for (const need of [
    '81 sizes x 23 rates x 5 speeds x 3 clocks x 2 modes x 8 seeds = 447,120 lines (425,040 on the 77 sizes 40x10 to 50x16 alone)', 'so it was not run, and none of the claims below is about the whole cross',
    '`node tools/contrast-matrix.mjs`', '`--sample N` draws a seeded, stratified sample', '`--jobs K`', '`--resume`', 'always the FULL-FACTORIAL count of the axes given next to the lines actually run',
    '`before13` (this tree with only the governor taken out)', '`oldscenes` (the governor on but the scene fixes of DRIFT-10 to 12 taken out)',
  ]) assert.ok(S.includes(need), `the README says: ${need}`);
});

// the rows of the README's tables are the fixture's numbers, formatted the way the README prints them
const sweepRow = (k, tree) => {
  const s = FIX.sweeps[k][tree];
  if (!s) return null;
  const w = s.worst;
  return `| ${k} | ${tree} | ${fmt(s.lines)} of ${fmt(FIX.sweeps[k].full)} | ${s.failing} | ${w.l1.toFixed(2)} | ${w.l2.toFixed(2)} | ${w.l3.toFixed(2)} | ${w.r.toFixed(2)} | ${w.c.toFixed(2)} | ${s.nearLimit.l3} |`;
};
test('DRIFT-13 README: every sweep row (lines run of the full factorial, lines failing, the worst of each rule, L3 within 1 point of 30 %) is the committed fixture\'s, and the shipped tree fails nowhere', () => {
  let rows = 0;
  for (const k of Object.keys(FIX.sweeps)) for (const tree of ['after', 'before13', 'oldscenes', 'cap030']) {
    const r = sweepRow(k, tree);
    if (!r) continue;
    rows++;
    assert.ok(S.includes(r), `the README has the row: ${r}`);
    const s = FIX.sweeps[k][tree];
    assert.ok(s.lines <= FIX.sweeps[k].full, `${k} ${tree}: no more lines run than the full factorial`);
    assert.equal(s.errored, 0, `${k} ${tree}: no run errored`);
    if (tree === 'after') {
      assert.equal(s.failing, 0, `${k}: the shipped tree fails nowhere`);
      assert.ok(s.worst.l3 <= 25, `${k}: L3 never above the governor's own 25 % cap`);
    }
  }
  assert.ok(rows >= 10, `rows checked: ${rows}`);
  // the sample sizes the README states are the draws it ran
  assert.equal(FIX.sweeps.B.drawn, 1242);
  assert.equal(FIX.sweeps.B.drawn, 207 * 6);
  assert.equal(FIX.sweeps.D.drawn, 9315);
  assert.equal(FIX.sweeps.D.drawn, 1863 * 5);
  assert.equal(FIX.sweeps.A8.full, 77 * 8 * 2 * 8);
  assert.equal(FIX.sweeps.A.full, 77 * 8 * 2 * 2);
  for (const need of ['1,242 (`--sample 1242`', '9,315 (`--sample 9315 --sample-seed 2`', 'every one of the 207 (size, rate) pairs six times', 'every one of the 1,863 (size, rate) pairs five times']) assert.ok(S.includes(need), `the README says: ${need}`);
});

test('DRIFT-13 README: the before tree fails where Desmond said and the shipped tree does not: every row of the case table is the fixture\'s', () => {
  assert.equal(FIX.desmond.length, 11);
  let failingBefore = 0;
  for (const d of FIX.desmond) {
    const r = `| ${d.combo} | ${d.before13.failing} of ${d.before13.lines}, ${d.before13.l2.toFixed(2)} / ${d.before13.l3.toFixed(2)} | ${d.after.failing} of ${d.after.lines}, ${d.after.l2.toFixed(2)} / ${d.after.l3.toFixed(2)} |`;
    assert.ok(S.includes(r), `the README has the row: ${r}`);
    assert.equal(d.after.failing, 0);
    assert.equal(d.after.lines, 16);
    failingBefore += d.before13.failing;
  }
  assert.equal(failingBefore, 16, 'sixteen failing lines on the tree before the governor (eight combinations x two seeds)');
  assert.equal(FIX.sweeps.C.before13.failing, 16);
  assert.equal(FIX.sweeps.C.after.failing, 0);
  assert.equal(FIX.sweeps.C.after.lines, 176);
});

test('DRIFT-13 README: the engagement table is the wired tool\'s measurement (the fixture), scene by scene', () => {
  assert.equal(FIX.wired.length, 10);
  for (const w of FIX.wired) {
    const r = `| ${w.scene} | ${w.paints} | ${w.heldPaints} | ${w.heldPer100} | ${w.waitPaints} | ${w.waitSeconds} | ${w.deviation} |`;
    assert.ok(S.includes(r), `the README has the row: ${r}`);
  }
  assert.equal(FIX.wired.find((w) => w.scene === 'blocktype').heldPaints, '0.00 %');
});

test('DRIFT-13 README: the render hash note names the four 41x11 cases that moved and the fixture agrees (396 cases, the regenerated total)', () => {
  const rh = JSON.parse(read('./fixtures/render-hash.json'));
  assert.equal(rh.count, 396);
  assert.ok(rh.total.startsWith('25dd4e3e'));
  for (const c of ['app/contrast/41x11/256', 'app/contrast/41x11/truecolor', 'app/contrast-inverted/41x11/256', 'app/contrast-inverted/41x11/truecolor']) assert.ok(rh.cases.some((x) => x.name === c), c);
  for (const need of ['`render-hash` moved on four cases', 'Classic high contrast at 41x11 (contrast and contrast-inverted, 256 colours and truecolor)', 'one cell is held for one paint at paint 18 of the 10 s run', 'the other 392 of its 396 cases are byte for byte as before DRIFT-13']) assert.ok(S.includes(need), `the README says: ${need}`);
});

test('DRIFT-13 README: the finding (the per-scene fixes are redundant for pass or fail, they stay) and what is still not covered are written down, and the DRIFT-12 "measured by hand, not asserted" sentences are gone', () => {
  for (const need of ['**A finding: the per-scene fixes of DRIFT-10 to 12 are now redundant for pass or fail of the five rules, and they stay.**', 'Nothing was removed.', '**Still not covered after DRIFT-13:**', 'seeds above 8', 'boards below 40x10 (the size card)', 'frame rates outside 8 to 30', 'the x4 views of L1 and L2', 'every (size, rate, speed, clock, mode, seed) cell of the cross that was not drawn']) {
    assert.ok(S.includes(need), `the README says: ${need}`);
  }
  for (const gone of ['**measured by hand, not asserted**', 'The follow-up is DRIFT-13', '(DRIFT-13 is the follow-up)', '(4) failures of the whole cycle at the small sizes']) assert.ok(!R.includes(gone), `the README no longer says: ${gone}`);
  assert.ok(R.includes('(4) is gone: the failures of the whole cycle at the small sizes that Desmond Hale'));
  // control: the check notices a README without the section
  assert.throws(() => sectionOf(flat(README.replace(SECTION_HEAD, '**x'))), /the README has the governor section/);
});

test('DRIFT-13 README: why the cap is 25 %: the tunnel alone at q156, --fps 10, 1x, seeds 1 to 8 reads L3 23.73 / 24.50 % with no governor, 29.71 / 29.50 % at a 30 % cap (recorded) and 24.61 / 24.75 % at the shipped 25 % (re-run here)', () => {
  const c = FIX.capTunnel;
  for (const need of ['23.73 %', '24.50 %', '29.71 %', '29.50 %', '24.61 %', '24.75 %', '(commit 6784b33)', 'one cell from the limit', 'It costs nothing at 12 fps and up']) assert.ok(S.includes(need), `the README says: ${need}`);
  assert.equal(c.cap25['41x11'], 24.61);
  const tool = fileURLToPath(new URL('../tools/life-matrix.mjs', import.meta.url));
  const o = ['--scene', 'tunnel', '--clocks', 'q156', '--modes', '256', '--speeds', '1x', '--sizes', '41x11,40x10', '--fps', '10', '--seeds', '1,2,3,4,5,6,7,8', '--summary-only'];
  const l3s = (r) => r.stdout.trim().split(/\r?\n/).map((l) => Number(/L3 +([\d.]+)/.exec(l)[1]));
  const now = spawnSync(process.execPath, [tool, ...o], { encoding: 'utf8' });
  assert.equal(now.status, 0, now.stdout + now.stderr);
  assert.deepEqual(l3s(now), [c.cap25['41x11'], c.cap25['40x10']], 'the shipped tree: the 25 % cap');
  const none = spawnSync(process.execPath, [tool, '--tree', 'before13', ...o], { encoding: 'utf8' });
  assert.deepEqual(l3s(none), [c.noGovernor['41x11'], c.noGovernor['40x10']], 'no governor');
  assert.ok(c.cap30['41x11'] > 29.5 && c.cap30['41x11'] < 30, 'at a 30 % cap the governor sat one cell under the limit (recorded: sweeps are on commit 6784b33)');
});

test('DRIFT-13 README: the 30 % cap tree never came within 1 point of 30 % in the whole-cycle sweeps A and B (27.76 % and 27.64 %), and the shipped tree reads at most 25.00 % L3 everywhere', () => {
  assert.equal(FIX.sweeps.A.cap030.worst.l3, 27.76);
  assert.equal(FIX.sweeps.B.cap030.worst.l3, 27.64);
  assert.equal(FIX.sweeps.A.cap030.nearLimit.l3 + FIX.sweeps.B.cap030.nearLimit.l3, 0);
  for (const k of ['A', 'A8', 'B', 'C', 'D', 'E']) assert.ok(FIX.sweeps[k].after.worst.l3 <= 25, `${k}: the shipped tree's worst L3 is at most the 25 % cap`);
  assert.ok(S.includes('worst L3 27.76 % and 27.64 %, no line within 1 point of 30 %'));
  // the old scenes under the governor alone sit ON the limit: 25.00 on L1 and L2, and most of sweep A within a point of it
  for (const k of ['A', 'B']) {
    const o = FIX.sweeps[k].oldscenes;
    assert.equal(o.failing, 0);
    assert.equal(o.worst.l2, 25);
    assert.ok(o.nearLimit.l2 > o.lines / 2 - 1, `${k}: more than half the lines read within 1 point of L2's limit`);
    assert.equal(FIX.sweeps[k].after.nearLimit.l2, 0);
  }
});

// ---- DRIFT-13 correction 1: what the README says about the `i` key, the resets, fg and bg, and what is not covered
test('DRIFT-13 README: the governor does reset on `i` and keeps its history; the flip frame and the 0.25 s after it are the flip guard\'s; the resize-type reset starts the history again; a window drag and rgb scenes are named', () => {
  for (const need of [
    'the app does reset the governor when it flips: the reset KEEPS the governor\'s history', 'counts the flip as one change of every cell',
    'the way back from another mode and from the console are reset the same way',
    'L2 failed for 0.3 to 0.57 s afterwards (48 of 240 of Desmond\'s runs, worst 33.93 %; `governor-flip` has the control)',
    'The flip FRAME itself is the flip guard\'s and is not covered', 'L3 reads about 95 % at it in every run', '`governor-flip` judges the reads more than 0.25 s after the flip',
    'The first paint after a size change (a terminal resize, the size card) is ungoverned and starts the history again',
    'a window dragged to a new size does that on every resize event (an ungoverned whole repaint each) and is NOT covered',
    'fg and bg pass through the governor ungoverned', '`rgb: true`', '`governor-playlist` fails the day one does',
    '`governor-flip` (an `i` in the middle of a dissolve, 72 runs', '`governor-engage` (counted engagement per scene at three sizes and three rates', '`governor-playlist` (no high contrast scene has `rgb: true`)',
    'the `i` key\'s own flip frame and the second after it (the flip guard; measured 0.37 s at the worst, bound under 1 s), the second after the way back from another mode or the console (the trip\'s own tail, measured above); a window dragged to a new size',
    'they count TWO changes of every cell, out and back', 'with one change 59 of 64 of Desmond\'s mode-trip runs failed L2 from 0.25 s after the return, with two 27 of 64', 'The reset paint is not counted in the per-read window', 'read L3 33.85 to 49.00 % on the read after the flip in 5 of 108 of Desmond\'s runs', '`governor-reset-window`',
    'The mechanism bound is under 1 s; 0.37 s is what the runs measured, not the bound', 'the latest over-limit read 0.70 s after the return', '6 over 25 % judged from 0.25 s, worst 30.36 %', 'high contrast scenes with full-colour cells (there are none)',
  ]) assert.ok(S.includes(need) || R.includes(need), `the README says: ${need}`);
  assert.ok(!R.includes('so the governor has no part in it'), 'the old sentence (the governor has no part in `i`) is gone');
  assert.ok(!S.includes("the `i` key's own flip (the flip guard);"), 'and the old not-covered item');
});

test('DRIFT-13 README: the flip aftermath numbers are the committed series\' (tools/governor-flip-series.mjs, tests/fixtures/governor-flip-series.json), and the guard files exist', () => {
  const F = JSON.parse(read('./fixtures/governor-flip-series.json'));
  assert.equal(F.shipped.runs, F.shipped.perRun[0].runs + F.shipped.perRun[1].runs);
  assert.equal(F.shipped.runsWithOverLimitRead, F.shipped.perRun[0].over + F.shipped.perRun[1].over);
  assert.equal(F.shipped.latestOverLimitReadSeconds, Math.max(F.shipped.perRun[0].latest, F.shipped.perRun[1].latest));
  assert.ok(S.includes(`in ${F.shipped.runs} runs the latest over-limit read was ${F.shipped.latestOverLimitReadSeconds.toFixed(2)} s after the flip, and ${F.shipped.runsWithOverLimitRead} of the ${F.shipped.runs} runs had one at all`));
  assert.ok(F.shipped.latestOverLimitReadSeconds < 0.25, 'the window the test judges from (0.25 s) is later than the latest shipped over-limit read');
  assert.ok(F.extended.latestOverLimitReadSeconds > 0.25, 'the wider series found a read over the window: the README must (and does) say the window is not a bound');
  assert.ok(S.includes(`on ${F.extended.runs} more runs it never saw`) && S.includes(`${F.extended.runsWithOverLimitRead} runs had an over-limit read after the flip and the latest was ${F.extended.latestOverLimitReadSeconds.toFixed(2)} s after it`), 'the README quotes the wider series');
  assert.ok(F.historyCleared.latestOverLimitReadSeconds > 0.25 && F.historyCleared.runsWithOverLimitRead > 10, 'and the governor that forgets its history is over the limit after it, in many runs');
  const E = JSON.parse(read('./fixtures/governor-engagement.json'));
  assert.equal(Object.keys(E.configs).length, 9, 'the engagement baseline is 3 sizes x 3 rates');
  for (const f of ['../tools/governor-flip-series.mjs', './governor-flip.test.js', './governor-engage.test.js', './governor-playlist.test.js']) assert.ok(fs.existsSync(new URL(f, import.meta.url)), `${f} exists`);
});

test('DRIFT-14 README: the hold after a return is the measured one (7 to 14 % on average and up to 38 % in the first second after a trip of 1 s or more, up to 2.9 % at 1.5 to 3 s; the table per trip length; ceilings pinned in governor-leave-app; the scratch script is outside the repo)', () => {
  for (const need of [
    '**The hold after a return (DRIFT-14):**', 'the moment high contrast was left (the first paint of anything else, in real time', '`leave()` in `src/governor.js`', 'not at the return',
    'After a trip of 1 s or more the leave has aged out and the return counts ONE change', 'holds back 7 to 14 % of the screen on average and up to 38 % at the most',
    'DRIFT-13 held 28 to 30 % on average and up to 59 %', 'from 1.5 to 3 s after it up to 2.9 % is still held (6.8 % at DRIFT-13)', 'it is not a whole-screen freeze', 'a run with no trip holds nothing',
    'a 0.3 s trip 15 to 19 % on average and up to 42 %', 'a 0.15 s trip 19 to 21 % and up to 45 %',
    '0.15 s 19 to 21 and 45 and 2.8 %; 0.3 s 15 to 19 and 42 and 1.8 %; 1 s 7 to 14 and 36 and 2.4 %; 3 s 7 to 14 and 38 and 2.9 %; 10 s 7 to 14 and 36 and 2.6 %',
    '`hold.mjs`, a scratch script outside the repo that no test runs', '`governor-leave-app` pins ceilings above those numbers', 'a trip of 1 s or more: mean 18 %, max 45 %, 4.0 % at 1.5 to 3 s; a shorter one: 23 %, 47 %, 3.2 %',
    '`governor-leave` pins the stamp in the governor', 'a return with no recorded leave behaves as DRIFT-13 did', 'a hard reset or a resize forgets the leave',
  ]) assert.ok(S.includes(need), `the README says: ${need}`);
  assert.ok(S.indexOf('**The hold after a return (DRIFT-14):**') > S.indexOf('and a 0.6 s trip passes.'), 'it sits next to the trip tail');
  for (const gone of ['holds back 27 to 29 % of the screen', 'a follow-up ticket will record the leaving change', 'by `freeze2.mjs`']) assert.ok(!S.includes(gone), `the DRIFT-13 sentence is gone: ${gone}`);
  // the ceilings the README quotes are the ones the test enforces
  const T = read('./governor-leave-app.test.js');
  assert.ok(T.includes('const LONG = { mean: 18, max: 45, max23: 4.0 }, SHORT = { mean: 23, max: 47, max23: 3.2 };'), 'the ceilings in governor-leave-app are the ones the README quotes');
});
