// DRIFT-7 C15b: BLOOMFALL (cartridges/driftman-9000/scenes/bloomfall.js): blooms of colour opening over the huefield at L 0.22, pollen
// falling from them as they fade, pops of gold, mint and ion between. This file holds what is fast and structural: purity, the seeded
// spawns (statistics over many seeds), the envelope, the brightness of a large bloom as rendered, the pure-red rule, pops, pollen, sizes,
// change per frame and the look. The flash meter, 256 colours, CPU, bytes, the phase test and the dissolves are in
// driftman-9000-bloomfall-flash.test.js and driftman-9000-dissolve.test.js.
// Every measured floor below is written next to the number it was set from ("measured").
import test from 'node:test';
import assert from 'node:assert/strict';
import { luminanceOf } from './helpers-flash.js';
import { RGB_CELL } from '../src/renderer.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { safeHue, safeHueExact, HUE_COLS, L_ROWS } from '../src/pixels.js';
import { hueAt } from '../cartridges/driftman-9000/lib/huefield.js';
import bloomfall, * as bf from '../cartridges/driftman-9000/scenes/bloomfall.js';

const { plan, attemptCount, envelope, radiusAt, smoothstep, popsOf, popAmp, speckOf, speckState, MIN_W, MIN_H, MESSAGE, FIELD_L } = bf;
const FPS = 18;
const SENTINEL = 0x1ffffff;
const BANNED = ['∫', '≡', '◍', '◎', '◐', '◑', '◒', '◓', '◢', '◣'].map((c) => c.codePointAt(0));
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

// the image of safeHue: every colour it can return, at any lightness row
const IMAGE = new Set();
for (let r = 0; r < L_ROWS; r++) for (let h = 0; h < HUE_COLS; h++) IMAGE.add(safeHueExact(h, r / (L_ROWS - 1)));

// ---- 1. pure in (seed, t - t0)

test('bloomfall purity: the same (seed, t - t0) gives the same frame at any t0 and after calls for other sizes and seeds; another seed and another time differ', () => {
  const a = snap(draw(bloomfall, 12.5, 80, 24, 1, 0));
  const eq = (b) => assert.deepEqual([...b.fg], [...a.fg]) || assert.deepEqual([...b.bg], [...a.bg]) || assert.deepEqual([...b.g], [...a.g]);
  eq(snap(draw(bloomfall, 12.5, 80, 24, 1, 0)));
  eq(snap(draw(bloomfall, 22.5, 80, 24, 1, 10)));
  draw(bloomfall, 3, 120, 40, 7, 0); draw(bloomfall, 99, 80, 24, 2, 0); draw(bloomfall, 4, 61, 21, 1, 0); draw(bloomfall, 400, 80, 24, 1, 0);
  eq(snap(draw(bloomfall, 12.5, 80, 24, 1, 0))); // after other sizes, seeds and a later time went through the caches
  const same = (b) => b.fg.every((v, i) => v === a.fg[i]) && b.bg.every((v, i) => v === a.bg[i]);
  assert.ok(!same(snap(draw(bloomfall, 12.5, 80, 24, 2, 0))), 'another seed differs');
  assert.ok(!same(snap(draw(bloomfall, 12.6, 80, 24, 1, 0))), 'another time differs');
  assert.deepEqual([...snap(draw(bloomfall, 3, 80, 24, 1, 10)).fg], [...snap(draw(bloomfall, 0, 80, 24, 1, 0)).fg], 't before t0 is scene time 0');
});

test('bloomfall purity: going backwards in time gives the frames it gave going forwards (the spawn plan is a memo of a fixed sequence, never a state)', () => {
  const fwd = [];
  for (let k = 0; k <= 40; k++) fwd.push(snap(draw(bloomfall, k * 1.7, 100, 30, 5)));
  for (let k = 40; k >= 0; k--) {
    const b = snap(draw(bloomfall, k * 1.7, 100, 30, 5));
    assert.deepEqual([...b.fg], [...fwd[k].fg], `t=${k * 1.7}`);
    assert.deepEqual([...b.g], [...fwd[k].g]);
  }
});

// ---- 2. the seeded spawns

const SIZES_SPAWN = [[60, 20], [120, 40], [240, 67], [88, 39]];

test('bloomfall spawns: over 240 seeds and 600 s the Poisson arrivals average 0.8 a second (within 2 %), exponential gaps', () => {
  let n = 0, sec = 0;
  const gaps = [];
  for (let seed = 1; seed <= 240; seed++) {
    const c = attemptCount(seed, 600);
    n += c; sec += 600;
  }
  const rate = n / sec;
  console.log(`SPAWN arrivals: ${n} in ${sec} s over 240 seeds = ${rate.toFixed(4)} per second (target 0.8)`);
  assert.ok(Math.abs(rate - 0.8) < 0.016, `${rate}`);
  // the spread of a Poisson count: variance close to the mean over seeds
  const counts = []; for (let seed = 1; seed <= 240; seed++) counts.push(attemptCount(seed, 600));
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length, v = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
  console.log(`SPAWN count per 600 s: mean ${mean.toFixed(1)} variance ${v.toFixed(1)} (Poisson: equal)`);
  assert.ok(v / mean > 0.7 && v / mean < 1.4, `${v / mean}`);
  void gaps;
});

