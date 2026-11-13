// DRIFT-7 C15c: Bloomfall against the flash meter (every rule L1, L2, L3, R at 1x and 4x), on truecolor output and on 256-colour output
// (the renderer's own nearest256 through makeReducer256), the phase test on every ramp, its byte budget and its CPU budget. Structure and look
// are in driftman-9000-bloomfall.test.js; the dissolves with the other visions are in driftman-9000-dissolve.test.js.
// The scene runs solo through the real cell composer, frame k at t = (k + phase) / 18, 66 s (eleven blooms' lives and more), at 120x40, 80x24,
// 240x67, 61x21, 60x20 and the size just above each layout breakpoint (compact 78x24, full 88x39, extra-large 176x58).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlashMeter, failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { frameAtSpeed, flashRig, bloom as bloomControl, runControl } from './helpers-flash-controls.js';
import {
  STEADY_CEILING, WORST_SECOND_CEILING, CPU_MEAN_CEILING_MS, BUDGET_RUN, limitFromMeasured, measureBytes, checkBudget, measureCpu, checkCpu,
} from './helpers-budget.js';
import { createCellComposer } from '../src/cells.js';
import { nearest256 } from '../src/renderer.js';
import bloomfall from '../cartridges/driftman-9000/scenes/bloomfall.js';

const FPS = 18;
const SECONDS = 66;
const pc = (x) => (x * 100).toFixed(1);
const show = (rep) => `L1 ${pc(rep.l1.x1.worstFraction)}/${pc(rep.l1.x4.worstFraction)} L2 ${pc(rep.l2.x1.worstFraction)}/${pc(rep.l2.x4.worstFraction)} L3 ${pc(rep.l3.worstFraction)} R ${pc(rep.r.x1.worstFraction)}/${pc(rep.r.x4.worstFraction)} C ${pc(rep.c.worstFraction)}`;
// speeds above 1x: the shell's frames step speed/18 s and the viewer sees them at 18 fps, which is the meter's 1x playback; the meter's own 4x view is a stress on the 1x
// frames (it equals the shell at 4x, up to sampling), so it is judged at 1x only (a 2x shell viewed at the meter's 4x is 8x, outside the shell's speeds)
const X1 = X1_RULE_IDS; // l1, l2, l3, r at x1, and the colour rule C (DRIFT-8 C4: judged at the playback speed, so the 4x runs are judged on it too)
const failed = (rep) => failedRules(rep);

// One solo run through the composer. `step` is the frame step in seconds (1/18 at the shell's 1x; speed/18 at 2x to 4x). reduce256: as 256-colour output shows it.
function run(scene, cols, rows, { phase = 0, seed = 1, seconds = SECONDS, reduce256 = false, speed = 1, start = 0 } = {}) {
  const rig = flashRig([scene], cols, rows, { seed, mode: reduce256 ? '256' : 'truecolor' }); // a 256 run gets a 256 composer (scenes see params.cmode)
  const meter = createFlashMeter(cols, rows, FPS);
  const N = Math.round((seconds * FPS) / speed);
  for (let k = 0; k < N; k++) {
    const s = rig.show(frameAtSpeed(rig.cc, { a: 0, b: 0, p: 0 }, start + ((k + phase) * speed) / FPS, speed));
    meter.push(s.frame, s.palette);
  }
  return meter.report();
}

// ---- 1. truecolor, solo, 1x and 4x

const SIZES = ['120x40', '80x24', '61x21', '60x20', '78x24', '88x39', '176x58', '240x67'];
const EXTRA = { '120x40': [{ phase: 0.5 }, { seed: 2 }, { seed: 3, phase: 0.25 }], '78x24': [{ phase: 0.5 }, { seed: 2 }], '88x39': [{ seed: 2 }, { seed: 3, phase: 0.25 }], '240x67': [{ seed: 2 }], '60x20': [{ seed: 2 }], '80x24': [{ seed: 2 }] };

for (const sz of SIZES) {
  test(`bloomfall flash ${sz}: solo for ${SECONDS} s, every rule passes at 1x and 4x (clock phases and seeds: ${(EXTRA[sz] || []).map((o) => JSON.stringify(o)).join(' ') || 'the default only'})`, () => {
    const [cols, rows] = sz.split('x').map(Number);
    const lines = [];
    for (const o of [{}, ...(EXTRA[sz] || [])]) {
      const rep = run(bloomfall, cols, rows, o);
      lines.push(`${sz} ${JSON.stringify(o)} truecolor ${show(rep)}`);
      assert.deepEqual(failed(rep), [], `${sz} ${JSON.stringify(o)}: ${show(rep)}`);
    }
    console.log('METER ' + lines.join('\n      '));
  });
}

