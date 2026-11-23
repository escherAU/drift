// DRIFT-14, wired: the leave is stamped at the moment the viewer stopped seeing high contrast (the first paint of anything else), in real time, and the way back counts it there.
// What DRIFT-13 did (src/governor.js RESET `back`): stamped both changes of the trip at the RETURN, so for a second after it 27 to 29 % of the screen was held on average (up to 57 %) for a
// 0.3 s trip and a 3 s one alike (Desmond Hale's freeze2). Measured on the tunnel scene, 40x10 and 80x24, fps 18 and 30, grid, q156 and jitter clocks (a scratch script outside the repo,
// C:\Users\graem\AppData\Local\Temp\drift14\exp\hold.mjs; "held" = share of cells whose painted pair differs from the composed one), 60 runs a table:
//                      0-1 s after the return (mean / max)       1.5-3 s after it (max)
//   trip   0.15 s     DRIFT-13 24.9..27.5 / 47.3..54.3 %          3.4..5.9 %      DRIFT-14 18.6..21.4 / 41.3..45.3 %   1.5..2.8 %
//   trip   0.3  s     DRIFT-13 26.0..28.2 / 49.0..55.4 %          3.5..6.0 %      DRIFT-14 14.6..18.7 / 35.5..41.5 %   0.7..1.8 %
//   trip   1    s     DRIFT-13 28.3..30.8 / 53.8..59.0 %          4.5..6.4 %      DRIFT-14  7.0..13.7 / 24.8..36.3 %   0.3..2.4 %
//   trip   3    s     DRIFT-13 28.0..30.1 / 53.8..59.0 %          4.3..6.8 %      DRIFT-14  7.0..14.4 / 24.3..38.0 %   0.3..2.9 %
//   trip  10    s     DRIFT-13 27.7..29.2 / 52.3..57.0 %          4.5..6.4 %      DRIFT-14  7.0..13.7 / 23.5..36.3 %   0.3..2.6 %    (the figures of each cell are the range over the 12 runs)
// The ceilings below are set from the DRIFT-14 numbers with a stated margin and sit BELOW every DRIFT-13 run, so the control (the stamp at the return) fails them in every run:
//   trip >= W (1 s and up):  mean 0-1 s <= 18 % (measured worst 14.4; DRIFT-13 best 27.7), max 0-1 s <= 45 % (38.0; 52.3), max 1.5-3 s <= 4.0 % (2.9; 4.3)
//   trip <  W (0.15, 0.3):   mean 0-1 s <= 23 % (21.4; 24.9), max 0-1 s <= 47 % (45.3; 47.3), max 1.5-3 s <= 3.2 % (2.8; 3.4); the margin is small because the cells that changed just before
//                            the trip are still held by the rule (a cell that changed at the leave cannot change again within W of it), which is the point of a trip shorter than W.
// What the viewer's rules say after the return is judged by tests/governor-flip.test.js (the DRIFT-13 short-trip cases, unchanged) and by the path test here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSpied } from './helpers-governor-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { INSTALL_DIR } from '../src/cartridge/loader.js';

const must = (text, from, to) => { const lf = text.replace(/\r\n/g, '\n'); assert.equal(lf.split(from).length, 2, `the mutation target occurs exactly once: ${from}`); return lf.replace(from, to); };
// the control: what DRIFT-13 did (the leave is stamped at the return)
const AT_RETURN = { 'src/governor.js': (t) => must(t, 'const leave = had ? Math.min(leftAt, now) : now;', 'const leave = now;') };
// the leave is never recorded (the call dropped): every return falls back to both changes at the return
const NO_RECORD = { 'src/app.js': (t) => must(t, 'if (gov) gov.leave(wall);', 'if (gov) void wall;') };
// the other screens' changes are never kept: the two away() calls of the app dropped (art screens and the console)
const AWAY_ART = "if (shown.mode !== 'contrast' && gov) gov.away(f, pal.key, wall);";
const AWAY_SHELL = 'if (gov) gov.away(f, f.palette.key, wall);';
const NO_AWAY = { 'src/app.js': (t) => must(must(t, AWAY_ART, 'void pal;'), AWAY_SHELL, 'void f;') };
const NO_AWAY_SHELL = { 'src/app.js': (t) => must(t, AWAY_SHELL, 'void f;') };
// the leave is stamped where the key press settles (between steps: `wall` is still the time of the last governed paint, a frame before the viewer saw anything else)
const AT_SETTLE = { 'src/app.js': (t) => must(must(t, "if (wasGoverned && !(shown.mode === 'contrast' && !shown.shell)) govLeft = true;", "if (wasGoverned && !(shown.mode === 'contrast' && !shown.shell)) { govLeft = false; if (gov) gov.leave(wall); }"), 'function noteLeft() { if (govLeft) {', 'function noteLeft() { if (false) {') };

