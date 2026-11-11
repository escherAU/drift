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

// ---- the scene

import onramp, {
  LAYOUTS, layoutFor, starsOf, starShade, swayOffset, swayStarts, passAge, passRow, ridgeOf,
  STAR_PERIOD, STAR_RAMP, SWAY_HOLD, PASS_FIRST, PASS_PERIOD,
} from '../cartridges/night-drive/scenes/onramp.js';
import { renderScene } from '../src/cells.js';
import { ICE, FAR, NEAR, SUN, TANG, CORAL, MAG, VIOLET, CYAN, COUNT, FAMILIES } from '../cartridges/night-drive/lib/palette.js';

const cp = (ch) => ch.codePointAt(0);
const FPS = 18;
const frame = (t, w = 120, h = 40, seed = 1, t0) => {
  const g = new Uint16Array(w * h), c = new Uint8Array(w * h);
  onramp(t, w, h, { seed, glyphs: g, colours: c, ...(t0 !== undefined ? { t0 } : {}) });
  return { g, c, w, h };
};
const rowText = (f, y) => String.fromCharCode(...f.g.slice(y * f.w, (y + 1) * f.w));
const cellsOf = (f, ch, col) => {
  const out = [];
  for (let i = 0; i < f.g.length; i++) if (f.g[i] === cp(ch) && (col === undefined || (Array.isArray(col) ? col.includes(f.c[i]) : f.c[i] === col))) out.push([i % f.w, Math.floor(i / f.w)]);
  return out;
};
// the sizes every promise is tested at: the three shipped sizes, plus just above, at and just below every breakpoint
const SIZES = [[120, 40], [80, 24], [240, 67]];
for (const l of LAYOUTS) {
  if (l.minCols > 0 && l.minRows > 0) SIZES.push([l.minCols, l.minRows], [l.minCols + 1, l.minRows + 1], [l.minCols - 1, l.minRows], [l.minCols, l.minRows - 1]);
}
const TIMES = [0, 0.7, 3.1, 12.5, 41.2, 45, 49.5, 52, 60, 86.5];

test('onramp (O1): a cells scene called onramp whose LAYOUTS are listed widest first, each with minCols and minRows', () => {
  assert.equal(onramp.kind, 'cells');
  assert.equal(onramp.id, 'onramp');
  assert.ok(Array.isArray(LAYOUTS) && LAYOUTS.length >= 2);
  for (const l of LAYOUTS) assert.ok(Number.isInteger(l.minCols) && Number.isInteger(l.minRows), JSON.stringify(l));
  for (let i = 1; i < LAYOUTS.length; i++) assert.ok(LAYOUTS[i].minCols <= LAYOUTS[i - 1].minCols, 'sorted widest first');
  assert.deepEqual([LAYOUTS[LAYOUTS.length - 1].minCols, LAYOUTS[LAYOUTS.length - 1].minRows], [0, 0], 'the last layout takes every window');
  assert.equal(layoutFor(120, 40).car, 'rear34');
  assert.equal(layoutFor(240, 67).car, 'rear34');
  assert.equal(layoutFor(80, 24).car, 'rear20');
  const [big] = LAYOUTS;
  assert.equal(layoutFor(big.minCols, big.minRows).name, big.name, 'at the breakpoint: the big layout');
  assert.notEqual(layoutFor(big.minCols - 1, big.minRows).name, big.name, 'one column short: not');
  assert.notEqual(layoutFor(big.minCols, big.minRows - 1).name, big.name, 'one row short: not');
});

