// DRIFT-8 C4: the Rosette against rule C (the colour-flicker rule of the flash meter, a HOUSE RULE beyond WCAG: tests/helpers-flash.js, "Rule C"), at the speeds the speed key
// reaches, with the colour clock as the runtime drives it.
//
//   T4.1f  the Rosette WITHOUT the colour clock (frames driven with tc = scene time, which is how the 4x replays drove it before C4) at real 4x FAILS rule C; with the clock it passes.
//          This is the must-fail control that the clock is doing the work, and (with tests/flash-colour-mutation.test.js) that the replay helper is not blind to it.
//   T4.3   the Rosette on 256 colours (and on truecolor) at real 1x, 2x and 4x, seeds 1, 2, 3 and 7, at 61x21, 80x24, 120x40 and 280x70: every number printed, all under 25%.
//   helper frameAtSpeed/colourClockAt (tests/helpers-flash-controls.js) drive tc exactly as src/shell/runtime.js advance() does.
//
// A real-speed run (runScene, helpers-flash-scenes.js) is frame k at scene time t = k * speed / 18, pushed to the meter at 18 fps (the viewer sees 18 frames a second whatever the key says).
import test from 'node:test';
import assert from 'node:assert/strict';
import { failedRules, X1_RULE_IDS, FIELD_FRACTION } from './helpers-flash.js';
import { colourClockAt } from './helpers-flash-controls.js';
import { runScene } from './helpers-flash-scenes.js';
import { loadKit, makeRuntime, setSpeed } from './helpers-colour-clock.js';
import rosette from '../cartridges/driftman-9000/scenes/rosette.js';

const pct = (x) => (x * 100).toFixed(1);
const TABLE = [];

const line = (tag, rep) => `${tag.padEnd(36)} C ${pct(rep.c.worstFraction).padStart(5)} (cell ${pct(rep.cell.c.worstFraction).padStart(5)} pixel ${pct(rep.pixel.c.worstFraction).padStart(5)})  L1 ${pct(rep.l1.x1.worstFraction)} L2 ${pct(rep.l2.x1.worstFraction)} L3 ${pct(rep.l3.worstFraction)} R ${pct(rep.r.x1.worstFraction)}`;

// ---- the helper is the runtime's clock

const kit = await loadKit();
test('colourClockAt is the runtime\'s colour clock: at every speed key step the runtime\'s tc equals t * min(speed, 1) / speed (read off the runtime, not retyped)', () => {
  assert.deepEqual(kit.app.SPEEDS, [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]);
  for (let idx = 0; idx < kit.app.SPEEDS.length; idx++) {
    const { rt } = makeRuntime(kit);
    const speed = kit.app.SPEEDS[idx];
    assert.ok(setSpeed(rt, speed), `speed ${speed} is reachable by the keys`);
    for (let k = 0; k < 50; k++) rt.advance(0.05);
    const { t, tc } = rt.state();
    assert.ok(t > 0 && Math.abs(colourClockAt(t, speed) - tc) < 1e-9, `${speed}x: runtime tc ${tc}, helper ${colourClockAt(t, speed)}`);
  }
});

// ---- T4.1f: without the clock

for (const size of [[61, 21], [120, 40]]) {
  test(`T4.1f ${size.join('x')}: the Rosette driven WITHOUT the colour clock at real 4x FAILS rule C; with the clock it passes (truecolor and 256 colours)`, () => {
    for (const mode of ['truecolor', '256']) {
      const without = runScene(rosette, size, { speed: 4, mode, clock: false });
      const withClock = runScene(rosette, size, { speed: 4, mode, clock: true });
      TABLE.push(line(`T4.1f ${size.join('x')} 4x ${mode} NO clock`, without));
      TABLE.push(line(`T4.1f ${size.join('x')} 4x ${mode} clock`, withClock));
      assert.ok(!without.c.pass && without.c.worstFraction > FIELD_FRACTION, `no clock: C ${pct(without.c.worstFraction)} must be over the limit`);
      assert.ok(without.c.worstFraction > 0.4, `and by a clear margin (was 44.3% on Desmond's a/b reading): ${pct(without.c.worstFraction)}`);
      assert.deepEqual(failedRules(without, { not: ['c'] }), [], 'brightness and red do not see it');
      assert.equal(withClock.c.pass, true, `with the clock: C ${pct(withClock.c.worstFraction)}`);
      assert.deepEqual(failedRules(withClock, { only: X1_RULE_IDS }), []);
    }
  });
}

// ---- T4.3: the Rosette at real 1x, 2x, 4x

const SMALL = [[61, 21], [80, 24], [120, 40]];
for (const mode of ['truecolor', '256']) {
  for (const size of SMALL) {
    test(`T4.3 Rosette ${mode} ${size.join('x')}: real 1x, 2x and 4x with the colour clock, every rule at the viewer's speed passes (rule C printed)`, () => {
      for (const speed of [1, 2, 4]) {
        const rep = runScene(rosette, size, { speed, mode });
        TABLE.push(line(`T4.3 ${size.join('x')} ${speed}x ${mode} seed 1`, rep));
        assert.deepEqual(failedRules(rep, { only: X1_RULE_IDS }), [], `${size.join('x')} ${speed}x ${mode}: ${line('', rep)}`);
      }
    });
  }
  for (const size of [[61, 21], [120, 40]]) {
    test(`T4.3 Rosette ${mode} ${size.join('x')}: real 4x on seeds 1, 2, 3 and 7 all under 25% on rule C`, () => {
      for (const seed of [1, 2, 3, 7]) {
        const rep = runScene(rosette, size, { speed: 4, mode, seed });
        TABLE.push(line(`T4.3 ${size.join('x')} 4x ${mode} seed ${seed}`, rep));
        assert.ok(rep.c.worstFraction <= FIELD_FRACTION, `seed ${seed}: C ${pct(rep.c.worstFraction)}`);
        assert.deepEqual(failedRules(rep, { only: X1_RULE_IDS }), [], `seed ${seed}`);
      }
    });
  }
  test(`T4.3 Rosette ${mode} 280x70: real 1x (12 s) and 4x (40 s), each from 12 s into the run so that the melt at 15 s is in the window, pass`, () => {
    for (const [speed, seconds] of [[1, 12], [4, 40]]) {
      const rep = runScene(rosette, [280, 70], { speed, mode, seconds, start: 12 });
      TABLE.push(line(`T4.3 280x70 ${speed}x ${mode} seed 1`, rep));
      assert.deepEqual(failedRules(rep, { only: X1_RULE_IDS }), [], `280x70 ${speed}x ${mode}: ${line('', rep)}`);
    }
  });
}

test('T4.3 measured table', () => {
  console.log('\nTABLE Rosette against rule C (worst fraction of a field, %)\n  ' + TABLE.join('\n  '));
});