const KEY_AT = 8; // seconds into the run: the key that leaves high contrast
const PATHS = {
  mode: (a) => ({ keys: [{ at: KEY_AT, key: '1' }, { at: KEY_AT + a, key: '3' }], ret: (st, p) => st.mode === 'contrast' && p.mode !== 'contrast' }), // calm and back
  chain: (a) => ({ keys: [{ at: KEY_AT, key: '1' }, { at: KEY_AT + a / 2, key: '2' }, { at: KEY_AT + a, key: '3' }], ret: (st, p) => st.mode === 'contrast' && p.mode !== 'contrast' }), // calm, chaos, back
  experimental: (a) => ({ keys: [{ at: KEY_AT, key: '4' }, { at: KEY_AT + a, key: '3' }], ret: (st, p) => st.mode === 'contrast' && p.mode !== 'contrast' }),
  chaos: (a) => ({ keys: [{ at: KEY_AT, key: '2' }, { at: KEY_AT + a, key: '3' }], ret: (st, p) => st.mode === 'contrast' && p.mode !== 'contrast' }), // chaos straight away: it changes cells every frame
  'chaos then calm 0.1': (a) => ({ keys: [{ at: KEY_AT, key: '2' }, { at: KEY_AT + a - 0.1, key: '1' }, { at: KEY_AT + a, key: '3' }], ret: (st, p) => st.mode === 'contrast' && p.mode !== 'contrast' }), // chaos carries fg and bg, calm does not: a kind switch while away
  'chaos then calm 0.2': (a) => ({ keys: [{ at: KEY_AT, key: '2' }, { at: KEY_AT + a - 0.2, key: '1' }, { at: KEY_AT + a, key: '3' }], ret: (st, p) => st.mode === 'contrast' && p.mode !== 'contrast' }),
  console: (a) => ({ keys: [{ at: KEY_AT, key: 'l' }, { at: KEY_AT + a, key: '\x1b' }], ret: (st, p) => st.shell === null && p.shell !== null }), // the library over high contrast, and back
  'calm then console': (a) => ({ keys: [{ at: KEY_AT, key: '1' }, { at: KEY_AT + a / 3, key: 'l' }, { at: KEY_AT + 2 * a / 3, key: '\x1b' }, { at: KEY_AT + a, key: '3' }], ret: (st, p) => st.mode === 'contrast' && p.mode !== 'contrast' }), // left to calm, the console opened from calm and closed, then high contrast
  flip: () => ({ keys: [{ at: KEY_AT, key: 'i' }], ret: (st, p) => st.light !== p.light }), // the polarity flip: not a trip, one change at now
  // the library, the Delza cartridge inserted and booted and run, ejected, the library again, then Esc back to Classic: the console shows a cartridge for most of the trip (the real library: a non-empty list)
  cartridge: (a) => ({ dirs: [{ dir: INSTALL_DIR, trusted: true }], keys: [{ at: KEY_AT, key: 'l' }, { at: KEY_AT + 0.1, key: '\x1b[C' }, { at: KEY_AT + 0.2, key: '\x1b[C' }, { at: KEY_AT + 1.5, key: '\r' }, { at: KEY_AT + a - 2.5, key: 'e' }, { at: KEY_AT + a, key: '\x1b' }], ret: (st, p) => st.shell === null && p.shell !== null }),
};