test('onramp (O2): the same (t, w, h, seed) draws the same frame; t0 shifts the scene\'s own clock; odd times do not throw; the seed changes the stars and the ridge', () => {
  for (const [w, h] of SIZES) {
    for (const t of [0, 5.3, 49.5]) {
      const a = frame(t, w, h, 1), b = frame(t, w, h, 1);
      assert.deepEqual(a.g, b.g);
      assert.deepEqual(a.c, b.c);
    }
  }
  const early = frame(0), later = frame(100, 120, 40, 1, 100);
  assert.deepEqual(later.g, early.g, 't = 100 with t0 = 100 is t = 0');
  assert.deepEqual(later.c, early.c);
  const mid = frame(49.5), shifted = frame(149.5, 120, 40, 1, 100);
  assert.deepEqual(shifted.g, mid.g);
  assert.notDeepEqual(frame(7.3, 120, 40, 1, 0).g, frame(7.3, 120, 40, 1, 3).g, 'a different t0 is a different moment');
  for (const t of [-5, -0.001, NaN, Infinity, -Infinity, 1e9]) assert.doesNotThrow(() => frame(t), String(t));
  assert.deepEqual(frame(-5).g, frame(0).g, 'a negative time is the start');
  assert.deepEqual(frame(NaN).g, frame(0).g);
  assert.notDeepEqual(frame(10, 120, 40, 1).g, frame(10, 120, 40, 2).g, 'the seed matters');
  for (const [w, h] of [[0, 0], [1, 1], [3, 3], [12, 8], [2, 200], [200, 2], [120, 4], [5, 40]]) assert.doesNotThrow(() => frame(30, w, h), `${w}x${h}`);
  // the shared renderer (no t0) gives the same picture as the scene called directly
  const shared = renderScene(onramp, 12.5, 120, 40, 1);
  const direct = frame(12.5);
  assert.deepEqual(Array.from(shared.glyphs), Array.from(direct.g));
});

test('onramp (O3): at the shipped sizes and at, just above and one short of every breakpoint: allowed glyphs only, none of the banned set, colours inside the skin, blanks are colour 0', () => {
  assert.ok(SIZES.length >= 7);
  for (const [w, h] of SIZES) {
    for (const t of TIMES) {
      const f = frame(t, w, h);
      for (let i = 0; i < f.g.length; i++) {
        assert.ok(isAllowedGlyph(f.g[i]), `${w}x${h} t=${t} U+${f.g[i].toString(16)}`);
        assert.ok(!BANNED.includes(f.g[i]));
        if (f.g[i] === 32) assert.equal(f.c[i], 0, 'a blank cell is the background');
        else assert.ok(f.c[i] >= 16 && f.c[i] < COUNT, `${w}x${h} t=${t}: colour ${f.c[i]}`);
      }
    }
  }
});

test('onramp (O4): stars use only ice shades 0 to 2; one star at a time ramps 0 -> 1 -> 2 -> 1 -> 0 over 2 s in single steps, a new one every 2.5 s', () => {
  assert.deepEqual([STAR_RAMP, STAR_PERIOD], [2, 2.5]);
  // the ramp function itself
  let prev = 0;
  for (let k = 0; k <= 300; k++) { const s = starShade(k / 100); assert.ok(s >= 0 && s <= 2 && Math.abs(s - prev) <= 1, `step at ${k / 100}`); prev = s; }
  assert.deepEqual([0.1, 0.6, 1.4, 1.7, 2.1].map(starShade), [1, 2, 2, 1, 0]);
  // read off the picture over 40 s
  const seen = new Map(); // "x,y" -> list of [t, shade]
  const iceStar = new Set([ICE[0], ICE[1], ICE[2]]);
  for (let k = 0; k < 40 * FPS; k++) {
    const t = k / FPS;
    const f = frame(t);
    for (let i = 0; i < f.g.length; i++) {
      if (f.g[i] === cp('·') || f.g[i] === cp('°')) assert.ok(iceStar.has(f.c[i]), `star colour ${f.c[i]} at ${t}`);
    }
    const ramping = cellsOf(f, '·', [ICE[1], ICE[2]]);
    assert.ok(ramping.length <= 1, `${ramping.length} stars ramping at ${t.toFixed(2)} s`);
    for (const [x, y] of ramping) {
      const key = x + ',' + y;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push([t, f.c[y * f.w + x] === ICE[2] ? 2 : 1]);
    }
  }
  assert.ok(seen.size >= 10, `${seen.size} different stars ramped in 40 s`);
  // a ramp is shade 1 (0.5 s), 2 (1 s), 1 (0.5 s): at 18 fps, 9 + 18 + 9 frames give or take one
  for (const [key, list] of seen) {
    const runs = [];
    let last = -1, lastT = -9;
    for (const [t, s] of list) {
      if (s === last && t - lastT < 1.5 / FPS) runs[runs.length - 1][1]++; else runs.push([s, 1]);
      last = s; lastT = t;
    }
    // the same star comes round again after a dozen or so ramps, so allow whole repeats of 1,2,1 (a gap in time splits them)
    assert.equal(runs.length % 3, 0, `${key}: runs ${JSON.stringify(runs)}`);
    for (let r = 0; r < runs.length; r += 3) {
      assert.deepEqual([runs[r][0], runs[r + 1][0], runs[r + 2][0]], [1, 2, 1], key);
      assert.ok(Math.abs(runs[r][1] - 9) <= 1 && Math.abs(runs[r + 1][1] - 18) <= 1 && Math.abs(runs[r + 2][1] - 9) <= 1, `${key}: ${JSON.stringify(runs)}`);
    }
  }
  // the static stars hold still: the set of '·' and '°' cells is the same at every time, only the colour of one changes
  const stars = (t) => [...cellsOf(frame(t), '·'), ...cellsOf(frame(t), '°')].map((c) => c.join()).sort();
  assert.deepEqual(stars(0), stars(33.3));
  assert.ok(starsOf(120, 40, 1).dim.length >= 12);
});

