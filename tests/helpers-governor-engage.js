// DRIFT-13 correction 1: counted engagement of the governor per scene, for tests/governor-engage.test.js (the same measure as tools/governor-wired.mjs, cut down to what a guard needs).
// One whole 170 s Classic high contrast cycle on the real app (a spy tree reports every governed paint); per label (a scene, or "dis:<scene it fades from>"):
//   paints, paints with any held cell, cells the composer changed (composed frame against the composed frame before it), cells held (composed frame against what was painted).
// Counted, never timed: no clock reads, no meter. The whole cycle runs in well under a second at the small sizes.
import { runSpied, CYCLE_SECONDS } from './helpers-governor-app.js';

export async function engagement({ cols, rows, fps, seed = 1, clock = 'grid', edits = {} }) {
  const n = cols * rows, labels = new Map();
  let prevF = null, last = 'life';
  const rec = (l) => { let r = labels.get(l); if (!r) { r = { paints: 0, heldPaints: 0, changed: 0, held: 0 }; labels.set(l, r); } return r; };
  await runSpied({ cols, rows, fps, seed, clock, clockSeed: seed, mode: '256', keys: [], sceneSeconds: 30, seconds: CYCLE_SECONDS, feedAll: true, stopAtDissolve: false, meter: false }, {
    edits,
    onPaint: (f, g, gov, wall, app) => {
      const st = app.getState();
      if (!st.fading) last = st.sceneId;
      const r = rec(st.fading ? 'dis:' + last : st.sceneId);
      r.paints++;
      let held = 0;
      for (let i = 0; i < n; i++) {
        if (prevF && f.glyphs[i] !== prevF[i]) r.changed++;
        if (g.glyphs[i] !== f.glyphs[i] || g.shades[i] !== f.shades[i]) held++;
      }
      if (held > 0) r.heldPaints++;
      r.held += held;
      prevF = f.glyphs.slice();
    },
  });
  return labels;
}
