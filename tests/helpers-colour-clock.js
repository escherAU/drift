// DRIFT-8 C3: the colour clock's shared test helpers. Everything takes a "kit": the engine pieces loaded from a root (the repo itself, or a
// mutated copy of it in the mutation test), so the same checks run on both.
//
// The pins (tests/fixtures/colour-clock-pins.json) are sha256 hashes of frames of the Driftman 9000's three visions taken at HEAD of
// DRIFT-8 C2, before the colour clock existed, and committed: every 1x frame of C3 must equal them.
//   pinFrames(kit, { withTc })  -> Map(name -> hash) through renderScene and the cell composer (visions entered mid-program after a dissolve)
//   pinRuntime(kit)             -> Map(name -> hash) through the real cartridge runtime at 1x
// withTc true passes tc = t (the colour clock at 1x); false omits it, which is the pre-C3 call.
//
// Each check returns a list of failure strings (empty = pass), so the mutation test can ask a mutant which checks it fails.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = pathToFileURL(fileURLToPath(new URL('..', import.meta.url))).href.replace(/\/?$/, '/');
export const MODES = ['truecolor', '256'];
export const SIZES = [[80, 24], [120, 40]];
export const SEEDS = [1, 3];
export const NAMES = ['rosette', 'cortex', 'bloomfall'];
export const PINS_FILE = new URL('./fixtures/colour-clock-pins.json', import.meta.url);

export async function loadKit(root = REPO_ROOT) {
  const imp = (p) => import(new URL(p, root).href);
  const [loader, cells, runtime, palette, ui, driftman, app, pixels, rosette, cortex, bloomfall] = await Promise.all([
    imp('src/cartridge/loader.js'), imp('src/cells.js'), imp('src/shell/runtime.js'), imp('src/cartridge/palette.js'), imp('src/shell/ui.js'),
    imp('src/shell/driftman.js'), imp('src/app.js'), imp('src/pixels.js'),
    imp('cartridges/driftman-9000/scenes/rosette.js'), imp('cartridges/driftman-9000/scenes/cortex.js'), imp('cartridges/driftman-9000/scenes/bloomfall.js'),
  ]);
  const cart = loader.discoverCartridges({ dirs: [{ dir: loader.INSTALL_DIR, trusted: true }] }).cartridges.find((c) => c.id === 'driftman-9000');
  if (!cart) throw new Error('the 9000 is not on the shelf');
  const loaded = await loader.loadScenes(cart);
  if (loaded.errors.length) throw new Error(`scene errors: ${JSON.stringify(loaded.errors)}`);
  return { root, loader, cells, runtime, palette, ui, driftman, app, pixels, mods: { rosette, cortex, bloomfall }, cart, loaded, scene: (id) => loaded.scenes.find((s) => s.id === id).scene };
}

export function hashFrame(f) {
  const h = crypto.createHash('sha256');
  for (const a of [f.glyphs, f.shades, f.fg, f.bg]) if (a) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  return h.digest('hex');
}

export const SINGLE_TIMES = [0, 3.3, 29, 61, 140];
// [state, t]: vision 0 for a minute, a dissolve into vision 1 at 60 s, vision 1 (entered mid-program: its t0 is 60.5), a dissolve into vision 2 at 120 s, vision 2 (t0 120.5)
export const SEQUENCE = [
  [{ a: 0, b: 0, p: 0 }, 0], [{ a: 0, b: 0, p: 0 }, 10.25], [{ a: 0, b: 0, p: 0 }, 59.5],
  [{ a: 0, b: 1, p: 0.3 }, 60.5], [{ a: 0, b: 1, p: 0.7 }, 61.2], [{ a: 1, b: 1, p: 0 }, 62.5], [{ a: 1, b: 1, p: 0 }, 90.1],
  [{ a: 1, b: 2, p: 0.5 }, 120.5], [{ a: 1, b: 2, p: 0.9 }, 121.4], [{ a: 2, b: 2, p: 0 }, 123.3], [{ a: 2, b: 2, p: 0 }, 150.7],
];