// every frame pair over `seconds` (the 45 s car pass is inside 60), at every size of O3
const walk = (w, h, seconds, each) => {
  let prev = frame(0, w, h);
  for (let k = 1; k <= seconds * FPS; k++) { const cur = frame(k / FPS, w, h); each(prev, cur, k / FPS); prev = cur; }
};
const familyOf = (col) => Object.entries(FAMILIES).find(([, f]) => f.includes(col));

test('onramp (O5): no cell moves more than one shade step in a frame on a ramp (the same glyph in the same family), over 60 s at every size', () => {
  let ramps = 0;
  for (const [w, h] of SIZES) {
    walk(w, h, 60, (a, b, t) => {
      for (let i = 0; i < a.g.length; i++) {
        if (a.g[i] === 32 || a.g[i] !== b.g[i] || a.c[i] === b.c[i]) continue;
        const fa = familyOf(a.c[i]), fb = familyOf(b.c[i]);
        assert.ok(fa && fb && fa[0] === fb[0], `${w}x${h} t=${t.toFixed(2)} cell ${i}: colour ${a.c[i]} -> ${b.c[i]} changes family under the same glyph`);
        assert.equal(Math.abs(fa[1].indexOf(a.c[i]) - fb[1].indexOf(b.c[i])), 1, `${w}x${h} t=${t.toFixed(2)} cell ${i}: more than one shade`);
        ramps++;
      }
    });
  }
  assert.ok(ramps > 100, `${ramps} ramp steps were checked`);
});

test('onramp (O6): under 30% of the cells change in any frame, over 60 s (the 45 s car pass included) at every size; the measured worst is far below that', () => {
  const worstBy = [];
  for (const [w, h] of SIZES) {
    let worst = 0, at = 0;
    walk(w, h, 60, (a, b, t) => {
      let n = 0;
      for (let i = 0; i < a.g.length; i++) if (a.g[i] !== b.g[i] || a.c[i] !== b.c[i]) n++;
      const share = n / a.g.length;
      if (share > worst) { worst = share; at = t; }
    });
    worstBy.push(`${w}x${h} ${(worst * 100).toFixed(2)}% at ${at.toFixed(2)} s`);
    assert.ok(worst < 0.3, `${w}x${h}: ${worst}`);
    assert.ok(worst < 0.05, `${w}x${h}: worst frame changed ${(worst * 100).toFixed(2)}% at ${at.toFixed(2)} s`);
    assert.ok(worst > 0.001, 'it does move');
  }
  console.log('# onramp worst frame: ' + worstBy.join(' | '));
});

test('onramp (O6 control): a road that redraws everything every frame would break the same bound', () => {
  const flicker = Object.assign((t, w, h, p) => { p.glyphs.fill(cp('█')); p.colours.fill(Math.floor(t * 18) & 1 ? SUN[1] : SUN[2]); }, { id: 'flicker' });
  const a = renderScene(flicker, 0, 120, 40), b = renderScene(flicker, 1 / 18, 120, 40);
  let n = 0;
  for (let i = 0; i < a.glyphs.length; i++) if (a.colours[i] !== b.colours[i]) n++;
  assert.ok(n / a.glyphs.length > 0.9);
});

