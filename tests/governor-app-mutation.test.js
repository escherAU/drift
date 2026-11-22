// DRIFT-13 phase 2: must-fail controls for the WIRED flash governor, in the style of tests/life-flash-controls.test.js. Each mutant is a temporary copy of src/ with ONE line of the wiring or of
// the governor's limits changed (a mutation that matches nothing throws: tests/helpers-life-app.js makeTree), run through the real app on cases that pass on the shipped tree, and each must FAIL
// (the five rules at their limits, or the whole-paint behaviour for the resets), so the passes in tests/governor-app.test.js and tests/governor-sweep.test.js are shown to come from the
// wiring and the limits and not from the scenes alone. A passing control prints its numbers only after the assertion that it fails has passed.
//   wiring removed            the governor's one line in app.js taken out (BEFORE13_EDITS): every case Desmond found fails again (tests/governor-app.test.js runs them all; three here)
//   time from t               the governor handed the scene clock t instead of `wall`: identical at 1x (t = wall), fails at 2x and 4x where t runs faster than the viewer's eye
//   per-read cap off          STEP_CAP = every cell: the 41x12 q156 --fps 9 case at 2x reads L3 over 30 %
//   per-cell limit off        W = 0: the 42x12 cases read L2 over 25 % again
//   built with fps 18         the app's --fps not handed to the governor: its read window is wrong at --fps 9 (L3 over 30 %)
//   governor before the help  the panel drawn onto the governor's output (the panel is painted whole): a Classic help panel at 40x10 changes more than 30 % of the screen in one read (L3)
//   not reset on a repaint    repaintAll without the governor reset: coming back to high contrast from another mode, the first paint is governed against a screen from seconds ago (522 of
//                             1920 cells held). The flip of `i` is the same either way: it swaps the palette, not the indices the governor works on, so it needs no reset (asserted both ways)
//   not resized               a size change that does not reach the governor: the governor refuses the frame and the app exits with an error
// Two resets of the wiring are defence in depth and are shown to be that: the reset in renderCard and the one on every console frame are covered by the repaintAll that the resize and the
// console's own leaveToClassic already make, so taking either out changes nothing the app can show (asserted below as such, not as a mutant that fails).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLife, nums, makeTree, rmTree } from './helpers-life-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { cycle, DESMOND, withSpyTree } from './helpers-governor-app.js';
import { startCard } from './helpers-size-card.js';

const line = (rep) => { const n = nums(rep); return `L1 ${n.l1.toFixed(2)} L2 ${n.l2.toFixed(2)} L3 ${n.l3.toFixed(2)} R ${n.r.toFixed(2)} C ${n.c.toFixed(2)}`; };
const bad = (rep) => failedRules(rep, { only: X1_RULE_IDS });
// line endings normalised: a git archive export on Windows carries CRLF and some targets span lines
const must = (text, from, to) => { const lf = text.replace(/\r\n/g, '\n'); assert.equal(lf.split(from).length, 2, `the mutation target occurs exactly once: ${from}`); return lf.replace(from, to); };
const D = (id) => { const d = DESMOND.find((x) => x.id.startsWith(id)); assert.ok(d, id); return d; };

const A1 = D('42x12 grid 1x --fps 26 seed 6'), A2 = D('42x12 grid 1x --fps 27'), A3 = D('45x12 q156 4x'), A4 = D('41x12 q156 2x');

const MUT = {
  noWiring: { 'src/app.js': (t) => must(t, "const painted = shown.mode === 'contrast' ? govern(f) : f;", 'const painted = f;') },
  timeFromT: { 'src/app.js': (t) => must(t, 'gov.govern(f.glyphs, f.shades, wall)', 'gov.govern(f.glyphs, f.shades, t)') },
  noReadCap: { 'src/governor.js': (t) => must(t, 'STEP_CAP = n > 0 ? Math.max(1, exactCap(n, STEP_LIMIT)) : 0;', 'STEP_CAP = n;') },
  noCellLimit: { 'src/governor.js': (t) => must(t, 'const W = Math.max(1, win1 / fps);', 'const W = 0;') },
  fps18: { 'src/app.js': (t) => must(t, "createGovernor({ cols, rows, fps, variant: 'nbhd' })", "createGovernor({ cols, rows, fps: 18, variant: 'nbhd' })") },
  beforeHelp: {
    'src/app.js': (t) => must(must(t,
      '    const pal = paletteNow();\n    if (helpOpen) {\n      drawHelp(f.glyphs, f.shades, cols, rows, {',
      "    const pal = paletteNow();\n    const gpre = shown.mode === 'contrast' ? govern(f) : f;\n    if (helpOpen) {\n      drawHelp(gpre.glyphs, gpre.shades, cols, rows, {"),
    "const painted = shown.mode === 'contrast' ? govern(f) : f;", 'const painted = gpre;'),
  },
  noFlipReset: { 'src/app.js': (t) => must(t, 'function repaintAll() { renderer.invalidate(); govReset(); }', 'function repaintAll() { renderer.invalidate(); }') },
  noResize: { 'src/app.js': (t) => must(t, 'else if (govCols !== cols || govRows !== rows) { gov.resize(cols, rows); govCols = cols; govRows = rows; }', '') },
  noCardReset: { 'src/app.js': (t) => must(t, '    govReset(); // the card is something else on the terminal: the next art frame is a whole repaint\n', '') },
  noConsoleReset: { 'src/app.js': (t) => must(t, '    shellPal = f.palette;\n    govReset();\n', '    shellPal = f.palette;\n') },
};

