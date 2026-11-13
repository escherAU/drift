// DRIFT-8 C3: the colour clock. The runtime keeps a second clock, tc, that runs at min(speed, 1) of real time; every global hue drift of the
// Driftman 9000's visions reads it (colourTime in the cartridge's lib/clock.js) while motion keeps the scene clock. At 1x tc is t, so every 1x
// frame is byte-identical to what it was before (pinned in tests/fixtures/colour-clock-pins.json, taken at HEAD of DRIFT-8 C2).
//   T3.1 clock rates at every speed key step, paused, help open    T3.2 the mutation (tests/colour-clock-mutation.test.js)
//   T3.3 1x byte identity, both colour modes, mid-program visions   T3.4 colourTime
//   T3.5 hue rate at 1x/2x/4x, motion on scene time                 T3.6 the composer, dissolve, renderScene and runtime thread tc
//   T3.7 the docs                                                   T3.8 render-hash and captures (run by hand, see the commit)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadKit, checkPins, checkClockRates, checkHueRates, checkMotionOnSceneTime, makeRuntime } from './helpers-colour-clock.js';
import { colourTime, sceneTime } from '../cartridges/driftman-9000/lib/clock.js';
import { createCellComposer, renderScene } from '../src/cells.js';
import { createCartridgeRuntime } from '../src/shell/runtime.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { newFrame } from '../src/shell/ui.js';
import { driftmanSkin } from '../src/shell/driftman.js';

const kit = await loadKit();

test('T3.1 the colour clock runs at min(speed, 1) of real time at every speed key step, and stops when paused and when help is open', () => {
  assert.deepEqual(kit.app.SPEEDS, [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4], 'the speed steps the key reaches (read, so a new step is tested too)');
  assert.deepEqual(checkClockRates(kit), []);
});

test('T3.1 the colour clock starts at 0 with the runtime and is on the state', () => {
  const { rt } = makeRuntime(kit);
  assert.equal(rt.state().tc, 0);
  assert.equal(rt.state().t, 0);
});

test('T3.3 1x byte identity: frames with tc = t, with tc omitted and through the runtime equal HEAD\'s frames (truecolor and 256, two sizes, two seeds, visions entered mid-program)', () => {
  assert.deepEqual(checkPins(kit), []);
});

test('T3.3 the pins are real: they cover both modes, the dissolves and visions entered mid-program, and the hashes differ from one another', () => {
  const pins = JSON.parse(fs.readFileSync(new URL('./fixtures/colour-clock-pins.json', import.meta.url), 'utf8'));
  const keys = Object.keys(pins);
  assert.ok(keys.length >= 200, `${keys.length} pins`);
  for (const m of ['truecolor', '256']) {
    assert.ok(keys.some((k) => k.startsWith(`composer ${m} `) && / a1 b1 p0 t90.1$/.test(k)), `${m}: a vision entered mid-program`);
    assert.ok(keys.some((k) => k.startsWith(`composer ${m} `) && / a1 b2 p0.5 t120.5$/.test(k)), `${m}: a dissolve`);
    assert.ok(keys.some((k) => k.startsWith(`runtime ${m} `)), `${m}: the runtime`);
  }
  assert.ok(new Set(Object.values(pins)).size > keys.length * 0.6, 'hashes are not all one value');
  assert.ok(Object.values(pins).every((v) => /^[0-9a-f]{64}$/.test(v)));
});

test('T3.3 scene-local: a vision entered mid-program starts its colour clock at 0 in its own frame, not at the program\'s tc (the global-tc mutant fails this in the mutation test)', () => {
  // vision 1 becomes active at t = 60.5 with tc = 60.5. At t = tc = 70 it has run 9.5 s: its colour time is 9.5, not 70.
  const seen = [];
  const rec = (t, w, h, params) => { seen.push({ t, tc: params.tc, tc0: params.tc0, t0: params.t0 }); for (let i = 0; i < w * h; i++) { params.glyphs[i] = 32; params.colours[i] = 255; params.fg[i] = 0x202020; params.bg[i] = 0x202020; } };
  rec.kind = 'cells'; rec.rgb = true;
  const cc = createCellComposer({ scenes: [kit.scene('rosette'), rec], cols: 20, rows: 6, seed: 1 });
  cc.frame({ a: 0, b: 0, p: 0 }, 0, 0);
  cc.frame({ a: 0, b: 1, p: 0.5 }, 60.5, 60.5);
  seen.length = 0;
  cc.frame({ a: 1, b: 1, p: 0 }, 70, 70);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tc0, 60.5);
  assert.equal(seen[0].t0, 60.5);
  assert.equal(colourTime(70, seen[0]), 9.5);
  assert.equal(colourTime(70, seen[0]), sceneTime(70, seen[0]));
});

