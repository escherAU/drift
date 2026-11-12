// DRIFT-7 C14: the Rosette (cartridges/driftman-9000/scenes/rosette.js), the owner's benchmark: a whole-screen kaleidoscope in
// full colour. This file holds what is fast and structural: purity, change per frame, intricacy, the fold schedule and its 3 s
// melt, the pure-red rule, size coverage, the cache. The flash meter, 256 colours, CPU and bytes are in
// driftman-9000-rosette-flash.test.js. The installed-cartridge suites (cartridge-scenes, cartridges) already run the scene through
// the shared checks; the placeholder-era checks (message below 60 x 20, determinism, buffer fill) stay in driftman-9000-cartridge.test.js.
// Every measured floor below is written next to the number it was set from ("measured").
import test from 'node:test';
import assert from 'node:assert/strict';
import { luminanceOf } from './helpers-flash.js';
import { RGB_CELL } from '../src/renderer.js';
import { safeHue } from '../src/pixels.js';
import rosette, {
  makeRosette, cacheFor, foldsAt, foldOf, meltDelay, fieldAt, phiOf, hash2, FOLDS, FOLD_SECONDS, MELT_SECONDS, MIN_W, MIN_H,
  FILL_L, CONTOUR_L, CONTOUR_TURN, CONTOUR_BAND, HUE_RATE, SINE, SINE_N,
} from '../cartridges/driftman-9000/scenes/rosette.js';

const FPS = 18;
const SENTINEL = 0x1ffffff;
function buffers(w, h) {
  const n = w * h;
  return { glyphs: new Uint16Array(n).fill(0x7e), colours: new Uint8Array(n).fill(7), fg: new Uint32Array(n).fill(SENTINEL), bg: new Uint32Array(n).fill(SENTINEL) };
}
function draw(scene, t, w, h, seed = 1, t0 = 0, params = null) {
  const p = params || buffers(w, h);
  p.seed = seed; p.t0 = t0;
  scene(t, w, h, p);
  return p;
}
const snap = (p) => ({ g: p.glyphs.slice(), fg: p.fg.slice(), bg: p.bg.slice() });

// ---- 1. pure in (seed, t - t0)

test('rosette purity: the same (seed, t - t0) gives the same frame at any t0 and after calls for other sizes and seeds; another seed and another time differ', () => {
  const a = snap(draw(rosette, 12.5, 80, 24, 1, 0));
  const eq = (b) => assert.deepEqual([...b.fg], [...a.fg]) || assert.deepEqual([...b.bg], [...a.bg]) || assert.deepEqual([...b.g], [...a.g]);
  eq(snap(draw(rosette, 12.5, 80, 24, 1, 0)));
  eq(snap(draw(rosette, 22.5, 80, 24, 1, 10)));
  draw(rosette, 3, 120, 40, 7, 0); draw(rosette, 9, 80, 24, 2, 0); draw(rosette, 4, 61, 21, 1, 0);
  eq(snap(draw(rosette, 12.5, 80, 24, 1, 0))); // after other sizes and seeds went through the cache
  const same = (b) => b.fg.every((v, i) => v === a.fg[i]) && b.bg.every((v, i) => v === a.bg[i]);
  assert.ok(!same(snap(draw(rosette, 12.5, 80, 24, 2, 0))), 'another seed differs');
  assert.ok(!same(snap(draw(rosette, 12.6, 80, 24, 1, 0))), 'another time differs');
  // t before t0 is scene time 0, never negative
  assert.deepEqual([...snap(draw(rosette, 3, 80, 24, 1, 10)).fg], [...snap(draw(rosette, 0, 80, 24, 1, 0)).fg]);
});

test('rosette purity: the same scene function built twice, and the shipped one, agree (the factory has no hidden state)', () => {
  const a = snap(draw(makeRosette(), 30.2, 100, 30, 3)), b = snap(draw(rosette, 30.2, 100, 30, 3));
  assert.deepEqual([...a.fg], [...b.fg]);
  assert.deepEqual([...a.bg], [...b.bg]);
});

// ---- 2. every cell changes every frame

