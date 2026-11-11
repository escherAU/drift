// The clock and the grid maths of Sundown Grid. Pure numbers, no drawing.
//
// Everything that moves in the scene moves on a 15 Hz tick, counted from the scene's own start: a picture is a pure function of
// the tick, so it repeats exactly. A tick is 1/15 s, a little longer than a frame at 18 fps, so a frame never spans two ticks and
// the number of things that change in a frame can be counted and capped.
//
//   horizontals   one every 0.8 s = 12 ticks. Each one follows the same path, a table of rows by tick (lineTable); the one that is
//                 q ticks old is at row table[q], and the lines in flight are 12 ticks apart on that path.
//   slides        the sun's gaps slide down a half-row every 15 ticks (1 s), on tick 1 of the second.
//   sinks         the sun steps down a row every 225 ticks (15 s) for 60 s and back up for 60 s: 1800 ticks, 120 s, one loop.
//   sways         every 600 ticks (40 s) the left palm sways at 10 s and the right at 30 s, for 22 ticks: a sway every 20 s.
//
// A slide, a sink and a moving horizontal each change a share of the picture; capsOf keeps their sum under budget on every tick: taken
// mod 12 (a horizontal's period) the slides fall on ticks 1, 4, 7 and 10, the sinks on 0, 3, 6 and 9, a new horizontal arrives on 0.
export const TICK_HZ = 15;
export const LINE_TICKS = 12;
export const SLIDE_TICKS = 15;
export const SLIDE_AT = 1;
export const SINK_TICKS = 225;
export const SINK_MAX = 4;
export const LOOP_TICKS = 1800;
export const SWAY_CYCLE = 600;
export const SWAY_TICKS = 22;

export const tickOf = (T) => Math.floor(T * TICK_HZ + 1e-6);

// How many half-row slides have happened by tick m.
export const slideOf = (m) => Math.floor((m + SLIDE_TICKS - SLIDE_AT) / SLIDE_TICKS);

// Rows the sun has sunk by tick m: 0 1 2 3 4 over the first 60 s, then 4 3 2 1 0 over the next 60 s.
export function sinkOf(m) {
  const c = Math.floor(m / SINK_TICKS) % 8;
  return c <= SINK_MAX ? c : 8 - c;
}

// -1 for no sway, 0 while the left palm's frond is out, 1 while the right palm's is.
export function swayOf(m) {
  const p = m % SWAY_CYCLE;
  if (p >= 150 && p < 150 + SWAY_TICKS) return 0;
  if (p >= 450 && p < 450 + SWAY_TICKS) return 1;
  return -1;
}

// A gap in the sun at e half-rows above the horizon (the bottom half of the row on the horizon is 0), after `slides` slides. Gaps are
// a period of 6 half-rows long and widen toward the horizon: a thickness of 1 half-row where they start (G half-rows up) to 4 at G - 12
// and below. A gap at half-row e slides to e - 1 with each slide, so the bands appear to sink.
export const GAP_PERIOD = 6;
export function gapThickness(e, G) {
  const t = Math.ceil((G - e) / 4);
  return t < 0 ? 0 : t > 4 ? 4 : t;
}
export function gapAt(e, slides, G) {
  const th = gapThickness(e, G);
  if (th === 0) return false;
  const phase = (((5 - e - slides) % GAP_PERIOD) + GAP_PERIOD) % GAP_PERIOD;
  return phase < th;
}

// ---- the horizontals

// The most horizontals that may change row on each tick of a horizontal's 12-tick period, for a window w x h whose sun costs
// `slideCells` cells to slide and `sinkCells` to step down. A moving line costs 2 * w cells (its old row and its new one), a new
// line arriving as the nearest leaves the same again; no picture may change more than BUDGET of its cells. Never more than two.
export const BUDGET = 0.115;
export function capsOf(w, h, slideCells, sinkCells) {
  const caps = [];
  for (let r = 0; r < LINE_TICKS; r++) {
    const busy = (r % 3 === 1 ? slideCells : r % 3 === 0 ? sinkCells : 0) + (r === 0 ? 2 * w : 0);
    // the new line arriving on tick 0 counts as one of the two that may move
    caps.push(Math.max(0, Math.min(r === 0 ? 1 : 2, Math.floor((BUDGET * w * h - busy) / (2 * w)))));
  }
  return caps;
}

const tables = new Map();

// The path of a horizontal: the row under the horizon (1 to `below`) it is on, q ticks after it appears, for q = 0 .. n * 12 - 1. It
// starts one row under the horizon and covers more ground the nearer it gets (a band of 12 ticks travels in proportion to 3, 4, 5 ...),
// and ends on the bottom row. The row steps are spread over the ticks `caps` allows (caps[r] steps on ticks r, r + 12, r + 24 ... in all):
// each step goes to the allowed tick nearest the moment the smooth path reaches it (but no more than 12 ticks after the last, so two
// lines never share a row), so a line moves a row (or two) at a time and the lines in flight, 12 ticks apart on the path, never
// move more than caps[r] together on tick r.
export function lineTable(below, n, caps) {
  const key = below + '|' + n + '|' + caps.join('');
  let t = tables.get(key);
  if (t) return t;
  const K = LINE_TICKS, N = n * K, last = N - 1, Tt = below - 1;
  const cum = [0];
  for (let j = 0; j < n; j++) cum.push(cum[j] + j + 3);
  const target = (q) => {
    const j = Math.min(n - 1, Math.floor(q / K));
    const q0 = j * K, q1 = j + 1 === n ? last : (j + 1) * K;
    const f = q1 > q0 ? (q - q0) / (q1 - q0) : 0;
    return 1 + (Tt * (cum[j] + f * (cum[j + 1] - cum[j]))) / cum[n];
  };
  // slots left on each residue among the ticks after q, if the first `taken` of each were used
  const room = (q, used) => {
    let sum = 0;
    for (let r = 0; r < K; r++) {
      let positions = 0;
      for (let x = q + 1; x <= last; x++) if (x % K === r) positions++;
      sum += Math.min(caps[r] - used[r], positions);
    }
    return sum;
  };
  const used = new Array(K).fill(0);
  let capacity = room(0, used);
  const M = Math.min(Tt, capacity);
  const steps = [];
  let prev = 0;
  for (let m = 1; m <= M; m++) {
    const goal = 1 + ((m - 0.5) * Tt) / M;
    let qStar = last;
    for (let q = 1; q <= last; q++) if (target(q) >= goal) { qStar = q; break; }
    let best = -1, bestD = Infinity;
    // never more than K ticks without a step (two lines K ticks apart would sit on one row), and enough ticks left to keep that up
    for (let q = prev + 1; q <= Math.min(last, prev + K); q++) {
      const r = q % K;
      if (used[r] >= caps[r]) continue;
      if (q + (M - m) * K < last - K + 1) continue;
      const d = Math.abs(q - qStar);
      if (d >= bestD) { if (q > qStar) break; continue; }
      used[r]++;
      const ok = room(q, used) >= M - m;
      used[r]--;
      if (ok) { best = q; bestD = d; }
    }
    if (best < 0) break;
    used[best % K]++;
    steps.push(best);
    prev = best;
  }
  t = new Array(N).fill(1);
  const done = steps.length;
  for (let i = 0, q = 0; q < N; q++) {
    while (i < done && steps[i] <= q) i++;
    t[q] = done ? 1 + Math.round((i * Tt) / done) : 1;
  }
  tables.set(key, t);
  return t;
}