test('bloomfall spawns: never more than 4 alive, centres at least 20 columns apart while both live, petals 5 to 9, R_max 6 to 18 rows (and inside the screen), at four sizes and 60 seeds of 300 s', () => {
  const lines = [];
  for (const [w, h] of SIZES_SPAWN) {
    let maxAlive = 0, minGap = 1e9, total = 0, attempts = 0;
    const petals = new Set(), rmaxes = [], pollen = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const P = plan(seed, w, h, 300);
      const bl = P.blooms.filter((b) => b.start <= 300);
      total += bl.length; attempts += attemptCount(seed, 300);
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        // alive at the instant b is born: itself and every earlier bloom born less than BLOOM_LIFE seconds before
        let alive = 0;
        for (let j = 0; j <= i; j++) if (b.start - bl[j].start < bf.BLOOM_LIFE) alive++;
        maxAlive = Math.max(maxAlive, alive);
        for (let j = 0; j < i; j++) if (b.start - bl[j].start < bf.BLOOM_LIFE) minGap = Math.min(minGap, Math.abs(b.cx - bl[j].cx));
        petals.add(b.k); rmaxes.push(b.rmax); pollen.add(b.np);
        assert.ok(Number.isInteger(b.k) && b.k >= 5 && b.k <= 9, `k ${b.k}`);
        assert.ok(b.rmax >= 6 && b.rmax <= 18, `rmax ${b.rmax}`);
        assert.ok(b.rmax <= Math.max(6, 0.42 * h) + 1e-9, `${w}x${h}: rmax ${b.rmax} is taller than the screen allows`);
        assert.ok(b.cx >= 0 && b.cx < w && b.cy >= 0 && b.cy < h, `centre ${b.cx},${b.cy}`);
        assert.ok(b.np >= 20 && b.np <= 40, `pollen ${b.np}`);
      }
    }
    const perSec = total / (60 * (300 + bf.PRE_ROLL));
    lines.push(`${w}x${h}: ${total} blooms in 60 seeds x 300 s = ${perSec.toFixed(3)} accepted per second (arrivals ${(attempts / (60 * 300)).toFixed(3)}), max alive ${maxAlive}, min centre gap ${minGap} columns, petals ${[...petals].sort().join('')}, R_max ${Math.min(...rmaxes).toFixed(1)}..${Math.max(...rmaxes).toFixed(1)}`);
    assert.ok(maxAlive <= 4 && maxAlive >= 3, `${w}x${h}: max alive ${maxAlive}`);
    assert.ok(minGap >= 20, `${w}x${h}: min gap ${minGap}`);
    assert.deepEqual([...petals].sort(), [5, 6, 7, 8, 9]);
    assert.ok(Math.min(...rmaxes) < 7.5 || h < 40, `${w}x${h}: small blooms exist`);
    assert.ok(Math.max(...rmaxes) > Math.min(17, 0.42 * h) - 1.5, `${w}x${h}: big blooms exist`);
    assert.ok(pollen.size > 15, 'pollen counts vary');
  }
  console.log('SPAWN statistics:\n  ' + lines.join('\n  '));
});

test('bloomfall spawns control: arrivals taken as they come (no cap, no spacing rule) do break both rules, so the checks above can fail', () => {
  // the same arrival times, every one accepted, centres anywhere
  let over = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = [];
    for (let i = 0; i < 400; i++) t.push(bf.arrivalTime(seed, i));
    for (let i = 0; i < t.length; i++) { let alive = 0; for (let j = 0; j <= i; j++) if (t[i] - t[j] < bf.BLOOM_LIFE) alive++; if (alive > 4) { over++; break; } }
  }
  assert.ok(over >= 15, `${over} of 20 seeds exceed 4 alive when nothing is refused`);
});

test('bloomfall spawns: the plan is the same for the same (seed, size) however it is reached; another seed or size differs; spawns start before 0 (a screen with blooms already open)', () => {
  const a = plan(3, 120, 40, 90).blooms.map((b) => [b.start, b.cx, b.cy, b.k, b.rmax, b.hue]).filter((b) => b[0] <= 90);
  plan(3, 80, 24, 400); plan(4, 120, 40, 500);
  const b = plan(3, 120, 40, 90).blooms.map((x) => [x.start, x.cx, x.cy, x.k, x.rmax, x.hue]).filter((x) => x[0] <= 90);
  assert.deepEqual(b, a);
  const c = plan(4, 120, 40, 90).blooms.map((x) => [x.start, x.cx]).filter((x) => x[0] <= 90);
  assert.notDeepEqual(c, a.map((x) => [x[0], x[1]]));
  assert.ok(plan(3, 120, 40, 0).blooms.some((x) => x.start < 0 && x.start > -bf.BLOOM_LIFE), 'a bloom is already open at t = 0');
  // frame 0 of a fresh scene is not empty: some pixels are not the field
  const p = draw(bloomfall, 0, 120, 40, 3);
  let bright = 0;
  for (let i = 0; i < 4800; i++) if (luminanceOf(p.bg[i]) > 0.03) bright++;
  assert.ok(bright > 100, `${bright} bright cells at t = 0`);
});

test('bloomfall bloom parameters: magenta is slow and small (R_max 9 or less, hue turn 40 degrees a second), every other bloom 120 degrees a second; hues come from the red-safe set', () => {
  assert.equal(bf.TURN_RATE, 120); assert.equal(bf.MAGENTA_TURN_RATE, 40);
  let mags = 0, others = 0;
  for (let seed = 1; seed <= 60; seed++) {
    for (const b of plan(seed, 240, 67, 300).blooms) {
      assert.ok(bf.HUES.includes(b.hue), `${b.hue}`);
      if (b.hue === bf.MAGENTA) { mags++; assert.ok(b.rmax <= 9, `magenta bloom ${b.rmax}`); assert.equal(b.turn, 40); } else { others++; assert.equal(b.turn, 120); }
    }
  }
  console.log(`BLOOM hues: ${mags} magenta of ${mags + others}`);
  assert.ok(mags > 0 && others > mags);
  for (const h of bf.HUES) assert.ok(IMAGE.has(safeHue(h, 0.5)));
});

// ---- 3. the envelope and the radius