test('rosette change: at least 95 % of cells change between consecutive frames at 18 fps over 60 s, at 120x40 and 240x67 (seeds 1 to 3)', () => {
  const lines = [];
  for (const [w, h] of [[120, 40], [240, 67]]) {
    for (const seed of [1, 2, 3]) {
      const p = buffers(w, h), n = w * h;
      let prev = null, min = 1, sum = 0, frames = 0;
      for (let k = 0; k <= 60 * FPS; k++) {
        draw(rosette, k / FPS, w, h, seed, 0, p);
        if (prev) {
          let ch = 0;
          for (let i = 0; i < n; i++) if (p.glyphs[i] !== prev.g[i] || p.fg[i] !== prev.fg[i] || p.bg[i] !== prev.bg[i]) ch++;
          min = Math.min(min, ch / n); sum += ch / n; frames++;
        }
        prev = snap(p);
      }
      lines.push(`${w}x${h} seed ${seed}: min ${(min * 100).toFixed(2)} % mean ${(100 * sum / frames).toFixed(2)} %`);
      assert.ok(min >= 0.95, `${w}x${h} seed ${seed}: only ${(min * 100).toFixed(2)} % of cells changed in the worst frame`);
    }
  }
  console.log('CHANGE per frame (measured min 96.43 to 97.29 % at HUE_RATE 200; the designer\'s 90 gave 83.5 %):\n  ' + lines.join('\n  '));
});

test('rosette change control: with the designer\'s drift of 90 degrees a second the worst frame changes under 95 % of cells (so the check can fail)', () => {
  // the same pixels with hue 90 T instead of HUE_RATE T: hue columns of cells whose own movement cancels the drift stay put
  const w = 120, h = 40, n = w * h;
  const c = cacheFor(w, h, 1), [p1, p2] = phiOf(1);
  const colour = (i, T, rate) => safeHue(200 + rate * T + 120 * fieldAt(c.r[i], c.ang[i], foldsAt(T).cur, T, p1, p2) + 40 * c.r[i], FILL_L);
  let worst = 1;
  for (let k = 400; k < 520; k++) {
    let ch = 0;
    for (let i = 0; i < n; i++) if (colour(i, k / FPS, 90) !== colour(i, (k - 1) / FPS, 90)) ch++;
    worst = Math.min(worst, ch / n);
  }
  assert.ok(worst < 0.95, `${worst}`);
});

// ---- 3. intricacy: not a flat wash

const hueOf = (c) => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return -1;
  const h = (mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return h < 0 ? h + 360 : h;
};

test('rosette intricacy: at seven times and three sizes the frame has all 36 ten-degree hue bins (floor 30), a wide hue spread (floor 90 degrees) and a real brightness spread (floor 0.006)', () => {
  const lines = [];
  for (const [w, h] of [[120, 40], [240, 67], [60, 20]]) {
    for (const t of [1, 7, 16, 25, 33, 47, 55]) {
      const p = draw(rosette, t, w, h), n = w * h;
      const bins = new Set();
      let sx = 0, sy = 0, cnt = 0;
      const Y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const half = p.glyphs[i] === 0x2580;
        for (const c of half ? [p.fg[i], p.bg[i]] : [p.bg[i]]) {
          const hh = hueOf(c);
          if (hh < 0) continue;
          bins.add(Math.floor(hh / 10)); sx += Math.cos((hh * Math.PI) / 180); sy += Math.sin((hh * Math.PI) / 180); cnt++;
        }
        Y[i] = half ? 0.5 * luminanceOf(p.fg[i]) + 0.5 * luminanceOf(p.bg[i]) : luminanceOf(p.bg[i]);
      }
      const sd = Math.sqrt(-2 * Math.log(Math.hypot(sx, sy) / cnt)) * (180 / Math.PI);
      let m = 0; for (const y of Y) m += y; m /= n;
      let v = 0; for (const y of Y) v += (y - m) ** 2;
      const ysd = Math.sqrt(v / n);
      lines.push(`${w}x${h} t=${t}: bins ${bins.size}/36 hue spread ${sd.toFixed(0)} deg brightness sd ${ysd.toFixed(4)}`);
      assert.ok(bins.size >= 30, `${w}x${h} t=${t}: ${bins.size} hue bins`);
      assert.ok(sd >= 90, `${w}x${h} t=${t}: hue spread ${sd}`);
      assert.ok(ysd >= 0.006, `${w}x${h} t=${t}: brightness sd ${ysd}`);
      assert.ok(m > 0.2 && m < 0.4, `${w}x${h} t=${t}: mean brightness ${m} (fills are held at L ${FILL_L})`);
    }
  }
  console.log('INTRICACY (measured: bins 36/36 everywhere, hue spread 105 to 146 deg, brightness sd 0.0089 to 0.0159 (the fills are all at one lightness; the spread is the contours)):\n  ' + lines.join('\n  '));
});