test('onramp (O7): the background is never drawn and never flips; no frame is blank; the horizon line is in magenta shade 1', () => {
  const blank = (f) => f.g.reduce((n, v) => n + (v === 32 ? 1 : 0), 0);
  for (const [w, h] of SIZES) {
    const horizon = Math.round(h * 0.375);
    for (const t of [0, 1.1, 20.5, 49.5, 77]) {
      const f = frame(t, w, h);
      const lit = f.g.length - blank(f);
      assert.ok(lit > w * h * 0.03 && lit < w * h * 0.5, `${w}x${h} t=${t}: ${lit} of ${w * h} cells lit`);
      let line = 0;
      for (let x = 0; x < w; x++) if (f.g[horizon * w + x] === cp('▁') && f.c[horizon * w + x] === MAG[1]) line++;
      assert.equal(line, w, `${w}x${h} t=${t}: the horizon line runs the whole width`);
    }
    // the number of blank cells never jumps from one frame to the next
    walk(w, h, 20, (a, b) => assert.ok(Math.abs(blank(a) - blank(b)) / a.g.length < 0.03, 'blank share steady'));
  }
});

// ---- motion: dashes, lamps, posts

import * as Rd from '../cartridges/night-drive/lib/road.js';
const carTopOf = (w, h) => h - 1 - (layoutFor(w, h).car === 'rear34' ? S.REAR_34_H : S.REAR_20_H);
const dashCells = (f, below) => {
  const out = [];
  for (let i = 0; i < f.g.length; i++) {
    if ((f.g[i] === cp('│') || f.g[i] === cp('┃')) && f.c[i] === SUN[2] && Math.floor(i / f.w) < below) out.push(i);
  }
  return out;
};

test('onramp (O8): dashes sit where road.js says, advance a dash period per 0.4 s as a pure function of t, and the picture repeats every 0.4 s', () => {
  for (const [w, h] of SIZES) {
    const g = Rd.geometry(w, h);
    const top = carTopOf(w, h);
    for (const T of [0, 0.13, 0.4, 1.17, 5.55, 12.9, 33.3, 38.01]) {
      const f = frame(T, w, h);
      const want = new Set();
      for (let line = 1; line <= 2; line++) for (let i = 0; i < Rd.DASH_COUNT; i++) {
        const r = Rd.dashRow(g, T, i);
        if (r < top) want.add(r * w + Rd.laneX(g, r, line));
      }
      assert.deepEqual(new Set(dashCells(f, top)), want, `${w}x${h} t=${T}`);
      assert.ok(want.size >= 2, `${w}x${h} t=${T}: dashes are on the road`);
      assert.deepEqual(dashCells(frame(T + Rd.DASH_PERIOD, w, h), top), dashCells(f, top), `${w}x${h}: t=${T} and t=${T + 0.4} show the same dashes`);
    }
    // far dashes are thin and near ones heavy
    const f = frame(0.2, w, h);
    const mid = g.horizon + g.below / 2;
    for (const i of dashCells(f, top)) assert.equal(f.g[i], cp(Math.floor(i / w) < mid ? '│' : '┃'));
  }
  // one dash, followed through its 1.2 s, runs from just under the horizon to the bottom, row by row downward
  const g = Rd.geometry(120, 40);
  let prev = 0;
  for (let k = 0; k < 120; k++) {
    const r = Rd.dashRow(g, k * 0.01 + 0.0001, 0);
    if (k > 0 && r < prev) assert.equal(k, 120, 'the row only grows until it wraps');
    prev = r;
  }
});