test('bloomfall envelope: E = smoothstep(0, 1.5, tau) (1 - smoothstep(3.5, 6, tau)): 0 at both ends, 1 from 1.5 s to 3.5 s, smooth ends, always within 0..1; rise 1.5 s, fall 2.5 s, period 6 s', () => {
  assert.equal(smoothstep(0, 1, -1), 0); assert.equal(smoothstep(0, 1, 2), 1); assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(envelope(-1), 0); assert.equal(envelope(0), 0); assert.equal(envelope(1.5), 1); assert.equal(envelope(2.5), 1); assert.equal(envelope(3.5), 1);
  assert.equal(envelope(6), 0); assert.equal(envelope(7), 0);
  assert.equal(bf.RISE, 1.5); assert.equal(bf.FALL_FROM, 3.5); assert.equal(bf.FALL_TO, 6);
  let prev = 0;
  for (let tau = 0; tau <= 1.5; tau += 0.01) { const e = envelope(tau); assert.ok(e >= prev - 1e-12, `rising at ${tau}`); prev = e; }
  for (let tau = 1.5; tau <= 3.5; tau += 0.01) assert.ok(Math.abs(envelope(tau) - 1) < 1e-12);
  prev = 1;
  for (let tau = 3.5; tau <= 6; tau += 0.01) { const e = envelope(tau); assert.ok(e <= prev + 1e-12, `falling at ${tau}`); prev = e; }
  for (let tau = -3; tau <= 12; tau += 0.003) { const e = envelope(tau); assert.ok(e >= 0 && e <= 1, `${tau}: ${e}`); }
  // smooth ends: the slope at 0, 1.5, 3.5 and 6 is zero
  for (const at of [0, 1.5, 3.5, 6]) assert.ok(Math.abs(envelope(at + 1e-4) - envelope(at - 1e-4)) < 1e-5, `slope at ${at}`);
  // the steepest slope: a smoothstep over 1.5 s peaks at 1.5 / 1.5 = 1 per second, over 2.5 s at 0.6
  let up = 0, down = 0;
  for (let tau = 0; tau < 6; tau += 0.001) { const d = (envelope(tau + 0.001) - envelope(tau)) / 0.001; if (d > 0) up = Math.max(up, d); else down = Math.max(down, -d); }
  console.log(`ENVELOPE steepest rise ${up.toFixed(3)} per s, steepest fall ${down.toFixed(3)} per s`);
  assert.ok(Math.abs(up - 1) < 0.01 && Math.abs(down - 0.6) < 0.01);
});

test('bloomfall radius: R(tau) = R_max (1 - e^(-tau/1.2)): 0 at birth, 63 % at 1.2 s, nearly full by 4 s; never over R_max', () => {
  assert.equal(radiusAt(12, 0), 0);
  assert.ok(Math.abs(radiusAt(12, 1.2) - 12 * (1 - Math.exp(-1))) < 1e-9);
  assert.ok(radiusAt(12, 4) > 12 * 0.96 && radiusAt(12, 4) < 12);
  for (let tau = 0; tau < 10; tau += 0.1) assert.ok(radiusAt(7, tau) <= 7);
});

// ---- 4. what is drawn

// luminance of a cell as the meter sees it: a half block is the mean of its two halves
const cellY = (p, i) => (p.glyphs[i] === 0x2580 ? 0.5 * luminanceOf(p.fg[i]) + 0.5 * luminanceOf(p.bg[i]) : luminanceOf(p.bg[i]));

test('bloomfall field: outside every bloom a pixel is exactly the huefield at L 0.22 (the hue the lib gives, through safeHue); inside a bloom, away from the rim, it is not', () => {
  const w = 120, h = 40, seed = 2;
  let outside = 0, inside = 0;
  for (const T of [1.3, 4.1, 7.7, 12.4, 20.2]) {
    const p = draw(bloomfall, T, w, h, seed);
    const blooms = plan(seed, w, h, T).blooms.filter((b) => T - b.start >= 0 && T - b.start < bf.BLOOM_LIFE + 0.5);
    for (let py = 0; py < 2 * h; py++) {
      for (let px = 0; px < w; px += 3) {
        // the colour of this pixel in the buffer
        const i = (py >> 1) * w + px;
        if (p.glyphs[i] !== 0x2580 && p.glyphs[i] !== 32) continue; // pollen or a pop sits here
        const got = py % 2 === 0 ? p.fg[i] : (p.glyphs[i] === 32 ? p.fg[i] : p.bg[i]);
        let near = false, far = true;
        for (const b of blooms) {
          const tau = T - b.start, R = radiusAt(b.rmax, tau);
          const d = Math.hypot(px + 0.5 - (b.cx + 0.5), py + 0.5 - (2 * b.cy + 1)) / 2;
          if (d < R * 1.02 + 0.8) far = false;
          if (d < R * 0.28 && tau > 1 && envelope(tau) > 0.3) near = true; // petals reach in to 0.3 R at the least
        }
        const field = safeHue(hueAt(px + 0.5, (py + 0.5) / 2, T, seed), FIELD_L);
        if (far) { outside++; assert.equal(got, field, `T=${T} px ${px},${py}`); } else if (near) { inside++; assert.notEqual(got, field, `T=${T} px ${px},${py}: a bloom is here`); }
      }
    }
  }
  assert.ok(outside > 2000 && inside > 200, `${outside} outside, ${inside} inside samples`);
});