// one run of the tunnel at `cols`x`rows`: the way out and back of `path` (a key plan), then metered. Returns what the governor said about the return (stats.returns, stats.lastTrip), the held share
// (painted != composed) in 0-1 s and 1.5-3 s after the return paint, and the five X1 rules on the reads 0.25 s to 1 s after it (mid) and from 1 s on (fin).
async function go({ cols, rows, fps, clock, path, away, seed = 1, edits = {} }) {
  const p = PATHS[path](away);
  let prev = null, at = null, mid = null, ret = null, last = null; const dev = [];
  const r = await runSpied({
    cols, rows, fps, seed, clock, clockSeed: seed, scene: 'tunnel', startScene: 1, sceneSeconds: 1000, seconds: KEY_AT + away + 3, mode: '256', feedAll: true, stopAtDissolve: false, keys: p.keys, ...(p.dirs ? { dirs: p.dirs } : {}),
    grab: (k, s, app, f, meter) => {
      const st = app.getState();
      if (prev && at === null && p.ret(st, prev)) at = k;
      if (at !== null && k === at + Math.floor(0.25 * fps)) meter.forgetWorst();
      if (at !== null && k === at + fps) { mid = meter.report(fps, k); meter.forgetWorst(); }
      prev = st;
    },
  }, {
    edits,
    onPaint: (f, g, gov, wall) => {
      const returns = gov.stats.returns; last = { returns, trip: gov.stats.lastTrip, withLeave: gov.stats.returnsWithLeave, awayPaints: gov.stats.awayPaints, crowded: gov.stats.returnsCrowded, busy: gov.stats.lastBusy };
      if (path !== 'flip' && ret === null && returns > 0) ret = wall;
      if (path === 'flip' && ret === null && wall > KEY_AT + 0.05 && gov.stats.ungoverned > 1) ret = wall;
      if (ret !== null) { let d = 0; for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] !== g.glyphs[i] || f.shades[i] !== g.shades[i]) d++; dev.push([wall - ret, d / f.glyphs.length]); }
    },
  });
  assert.notEqual(at, null, `${path}: the way back happened`);
  assert.notEqual(ret, null, `${path}: the return paint was seen`);
  const win = (a, b) => dev.filter(([t]) => t >= a && t < b).map(([, x]) => x);
  const mean = (v) => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length), max = (v) => (v.length ? Math.max(...v) : 0);
  const pc = (x) => +(x * 100).toFixed(1);
  return {
    ...last, at, mean01: pc(mean(win(0, 1))), max01: pc(max(win(0, 1))), max23: pc(max(win(1.5, 3))), mid, fin: r.rep, failedMid: mid ? failedRules(mid, { only: X1_RULE_IDS }) : null, failedFin: failedRules(r.rep, { only: X1_RULE_IDS }),
    l2Mid: mid ? pc(mid.l2.x1.worstFraction) : null, l2Fin: pc(r.rep.l2.x1.worstFraction),
  };
}

const CFGS = [];
for (const [cols, rows] of [[40, 10], [80, 24]]) for (const fps of [18, 30]) for (const clock of ['grid', 'q156', 'jitter']) CFGS.push({ cols, rows, fps, clock });
const label = (c) => `${c.cols}x${c.rows} fps ${c.fps} ${c.clock}`;
const LONG = { mean: 18, max: 45, max23: 4.0 }, SHORT = { mean: 23, max: 47, max23: 3.2 };
const holds = (r, lim, why) => {
  assert.ok(r.mean01 <= lim.mean, `${why}: mean held share 0-1 s after the return ${r.mean01} % <= ${lim.mean} %`);
  assert.ok(r.max01 <= lim.max, `${why}: max held share 0-1 s after the return ${r.max01} % <= ${lim.max} %`);
  assert.ok(r.max23 <= lim.max23, `${why}: max held share 1.5-3 s after the return ${r.max23} % <= ${lim.max23} %`);
};
const fails = (r, lim) => r.mean01 > lim.mean && r.max01 > lim.max;

test('DRIFT-14 a 3 s trip (calm and back): the held share stays under the ceilings in 12 runs (2 sizes x 2 frame rates x 3 clocks); the control that stamps at the return exceeds them in every one', async () => {
  const out = [];
  for (const c of CFGS) {
    const a = await go({ ...c, path: 'mode', away: 3 });
    holds(a, LONG, label(c));
    assert.equal(a.returns, 1, `${label(c)}: one return`); assert.equal(a.withLeave, 1, `${label(c)}: and it had a recorded leave`);
    const b = await go({ ...c, path: 'mode', away: 3, edits: AT_RETURN });
    assert.ok(fails(b, LONG), `${label(c)}: the control (leave stamped at the return) exceeds the ceilings: mean ${b.mean01} max ${b.max01}`);
    out.push(`${label(c)}: ${a.mean01}/${a.max01}/${a.max23} vs control ${b.mean01}/${b.max01}/${b.max23}`);
  }
  console.log(`DRIFT-14 held share after a 3 s trip (mean 0-1 s / max 0-1 s / max 1.5-3 s, percent):\n  ${out.join('\n  ')}`);
});

