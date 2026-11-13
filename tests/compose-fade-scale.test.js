// DRIFT-8 r2: Scheduler.advance(dt, fadeScale). The hold runs on the caller's time; while a fade runs, one unit of the caller's time is worth fadeScale seconds of the fade.
// The shell runtime passes min(speed, 1) / speed, so a dissolve lasts its own fade seconds of real time from 1x up (at 4x: the caller's dt is 4 x real, the scale 1/4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/compose.js';

const mk = () => new Scheduler({ count: 3, durationSec: 10, fadeSec: 2, start: 0 });
const close = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`);

test('fadeScale 1 (the default) is the old Scheduler: hold and fade on one clock', () => {
  const a = mk(), b = mk();
  for (let i = 0; i < 400; i++) { a.advance(0.1); b.advance(0.1, 1); }
  assert.deepEqual({ ...a }, { ...b });
  close(a.hold + a.fadeT, b.hold + b.fadeT, 'same place');
});

test('with fadeScale 1/4 the hold still runs at the caller\'s rate and the fade takes 4 times the caller\'s time', () => {
  const s = mk();
  s.advance(10, 0.25); // the hold: 10 s of caller time, no scale
  assert.equal(s.fading, true); assert.equal(s.fadeT, 0);
  s.advance(4, 0.25); // 4 s of caller time = 1 s of fade
  close(s.fadeT, 1, 'half way through a 2 s fade');
  s.advance(3.99, 0.25);
  assert.equal(s.fading, true);
  s.advance(0.02, 0.25);
  assert.equal(s.fading, false); assert.equal(s.cur, 1);
});

test('a single call that crosses the end of the fade hands the rest to the next hold at the caller\'s rate (not scaled)', () => {
  const s = mk();
  s.advance(10, 0.25); // into the fade
  s.advance(8 + 3, 0.25); // 8 caller seconds finish the 2 s fade; 3 more go into the next hold
  assert.equal(s.cur, 1); assert.equal(s.fading, false);
  close(s.hold, 3, 'the remainder is hold time');
});

test('a single call that crosses the start of the fade scales only the part inside it', () => {
  const s = mk();
  s.advance(10 + 4, 0.25); // 10 s of hold, then 4 caller seconds = 1 s of fade
  assert.equal(s.fading, true);
  close(s.fadeT, 1, 'one second into the fade');
});

test('the dissolve spans 36 frames at 18 fps at any speed from 1x up, as the runtime drives it (dt x speed, scale min(speed, 1) / speed)', () => {
  for (const speed of [1, 1.5, 2, 3, 4]) {
    const s = new Scheduler({ count: 2, durationSec: 60, fadeSec: 2, start: 0 });
    const dt = 1 / 18;
    let frames = 0, started = false;
    for (let k = 0; k < 18 * 80 && s.cur === 0; k++) {
      s.advance(dt * speed, Math.min(speed, 1) / speed);
      if (s.fading) { started = true; frames++; }
    }
    assert.ok(started);
    assert.ok(Math.abs(frames - 36) <= 1, `speed ${speed}: ${frames} frames of dissolve`);
  }
  // below 1x the fade is on the scene clock as before (a slow scene dissolves slowly)
  const s = new Scheduler({ count: 2, durationSec: 60, fadeSec: 2, start: 0 });
  let frames = 0;
  for (let k = 0; k < 18 * 400 && s.cur === 0; k++) { s.advance((1 / 18) * 0.5, 1); if (s.fading) frames++; }
  assert.ok(Math.abs(frames - 72) <= 1, `0.5x: ${frames} frames`);
});