test('bloomfall blooms as drawn: a pixel is inside when r <= R(tau)(0.65 + 0.35 cos(k theta + 0.3 tau)) (checked away from the rim, one bloom alone), and its colour is safeHue of the mix of the bloom hue h + 60 r/R + turn tau and the field hue by the envelope', () => {
  const w = 120, h = 40, seed = 1;
  let ins = 0, outs = 0;
  for (let s = 1; s <= 6; s++) {
    for (const b of plan(s, w, h, 40).blooms) {
      if (b.start < 0 || b.start > 25) continue;
      for (const dtau of [1, 2.2, 3.2, 4.4]) {
        const T = b.start + dtau;
        const others = plan(s, w, h, T).blooms.filter((o) => o !== b && T - o.start >= 0 && T - o.start < bf.BLOOM_LIFE + 0.5);
        const p = draw(bloomfall, T, w, h, s);
        const tau = dtau, R = radiusAt(b.rmax, tau), E = envelope(tau);
        for (let py = 0; py < 2 * h; py += 2) {
          for (let px = 0; px < w; px++) {
            const dx = px + 0.5 - (b.cx + 0.5), dy = py + 0.5 - (2 * b.cy + 1);
            const r = Math.hypot(dx, dy) / 2;
            if (others.some((o) => Math.hypot(px + 0.5 - (o.cx + 0.5), py + 0.5 - (2 * o.cy + 1)) / 2 < radiusAt(o.rmax, T - o.start) + 1.5)) continue;
            const th = Math.atan2(dy, dx);
            const edge = R * (0.65 + 0.35 * Math.cos(b.k * th + 0.3 * tau));
            if (Math.abs(r - edge) < 0.9) continue; // the rim, where the table cosine may tip a pixel
            const i = (py >> 1) * w + px;
            if (p.glyphs[i] !== 0x2580 && p.glyphs[i] !== 32) continue;
            const got = p.glyphs[i] === 32 ? p.fg[i] : p.fg[i];
            const hF = hueAt(px + 0.5, (py + 0.5) / 2, T, s);
            if (r > edge) { outs++; assert.equal(got, safeHue(hF, FIELD_L), `outside, seed ${s} T=${T} ${px},${py}`); continue; }
            ins++;
            const ratio = r / R, m = smoothstep(0, 0.2, E);
            const Lb = 0.18 + 0.5 * E * (1 - 0.4 * ratio), L = FIELD_L + m * (Lb - FIELD_L);
            if (L <= FIELD_L) continue;
            const hB = b.hue + 60 * ratio + b.turn * tau;
            const delta = ((((hB - hF) % 360) + 540) % 360) - 180;
            const want = safeHue(hF + m * delta, L);
            // the table cosine and sine move a pixel's hue by a few tenths of a degree, so compare in hue-and-lightness cells: allow the neighbours
            const near = [-2, -1, 0, 1, 2].some((dh) => [-1, 0, 1].some((dl) => safeHue(hF + m * delta + dh, L + dl / 63) === got));
            assert.ok(near, `inside, seed ${s} T=${T} ${px},${py}: got ${got.toString(16)} want ${want.toString(16)}`);
          }
        }
      }
    }
  }
  console.log(`BLOOM as drawn: ${ins} inside pixels and ${outs} outside pixels match the spec`);
  assert.ok(ins > 3000 && outs > 3000, `${ins} ${outs}`);
});

test('bloomfall brightness as rendered: the centre of a large bloom (R_max 12 or more, nothing else near) brightens over a 1.5 s ramp and darkens over a 2.5 s one, measured on the rendered luminance of its centre cell', () => {
  const w = 120, h = 40;
  let found = null;
  for (let s = 1; s <= 80 && !found; s++) {
    const bl = plan(s, w, h, 200).blooms;
    for (const b of bl) {
      if (b.start < 2 || b.start > 150 || b.rmax < 12 || b.hue === bf.MAGENTA) continue;
      const clear = bl.every((o) => o === b || Math.abs(o.start - b.start) > 7 || Math.hypot(o.cx - b.cx, 2 * (o.cy - b.cy)) / 2 > o.rmax + 2); // nothing else reaches its centre while it lives
      if (clear) { found = { s, b }; break; }
    }
  }
  assert.ok(found, 'a large clear bloom exists in 80 seeds');
  const { s, b } = found;
  const ci = b.cy * w + b.cx;
  const ys = [], taus = [];
  for (let k = 0; ; k++) {
    const tau = k / FPS;
    if (tau > 6.6) break;
    const p = draw(bloomfall, b.start + tau, w, h, s);
    // a pop or a speck of pollen passing over the cell is not the bloom: those frames keep the bloom's last reading
    const g = p.glyphs[ci];
    ys.push(g === 0x2580 || g === 32 ? cellY(p, ci) : ys.length ? ys[ys.length - 1] : cellY(p, ci)); taus.push(tau);
  }
  // the same measures on the rendered series and on the ideal one the spec gives: the centre of a bloom (r = 0) is at L 0.18 + 0.5 E, mixed into the field's L 0.22 by m(E)
  const measure = (series) => {
    const lo = Math.min(...series), hi = Math.max(...series), range = hi - lo;
    const iPeak = series.indexOf(hi);
    let k10 = 0, k90 = 0, f90 = iPeak, f10 = series.length - 1, first = 0, full = 0, lastFull = iPeak, lastDim = series.length - 1;
    while (series[k10] < lo + 0.1 * range) k10++;
    k90 = k10; while (series[k90] < lo + 0.9 * range) k90++;
    for (let k = series.length - 1; k >= 0; k--) if (series[k] >= lo + 0.9 * range) { f90 = k; break; }
    f10 = f90; while (f10 < series.length && series[f10] > lo + 0.1 * range) f10++;
    while (series[first] <= lo + 0.02 * range) first++;
    while (series[full] < hi - 0.02 * range) full++;
    for (let k = series.length - 1; k >= 0; k--) if (series[k] >= hi - 0.02 * range) { lastFull = k; break; }
    for (let k = series.length - 1; k >= 0; k--) if (series[k] > lo + 0.02 * range) { lastDim = k; break; }
    return { lo, hi, range, rise: (k90 - k10) / FPS, fall: (f10 - f90) / FPS, ramp: (full - first) / FPS, down: (lastDim - lastFull) / FPS, period: (lastDim - first) / FPS };
  };
  const ideal = taus.map((tau) => { const E = envelope(tau), m = smoothstep(0, 0.2, E); return Math.max(FIELD_L, FIELD_L + m * (0.18 + 0.5 * E - FIELD_L)) ** 3; });
  const got = measure(ys), want = measure(ideal);
  const f2 = (m) => `rise 10-90 % ${m.rise.toFixed(2)} s, fall 90-10 % ${m.fall.toFixed(2)} s, first change to full ${m.ramp.toFixed(2)} s, full to dark ${m.down.toFixed(2)} s, period ${m.period.toFixed(2)} s`;
  console.log(`BLOOM large (seed ${s}, R_max ${b.rmax.toFixed(1)}, k ${b.k}) centre cell Y ${got.lo.toFixed(4)} .. ${got.hi.toFixed(4)}
  rendered: ${f2(got)}
  the spec's own ramps: ${f2(want)}`);
  assert.ok(got.range > 0.15, `a big swing to look at (${got.range})`);
  // brighten >= 1.5 s, darken >= 2.5 s: the render must be no faster than the spec's envelope in any of the five measures (two frames of slack for the lightness rows and the hue's small share of brightness)
  for (const key of ['rise', 'fall', 'ramp', 'down', 'period']) assert.ok(got[key] >= want[key] - 2 / FPS, `${key}: rendered ${got[key]} against the spec's ${want[key]}`);
  assert.ok(got.period >= 4, `period ${got.period}`);
  const range = got.range;
  // rising and falling are steady: no frame moves the luminance by more than the spec's own ramp does (0.0355 of 0.31 at the steepest), plus 0.02 for safeHue's own spread (at L 0.6 to 0.7 the luminance of the 360 hues spans +-0.006, and the hue is turning)
  let stepIdeal = 0, stepGot = 0;
  for (let k = 1; k < ys.length; k++) { stepIdeal = Math.max(stepIdeal, Math.abs(ideal[k] - ideal[k - 1])); stepGot = Math.max(stepGot, Math.abs(ys[k] - ys[k - 1])); }
  console.log(`  steepest step per frame: rendered ${stepGot.toFixed(4)}, the spec's ${stepIdeal.toFixed(4)} (range ${range.toFixed(3)}; the meter's swing is 0.10)`);
  assert.ok(stepGot <= stepIdeal * 1.1 + 0.02, `${stepGot} against ${stepIdeal}`);
});