// ---- 2. 256-colour output

for (const sz of ['120x40', '80x24', '61x21', '88x39', '176x58', '240x67']) {
  test(`bloomfall flash ${sz} on 256-colour output (nearest256): every rule passes at 1x and 4x`, () => {
    const [cols, rows] = sz.split('x').map(Number);
    const lines = [];
    for (const o of [{}, { seed: 2 }]) {
      const rep = run(bloomfall, cols, rows, { ...o, reduce256: true });
      lines.push(`${sz} ${JSON.stringify(o)} 256-colour ${show(rep)}`);
      assert.deepEqual(failed(rep), [], `${sz} ${JSON.stringify(o)}: ${show(rep)}`);
    }
    console.log('METER ' + lines.join('\n      '));
  });
}

test('bloomfall 256 colours: the output is not garbage, at least 24 distinct 256-colour indexes over 60 s, every index a cube or grey entry', () => {
  const cols = 120, rows = 40, n = cols * rows;
  const cc = createCellComposer({ scenes: [bloomfall], cols, rows, seed: 1 });
  const used = new Set();
  for (let k = 0; k < 60 * FPS; k += 5) {
    const f = cc.frame({ a: 0, b: 0, p: 0 }, k / FPS);
    for (let i = 0; i < n; i++) { used.add(nearest256(f.fg[i])); used.add(nearest256(f.bg[i])); }
  }
  console.log(`256-colour: ${used.size} distinct indexes`);
  assert.ok(used.size >= 24, `${used.size}`);
  for (const i of used) assert.ok(i >= 16 && i <= 255, `index ${i}`);
});

// ---- 3. the phase test: every ramp (the envelope, pop up and down, pollen fade) at 1x to 4x and four clock phases

