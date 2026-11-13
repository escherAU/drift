// DRIFT-7 C16: Cortex against the flash meter (every rule L1, L2, L3, R at 1x and 4x), on truecolor output and on 256-colour output (the renderer's own
// nearest256 through makeReducer256), the phase test on every ramp (pulse, focus sweep, numeral light, caption typing and erasing, the parallax ripple,
// the figure's steps), its byte budget and its CPU budget. Structure and look are in driftman-9000-cortex.test.js; the dissolves with the other visions
// are in driftman-9000-dissolve.test.js.
// The scene runs solo through the real cell composer, frame k at t = (k + phase) / 18, 130 s (a whole parallax cycle is 126 s, a caption round 33 s, a
// focus lap 32 s), at 120x40, 80x24, 240x67, 61x21, 60x20 and the size just above each layout breakpoint (compact 78x24, full 88x39, extra-large 176x58).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlashMeter } from './helpers-flash.js';
import { flashRig } from './helpers-flash-controls.js';
import {
  STEADY_CEILING, WORST_SECOND_CEILING, CPU_MEAN_CEILING_MS, BUDGET_RUN, limitFromMeasured, measureBytes, checkBudget, measureCpu, checkCpu,
} from './helpers-budget.js';
import { createCellComposer } from '../src/cells.js';
import { nearest256 } from '../src/renderer.js';
import cortex, * as cx from '../cartridges/driftman-9000/scenes/cortex.js';

const FPS = 18;
const SECONDS = 130;
const pc = (x) => (x * 100).toFixed(1);
const show = (rep) => `L1 ${pc(rep.l1.x1.worstFraction)}/${pc(rep.l1.x4.worstFraction)} L2 ${pc(rep.l2.x1.worstFraction)}/${pc(rep.l2.x4.worstFraction)} L3 ${pc(rep.l3.worstFraction)} R ${pc(rep.r.x1.worstFraction)}/${pc(rep.r.x4.worstFraction)}`;
// speeds above 1x: the shell's frames step speed/18 s and the viewer sees them at 18 fps, which is the meter's 1x playback; the meter's own 4x view is a stress on the 1x
// frames (it equals the shell at 4x, up to sampling), so it is judged at 1x only (a 2x shell viewed at the meter's 4x is 8x, outside the shell's speeds)
const X1 = ['l1.x1', 'l2.x1', 'l3', 'r.x1'];
const failed = (rep) => [['l1.x1', rep.l1.x1], ['l1.x4', rep.l1.x4], ['l2.x1', rep.l2.x1], ['l2.x4', rep.l2.x4], ['l3', rep.l3], ['r.x1', rep.r.x1], ['r.x4', rep.r.x4]].filter(([, r]) => !r.pass).map(([id]) => id);

// One solo run through the composer. `step` is the frame step in seconds (1/18 at the shell's 1x; speed/18 at 2x to 4x). reduce256: as 256-colour output shows it.
function run(scene, cols, rows, { phase = 0, seed = 1, seconds = SECONDS, reduce256 = false, speed = 1, start = 0 } = {}) {
  const rig = flashRig([scene], cols, rows, { seed, mode: reduce256 ? '256' : 'truecolor' }); // a 256 run gets a 256 composer (scenes see params.cmode)
  const meter = createFlashMeter(cols, rows, FPS);
  const N = Math.round((seconds * FPS) / speed);
  for (let k = 0; k < N; k++) {
    const s = rig.show(rig.cc.frame({ a: 0, b: 0, p: 0 }, start + ((k + phase) * speed) / FPS));
    meter.push(s.frame, s.palette);
  }
  return meter.report();
}

// ---- 1. truecolor, solo, 1x and 4x

const SIZES = ['120x40', '80x24', '61x21', '60x20', '78x24', '88x39', '176x58', '240x67'];
const EXTRA = { '120x40': [{ phase: 0.5 }, { seed: 2 }, { seed: 3, phase: 0.25 }], '78x24': [{ phase: 0.5 }, { seed: 2 }], '88x39': [{ seed: 2 }, { seed: 3, phase: 0.25 }], '240x67': [{ seed: 2 }], '60x20': [{ seed: 2 }], '80x24': [{ seed: 2 }] };

for (const sz of SIZES) {
  test(`cortex flash ${sz}: solo for ${SECONDS} s, every rule passes at 1x and 4x (clock phases and seeds: ${(EXTRA[sz] || []).map((o) => JSON.stringify(o)).join(' ') || 'the default only'})`, () => {
    const [cols, rows] = sz.split('x').map(Number);
    const lines = [];
    for (const o of [{}, ...(EXTRA[sz] || [])]) {
      const rep = run(cortex, cols, rows, o);
      lines.push(`${sz} ${JSON.stringify(o)} truecolor ${show(rep)}`);
      assert.deepEqual(failed(rep), [], `${sz} ${JSON.stringify(o)}: ${show(rep)}`);
    }
    console.log('METER ' + lines.join('\n      '));
  });
}

