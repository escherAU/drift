// DRIFT-8 C4: Bloomfall and Cortex against rule C (the colour-flicker rule of the flash meter, a HOUSE RULE beyond WCAG: tests/helpers-flash.js, "Rule C") at the real speeds
// of the speed key, in both colour modes, with the colour clock driven as the runtime drives it (frameAtSpeed). The Rosette has its own file (flash-colour-rosette.test.js);
// the dissolves, the panels, the 9000's console, the console-hook fixture, the foil and the eject judge rule C in their own files through the shared rule list
// (failedRules in helpers-flash.js), and tests/flash-colour-docs.test.js proves that no flash test leaves a rule out.
//
// C3 left Bloomfall's 60-degree hue gradient across a bloom disc (60 * ratio in bloomfall.js) on scene time (its median hue rate is 155/190/260 degrees a second at
// 1x/2x/4x). The question was whether that fails rule C at real 4x: it does not (see the table: at most a few percent), so it is left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { failedRules, X1_RULE_IDS, FIELD_FRACTION } from './helpers-flash.js';
import { runScene } from './helpers-flash-scenes.js';
import { field } from '../cartridges/driftman-9000/lib/huefield.js';
import { createFlashMeter } from './helpers-flash.js';
import { newFrame, colourClockAt } from './helpers-flash-controls.js';
import bloomfall from '../cartridges/driftman-9000/scenes/bloomfall.js';
import cortex from '../cartridges/driftman-9000/scenes/cortex.js';

const pct = (x) => (x * 100).toFixed(1);
const TABLE = [];
const line = (tag, rep) => `${tag.padEnd(34)} C ${pct(rep.c.worstFraction).padStart(5)} (cell ${pct(rep.cell.c.worstFraction).padStart(5)} pixel ${pct(rep.pixel.c.worstFraction).padStart(5)})  L1 ${pct(rep.l1.x1.worstFraction)} L2 ${pct(rep.l2.x1.worstFraction)} L3 ${pct(rep.l3.worstFraction)} R ${pct(rep.r.x1.worstFraction)}`;

const VISIONS = [['bloomfall', bloomfall, 40], ['cortex', cortex, 130]];
for (const [name, scene, seconds] of VISIONS) {
  for (const mode of ['truecolor', '256']) {
    test(`T4.5 ${name} ${mode}: real 1x, 2x and 4x at 61x21, 80x24 and 120x40 with the colour clock: every rule at the viewer's speed passes, rule C included`, () => {
      for (const size of [[61, 21], [80, 24], [120, 40]]) {
        for (const speed of [1, 2, 4]) {
          const rep = runScene(scene, size, { speed, mode, seconds });
          TABLE.push(line(`T4.5 ${name} ${size.join('x')} ${speed}x ${mode}`, rep));
          assert.deepEqual(failedRules(rep, { only: X1_RULE_IDS }), [], `${name} ${size.join('x')} ${speed}x ${mode}: ${line('', rep)}`);
        }
      }
    });
    test(`T4.5 ${name} ${mode}: real 4x on seeds 2, 3 and 7, and at 280x70 (4x, ${seconds} s)`, () => {
      for (const seed of [2, 3, 7]) {
        const rep = runScene(scene, [120, 40], { speed: 4, mode, seconds, seed });
        TABLE.push(line(`T4.5 ${name} 120x40 4x ${mode} seed ${seed}`, rep));
        assert.deepEqual(failedRules(rep, { only: X1_RULE_IDS }), [], `${name} seed ${seed}`);
      }
      for (const [speed, secs] of [[4, seconds]]) {
        const rep = runScene(scene, [280, 70], { speed, mode, seconds: secs, start: 5 });
        TABLE.push(line(`T4.5 ${name} 280x70 ${speed}x ${mode}`, rep));
        assert.deepEqual(failedRules(rep, { only: X1_RULE_IDS }), [], `${name} 280x70 ${speed}x ${mode}: ${line('', rep)}`);
      }
    });
  }
}

test('T4.5 Bloomfall at real 4x without the colour clock: with and without the clock, both printed (its hue is a gentle field, so the clock changes little: the table is the record, only the shipped way is judged)', () => {
  for (const mode of ['truecolor', '256']) {
    const without = runScene(bloomfall, [120, 40], { speed: 4, mode, seconds: 40, clock: false });
    const withClock = runScene(bloomfall, [120, 40], { speed: 4, mode, seconds: 40, clock: true });
    TABLE.push(line(`T4.5 bloomfall 120x40 4x ${mode} NO clock`, without)); TABLE.push(line(`T4.5 bloomfall 120x40 4x ${mode} clock`, withClock));
    assert.ok(without.c.worstFraction < 0.25, `even without the clock Bloomfall is under the limit: ${pct(without.c.worstFraction)}`);
    assert.ok(withClock.c.pass);
  }
});

// ---- the huefield alone at real speeds: the field is read at colour time, so the frames are the 1x frames; read off the fast scene clock it is not

function fieldRun(cols, rows, mode, { speed = 1, clock = true, seconds = 12, seed = 1, L = 0.66 } = {}) {
  const meter = createFlashMeter(cols, rows, 18);
  const f = newFrame(cols, rows);
  f.glyphs.fill(0x2580);
  const N = Math.round((seconds * 18) / speed);
  for (let k = 0; k < N; k++) {
    const t = (k * speed) / 18, tc = clock ? colourClockAt(t, speed) : t;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      f.fg[i] = field(x + 0.5, y + 0.25, tc, L, seed);
      f.bg[i] = field(x + 0.5, y + 0.75, tc, L, seed);
    }
    meter.push(f);
  }
  return meter.report();
}
test('T4.5 huefield alone: read at colour time it is the 1x field at every speed key step and passes rule C; the same field read off a scene clock running at 4x is measured', () => {
  for (const [cols, rows] of [[61, 21], [120, 40]]) {
    const one = fieldRun(cols, rows, 'truecolor', { speed: 1 });
    const four = fieldRun(cols, rows, 'truecolor', { speed: 4 });
    const fast = fieldRun(cols, rows, 'truecolor', { speed: 4, clock: false });
    TABLE.push(line(`T4.5 huefield ${cols}x${rows} 1x`, one)); TABLE.push(line(`T4.5 huefield ${cols}x${rows} 4x clock`, four)); TABLE.push(line(`T4.5 huefield ${cols}x${rows} 4x NO clock`, fast));
    assert.deepEqual(failedRules(one, { only: X1_RULE_IDS }), []);
    assert.deepEqual(failedRules(four, { only: X1_RULE_IDS }), []);
    assert.equal(four.c.worstFraction, one.c.worstFraction, 'the same frames: the clock cancels the key');
    assert.ok(fast.c.worstFraction >= one.c.worstFraction, 'and a faster clock never lowers it');
  }
});

test('T4.5 measured table', () => {
  console.log('\nTABLE Bloomfall, Cortex and the huefield against rule C (worst fraction of a field, %)\n  ' + TABLE.join('\n  '));
});