export function pinFrames(kit, { withTc }) {
  const out = new Map();
  for (const mode of MODES) for (const [w, h] of SIZES) for (const seed of SEEDS) {
    for (const id of NAMES) for (const t of SINGLE_TIMES) {
      const f = kit.cells.renderScene(kit.scene(id), t, w, h, seed, null, null, null, null, mode, withTc ? t : undefined);
      out.set(`render ${id} ${mode} ${w}x${h} s${seed} t${t}`, hashFrame(f));
    }
    const cc = kit.cells.createCellComposer({ scenes: NAMES.map(kit.scene), cols: w, rows: h, seed, cmode: mode });
    for (const [st, t] of SEQUENCE) {
      const f = withTc ? cc.frame(st, t, t) : cc.frame(st, t);
      out.set(`composer ${mode} ${w}x${h} s${seed} a${st.a} b${st.b} p${st.p} t${t}`, hashFrame(f));
    }
  }
  return out;
}

export const RUNTIME_MOMENTS = [5, 59.9, 61, 62.5, 100, 121, 123, 150];
const FPS = 18;

export function makeRuntime(kit, { cols = 80, rows = 24, cmode = 'truecolor', seed = 1 } = {}) {
  const { SPEEDS, DISSOLVE_SECONDS, DEFAULT_FADE_SECONDS } = kit.app;
  const skin = kit.cart.skin || kit.driftman.driftmanSkin;
  const rt = kit.runtime.createCartridgeRuntime(kit.cart, kit.loaded.scenes, kit.palette.makeSkinPalette(skin, cmode, kit.cart.id), { cols, rows, seed, skin, cmode, SPEEDS, DISSOLVE_SECONDS, DEFAULT_FADE_SECONDS });
  return { rt, out: kit.ui.newFrame(cols, rows) };
}

// The real runtime at the default speed (1x): advance in 1/18 s steps and hash the frame at each moment.
export function pinRuntime(kit) {
  const out = new Map();
  for (const mode of MODES) {
    const { rt, out: fb } = makeRuntime(kit, { cmode: mode });
    let now = 0, k = 0;
    for (const m of RUNTIME_MOMENTS) {
      while (now < m - 1e-9) { rt.advance(1 / FPS); now += 1 / FPS; k++; if (k % 3 === 0) rt.frame(fb); }
      rt.frame(fb);
      out.set(`runtime ${mode} 80x24 t${m}`, hashFrame(fb));
    }
  }
  return out;
}

export const mapToObject = (m) => Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
export const readPins = () => JSON.parse(fs.readFileSync(PINS_FILE, 'utf8'));

function diffPins(label, got, pins) {
  const bad = [];
  for (const [k, v] of got) if (pins[k] !== v) bad.push(`${label}: ${k}`);
  return bad;
}

// 1x byte identity: frames with tc = t, frames with tc omitted, and the real runtime at 1x, all against HEAD's committed hashes.
export function checkPins(kit) {
  const pins = readPins();
  return [
    ...diffPins('tc given', pinFrames(kit, { withTc: true }), pins),
    ...diffPins('tc omitted', pinFrames(kit, { withTc: false }), pins),
    ...diffPins('runtime', pinRuntime(kit), pins),
  ];
}

// from the default step (1x) to the wanted one by the keys
export function setSpeed(rt, speed) {
  for (let k = 0; k < 20 && rt.state().speed !== speed; k++) { if (speed > rt.state().speed) rt.actions.speedUp(); else rt.actions.speedDown(); }
  return rt.state().speed === speed;
}

// T3.1: the colour clock runs at min(speed, 1) of real time at every speed step, and stops when paused and when help is open.
export function checkClockRates(kit) {
  const bad = [], { SPEEDS } = kit.app;
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const at = setSpeed;
  const run = (rt, seconds) => { for (let k = 0; k < seconds * 20; k++) rt.advance(0.05); };
  for (const s of SPEEDS) {
    const { rt } = makeRuntime(kit);
    if (!at(rt, s)) { bad.push(`speed ${s} not reachable`); continue; }
    const a = rt.state(); run(rt, 2); const b = rt.state();
    const dT = b.t - a.t, dTc = b.tc - a.tc;
    if (!near(dT, 2 * s)) bad.push(`speed ${s}: scene clock moved ${dT} in 2 real s`);
    if (!near(dTc, 2 * Math.min(s, 1))) bad.push(`speed ${s}: colour clock moved ${dTc} in 2 real s, want ${2 * Math.min(s, 1)}`);
    if (!(dTc <= 2 + 1e-9)) bad.push(`speed ${s}: colour clock ran faster than real time (${dTc})`);
    rt.actions.pauseToggle(); const p0 = rt.state(); run(rt, 1); const p1 = rt.state();
    if (p1.t !== p0.t || p1.tc !== p0.tc) bad.push(`speed ${s}: paused, the clocks moved (${p0.t},${p0.tc} -> ${p1.t},${p1.tc})`);
    rt.actions.pauseToggle(); rt.actions.helpToggle(); const h0 = rt.state(); run(rt, 1); const h1 = rt.state();
    if (h1.t !== h0.t || h1.tc !== h0.tc) bad.push(`speed ${s}: help open, the clocks moved`);
  }
  return bad;
}