// ---- 2. 256-colour output

for (const sz of ['120x40', '80x24', '61x21', '88x39', '176x58', '240x67']) {
  test(`cortex flash ${sz} on 256-colour output (nearest256): every rule passes at 1x and 4x`, () => {
    const [cols, rows] = sz.split('x').map(Number);
    const lines = [];
    for (const o of [{}, { seed: 2 }]) {
      const rep = run(cortex, cols, rows, { ...o, reduce256: true });
      lines.push(`${sz} ${JSON.stringify(o)} 256-colour ${show(rep)}`);
      assert.deepEqual(failed(rep), [], `${sz} ${JSON.stringify(o)}: ${show(rep)}`);
    }
    console.log('METER ' + lines.join('\n      '));
  });
}

test('cortex 256 colours: the output is not garbage, at least 20 distinct 256-colour indexes over 60 s, every index a cube or grey entry, and the glass and skin backgrounds stay different colours', () => {
  const cols = 120, rows = 40, n = cols * rows;
  const cc = createCellComposer({ scenes: [cortex], cols, rows, seed: 1 });
  const used = new Set();
  for (let k = 0; k < 60 * FPS; k += 5) {
    const f = cc.frame({ a: 0, b: 0, p: 0 }, k / FPS);
    for (let i = 0; i < n; i++) { used.add(nearest256(f.fg[i])); used.add(nearest256(f.bg[i])); }
  }
  console.log(`256-colour: ${used.size} distinct indexes; glass -> ${nearest256(cx.PANE_BG)}, skin -> ${nearest256(cx.BG)}, edge -> ${nearest256(cx.EDGE)}`);
  assert.ok(used.size >= 20, `${used.size}`);
  for (const i of used) assert.ok(i >= 16 && i <= 255, `index ${i}`);
  assert.notEqual(nearest256(cx.PANE_BG), nearest256(cx.BG), 'on 256 colours the glass still reads as glass');
  assert.notEqual(nearest256(cx.EDGE), nearest256(cx.PANE_BG));
});

// ---- 3. the phase test: every ramp at 1x to 4x and four clock phases

const SPEEDS = [1, 2, 3, 4], PHASES = [0, 0.25, 0.5, 0.75];
for (const sz of ['120x40', '80x24', '240x67']) {
  test(`cortex phase ${sz}: speeds 1x to 4x (frame step speed/18 s) at four clock phases, 120 s each, every rule passes at the meter's 1x playback (and at its 4x too for the 1x frames)`, () => {
    const [cols, rows] = sz.split('x').map(Number);
    const worst = { l1: 0, l2: 0, l3: 0, r: 0 };
    const lines = [];
    for (const speed of SPEEDS) {
      for (const phase of PHASES) {
        const rep = run(cortex, cols, rows, { speed, phase, seconds: 120, start: 3 });
        const x4 = speed === 1;
        worst.l1 = Math.max(worst.l1, rep.l1.x1.worstFraction, x4 ? rep.l1.x4.worstFraction : 0);
        worst.l2 = Math.max(worst.l2, rep.l2.x1.worstFraction, x4 ? rep.l2.x4.worstFraction : 0);
        worst.l3 = Math.max(worst.l3, rep.l3.worstFraction); worst.r = Math.max(worst.r, rep.r.x1.worstFraction, x4 ? rep.r.x4.worstFraction : 0);
        lines.push(`${speed}x phase ${phase}: ${show(rep)}`);
        assert.deepEqual(failed(rep).filter((id) => speed === 1 || X1.includes(id)), [], `${sz} ${speed}x phase ${phase}: ${show(rep)}`);
      }
    }
    console.log(`PHASE ${sz}: worst over 16 runs L1 ${pc(worst.l1)} L2 ${pc(worst.l2)} L3 ${pc(worst.l3)} R ${pc(worst.r)}`);
  });
}

