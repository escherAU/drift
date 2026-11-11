// DRIFT-5: scene A1, Midnight On-Ramp, and the lib it draws with. The storyboard's promises, read off rendered frames:
//   - a three-lane road in perspective: dashes that take 1.2 s from the horizon to the car (a pure function of t, period 0.4 s),
//     a street lamp every 2.4 s that grows from one row to sixteen, reflector posts, a ridge with a small city in front of it
//   - the Vantra Halcyon from behind (34x7, plate NITE86; 20x4 at 80x24), swaying one column every 7 to 11 s
//   - stars: one at a time ramps ice 0 -> 2 -> 0 over 2 s; every 45 s a car ahead closes and slides past in the left lane
//   - calm: under 30% of the cells change in a frame (about 1.5% measured), no cell jumps more than one shade, one background
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../cartridges/night-drive/lib/sprites.js';
import * as R from '../cartridges/night-drive/lib/road.js';
import * as C from '../cartridges/night-drive/lib/canvas.js';
import { sceneTime, seedOf } from '../cartridges/night-drive/lib/clock.js';
import { isAllowedGlyph } from '../src/glyphs.js';

const BANNED = [0x25cd, 0x25ce, 0x25d1, 0x25e2, 0x25e3, 0x222b, 0x2261]; // ◍ ◎ ◑ ◢ ◣ ∫ ≡
const width = (s) => [...s].length;

// ---- sprites (O11)

test('night-drive sprites (O11): the Halcyon is 34x7 from behind and 20x4 when small, the profile 33x4; every row is as wide as the sprite; plate NITE86', () => {
  assert.deepEqual([S.REAR_34.length, ...new Set(S.REAR_34.map(width))], [7, 34]);
  assert.deepEqual([S.REAR_20.length, ...new Set(S.REAR_20.map(width))], [4, 20]);
  assert.deepEqual([S.PROFILE_33.length, ...new Set(S.PROFILE_33.map(width))], [4, 33]);
  assert.deepEqual([S.REAR_34_W, S.REAR_34_H, S.REAR_20_W, S.REAR_20_H, S.PROFILE_W, S.PROFILE_H], [34, 7, 20, 4, 33, 4]);
  assert.ok(S.REAR_34.join('\n').includes('NITE86'), 'the plate');
  assert.ok(!S.REAR_20.join('').includes('NITE86'), 'too small for the plate');
  for (const art of [S.REAR_34, S.REAR_20, S.PROFILE_33, S.CAR_AHEAD_12, S.CAR_AHEAD_6]) {
    for (const row of art) for (const ch of row) { assert.ok(isAllowedGlyph(ch.codePointAt(0)), ch); assert.ok(!BANNED.includes(ch.codePointAt(0)), ch); }
  }
  assert.deepEqual([S.CAR_AHEAD_12.length, ...new Set(S.CAR_AHEAD_12.map(width))], [3, 12]);
  // each sprite has an ink row per art row, as wide as the art, using only letters the colour map knows
  for (const [art, ink] of [[S.REAR_34, S.REAR_34_INK], [S.REAR_20, S.REAR_20_INK], [S.PROFILE_33, S.PROFILE_INK]]) {
    assert.equal(ink.length, art.length);
    ink.forEach((row, j) => { assert.equal(width(row), width(art[j])); for (const ch of row) assert.ok(ch === ' ' || ch in S.INK_COLOURS, ch); });
  }
});