test('bloomfall brightness control: a bloom whose envelope is 0.5 s up and 0.5 s down moves the same cell by far more per frame (so the step check above can fail)', () => {
  const E = (tau) => smoothstep(0, 0.5, tau) * (1 - smoothstep(0.5, 1, tau));
  let steepest = 0;
  for (let tau = 0; tau < 1; tau += 1 / FPS) steepest = Math.max(steepest, Math.abs(E(tau + 1 / FPS) - E(tau)));
  let real = 0;
  for (let tau = 0; tau < 6; tau += 1 / FPS) real = Math.max(real, Math.abs(envelope(tau + 1 / FPS) - envelope(tau)));
  assert.ok(steepest > 0.15 && real < 0.06 && steepest > 2.5 * real, `${steepest} ${real}`);
});

// ---- 5. the pure-red rule and the image of safeHue

const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const redShare = (c) => { const r = lin((c >> 16) & 255), g = lin((c >> 8) & 255), b = lin(c & 255); return r / (r + g + b); };

test('bloomfall red: no pixel and no blended half-block cell has a linear red share of 0.75 or more at any time, size or seed; every colour on screen is a safeHue colour', () => {
  let worst = 0, foreign = 0, cells = 0;
  for (const [w, h] of [[120, 40], [240, 67], [60, 20], [88, 39]]) {
    for (const seed of [1, 2, 3]) {
      const p = buffers(w, h);
      for (let t = 0; t < 70; t += 0.37) {
        draw(bloomfall, t, w, h, seed, 0, p);
        for (let i = 0; i < w * h; i++) {
          cells++;
          const a = redShare(p.fg[i]), b = redShare(p.bg[i]);
          const bl = p.glyphs[i] === 0x2580
            ? (lin((p.fg[i] >> 16) & 255) + lin((p.bg[i] >> 16) & 255)) / (lin((p.fg[i] >> 16) & 255) + lin((p.bg[i] >> 16) & 255) + lin((p.fg[i] >> 8) & 255) + lin((p.bg[i] >> 8) & 255) + lin(p.fg[i] & 255) + lin(p.bg[i] & 255))
            : b;
          worst = Math.max(worst, a, b, bl);
          if (!IMAGE.has(p.fg[i]) || !IMAGE.has(p.bg[i])) foreign++;
        }
      }
    }
  }
  console.log(`RED worst linear red share ${worst.toFixed(4)} (limit under 0.75; WCAG saturated red is 0.8); ${foreign} of ${cells} cells held a colour outside the safeHue image`);
  assert.ok(worst < 0.75, `${worst}`);
  assert.equal(foreign, 0);
});

test('bloomfall red control: the same bloom hues through plain OKLCH (no safeHue) at the bloom lightness do reach a saturated red', () => {
  let bad = 0;
  for (let hDeg = 0; hDeg < 360; hDeg++) {
    const a = 0.2 * Math.cos((hDeg * Math.PI) / 180), b = 0.2 * Math.sin((hDeg * Math.PI) / 180), L = 0.6;
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const R = Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), G = Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), B = Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
    if (R / (R + G + B) >= 0.75) bad++;
  }
  assert.ok(bad > 0);
});

// ---- 6. pops

const POP_GLYPHS = ['◆', '+', '·', '×'].map((c) => c.codePointAt(0));

test('bloomfall pops: 2 to 6 begin every second, 1 to 3 cells each, glyphs from the diamond, plus, middle dot and cross, gold, mint or ion; allowed glyphs only', () => {
  const counts = new Set(), sizes = new Set(), hues = new Set(), glyphs = new Set();
  for (const seed of [1, 2, 3, 9]) {
    for (let sec = 0; sec < 400; sec++) {
      const ps = popsOf(seed, 120, 40, sec);
      counts.add(ps.length);
      assert.ok(ps.length >= 2 && ps.length <= 6, `${ps.length}`);
      for (const p of ps) {
        assert.ok(p.t >= sec && p.t < sec + 1, `starts inside its second (${p.t})`);
        assert.ok(p.n >= 1 && p.n <= 3); sizes.add(p.n);
        assert.ok(p.x >= 0 && p.x + p.n <= 120 && p.y >= 0 && p.y < 40);
        hues.add(p.hue);
        for (const g of p.glyphs) { glyphs.add(g); assert.ok(POP_GLYPHS.includes(g), String.fromCodePoint(g)); assert.ok(isAllowedGlyph(g)); assert.ok(!BANNED.includes(g)); }
      }
    }
  }
  assert.deepEqual([...counts].sort(), [2, 3, 4, 5, 6]);
  assert.deepEqual([...sizes].sort(), [1, 2, 3]);
  assert.deepEqual([...hues].sort((a, b) => a - b), [...bf.POP_HUES].sort((a, b) => a - b));
  assert.equal(glyphs.size, 4);
  const mean = [1, 2, 3].map((s) => { let n = 0; for (let sec = 0; sec < 400; sec++) n += popsOf(s, 120, 40, sec).length; return n / 400; });
  console.log(`POPS mean per second ${mean.map((x) => x.toFixed(2)).join(' ')} (2 to 6: mean 4)`);
  assert.ok(mean.every((m) => m > 3.6 && m < 4.4));
});