// ---- hue measuring: the inverse of safeHue (colour -> hue column and lightness row)

export function inverseHue(kit) {
  const { safeHue, L_ROWS, HUE_COLS } = kit.pixels;
  const map = new Map();
  for (let row = 0; row < L_ROWS; row++) for (let h = 0; h < HUE_COLS; h++) {
    const c = safeHue(h, row / (L_ROWS - 1)), e = map.get(c);
    if (!e) map.set(c, { row, lo: h, hi: h }); else if (e.row === row) e.hi = h; // neighbouring hue columns can hold one colour: a run, whose middle is the hue
  }
  for (const e of map.values()) e.hue = e.hi - e.lo > 180 ? 0 : (e.lo + e.hi) / 2;
  return { map, rowOf: (L) => Math.round(L * (L_ROWS - 1)), HUE_COLS };
}

// The pixels of a cells frame, two per cell: the top is fg, the bottom is bg (a blank cell has fg === bg).
function pixelsOf(f) {
  const n = f.glyphs.length, px = new Uint32Array(2 * n);
  for (let i = 0; i < n; i++) { px[2 * i] = f.fg[i]; px[2 * i + 1] = f.bg[i]; }
  return px;
}

// median |hue change| per second, over the pixels that decode to a lightness row in `rows` in both frames (a circular difference)
function medianHueRate(inv, A, B, rows, dt) {
  const d = [];
  for (let i = 0; i < A.length; i++) {
    const a = inv.map.get(A[i]), b = inv.map.get(B[i]);
    if (a === undefined || b === undefined) continue;
    if (!rows.includes(a.row) || !rows.includes(b.row)) continue;
    let x = Math.abs(a.hue - b.hue);
    if (x > 180) x = 360 - x;
    d.push(x);
  }
  if (d.length < 50) return NaN;
  d.sort((p, q) => p - q);
  return d[d.length >> 1] / dt;
}

