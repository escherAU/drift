// The clock and the grid maths of Sundown Grid. Pure numbers, no drawing.
//
// Everything that moves in the scene moves on a 15 Hz tick, counted from the scene's own start: a picture is a pure function of
// the tick, so it repeats exactly. A tick is 1/15 s, a little longer than a frame at 18 fps, so at 1x a frame spans at most one tick;
// at 4x (4/18 s a frame) it spans three or four. The number of things that change in a frame can therefore be counted and capped, for
// one tick and for four in a row: see the budget below.
//
//   horizontals   one every 0.8 s = 12 ticks. Each one follows the same path, a table of rows by tick (lineTable); the one that is
//                 q ticks old is at row table[q], and the lines in flight are 12 ticks apart on that path.
//   slides        the sun's gaps slide down a half-row every 15 ticks (1 s), on tick 1 of the second.
//   sinks         the sun steps down a row every 225 ticks (15 s) for 60 s and back up for 60 s: 1800 ticks, 120 s, one loop.
//   sways         every 600 ticks (40 s) the left palm sways at 10 s and the right at 30 s, for 22 ticks: a sway every 20 s.
//
// A slide, a sink and a moving horizontal each change a share of the picture; planOf keeps their sum under budget on every tick and on
// every four in a row: taken mod 12 (a horizontal's period) the slides fall on ticks 1, 4, 7 and 10, the sinks on 0, 3, 6 and 9, a new
// horizontal arrives on 0. The slide is always on tick 1 of its second and the sink on tick 0 of its 15 s (the scene promises both), so
// the horizontals' steps are what the plan places.
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

// ---- the budget
//
// A frame at 1x spans at most one tick, but the console can step the clock 2x or 4x a frame: 4/18 s is 3.33 ticks, so a 4x frame holds
// the changes of up to four ticks together. The scene is a pure function of time, with no memory of the last frame, so the calm has to
// be in the schedule: no single tick may change more than BUDGET of the cells, and no four ticks in a row more than BUDGET_WINDOW
// (the dissolve into or out of the scene adds about 11% on top at 4x, and the photosensitivity rule is 30%).
export const BUDGET = 0.115;
export const BUDGET_WINDOW = 0.17;
export const WINDOW_TICKS = 4;
// A window too small to hold the steps that keep the horizontals apart (every step costs 2 / h of the picture, so the short windows have
// the most to pay) gets the least budget that does, raised by this much at a time.
const RAISE = 0.005;
// What the plan keeps back from each budget: the palms' sway, and the sum of the changes being a little more than their union.
const MARGIN = 0.002;

// What changes on each tick of the 1800-tick loop apart from the horizontals' steps: whatever the sun changes (sunCells[m], the slides
// and the sinks; the scene counts them) and the arrival of a new horizontal as the nearest leaves (2 * w cells). The worst of each,
// over the loop, for a tick that is r mod 12 (one tick) and for the four ticks that start on one (the steps are a function of the tick
// mod 12, so only these matter).
function eventPeaks(w, sunCells) {
  const e = new Float64Array(LOOP_TICKS);
  for (let m = 0; m < LOOP_TICKS; m++) e[m] = sunCells[m] + (m % LINE_TICKS === 0 ? 2 * w : 0);
  const one = new Array(LINE_TICKS).fill(0), four = new Array(LINE_TICKS).fill(0);
  for (let m = 0; m < LOOP_TICKS; m++) {
    let sum = 0;
    for (let i = 0; i < WINDOW_TICKS; i++) sum += e[(m + i) % LOOP_TICKS];
    one[m % LINE_TICKS] = Math.max(one[m % LINE_TICKS], e[m]);
    four[m % LINE_TICKS] = Math.max(four[m % LINE_TICKS], sum);
  }
  return { one, four };
}

// The worst four ticks, in cells, when caps[r] horizontals step on every tick that is r mod 12 (a step costs 2 * w cells: its old row
// and its new one), and the worst single tick.
function worstOf(peaks, caps, w) {
  let one = 0, four = 0;
  for (let r = 0; r < LINE_TICKS; r++) {
    let n = 0;
    for (let i = 0; i < WINDOW_TICKS; i++) n += caps[(r + i) % LINE_TICKS];
    one = Math.max(one, peaks.one[r] + 2 * w * caps[r]);
    four = Math.max(four, peaks.four[r] + 2 * w * n);
  }
  return { one, four };
}

