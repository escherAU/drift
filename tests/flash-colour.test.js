// DRIFT-8 C4: rule C, the colour-flicker rule of the flash meter (tests/helpers-flash.js, "Rule C"), proved on controls. Rule C is a HOUSE RULE beyond WCAG
// (WCAG calls a change of hue at steady brightness free): each pixel's colour in OKLab, four axes (a, b and the diagonals (a + b) / sqrt 2 and (a - b) / sqrt 2),
// a swing is a change of 0.10 or more between turning points, a pixel is hot with 7 swings in a second on any axis, and the rule fails when hot pixels are more than
// 25% of a field. 7 swings a second is a hue turning 3.5 cycles a second; that limit and the swing are never loosened.
//
//   T4.1  must-fail controls (a to e) at several sizes, every one holding brightness steady so that only rule C can see it; and the pass arm of each pair
//   T4.1  the verdict does not depend on the sample the rule was tuned on: another frame rate, another clock phase, 256 colours
//   T4.6  the owner's praised probe (a kaleidoscope with the hue at 0.15 cycles a second and a rotation of 0.08 turns a second) FAILS rule C because of the rotation,
//         and a Rosette-speed rotation (ten times slower) passes
//   (T4.1f, the Rosette without the colour clock at real 4x, is in tests/flash-colour-scenes.test.js; T4.2, the blind-meter mutations, in tests/flash-colour-mutation.test.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlashMeter, luminanceOf, RULE_IDS, ruleOf, failedRules, COLOUR_SWING, C_COUNT, COLOUR_AXES, FIELD_FRACTION } from './helpers-flash.js';
import { runControl, safeKaleidoscope, newFrame } from './helpers-flash-controls.js';
import {
  labPack, labHue, colourPair, diagonalPair, hueWobble, hueSpin, DIAG_1, DIAG_2, ANTI_1, ANTI_2, CONTROL_L,
} from './helpers-flash-colour.js';
import { halvesSwap, TEAL, AMBER, TEAL_AMBER_DY } from './helpers-flash-halves.js';

const pct = (x) => (x * 100).toFixed(1);
const TABLE = [];
const row = (label, size, rep) => TABLE.push(`${label.padEnd(44)} ${size.padEnd(7)} C ${pct(rep.c.worstFraction).padStart(5)} (cell ${pct(rep.cell.c.worstFraction).padStart(5)} pixel ${pct(rep.pixel.c.worstFraction).padStart(5)})  brightness+red fail: ${failedRules(rep, { not: ['c'] }).join(',') || 'none'}`);

// sizes: the small and the large of the screen, and the one in between (the meter was tuned at 120x40)
const SIZES = [[61, 21], [80, 24], [120, 40], [280, 70]];
const SECONDS = 8;
// the biggest size runs 4 s, not 8 (72 frames are plenty for a 1 s window, and its cost is the cost of the file)
const run = (gen, [cols, rows], o = {}) => runControl(gen, { cols, rows, seconds: cols >= 200 ? 4 : SECONDS, ...o });
const failsC = (rep) => rep.c.worstFraction > FIELD_FRACTION && !rep.c.pass && !rep.pass;

// ---- the constants

test('rule C constants: swing 0.10, 7 swings, four axes, the field is the L2 field; the report carries c on both grids and in the worse-of', () => {
  assert.equal(COLOUR_SWING, 0.10);
  assert.equal(C_COUNT, 7);
  assert.equal(COLOUR_AXES, 4);
  assert.equal(FIELD_FRACTION, 0.25);
  const rep = run(colourPair(61, 21, { c1: TEAL, c2: AMBER, hz: 4 }), [61, 21]);
  assert.ok(RULE_IDS.includes('c'));
  for (const sub of [rep, rep.cell, rep.pixel]) {
    assert.equal(sub.c.limit, 0.25);
    assert.equal(typeof sub.c.worstFraction, 'number');
    assert.ok(sub.c.details && 'frame' in sub.c.details && 'timeS' in sub.c.details);
  }
  assert.equal(rep.c.worstFraction, Math.max(rep.cell.c.worstFraction, rep.pixel.c.worstFraction));
  assert.equal(rep.c.pass, rep.cell.c.pass && rep.pixel.c.pass);
  assert.equal(rep.c.details.field.w, rep.l2.x1.details.field.w, 'the same field as L2');
  assert.equal(rep.c.details.field.h, rep.l2.x1.details.field.h);
});

// ---- the control colours really are what they say (the controls are not tested on faith)