// The ramps of Cortex are all of one kind: a thin object that steps or fades in time (the pulse head's brightness, the focus sweep, a numeral's light, the figure's
// 1/6 s steps, the trace's half-second steps, the ripple of the glass). At every speed and clock phase none may move by more in one frame than its own slope
// allows, and each must reach both of its ends.
test('cortex phase (ramps): at speeds 1x to 4x and four clock phases the pulse amplitude, the numeral light, the focus sweep and the ripple never step faster than their own slope, and each reaches both ends', () => {
  const o = { k: 0, conn: 0, p: 0, amp: 0 };
  const lines = [];
  for (const speed of SPEEDS) {
    for (const phase of PHASES) {
      const step = speed / FPS;
      // the pulse: amplitude rises over 0.15 of 2.4 s and falls over the last 0.15 (slope at most 1.5 / 0.36 s = 4.2 a second at the steepest: 1.5 x 1/0.36)
      let pmax = 0, peak = 0, lo = 1;
      for (let T = phase * step; T < 12; T += step) {
        cx.pulseState(T, o); const a = o.amp; cx.pulseState(T + step, o);
        pmax = Math.max(pmax, Math.abs(o.amp - a)); peak = Math.max(peak, a); if (T < 2.4) lo = Math.min(lo, a);
      }
      assert.ok(pmax <= step * 4.2 + 1e-9, `${speed}x phase ${phase}: the pulse steps ${pmax} in one frame`);
      assert.ok(peak > 0.95 || speed > 2, `${speed}x phase ${phase}: the pulse reaches ${peak}`);
      assert.ok(lo < 0.05 || speed > 1, `${speed}x phase ${phase}: and it starts from nothing (${lo})`);
      // a numeral's light: 1 - smoothstep(0, 1.2, age): slope at most 1.5 / 1.2 a second
      let lmax = 0;
      for (let age = phase * step; age < 1.2; age += step) { const f = (a) => 1 - cx.smoothstep(0, cx.LIT, a); lmax = Math.max(lmax, Math.abs(f(age + step) - f(age))); }
      assert.ok(lmax <= step * (1.5 / cx.LIT) + 1e-9, `${speed}x phase ${phase}: a numeral's light steps ${lmax}`);
      // the glass ripple: at most one column between two neighbouring rows at any instant, whatever the frame step
      let ripple = 0;
      for (let T = phase * step; T < 126; T += step) for (let i = 0; i < 4; i++) { const h = 15; for (let r = 1; r < h; r++) ripple = Math.max(ripple, Math.abs(cx.paneRowOffset(i, r, h, T) - cx.paneRowOffset(i, r - 1, h, T))); }
      assert.ok(ripple <= 1, `${speed}x phase ${phase}: neighbouring rows ${ripple} columns apart`);
      lines.push(`${speed}x phase ${phase}: pulse step ${pmax.toFixed(3)} (slope limit ${(step * 4.2).toFixed(3)}), numeral light step ${lmax.toFixed(3)}, ripple ${ripple}`);
    }
  }
  console.log(['PHASE ramps', ...lines].join('\n  '));
});

test('cortex phase (steps): the focus sweep lights each border cell once and the typed captions add at most 3 characters a frame at 4x, at every clock phase', () => {
  const o = { index: 0, text: '', n: 0, phase: '', start: 0 };
  for (const speed of SPEEDS) {
    for (const phase of PHASES) {
      const step = speed / FPS;
      let worstType = 0, worstErase = 0;
      for (let T = 0.5 + phase * step; T < 70; T += step) {
        cx.captionState(1, T, o); const a = o.n, ph = o.phase; cx.captionState(1, T + step, o);
        const d = o.n - a;
        if (ph === 'type' && d > 0) worstType = Math.max(worstType, d); else if (ph === 'erase' && d < 0) worstErase = Math.max(worstErase, -d);
      }
      assert.ok(worstType <= Math.ceil(24 * step) + 1, `${speed}x phase ${phase}: ${worstType} characters typed in one frame`);
      assert.ok(worstErase <= Math.ceil(48 * step) + 1, `${speed}x phase ${phase}: ${worstErase} characters erased in one frame`);
    }
  }
});

// ---- 4. the controls: the meter bites on this path

test('cortex controls: a strobe over the scene\'s own frames (every cell black and white on alternate frames) fails L1 and L2', () => {
  const cols = 60, rows = 20;
  const cc = createCellComposer({ scenes: [cortex], cols, rows, seed: 1 });
  const meter = createFlashMeter(cols, rows, FPS);
  for (let k = 0; k < 6 * FPS; k++) {
    const f = cc.frame({ a: 0, b: 0, p: 0 }, k / FPS);
    const g = { cols, rows, glyphs: f.glyphs.slice(), shades: f.shades.slice(), fg: f.fg.slice(), bg: f.bg.slice() };
    g.fg.fill(k % 2 ? 0xffffff : 0x000000); g.bg.fill(k % 2 ? 0xffffff : 0x000000);
    meter.push(g);
  }
  const rep = meter.report();
  assert.ok(!rep.pass && failed(rep).includes('l1.x1') && failed(rep).includes('l2.x1'), show(rep));
});