test('DRIFT-14 trips of 1 s and 10 s (W is 1 s): the same ceilings hold (3 sizes and rates x grid and jitter), and the control exceeds them', async () => {
  for (const away of [1, 10]) for (const c of CFGS.filter((x) => x.clock !== 'q156' && !(x.cols === 40 && x.fps === 30))) {
    const a = await go({ ...c, path: 'mode', away });
    holds(a, LONG, `${label(c)} trip ${away}`);
    const b = await go({ ...c, path: 'mode', away, edits: AT_RETURN });
    assert.ok(fails(b, LONG), `${label(c)} trip ${away}: the control exceeds the ceilings: mean ${b.mean01} max ${b.max01}`);
  }
});

test('DRIFT-14 trips shorter than W (0.15 s and 0.3 s): the held share is under the short-trip ceilings and below the control in every run (the cells that changed at the leave still wait)', async () => {
  for (const away of [0.15, 0.3]) for (const c of CFGS.filter((x) => x.clock !== 'jitter' && !(x.cols === 40 && x.fps === 30))) {
    const a = await go({ ...c, path: 'mode', away });
    holds(a, SHORT, `${label(c)} trip ${away}`);
    const b = await go({ ...c, path: 'mode', away, edits: AT_RETURN });
    assert.ok(a.mean01 < b.mean01 && fails(b, SHORT), `${label(c)} trip ${away}: below the control (mean ${a.mean01} vs ${b.mean01}, max ${a.max01} vs ${b.max01})`);
  }
});

// ---- every way out and every way back, on all three clocks: the leave is stamped at the real moment, and the screen after every reset path is metered
// The short-trip L2 tests of DRIFT-13 are tests/governor-flip.test.js ('the way back from another mode and from the console', 'the way back counts two changes', 'the way back control',
// 'the way back, what remains') and tests/governor-reset-app.test.js; they pass unchanged. What this adds: the stamp itself (stats.lastTrip is the time between the first paint of something else and the
// return paint: on the grid exactly the key frames' difference, on the other clocks within two frames of the trip), and the five X1 rules after the return.
//   trip 3 s:  the rules pass from 0.25 s after the return (the history before the trip has aged out) and from 1 s
//   trip 0.3 s: from 1 s the rules pass; from 0.25 s only L2 can fail (the tail of the cells that changed just before the trip: README), and never by more than the DRIFT-13 control reads
const PATH_RUNS = [];
for (const path of ['mode', 'chain', 'experimental', 'console', 'calm then console']) for (const clock of ['grid', 'q156', 'jitter']) for (const away of [0.3, 3]) PATH_RUNS.push({ cols: 40, rows: 10, fps: 18, clock, path, away });
for (const path of ['mode', 'chain', 'experimental']) for (const away of [0.3, 3]) PATH_RUNS.push({ cols: 80, rows: 24, fps: 18, clock: 'grid', path, away });
test('DRIFT-14 every way out of high contrast and back stamps the real leave: calm, calm and chaos, experimental, the console, calm then the console (3 clocks, trips 0.3 s and 3 s at 40x10; 80x24 on the grid)', async () => {
  const lines = [];
  for (const o of PATH_RUNS) {
    const r = await go(o);
    const why = `${o.path} ${label(o)} trip ${o.away}`;
    assert.equal(r.returns, 1, `${why}: one return`); assert.equal(r.withLeave, 1, `${why}: with a recorded leave`);
    const f1 = Math.round(KEY_AT * o.fps), f2 = Math.round((KEY_AT + o.away) * o.fps);
    if (o.clock === 'grid') assert.ok(Math.abs(r.trip - (f2 - f1) / o.fps) < 1e-6, `${why}: lastTrip ${r.trip} is the frames between the first paint of something else and the return paint, ${(f2 - f1) / o.fps}`);
    assert.ok(Math.abs(r.trip - o.away) <= 2 / o.fps + 1e-9 && r.trip > 0, `${why}: lastTrip ${r.trip} is the real trip (within two frames of ${o.away} s)`);
    assert.deepEqual(r.failedFin, [], `${why}: from 1 s after the return the five rules hold: ${r.failedFin}`);
    if (o.away >= 1) assert.deepEqual(r.failedMid, [], `${why}: the five rules hold from 0.25 s after a trip of ${o.away} s`);
    else assert.ok(r.failedMid.every((id) => id === 'l2.x1'), `${why}: from 0.25 s after a 0.3 s trip only L2 can fail (the tail): ${r.failedMid}`);
    lines.push(`${why}: trip ${r.trip.toFixed(3)}, from 0.25 s ${r.failedMid.length ? r.failedMid + ' L2 ' + r.l2Mid : 'pass'}, held ${r.mean01}/${r.max01} %`);
  }
  console.log(`DRIFT-14 the second after each reset path:\n  ${lines.join('\n  ')}`);
});

