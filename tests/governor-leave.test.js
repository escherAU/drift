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
  { label: 'a back paint does not consume the leave (a later return reuses it)', edits: [["mode = 'steady'; leftAt = null; // the paint consumes the soft, other or back state", "mode = 'steady'; // the paint consumes the soft, other or back state"]] },
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
