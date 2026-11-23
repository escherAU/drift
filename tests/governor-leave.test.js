// DRIFT-14: the way back counts the change at the moment high contrast was LEFT (src/governor.js leave(), RESET `back`), not at the moment of the return.
// DRIFT-13 stamped both changes of the trip at the return (t1 = t2 = now), so for the first second after it a cell could not change again whatever the length of the trip
// (27 to 29 % of the screen held on average, up to 57 %, for a 0.3 s trip and a 3 s one alike). Now: leave(now) records when the governed screen stopped being shown (the first
// call wins until the return paint); the `back` paint then counts the leave at its real time and the return at `now`, or, when the trip is at least W long, the leave has aged out
// and the return counts ONE change. A return with no recorded leave behaves as DRIFT-13 did (both changes at the return): the safe fallback.
// These are the unit tests of the module; the wired tests are tests/governor-leave-app.test.js. Every test runs on the shipped module; the mutation block runs the same checks on
// temporary copies with the stamp broken (they must FAIL; the clean copy must pass).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as shipped from '../src/governor.js';

const CFG = { cols: 40, rows: 10, fps: 18 }; // 400 cells, W = 1 s, strict variant (no triple budget: a third change inside W is always held)
const N = 400;
const CELL = 8;
const BACK = { other: true, changes: 2 };

// a governor that has painted a blank screen at -50 and whose cell 8 has not changed since
function fresh(mod) {
  const gov = mod.createGovernor(CFG), f = { glyphs: new Uint16Array(N).fill(32), shades: new Uint8Array(N) };
  gov.govern(f.glyphs, f.shades, -50);
  return { gov, f, v: 64 };
}
// the cell wants a new value at `at`: did the paint apply it
function moves(s, at, cell = CELL) {
  s.f.glyphs[cell] = ++s.v;
  return s.gov.govern(s.f.glyphs, s.f.shades, at).glyphs[cell] === s.v;
}
// what the other screens painted while away (correction 1): a frame the test edits, handed to away() with a palette key and a real time
const frame = () => ({ glyphs: new Uint16Array(N).fill(32), shades: new Uint8Array(N) });
// the way back: leave at leaveAt (null: never recorded), the whole return paint at retAt
function trip(s, leaveAt, retAt) {
  if (leaveAt !== null) s.gov.leave(leaveAt);
  s.gov.reset(BACK);
  s.gov.govern(s.f.glyphs, s.f.shades, retAt);
}

