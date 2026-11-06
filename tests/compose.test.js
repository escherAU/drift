import test from 'node:test';
import assert from 'node:assert/strict';
import { blend, smoothstep, Scheduler, createComposer, fadeOffsets, FADE_SPREAD } from '../src/compose.js';
import { SCENES } from '../src/scenes/index.js';

function field(n, f) { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = f(i); return a; }

test('X1 progress 0 gives exactly A, progress 1 exactly B (both arms)', () => {
  const A = field(50, (i) => i * 5), B = field(50, (i) => 255 - i * 3);
  const out = new Uint8Array(50);
  assert.deepEqual(Array.from(blend(A, B, 0, out)), Array.from(A));
  assert.deepEqual(Array.from(blend(A, B, 1, out)), Array.from(B));
  assert.notDeepEqual(Array.from(A), Array.from(B));
});

test('X2 mid-fade intensity lies between A and B for every cell', () => {
  const A = field(256, (i) => i), B = field(256, (i) => 255 - i);
  const out = new Uint8Array(256);
  for (const p of [0.1, 0.5, 0.9]) {
    blend(A, B, p, out);
    for (let i = 0; i < 256; i++) {
      const lo = Math.min(A[i], B[i]), hi = Math.max(A[i], B[i]);
      assert.ok(out[i] >= lo && out[i] <= hi, `cell ${i} p=${p}`);
    }
  }
  blend(A, B, 0.5, out);
  assert.ok(Math.abs(out[0] - 127.5) <= 1);
});

test('X3 a 5 s fade at 18 fps is monotonic and no cell jumps more than 6 per frame', () => {
  const A = field(256, (i) => i), B = field(256, (i) => 255 - i);
  const sched = new Scheduler({ count: 2, durationSec: 1, fadeSec: 5 });
  const out = new Uint8Array(256), prev = new Uint8Array(256);
  sched.advance(1.0001); // into the fade
  let lastP = -1, frames = 0, worst = 0;
  blend(A, B, sched.state().p, prev);
  while (sched.state().fading) {
    sched.advance(1 / 18);
    const s = sched.state();
    if (!s.fading) { assert.equal(sched.state().a, 1, 'landed on B'); break; }
    assert.ok(s.p >= lastP, 'progress must not go backwards');
    lastP = s.p;
    blend(A, B, s.p, out);
    for (let i = 0; i < 256; i++) {
      worst = Math.max(worst, Math.abs(out[i] - prev[i]));
      // monotone toward B
      if (B[i] >= A[i]) assert.ok(out[i] >= prev[i] - 1); else assert.ok(out[i] <= prev[i] + 1);
    }
    prev.set(out);
    frames++;
  }
  blend(A, B, 1, out); // the landing frame is scene B exactly
  for (let i = 0; i < 256; i++) worst = Math.max(worst, Math.abs(out[i] - prev[i]));
  assert.ok(frames >= 85 && frames <= 95, `frames ${frames}`);
  assert.ok(worst <= 6, `worst jump ${worst}`);
  // control: a hard cut (p jumps 0 -> 1) would exceed the bound
  blend(A, B, 0, prev); blend(A, B, 1, out);
  let cut = 0; for (let i = 0; i < 256; i++) cut = Math.max(cut, Math.abs(out[i] - prev[i]));
  assert.ok(cut > 6);
});

test('smoothstep is 0/1 at the ends and clamps', () => {
  assert.equal(smoothstep(-1), 0);
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(7), 1);
  assert.equal(smoothstep(0.5), 0.5);
});

test('X4 scheduler switches after the configured duration, then fades, then lands on the next scene', () => {
  const s = new Scheduler({ count: 5, durationSec: 10, fadeSec: 4 });
  assert.deepEqual({ a: s.state().a, f: s.state().fading }, { a: 0, f: false });
  s.advance(9.9);
  assert.equal(s.state().fading, false);
  s.advance(0.2);
  assert.equal(s.state().fading, true);
  assert.equal(s.state().b, 1);
  s.advance(4);
  assert.deepEqual({ a: s.state().a, f: s.state().fading, p: s.state().p }, { a: 1, f: false, p: 0 });
});

test('X4 space (skip) forces the next scene; wraps after the 5th', () => {
  const s = new Scheduler({ count: 5, durationSec: 100, fadeSec: 2 });
  for (let k = 1; k <= 5; k++) {
    s.skip();
    assert.equal(s.state().fading, true);
    s.advance(2.01);
    assert.equal(s.state().a, k % 5, `after skip ${k}`);
    assert.equal(s.state().fading, false);
  }
  assert.equal(s.state().a, 0);
});