const SPEEDS = [1, 2, 3, 4], PHASES = [0, 0.25, 0.5, 0.75];
for (const sz of ['120x40', '80x24', '240x67']) {
  test(`bloomfall phase ${sz}: speeds 1x to 4x (frame step speed/18 s) at four clock phases, 60 s each, every rule passes at the meter's 1x playback (and at its 4x too for the 1x frames)`, () => {
    const [cols, rows] = sz.split('x').map(Number);
    const worst = { l1: 0, l2: 0, l3: 0, r: 0 };
    const lines = [];
    for (const speed of SPEEDS) {
      for (const phase of PHASES) {
        const rep = run(bloomfall, cols, rows, { speed, phase, seconds: 60, start: 3 });
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

test('bloomfall phase (ramps): at speeds 1x to 4x and four clock phases the envelope never steps faster than its own slope (1 a second up, 0.6 down), the pop rises over at least one frame step at 1x and the pollen fades in over several, and every ramp reaches its ends', () => {
  const bf = bloomfallApi;
  const b = bf.plan(1, 120, 40, 30).blooms[3];
  const s = { x: 0, y: 0, a: 0 }, s2 = { x: 0, y: 0, a: 0 };
  const lines = [];
  for (const speed of SPEEDS) {
    for (const phase of PHASES) {
      const step = speed / FPS;
      let up = 0, down = 0, pollen = 0, peakE = 0, peakPop = 0, peakPollen = 0;
      for (let tau = phase * step; tau < 7; tau += step) {
        const d = bf.envelope(tau + step) - bf.envelope(tau);
        if (d > 0) up = Math.max(up, d); else down = Math.max(down, -d);
        peakE = Math.max(peakE, bf.envelope(tau));
        peakPop = Math.max(peakPop, bf.popAmp(((tau * 7) % 0.6) + 0));
      }
      for (let a = phase * step; a < 3; a += step) { bf.speckState(b, 0, a, s); bf.speckState(b, 0, a + step, s2); pollen = Math.max(pollen, Math.abs(s2.a - s.a)); peakPollen = Math.max(peakPollen, s.a); }
      assert.ok(up <= step * 1.0 + 1e-9 && down <= step * 0.6 + 1e-9, `${speed}x phase ${phase}: up ${up} down ${down}`);
      assert.ok(peakE > 0.9 || speed > 1, `${speed}x phase ${phase}: the envelope reaches ${peakE}`);
      assert.ok(peakPollen > 0.5 || speed > 2, `${speed}x phase ${phase}: pollen reaches ${peakPollen}`);
      lines.push(`${speed}x phase ${phase}: E step up ${up.toFixed(3)} down ${down.toFixed(3)}, pollen step ${pollen.toFixed(3)}`);
    }
  }
  // a pop at 1x: up over 0.1 s is under two frames, the fall over 0.5 s is 9 frames
  let popUp = 0, popDown = 0;
  for (let ph = 0; ph < 1; ph += 0.25) for (let age = ph / FPS; age < 0.6; age += 1 / FPS) { const d = bf.popAmp(age + 1 / FPS) - bf.popAmp(age); if (d > 0) popUp = Math.max(popUp, d); else popDown = Math.max(popDown, -d); }
  console.log(['PHASE ramps', ...lines, `pop at 1x: biggest rise per frame ${popUp.toFixed(3)}, biggest fall ${popDown.toFixed(3)}`].join('\n  '));
  assert.ok(popDown < 0.25 && popUp <= 1);
});
import * as bloomfallApi from '../cartridges/driftman-9000/scenes/bloomfall.js';

// ---- 4. the controls: the meter bites on this path

test('bloomfall controls: a 2 s bloom (helpers-flash-controls bloom, period 2) fails L2 at 4x; the same scene with its envelope sped up to 1.5 s a period fails too; the shipped one passes', () => {
  const two = runControl(bloomControl(120, 40, { period: 2 }), {});
  assert.ok(!two.pass && failed(two).includes('l2.x4'), show(two));
  // a Bloomfall whose bloom lives 4x faster (the scene clock run at 4x, which is the meter's 4x of a 1.5 s period): the shipped scene's own frames at 4x of scene speed
  const fast = run(bloomfall, 120, 40, { seconds: 120, speed: 4, start: 0 });
  console.log(`CONTROL 2 s bloom ${show(two)} | scene clocked 4x then viewed at 4x (16x) ${show(fast)}`);
  assert.ok(!fast.pass, `a scene clock at 16x must fail: ${show(fast)}`);
  const ok = run(bloomfall, 120, 40, { seconds: 30 });
  assert.ok(ok.pass, show(ok));
});

test('bloomfall controls: a strobe over the scene\'s own frames (every cell black and white on alternate frames) fails L1 and L2', () => {
  const cols = 60, rows = 20;
  const cc = createCellComposer({ scenes: [bloomfall], cols, rows, seed: 1 });
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

// ---- 5. the byte budget

// Measured with measureBytes at BUDGET_RUN (60 s at 120x40, 30 s at 240x67, the real renderer, truecolor, seed 1). The scene is dim (L 0.22 field), so its colours are short SGR numbers and about a quarter of the cells repeat a frame: far under the Rosette's 9 MB/s.
const MEASURED = { '120x40': { steady: 844_383, worst: 1_253_095 }, '240x67': { steady: 2_526_639, worst: 3_613_862 } };
// The limits: measured x 1.10, rounded up to the next 10 KB/s (limitFromMeasured), each under the global ceilings.
const LIMIT = { '120x40': { steady: 930_000, worst: 1_380_000 }, '240x67': { steady: 2_780_000, worst: 3_980_000 } };

for (const sz of ['120x40', '240x67']) {
  test(`bloomfall bytes ${sz}: steady and worst second are within the scene's own limits, which are measured x 1.10 rounded up to 10 KB/s and under STEADY_CEILING and WORST_SECOND_CEILING`, () => {
    const [cols, rows] = sz.split('x').map(Number);
    const m = measureBytes(bloomfall, cols, rows, BUDGET_RUN[sz]);
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

test('bloomfall CPU: mean scene + render per frame at 240x67 (180 frames after 18 warm-up, best of 3) is under the 27 ms ceiling', () => {
  const m = measureCpu(bloomfall);
  console.log(`CPU bloomfall 240x67: best mean ${m.meanMs.toFixed(2)} ms per frame (runs ${m.runsMs.map((x) => x.toFixed(2)).join(', ')}; ceiling ${CPU_MEAN_CEILING_MS})`);
  assert.equal(m.frames, 180);
  checkCpu(m);
});