test('DRIFT-14 the polarity flip `i` is not a trip: no leave is recorded, no return is counted (stats.returns stays 0) on three clocks, and the five rules hold from 1 s after it', async () => {
  for (const clock of ['grid', 'q156', 'jitter']) for (const [cols, rows] of [[40, 10], [80, 24]]) {
    const r = await go({ cols, rows, fps: 18, clock, path: 'flip', away: 1 });
    assert.equal(r.returns, 0, `${cols}x${rows} ${clock}: the flip counts no return`);
    assert.equal(r.trip, -1);
    assert.deepEqual(r.failedFin, [], `${cols}x${rows} ${clock}: from 1 s after the flip`);
  }
});

test('DRIFT-14 the short-trip L2 after the return is never worse than the control that stamps at the return (mode and console, trips 0.3 s and 0.15 s, 40x10, 3 clocks): the same cases DRIFT-13 passed still pass', async () => {
  for (const path of ['mode', 'console']) for (const away of [0.3, 0.15]) for (const clock of ['grid', 'q156', 'jitter']) {
    const c = { cols: 40, rows: 10, fps: 18, clock, path, away };
    const a = await go(c), b = await go({ ...c, edits: AT_RETURN });
    assert.ok(a.l2Mid <= b.l2Mid, `${path} ${clock} trip ${away}: L2 from 0.25 s ${a.l2Mid} % <= the control's ${b.l2Mid} %`);
    assert.ok(a.failedMid.length <= b.failedMid.length, `${path} ${clock} trip ${away}: no more rules fail than in the control (${a.failedMid} vs ${b.failedMid})`);
  }
});

// ---- the trip's own changes (correction 1). A trip of W or more used to count ONE change, which assumed the other screen changed nothing. Chaos changes cells every frame and the meter counts
// them, so a chaos change, the return and a governed change got through where the DRIFT-13 stamp (at the return) held it: 129 of 138 of Desmond's runs read a higher L2, 41x11 at 30 fps on
// the jitter clock, seed 1, a 3 s trip of chaos: 26.8 % against 19.6 %. The return now counts each cell's last change painted while away (src/governor.js away()).
test('DRIFT-14 a chaos trip (key 2, 1 s and 3 s, 41x11, 30 fps, 3 clocks, seeds 1 and 2): L2 from 0.25 s after the return is within 25 % and never higher than the DRIFT-13 control (stamped at the return)', async () => {
  const lines = []; let seen = false;
  for (const away of [1, 3]) for (const clock of ['grid', 'q156', 'jitter']) for (const seed of [1, 2]) {
    const c = { cols: 41, rows: 11, fps: 30, clock, path: 'chaos', away, seed };
    const a = await go(c), b = await go({ ...c, edits: AT_RETURN });
    const la = Math.max(a.l2Mid, a.l2Fin), lb = Math.max(b.l2Mid, b.l2Fin);
    const why = `chaos trip ${away} ${clock} seed ${seed}`;
    assert.ok(la <= lb, `${why}: L2 from 0.25 s ${la} % <= the control's ${lb} %`);
    assert.ok(la <= 25, `${why}: L2 from 0.25 s ${la} % is within the 25 % rule`);
    assert.deepEqual([a.failedMid.includes('l2.x1'), a.failedFin.includes('l2.x1')], [false, false], `${why}: rule L2 passes`);
    if (away === 3 && clock === 'jitter' && seed === 1) seen = true;
    lines.push(`${why}: L2 ${la} vs control ${lb}`);
  }
  assert.ok(seen, 'the 3 s jitter seed 1 run (26.8 % in DRIFT-14 4039fdc) is among them');
  console.log(`DRIFT-14 chaos trips, L2 from 0.25 s (percent):\n  ${lines.join('\n  ')}`);
});