test('X4 skip during a fade is queued, not lost and not a jump', () => {
  const s = new Scheduler({ count: 5, durationSec: 100, fadeSec: 2 });
  s.skip();
  s.advance(1);
  const pMid = s.state().p;
  s.skip();
  assert.equal(s.state().a, 0);
  assert.equal(s.state().p, pMid, 'queued skip does not disturb the running fade');
  s.advance(1.01);
  assert.equal(s.state().a, 1);
  assert.equal(s.state().fading, true, 'queued skip starts the next fade');
  assert.equal(s.state().b, 2);
});

test('scheduler with infinite duration never leaves a scene (used by measure)', () => {
  const s = new Scheduler({ count: 5, durationSec: Infinity, fadeSec: 5, start: 3 });
  s.advance(1e6);
  assert.equal(s.state().a, 3);
});

test('composer: not fading gives the scene glyph set (ramp chars), fading blends fields', () => {
  const comp = createComposer({ scenes: SCENES, cols: 60, rows: 20, seed: 1 });
  const f0 = comp.frame({ a: 2, b: 3, p: 0 }, 5);
  const field0 = Uint8Array.from(f0.field);
  assert.deepEqual(Array.from(field0), Array.from(SCENES[2](5, 60, 20, { seed: 1 })));
  const allowed = new Set([...' ·:░▒▓█'].map((c) => c.charCodeAt(0)));
  for (const g of f0.glyphs) assert.ok(allowed.has(g), `glyph ${g}`);
  const comp2 = createComposer({ scenes: SCENES, cols: 60, rows: 20, seed: 1 });
  const fm = comp2.frame({ a: 2, b: 3, p: 0.5 }, 5);
  const A = SCENES[2](5, 60, 20, { seed: 1 }), B = SCENES[3](5, 60, 20, { seed: 1 });
  for (let i = 0; i < A.length; i++) {
    assert.ok(fm.field[i] >= Math.min(A[i], B[i]) && fm.field[i] <= Math.max(A[i], B[i]));
  }
});

test('composer: squiggle frames use braille glyphs for line cells', () => {
  const comp = createComposer({ scenes: SCENES, cols: 120, rows: 40, seed: 1 });
  const f = comp.frame({ a: 0, b: 1, p: 0 }, 30);
  let braille = 0;
  for (const g of f.glyphs) if (g >= 0x2801 && g <= 0x28ff) braille++;
  assert.ok(braille > 40, `braille cells ${braille}`);
});

test('composer: resize reallocates and stays correct', () => {
  const comp = createComposer({ scenes: SCENES, cols: 60, rows: 20, seed: 1 });
  comp.frame({ a: 1, b: 2, p: 0 }, 3);
  comp.resize(33, 11);
  const f = comp.frame({ a: 1, b: 2, p: 0 }, 3);
  assert.equal(f.glyphs.length, 33 * 11);
  assert.equal(f.shades.length, 33 * 11);
  assert.equal(f.cols, 33);
});

test('X5 staggered blend: exactly A at p=0, exactly B at p=1, between A and B in between, deterministic offsets', () => {
  const n = 400;
  const A = field(n, (i) => (i * 7) % 256), B = field(n, (i) => 255 - ((i * 3) % 256));
  const off = fadeOffsets(n);
  assert.deepEqual(Array.from(off), Array.from(fadeOffsets(n)), 'same offsets every call');
  assert.ok(off.every((v) => v >= 0 && v < FADE_SPREAD), 'offsets stay inside the spread');
  assert.ok(new Set(Array.from(off)).size > n / 2, 'offsets actually differ cell to cell (control)');
  const out = new Uint8Array(n);
  assert.deepEqual(Array.from(blend(A, B, 0, out, off, FADE_SPREAD)), Array.from(A));
  assert.deepEqual(Array.from(blend(A, B, 1, out, off, FADE_SPREAD)), Array.from(B));
  for (const p of [0.05, 0.3, 0.5, 0.8, 0.97]) {
    blend(A, B, p, out, off, FADE_SPREAD);
    for (let i = 0; i < n; i++) {
      assert.ok(out[i] >= Math.min(A[i], B[i]) && out[i] <= Math.max(A[i], B[i]), `cell ${i} p=${p}`);
    }
  }
  // every cell moves monotonically toward B as p rises
  let prev = Array.from(blend(A, B, 0, out, off, FADE_SPREAD));
  for (let k = 1; k <= 50; k++) {
    blend(A, B, k / 50, out, off, FADE_SPREAD);
    for (let i = 0; i < n; i++) {
      const d = Math.sign(B[i] - A[i]);
      assert.ok((out[i] - prev[i]) * d >= 0, `cell ${i} went backwards at step ${k}`);
    }
    prev = Array.from(out);
  }
});