// T3.5: at each speed, the frame at real time r is drawn with scene time s r and colour time min(s, 1) r (what the runtime hands the composer).
// Returns { failures, rates } with rates[scene][speed] in degrees of hue per real second.
export function checkHueRates(kit, { speeds = [1, 2, 4], size = [80, 24] } = {}) {
  const bad = [], rates = { rosette: {}, bloomfall: {}, bloomfallBloom: {}, cortex: {} };
  const inv = inverseHue(kit), [w, h] = size, DR = 0.1;
  const { FILL_L, CONTOUR_L } = kit.mods.rosette, { FIELD_L } = kit.mods.bloomfall;
  const rosRows = [inv.rowOf(FILL_L), inv.rowOf(CONTOUR_L)], fieldRows = [inv.rowOf(FIELD_L)];
  const bloomRows = []; for (let r = inv.rowOf(FIELD_L) + 1; r < 64; r++) bloomRows.push(r);
  const frame = (id, s, r, extra = {}) => px(kit.cells.renderScene(kit.scene(id), s * r, w, h, 1, null, null, null, null, 'truecolor', Math.min(s, 1) * r), extra);
  const px = (f) => pixelsOf(f);
  for (const s of speeds) {
    // Rosette: r = 5 s, so scene time is 5 s (1x), 10 s (2x) and 20 s (4x): inside a fold, never in a melt
    let A = frame('rosette', s, 5), B = frame('rosette', s, 5 + DR);
    rates.rosette[s] = medianHueRate(inv, A, B, rosRows, DR);
    // Bloomfall: the field, and the pixels inside blooms
    A = frame('bloomfall', s, 9); B = frame('bloomfall', s, 9 + DR);
    rates.bloomfall[s] = medianHueRate(inv, A, B, fieldRows, DR);
  }
  // the same, through the real runtime and composer (the speed key, advance, frame): Rosette is the program's first vision
  rates.rosetteRuntime = {};
  for (const s of speeds) {
    const { rt, out } = makeRuntime(kit, { cols: w, rows: h });
    if (!setSpeed(rt, s)) { bad.push(`speed ${s} not reachable`); continue; }
    rt.frame(out);
    for (let k = 0; k < 100; k++) rt.advance(0.05);
    rt.frame(out);
    const A = pixelsOf(out);
    for (let k = 0; k < 2; k++) rt.advance(0.05);
    rt.frame(out);
    rates.rosetteRuntime[s] = medianHueRate(inv, A, pixelsOf(out), rosRows, DR);
  }
  const rel = (id, floor, ceil) => {
    const base = rates[id][1];
    if (!(base >= floor && base <= ceil)) bad.push(`${id}: the 1x hue rate ${base} is outside ${floor}..${ceil} (the measure is off)`);
    for (const s of speeds) if (!(Math.abs(rates[id][s] / base - 1) <= 0.2)) bad.push(`${id}: hue rate at ${s}x is ${rates[id][s]} deg/s, 1x is ${base}`);
  };
  rel('rosette', 100, 400);
  rel('rosetteRuntime', 100, 400);
  rel('bloomfall', 40, 400);

  // Bloomfall's blooms: a bloom's pixel hue is its hue + 60 ratio + turn x age. The turn (120 deg/s, 40 for the magenta bloom) is on colour time;
  // the 60 degree gradient across the disc (ratio = r / R) is geometry, so it still sweeps as the radius grows and fades. Measured at fixed
  // scene time as partial derivatives: b = hue change per colour second, a = per scene second. The rate at speed s is s a + min(s, 1) b.
  const frameT = (T, Tc) => pixelsOf(kit.cells.renderScene(kit.scene('bloomfall'), T, w, h, 1, null, null, null, null, 'truecolor', Tc));
  let aMax = 0, bMin = 1e9, bMax = 0;
  for (const T0 of [12, 18, 25, 31]) {
    const base = frameT(T0, 9);
    const b = medianHueRate(inv, base, frameT(T0, 9 + DR), bloomRows, DR), a = medianHueRate(inv, base, frameT(T0 + DR, 9), bloomRows, DR);
    aMax = Math.max(aMax, a); bMin = Math.min(bMin, b); bMax = Math.max(bMax, b);
  }
  for (const s of speeds) rates.bloomfallBloom[s] = s * aMax + Math.min(s, 1) * bMin;
  rates.bloomfallBloom.parts = `turn ${bMin}..${bMax} deg per colour second, gradient sweep up to ${aMax} deg per scene second`;
  if (!(bMin >= 100 && bMax <= 150)) bad.push(`bloomfall: the bloom hue turn is ${bMin}..${bMax} deg per colour second, want 100..150 (120)`);
  if (!(aMax <= 40)) bad.push(`bloomfall: the bloom hue changes ${aMax} deg per scene second at a fixed colour time, want at most 40 (the gradient sweep)`);

  // Cortex: the icosahedron's edge colours are safeHue(edgeHue(seed, e, c), edgeLightness(level)) for 30 edges and 8 depth levels, the hues 12 degrees
  // apart and drifting 4 deg/s. At r = 1.5 s the scene time is 1.5 s, 3 s and 6 s: for 2x and 4x the hues of scene time and of colour time are 6 degrees
  // apart, so the two sets of colours share nothing and the cells say which clock their hue is on.
  const { edgeHue, edgeLightness, computeLayout } = kit.mods.cortex, CW = 120, CH = 40;
  const colours = (c) => { const S = new Set(); for (let e = 0; e < 30; e++) for (let k = 0; k <= 7; k++) S.add(kit.pixels.safeHue(edgeHue(1, e, c), edgeLightness(2 * k / 7 - 1))); return S; };
  const k0 = computeLayout(CW, CH).content[0];
  for (const s of speeds) {
    const r = 1.5, T = s * r, Tc = Math.min(s, 1) * r;
    const f = kit.cells.renderScene(kit.scene('cortex'), T, CW, CH, 1, null, null, null, null, 'truecolor', Tc);
    const onColour = colours(Tc), onScene = colours(T);
    let n = 0, inColour = 0, inScene = 0;
    for (let y = k0.y; y < k0.y + k0.h; y++) for (let x = k0.x; x < k0.x + k0.w; x++) {
      const i = y * CW + x, g = f.glyphs[i];
      if (g < 0x2801 || g > 0x28ff) continue;
      n++;
      if (onColour.has(f.fg[i])) inColour++;
      else if (onScene.has(f.fg[i])) inScene++;
    }
    rates.cortex[s] = `${inColour}/${n} cells on the colour-clock hues`;
    if (n < 20) bad.push(`cortex ${s}x: only ${n} icosahedron cells found`);
    else if (inColour < 0.95 * n) bad.push(`cortex ${s}x: ${inColour}/${n} icosahedron cells have the colours of colour time ${Tc}`);
    if (s > 1 && inScene > 0.05 * n) bad.push(`cortex ${s}x: ${inScene}/${n} icosahedron cells have the colours of scene time ${T}`);
  }
  return { failures: bad, rates };
}