test('T3.4 colourTime: falls back to sceneTime without tc, uses tc - tc0 when given, never negative or NaN', () => {
  assert.equal(colourTime(10, {}), sceneTime(10, {}));
  assert.equal(colourTime(10, undefined), 10);
  assert.equal(colourTime(10, { t0: 4 }), 6, 'no tc: the scene time');
  assert.equal(colourTime(10, { t0: 4, tc: undefined, tc0: 3 }), 6, 'tc0 alone is not a colour clock');
  assert.equal(colourTime(10, { t0: 4, tc: 7, tc0: 3 }), 4, 'tc - tc0');
  assert.equal(colourTime(10, { tc: 7 }), 7, 'tc without tc0 counts from 0, like t without t0');
  assert.equal(colourTime(100, { t0: 4, tc: 2.5, tc0: 1 }), 1.5, 'the colour clock may lag the scene clock');
  assert.equal(colourTime(10, { tc: 1, tc0: 5 }), 0, 'never negative');
  assert.equal(colourTime(NaN, { tc: NaN }), 0, 'never NaN');
  assert.equal(colourTime(5, { tc: NaN, t0: 1 }), 4, 'a NaN tc is no tc');
});

test('T3.5 the hue rate (degrees per real second) of Rosette, Bloomfall (field and blooms) and Cortex is the same at 2x and 4x as at 1x', () => {
  const { failures, rates } = checkHueRates(kit);
  const r = (id) => [1, 2, 4].map((s) => `${s}x ${typeof rates[id][s] === 'number' ? rates[id][s].toFixed(1) : rates[id][s]}`).join(', ');
  console.log(`HUE RATES deg/s: rosette ${r('rosette')} | rosette through the runtime ${r('rosetteRuntime')} | bloomfall field ${r('bloomfall')} | bloomfall blooms (${rates.bloomfallBloom.parts}; 1x/2x/4x ${[1, 2, 4].map((s) => rates.bloomfallBloom[s].toFixed(0)).join('/')}) | cortex ${r('cortex')}`);
  assert.deepEqual(failures, []);
});

test('T3.5 motion keeps scene time: with the scene time fixed the colour clock moves no contour, glyph or bloom; with the colour time fixed the scene clock does', () => {
  assert.deepEqual(checkMotionOnSceneTime(kit), []);
});

test('T3.5 motion at 4x is still 4x: after 3 real seconds at 4x the scene clock is at 12 s and the colour clock at 3 s', () => {
  const { rt } = makeRuntime(kit);
  for (let k = 0; k < 3; k++) rt.actions.speedUp(); // 1, 1.5, 2, 3 -> 4 (the default step is 1x, index 3)
  rt.actions.speedUp();
  assert.equal(rt.state().speed, 4);
  for (let k = 0; k < 60; k++) rt.advance(0.05);
  assert.ok(Math.abs(rt.state().t - 12) < 1e-9 && Math.abs(rt.state().tc - 3) < 1e-9, `${rt.state().t} ${rt.state().tc}`);
});

test('T3.6 the cell composer passes tc and a scene-local tc0 to the scene it draws and to both scenes of a dissolve; omitted, the scene sees no tc', () => {
  const seen = { a: [], b: [] };
  const mk = (key) => { const s = (t, w, h, params) => { seen[key].push({ t, tc: params.tc, tc0: params.tc0, t0: params.t0 }); for (let i = 0; i < w * h; i++) { params.glyphs[i] = 32; params.colours[i] = 255; params.fg[i] = 1; params.bg[i] = 1; } }; s.kind = 'cells'; s.rgb = true; return s; };
  const cc = createCellComposer({ scenes: [mk('a'), mk('b')], cols: 10, rows: 4, seed: 1 });
  cc.frame({ a: 0, b: 0, p: 0 }, 2, 1.5);
  assert.deepEqual(seen.a.at(-1), { t: 2, tc: 1.5, tc0: 1.5, t0: 2 });
  cc.frame({ a: 0, b: 1, p: 0.5 }, 5, 3);
  assert.deepEqual(seen.a.at(-1), { t: 5, tc: 3, tc0: 1.5, t0: 2 });
  assert.deepEqual(seen.b.at(-1), { t: 5, tc: 3, tc0: 3, t0: 5 }, 'the incoming vision starts its colour clock when the dissolve starts');
  cc.frame({ a: 1, b: 1, p: 0 }, 9, 4);
  assert.deepEqual(seen.b.at(-1), { t: 9, tc: 4, tc0: 3, t0: 5 });
  const cc2 = createCellComposer({ scenes: [mk('a'), mk('b')], cols: 10, rows: 4, seed: 1 });
  cc2.frame({ a: 0, b: 0, p: 0 }, 2);
  assert.equal(seen.a.at(-1).tc, undefined, 'no tc given: the scene gets none');
});