test('rosette contours: the share of pixels on a contour (|f| < 0.06) over a 75 s scan every 0.5 s, three seeds, 120x40 and 88x39: median under 8 %, worst under 15 %', () => {
  const lines = [];
  for (const [w, h] of [[120, 40], [88, 39]]) {
    for (const seed of [1, 2, 3]) {
      const c = cacheFor(w, h, seed), [p1, p2] = phiOf(seed);
      const shares = [];
      for (let t = 0; t <= 75; t += 0.5) {
        const fo = foldsAt(t);
        let cp = 0;
        for (let i = 0; i < c.n; i++) {
          const nn = fo.local < c.delay[i] ? fo.prev : fo.cur;
          if (Math.abs(fieldAt(c.r[i], c.ang[i], nn, t, p1, p2)) < CONTOUR_BAND) cp++;
        }
        shares.push(cp / c.n);
      }
      shares.sort((a, b) => a - b);
      const med = shares[shares.length >> 1], max = shares[shares.length - 1];
      lines.push(`${w}x${h} seed ${seed}: median ${(med * 100).toFixed(2)} % worst ${(max * 100).toFixed(2)} %`);
      assert.ok(med < 0.08, `${w}x${h} seed ${seed}: median ${med}`);
      assert.ok(max < 0.15, `${w}x${h} seed ${seed}: worst ${max}`);
    }
  }
  console.log('CONTOUR SHARE of pixels (measured: median 4.4 to 4.8 %; worst 10.2 to 14.1 % at the instants the field is flat over a wide area; the design note said "under 8 %" and that holds for the median only):\n  ' + lines.join('\n  '));
});

// ---- 4. the fold schedule and the 3 s melt

test('rosette folds: 6, 8, 12, 10 for 15 s each and round again; prev is the fold before; local runs 0 to 15', () => {
  assert.deepEqual([...FOLDS], [6, 8, 12, 10]);
  assert.equal(FOLD_SECONDS, 15); assert.equal(MELT_SECONDS, 3);
  const want = [[0, 6, 10], [14.99, 6, 10], [15, 8, 6], [29.99, 8, 6], [30, 12, 8], [44.99, 12, 8], [45, 10, 12], [59.99, 10, 12], [60, 6, 10], [75, 8, 6], [170, 10, 12]];
  for (const [T, cur, prev] of want) {
    const f = foldsAt(T);
    assert.equal(f.cur, cur, `T=${T}`); assert.equal(f.prev, prev, `T=${T}`);
    assert.ok(f.local >= 0 && f.local < 15, `T=${T} local ${f.local}`);
  }
  assert.ok(Math.abs(foldsAt(22).local - 7) < 1e-9);
});