// ---- correction 2: chaos (it carries fg and bg), then calm (it does not) a moment before the return. The first version of away() restarted its record at a change of frame KIND, so the whole
// record of the chaos was thrown away and the switch itself was never counted: busy 0 of 400 against 194 for a plain chaos trip, and L2 from 0.25 s above the DRIFT-13 control in 140 of 144 of
// Desmond's runs (18 fps grid, 1 s trip: 25.9 % against 19.6 %; 3 s: 28.6 % against 25.0 %; 30 fps jitter, 1 s: 28.6 % against 23.2 %). A kind switch is now a change of every cell at that moment.
test('DRIFT-14 chaos, then calm 0.1 s and 0.2 s before the return (40x10, 18 and 30 fps, trips 1 s and 3 s, 3 clocks, seed 1): L2 from 0.25 s is never higher than the DRIFT-13 control (stamped at the return)', async () => {
  const lines = []; const seen = new Set();
  for (const path of ['chaos then calm 0.1', 'chaos then calm 0.2']) for (const fps of [18, 30]) for (const away of [1, 3]) for (const clock of ['grid', 'q156', 'jitter']) {
    const c = { cols: 40, rows: 10, fps, clock, path, away, seed: 1 };
    const a = await go(c), b = await go({ ...c, edits: AT_RETURN });
    const la = Math.max(a.l2Mid, a.l2Fin), lb = Math.max(b.l2Mid, b.l2Fin);
    const why = `${path}, ${fps} fps, trip ${away}, ${clock}`;
    assert.ok(la <= lb, `${why}: L2 from 0.25 s ${la} % <= the control's ${lb} %`);
    assert.ok(a.busy > 0, `${why}: the return saw the chaos (busy ${a.busy} cells)`);
    seen.add(`${path} ${fps} ${away} ${clock}`);
    lines.push(`${why}: L2 ${la} vs control ${lb}, busy ${a.busy}, crowded ${a.crowded}`);
  }
  for (const k of ['chaos then calm 0.1 18 1 grid', 'chaos then calm 0.1 18 3 grid', 'chaos then calm 0.1 30 1 jitter']) assert.ok(seen.has(k), `the run that read over 25 % (${k}) is among them`);
  console.log(`DRIFT-14 chaos then calm, L2 from 0.25 s (percent):\n  ${lines.join('\n  ')}`);
});

// ---- the console with a running cartridge (correction 1). A cartridge animates the console, so its changes while away count like any other screen's: away() is called by every console frame, with the
// colours (a cartridge frame has fg and bg). The way back from a cartridge is the eject (1.9 s) and the library, so the cartridge's own picture is always older than W at the return and what the
// last second holds is the eject and the library; the bookkeeping saw ALL of it (stats.awayPaints counts the console frames) and the rules hold from 0.25 s. (DRIFT-15, the empty-library crash at
// 80x24 and up, is a separate ticket: a non-empty library, as here, does not meet it.)
test('DRIFT-14 the console with a running cartridge (Delza, 14 s trip, 40x10 and 80x24, 3 clocks): every console frame is kept by away(), the return has its leave, and the five rules hold from 0.25 s', async () => {
  const lines = [];
  for (const [cols, rows] of [[40, 10], [80, 24]]) for (const clock of ['grid', 'q156', 'jitter']) {
    const c = { cols, rows, fps: 18, clock, path: 'cartridge', away: 14 };
    const r = await go(c);
    const why = `cartridge ${label(c)}`;
    assert.equal(r.returns, 1, `${why}: one return`); assert.equal(r.withLeave, 1, `${why}: with a recorded leave`);
    assert.ok(r.awayPaints >= 200, `${why}: the console frames were kept by away(): ${r.awayPaints} (14 s at 18 fps is up to 252)`);
    assert.deepEqual(r.failedMid, [], `${why}: from 0.25 s after the return: ${r.failedMid} L2 ${r.l2Mid}`);
    assert.deepEqual(r.failedFin, [], `${why}: from 1 s after the return: ${r.failedFin}`);
    lines.push(`${why}: away paints ${r.awayPaints}, busy ${r.busy} cells, crowded ${r.crowded}, L2 from 0.25 s ${r.l2Mid} %`);
  }
  console.log(`DRIFT-14 console with a cartridge:\n  ${lines.join('\n  ')}`);
  const none = await go({ cols: 40, rows: 10, fps: 18, clock: 'grid', path: 'cartridge', away: 14, edits: NO_AWAY_SHELL });
  assert.equal(none.awayPaints, 0, 'control: with the console call of away() dropped nothing is kept (the test above would fail)');
});