test('night-drive wheels (O11): the spinner steps every 0.25 s through a vertical, a slash, a dash and a backslash, and rests on a plus when parked', () => {
  assert.deepEqual([...S.WHEEL_FRAMES], ['▐│▌', '▐╱▌', '▐─▌', '▐╲▌']);
  assert.equal(S.WHEEL_PARKED, '▐┼▌');
  assert.equal(S.WHEEL_STEP, 0.25);
  const seen = [];
  for (let k = 0; k < 8; k++) seen.push(S.wheelGlyph(k * 0.25 + 0.01));
  assert.deepEqual(seen, [...S.WHEEL_FRAMES, ...S.WHEEL_FRAMES], 'one step per 0.25 s, four to the turn');
  assert.equal(S.wheelGlyph(0), S.WHEEL_FRAMES[0]);
  assert.equal(S.wheelGlyph(0.24), S.WHEEL_FRAMES[0], 'holds for the whole quarter second');
  assert.equal(S.wheelGlyph(0.26), S.WHEEL_FRAMES[1]);
  for (const t of [0, 0.3, 1.7, 99]) assert.equal(S.wheelGlyph(t, true), S.WHEEL_PARKED, `parked at ${t}`);
  // drawn into a canvas: both wheels of the profile show the same frame, in the last row of the sprite
  const g = new Uint16Array(60 * 8), c = new Uint8Array(60 * 8);
  const cv = C.canvas(g, c, 60, 8);
  C.clear(cv);
  S.drawProfile(cv, 5, 2, 0.3, false);
  const rowText = (y) => String.fromCharCode(...g.slice(y * 60, y * 60 + 60));
  const last = rowText(2 + S.PROFILE_H - 1);
  for (const wh of S.PROFILE_WHEELS) assert.equal(last.slice(5 + wh.x, 5 + wh.x + 3), '▐╱▌', 'both wheels show 0.3 s of spin');
  C.clear(cv);
  S.drawProfile(cv, 5, 2, 0.3, true);
  for (const wh of S.PROFILE_WHEELS) assert.equal(rowText(2 + S.PROFILE_H - 1).slice(5 + wh.x, 5 + wh.x + 3), '▐┼▌', 'parked');
});

// ---- road geometry (O12)

test('night-drive road (O12): at 120x40 the edges are L = 58 - 2.33(r-15) and R = 61 + 2.33(r-15), symmetric about the middle', () => {
  const g = R.geometry(120, 40);
  assert.equal(g.horizon, 15);
  assert.equal(g.below, 24);
  for (let r = 15; r <= 39; r++) {
    assert.equal(R.edgeL(g, r), Math.round(58 - 2.33 * (r - 15)), `L at row ${r}`);
    assert.equal(R.edgeR(g, r), Math.round(61 + 2.33 * (r - 15)), `R at row ${r}`);
  }
});

test('night-drive road (O12): at every size the edges are symmetric about the middle, widen row by row to the bottom and stay on screen; lane lines sit at the thirds', () => {
  for (const [w, h] of [[120, 40], [240, 67], [80, 24], [100, 32], [160, 48]]) {
    const g = R.geometry(w, h);
    assert.equal(g.horizon, Math.round(h * 0.375), `${w}x${h} horizon`);
    let prev = Infinity;
    for (let r = g.horizon; r < h; r++) {
      const l = R.edgeL(g, r), rr = R.edgeR(g, r);
      assert.equal(l + rr, w - 1, `${w}x${h} row ${r} is symmetric`);
      assert.ok(l <= prev, `${w}x${h} row ${r}: the road only widens`);
      assert.ok(l >= 0 && rr <= w - 1, `${w}x${h} row ${r} on screen: ${l}..${rr}`);
      prev = l;
      const a = R.laneX(g, r, 1), b = R.laneX(g, r, 2);
      assert.ok(l <= a && a <= b && b <= rr, `${w}x${h} row ${r}: lane lines are inside the road`);
      assert.ok(Math.abs((a - l) - (rr - b)) <= 1, `${w}x${h} row ${r}: three lanes of the same width`);
    }
  }
  // the 120x40 scaling: twice as wide, the same rows below the horizon, twice the slope
  assert.ok(Math.abs(R.geometry(240, 40).k - 2 * R.geometry(120, 40).k) < 1e-9);
});