test('bloomfall pop ramp: up in 0.1 s, down over 0.5 s, 0 before and after; at 18 fps a pop shows on at least 3 frames at every clock phase (measured 10)', () => {
  assert.equal(bf.POP_UP, 0.1); assert.equal(bf.POP_DOWN, 0.5);
  assert.equal(popAmp(-0.01), 0); assert.equal(popAmp(0), 0); assert.ok(Math.abs(popAmp(0.1) - 1) < 1e-9); assert.equal(popAmp(0.6), 0); assert.equal(popAmp(1), 0);
  let prev = 0;
  for (let k = 0; k <= 20; k++) { const v = popAmp(k * 0.005); assert.ok(v >= prev - 1e-12, `up at ${k}`); prev = v; }
  for (let k = 20; k <= 120; k++) { const v = popAmp(k * 0.005); assert.ok(v <= prev + 1e-12, `down at ${k}: ${v} after ${prev}`); prev = v; }
  let fewest = 99;
  for (let ph = 0; ph < 1; ph += 0.05) {
    let shown = 0;
    for (let k = 0; k < 20; k++) if (popAmp(k / FPS + ph / FPS) > bf.POP_MIN_AMP) shown++;
    fewest = Math.min(fewest, shown);
  }
  console.log(`POP frames shown at 18 fps: fewest over 20 clock phases ${fewest}`);
  assert.ok(fewest >= 3, `${fewest}`);
});

test('bloomfall pops as drawn: a pop appears on at least 3 consecutive frames at 18 fps, in its colour, in its cells, and only its cells; its brightest frame is at 0.1 s', () => {
  const w = 120, h = 40, seed = 4;
  const ps = [...popsOf(seed, w, h, 5), ...popsOf(seed, w, h, 6)].filter((p) => p.t < 7);
  assert.ok(ps.length >= 4);
  for (const pop of ps) {
    const runs = [];
    let best = 0, bestAge = 0;
    for (let k = -2; k <= 14; k++) {
      const T = pop.t + k / FPS;
      const p = draw(bloomfall, T, w, h, seed);
      const i = pop.y * w + pop.x;
      const on = p.glyphs[i] === pop.glyphs[0];
      runs.push(on ? 1 : 0);
      if (on) { const y = luminanceOf(p.fg[i]); if (y > best) { best = y; bestAge = k / FPS; } }
    }
    const longest = runs.join('').split('0').reduce((a, s) => Math.max(a, s.length), 0);
    assert.ok(longest >= 3, `pop at ${pop.t} (${pop.x},${pop.y}): shown ${runs.join('')}`);
    assert.ok(bestAge >= 0 && bestAge <= 0.2, `brightest at ${bestAge}`);
  }
});

// ---- 7. pollen

test('bloomfall pollen: 20 to 40 specks per bloom, released when it starts to fade, fall 3 rows a second with sway, fade over 3 s', () => {
  assert.equal(bf.POLLEN_FALL, 3); assert.equal(bf.POLLEN_LIFE, 3);
  const b = plan(2, 120, 40, 60).blooms.find((x) => x.start > 5);
  const out = new Float64Array(8);
  let swayMax = 0;
  for (let i = 0; i < b.np; i++) {
    speckOf(b, i, out);
    const [x0, y0, amp, omega, phi] = out;
    assert.ok(Math.abs(x0 - b.cx) <= 2 * b.rmax + 1 && Math.abs(y0 - b.cy) <= b.rmax + 1, 'starts inside the bloom disc');
    const s0 = { x: 0, y: 0, a: 0 }, s1 = { x: 0, y: 0, a: 0 }, s2 = { x: 0, y: 0, a: 0 };
    speckState(b, i, 0.5, s0); speckState(b, i, 1.5, s1); speckState(b, i, 2.5, s2);
    assert.ok(Math.abs((s1.y - s0.y) - 3) < 1e-9 && Math.abs((s2.y - s1.y) - 3) < 1e-9, 'falls 3 rows a second');
    for (let a = 0; a < 3; a += 0.05) { const s = { x: 0, y: 0, a: 0 }; speckState(b, i, a, s); swayMax = Math.max(swayMax, Math.abs(s.x - x0)); }
    assert.ok(omega > 0 && amp > 0 && Number.isFinite(phi));
  }
  console.log(`POLLEN sway: widest sideways drift ${swayMax.toFixed(2)} columns`);
  assert.ok(swayMax > 0.8 && swayMax < 3, `${swayMax}`);
  const s = { x: 0, y: 0, a: 0 };
  const fade = []; for (let a = 0; a <= 3.0001; a += 0.05) { speckState(b, 0, a, s); fade.push(s.a); }
  assert.equal(fade[0], 0); assert.ok(fade[fade.length - 1] <= 1e-9, 'gone at 3 s');
  const peak = Math.max(...fade); assert.ok(peak > 0.7 && peak <= 1);
  const iPeak = fade.indexOf(peak);
  for (let k = iPeak; k < fade.length - 1; k++) assert.ok(fade[k + 1] <= fade[k] + 1e-9, 'fades steadily');
  assert.ok(fade[Math.round(1.5 / 0.05)] < 0.65, 'half gone at half time');
});