test('rosette melt: after each change every pixel switches from the old fold to the new one at hash * 3 s: no frame moves more than 8 % of pixels (expected 1 / 54 = 1.9 % at 18 fps), none switches outside the 3 s, all are over by the end', () => {
  const W = 120, H = 80, seed = 1, n = W * H;
  for (const start of [15, 30, 45, 60]) {
    const newFold = foldsAt(start + 1).cur, oldFold = foldsAt(start - 1).cur;
    assert.notEqual(newFold, oldFold);
    let prevCount = null, worst = 0;
    for (let k = -3; k <= 3 * FPS + 3; k++) {
      const T = start + k / FPS + 1e-6;
      let on = 0;
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) if (foldOf(px, py, seed, T) === newFold) on++;
      if (prevCount !== null) worst = Math.max(worst, Math.abs(on - prevCount) / n);
      prevCount = on;
      if (k < 0) assert.equal(on, 0, `start ${start}: before the change no pixel is on the new fold`);
      if (T > start + MELT_SECONDS) assert.equal(on, n, `start ${start}: after the melt every pixel is on the new fold (T=${T.toFixed(3)})`);
    }
    console.log(`MELT start ${start} s: worst single-frame share of pixels switching ${(worst * 100).toFixed(2)} %`);
    assert.ok(worst < 0.08, `start ${start}: ${(worst * 100).toFixed(2)} % of pixels switched in one frame`);
    assert.ok(worst > 0.005, `start ${start}: the melt exists (${worst})`);
    for (const dt of [3.01, 5, 9, 14.9]) for (const [px, py] of [[0, 0], [5, 7], [60, 40], [119, 79]]) assert.equal(foldOf(px, py, seed, start + dt), newFold);
  }
  // delays span the whole 3 s and are even
  let lo = 9, hi = 0, sum = 0;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) { const d = meltDelay(px, py, seed); lo = Math.min(lo, d); hi = Math.max(hi, d); sum += d; }
  assert.ok(lo < 0.05 && hi > 2.95 && Math.abs(sum / n - 1.5) < 0.05, `delays ${lo} ${hi} ${sum / n}`);
  assert.equal(meltDelay(5, 7, 1), 3 * hash2(5, 7, 1));
});

test('rosette as drawn: every pixel of every cell is the colour the spec gives it, including in the middle of a melt (each pixel on its own fold at that instant)', () => {
  const w = 60, h = 20, hPx = 2 * h;
  for (const seed of [1, 4]) {
    const c = cacheFor(w, h, seed), [p1, p2] = phiOf(seed);
    for (const T of [0.3, 1.5, 2.9, 7, 15.2, 16.5, 17.9, 30.4, 31.5, 45.1, 46.5, 59, 60.5, 61.5, 62.9, 119.7]) {
      const p = draw(rosette, T, w, h, seed, 0);
      let wrong = 0, inMelt = 0;
      for (let py = 0; py < hPx; py++) {
        for (let px = 0; px < w; px++) {
          const i = py * w + px;
          const N = foldOf(px, py, seed, T);
          if (N !== foldsAt(T).cur) inMelt++;
          const f = fieldAt(c.r[i], c.ang[i], N, T, p1, p2);
          const hue = 200 + HUE_RATE * T + 120 * f + 40 * c.r[i];
          const want = f > -CONTOUR_BAND && f < CONTOUR_BAND ? safeHue(hue + CONTOUR_TURN, CONTOUR_L) : safeHue(hue, FILL_L);
          const cell = (py >> 1) * w + px;
          const got = py % 2 === 0 ? p.fg[cell] : (p.glyphs[cell] === 32 ? p.fg[cell] : p.bg[cell]);
          if (got !== want) wrong++;
        }
      }
      assert.equal(wrong, 0, `seed ${seed} T=${T}: ${wrong} pixels are not the spec colour`);
      if (T === 1.5 || T === 16.5 || T === 46.5) assert.ok(inMelt > 0, `T=${T}: some pixels are still on the old fold (${inMelt})`);
    }
  }
});

// ---- 5. the pure-red rule

const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const redShare = (c) => { const r = lin((c >> 16) & 255), g = lin((c >> 8) & 255), b = lin(c & 255); return r / (r + g + b); };