test('onramp (O8): a lamp every 2.4 s grows from 1 to 16 rows at 120x40 beside the right edge, a pure function of t; there is none at 80x24', () => {
  const headCells = (f) => cellsOf(f, '●', TANG[3]);
  const lampCells = (f) => {
    const out = [];
    for (let i = 0; i < f.g.length; i++) {
      const gl = f.g[i];
      if (f.c[i] === TANG[3] || (f.c[i] === ICE[0] && (gl === cp('┃') || gl === cp('┻') || gl === cp('┓') || gl === cp('━')))) out.push(i);
    }
    return out;
  };
  const g = Rd.geometry(120, 40);
  const heights = [];
  for (let k = 0; k < 44; k++) { // up to 2.2 s: after that the head is already past the right edge
    const T = k * 0.05 + 0.0001;
    const f = frame(T);
    const heads = headCells(f);
    assert.equal(heads.length, 1, `one lamp head at ${T.toFixed(2)} s`);
    const la = Rd.lamp(g, T);
    const top = la.foot - la.height + 1;
    assert.equal(heads[0][1], top, 'the head is at the top of the pole');
    assert.equal(heads[0][0], la.height === 1 ? la.x : la.x - la.arm - 1);
    heights.push(la.foot - heads[0][1] + 1);
    if (la.height >= 2 && la.x < 120) {
      let pole = 0;
      for (let y = top; y <= la.foot; y++) if (f.c[y * 120 + la.x] === ICE[0]) pole++;
      assert.equal(pole, la.height, `${T.toFixed(2)} s: the pole runs from the arm down to its foot`);
    }
  }
  assert.equal(heights[0], 1);
  assert.equal(heights[heights.length - 1], 16, 'sixteen rows before it leaves');
  assert.equal(Rd.lamp(g, 2.4 - 0.0001).height, 16);
  assert.ok(Rd.lamp(g, 2.4 - 0.0001).x - 4 >= 120, 'and the head is past the right edge by the end');
  assert.ok(heights.includes(8) || heights.some((v) => v > 5 && v < 12), 'with sizes in between');
  assert.ok(heights.every((v, i) => i === 0 || v >= heights[i - 1]), 'it only grows');
  for (const T of [0.3, 1.1, 2.3, 7.7, 20.2]) assert.deepEqual(lampCells(frame(T + 2.4)), lampCells(frame(T)), `a lamp every 2.4 s (${T})`);
  // beside the road, never on it
  for (const T of [0.05, 0.8, 1.6, 2.3]) {
    const f = frame(T);
    for (const [x, y] of headCells(f)) assert.ok(x > Rd.edgeR(g, y), `head at (${x},${y}) is outside the right edge`);
  }
  // compact: none, at any time
  for (const T of [0, 0.5, 1.4, 2.3, 9.9, 30.1]) {
    const f = frame(T, 80, 24);
    assert.deepEqual(lampCells(f), [], `no lamp at 80x24, t=${T}`);
  }
});

test('onramp (O8): a reflector post every 1.2 s on the left verge, in coral shade 1', () => {
  const g = Rd.geometry(120, 40);
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const gg = Rd.geometry(w, h);
    for (const T of [0, 0.3, 0.9, 1.19, 1.2, 20.6]) {
      const posts = cellsOf(frame(T, w, h), '▪', CORAL[1]);
      const p = Rd.post(gg, T);
      assert.ok(p.x < Rd.edgeL(gg, p.foot), 'on the left verge');
      if (p.x >= 0) { assert.equal(posts.length, 1, `${w}x${h} t=${T}`); assert.deepEqual(posts[0], [p.x, p.foot]); } else assert.equal(posts.length, 0, 'past the left edge');
    }
  }
  const [p0, p1] = [Rd.post(g, 0.5), Rd.post(g, 0.5 + 1.2)];
  assert.deepEqual([p0.foot, p0.x], [p1.foot, p1.x], 'period 1.2 s');
});

// ---- the two sizes of car, the sway, the car ahead