// ---- the rule mutants: Desmond's cases on a mutated copy
async function fails(label, edits, cases) {
  const root = makeTree('new', edits);
  try {
    const out = [];
    for (const d of cases) {
      const r = await cycle(d, { root });
      assert.equal(r.frames, Math.round(170 * d.fps), 'the whole cycle was metered');
      out.push({ d, b: bad(r.rep), nums: line(r.rep) });
    }
    return out;
  } finally { rmTree(root); }
}
const report = (label, out) => console.log(`CONTROL mutant ${label}: ${out.map((o) => `${o.d.id} ${o.nums}${o.b.length ? ' FAILS ' + o.b.join(' ') : ' passes'}`).join('; ')}`);

test('DRIFT-13 control: the governor taken out of the app: Desmond\'s cases fail again (the same readings as tests/governor-app.test.js)', async () => {
  const out = await fails('no wiring', MUT.noWiring, [A1, A2, A3, A4]);
  for (const o of out) assert.ok(o.b.length > 0, `${o.d.id}: fails (${o.nums})`);
  report('wiring removed', out);
});

test('DRIFT-13 control: the governor on the scene clock t instead of the real time: passes at 1x (t = wall) and fails at 4x and 2x, where the scene clock runs faster than the eye', async () => {
  const out = await fails('time from t', MUT.timeFromT, [A1, A3, A4]);
  assert.deepEqual(out[0].b, [], `1x: the same as the shipped governor (${out[0].nums})`);
  assert.ok(out[1].b.includes('l2.x1'), `4x: L2 fails (${out[1].nums})`);
  assert.ok(out[2].b.includes('l3'), `2x: L3 fails (${out[2].nums})`);
  report('time from t', out);
});

test('DRIFT-13 control: the per-read cap taken out (STEP_CAP = every cell): the 41x12 q156 --fps 9 case at 2x reads L3 over 30 %; the per-cell cases still pass (the cap is the only thing holding L3 there)', async () => {
  const out = await fails('no read cap', MUT.noReadCap, [A4, A1, A3]);
  assert.ok(out[0].b.includes('l3'), `L3 fails (${out[0].nums})`);
  assert.deepEqual(out[1].b, [], out[1].nums);
  assert.deepEqual(out[2].b, [], out[2].nums);
  report('per-read cap off', out);
});

test('DRIFT-13 control: the per-cell limit taken out (W = 0): the L2 cases of Desmond read over 25 % again (and the per-read case passes: the per-cell limit is what holds L2)', async () => {
  const out = await fails('no cell limit', MUT.noCellLimit, [A1, A2, A3, DESMOND.find((x) => x.id.startsWith('40x10 grid 1x --fps 30'))]);
  assert.ok(out[0].b.includes('l2.x1') && out[1].b.includes('l2.x1') && out[2].b.includes('l2.x1'), out.map((o) => o.nums).join(' | '));
  report('per-cell limit off', out);
});

test('DRIFT-13 control: the app\'s --fps not handed to the governor (built with 18): the --fps 9 case reads L3 over 30 %, the --fps 26 and 21 cases pass (the rate matters where one read catches several paints)', async () => {
  const out = await fails('fps 18', MUT.fps18, [A4, A1, A3]);
  assert.ok(out[0].b.includes('l3'), `--fps 9: L3 fails (${out[0].nums})`);
  assert.deepEqual(out[1].b, [], out[1].nums);
  assert.deepEqual(out[2].b, [], out[2].nums);
  report('fps hard-coded 18', out);
});

// ---- the help panel: the governor must come AFTER it
const HELP = { cols: 40, rows: 10, fps: 18, seed: 1, mode: '256', clock: 'grid', startScene: 1, scene: 'tunnel', sceneSeconds: 1000, seconds: 20, feedAll: true, stopAtDissolve: false, keys: [{ at: 8, key: 'h' }, { at: 12, key: 'h' }] };
test('DRIFT-13 control: the help panel drawn after the governor instead of before it (the panel is painted whole): a Classic help panel at 40x10 fails L3; the shipped order passes', async () => {
  const shipped = await runLife(HELP);
  assert.deepEqual(bad(shipped.rep), [], `the shipped order passes (${line(shipped.rep)})`);
  const root = makeTree('new', MUT.beforeHelp);
  try {
    const r = await runLife({ ...HELP, root });
    assert.ok(bad(r.rep).includes('l3'), `the panel painted whole fails L3 (${line(r.rep)})`);
    console.log(`CONTROL mutant governor before the help panel, 40x10 tunnel, help opened at 8 s and closed at 12 s: ${line(r.rep)} FAILS ${bad(r.rep).join(' ')}; shipped ${line(shipped.rep)}`);
  } finally { rmTree(root); }
  const old = makeTree('new', MUT.noWiring);
  try {
    const r = await runLife({ ...HELP, root: old });
    assert.ok(bad(r.rep).includes('l3'), `and so does the app before the governor, which painted the panel whole (${line(r.rep)})`);
    console.log(`CONTROL before the governor, same help case: ${line(r.rep)} FAILS ${bad(r.rep).join(' ')}`);
  } finally { rmTree(old); }
});