// ---- mutations: the way the stamp can break, each killed by a test above
test('DRIFT-14 mutation: the other screens changes never kept (both away() calls dropped) fails the chaos trip: the 3 s jitter seed 1 run reads over 25 % again, as at 4039fdc', async () => {
  const c = { cols: 41, rows: 11, fps: 30, clock: 'jitter', path: 'chaos', away: 3, seed: 1 };
  const ok = await go(c), bad = await go({ ...c, edits: NO_AWAY });
  assert.ok(Math.max(ok.l2Mid, ok.l2Fin) <= 25, `shipped: ${Math.max(ok.l2Mid, ok.l2Fin)} %`);
  assert.ok(Math.max(bad.l2Mid, bad.l2Fin) > 25, `the other screens changes never kept: L2 from 0.25 s ${Math.max(bad.l2Mid, bad.l2Fin)} % is over the 25 % limit`);
  assert.equal(bad.awayPaints, 0);
});

test('DRIFT-14 mutation: dropping the leave (never recorded) fails the ceilings; stamping it at the return fails them; stamping it where the key settles (a frame early) is read as a trip a frame too long and is no better on L2 from 0.25 s', async () => {
  const c = { cols: 40, rows: 10, fps: 18, clock: 'grid', path: 'mode', away: 3 };
  const shipped = await go(c);
  holds(shipped, LONG, 'shipped');
  const noRecord = await go({ ...c, edits: NO_RECORD });
  assert.equal(noRecord.withLeave, 0, 'the dropped call: the return had no recorded leave'); assert.ok(fails(noRecord, LONG), `a dropped leave fails the ceilings: mean ${noRecord.mean01} max ${noRecord.max01}`);
  const atReturn = await go({ ...c, edits: AT_RETURN });
  assert.ok(fails(atReturn, LONG), `a leave stamped at the return fails the ceilings: mean ${atReturn.mean01} max ${atReturn.max01}`);
  const short = { ...c, away: 0.3 };
  const ok = await go(short), early = await go({ ...short, edits: AT_SETTLE });
  assert.deepEqual(ok.failedMid, [], `shipped: the 0.3 s mode trip passes from 0.25 s: L2 ${ok.l2Mid}`);
  // (before DRIFT-14 correction 1 this stale stamp also failed L2 from 0.25 s, 26.8 %; the cells the other screen changed after the leave now count at the return whatever the stamp, so only a cell that changed AT the
  // first paint of the other screen still relies on it, and the stamp is judged by what it IS: the trip the governor reads)
  assert.ok(early.l2Mid >= ok.l2Mid, `stamped at settle (the stale wall): L2 from 0.25 s ${early.l2Mid} % is no better than shipped ${ok.l2Mid} %`);
  assert.ok(early.trip > ok.trip + 0.04, `the stale stamp is a frame early: trip ${early.trip} against ${ok.trip}`);
  console.log(`DRIFT-14 mutants (40x10 fps 18 grid): shipped ${shipped.mean01}/${shipped.max01}; leave dropped ${noRecord.mean01}/${noRecord.max01}; stamped at the return ${atReturn.mean01}/${atReturn.max01}; 0.3 s trip from 0.25 s L2 ${ok.l2Mid} shipped vs ${early.l2Mid} stamped at settle`);
});
