// DRIFT-13: the flash governor for Classic high contrast. A pure, dependency-free module: it takes the frame the scenes and dissolves composed and returns what is actually
// PAINTED. A cell the governor holds keeps its old (glyph, shade) pair as a whole (never a new third colour, never half a change), and since the held cell still differs from the
// target it is tried again on the next paint (catch-up). The two-tone stays two-tone because the governor only ever copies pairs that were in an input frame, and it works on
// palette indices, so the `i` key (which swaps the palette, not the indices) needs nothing from it.
//
//   const gov = createGovernor({ cols, rows, fps, variant });
//   const painted = gov.govern(glyphs, shades, now);   // now: REAL time in seconds (the app's `wall`), never scene time
//   painted.glyphs, painted.shades                      // the same two buffers every call (reused; do not keep them across paints)
//   gov.reset(opts)                                     // the next paint is whole and not governed; the history is kept unless opts.hard (see RESET)
//   gov.resize(cols, rows)                              // a new size (also a reset)
//   gov.stats                                           // counters, see COST and OBSERVE
//
// WHY real time. The flash meter reads the screen on a grid of 1 / fps real seconds; the speed keys change the scene clock, not that grid. A governor that ran on scene time would
// let a cell change three times in a real second at 4x (the "scene time" mutant of tests/governor-mutation.test.js).
//
// THE TWO LIMITS, both by construction (the meter is tests/helpers-flash.js; the derivation below is pinned by tests/governor.test.js and tests/governor-adversarial.test.js).
//
// 1. PER CELL (rules L1, L2, C; R see below). The meter reads at k / fps and calls a cell hot (L2) when it has completed 3 transitions in the last win1 = max(1, round(fps)) reads.
//    A transition at read r needs the cell's content to differ between reads r - 1 and r, i.e. a paint that changed it in (s(r - 1), s(r)], s(r) = r / fps. Three transitions at reads
//    r1 < r2 < r3 inside the window (r3 - r1 <= win1 - 1) therefore imply three distinct paint changes p1 < p2 < p3 with p1 > (r1 - 1) / fps and p3 <= r3 / fps, so
//    p3 - p1 < (r3 - r1 + 1) / fps <= win1 / fps. Variant 'strict': a cell may change a third time only when its third-to-last change (the one three changes ago, counting this one)
//    is at least W = max(1, win1 / fps) seconds old; with W >= win1 / fps no three changes of one cell are ever less than win1 / fps apart, so no cell ever completes 3 transitions in
//    the window, so L2 is 0 (and L1, which needs 7). Every change of (glyph, shade) counts as one change: a conservative upper bound on the meter's transitions (a transition needs
//    a swing of 0.10 in luminance, a colour swing needs a change, a pixel transition needs a change of its cell), so the pixel grid and rule C are bounded by it too.
//    R (two red transitions in a second) needs a saturated red cell; the two-tone palette has none, and the governor never invents a colour, so R stays 0 there. It is not bounded by
//    this limit (two changes in a second are allowed): a palette with red would need its own care, and Classic high contrast has none.
//    The x4 views of L1 and L2 (the same frames played four times as fast) are NOT governed: no Classic arm asserts them (tests/helpers-flash.js, tools/life-matrix.mjs --x4).
//    Tolerance: a time is compared with EPS_T = 1e-9 s of slack in the direction that lets exactly-W (and exactly-one-read) through; the derivation's inequalities are strict, so a
//    difference of exactly W is safe, and 1 ns is the float noise of `now` arithmetic. Nothing real sits that close to a bound.
//
//    The relaxed variants. The strict rule engages on a meaningful share of ordinary frames (tools/governor-observe.mjs: the tunnel scene, the dissolves, life), because a scene may
//    change many cells three times in a second and still pass the meter, which fails a field only when more than 25 % of its cells are hot. So a cell MAY make that third change while
//    a budget of "triple" cells holds. A cell is TRIPLE at time T when its third-to-last change is less than W old; the meter's hot cells are a subset of the triple cells (hot at
//    read T means three changes inside the last win1 / fps seconds, derived above). The screen is tiled by BLOCKS of the meter's field size (fw x fh = ceil(cols / 3) x ceil(rows / 3);
//    ragged blocks at the right and bottom edges, at most 3 x 3 of them). The meter slides a field of that size over the screen, and it must fit inside it, so it overlaps at most
//    2 blocks across and 2 down: it lies inside one 2 x 2 NEIGHBOURHOOD of blocks (the neighbourhoods are the pairs of adjacent blocks in each direction; one block alone when there
//    is just one across or down).
//      variant 'blocks'  each block may hold at most BLOCK_CAP = floor(K / 4) triple cells, K = floor(0.25 * fw * fh) (the largest count the meter passes). A field overlaps 4 blocks, so
//                        it holds at most 4 * BLOCK_CAP <= K. (The 56-cell fields of 40x10 .. 42x12: K = 14, BLOCK_CAP = 3, 12 of 14.)
//      variant 'nbhd'    each 2 x 2 neighbourhood may hold at most K triple cells in all (14 of 56 there). A field lies inside one neighbourhood, so it holds at most K: the same
//                        guarantee with a budget that follows where the activity is instead of 6.25 % of every block.
//    Both give L2 (and L1) at most 25 % on the cell grid by construction. The pixel grid (two pixels per cell; its field is 2 * fh pixel rows tall and may start on an odd pixel row)
//    has at most 2 hot pixels per hot cell, and for a field that starts on an odd pixel row only one in each of the two cell rows it half covers; its hot pixels are therefore at
//    most the hot cells of the cell window of rows r0 .. r0 + fh - 1 plus those of rows r0 + 1 .. r0 + fh, each at most K, so at most 2 * K <= 25 % of the 2 * fw * fh pixels.
//
// 2. PER READ (rule L3). A read compares the screen with the read before it, 1 / fps earlier; it sees every paint in (T - 1 / fps, T], so the cells it can find changed are the UNION of
//    the cells changed by all paints inside a window of 1 / fps seconds (a read can catch two paints, or none). At most STEP_CAP = floor(0.25 * cols * rows) cells (READ_CAP: a margin of 5 points under the meter's
//    limit of 0.30, exact against the same count / n comparison, see exactCap) may be in that union; a cell that changed already inside the window costs nothing more, a new one costs one. The pixel grid cannot
//    exceed the cell fraction (every pixel that moves is a cell that changed, and there are two pixels per cell).
//    Below 4 cells (cap 0) the cap is held at 1 so a screen never freezes; L3 cannot be met by any change on such a screen (1 cell of 1 is 100 %), and Classic never runs there (40x10).
//
// WHICH CELLS WAIT. When more cells want to change than the limits allow, the ones that wait are chosen by a per-cell priority, an integer hash of (cell index, paint number): different
// cells lose each time, no band of the screen is starved (lowest-index-first would paint the top rows and freeze the bottom), and the same inputs always give the same output. The ones
// that were held retry with a fresh priority on the next paint. (A counting sort on 12 bits of the hash; cells of the same bucket keep index order.)
//
// RESET. The first paint after construction, reset() or resize() is not governed (a fresh screen: the renderer repaints it whole, as the app already treats it). Three kinds:
//   hard   construction, resize(), reset({ hard: true }): the paint is recorded as a change of every cell for the per-cell history, which starts again there (t2 and t3 forgotten), and the
//          per-read ring is cleared. A size change and the size card.
//   soft   reset(): the history (t1, t2, t3) and the per-read ring are KEPT. The paint is whole and ungoverned, and counts as ONE change (shifted into the history, stamped in the ring) of each
//          cell that differs from what was last painted, never a fresh change of every cell. Why keep it: a reset that forgot every cell's last changes let a cell change a third time inside W
//          just after it (an `i` in the middle of a dissolve failed L2 for 0.3 to 0.45 s; DRIFT-13 correction 1).
//   other  reset({ other: true }): soft, but every cell counts as changed: the palette was swapped (the `i` key; the meter reads colour, the governor reads indices) or the terminal showed
//          something else in between (another mode, the console), so the meter saw every cell move. The flip FRAME itself cannot be held by any governor (every cell changes luminance at once);
//          a cell with two changes just before it is hot at it, which is the flip guard's business, not the governor's.
//
// COST. One pass over the cells to find what wants to change, then work proportional to the cells that want to change (a 4096-bucket counting sort when something must be chosen);
// no allocation after the first paint (the buffers, the history and the scratch are made once, per size). Counters: stats.examined (cells looked at), stats.wanted, stats.changed,
// stats.held, each also for the last paint in stats.last.
//
// OBSERVE mode ({ observe: true }): holds nothing (the painted frame is always the target) and counts what the rules WOULD hold, for tools/governor-observe.mjs: stats.strictHeld
// (cells the strict per-cell rule would hold, whatever the variant), stats.blocksHeld (the cells the variant's relaxed budget would hold) and stats.readHeld (cells the per-read cap
// would hold). The counts are against the history of the UNgoverned frames, so they are what the rule would face on the frames the scenes make.

