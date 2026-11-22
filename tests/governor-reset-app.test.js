// DRIFT-13 correction 2: the console path of the governor's resets, through the real app. The app resets the governor in three places (src/app.js): repaintAll({ hard: true }) on every resize event,
// govReset({ other: true }) on every console frame, and repaintAll() when the console is left. Before this correction a resize event inside the console (hard), then one console frame (other),
// left a stale soft flag that outlived the first art paint, so the SECOND art paint after the console was whole and ungoverned as well. It shows when the resize event does not change the
// size the governor was built for (a window dragged out and back while the console is open, or a terminal that reports the same size twice): a changed size is cleared by the governor's own
// resize in govern(), which the first run below pins as the case that never failed.
//   rules asserted per art paint after the console: the first is whole and the one ungoverned paint (stats.ungoverned +1, nothing examined); the second is governed (it examines every cell,
//   stats.ungoverned unchanged), as is every later one; cells held or changed are read from the painted frame against the composed one.
// The control: the same run on a copy of src/ with the old ordering put back (tests/helpers-governor-reset.js) must show the second art paint ungoverned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withSpyTree } from './helpers-governor-app.js';
import { startCard } from './helpers-size-card.js';
import { INSTALL_DIR } from '../src/cartridge/loader.js';
import { OLD_ORDERING } from './helpers-governor-reset.js';

const must = (text, from, to) => { const lf = text.replace(/\r\n/g, '\n'); assert.equal(lf.split(from).length, 2, `the mutation target occurs exactly once: ${from}`); return lf.replace(from, to); };
const OLD = { 'src/governor.js': (t) => OLD_ORDERING.reduce((acc, [from, to]) => must(acc, from, to), t) };

// resizes: the resize events sent while the console is open
async function run(edits, resizes) {
  return withSpyTree(async (root, g13) => {
    const recs = [];
    let phase = 'art';
    g13.spy = (f, g, gov) => {
      let held = 0;
      for (let i = 0; i < f.glyphs.length; i++) if (g.glyphs[i] !== f.glyphs[i] || g.shades[i] !== f.shades[i]) held++;
      recs.push({ phase, ungoverned: gov.stats.ungoverned, examined: gov.stats.last.examined, held, n: f.glyphs.length });
    };
    const h = await startCard({ cols: 80, rows: 24, startMode: 'contrast', startScene: 1, cmode: '256', clock: 'grid', root, sceneSeconds: 1000, dirs: [{ dir: INSTALL_DIR, trusted: true }] });
    g13.app = h.app;
    try {
      h.advance(7.2);
      h.key('l'); h.advance(0.4);
      assert.notEqual(h.app.getState().shell, null, 'the console is open');
      for (const [c, r] of resizes) { h.resize(c, r); h.advance(0.3); } // a resize event is a hard reset; the next console frame asks for an other reset
      h.advance(0.3);
      phase = 'after'; recs.length = 0;
      h.key('\x1b'); h.advance(0.8);
      assert.equal(h.app.getState().shell, null, 'back in Classic');
      return recs.filter((r) => r.phase === 'after');
    } finally { h.close(); }
  }, { edits });
}
const SAME = [[90, 30], [80, 24]]; // out and back: the governor is never told of a new size
const SAME_EVENT = [[80, 24]]; // a resize event that reports the same size
const CHANGED = [[90, 30]]; // a new size: the governor's own resize clears everything

for (const [label, resizes] of [['a window dragged out and back', SAME], ['the same size reported again', SAME_EVENT]]) {
  test(`DRIFT-13 console path: ${label} while the console is open: the first art paint is whole and ungoverned, the second is governed`, async () => {
    const recs = await run({}, resizes);
    assert.ok(recs.length >= 6, `art paints after the console: ${recs.length}`);
    const base = recs[0].ungoverned;
    assert.equal(recs[0].examined, 0, 'the first art paint is the whole repaint: nothing examined (ungoverned)');
    assert.equal(recs[0].held, 0, 'and nothing is held');
    assert.equal(recs[1].examined, recs[1].n, 'the second art paint is governed: every cell examined');
    assert.equal(recs[1].ungoverned, base, 'and the ungoverned count did not move for it');
    for (const r of recs.slice(1)) assert.equal(r.ungoverned, base, 'no later paint is ungoverned');
    console.log(`DRIFT-13 console path (${label}): art paints after the console ${recs.slice(0, 3).map((r) => `examined ${r.examined} held ${r.held} ungoverned ${r.ungoverned}`).join(' | ')}`);
  });
}
test('DRIFT-13 console path: a resize to a NEW size while the console is open was never affected (the governor\'s own resize clears its state): the same two paints', async () => {
  const recs = await run({}, CHANGED);
  assert.equal(recs[0].examined, 0);
  assert.equal(recs[1].examined, recs[1].n);
  assert.equal(recs[1].ungoverned, recs[0].ungoverned);
});
test('DRIFT-13 console path control: the old ordering (a pending hard paint lets a later request through) makes the SECOND art paint whole and ungoverned too', async () => {
  for (const resizes of [SAME, SAME_EVENT]) {
    const recs = await run(OLD, resizes);
    assert.equal(recs[0].examined, 0, 'the first art paint is whole');
    assert.equal(recs[1].examined, 0, 'the old ordering: the second is whole as well (the stale soft flag)');
    assert.equal(recs[1].ungoverned, recs[0].ungoverned + 1, 'one more ungoverned paint than the one the resets are owed');
    console.log(`CONTROL mutant old reset ordering, console resize ${JSON.stringify(resizes)}: art paints ${recs.slice(0, 3).map((r) => `examined ${r.examined} ungoverned ${r.ungoverned}`).join(' | ')}`);
  }
});
test('DRIFT-13 console path control: the old-ordering mutation matches exactly once per edit, and one that matches nothing throws', () => {
  assert.throws(() => must('x', 'y', 'z'), /exactly once/);
});
