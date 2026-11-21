// DRIFT-11: the picture a scene SHOWS follows the picture it WANTS, under limits. Shared by the two Classic high contrast scenes that are pure functions of time
// (wire, blocktype) and were turned into sims for it; Life (src/scenes/life.js, DRIFT-10) has its own copy of the same idea on half-block pixels and is not touched.
//
// A scene that moves a line or a letter edge across the screen changes every cell it sweeps over, and a cell that changes three times in a second is what the in-house
// flash rule L2 calls hot (L1: seven). The scene computes its TARGET (the glyph it wants in every cell, `target`) and draws SHOWN, which follows the target:
//   gap     a cell may change on the screen at most once every `gap` steps (FLIP_GAP = 18 steps = 0.6 s), so no cell changes three times in any one second; a cell that wants
//           to change sooner waits, then takes whatever the target shows at that moment. gap 0 turns the limit off (blocktype: its target changes a cell at most twice in a
//           transition by construction, and a slab that lingers behind a moving edge would look wrong).
//   share   at most FLIP_SHARE of the cells change in one step (1/30 s),
//   frame   and at most FRAME_SHARE of the cells change between two PAINTED frames: the composer hands step() the number of steps a painted frame runs, n, and the frame's share is
//           split over them. Why 0.15, half of the 30 % that L3 allows: a late timer followed by one on time puts two paints between two reads of the viewer's 18 Hz grid, and two paints
//           of 15 % are 30 % (tests/life-frame-cap.test.js for Life's version of the same argument).
// Whatever the limits defer, a shown cell only ever takes a value the target had, so the shown picture changes a cell no more often than the target does.
export const FLIP_GAP = 18;
export const FLIP_SHARE = 0.08;
export const FRAME_SHARE = 0.15;

export function createFollow(w, h, gap = FLIP_GAP) {
  const n = w * h;
  return {
    w, h, gap, target: new Uint16Array(n).fill(32), shown: new Uint16Array(n).fill(32),
    lastFlip: new Int32Array(n).fill(-1e9), dirty: false, visits: 0, flips: 0,
  };
}

// Brings the shown picture up to the target. sub: the step number (a counter that rises by one a step). n: how many steps this painted frame runs.
// Visits every cell once per call, and only while something is waiting (f.dirty): f.visits counts the cells looked at.
export function follow(f, sub, n = 1) {
  if (!f.dirty) return;
  const { w, h, target, shown, lastFlip, gap } = f;
  let waiting = false, budget = Math.max(1, Math.floor(w * h * Math.min(FLIP_SHARE, FRAME_SHARE / Math.max(1, n))));
  for (let r = 0; r < h; r++) {
    const y = (r + sub) % h; // a different row first each step, so what has to wait is not always the bottom of the screen
    if (budget === 0) { waiting = true; break; }
    f.visits += w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (target[i] === shown[i]) continue;
      if (budget === 0 || sub - lastFlip[i] < gap) { waiting = true; continue; }
      budget--;
      lastFlip[i] = sub;
      shown[i] = target[i];
      f.flips++;
    }
  }
  f.dirty = waiting;
}