// every assertion of the unit tests, for any module (the mutants run them too)
const CHECKS = {
  'a trip shorter than W: a cell cannot change again within W of the LEAVE (held at 1.99, free at 2.0 after leave 1.0, return 1.4)'(mod) {
    const a = fresh(mod); trip(a, 1.0, 1.4);
    assert.equal(moves(a, 1.99), false, 'held: leave 1.0, return 1.4 and a change at 1.99 are three changes inside 1 s');
    const b = fresh(mod); trip(b, 1.0, 1.4);
    assert.equal(moves(b, 2.0), true, 'free at exactly W after the leave (not W after the return: that is the DRIFT-13 hold)');
  },
  'a trip of W or more counts ONE change: the cell is free at once after the return (leave 1.0, return 2.5 and exactly 2.0)'(mod) {
    for (const ret of [2.5, 2.0, 7.0]) {
      const a = fresh(mod); trip(a, 1.0, ret);
      assert.equal(moves(a, ret + 0.1), true, `free 0.1 s after a return at ${ret} (trip ${ret - 1})`);
    }
    // a cell that changed just before the trip is aged out as well: its last change is older than the leave
    const b = fresh(mod); assert.equal(moves(b, 0.9), true); trip(b, 1.0, 2.5);
    assert.equal(moves(b, 2.6), true, 'a cell that changed at 0.9, before the leave at 1.0, is free after a 1.5 s trip');
  },
  'both arms of the pair: with NO recorded leave the return counts both changes at the return (DRIFT-13): held until W after it, for a short and a long trip'(mod) {
    for (const ret of [1.4, 2.5]) {
      const a = fresh(mod); trip(a, null, ret);
      assert.equal(moves(a, ret + 0.99), false, `no leave recorded, return ${ret}: held 0.99 s after it`);
      const b = fresh(mod); trip(b, null, ret);
      assert.equal(moves(b, ret + 1.0), true, `no leave recorded, return ${ret}: free W after it`);
    }
  },
  'a leave without a return does nothing: the painted frames and the counters are those of a twin that never heard of it'(mod) {
    const a = fresh(mod), b = fresh(mod);
    a.gov.leave(0.5);
    for (const at of [0.6, 0.7, 0.8, 1.0, 1.1, 1.6]) {
      const cell = 5 + Math.floor(at * 10) % 4;
      a.f.glyphs[cell] = b.f.glyphs[cell] = ++a.v; b.v = a.v;
      const pa = a.gov.govern(a.f.glyphs, a.f.shades, at), pb = b.gov.govern(b.f.glyphs, b.f.shades, at);
      assert.deepEqual(Array.from(pa.glyphs), Array.from(pb.glyphs), `paint at ${at}`);
    }
    assert.equal(a.gov.stats.ungoverned, b.gov.stats.ungoverned);
    assert.equal(a.gov.stats.held, b.gov.stats.held);
    assert.equal(a.gov.stats.changed, b.gov.stats.changed);
  },
  'only the back paint uses a leave: other and soft paints count one change at now and consume the record, so a later return does not reuse it'(mod) {
    for (const kind of [{ other: true }, undefined]) {
      const a = fresh(mod); a.gov.leave(1.0); a.gov.reset(kind); a.gov.govern(a.f.glyphs, a.f.shades, 1.4); // consumed here
      a.gov.reset(BACK); a.gov.govern(a.f.glyphs, a.f.shades, 1.5); // a return with no leave of its own: DRIFT-13 behaviour, held until 2.5
      assert.equal(moves(a, 2.0), false, `a stale leave (1.0) was reused after a ${kind ? 'other' : 'soft'} paint`);
    }
  },
  'the first leave wins until the return paint: a second leave call changes nothing'(mod) {
    const a = fresh(mod); a.gov.leave(1.0); a.gov.leave(1.3); a.gov.leave(1.35); a.gov.reset(BACK); a.gov.govern(a.f.glyphs, a.f.shades, 1.5);
    assert.equal(moves(a, 2.0), true, 'the record is the first leave (1.0): free at 2.0; the last one (1.35) would hold the cell until 2.35');
    const b = fresh(mod); b.gov.leave(1.0); b.gov.leave(1.3); b.gov.reset(BACK); b.gov.govern(b.f.glyphs, b.f.shades, 1.5);
    assert.equal(moves(b, 1.9), false, 'and the leave at 1.0 still protects: held at 1.9');
  },
  'a hard reset and a resize clear the leave: the return after them counts both changes at the return'(mod) {
    for (const how of ['hard', 'resize']) {
      const a = fresh(mod); a.gov.leave(1.0);
      if (how === 'hard') a.gov.reset({ hard: true }); else a.gov.resize(40, 10);
      a.gov.govern(a.f.glyphs, a.f.shades, 1.1); // the whole paint that consumes the hard state
      a.gov.reset(BACK); a.gov.govern(a.f.glyphs, a.f.shades, 1.5);
      assert.equal(moves(a, 2.0), false, `${how}: the leave at 1.0 was forgotten, so the return at 1.5 holds the cell until 2.5`);
    }
    // a hard request made AFTER the leave and before the return paint (the paint is hard, nothing of the trip is counted) and then a later back
    const c = fresh(mod); c.gov.leave(1.0); c.gov.reset({ hard: true }); c.gov.reset(BACK); c.gov.govern(c.f.glyphs, c.f.shades, 1.5);
    assert.equal(c.gov.stats.ungoverned, 2, 'the hard paint is the only ungoverned one for the three calls');
    c.gov.reset(BACK); c.gov.govern(c.f.glyphs, c.f.shades, 1.6);
    assert.equal(moves(c, 2.0), false, 'the leave did not survive the hard paint');
  },
  'a leave while a hard paint is pending (a new governor, or right after a hard reset) is ignored: there is no painted screen that was left'(mod) {
    const a = mod.createGovernor(CFG), f = { glyphs: new Uint16Array(N).fill(32), shades: new Uint8Array(N) };
    a.leave(0.5); a.govern(f.glyphs, f.shades, 1.0); // the construction paint
    a.reset(BACK); a.govern(f.glyphs, f.shades, 1.5);
    f.glyphs[CELL] = 70; assert.equal(a.govern(f.glyphs, f.shades, 2.0).glyphs[CELL], 32, 'held: the leave at 0.5 was not recorded, the return counts both changes at 1.5');
    const b = fresh(mod); b.gov.reset({ hard: true }); b.gov.leave(1.0); b.gov.govern(b.f.glyphs, b.f.shades, 1.1);
    b.gov.reset(BACK); b.gov.govern(b.f.glyphs, b.f.shades, 1.5);
    assert.equal(moves(b, 2.0), false, 'a leave after a hard reset and before its paint is ignored');
  },
  // ---- correction 1: the way back counts what the OTHER screens changed (away()). The trip of W or more assumed they changed nothing; chaos changes cells every frame.
  'a cell the other screen changed inside W of the return counts both changes AT the return, as DRIFT-13 did: held 0.99 s after a 1.5 s trip; a cell it left alone is free at once'(mod) {
    const run = () => {
      const s = fresh(mod), af = frame();
      s.gov.leave(1.0); s.gov.away(af, 'k', 1.0); af.glyphs[CELL] = 70; s.gov.away(af, 'k', 2.2); // changed at 2.2: inside W of the return at 2.5
      s.gov.reset(BACK); s.gov.govern(s.f.glyphs, s.f.shades, 2.5);
      return s;
    };
    const a = run(), b = run(), c = run();
    assert.equal(moves(a, 3.49), false, 'the cell changed while away: held until W after the return (3.5)');
    assert.equal(moves(b, 3.5), true, 'and free at exactly W after it');
    assert.equal(moves(c, 2.6, CELL + 1), true, 'a neighbour nobody changed: the aged leave protects nothing, free 0.1 s after the return');
    const q = fresh(mod); q.gov.leave(1.0); q.gov.reset(BACK); q.gov.govern(q.f.glyphs, q.f.shades, 2.5);
    assert.equal(moves(q, 2.6), true, 'control: the same trip with no away() call frees the cell at once (what the unfixed code did for every cell)');
  },
  'both arms of the pair: a cell changed while away inside a trip SHORTER than W is held until W after the return (2.4), not W after the leave (2.0)'(mod) {
    const mk = (changed) => {
      const s = fresh(mod), af = frame();
      s.gov.leave(1.0); s.gov.away(af, 'k', 1.0); if (changed) { af.glyphs[CELL] = 70; s.gov.away(af, 'k', 1.2); }
      s.gov.reset(BACK); s.gov.govern(s.f.glyphs, s.f.shades, 1.4);
      return s;
    };
    assert.equal(moves(mk(true), 2.0), false, 'changed at 1.2: still held at 2.0');
    assert.equal(moves(mk(true), 2.4), true, 'and free at 2.4, W after the return');
    assert.equal(moves(mk(false), 2.0), true, 'nobody changed it: free W after the leave (the DRIFT-14 arm)');
  },
  'the first away frame is the baseline: a cell that differs in it is the LEAVE (already stamped), not a change while away'(mod) {
    const s = fresh(mod), af = frame();
    af.glyphs[CELL] = 70; s.gov.leave(1.0); s.gov.away(af, 'k', 1.1); // the first frame after the leave, a moment later
    s.gov.reset(BACK); s.gov.govern(s.f.glyphs, s.f.shades, 1.4); // a trip shorter than W: a change at 1.1 would hold the cell until 2.4
    assert.equal(moves(s, 2.0), true, 'free W after the LEAVE: the baseline frame stamped nothing');
  },
  'a palette change while away is a change of every cell (the meter sees every cell move): every cell counts both changes at the return'(mod) {
    const s = fresh(mod), af = frame();
    s.gov.leave(1.0); s.gov.away(af, 'a', 1.0); s.gov.away(af, 'b', 2.2);
    s.gov.reset(BACK); s.gov.govern(s.f.glyphs, s.f.shades, 2.5);
    assert.equal(moves(s, 3.0, CELL + 5), false, 'a cell whose glyph never changed is held: the palette under it did');
  },
  'colour counts: a change of one cell fg or bg alone (a console frame with full colour) is a change while away'(mod) {
    const mkc = () => ({ glyphs: new Uint16Array(N).fill(32), shades: new Uint8Array(N), fg: new Uint32Array(N).fill(0x112233), bg: new Uint32Array(N).fill(0x000000) });
    const run = (which) => {
      const s = fresh(mod), af = mkc();
      s.gov.leave(1.0); s.gov.away(af, 'k', 1.0); af[which][CELL] = 0x445566; s.gov.away(af, 'k', 2.2);
      s.gov.reset(BACK); s.gov.govern(s.f.glyphs, s.f.shades, 2.5);
      return moves(s, 3.0);
    };
    assert.equal(run('fg'), false, 'an fg change alone: held'); assert.equal(run('bg'), false, 'a bg change alone: held');
  },
  // ---- correction 2: a frame of another KIND while away (full colour or not: chaos and experimental carry fg and bg, calm and the console do not) is a whole-screen change at `now`; the record goes on
  'a frame of another kind while away (with fg and bg, then without) counts every cell as changed, at that moment: a cell nobody touched is held until W after the return'(mod) {
    const mkc = () => ({ glyphs: new Uint16Array(N).fill(32), shades: new Uint8Array(N), fg: new Uint32Array(N).fill(0x112233), bg: new Uint32Array(N).fill(0) });
    const s = fresh(mod);
    s.gov.leave(1.0); s.gov.away(mkc(), 'k', 1.0); s.gov.away(frame(), 'k', 2.2); // the switch to a frame with no colour, at 2.2: inside W of the return at 2.5
    s.gov.reset(BACK); s.gov.govern(s.f.glyphs, s.f.shades, 2.5);
    assert.equal(moves(s, 3.0, CELL + 5), false, 'held: the whole screen changed at 2.2 (the cell itself never did)');
    const q = fresh(mod); q.gov.leave(1.0); q.gov.away(mkc(), 'k', 1.0); q.gov.away(mkc(), 'k', 2.2); // control: the same frames of ONE kind
    q.gov.reset(BACK); q.gov.govern(q.f.glyphs, q.f.shades, 2.5);
    assert.equal(moves(q, 2.6, CELL + 5), true, 'control: no switch, no change: the aged leave protects nothing');
  },
  'the reverse order (no fg and bg, then with) counts every cell as changed as well, and a repeated kind switch does too'(mod) {
    const mkc = () => ({ glyphs: new Uint16Array(N).fill(32), shades: new Uint8Array(N), fg: new Uint32Array(N).fill(0x112233), bg: new Uint32Array(N).fill(0) });
    const s = fresh(mod);
    s.gov.leave(1.0); s.gov.away(frame(), 'k', 1.0); s.gov.away(mkc(), 'k', 2.2);
    s.gov.reset(BACK); s.gov.govern(s.f.glyphs, s.f.shades, 2.5);
    assert.equal(moves(s, 3.0, CELL + 5), false, 'plain then colour: held');
    const r = fresh(mod); // a switch early (1.2) and again late (2.2): the second one is the one inside W
    r.gov.leave(1.0); r.gov.away(mkc(), 'k', 1.0); r.gov.away(frame(), 'k', 1.2); r.gov.away(mkc(), 'k', 2.2);
    r.gov.reset(BACK); r.gov.govern(r.f.glyphs, r.f.shades, 2.5);
    assert.equal(moves(r, 3.0, CELL + 5), false, 'a repeated switch: held until W after the return (3.5)');
    const t = fresh(mod); // an early switch only (1.2, the return 2.5): outside W of the return, the cell is not held
    t.gov.leave(1.0); t.gov.away(mkc(), 'k', 1.0); t.gov.away(frame(), 'k', 1.2);
    t.gov.reset(BACK); t.gov.govern(t.f.glyphs, t.f.shades, 2.5);
    assert.equal(moves(t, 2.6, CELL + 5), true, 'a single early switch: older than W at the return, free');
  },
  'a kind switch does not clear the record: 101 of 400 cells changed at 2.0, the whole screen changed again at 2.1 (a switch): the return sees 101 cells hot twice inside W, and a crowded screen; 100: not crowded'(mod) {
    const mkc = () => ({ glyphs: new Uint16Array(N).fill(32), shades: new Uint8Array(N), fg: new Uint32Array(N).fill(0x112233), bg: new Uint32Array(N).fill(0) });
    const edge = (k) => {
      const s = fresh(mod), af = mkc();
      s.gov.leave(1.0); s.gov.away(af, 'k', 1.0);
      for (let i = 0; i < k; i++) af.glyphs[i] = 70;
      s.gov.away(af, 'k', 2.0); // k cells changed at 2.0, inside W of the return
      s.gov.away(frame(), 'k', 2.1); // the switch: every cell changes again at 2.1, so the k cells have two changes inside W
      s.gov.reset(BACK); s.gov.govern(s.f.glyphs, s.f.shades, 2.5);
      return [s.gov.stats.lastBusy, s.gov.stats.returnsCrowded];
    };
    assert.deepEqual(edge(101), [101, 1], 'the record before the switch is kept: 101 busy cells, crowded');
    assert.deepEqual(edge(100), [100, 0], 'at the limit: 100 busy cells, not crowded');
  },
  'a frame that is not the size of the governed screen is read as every cell changed (never a silent skip)'(mod) {
    const s = fresh(mod), af = frame();
    s.gov.leave(1.0); s.gov.away(af, 'k', 1.0); s.gov.away({ glyphs: new Uint16Array(10), shades: new Uint8Array(10) }, 'k', 2.2);
    s.gov.reset(BACK); s.gov.govern(s.f.glyphs, s.f.shades, 2.5);
    assert.equal(moves(s, 3.0), false, 'held');
  },
  'a crowded screen (more than FIELD_LIMIT of the cells changed TWICE inside W while away, so hot with the return) counts every cell both changes at the return, even one nobody changed; at the limit it does not'(mod) {
    const edge = (k) => { // k cells change twice inside W of a return at 2.5 (trip 1.5)
      const s = fresh(mod), af = frame();
      s.gov.leave(1.0); s.gov.away(af, 'k', 1.0);
      for (let i = 0; i < k; i++) af.glyphs[i] = 70;
      s.gov.away(af, 'k', 2.1);
      for (let i = 0; i < k; i++) af.glyphs[i] = 71;
      s.gov.away(af, 'k', 2.3);
      s.gov.reset(BACK); s.gov.govern(s.f.glyphs, s.f.shades, 2.5);
      return moves(s, 2.6, 300);
    };
    assert.equal(edge(100), true, '100 of 400 cells (25 %, the limit): not crowded, the quiet cell is free');
    assert.equal(edge(101), false, '101 of 400 (above the limit): crowded, the quiet cell is held until 3.5');
  },
  'cells changed ONCE do not make a crowd however many (a calm screen): 300 of 400 changed once, a quiet cell is still free'(mod) {
    const s = fresh(mod), af = frame();
    s.gov.leave(1.0); s.gov.away(af, 'k', 1.0); for (let i = 0; i < 300; i++) af.glyphs[i] = 70;
    s.gov.away(af, 'k', 2.2);
    s.gov.reset(BACK); s.gov.govern(s.f.glyphs, s.f.shades, 2.5);
    assert.equal(moves(s, 2.6, 350), true, 'free');
    assert.equal(moves(s, 3.0, 5), false, 'while a cell that changed once is held');
  },
  'away() does nothing without a recorded leave, and what it kept does not outlive the return: the next trip starts afresh'(mod) {
    const s = fresh(mod), af = frame();
    s.gov.away(af, 'k', 0.5); af.glyphs[CELL] = 70; s.gov.away(af, 'k', 0.6);
    assert.equal(s.gov.stats.awayPaints, 0, 'no leave, no bookkeeping');
    s.gov.leave(1.0); s.gov.away(af, 'k', 1.0); af.glyphs[CELL] = 71; s.gov.away(af, 'k', 2.2);
    s.gov.reset(BACK); s.gov.govern(s.f.glyphs, s.f.shades, 2.5); // trip one: the cell changed at 2.2
    s.gov.leave(10.0); s.gov.away(af, 'k', 10.0); // trip two: nothing changes
    s.gov.reset(BACK); s.gov.govern(s.f.glyphs, s.f.shades, 12.5);
    assert.equal(moves(s, 12.6), true, 'the change of trip one is not counted in trip two');
  },
  'one ungoverned paint, whatever the order of leave and reset calls'(mod) {
    for (const calls of [['leave', 'back'], ['back', 'leave'], ['leave', 'leave', 'back'], ['leave', 'soft', 'back'], ['back', 'leave', 'hard'], ['hard', 'leave', 'back'], ['leave', 'back', 'leave', 'other']]) {
      const s = fresh(mod), base = s.gov.stats.ungoverned;
      for (const c of calls) { if (c === 'leave') s.gov.leave(0.2); else if (c === 'back') s.gov.reset(BACK); else if (c === 'other') s.gov.reset({ other: true }); else if (c === 'soft') s.gov.reset(); else s.gov.reset({ hard: true }); }
      s.f.glyphs[3] = 99; s.gov.govern(s.f.glyphs, s.f.shades, 0.4);
      s.f.glyphs[4] = 98; s.gov.govern(s.f.glyphs, s.f.shades, 0.5); s.gov.govern(s.f.glyphs, s.f.shades, 0.6);
      assert.equal(s.gov.stats.ungoverned - base, 1, `[${calls}]: exactly one ungoverned paint`);
    }
  },
};
for (const [name, fn] of Object.entries(CHECKS)) test(`DRIFT-14 leave: ${name}`, () => fn(shipped));