test('onramp (O9): at 80x24 the ridge is one row, there is no city and no lamp and the car is 20x4; at 120x40 the car is 34x7 with the plate NITE86, the ridge up to four rows and the city in the middle', () => {
  const ridgeRows = (f, w, h) => {
    const horizon = Math.round(h * 0.375), rows = new Set();
    for (let i = 0; i < horizon * w; i++) if (f.c[i] === FAR) rows.add(Math.floor(i / w));
    return rows;
  };
  for (const T of [0, 12.5, 49.5]) {
    const f = frame(T, 80, 24);
    assert.equal(ridgeRows(f, 80, 24).size, 1, 'a one-row ridge');
    assert.equal([...ridgeRows(f, 80, 24)][0], Math.round(24 * 0.375) - 1, 'right above the horizon line');
    assert.equal(cellsOf(f, '▪', SUN[1]).length, 0, 'no city windows');
    assert.equal(f.c.filter((v) => v === NEAR).length, 0, 'no city');
    const top = 24 - 1 - 4;
    for (let j = 0; j < 4; j++) assert.ok(rowText(f, top + j).includes(S.REAR_20[j].trim()), `row ${j} of the 20x4 car`);
    for (let y = 0; y < 24; y++) assert.ok(!rowText(f, y).includes('NITE86'), 'no plate');
    assert.ok(rowText(f, 24 - 1).includes('░░░░'), 'the tail glow under it');
  }
  for (const [w, h] of [[120, 40], [240, 67], [100, 32]]) {
    for (const T of [0, 12.5, 49.5]) {
      const f = frame(T, w, h);
      const rows = ridgeRows(f, w, h);
      assert.ok(rows.size >= 2 && rows.size <= 4, `${w}x${h}: ridge rows ${[...rows]}`);
      const top = h - 1 - 7;
      for (let j = 0; j < 7; j++) assert.ok(rowText(f, top + j).includes(S.REAR_34[j].trim()), `${w}x${h} row ${j} of the 34x7 car`);
      assert.ok(rowText(f, top + 4).includes('NITE86'), 'the plate');
      const g = Rd.geometry(w, h);
      const city = [];
      for (let i = 0; i < g.horizon * w; i++) if (f.c[i] === NEAR) city.push(i % w);
      assert.ok(city.length > 30, 'a city');
      assert.ok(Math.min(...city) >= Math.floor(g.cx) - 16 && Math.max(...city) <= Math.floor(g.cx) + 16, 'in the middle');
      assert.ok(cellsOf(f, '▪', SUN[1]).length >= 3, 'with lit windows');
    }
  }
  // the ridge uses only safe glyphs: its tips are quadrants, its slopes are three-quarter blocks
  const used = new Set();
  for (const [w, h] of [[120, 40], [80, 24], [240, 67]]) {
    const f = frame(0, w, h);
    for (let i = 0; i < Math.round(h * 0.375) * w; i++) if (f.c[i] === FAR) used.add(String.fromCharCode(f.g[i]));
  }
  for (const ch of '▟▙▗▖') assert.ok(used.has(ch), `the ridge uses ${ch}`);
  assert.deepEqual([...used].filter((ch) => !'▟▙▗▖▄█'.includes(ch)), [], 'and only those and the solid blocks');
  const hg = ridgeOf(120, 40, 1);
  assert.equal(Math.max(...hg), 4);
  assert.equal(Math.max(...ridgeOf(80, 24, 1)), 1);
  assert.ok(Math.min(...hg) === 0 && hg.some((v) => v === 0), 'with valleys');
});

test('onramp (O10): the car sways one column left and back, eased in single steps, every 7 to 11 s (seeded)', () => {
  const plateX = (f, h) => rowText(f, h - 1 - 7 + 4).indexOf('NITE86');
  const base = plateX(frame(0), 40);
  assert.equal(base, Math.floor((120 - 34) / 2) + 14, 'centred when it is not swaying');
  for (const seed of [1, 2, 3]) {
    const starts = [], ends = [];
    let prev = 0;
    for (let k = 0; k <= 100 * FPS; k++) {
      const t = k / FPS;
      const off = plateX(frame(t, 120, 40, seed), 40) - base;
      assert.ok(off === 0 || off === -1, `seed ${seed} t=${t}: offset ${off}`);
      assert.equal(Math.abs(off - prev) <= 1, true, 'one step at a time');
      if (off === -1 && prev === 0) starts.push(t);
      if (off === 0 && prev === -1) ends.push(t);
      assert.equal(off, swayOffset(t, seed), 'and it is what swayOffset says');
      prev = off;
    }
    assert.ok(starts.length >= 8 && starts.length <= 14, `seed ${seed}: ${starts.length} sways in 100 s`);
    assert.ok(starts[0] >= 7 - 1 / FPS && starts[0] <= 11, `seed ${seed}: the first sway at ${starts[0]}`);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1];
      assert.ok(gap >= 7 - 1 / FPS && gap <= 11 + 1 / FPS, `seed ${seed}: gap ${gap.toFixed(2)} s`);
    }
    for (let i = 0; i < ends.length; i++) assert.ok(Math.abs(ends[i] - starts[i] - SWAY_HOLD) <= 1 / FPS + 1e-9, `seed ${seed}: held ${(ends[i] - starts[i]).toFixed(2)} s`);
    const model = swayStarts(seed, 100);
    assert.equal(model.length, starts.length);
    model.forEach((m, i) => assert.ok(Math.abs(m - starts[i]) <= 1 / FPS, `seed ${seed}: start ${i}`));
  }
  assert.notDeepEqual(swayStarts(1, 100).map((v) => v.toFixed(2)), swayStarts(2, 100).map((v) => v.toFixed(2)), 'the seed sets the schedule');
  // at 80x24 the 20-wide car sways the same way
  const base20 = rowText(frame(0, 80, 24), 24 - 1 - 4 + 2).indexOf('▐█');
  const s1 = swayStarts(1, 20)[0];
  assert.equal(rowText(frame(s1 + 0.1, 80, 24), 24 - 1 - 4 + 2).indexOf('▐█'), base20 - 1);
});

