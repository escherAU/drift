// DRIFT-4 slice 2, A1: opening the library from Classic dissolves it in (no hard cut to a 35% lit screen).
import test from 'node:test';
import assert from 'node:assert/strict';
// ---- the library dissolves in when opened from Classic (a hard cut from a calm scene to a 35% lit
// screen would be a flash; the fade is 0.3 s, at least the 0.15 s ramp the photosensitivity rule asks for)

import { mkShell, DT } from './helpers-shell.js';
import { LIBRARY_FADE_SECONDS } from '../src/shell/shell.js';

test('opening the library from Classic dissolves it in over LIBRARY_FADE_SECONDS; a library start screen is whole at once', () => {
  assert.ok(LIBRARY_FADE_SECONDS >= 0.15);
  const lit = (f) => f.glyphs.reduce((n, g) => n + (g !== 32 ? 1 : 0), 0);
  const c = mkShell({ cols: 120, rows: 40 });
  c.app.start();
  c.tick(1);
  c.key('l');
  c.tick(DT);
  const first = lit(c.app.screenshot());
  c.tick(LIBRARY_FADE_SECONDS + 2 * DT);
  const whole = lit(c.app.screenshot());
  assert.ok(whole > 1000, `whole library ${whole}`);
  assert.ok(first < whole * 0.2, `first frame ${first} of ${whole}`);
  // halfway it is part-way: monotonic growth
  const c2 = mkShell({ cols: 120, rows: 40 });
  c2.app.start(); c2.tick(1); c2.key('l');
  const counts = [];
  for (let i = 0; i < 8; i++) { c2.tick(DT); counts.push(lit(c2.app.screenshot())); }
  assert.ok(counts.every((n, i) => i === 0 || n >= counts[i - 1]), counts.join());
  assert.ok(counts[0] < counts[6]);
  c.done(); c2.done();
  // starting in the library (drift --library) draws it whole
  const s = mkShell({ cols: 120, rows: 40, startScreen: { screen: 'library' } });
  s.app.start();
  s.tick(DT);
  assert.ok(lit(s.app.screenshot()) > 1000, 'whole at once');
  s.done();
});
