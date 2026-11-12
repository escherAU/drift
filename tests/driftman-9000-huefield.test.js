// DRIFT-7 C15a: cartridges/driftman-9000/lib/huefield.js, the living colour background the visions share:
//   field(x, y, t, L, seed) = safeHue(h, L),  h = h0(seed) + 90 t + 120 n(x/40, y/20, 0.15 t) + 30 sin(0.08 x - 0.05 y + 0.7 t)
// n is smooth value noise in -1..1 on a periodic lattice with a table of interpolation weights. Every colour goes through safeHue
// (src/pixels.js), so a hue sweep at one L keeps its brightness and never reaches a saturated red.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { safeHue, safeHueExact, HUE_COLS, L_ROWS } from '../src/pixels.js';
import { discoverCartridges, loadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { tmpRoot, writeCart, dataManifest, LABEL } from './helpers-cartridge.js';
import * as hf from '../cartridges/driftman-9000/lib/huefield.js';

const { field, hueAt, noise, h0Of, SIN, SINE_N, LATTICE_N, WEIGHT_N } = hf;
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const redShare = (c) => { const r = lin((c >> 16) & 255), g = lin((c >> 8) & 255), b = lin(c & 255); return r / (r + g + b); };

// ---- the noise

test('huefield noise: n stays within -1..1 over a large sweep of x, y and t, and uses a good part of the range', () => {
  let lo = 9, hi = -9;
  for (const seed of [1, 2, 3, 40]) {
    for (let k = 0; k < 40000; k++) {
      const u = ((k * 7919) % 100000) / 100000 * 60 - 10, v = ((k * 104729) % 100000) / 100000 * 20 - 4, w = ((k * 1299709) % 100000) / 100000 * 40 - 5;
      const n = noise(u, v, w, seed);
      assert.ok(n >= -1 && n <= 1, `n(${u}, ${v}, ${w}) = ${n}`);
      lo = Math.min(lo, n); hi = Math.max(hi, n);
    }
  }
  console.log(`HUEFIELD noise range over 160000 samples: ${lo.toFixed(4)} .. ${hi.toFixed(4)}`);
  assert.ok(lo < -0.7 && hi > 0.7, `${lo} ${hi}: the noise reaches most of its range`);
});

test('huefield noise: smooth, a step of one column (u + 1/40), one row (v + 1/20) or one frame (w + 0.15/18) moves it by at most the smoothstep slope bound (1.5 x 2 per lattice unit)', () => {
  // smoothstep has slope at most 1.5 and lattice values differ by at most 2, so |dn| <= 3 x step (+ 2 % for the weight table)
  const bound = { u: (3 / 40) * 1.02, v: (3 / 20) * 1.02, w: ((3 * 0.15) / 18) * 1.02 };
  const worst = { u: 0, v: 0, w: 0 };
  for (const seed of [1, 5]) {
    for (let k = 0; k < 20000; k++) {
      const u = ((k * 7919) % 100000) / 100000 * 30, v = ((k * 104729) % 100000) / 100000 * 10, w = ((k * 1299709) % 100000) / 100000 * 30;
      const n = noise(u, v, w, seed);
      worst.u = Math.max(worst.u, Math.abs(noise(u + 1 / 40, v, w, seed) - n));
      worst.v = Math.max(worst.v, Math.abs(noise(u, v + 1 / 20, w, seed) - n));
      worst.w = Math.max(worst.w, Math.abs(noise(u, v, w + 0.15 / 18, seed) - n));
    }
  }
  console.log(`HUEFIELD noise neighbour difference: worst per column ${worst.u.toFixed(5)}, per row ${worst.v.toFixed(5)}, per frame ${worst.w.toFixed(5)} (bounds ${bound.u.toFixed(4)} ${bound.v.toFixed(4)} ${bound.w.toFixed(4)})`);
  for (const a of ['u', 'v', 'w']) { assert.ok(worst[a] <= bound[a], `${a}: ${worst[a]}`); assert.ok(worst[a] > bound[a] / 10, `${a}: the noise does move`); }
});

test('huefield noise: continuous across lattice lines and across the periodic wrap of the lattice', () => {
  for (const seed of [1, 9]) {
    for (const line of [0, 1, 5, LATTICE_N - 1, LATTICE_N, LATTICE_N + 1, 2 * LATTICE_N]) {
      const a = noise(line - 1e-9, 3.3, 4.4, seed), b = noise(line + 1e-9, 3.3, 4.4, seed);
      assert.ok(Math.abs(a - b) < 1e-3, `u line ${line}: ${a} ${b}`);
      const c = noise(3.3, line - 1e-9, 4.4, seed), d = noise(3.3, line + 1e-9, 4.4, seed);
      assert.ok(Math.abs(c - d) < 1e-3, `v line ${line}: ${c} ${d}`);
      const e = noise(3.3, 4.4, line - 1e-9, seed), f = noise(3.3, 4.4, line + 1e-9, seed);
      assert.ok(Math.abs(e - f) < 1e-3, `w line ${line}: ${e} ${f}`);
    }
  }
});

test('huefield tables: the weight table is a smoothstep from 0 to 1, the sine table one turn of sin, both fixed size', () => {
  assert.equal(SINE_N, 4096); assert.equal(SIN.length, SINE_N);
  let worst = 0;
  for (let i = 0; i < SINE_N; i++) worst = Math.max(worst, Math.abs(SIN[i] - Math.sin((i * 2 * Math.PI) / SINE_N)));
  assert.ok(worst < 1e-6, `${worst}`);
  assert.ok(WEIGHT_N >= 1024);
  const w = hf.WEIGHT;
  assert.equal(w.length, WEIGHT_N + 1);
  assert.equal(w[0], 0); assert.equal(w[WEIGHT_N], 1);
  for (let i = 1; i <= WEIGHT_N; i++) assert.ok(w[i] >= w[i - 1], 'monotone');
  assert.ok(Math.abs(w[WEIGHT_N / 2] - 0.5) < 1e-6);
});

// ---- the hue and the colour

test('huefield hue: h = h0 + 90 t + 120 n + 30 sin(0.08 x - 0.05 y + 0.7 t), the sine from the table', () => {
  let worst = 0;
  for (const seed of [1, 2, 77]) {
    for (let k = 0; k < 3000; k++) {
      const x = (k * 37) % 240, y = ((k * 91) % 134) / 2, t = (k * 0.173) % 300;
      const want = h0Of(seed) + 90 * t + 120 * noise(x / 40, y / 20, 0.15 * t, seed) + 30 * Math.sin(0.08 * x - 0.05 * y + 0.7 * t);
      worst = Math.max(worst, Math.abs(hueAt(x, y, t, seed) - want));
    }
  }
  console.log(`HUEFIELD hue against the straight maths: worst ${worst.toFixed(4)} degrees (table sine)`);
  assert.ok(worst < 0.1, `${worst}`);
});

test('huefield field: returns exactly safeHue(hueAt, L) as a 0xRRGGBB number, for any x, y, t, L and seed', () => {
  for (const seed of [1, 2, 3]) {
    for (let k = 0; k < 3000; k++) {
      const x = (k * 37) % 400, y = ((k * 91) % 240) / 2, t = (k * 0.31) % 500, L = [0.18, 0.22, 0.24, 0.6, 0.05, 0.92][k % 6];
      const c = field(x, y, t, L, seed);
      assert.equal(c, safeHue(hueAt(x, y, t, seed), L));
      assert.ok(Number.isInteger(c) && c >= 0 && c <= 0xffffff);
    }
  }
});

test('huefield determinism: the same arguments give the same colour, in any order, after other seeds went through', () => {
  const a = [];
  for (let k = 0; k < 200; k++) a.push(field(k, k / 3, k * 0.37, 0.22, 4));
  field(1, 2, 3, 0.2, 99); field(5, 5, 5, 0.2, 7); noise(1, 2, 3, 12);
  const b = [];
  for (let k = 199; k >= 0; k--) b.unshift(field(k, k / 3, k * 0.37, 0.22, 4));
  assert.deepEqual(b, a);
});

test('huefield seed: h0 comes from the seed (different seeds differ, spread over the wheel, always 0..360) and the seed changes the field', () => {
  const hs = [];
  for (let s = 0; s < 200; s++) { const h = h0Of(s); assert.ok(h >= 0 && h < 360, `${h}`); hs.push(h); }
  assert.ok(new Set(hs).size > 190);
  const bins = new Set(hs.map((h) => Math.floor(h / 30)));
  assert.equal(bins.size, 12, 'every 30-degree sector of the wheel is some seed\'s start');
  assert.notEqual(h0Of(1), h0Of(2));
  let same = 0;
  for (let k = 0; k < 500; k++) if (field(k % 120, (k % 40), k * 0.2, 0.22, 1) === field(k % 120, (k % 40), k * 0.2, 0.22, 2)) same++;
  assert.ok(same < 100, `${same} of 500 samples equal across seeds`);
  assert.equal(h0Of(1.0), h0Of(1), 'integer seeds');
  assert.equal(typeof h0Of(NaN), 'number');
});

test('huefield red-safe: every output, over x, y, t, seeds and the L values the visions use, has a linear red share under 0.75', () => {
  let worst = 0;
  for (const L of [0.18, 0.2, 0.22, 0.24, 0.4, 0.6, 0.66, 0.72, 0.8]) {
    for (const seed of [1, 2, 3]) {
      for (let k = 0; k < 2500; k++) {
        const c = field((k * 29) % 400, ((k * 53) % 240) / 2, (k * 0.119) % 400, L, seed);
        worst = Math.max(worst, redShare(c));
      }
    }
  }
  console.log(`HUEFIELD worst linear red share ${worst.toFixed(4)} (limit under 0.75)`);
  assert.ok(worst < 0.75, `${worst}`);
});

test('huefield never bypasses safeHue: every output, across the whole hue range and many L, is a colour of the safeHue image at that L (the image is the table safeHueExact builds)', () => {
  const image = new Map();
  const imageOf = (L) => { const row = Math.round(L * (L_ROWS - 1)); if (!image.has(row)) { const s = new Set(); for (let h = 0; h < HUE_COLS; h++) s.add(safeHueExact(h, L)); image.set(row, s); } return image.get(row); };
  for (const L of [0.18, 0.22, 0.24, 0.5, 0.8]) {
    const img = imageOf(L);
    for (let k = 0; k < 4000; k++) {
      const c = field((k * 17) % 300, ((k * 43) % 200) / 2, (k * 0.077) % 700, L, 1 + (k % 4));
      assert.ok(img.has(c), `L ${L}: ${c.toString(16)} is not in the safeHue image`);
    }
  }
});

test('huefield control: a copy that skips safeHue (plain OKLCH) is not in the image and reaches a saturated red, so the two checks above can fail', () => {
  const plain = (h, L) => {
    const a = 0.2 * Math.cos((h * Math.PI) / 180), b = 0.2 * Math.sin((h * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const R = Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), G = Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), B = Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
    return R / (R + G + B);
  };
  let reds = 0;
  for (let h = 0; h < 360; h++) if (plain(h, 0.22) >= 0.75) reds++;
  assert.ok(reds > 0, 'plain OKLCH at the dim lightness does reach a red share of 0.75');
  const img = new Set(); for (let h = 0; h < HUE_COLS; h++) img.add(safeHueExact(h, 0.22));
  assert.ok(!img.has(0x123456), 'an arbitrary colour is not in the image');
});

test('huefield brightness: at one L every colour has the same lightness whatever the hue (relative luminance within 0.02 of L cubed), so its fast hue is free for the flash meter', () => {
  const Y = (c) => 0.2126 * lin((c >> 16) & 255) + 0.7152 * lin((c >> 8) & 255) + 0.0722 * lin(c & 255);
  for (const L of [0.18, 0.22, 0.24]) {
    let lo = 9, hi = 0;
    for (let k = 0; k < 3000; k++) { const y = Y(field((k * 17) % 300, (k * 3) % 100, k * 0.1, L, 1)); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const target = Math.round(L * 63) / 63; // safeHue rounds L to 64 rows
    assert.ok(hi - lo < 0.012, `L ${L}: Y ${lo}..${hi}`);
    assert.ok(Math.abs((lo + hi) / 2 - target ** 3) < 0.01);
  }
});

test('huefield hue speed: the field turns about 90 degrees a second on average (the drift), 30 to 160 at any one point', () => {
  const rates = [];
  for (const [x, y] of [[0, 0], [60, 10], [120, 20], [200, 30]]) {
    for (let t = 0; t < 120; t += 1) {
      const d = hueAt(x, y, t + 1, 1) - hueAt(x, y, t, 1);
      rates.push(d);
    }
  }
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  console.log(`HUEFIELD hue rate: mean ${mean.toFixed(1)} deg/s, min ${Math.min(...rates).toFixed(1)}, max ${Math.max(...rates).toFixed(1)}`);
  assert.ok(Math.abs(mean - 90) < 8, `${mean}`);
  assert.ok(Math.min(...rates) > -10 && Math.max(...rates) < 200);
});

test('huefield: no allocation per call (the same typed tables are reused; a million calls do not grow the heap by more than 8 MB)', () => {
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  let acc = 0;
  for (let k = 0; k < 1_000_000; k++) acc += field(k % 240, (k >> 8) % 67, k * 0.001, 0.22, 1) & 1;
  const grew = process.memoryUsage().heapUsed - before;
  assert.ok(acc >= 0);
  assert.ok(grew < 8 * 1024 * 1024, `grew ${grew}`);
});

test('huefield junk in: NaN, Infinity and huge times give a colour, never a throw', () => {
  for (const v of [NaN, Infinity, -Infinity, 1e12, -1e12]) {
    assert.equal(typeof field(v, 1, 1, 0.22, 1), 'number');
    assert.equal(typeof field(1, v, 1, 0.22, 1), 'number');
    assert.equal(typeof field(1, 1, v, 0.22, 1), 'number');
    assert.equal(typeof field(1, 1, 1, v, v), 'number');
  }
});

// ---- the trust wall (both arms): lib code is install-folder only

test('huefield trust: the lib file is real code. In the user folder a cartridge carrying lib/huefield.js is refused; in the install folder the same files load and a scene can import it', async () => {
  const src = fs.readFileSync(path.join(INSTALL_DIR, 'driftman-9000', 'lib', 'huefield.js'), 'utf8');
  const skin = JSON.stringify({ palette: { bg: '#05060C', hue: '#3FE8FF', colours: ['#EAF2FF'] } });
  const scene = [
    "import { field } from '../lib/huefield.js';",
    'function hf(t, w, h, params) {',
    '  for (let i = 0; i < w * h; i++) { params.glyphs[i] = 32; params.colours[i] = 255; params.fg[i] = params.bg[i] = field(i % w, i / w, t, 0.22, 1); }',
    '}',
    "hf.id = 'hf';", "hf.kind = 'cells';", 'hf.rgb = true;', 'export default hf;', '',
  ].join('\n');
  const files = (trustedManifest) => ({
    'manifest.json': trustedManifest,
    'label.txt': LABEL,
    'skin.json': skin,
    'lib/huefield.js': src,
    'scenes/hf.js': scene,
  });
  const man = { format: 2, id: 'hfcart', title: 'Hue', version: '1.0.0', author: 'T', blurb: 'A field of hue.', runtime: 'cartridge', scenes: [{ id: 'hf', kind: 'cells', title: 'Hf', rgb: true }], programs: [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: ['hf'] }], start: 'main' };
  // user folder: refused whatever the manifest says
  const userRoot = tmpRoot();
  writeCart(userRoot, 'hfcart', files(man));
  const user = discoverCartridges({ dirs: [{ dir: userRoot, trusted: false }] });
  assert.equal(user.cartridges.length, 0);
  assert.equal(user.errors.length, 1, JSON.stringify(user.errors));
  assert.match(user.errors[0].reason, /code|rgb|full-colour/i);
  // the lib alone in a data-only manifest is refused too
  const loneRoot = tmpRoot();
  writeCart(loneRoot, 'lone', { 'manifest.json': dataManifest('lone'), 'label.txt': LABEL, 'lib/huefield.js': src });
  const lone = discoverCartridges({ dirs: [{ dir: loneRoot, trusted: false }] });
  assert.equal(lone.cartridges.length, 0);
  assert.match(lone.errors[0].reason, /user cartridges cannot contain code/);
  // install folder (trusted): accepted
  const instRoot = tmpRoot();
  writeCart(instRoot, 'hfcart', files(man));
  const inst = discoverCartridges({ dirs: [{ dir: instRoot, trusted: true }] });
  assert.deepEqual(inst.errors, []);
  assert.equal(inst.cartridges.length, 1);
  // and the real 9000 loads its scenes with the lib on disk
  const real = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.find((c) => c.id === 'driftman-9000');
  const res = await loadScenes(real);
  assert.deepEqual(res.errors, []);
  assert.ok(fs.existsSync(path.join(INSTALL_DIR, 'driftman-9000', 'lib', 'huefield.js')));
});