test('DRIFT-14 leave: the stats say what the return did (stats.returns, stats.returnsWithLeave, stats.lastTrip)', () => {
  const a = fresh(shipped); trip(a, 1.0, 1.4);
  assert.deepEqual([a.gov.stats.returns, a.gov.stats.returnsWithLeave], [1, 1]);
  assert.ok(Math.abs(a.gov.stats.lastTrip - 0.4) < 1e-9, `lastTrip ${a.gov.stats.lastTrip}`);
  trip(a, null, 3.0);
  assert.deepEqual([a.gov.stats.returns, a.gov.stats.returnsWithLeave, a.gov.stats.lastTrip], [2, 1, -1], 'a return with no leave counts as a return and reads -1');
});

test('DRIFT-14 leave: away() costs one pass over the cells per painted frame while away, nothing without a leave, and adds nothing to a governed paint', () => {
  const big = { cols: 200, rows: 60, fps: 18 }, n = 200 * 60;
  const g = shipped.createGovernor(big), f = { glyphs: new Uint16Array(n).fill(32), shades: new Uint8Array(n) };
  g.govern(f.glyphs, f.shades, -50);
  const af = { glyphs: new Uint16Array(n).fill(32), shades: new Uint8Array(n) };
  g.away(af, 'k', 0); assert.equal(g.stats.awayPaints, 0, 'no leave: no pass');
  g.leave(0.1);
  for (let k = 0; k < 20; k++) { af.glyphs[k * 3] = 40 + k; g.away(af, 'k', 0.1 + k * 0.05); }
  assert.equal(g.stats.awayPaints, 20); assert.equal(g.stats.awayExamined, 20 * n, 'one pass of n cells per painted frame');
  const before = g.stats.examined;
  g.reset({ other: true, changes: 2 }); g.govern(f.glyphs, f.shades, 1.5);
  g.govern(f.glyphs, f.shades, 1.6); assert.equal(g.stats.examined - before, n, 'the return paint examines nothing more (it is the ungoverned one) and a governed paint still examines n cells once');
  g.away(af, 'k', 2.0); assert.equal(g.stats.awayPaints, 20, 'after the return the bookkeeping is off again');
});