test('bloomfall pollen as drawn: each speck is a braille dot in its cell, the cell keeps the field below it, braille cells appear only while some bloom is fading, never more than 40 per fading bloom', () => {
  const w = 120, h = 40, seed = 2;
  const bl = plan(seed, w, h, 80).blooms;
  const b = bl.find((x) => x.start > 8 && bl.every((o) => o === x || Math.abs(o.start - x.start) > 3.2)); // no other bloom drops pollen in the same seconds
  assert.ok(b);
  const out = { x: 0, y: 0, a: 0 };
  let checked = 0;
  for (const a of [0.6, 1.2, 1.8, 2.4]) {
    const T = b.start + bf.FALL_FROM + a;
    const p = draw(bloomfall, T, w, h, seed);
    let braille = 0;
    for (let i = 0; i < w * h; i++) if (p.glyphs[i] >= 0x2801 && p.glyphs[i] <= 0x28ff) braille++;
    assert.ok(braille <= 40, `${braille} braille cells`);
    assert.ok(braille >= 8, `${braille} braille cells at a=${a}`);
    for (let s = 0; s < b.np; s++) {
      speckState(b, s, a, out);
      const cx = Math.floor(out.x), cy = Math.floor(out.y);
      if (cx < 0 || cx >= w || cy < 0 || cy >= h || out.a < 0.15) continue;
      const g = p.glyphs[cy * w + cx];
      assert.ok(g >= 0x2801 && g <= 0x28ff, `speck ${s} at a=${a}: cell ${cx},${cy} has glyph ${g.toString(16)}`);
      const bit = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80][Math.floor((out.y - cy) * 4) * 2 + Math.floor((out.x - cx) * 2)];
      assert.ok((g - 0x2800) & bit, `speck ${s}: dot ${bit} is lit`);
      checked++;
    }
  }
  assert.ok(checked > 20, `${checked} specks checked`);
  // before the fade (a bloom alone, tau 2): no braille at all
  const T = b.start + 2;
  const p = draw(bloomfall, T, w, h, seed);
  let any = 0;
  for (let i = 0; i < w * h; i++) if (p.glyphs[i] >= 0x2801 && p.glyphs[i] <= 0x28ff) any++;
  const fading = bl.filter((o) => T - o.start >= bf.FALL_FROM && T - o.start < bf.FALL_FROM + bf.POLLEN_LIFE);
  if (fading.length === 0) assert.equal(any, 0);
});

// ---- 8. the glyph set

test('bloomfall glyphs: only half blocks, spaces, braille and the four pop glyphs are drawn; every one is allowed and none is banned, over 90 s at three sizes', () => {
  const seen = new Set();
  for (const [w, h] of [[60, 20], [120, 40], [240, 67]]) {
    const p = buffers(w, h);
    for (let t = 0; t < 90; t += 0.31) {
      draw(bloomfall, t, w, h, 1, 0, p);
      for (let i = 0; i < w * h; i++) seen.add(p.glyphs[i]);
    }
  }
  for (const g of seen) {
    assert.ok(isAllowedGlyph(g), `${g.toString(16)}`);
    assert.ok(!BANNED.includes(g));
    assert.ok(g === 32 || g === 0x2580 || (g >= 0x2801 && g <= 0x28ff) || POP_GLYPHS.includes(g), `unexpected glyph ${g.toString(16)}`);
  }
  for (const g of POP_GLYPHS) assert.ok(seen.has(g), `the pop glyph ${String.fromCodePoint(g)} is drawn`);
  assert.ok(seen.has(0x2580) && seen.has(32));
});

// ---- 9. sizes

test('bloomfall sizes: 0x0, 1x1, 59x19, 60x20, 61x21, 120x40, 240x67, 400x120 never throw and every cell is written (sentinels all gone), rgb cells where the picture is', () => {
  for (const [w, h] of [[0, 0], [1, 1], [0, 30], [30, 0], [59, 19], [60, 20], [61, 21], [120, 40], [240, 67], [400, 120], [2, 200]]) {
    for (const t of [0, 7.3, 31, 59.9]) {
      const p = draw(bloomfall, t, w, h, 1);
      assert.equal(p.glyphs.length, w * h);
      for (let i = 0; i < w * h; i++) {
        assert.ok(isAllowedGlyph(p.glyphs[i]), `${w}x${h} cell ${i} glyph ${p.glyphs[i]}`);
        assert.ok(p.fg[i] <= 0xffffff && p.bg[i] <= 0xffffff, `${w}x${h} t=${t}: cell ${i} was not written (fg ${p.fg[i]}, bg ${p.bg[i]})`);
        if (w >= MIN_W && h >= MIN_H) assert.equal(p.colours[i], RGB_CELL);
      }
    }
  }
});

test('bloomfall sizes: 60x20 is the first size with the picture (colour everywhere, no message), 59x19, 60x19 and 59x20 the dim centred message "This vision needs 60 x 20." (the size branch bites both ways)', () => {
  assert.equal(MESSAGE, 'This vision needs 60 x 20.'); assert.equal(MIN_W, 60); assert.equal(MIN_H, 20);
  const msg = (w, h) => draw(bloomfall, 5, w, h).glyphs.some((g) => g === 'T'.charCodeAt(0));
  assert.equal(msg(59, 19), true); assert.equal(msg(60, 19), true); assert.equal(msg(59, 20), true); assert.equal(msg(100, 19), true);
  assert.equal(msg(60, 20), false); assert.equal(msg(61, 21), false); assert.equal(msg(120, 40), false);
  for (const [w, h] of [[59, 19], [40, 12], [100, 19]]) {
    const p = draw(bloomfall, 5, w, h);
    const row = Math.floor(h / 2), line = String.fromCodePoint(...p.glyphs.slice(row * w, (row + 1) * w));
    const x = line.indexOf(MESSAGE);
    if (w >= MESSAGE.length) { assert.ok(x >= 0, `${w}x${h}`); assert.ok(Math.abs(x - (w - x - MESSAGE.length)) <= 1, 'centred'); assert.ok(luminanceOf(p.fg[row * w + x]) < luminanceOf(0x8a9bc4), 'dim'); }
    for (let i = 0; i < w * h; i++) if (Math.floor(i / w) !== row) assert.equal(p.glyphs[i], 32);
  }
  const p = draw(bloomfall, 5, 60, 20);
  let lit = 0;
  for (let i = 0; i < 1200; i++) if (p.bg[i] !== 0x05060c) lit++;
  assert.ok(lit > 1190, `${lit}`);
});

// ---- 10. the cache

test('bloomfall cache: built per size and kept (same buffers for the same size, no allocation per frame), rebuilt on a resize; frames never change it', () => {
  const c0 = bf.cacheFor(120, 40);
  assert.equal(bf.cacheFor(120, 40), c0);
  const px = c0.pixels, hue = c0.hue;
  for (let k = 0; k < 30; k++) draw(bloomfall, k * 0.9, 120, 40, 1);
  assert.equal(bf.cacheFor(120, 40), c0); assert.equal(c0.pixels, px); assert.equal(c0.hue, hue);
  const c1 = bf.cacheFor(80, 24);
  assert.notEqual(c1, c0); assert.equal(c1.n, 80 * 48);
  assert.notEqual(bf.cacheFor(120, 40), c0, 'and the old size is rebuilt, not kept');
});