export const STEP_LIMIT = 0.30; // the meter's L3 limit (STEP_FRACTION in tests/helpers-flash.js)
export const READ_CAP = 0.25; // the governor's own per-read cap, 5 points under STEP_LIMIT so L3 never sits on the limit (DRIFT-13 phase 3: it costs nothing at 12 fps and up, and little below)
export const FIELD_LIMIT = 0.25; // the meter's field limit (FIELD_FRACTION)
export const EPS_T = 1e-9; // seconds, see "Tolerance" above
export const VARIANTS = ['strict', 'blocks', 'nbhd'];
const BUCKET_BITS = 12, BUCKETS = 1 << BUCKET_BITS;

// the largest count c with c / n <= frac as the meter compares it (its worstFraction is count / n and it passes when that is <= frac); floor(frac * n) can be one off in floats
export function exactCap(n, frac) {
  if (n <= 0) return 0;
  let c = Math.floor(frac * n);
  while ((c + 1) / n <= frac) c++;
  while (c > 0 && c / n > frac) c--;
  return c;
}

// the meter's own field (tests/helpers-flash.js fieldSize), repeated here: a third of the columns and rows, rounded up
export function fieldOf(cols, rows) {
  return { w: Math.max(1, Math.ceil(cols / 3)), h: Math.max(1, Math.ceil(rows / 3)) };
}