test('T3.6 renderScene takes tc (the last argument) and hands it to the scene; without it the scene gets none', () => {
  const seen = [];
  const s = (t, w, h, params) => { seen.push(params.tc); for (let i = 0; i < w * h; i++) { params.glyphs[i] = 32; params.colours[i] = 0; } };
  s.kind = 'cells';
  renderScene(s, 1, 4, 2, 1, null, null, null, null, 'truecolor', 0.25);
  renderScene(s, 1, 4, 2, 1);
  assert.deepEqual(seen, [0.25, undefined]);
});

test('T3.6 the runtime hands the composer its colour clock: a scene sees tc = real time and t = speed x real time', () => {
  const seen = [];
  const s = (t, w, h, params) => { seen.push([t, params.tc, params.t0, params.tc0]); for (let i = 0; i < w * h; i++) { params.glyphs[i] = 32; params.colours[i] = 255; params.fg[i] = 1; params.bg[i] = 1; } };
  s.id = 'rec'; s.kind = 'cells'; s.rgb = true;
  const progs = [{ id: 'a', title: 'A', transition: 'dissolve', scenes: ['rec'], sceneSeconds: 60 }];
  const cart = { id: 'fx', manifest: { programs: progs, start: 'a', scenes: [] } };
  const skin = { ...driftmanSkin, frame: { ...driftmanSkin.frame, show: 'never' } };
  const SPEEDS = kit.app.SPEEDS;
  const rt = createCartridgeRuntime(cart, [{ id: 'rec', kind: 'cells', family: 'cells', scene: s }], makeSkinPalette(skin, 'truecolor', 'fx'), { cols: 10, rows: 4, seed: 1, skin, cmode: 'truecolor', SPEEDS, DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 });
  const out = newFrame(10, 4);
  rt.frame(out); // the vision starts: t0 = tc0 = 0
  for (let k = 0; k < 4; k++) rt.actions.speedUp(); // 4x
  for (let k = 0; k < 40; k++) rt.advance(0.05);
  rt.frame(out);
  const [t, tc, t0, tc0] = seen.at(-1);
  assert.ok(Math.abs(t - 8) < 1e-9 && Math.abs(tc - 2) < 1e-9 && t0 === 0 && tc0 === 0, JSON.stringify(seen.at(-1)));
});

test('T3.6 the capture tools pass the colour clock where they draw cells (tc = t, which changes none of their output)', () => {
  for (const f of ['tools/capture.mjs', 'tools/capture-ansi.mjs']) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.match(src, /colour clock|\btc\b/, `${f} says how the colour clock is handled`);
  }
  const cap = fs.readFileSync(new URL('../tools/capture.mjs', import.meta.url), 'utf8');
  assert.match(cap, /renderScene\(scene, sec, MODE_COLS, MODE_ROWS, seed, null, null, null, null, 'truecolor', sec\)/);
  assert.match(cap, /cc\.frame\(\{ a: 0, b: 1, p \}, T, T\)/);
});

test('T3.7 docs: the scene contract (src/cells.js) and the README describe tc, tc0 and colourTime', () => {
  const norm = (s) => s.replace(/\r\n/g, '\n');
  const cells = norm(fs.readFileSync(new URL('../src/cells.js', import.meta.url), 'utf8'));
  const readme = norm(fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8'));
  for (const [name, text] of [['src/cells.js', cells], ['README.md', readme]]) {
    assert.match(text, /params\.tc\b/, `${name} names params.tc`);
    assert.match(text, /params\.tc0\b/, `${name} names params.tc0`);
    assert.match(text, /colourTime/, `${name} names colourTime`);
    assert.match(text, /min\(speed, 1\)/, `${name} says the rate`);
  }
  assert.match(cells, /pure in t and tc/i);
  const clock = norm(fs.readFileSync(new URL('../cartridges/driftman-9000/lib/clock.js', import.meta.url), 'utf8'));
  assert.match(clock, /export function colourTime\(/);
});

test('T3.5 every hue drift in the 9000\'s visions reads the colour clock: the sites are the ones listed in the scene headers', () => {
  const read = (f) => fs.readFileSync(new URL(`../cartridges/driftman-9000/scenes/${f}.js`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const ros = read('rosette'), blo = read('bloomfall'), cor = read('cortex');
  for (const [name, src] of [['rosette', ros], ['bloomfall', blo], ['cortex', cor]]) assert.match(src, /colourTime/, `${name} reads colourTime`);
  assert.match(ros, /hueT = 200 \+ HUE_RATE \* TC/);
  assert.match(blo, /hueAt\(px \+ 0\.5, yf, TC, seed\)/);
  assert.match(blo, /hueTurn = b\.turn \* \(TC - b\.start\)/);
  assert.match(cor, /edgeHue\(seed, e, TC\)/);
});