// At every tick the n horizontals are on n different rows, nearest last.
function apart(table, n) {
  for (let k = 0; k < LINE_TICKS; k++) for (let j = 1; j < n; j++) if (table[j * LINE_TICKS + k] <= table[(j - 1) * LINE_TICKS + k]) return false;
  return true;
}

// The most horizontals that may step on each tick of a horizontal's 12-tick period (caps[r] for ticks r mod 12), for a window w x h
// whose sun changes sunCells[m] cells on tick m of the loop, with n horizontals on the `below` rows under the horizon.
// Every set of caps that keeps one tick under BUDGET and four ticks under a window budget (no more than two on a tick, one on the tick
// a new horizontal arrives) is tried, the most steps first (more steps, smaller jumps, no more than there are rows to cover), and the
// first that lets the horizontals keep apart (lineTable) is used. The window budget starts at BUDGET_WINDOW and goes up by RAISE until
// one does: a big window never needs more, a small one is as calm as its pictures allow. `level` is the window budget it took (above 1
// when one tick had to be let over BUDGET too, Infinity when nothing keeps the horizontals apart): a plan over BUDGET_WINDOW is a
// window with too many horizontals for its rows.
const planMemo = new Map();
export const capsOf = (w, h, sunCells, below, n) => planOf(w, h, sunCells, below, n).caps;
export function planOf(w, h, sunCells, below, n) {
  const key = [w, h, below, n, sunCells.join(',')].join('|');
  let plan = planMemo.get(key);
  if (plan) return plan;
  let found = null, level = Infinity;
  const peaks = eventPeaks(w, sunCells), cells = w * h, want = Math.max(0, below - 1);
  // first with one tick held to BUDGET, then (a window whose arrival alone is over it) with that raised as well
  for (let pass = 0; pass < 2 && !found; pass++) for (let budget = BUDGET_WINDOW; budget <= 1 && !found; budget += RAISE) {
    const one = (pass === 0 ? BUDGET : Math.max(BUDGET, budget - 0.055)) * cells, four = (budget - MARGIN) * cells;
    const list = [], caps = new Array(LINE_TICKS).fill(0);
    const rec = (r) => {
      if (r === LINE_TICKS) {
        const total = caps.reduce((a, v) => a + v, 0);
        if (total >= Math.max(1, n - 1) && total <= want) list.push({ caps: caps.slice(), total, worst: worstOf(peaks, caps, w).four });
        return;
      }
      for (let v = 0; v <= (r === 0 ? 1 : 2); v++) {
        caps[r] = v;
        const x = worstOf(peaks, caps, w);
        if (x.one > one || x.four > four) break;
        rec(r + 1);
      }
      caps[r] = 0;
    };
    rec(0);
    list.sort((a, b) => b.total - a.total || a.worst - b.worst);
    for (const c of list) if (apart(lineTable(below, n, c.caps), n)) { found = c.caps; level = pass + budget; break; }
  }
  // nothing keeps them apart (a window of a few rows): the plain spread, one step on every tick but the arrival's
  if (!found) found = new Array(LINE_TICKS).fill(0).map((v, r) => (r === 0 ? 0 : 1));
  plan = { caps: found, level };
  planMemo.set(key, plan);
  return plan;
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
  // the rows each step covers: one each, and the rest of the way shared out in growing portions (the nearer a step, the bigger), so a
  // line covers more ground the nearer it is even when there are few steps; sorted, so no step is smaller than the one before
  const jumps = new Array(done).fill(1);
  if (done) {
    let wsum = 0;
    for (let i = 0; i < done; i++) wsum += done + i;
    for (let i = 0, acc = 0, given = 0; i < done; i++) {
      acc += ((Tt - done) * (done + i)) / wsum;
      const upTo = Math.round(acc);
      jumps[i] += upTo - given;
      given = upTo;
    }
    jumps.sort((a, b) => a - b);
  }
  for (let i = 0, q = 0, row = 1; q < N; q++) {
    while (i < done && steps[i] <= q) row += jumps[i++];
    t[q] = row;
  }
  tables.set(key, t);
  return t;
}