test('rosette red: no pixel, and no blended half-block cell, has a linear red share of 0.75 or more at any time, size or seed', () => {
  let worst = 0;
  for (const [w, h] of [[120, 40], [240, 67], [60, 20], [88, 39]]) {
    for (const seed of [1, 2]) {
      const p = buffers(w, h);
      for (let t = 0; t < 75; t += 1.37) {
        draw(rosette, t, w, h, seed, 0, p);
        for (let i = 0; i < w * h; i++) {
          const a = redShare(p.fg[i]), b = redShare(p.bg[i]);
          const bl = p.glyphs[i] === 0x2580
            ? (lin((p.fg[i] >> 16) & 255) + lin((p.bg[i] >> 16) & 255)) / (lin((p.fg[i] >> 16) & 255) + lin((p.bg[i] >> 16) & 255) + lin((p.fg[i] >> 8) & 255) + lin((p.bg[i] >> 8) & 255) + lin(p.fg[i] & 255) + lin(p.bg[i] & 255))
            : b;
          worst = Math.max(worst, a, b, bl);
        }
      }
    }
  }
  console.log(`RED worst linear red share ${worst.toFixed(4)} (limit: under 0.75; WCAG saturated red is 0.8)`);
  assert.ok(worst < 0.75, `${worst}`);
});

test('rosette red control: the same hue sweep without safeHue (plain OKLCH at the same lightness) does reach a saturated red, so the check can fail', () => {
  // the hue wheel at chroma 0.2 and L 0.66 passes through a red share over 0.75 somewhere; safeHue's table never does
  let bad = 0, safe = 0;
  for (let hDeg = 0; hDeg < 360; hDeg++) {
    const c = safeHue(hDeg, FILL_L);
    if (redShare(c) >= 0.75) safe++;
    const a = 0.2 * Math.cos((hDeg * Math.PI) / 180), b = 0.2 * Math.sin((hDeg * Math.PI) / 180), L = FILL_L;
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const R = Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), G = Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), B = Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
    if (R / (R + G + B) >= 0.75) bad++;
  }
  assert.equal(safe, 0);
  assert.ok(bad > 0, 'plain OKLCH at this lightness reaches a red share of 0.75 or more');
});

// ---- 6. sizes

test('rosette sizes: 0x0, 1x1, 59x19, 60x20, 61x21, 120x40, 240x67, 400x120 never throw and every cell is written (sentinels all gone)', () => {
  for (const [w, h] of [[0, 0], [1, 1], [0, 30], [30, 0], [59, 19], [60, 20], [61, 21], [120, 40], [240, 67], [400, 120], [2, 200]]) {
    for (const t of [0, 7.3, 31, 59.9]) {
      const p = draw(rosette, t, w, h, 1);
      assert.equal(p.glyphs.length, w * h);
      for (let i = 0; i < w * h; i++) {
        assert.ok(p.glyphs[i] === 32 || p.glyphs[i] === 0x2580 || w < MIN_W || h < MIN_H, `${w}x${h} cell ${i}`);
        assert.ok(p.fg[i] <= 0xffffff && p.bg[i] <= 0xffffff, `${w}x${h} t=${t}: cell ${i} was not written (fg ${p.fg[i]}, bg ${p.bg[i]})`);
        if (w >= MIN_W && h >= MIN_H) assert.equal(p.colours[i], RGB_CELL);
      }
    }
  }
});

test('rosette sizes: 60x20 is the first size with the picture (colour everywhere, no message), 59x19 and 60x19 and 59x20 the message (the size branch bites both ways)', () => {
  const msg = (w, h) => draw(rosette, 5, w, h).glyphs.some((g) => g === 'T'.charCodeAt(0));
  assert.equal(msg(59, 19), true); assert.equal(msg(60, 19), true); assert.equal(msg(59, 20), true);
  assert.equal(msg(60, 20), false); assert.equal(msg(61, 21), false);
  // 60x20: all 1200 cells are half blocks or spaces with colour, none is the dim background of the message
  const p = draw(rosette, 5, 60, 20);
  let lit = 0;
  for (let i = 0; i < 1200; i++) if (p.bg[i] !== 0x05060c) lit++;
  assert.ok(lit > 1190, `${lit}`);
});

// ---- 7. the cache