test('onramp: from 41 s and then every 45 s a car ahead shows as two tail lights at the horizon, grows as we close and slides past in the left lane', () => {
  assert.deepEqual([PASS_FIRST, PASS_PERIOD], [41, 45]);
  assert.equal(passAge(40.9), -1);
  assert.ok(Math.abs(passAge(41.2) - 0.2) < 1e-9);
  assert.ok(Math.abs(passAge(86.2) - 0.2) < 1e-9, 'again 45 s later');
  assert.equal(passAge(60), -1, 'and gone between passes');
  const g = Rd.geometry(120, 40);
  const lights = (T) => cellsOf(frame(T), '▪', CORAL[1]).filter(([x, y]) => y > g.horizon && !(x === Rd.post(g, T).x && y === Rd.post(g, T).foot));
  assert.equal(lights(40.9).length, 0, 'nothing before 41 s');
  const first = lights(41.3);
  assert.equal(first.length, 2, 'two tail lights');
  assert.equal(first[1][0] - first[0][0], 2, 'a cell apart');
  assert.ok(first[0][1] <= g.horizon + 2, 'at the horizon');
  const centre = Rd.laneCentre(g, first[0][1], 0);
  assert.ok(Math.abs((first[0][0] + first[1][0]) / 2 - centre) <= 1, 'in the left lane');
  // it only comes nearer: its foot row never goes back up
  let prev = 0;
  for (let k = 0; k <= 105; k++) { const r = passRow(g, k / 10); assert.ok(r >= prev, `row at ${k / 10}`); prev = r; }
  assert.equal(passRow(g, 10.5), g.horizon + g.below, 'and runs off the bottom edge');
  // the small and then the large picture are in the left lane, left of our car, at the right moments
  const find = (f, art) => {
    const rows = art.map((r) => r.trim());
    for (let y = 0; y + art.length <= f.h; y++) {
      const x = rowText(f, y).indexOf(rows[0]);
      if (x >= 0 && rows.every((r, j) => rowText(f, y + j).includes(r))) return [x, y];
    }
    return null;
  };
  let small = null, big = null;
  for (let k = 0; k < 10.5 * FPS; k++) {
    const f = frame(PASS_FIRST + k / FPS);
    if (!small && find(f, S.CAR_AHEAD_6)) small = k;
    if (!big && find(f, S.CAR_AHEAD_12.slice(0, 2))) big = k;
  }
  assert.ok(small && big && big > small, `small at frame ${small}, large at frame ${big}`);
  assert.ok(big / FPS >= 6 && big / FPS <= 10.5, `the large picture comes at ${(big / FPS).toFixed(1)} s into the pass`);
  const f = frame(PASS_FIRST + big / FPS);
  const at = find(f, S.CAR_AHEAD_12.slice(0, 2));
  assert.ok(at[0] + 6 < 60, 'left of the middle of the road');
  // nothing of it 12 s after it started
  assert.equal(find(frame(PASS_FIRST + 12), S.CAR_AHEAD_12.slice(0, 2)), null);
  assert.equal(find(frame(PASS_FIRST + 12), S.CAR_AHEAD_6), null);
  // at 80x24 it passes too, and the pass is inside the 60 s of O5 and O6 above
  assert.ok(cellsOf(frame(PASS_FIRST + 0.5, 80, 24), '▪', CORAL[1]).length >= 2);
});