// ---- 11. change per frame and the look

test('bloomfall change: the share of cells that change between consecutive frames at 18 fps over 60 s, at 120x40 and 240x67 (seeds 1 to 3): the field always moves (floor), never a whole-screen step (ceiling)', () => {
  const lines = [];
  for (const [w, h] of [[120, 40], [240, 67]]) {
    for (const seed of [1, 2, 3]) {
      const p = buffers(w, h), n = w * h;
      let prev = null, min = 1, max = 0, sum = 0, frames = 0;
      for (let k = 0; k <= 60 * FPS; k++) {
        draw(bloomfall, k / FPS, w, h, seed, 0, p);
        if (prev) {
          let ch = 0;
          for (let i = 0; i < n; i++) if (p.glyphs[i] !== prev.g[i] || p.fg[i] !== prev.fg[i] || p.bg[i] !== prev.bg[i]) ch++;
          min = Math.min(min, ch / n); max = Math.max(max, ch / n); sum += ch / n; frames++;
        }
        prev = snap(p);
      }
      lines.push(`${w}x${h} seed ${seed}: min ${(min * 100).toFixed(2)} % mean ${(100 * sum / frames).toFixed(2)} % max ${(max * 100).toFixed(2)} %`);
      assert.ok(min >= CHANGE_MIN[`${w}x${h}`], `${w}x${h} seed ${seed}: only ${(min * 100).toFixed(2)} % changed in the worst frame`);
      assert.ok(max <= CHANGE_MAX, `${w}x${h} seed ${seed}: ${max}`);
    }
  }
  console.log('CHANGE per frame:\n  ' + lines.join('\n  '));
});
// measured: worst frame 38.4 to 50.2 % (120x40) and 44.6 to 48.6 % (240x67), mean 70 to 73 %, best frame up to 94.4 %: the hue turns 5 degrees a frame at a dim L, which moves a cell to a new 6-bit colour about three frames in four
const CHANGE_MIN = { '120x40': 0.35, '240x67': 0.40 }, CHANGE_MAX = 0.96;

const HUE_BINS_MIN = 4, HUE_BINS_MEAN = 7; // measured: fewest 4 (60x20), 6 (120x40), 7 (240x67); means 7.5 to 10.5 of 12 thirty-degree bins
test('bloomfall look: dark overall (mean cell luminance under 0.08, a dim field with bright blooms), a real bright part (some cells over L 0.45), a wide spread of hues, blooms 5 to 55 % of the cells at 120x40', () => {
  const lines = [];
  for (const [w, h] of [[120, 40], [240, 67], [60, 20]]) {
    for (const seed of [1, 2]) {
      const shares = [], means = [];
      let binsMin = 99, binsSum = 0, binsN = 0;
      for (let t = 10; t < 130; t += 3.1) {
        const p = draw(bloomfall, t, w, h, seed), n = w * h;
        let m = 0, bright = 0;
        const bins = new Set();
        for (let i = 0; i < n; i++) {
          const y = cellY(p, i); m += y;
          if (y > Math.pow(0.4, 3)) bright++;
          const c = p.bg[i], r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (mx - mn > 12) { const hh = mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; bins.add(Math.floor(hh * 2)); }
        }
        shares.push(bright / n); means.push(m / n); binsMin = Math.min(binsMin, bins.size); binsSum += bins.size; binsN++;
      }
      const mean = means.reduce((a, b) => a + b, 0) / means.length, sh = shares.reduce((a, b) => a + b, 0) / shares.length;
      lines.push(`${w}x${h} seed ${seed}: mean luminance ${mean.toFixed(4)}, bloom share mean ${(sh * 100).toFixed(1)} % (min ${(Math.min(...shares) * 100).toFixed(1)}, max ${(Math.max(...shares) * 100).toFixed(1)}), hue bins (of 12) fewest ${binsMin} mean ${(binsSum / binsN).toFixed(1)}`);
      assert.ok(mean < 0.08 && mean > 0.012, `${w}x${h}: mean ${mean}`);
      assert.ok(Math.max(...shares) > 0.05, `${w}x${h} seed ${seed}: blooms never fill 5 %`);
      assert.ok(Math.max(...shares) < 0.55, `${w}x${h} seed ${seed}: blooms over 55 %`);
      assert.ok(binsMin >= HUE_BINS_MIN && binsSum / binsN >= HUE_BINS_MEAN, `${w}x${h}: ${binsMin} hue bins, mean ${binsSum / binsN}`);
    }
  }
  console.log('LOOK:\n  ' + lines.join('\n  '));
});

test('bloomfall constants: the shipped scene is id bloomfall, kind cells, rgb; field L 0.22', () => {
  assert.equal(FIELD_L, 0.22);
  assert.equal(bloomfall.id, 'bloomfall'); assert.equal(bloomfall.kind, 'cells'); assert.equal(bloomfall.rgb, true);
  assert.equal(bf.RATE, 0.8); assert.equal(bf.MAX_ALIVE, 4); assert.equal(bf.MIN_GAP, 20);
});

test('bloomfall manifest: the scene is in the 9000 manifest as a full-colour cells scene, last in the menu and the program (Cortex sits between Rosette and it), with the designer\'s label, note and text', async () => {
  const { default: fs } = await import('node:fs');
  const man = JSON.parse(fs.readFileSync(new URL('../cartridges/driftman-9000/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(man.scenes.map((x) => x.id), ['rosette', 'cortex', 'bloomfall']);
  assert.deepEqual(man.scenes[2], { id: 'bloomfall', kind: 'cells', title: 'Bloomfall', rgb: true });
  assert.deepEqual(man.programs[0].scenes, ['rosette', 'cortex', 'bloomfall']);
  assert.deepEqual(man.menu[2], { label: 'BLOOMFALL', program: 'transmission', scene: 'bloomfall', note: 'colour blooms', desc: 'Blooms of colour open and fade; small sparks pop between.' });
});