test('control colours: the diagonal pairs hold lightness and move only along one diagonal; teal and amber hold lightness; every control colour is in gamut', () => {
  const oklab = (c) => {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const r = lin((c >> 16) & 255), g = lin((c >> 8) & 255), b = lin(c & 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  };
  const d = (c1, c2) => { const a = oklab(c1), b = oklab(c2); return { dL: b[0] - a[0], da: b[1] - a[1], db: b[2] - a[2] }; };
  for (const [c1, c2, along] of [[DIAG_1, DIAG_2, 'a+b'], [ANTI_1, ANTI_2, 'a-b']]) {
    const { dL, da, db } = d(c1, c2);
    assert.ok(Math.abs(dL) < 0.005, `lightness differs by ${dL.toFixed(4)}`);
    assert.ok(Math.abs(Math.abs(da) - 0.09) < 0.004 && Math.abs(Math.abs(db) - 0.09) < 0.004, `da ${da.toFixed(3)} db ${db.toFixed(3)}: 0.09 each, under the 0.10 swing`);
    const diag = Math.abs(along === 'a+b' ? da + db : da - db) * Math.SQRT1_2, other = Math.abs(along === 'a+b' ? da - db : da + db) * Math.SQRT1_2;
    assert.ok(diag > 0.12 && other < 0.01, `along ${along}: ${diag.toFixed(3)}, the other diagonal ${other.toFixed(3)}`);
    assert.ok(Math.abs(Math.hypot(da, db) - 0.127) < 0.006, `dE ${Math.hypot(da, db).toFixed(3)}`);
    assert.ok(Math.abs(luminanceOf(c1) - luminanceOf(c2)) < 0.02, 'and the WCAG luminance is a few thousandths apart: no brightness swing');
  }
  const t = d(TEAL, AMBER);
  assert.ok(Math.hypot(t.da, t.db) > 0.15 && TEAL_AMBER_DY < 0.02, `teal/amber: dE ${Math.hypot(t.da, t.db).toFixed(3)}, dY ${TEAL_AMBER_DY.toFixed(4)}`);
  assert.throws(() => labPack(0.68, 0.4, 0.4), /outside sRGB/, 'labPack is strict');
  for (let h = 0; h < 360; h += 5) assert.doesNotThrow(() => labHue(CONTROL_L, 0.11, h / 360), `hue ${h}`);
});

// ---- T4.1 a: an equal-brightness pair with delta a = delta b = 0.09 (dE 0.127)

for (const size of SIZES) {
  test(`T4.1a ${size.join('x')}: the equal-brightness pair with delta a = delta b = 0.09 (dE 0.127) alternating at 4 Hz and at 6 Hz FAILS rule C and no brightness rule; at 3 Hz it passes`, () => {
    for (const anti of [false, true]) {
      for (const hz of [4, 6]) {
        const rep = run(diagonalPair(...size, { hz, anti }), size);
        row(`T4.1a ${anti ? 'anti-' : ''}diagonal pair ${hz} Hz`, size.join('x'), rep);
        assert.ok(failsC(rep), `${anti ? 'anti' : ''}diagonal ${hz} Hz: C ${pct(rep.c.worstFraction)}`);
        assert.ok(rep.c.worstFraction > 0.99, 'the whole field');
        assert.deepEqual(failedRules(rep, { not: ['c'] }), [], 'brightness and red read nothing: this is a colour-only change');
        assert.ok(rep.pixel.c.worstFraction > 0.99 && rep.cell.c.worstFraction > 0.99);
      }
      const slow = run(diagonalPair(...size, { hz: 3, anti }), size);
      row(`T4.1a ${anti ? 'anti-' : ''}diagonal pair 3 Hz (pass arm)`, size.join('x'), slow);
      assert.deepEqual(failedRules(slow), [], `3 Hz is 6 swings a second: ${pct(slow.c.worstFraction)}`);
      assert.equal(slow.c.worstFraction, 0);
    }
  });
}

// ---- T4.1 b: a hue wobble of 45 +/- 40 degrees at 4 Hz, the same verdict at any centre

for (const size of SIZES) {
  test(`T4.1b ${size.join('x')}: a hue wobble of +/- 40 degrees at 4 Hz FAILS rule C with the SAME verdict centred on hue 0, 45 and 90 (a meter that follows a and b alone is hue-dependent)`, () => {
    const verdicts = [];
    for (const centre of [0, 45, 90, 135]) {
      const rep = run(hueWobble(...size, { centre, amp: 40, hz: 4 }), size);
      row(`T4.1b hue wobble ${centre} +/- 40 deg 4 Hz`, size.join('x'), rep);
      verdicts.push(JSON.stringify(failedRules(rep)));
      assert.ok(failsC(rep), `centre ${centre}: C ${pct(rep.c.worstFraction)}`);
      assert.deepEqual(failedRules(rep, { not: ['c'] }), []);
      assert.ok(rep.c.worstFraction > 0.99, `centre ${centre}`);
    }
    assert.equal(new Set(verdicts).size, 1, `one verdict at every centre: ${verdicts}`);
    const slow = run(hueWobble(...size, { centre: 45, amp: 40, hz: 3 }), size);
    row('T4.1b hue wobble 45 +/- 40 deg 3 Hz (pass arm)', size.join('x'), slow);
    assert.deepEqual(failedRules(slow), []);
  });
}

// ---- T4.1 c: the whole screen turning hue: 3.6 cycles a second fails, 3.0 passes

// The limit is 7 swings a second on one axis = 3.5 cycles a second of hue. 3.0 cycles a second (6 swings) is the pass arm the brief names and passes at the tuned sample
// (18 fps, truecolor, a run that starts on a turning point). It sits close enough to the line that three things move it, all measured below and none a loosening: the first
// excursion from the run's first frame is a swing too (about one start phase in five puts a 7th swing in the first second: frame 19, never later), 24 fps, and the 256-colour
// cube (a quantised hue wheel adds jitter). 2.6 cycles a second (5.2 swings) passes in every one of those, and is the pass arm where the phase is not the tuned one.
const spin = (size, cps, phase = 0, o = {}) => { const g = hueSpin(...size, { cps }); return run((t) => g(t + phase), size, o); };
for (const size of SIZES) {
  test(`T4.1c ${size.join('x')}: the whole screen turning hue at 3.6 cycles a second FAILS rule C at four clock phases (one at the biggest size); at 3.0 cycles a second it PASSES (the 3.5 limit is not loosened); at 2.6 it passes at the same four phases`, () => {
    for (const phase of size[0] >= 200 ? [0] : [0, 0.11, 0.23, 0.37]) { // the biggest size at the tuned phase only: its cost is the cost of the file
      const fast = spin(size, 3.6, phase);
      row(`T4.1c hue turning 3.6 cycles/s, phase ${phase}`, size.join('x'), fast);
      assert.ok(failsC(fast), `3.6 cycles/s phase ${phase}: C ${pct(fast.c.worstFraction)}`);
      assert.deepEqual(failedRules(fast, { not: ['c'] }), []);
      const slow = spin(size, 2.6, phase);
      row(`T4.1c hue turning 2.6 cycles/s, phase ${phase} (pass arm)`, size.join('x'), slow);
      assert.deepEqual(failedRules(slow), [], `2.6 cycles/s phase ${phase}: C ${pct(slow.c.worstFraction)}`);
    }
    const tuned = spin(size, 3.0, 0);
    row('T4.1c hue turning 3.0 cycles/s, phase 0 (pass arm)', size.join('x'), tuned);
    assert.deepEqual(failedRules(tuned), [], `3.0 cycles/s: C ${pct(tuned.c.worstFraction)}`);
  });
}

test('T4.1c the edge of the pass arm, measured: over 60 start phases 3.6 cycles/s fails at every one, 2.6 at none; 3.0 fails at some, ALWAYS at frame 19 (the first second: its first excursion counts as a swing) and never later', () => {
  const size = [40, 12];
  const N = 60;
  let fast = 0, slow = 0, edge = 0;
  const frames = new Set();
  for (let i = 0; i < N; i++) {
    const phase = i / N / 3; // one period of a 3 cycles/s turn
    if (spin(size, 3.6, phase, { seconds: 5 }).c.pass === false) fast++;
    if (spin(size, 2.6, phase, { seconds: 5 }).c.pass === false) slow++;
    const e = spin(size, 3.0, phase, { seconds: 5 });
    if (!e.c.pass) { edge++; frames.add(e.c.details.frame); }
  }
  TABLE.push(`T4.1c edge over ${N} start phases: 3.6 cycles/s fails ${fast}, 3.0 fails ${edge} (at frames ${[...frames]}), 2.6 fails ${slow}`);
  assert.equal(fast, N);
  assert.equal(slow, 0);
  assert.ok(edge < N * 0.3, `3.0 fails at ${edge} of ${N} start phases`);
  assert.deepEqual([...frames].filter((f) => f > 19), [], 'and only in the first second');
});

test('T4.1c at another frame rate: 24 fps (about 9 frames to a cycle at 2.6, 6.7 at 3.6) gives the same two verdicts (3.0 is printed: it is on the edge there)', () => {
  for (const [cols, rows] of [[80, 24], [120, 40]]) {
    const at = (cps) => runControl(hueSpin(cols, rows, { cps }), { cols, rows, fps: 24, seconds: SECONDS });
    const fast = at(3.6), slow = at(2.6), edge = at(3.0);
    row('T4.1c hue turning 3.6 cycles/s at 24 fps', `${cols}x${rows}`, fast); row('T4.1c hue turning 2.6 cycles/s at 24 fps', `${cols}x${rows}`, slow); row('T4.1c hue turning 3.0 cycles/s at 24 fps (edge, printed)', `${cols}x${rows}`, edge);
    assert.ok(failsC(fast), pct(fast.c.worstFraction));
    assert.deepEqual(failedRules(slow), [], pct(slow.c.worstFraction));
  }
});

// ---- T4.1 d: teal/amber at one lightness (the C2 KNOWN GAP test, now asserting rule C)

for (const size of SIZES) {
  test(`T4.1d ${size.join('x')}: teal and amber at one lightness alternating at 4 Hz FAIL rule C (the C2 known gap, closed), at 3 Hz PASS; the brightness and red rules read 0 either way`, () => {
    assert.ok(TEAL_AMBER_DY < 0.02);
    const fast = run(colourPair(...size, { c1: TEAL, c2: AMBER, hz: 4 }), size);
    row('T4.1d teal/amber 4 Hz', size.join('x'), fast);
    assert.ok(failsC(fast), `4 Hz: C ${pct(fast.c.worstFraction)}`);
    assert.deepEqual(failedRules(fast, { not: ['c'] }), [], 'the C2 meter read this as 0.0 on every rule');
    for (const id of RULE_IDS.filter((r) => r !== 'c')) assert.equal(ruleOf(fast, id).worstFraction, 0, id);
    const slow = run(colourPair(...size, { c1: TEAL, c2: AMBER, hz: 3 }), size);
    row('T4.1d teal/amber 3 Hz (pass arm)', size.join('x'), slow);
    assert.deepEqual(failedRules(slow), []);
  });
}

// ---- T4.1 e: the halves of each cell swapping colour

for (const size of SIZES) {
  test(`T4.1e ${size.join('x')}: the halves of every cell swapping teal and amber at 4 Hz FAIL rule C on the pixel grid, which the cell grid (halves blended) cannot see; at 3 Hz they pass`, () => {
    const fast = run(halvesSwap(...size, { hz: 4, a: TEAL, b: AMBER }), size);
    row('T4.1e halves swap teal/amber 4 Hz', size.join('x'), fast);
    assert.ok(failsC(fast), `C ${pct(fast.c.worstFraction)}`);
    assert.ok(fast.pixel.c.worstFraction > 0.99);
    assert.equal(fast.cell.c.worstFraction, 0, 'the cell grid blends the halves into one colour that never changes');
    assert.equal(fast.c.details.grid, 'pixel');
    assert.deepEqual(failedRules(fast, { not: ['c'] }), []);
    const slow = run(halvesSwap(...size, { hz: 3, a: TEAL, b: AMBER }), size);
    row('T4.1e halves swap teal/amber 3 Hz (pass arm)', size.join('x'), slow);
    assert.deepEqual(failedRules(slow), []);
  });
}

// ---- 256 colours: the colour verdicts hold on the colours that a 256-colour terminal shows

test('T4.1 on 256-colour output: teal/amber at 4 Hz and a screen turning hue at 3.6 cycles a second FAIL rule C, the same at 3 Hz and 2.6 cycles a second pass (3.0 is printed: the jitter of the cube takes it over the line)', () => {
  for (const size of [[61, 21], [120, 40]]) {
    const o = { reduce256: true };
    const pair = run(colourPair(...size, { c1: TEAL, c2: AMBER, hz: 4 }), size, o);
    const pairSlow = run(colourPair(...size, { c1: TEAL, c2: AMBER, hz: 3 }), size, o);
    const spin = run(hueSpin(...size, { cps: 3.6 }), size, o);
    const spinSlow = run(hueSpin(...size, { cps: 2.6 }), size, o);
    row('T4.1 256 colours: hue turning 3.0 cycles/s (edge, printed)', size.join('x'), run(hueSpin(...size, { cps: 3.0 }), size, o));
    row('T4.1 256 colours: teal/amber 4 Hz', size.join('x'), pair); row('T4.1 256 colours: teal/amber 3 Hz', size.join('x'), pairSlow);
    row('T4.1 256 colours: hue turning 3.6 cycles/s', size.join('x'), spin); row('T4.1 256 colours: hue turning 2.6 cycles/s', size.join('x'), spinSlow);
    assert.ok(failsC(pair), pct(pair.c.worstFraction));
    assert.ok(failsC(spin), pct(spin.c.worstFraction));
    assert.equal(pairSlow.c.pass, true, pct(pairSlow.c.worstFraction));
    assert.equal(spinSlow.c.pass, true, `256 colours, 2.6 cycles/s: ${pct(spinSlow.c.worstFraction)}`);
  }
});

// ---- C is a colour rule, not a second brightness rule: a screen with no colour at all never trips it

test('rule C reads nothing on grey: the strobe, the bloom and a grey ramp are brightness faults, and their colour is grey (a = b = 0)', () => {
  const grey = (v) => (v << 16) | (v << 8) | v;
  const rep = run(colourPair(80, 24, { c1: grey(0x20), c2: grey(0xe0), hz: 4 }), [80, 24]);
  row('grey strobe 4 Hz (rule C blind to brightness)', '80x24', rep);
  assert.equal(rep.c.worstFraction, 0, 'a and b are 0 for every grey');
  assert.equal(rep.l1.x1.pass, false, 'and the brightness rules fail it');
  assert.deepEqual(failedRules(rep).filter((id) => id === 'c'), []);
  const m = createFlashMeter(8, 4, 18);
  const f = newFrame(8, 4);
  m.push(f);
  assert.equal(m.report().c.worstFraction, 0, 'one frame: nothing has moved');
});

// ---- T4.6: the owner's praised probe

// The probe the owner watched and praised is the kaleidoscope pattern of helpers-flash-controls (safeHue colour, six-fold, breathing) with the hue turning 0.15 cycles a
// second and the pattern rotating 0.08 turns a second. (The owner's remembered benchmark "1.5 cycles a second" is a misreading: the hue rate of the probe was 0.15.)
// Rule C refuses it. The cause is fine colour detail in motion: the pattern puts a sharp hue gradient across every pixel and the rotation sweeps it past, so each pixel's
// colour runs back and forth across the hue wheel many times a second. The hue turn alone (0.15 cycles/s) is nothing and the rotation alone sits under the limit; together
// they fail, and the Rosette rotates ten times slower (0.008) and passes. (Measured on the spike's own generator kaleidoSafe, which has more chroma: 28.9% / 42% on an a/b-only
// reading at 120x40 / 280x70, 42.8% / 57.0% on the four axes; on this repository's kaleidoscope, 44.0% over the 20 s this test runs (47.7% over 30 s) at 120x40 and 59.6% at 280x70.)
const PROBE = { rotHz: 0.08, hueHz: 0.15 };
for (const size of [[120, 40], [280, 70]]) {
  test(`T4.6 ${size.join('x')}: the owner's probe (hue 0.15 cycles/s, rotation 0.08 turns/s) FAILS rule C at 1x; the same with the rotation ten times slower (0.008, the Rosette's speed) PASSES; the hue alone passes`, () => {
    const at = (o) => runControl(safeKaleidoscope(...size, o), { cols: size[0], rows: size[1], seconds: size[0] >= 200 ? 6 : 20 }); // 20 s (6 s at 280x70, where the pattern's own cost is the cost of the file)
    const probe = at(PROBE);
    const slow = at({ ...PROBE, rotHz: 0.008 });
    const noRotation = at({ rotHz: 0, hueHz: 0.15 });
    const noHue = at({ rotHz: 0.08, hueHz: 0 });
    row('T4.6 probe: hue 0.15, rotation 0.08', size.join('x'), probe);
    row('T4.6 probe, rotation 0.008 (Rosette speed)', size.join('x'), slow);
    row('T4.6 probe, no rotation (hue 0.15 only)', size.join('x'), noRotation);
    row('T4.6 probe, no hue (rotation 0.08 only)', size.join('x'), noHue);
    assert.ok(failsC(probe), `the probe as watched: C ${pct(probe.c.worstFraction)}`);
    assert.ok(probe.c.worstFraction > 0.4, `and well over, not by a hair: ${pct(probe.c.worstFraction)}`);
    assert.deepEqual(failedRules(probe, { not: ['c'] }), [], 'it is fine on every brightness and red rule');
    assert.deepEqual(failedRules(slow), [], `a Rosette-speed rotation: C ${pct(slow.c.worstFraction)}`);
    assert.deepEqual(failedRules(noRotation), [], 'the hue alone is far under the limit');
    assert.ok(noHue.c.pass && noHue.c.worstFraction > 0.05, `the rotation alone is under the limit, by less than a factor of three: ${pct(noHue.c.worstFraction)}`);
  });
}

test('T4.6 measured table', () => {
  console.log('\nTABLE rule C controls (worst fraction of a field, %; brightness+red = the other seven rules)\n  ' + TABLE.join('\n  '));
});
