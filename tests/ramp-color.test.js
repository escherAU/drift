import test from 'node:test';
import assert from 'node:assert/strict';
import { RAMP_CHARS, BANDS, LEVELS, bandOf, levelOf, createHysteresis } from '../src/ramp.js';
import {
  PRESETS, DEFAULT_PRESET, parseHex, shadeRGB, sgrFor, rgbTo256, detectColorMode,
  lerpRGB, loopT, nextPreset, presetIndex, makePalette, presetRGB,
} from '../src/color.js';

// ---- C1 ramp
test('C1 ramp endpoints are space and full block, glyph index never decreases', () => {
  assert.equal(RAMP_CHARS, ' ·:░▒▓█');
  assert.equal(RAMP_CHARS[bandOf(0)], ' ');
  assert.equal(RAMP_CHARS[bandOf(255)], '█');
  let prev = 0;
  for (let v = 0; v <= 255; v++) {
    const b = bandOf(v);
    assert.ok(b >= prev && b >= 0 && b < BANDS);
    prev = b;
  }
  prev = 0;
  for (let v = 0; v <= 255; v++) { const l = levelOf(v); assert.ok(l >= prev && l < LEVELS); prev = l; }
  assert.equal(levelOf(255), LEVELS - 1);
  assert.equal(levelOf(0), 0);
});

// ---- C2 hysteresis
test('C2 a value jittering +-1 around a band boundary does not toggle every frame', () => {
  const edge = Math.round(256 / BANDS); // ~37
  const h = createHysteresis(1, BANDS, 8);
  const f = new Uint8Array(1);
  let changes = 0, last = -1;
  for (let i = 0; i < 200; i++) {
    f[0] = edge + (i % 2 ? 1 : -1);
    h.update(f);
    if (last !== -1 && h.state[0] !== last) changes++;
    last = h.state[0];
  }
  assert.equal(changes, 0, 'jitter must not toggle the band');
  // control: the stateless mapping WOULD toggle for the same jitter
  assert.notEqual(bandOf(edge - 1), bandOf(edge + 1));
});

test('C2 a real crossing does change the band (both directions)', () => {
  const h = createHysteresis(1, BANDS, 8);
  const f = new Uint8Array(1);
  f[0] = 20; h.update(f);
  const low = h.state[0];
  f[0] = 120; h.update(f);
  const high = h.state[0];
  assert.ok(high > low);
  assert.equal(high, bandOf(120 - 8) === high ? high : bandOf(120 + 8));
  f[0] = 5; h.update(f);
  assert.equal(h.state[0], 0);
  // slow ramp climbs through every band
  const seen = new Set();
  for (let v = 0; v <= 255; v++) { f[0] = v; h.update(f); seen.add(h.state[0]); }
  assert.equal(seen.size, BANDS);
});

test('C2 first update is stateless (no bias from the initial state)', () => {
  const h = createHysteresis(3, BANDS, 8);
  h.update(Uint8Array.from([0, 130, 255]));
  assert.deepEqual(Array.from(h.state), [bandOf(0), bandOf(130), bandOf(255)]);
});

// ---- C3 presets
test('C3 default preset is Claude orange #D97757 and parses', () => {
  assert.equal(DEFAULT_PRESET, 'claude');
  assert.deepEqual(parseHex('#D97757'), [217, 119, 87]);
  assert.deepEqual(presetRGB('claude', 0), [217, 119, 87]);
  assert.equal(parseHex('nope'), null);
  assert.equal(parseHex('#12'), null);
});

test('C3 every preset yields truecolor SGR with its exact RGB at full intensity', () => {
  for (const p of PRESETS) {
    if (p.blend) continue;
    const rgb = presetRGB(p.id, 0);
    assert.equal(rgb.length, 3);
    const full = shadeRGB(rgb, LEVELS - 1);
    assert.deepEqual(full, rgb);
    assert.equal(sgrFor(rgb, LEVELS - 1, 'truecolor'), `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`);
  }
});

test('C3 shading is monotonic in brightness with intensity, and not black at level 0', () => {
  for (const p of PRESETS) {
    const rgb = presetRGB(p.id, 0);
    let prev = -1;
    for (let l = 0; l < LEVELS; l++) {
      const [r, g, b] = shadeRGB(rgb, l);
      const lum = 0.3 * r + 0.59 * g + 0.11 * b;
      assert.ok(lum >= prev, `${p.id} level ${l}`);
      prev = lum;
    }
    assert.ok(shadeRGB(rgb, 0).some((c) => c > 0));
  }
});