test('DRIFT-14 leave: the cost is O(n) once per return paint and nothing per governed paint (a 200x60 screen: the steady paint does the same work with or without a recorded leave)', () => {
  const big = { cols: 200, rows: 60, fps: 18 }, n = 200 * 60;
  const mk = () => { const g = shipped.createGovernor(big), f = { glyphs: new Uint16Array(n).fill(32), shades: new Uint8Array(n) }; g.govern(f.glyphs, f.shades, -50); return { g, f }; };
  const a = mk(), b = mk(); a.g.leave(0.1);
  for (let k = 0; k < 20; k++) {
    for (const s of [a, b]) { for (let i = 0; i < n; i += 7) s.f.glyphs[i] = 40 + (k % 5); s.g.govern(s.f.glyphs, s.f.shades, 0.2 + k * 0.06); }
    assert.equal(a.g.stats.examined, b.g.stats.examined, `paint ${k}: the same cells examined`);
  }
});

// ---- mutants: the stamp broken in a copy of the governor
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'governor.js');
const text = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
let dir = null;
test.before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-govleave-')); });
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
async function load(name, edits) {
  let t = text;
  for (const [from, to] of edits) {
    assert.equal(t.split(from).length - 1, 1, `the mutation target occurs exactly once: ${from}`);
    t = t.replace(from, () => to);
  }
  if (edits.length) assert.notEqual(t, text, 'the mutation changed the file');
  const file = path.join(dir, name + '.mjs');
  fs.writeFileSync(file, t);
  return import(pathToFileURL(file).href);
}
export const LEAVE_MUTANTS = [
  { label: 'the leave is never recorded (leave() does nothing): every return falls back to both changes at the return', edits: [['if (leftAt === null) leftAt = now;', 'void now;']] },
  { label: 'the leave is stamped at the return (leave time = return time): the DRIFT-13 hold for a trip of any length', edits: [['const leave = had ? Math.min(leftAt, now) : now;', 'const leave = now;']] },
  { label: 'the last leave wins instead of the first', edits: [['if (leftAt === null) leftAt = now;', 'leftAt = now;']] },
  { label: 'a hard reset and a hard paint keep the leave', edits: [["if (opts.hard || !Gp) { mode = 'hard'; leftAt = null; return; }", "if (opts.hard || !Gp) { mode = 'hard'; return; }"], ["mode = 'steady'; leftAt = null; // the paint consumes the hard state", "mode = 'steady'; // the paint consumes the hard state"]] },
  { label: 'away() does nothing (the other screens changes are never kept)', edits: [['if (leftAt === null || n === 0) return;', 'return;']] },
  { label: 'the first away frame is not a baseline: its differences count as changes while away', edits: [['awayT.fill(-Infinity); awayU.fill(-Infinity); awayHave = true; awayKey = key;', 'awayT.fill(now); awayU.fill(-Infinity); awayHave = true; awayKey = key;']] },
  { label: 'a palette change while away is ignored', edits: [['const all = kind || key !== awayKey;', 'const all = kind;']] },
  { label: 'colour is ignored: only glyph and shade changes count', edits: [[' || fg[i] !== pFg[i] || bg[i] !== pBg[i]) { awayU[i]', ') { awayU[i]']] },
  { label: 'a cell changed while away is not counted at the return (only the aged leave is)', edits: [['if (crowd || (a > leave && a > edge)) {', 'if (crowd) {']] },
  { label: 'no crowd rule: a screen full of hot cells still frees the cells nobody changed', edits: [['const crowd = busy > FIELD_LIMIT * n;', 'const crowd = false;']] },
  { label: 'the crowd counts cells changed once (a calm screen is crowded)', edits: [['if (awayU[i] > leave && awayU[i] > edge) busy++;', 'if (awayT[i] > leave && awayT[i] > edge) busy++;']] },
  { label: 'a back paint does not consume the leave (a later return reuses it)', edits: [["mode = 'steady'; leftAt = null; // the paint consumes the soft, other or back state", "mode = 'steady'; // the paint consumes the soft, other or back state"]] },
  { label: 'a frame of another kind while away (fg and bg or not) restarts the record, the old reset: every cell forgotten and the switch not counted', edits: [['if (kind) awayBase(g, s, fg, bg, colour);', 'if (kind) { awayBase(g, s, fg, bg, colour); awayT.fill(-Infinity); awayU.fill(-Infinity); return; }']] },
  { label: 'a frame of another kind while away is not counted as a change of every cell (the record goes on)', edits: [['const all = kind || key !== awayKey;', 'const all = key !== awayKey;']] },
  { label: 'a frame of another kind while away counts the switch but forgets what the cells did before it', edits: [['if (kind) awayBase(g, s, fg, bg, colour);', 'if (kind) { awayBase(g, s, fg, bg, colour); awayT.fill(-Infinity); }']] },
];
test('DRIFT-14 leave mutation: the unbroken copy passes every check (so a kill is a kill)', async () => {
  const mod = await load('clean', []);
  for (const [name, fn] of Object.entries(CHECKS)) fn(mod, name);
});
for (const m of LEAVE_MUTANTS) {
  test(`DRIFT-14 leave mutation: ${m.label} fails`, async () => {
    const mod = await load(m.label.replace(/[^a-z0-9]+/gi, '-').slice(0, 40), m.edits);
    const hits = [];
    for (const [name, fn] of Object.entries(CHECKS)) { try { fn(mod, name); } catch (e) { hits.push(name.slice(0, 60)); } }
    assert.ok(hits.length > 0, `${m.label}: no check failed`);
    console.log(`MUTANT KILLED ${m.label}: ${hits.length} checks fail, first: ${hits[0]}`);
  });
}