export function hash32(i, c) {
  let x = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(c + 1, 0x85ebca6b);
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12; x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return x >>> 0;
}

export function createGovernor({ cols, rows, fps, variant = 'strict', observe = false } = {}) {
  if (!(fps > 0)) throw new RangeError('createGovernor: fps must be positive');
  if (!VARIANTS.includes(variant)) throw new RangeError(`createGovernor: variant ${variant} (${VARIANTS.join(', ')})`);
  const win1 = Math.max(1, Math.round(fps)); // the meter's window, in reads
  const W = Math.max(1, win1 / fps); // seconds a cell must wait between its third-to-last change and a new one
  const READ_WINDOW = 1 / fps; // seconds: the paints one read can catch
  const relaxed = variant !== 'strict';

  let C = 0, R = 0, n = 0, STEP_CAP = 0, FW = 1, FH = 1, BX = 1, NB = 1, K = 0, CON_CAP = 0, NCON = 0;
  let first = true, soft = false, other = false, paintNo = 0, stamp = 0;
  let Gp = null, Sp = null, gType = null, sType = null;
  let t1, t2, t3, tw, blk, bcount, conB, blockCon, candE, candT, fresh, ord, maskStamp, noSlot, hist;
  const out = { glyphs: null, shades: null };
  const stats = {
    paints: 0, ungoverned: 0, resetChanged: 0, examined: 0, wanted: 0, changed: 0, held: 0, strictHeld: 0, blocksHeld: 0, readHeld: 0,
    last: { examined: 0, wanted: 0, changed: 0, held: 0 },
  };

  function resize(cols2, rows2) {
    C = Math.max(0, Math.floor(cols2)); R = Math.max(0, Math.floor(rows2)); n = C * R;
    STEP_CAP = n > 0 ? Math.max(1, exactCap(n, READ_CAP)) : 0;
    const f = fieldOf(C, R); FW = f.w; FH = f.h;
    const BY = Math.max(1, Math.ceil(R / FH)); BX = Math.max(1, Math.ceil(C / FW)); NB = BX * BY;
    K = exactCap(FW * FH, FIELD_LIMIT);
    // the constraints: one per block ('blocks', at most floor(K / 4) triple cells each) or one per 2 x 2 neighbourhood ('nbhd', at most K each); conB lists a constraint's blocks,
    // blockCon the constraints a block is in (up to 4 each, -1 ends the list)
    conB = null; blockCon = new Int32Array(NB * 4).fill(-1);
    if (variant === 'blocks') {
      CON_CAP = Math.floor(K / 4); NCON = NB;
      conB = new Int32Array(NCON * 4).fill(-1);
      for (let b = 0; b < NB; b++) { conB[b * 4] = b; blockCon[b * 4] = b; }
    } else {
      CON_CAP = K;
      const NX = Math.max(1, BX - 1), NY = Math.max(1, BY - 1);
      NCON = NX * NY;
      conB = new Int32Array(NCON * 4).fill(-1);
      const fill = new Int32Array(NB);
      for (let cy = 0; cy < NY; cy++) for (let cx = 0; cx < NX; cx++) {
        const c = cy * NX + cx;
        let m = 0;
        for (let by = cy; by <= Math.min(cy + 1, BY - 1); by++) for (let bx = cx; bx <= Math.min(cx + 1, BX - 1); bx++) {
          const b = by * BX + bx;
          conB[c * 4 + m++] = b;
          blockCon[b * 4 + fill[b]++] = c;
        }
      }
    }
    t1 = new Float64Array(n); t2 = new Float64Array(n); t3 = new Float64Array(n); tw = new Float64Array(n);
    blk = new Uint8Array(n);
    for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) blk[y * C + x] = Math.floor(y / FH) * BX + Math.floor(x / FW);
    bcount = new Int32Array(NB);
    candE = new Int32Array(n); candT = new Int32Array(n); fresh = new Int32Array(n); ord = new Int32Array(n);
    maskStamp = new Int32Array(n); noSlot = new Int32Array(n); stamp = 0;
    hist = new Int32Array(BUCKETS + 1);
    Gp = Sp = gType = sType = null; out.glyphs = out.shades = null;
    first = true; soft = false; other = false; paintNo = 0;
  }

  // list[0..m) in priority order (lowest hash bucket first) into ord[0..m): a counting sort, stable, O(m + BUCKETS)
  function prioritise(list, m) {
    hist.fill(0);
    for (let k = 0; k < m; k++) hist[(hash32(list[k], paintNo) >>> (32 - BUCKET_BITS)) + 1]++;
    for (let b = 0; b < BUCKETS; b++) hist[b + 1] += hist[b];
    for (let k = 0; k < m; k++) ord[hist[hash32(list[k], paintNo) >>> (32 - BUCKET_BITS)]++] = list[k];
  }

  // mark in maskStamp the first `room` cells of list[0..m) in priority order
  function chooseFirst(list, m, room) {
    stamp = (stamp + 1) | 0;
    if (m <= room) { for (let k = 0; k < m; k++) maskStamp[list[k]] = stamp; return; }
    prioritise(list, m);
    for (let k = 0; k < room; k++) maskStamp[ord[k]] = stamp;
  }

  // may a new triple cell be added to block b: no constraint that holds b is full
  function hasSlot(b) {
    for (let j = 0; j < 4; j++) {
      const c = blockCon[b * 4 + j];
      if (c < 0) break;
      let s = 0;
      for (let m = 0; m < 4; m++) { const bb = conB[c * 4 + m]; if (bb < 0) break; s += bcount[bb]; }
      if (s >= CON_CAP) return false;
    }
    return true;
  }

  function govern(glyphs, shades, now) {
    if (glyphs.length !== n || shades.length !== n) throw new RangeError(`govern: frame of ${glyphs.length} glyphs and ${shades.length} shades for a ${C}x${R} screen (call resize)`);
    stats.paints++;
    if (n === 0) { out.glyphs = glyphs; out.shades = shades; return out; }
    if (!Gp || gType !== glyphs.constructor || sType !== shades.constructor) {
      gType = glyphs.constructor; sType = shades.constructor;
      Gp = new gType(n); Sp = new sType(n); first = true;
    }
    out.glyphs = Gp; out.shades = Sp;
    if (first) {
      Gp.set(glyphs); Sp.set(shades);
      t1.fill(now); t2.fill(-Infinity); t3.fill(-Infinity); tw.fill(-Infinity);
      first = false;
      stats.ungoverned++;
      stats.last.examined = 0; stats.last.wanted = 0; stats.last.changed = 0; stats.last.held = 0;
      return out;
    }
    if (soft) { // a reset that kept the size: the history stays, the paint is whole and ungoverned, and counts as ONE change of each cell that really changed
      const all = other; // the screen (or its palette) was changed under the governor: every cell counts as changed
      let c = 0;
      for (let i = 0; i < n; i++) {
        if (!all && glyphs[i] === Gp[i] && shades[i] === Sp[i]) continue;
        t3[i] = t2[i]; t2[i] = t1[i]; t1[i] = now; tw[i] = now; c++;
      }
      Gp.set(glyphs); Sp.set(shades);
      soft = false; other = false;
      stats.ungoverned++; stats.resetChanged += c;
      stats.last.examined = 0; stats.last.wanted = 0; stats.last.changed = 0; stats.last.held = 0;
      return out;
    }
    paintNo++;
    const age = now - W + EPS_T; // a change-time at or before `age` is at least W old
    const winStart = now - READ_WINDOW + EPS_T; // a change-time after `winStart` is inside one read
    let nE = 0, nT = 0, recent = 0;
    if (relaxed) bcount.fill(0);
    for (let i = 0; i < n; i++) {
      if (tw[i] > winStart) recent++;
      if (glyphs[i] !== Gp[i] || shades[i] !== Sp[i]) {
        if (t2[i] <= age) candE[nE++] = i; // changing now would not be a third change inside W
        else candT[nT++] = i;
      }
      if (relaxed && t3[i] > age) bcount[blk[i]]++; // already triple
    }
    stats.examined += n; stats.last.examined = n;
    const wanted = nE + nT;
    stats.wanted += wanted; stats.last.wanted = wanted;
    if (wanted === 0) { stats.last.changed = 0; stats.last.held = 0; return out; }
    stats.strictHeld += nT;

    // ---- the cells that may change (not a third change inside W) under the per-read cap: the cells already changed inside this read's window use it up, a cell that changed there
    // already costs nothing more
    let room = STEP_CAP - recent; if (room < 0) room = 0;
    let nF = 0;
    for (let k = 0; k < nE; k++) if (tw[candE[k]] <= winStart) fresh[nF++] = candE[k];
    chooseFirst(fresh, nF, room);
    const eStamp = stamp;
    let used = 0;
    for (let k = 0; k < nF; k++) if (maskStamp[fresh[k]] === eStamp) used++;
    room -= used;
    let held = 0, applied = 0;
    for (let k = 0; k < nE; k++) {
      const i = candE[k];
      if (tw[i] <= winStart && maskStamp[i] !== eStamp) { held++; stats.readHeld++; if (!observe) continue; }
      Gp[i] = glyphs[i]; Sp[i] = shades[i];
      t3[i] = t2[i]; t2[i] = t1[i]; t1[i] = now; tw[i] = now;
      applied++;
    }
    // ---- the cells whose change would be a third inside W: held under the strict rule; under the relaxed rules allowed while the budget of triple cells lasts (in priority order)
    // and what is left of the per-read cap
    if (nT > 0) {
      if (!relaxed) {
        held += nT;
        if (observe) { for (let k = 0; k < nT; k++) { const i = candT[k]; Gp[i] = glyphs[i]; Sp[i] = shades[i]; t3[i] = t2[i]; t2[i] = t1[i]; t1[i] = now; tw[i] = now; } }
      } else {
        let nS = 0;
        for (let k = 0; k < nT; k++) if (t3[candT[k]] <= age) fresh[nS++] = candT[k]; // would become triple: needs a place in its block's budget
        if (nS > 0) {
          prioritise(fresh, nS);
          for (let k = 0; k < nS; k++) {
            const i = ord[k], b = blk[i];
            if (hasSlot(b)) bcount[b]++; else noSlot[i] = paintNo;
          }
        }
        let nR = 0;
        for (let k = 0; k < nT; k++) { const i = candT[k]; if (noSlot[i] !== paintNo && tw[i] <= winStart) fresh[nR++] = i; }
        chooseFirst(fresh, nR, room);
        const rStamp = stamp;
        for (let k = 0; k < nT; k++) {
          const i = candT[k];
          let ok = true;
          if (noSlot[i] === paintNo) { ok = false; stats.blocksHeld++; } else if (tw[i] <= winStart && maskStamp[i] !== rStamp) { ok = false; stats.readHeld++; }
          if (!ok) { held++; if (!observe) continue; } else applied++;
          Gp[i] = glyphs[i]; Sp[i] = shades[i];
          t3[i] = t2[i]; t2[i] = t1[i]; t1[i] = now; tw[i] = now;
        }
      }
    }
    if (observe) { applied = wanted; held = 0; }
    stats.changed += applied; stats.last.changed = applied;
    stats.held += held; stats.last.held = held;
    return out;
  }

  // reset(): the next paint is whole and ungoverned, the per-cell history and the per-read ring are KEPT (the paint counts one change of each cell that differs from what was last painted).
  // reset({ other: true }): the same, but every cell counts as changed (the terminal showed something else, or the palette was swapped: the meter saw every cell move).
  // reset({ hard: true }) and resize(): a new screen, the history starts again.
  function reset(opts = {}) {
    if (opts.hard || !Gp) { first = true; soft = false; other = false; return; }
    soft = true;
    if (opts.other) other = true;
  }

  resize(cols, rows);
  return {
    govern, reset, resize, stats, observe, variant,
    limits: { get W() { return W; }, get readWindow() { return READ_WINDOW; }, get stepCap() { return STEP_CAP; }, get blockCap() { return Math.floor(K / 4); }, get fieldCap() { return K; }, get conCap() { return CON_CAP; }, get field() { return { w: FW, h: FH }; }, get blocks() { return NB; }, get constraints() { return NCON; }, win1 },
  };
}