// ---- C4 fallback
test('C4 256-colour mapping gives valid 16..255 indices and brightens with level', () => {
  for (const p of PRESETS) {
    const rgb = presetRGB(p.id, 0);
    let prev = -1;
    for (let l = 0; l < LEVELS; l++) {
      const s = sgrFor(rgb, l, '256');
      const m = /^\x1b\[38;5;(\d+)m$/.exec(s);
      assert.ok(m, s);
      const idx = Number(m[1]);
      assert.ok(idx >= 16 && idx <= 255);
      // monotonic-ish: perceived brightness of the chosen index never drops by much
      const lum = lumOf256(idx);
      assert.ok(lum >= prev - 40, `${p.id} level ${l}: ${lum} after ${prev}`);
      prev = Math.max(prev, lum);
    }
  }
  assert.equal(rgbTo256([255, 255, 255]) >= 16, true);
});

function lumOf256(i) {
  if (i >= 232) { const v = 8 + (i - 232) * 10; return v; }
  const n = i - 16; const r = Math.floor(n / 36), g = Math.floor((n % 36) / 6), b = n % 6;
  const c = (x) => (x === 0 ? 0 : 55 + x * 40);
  return 0.3 * c(r) + 0.59 * c(g) + 0.11 * c(b);
}

test('C4 colour mode comes from injected env (both arms)', () => {
  assert.equal(detectColorMode({ COLORTERM: 'truecolor' }), 'truecolor');
  assert.equal(detectColorMode({ COLORTERM: '24bit' }), 'truecolor');
  assert.equal(detectColorMode({ WT_SESSION: 'abc-123' }), 'truecolor');
  assert.equal(detectColorMode({}), '256');
  assert.equal(detectColorMode({ COLORTERM: 'yes' }), '256');
});

// ---- C5 blend
test('C5 two-colour blend: phase 0 is A, half is the midpoint, 1 is B', () => {
  const a = [200, 100, 50], b = [100, 200, 150];
  assert.deepEqual(lerpRGB(a, b, 0), a);
  assert.deepEqual(lerpRGB(a, b, 0.5), [150, 150, 100]);
  assert.deepEqual(lerpRGB(a, b, 1), b);
});

test('C5 blend loops smoothly: loopT is 0 at start and period, midpoint at half, no jump at the wrap', () => {
  const P = 90;
  assert.equal(loopT(0, P), 0);
  assert.ok(Math.abs(loopT(P, P)) < 1e-9);
  assert.ok(Math.abs(loopT(P / 2, P) - 1) < 1e-9);
  assert.ok(Math.abs(loopT(P - 0.01, P) - loopT(0, P)) < 1e-3);
  assert.ok(Math.abs(loopT(P + 0.01, P) - loopT(P, P)) < 1e-3);
  assert.ok(Math.abs(loopT(3 * P + 17, P) - loopT(17, P)) < 1e-9);
  // the preset form agrees: blend preset colour at t=0 is its A colour
  assert.deepEqual(presetRGB('blend', 0), presetRGB('claude', 0));
});

// ---- C6 cycling
test('C6 c cycles through all presets in order and wraps', () => {
  const order = PRESETS.map((p) => p.id);
  assert.deepEqual(order, ['claude', 'amber', 'green', 'ice', 'violet', 'white', 'blend']);
  let cur = order[0];
  const seen = [cur];
  for (let i = 0; i < order.length; i++) { cur = nextPreset(cur); seen.push(cur); }
  assert.deepEqual(seen, [...order, order[0]]);
  assert.equal(presetIndex('amber'), 1);
  assert.equal(presetIndex('bogus'), -1);
});

test('makePalette builds one SGR string per level and a key that changes with the colour', () => {
  const p1 = makePalette([217, 119, 87], 'truecolor');
  const p2 = makePalette([217, 119, 88], 'truecolor');
  const p3 = makePalette([217, 119, 87], '256');
  assert.equal(p1.sgr.length, LEVELS);
  assert.notEqual(p1.key, p2.key);
  assert.notEqual(p1.key, p3.key);
  assert.equal(p1.sgr[LEVELS - 1], '\x1b[38;2;217;119;87m');
});