test('cortex controls: the same scene with its glass lit at once (every pane\'s background flipped between the glass and white every half second) fails the meter (L3 and more), so the meter does see the panes', () => {
  const cols = 120, rows = 40;
  const cc = createCellComposer({ scenes: [cortex], cols, rows, seed: 1 });
  const meter = createFlashMeter(cols, rows, FPS);
  for (let k = 0; k < 20 * FPS; k++) {
    const f = cc.frame({ a: 0, b: 0, p: 0 }, k / FPS);
    const g = { cols, rows, glyphs: f.glyphs.slice(), shades: f.shades.slice(), fg: f.fg.slice(), bg: f.bg.slice() };
    if (Math.floor(k / 9) % 2 === 1) for (let i = 0; i < cols * rows; i++) if (g.bg[i] === cx.PANE_BG) { g.bg[i] = 0xe0e8ff; g.fg[i] = 0xe0e8ff; g.glyphs[i] = 32; }
    meter.push(g);
  }
  const rep = meter.report();
  console.log(`CONTROL glass flipped to white every 0.5 s: ${show(rep)}`);
  assert.ok(!rep.pass && failed(rep).length >= 2 && failed(rep).includes('l3'), show(rep));
});

test('cortex controls: a Cortex clocked 16 times faster (the scene clock at 4x seen at the meter\'s 4x is 16x: the pulse, the focus sweep and the glass ripple at 16 frames each) is still dark and quiet, so the scene\'s margin is real: the meter does not fail it at 4x of 4x', () => {
  const rep = run(cortex, 120, 40, { seconds: 120, speed: 4, start: 0 });
  assert.deepEqual(failed(rep).filter((id) => X1.includes(id)), [], show(rep));
});

// ---- 5. the byte budget

// Measured with measureBytes at BUDGET_RUN (60 s at 120x40, 30 s at 240x67, the real renderer, truecolor, seed 1). The scene is dark and sparse (under 5 % of the cells change a frame).
const MEASURED = { '120x40': { steady: 14_043, worst: 17_806 }, '240x67': { steady: 14_976, worst: 18_700 } };
// The limits: measured x 1.10, rounded up to the next 10 KB/s (limitFromMeasured), each under the global ceilings.
const LIMIT = { '120x40': { steady: 20_000, worst: 20_000 }, '240x67': { steady: 20_000, worst: 30_000 } };

for (const sz of ['120x40', '240x67']) {
  test(`cortex bytes ${sz}: steady and worst second are within the scene's own limits, which are measured x 1.10 rounded up to 10 KB/s and under STEADY_CEILING and WORST_SECOND_CEILING`, () => {
    const [cols, rows] = sz.split('x').map(Number);
    const m = measureBytes(cortex, cols, rows, BUDGET_RUN[sz]);
    console.log(`BYTES ${sz}: steady ${Math.round(m.steady)} B/s, worst second ${m.worst} B (limits ${LIMIT[sz].steady} / ${LIMIT[sz].worst}; ceilings ${STEADY_CEILING} / ${WORST_SECOND_CEILING})`);
    assert.equal(LIMIT[sz].steady, limitFromMeasured(MEASURED[sz].steady));
    assert.equal(LIMIT[sz].worst, limitFromMeasured(MEASURED[sz].worst));
    assert.ok(Math.abs(m.steady - MEASURED[sz].steady) < 2000, `steady ${m.steady} is not the measured ${MEASURED[sz].steady}`);
    assert.ok(Math.abs(m.worst - MEASURED[sz].worst) < 20000, `worst ${m.worst} is not the measured ${MEASURED[sz].worst}`);
    checkBudget(m, LIMIT[sz]);
    assert.ok(LIMIT[sz].steady <= STEADY_CEILING && LIMIT[sz].worst <= WORST_SECOND_CEILING);
    assert.throws(() => checkBudget(m, { steady: Math.floor(m.steady) - 1, worst: LIMIT[sz].worst }), /steady/);
    assert.throws(() => checkBudget(m, { steady: LIMIT[sz].steady, worst: m.worst - 1 }), /worst/);
  });
}

// ---- 6. CPU

test('cortex CPU: mean scene + render per frame at 240x67 (180 frames after 18 warm-up, best of 3) is under the 27 ms ceiling', () => {
  const m = measureCpu(cortex);
  console.log(`CPU cortex 240x67: best mean ${m.meanMs.toFixed(2)} ms per frame (runs ${m.runsMs.map((x) => x.toFixed(2)).join(', ')}; ceiling ${CPU_MEAN_CEILING_MS})`);
  assert.equal(m.frames, 180);
  checkCpu(m);
});