// ---- the resets and the resize
test('DRIFT-13 control: no governor reset on a repaint-all: coming back to high contrast from another mode paints a screen the governor remembers from seconds ago, so cells are held; the flip of i is the same either way', async () => {
  const run = async (edits, plan) => withSpyTree(async (root, g13) => {
    let first = null, light = false, afterFlip = null, away = false;
    g13.spy = (f, g) => {
      let d = 0;
      for (let i = 0; i < f.glyphs.length; i++) if (g.glyphs[i] !== f.glyphs[i]) d++;
      if (away && first === null) first = d;
      const now = g13.app.getState().light;
      if (now !== light) { light = now; afterFlip = d; }
    };
    const h = await startCard({ cols: 80, rows: 24, startMode: 'contrast', startScene: 1, cmode: '256', clock: 'grid', root, sceneSeconds: 1000 });
    g13.app = h.app;
    try {
      h.advance(7.2);
      if (plan === 'flip') { h.key('i'); h.advance(1); } else { for (let i = 0; i < 3; i++) { h.key('m'); h.advance(2.1); } away = true; h.key('m'); h.advance(1); }
      return plan === 'flip' ? afterFlip : first;
    } finally { h.close(); }
  }, { edits });
  assert.equal(await run({}, 'mode'), 0, 'shipped: the first paint back in high contrast is whole');
  const held = await run(MUT.noFlipReset, 'mode');
  assert.ok(held > 0, `without the reset the first paint back in high contrast holds ${held} cells`);
  // the flip changes the palette, not the indices: the governor needs no reset for it, and holds nothing either way (the README says so)
  assert.equal(await run({}, 'flip'), 0);
  assert.equal(await run(MUT.noFlipReset, 'flip'), 0);
  console.log(`CONTROL mutant no reset on repaintAll: the first paint back in high contrast from another mode holds ${held} cells of 1920 (shipped: 0); the first paint after i holds 0 either way`);
});

test('DRIFT-13 control: a size change that does not reach the governor: the governor refuses the frame (wrong length) and the app exits with an error; shipped it carries on', async () => {
  const run = async (edits) => withSpyTree(async (root, g13) => {
    const h = await startCard({ cols: 80, rows: 24, startMode: 'contrast', startScene: 1, cmode: '256', clock: 'grid', root, sceneSeconds: 1000 });
    g13.app = h.app;
    try { h.advance(3); h.resize(90, 30); h.advance(1); return { exits: h.proc.exits.slice(), running: h.app.getState().running }; } finally { h.close(); }
  }, { edits });
  const ok = await run({});
  assert.deepEqual(ok.exits, []);
  assert.equal(ok.running, true);
  const broken = await run(MUT.noResize);
  assert.ok(broken.exits.length > 0 && broken.running === false, `the app exited (${JSON.stringify(broken)})`);
  console.log(`CONTROL mutant no governor resize: the app exits ${JSON.stringify(broken.exits)} on the first resize (shipped carries on)`);
});

test('DRIFT-13 finding: the governor reset in renderCard and the one on every console frame are defence in depth: taking either out changes nothing the app can show (the repaint-all that the resize and leaveToClassic make already resets)', async () => {
  for (const [label, edits] of [['no card reset', MUT.noCardReset], ['no console reset', MUT.noConsoleReset]]) {
    const run = async (e) => withSpyTree(async (root, g13) => {
      const recs = [];
      g13.spy = (f, g, gov) => { let d = 0; for (let i = 0; i < f.glyphs.length; i++) if (g.glyphs[i] !== f.glyphs[i]) d++; recs.push(d + ':' + gov.stats.ungoverned); };
      const h = await startCard({ cols: 80, rows: 24, startMode: 'contrast', startScene: 1, cmode: '256', clock: 'grid', root, sceneSeconds: 1000 });
      g13.app = h.app;
      try { h.advance(5.3); h.resize(39, 9); h.advance(2); h.resize(80, 24); h.advance(2); return { recs, text: h.text() }; } finally { h.close(); }
    }, { edits: e });
    const a = await run({}), b = await run(edits);
    assert.deepEqual(b.recs, a.recs, `${label}: the same paints (held cells and resets) as shipped`);
    assert.equal(b.text, a.text, `${label}: the same screen`);
  }
});

test('DRIFT-13 control: every mutation above matches exactly once, and one that matches nothing throws', () => {
  for (const [name, edits] of Object.entries(MUT)) rmTree(makeTree('new', edits));
  assert.throws(() => makeTree('new', { 'src/governor.js': (t) => t }), /changed nothing/);
  assert.throws(() => must('x', 'y', 'z'), /exactly once/);
});