test('night-drive dashes (O12): a dash takes 1.2 s from the horizon to the car, the row is monotonic in depth, and the picture repeats every 0.4 s', () => {
  assert.equal(R.DASH_TRAVEL, 1.2);
  assert.equal(R.DASH_PERIOD, 0.4);
  assert.equal(R.DASH_COUNT, 3, 'three dashes in flight');
  assert.ok(Math.abs(R.DASH_TRAVEL / R.DASH_PERIOD - R.DASH_COUNT) < 1e-9);
  for (const [w, h] of [[120, 40], [80, 24], [240, 67]]) {
    const g = R.geometry(w, h);
    let prev = -1;
    for (let k = 0; k <= 100; k++) {
      const row = R.rowAtPhase(g, k / 100);
      assert.ok(row >= prev, `${w}x${h} monotonic at ${k}`);
      assert.ok(row > g.horizon && row <= h - 1);
      prev = row;
    }
    assert.equal(R.rowAtPhase(g, 0), g.horizon + 1, 'born just under the horizon');
    assert.equal(R.rowAtPhase(g, 1), h - 1, 'and reaches the car at the bottom');
    // the rows in flight at T are the rows in flight at T + 0.4 (a dash has moved to the place the one behind it was)
    for (const T of [0, 0.13, 1.7, 33.3, 61.07]) {
      const rows = (t) => [0, 1, 2].map((i) => R.dashRow(g, t, i)).sort((a, b) => a - b);
      assert.deepEqual(rows(T + 0.4), rows(T), `${w}x${h} period 0.4 s at ${T}`);
    }
    // one dash, followed in time, goes from the horizon to the bottom in 1.2 s
    assert.ok(R.dashRow(g, 0.0001, 0) <= g.horizon + 2 && R.dashRow(g, 1.1999, 0) >= h - 2);
  }
});

test('night-drive lamps (O12): a lamp every 2.4 s grows from 1 to 16 rows at 120x40, and leaves past the right edge', () => {
  assert.equal(R.LAMP_PERIOD, 2.4);
  const g = R.geometry(120, 40);
  assert.equal(R.lamp(g, 0).height, 1);
  assert.equal(R.lamp(g, 2.4 - 0.0001).height, 16);
  let prev = 0;
  for (let k = 0; k < 240; k++) { const l = R.lamp(g, k * 0.01); assert.ok(l.height >= prev || k % 240 === 0, `grows at ${k}`); prev = l.height; }
  assert.deepEqual(R.lamp(g, 0.3), R.lamp(g, 0.3 + 2.4), 'a pure function of t with period 2.4 s');
  assert.ok(R.lamp(g, 2.4 - 0.0001).x > 119 - 2, 'by the time it is full height it is at the edge of the screen');
  const early = R.lamp(g, 0.05);
  assert.ok(early.x > R.edgeR(g, early.foot), 'beside the road, never on it');
});

test('night-drive clock and canvas: scene time counts from t0 and is never negative or NaN; drawing is clipped to the window', () => {
  assert.equal(sceneTime(100, { t0: 100 }), 0);
  assert.equal(sceneTime(5, {}), 5);
  assert.equal(sceneTime(5, undefined), 5);
  assert.equal(sceneTime(5, { t0: 9 }), 0);
  assert.equal(sceneTime(NaN, { t0: 3 }), 0);
  assert.equal(sceneTime(-4), 0);
  assert.equal(seedOf({ seed: 7.9 }), 7);
  assert.equal(seedOf({}), 1);
  const g = new Uint16Array(12), c = new Uint8Array(12);
  const cv = C.canvas(g, c, 4, 3);
  C.clear(cv);
  C.put(cv, -1, 0, 65, 3); C.put(cv, 4, 0, 65, 3); C.put(cv, 0, 3, 65, 3); C.put(cv, 3, 2, 66, 5);
  assert.equal(g.filter((v) => v !== 32).length, 1);
  assert.equal(g[11], 66);
  assert.equal(c[11], 5);
  C.text(cv, -2, 0, 'abcdef', 9);
  assert.equal(String.fromCharCode(...g.slice(0, 4)), 'cdef');
  assert.doesNotThrow(() => C.blit(C.canvas(new Uint16Array(0), new Uint8Array(0), 0, 0), 5, 5, ['xx'], { col: 1 }));
});