// T3.5 (motion half): the geometry of every vision keeps scene time. With the scene time fixed, the colour time does not move anything;
// with the colour time fixed, the scene time does.
export function checkMotionOnSceneTime(kit) {
  const bad = [], inv = inverseHue(kit), W = 120, H = 40;
  const draw = (id, T, Tc, mode = 'truecolor') => kit.cells.renderScene(kit.scene(id), T, W, H, 1, null, null, null, null, mode, Tc);
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const frac = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d / a.length; };
  // Rosette: the contour (the cells drawn a lightness up, in truecolor) is where |f| is small at SCENE time
  const { FILL_L, CONTOUR_L } = kit.mods.rosette;
  const { safeHue } = kit.pixels;
  const fill = new Set(), cont = new Set();
  for (let h = 0; h < 360; h++) { fill.add(safeHue(h, FILL_L)); cont.add(safeHue(h, CONTOUR_L)); }
  const mask = (f) => { const m = new Uint8Array(f.fg.length * 2); for (let i = 0; i < f.fg.length; i++) { m[2 * i] = cont.has(f.fg[i]) && !fill.has(f.fg[i]) ? 1 : 0; m[2 * i + 1] = cont.has(f.bg[i]) && !fill.has(f.bg[i]) ? 1 : 0; } return m; };
  const r1 = mask(draw('rosette', 20, 20)), r2 = mask(draw('rosette', 20, 5)), r3 = mask(draw('rosette', 21, 20));
  const on = r1.reduce((a, b) => a + b, 0);
  if (on < 100) bad.push(`rosette: only ${on} contour pixels found (the measure is off)`);
  if (!same(r1, r2)) bad.push('rosette: the contours move with the colour time');
  if (frac(r1, r3) < 0.01) bad.push('rosette: the contours do not move with the scene time');
  // Cortex: braille shapes are the geometry
  const c1 = draw('cortex', 20, 20), c2 = draw('cortex', 20, 5), c3 = draw('cortex', 23, 20);
  if (!same(c1.glyphs, c2.glyphs)) bad.push('cortex: the glyphs move with the colour time');
  if (same(c1.glyphs, c3.glyphs)) bad.push('cortex: the glyphs do not move with the scene time');
  if (same(c1.fg, c2.fg)) bad.push('cortex: the colours do not move with the colour time');
  // Bloomfall: where a bloom is (a cell brighter than the field) is geometry
  const bright = (f) => { const m = new Uint8Array(f.fg.length); for (let i = 0; i < m.length; i++) m[i] = kit.pixels.relY(f.fg[i]) > 0.03 || kit.pixels.relY(f.bg[i]) > 0.03 ? 1 : 0; return m; };
  const b1 = bright(draw('bloomfall', 20, 20)), b2 = bright(draw('bloomfall', 20, 5)), b3 = bright(draw('bloomfall', 22, 20));
  if (b1.reduce((a, b) => a + b, 0) < 20) bad.push('bloomfall: no bloom found at 20 s (the measure is off)');
  if (!same(b1, b2)) bad.push('bloomfall: the blooms move with the colour time');
  if (same(b1, b3)) bad.push('bloomfall: the blooms do not move with the scene time');
  return bad;
}