test('rosette cache: the same object for the same size and seed, rebuilt on a new size; frames never change it; r and theta are the geometry', () => {
  const a = cacheFor(120, 40, 1);
  assert.equal(cacheFor(120, 40, 1), a, 'same size, same seed: the same object');
  const r0 = a.r.slice(), g0 = a.ang.slice(), d0 = a.delay.slice();
  for (let k = 0; k < 40; k++) draw(rosette, k * 1.7, 120, 40, 1);
  assert.equal(cacheFor(120, 40, 1), a, 'drawing does not replace it');
  assert.deepEqual([...a.r], [...r0]); assert.deepEqual([...a.ang], [...g0]); assert.deepEqual([...a.delay], [...d0]);
  // the pixel buffer is reused frame to frame (no allocation per frame)
  const px = a.pixels;
  draw(rosette, 3, 120, 40, 1);
  assert.equal(cacheFor(120, 40, 1).pixels, px);
  // a new seed keeps the geometry arrays and changes only the delays
  const rr = a.r;
  const b = cacheFor(120, 40, 2);
  assert.equal(b, a); assert.equal(b.r, rr); assert.notDeepEqual([...b.delay], [...d0]);
  cacheFor(120, 40, 1);
  // a resize builds a new object with the new geometry
  const c = cacheFor(80, 24, 1);
  assert.notEqual(c, a);
  assert.equal(c.n, 80 * 48); assert.equal(c.r.length, 80 * 48);
  assert.notEqual(cacheFor(120, 40, 1), a, 'and the old size is rebuilt, not kept');
  // geometry: the centre is r ~ 0, the middle of the left edge is r = W / H_px
  const g = cacheFor(60, 20, 1);
  const mid = (20 - 1) * 60 + 0; // row just under the middle, first column
  assert.ok(Math.abs(g.r[mid] - (2 * Math.hypot(0.5 - 30, 20 + 0.5 - 20)) / 40) < 1e-5);
  assert.ok(g.r[19 * 60 + 29] < 0.06 && g.r[20 * 60 + 30] < 0.06);
});

test('rosette sine table: 4096 entries, one turn, equal to Math.sin at its entries; the drawn field stays within 0.012 of the straight maths', () => {
  assert.equal(SINE_N, 4096); assert.equal(SINE.length, 4096);
  let worst = 0;
  for (let i = 0; i < 4096; i++) worst = Math.max(worst, Math.abs(SINE[i] - Math.sin((i * 2 * Math.PI) / 4096)));
  assert.ok(worst < 1e-6, `${worst}`);
  // the drawn field equals the straight field to within the table's step: half a step (0.00077 rad) on each sine's argument,
  // magnified by the 11 r and 17 r factors and the nested cosine
  const c = cacheFor(80, 24, 1), [p1, p2] = phiOf(1);
  let max = 0;
  for (let k = 0; k < 400; k++) {
    const i = (k * 7919) % c.n, T = (k * 0.37) % 60, N = foldsAt(T).cur;
    const seg = (2 * Math.PI) / N, q = c.ang[i] + 0.05 * T, th = Math.abs(q - seg * Math.floor(q / seg) - seg / 2);
    const exact = Math.sin(5 * c.r[i] - 0.7 * T + 3 * Math.cos((N * th) / 2)) + 0.6 * Math.sin(11 * c.r[i] * Math.cos(th) + 0.4 * T + p1) + 0.4 * Math.sin(17 * c.r[i] * Math.sin(th) - 0.3 * T + p2);
    max = Math.max(max, Math.abs(exact - fieldAt(c.r[i], c.ang[i], N, T, p1, p2)));
  }
  console.log(`SINE TABLE: worst difference of the drawn field from Math.sin maths over 400 samples ${max.toFixed(5)} (in hue: ${(120 * max).toFixed(2)} degrees)`);
  assert.ok(max < 0.012, `field differs from the straight maths by ${max}`);
});

test('rosette constants: fill L 0.66, contour L 0.72 turned 180 degrees, band 0.06, hue rate 200; the shipped scene is the factory default', () => {
  assert.equal(FILL_L, 0.66); assert.equal(CONTOUR_L, 0.72); assert.equal(CONTOUR_TURN, 180); assert.equal(CONTOUR_BAND, 0.06); assert.equal(HUE_RATE, 200);
  assert.equal(rosette.id, 'rosette'); assert.equal(rosette.kind, 'cells'); assert.equal(rosette.rgb, true);
});
