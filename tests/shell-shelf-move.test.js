// DRIFT-7 item 2: the shelf takes one step per SHELF_MOVE_SECONDS (1.2 s), though the slide itself is 0.36 s.
// A press during the wait queues one step (the rest are dropped); it starts on the tick that crosses 1.2 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHELF_MOVE_SECONDS, SLIDE_SECONDS } from '../src/shell/shell.js';
import { createFlashMeter } from './helpers-flash.js';
import { foilRoot, foilShell, DT, FPS } from './helpers-foil.js';

const ORDER = ['aaa', 'foil-a', 'foil-b', 'zzz'];
const SIZES = [[120, 40], [80, 24], [240, 67], [88, 39], [176, 58], [78, 24]];

test('shelf move: the constants', () => {
  assert.equal(SHELF_MOVE_SECONDS, 1.2);
  assert.equal(SLIDE_SECONDS, 0.36);
});

test('shelf move: presses at 0, 0.1 and 0.5 s start slides at 0 and 1.2 s only', () => {
  const { sh } = foilShell(120, 40, { select: 'aaa' }); const at = () => ORDER.indexOf(sh.state().cartridge);
  const presses = [[0, 'libNext'], [0.1, 'libNext'], [0.5, 'libNext']];
  const changes = [];
  let idx = at(), clock = 0, next = 0;
  for (let k = 0; k < 4 * FPS; k++) {
    while (next < presses.length && clock >= presses[next][0] - 1e-9) { sh.actions[presses[next][1]](); next++; }
    if (at() !== idx) { changes.push([clock, at() - idx]); idx = at(); }
    sh.tick(DT); clock += DT;
  }
  if (at() !== idx) changes.push([clock, 1]);
  assert.equal(changes.length, 2, JSON.stringify(changes));
  assert.ok(Math.abs(changes[0][0] - 0) < 1e-9);
  // the first frame at or after 1.2 s (the tick crosses it, the move starts on that tick)
  assert.ok(changes[1][0] >= SHELF_MOVE_SECONDS - 1e-9 && changes[1][0] < SHELF_MOVE_SECONDS + DT + 1e-9, 'second slide at ' + changes[1][0]);
  assert.equal(at(), 2, 'the third press was dropped');
});

test('shelf move: a press once 1.2 s has passed moves at once', () => {
  const { sh } = foilShell(120, 40, { select: 'aaa' }); const at = () => ORDER.indexOf(sh.state().cartridge);
  sh.actions.libNext();
  sh.tick(1.19); sh.actions.libNext(); sh.tick(0.005);
  assert.equal(at(), 1, 'still waiting at 1.195 s (the press is queued)');
  sh.tick(0.02);
  assert.equal(at(), 2, 'the queued press started when 1.2 s passed');
  sh.tick(1.3); sh.actions.libNext();
  assert.equal(at(), 3, 'a press after the wait moves at once');
});

for (const [cols, rows] of SIZES) {
  test(`shelf move ${cols}x${rows}: a press every 0.36 s for 3 s keeps the worst L2 flash fraction under 25% at 1x`, () => {
    for (const art of ['dense', 'delza']) {
      const { sh } = foilShell(cols, rows, { root: foilRoot({ art }), select: 'aaa' });
      const meter = createFlashMeter(cols, rows, FPS);
      let clock = 0, nextPress = 0, n = 0;
      for (let k = 0; k < 6 * FPS; k++) {
        if (clock < 3 && clock >= nextPress - 1e-9) { sh.actions[n++ % 2 ? 'libPrev' : 'libNext'](); nextPress += 0.36; }
        meter.push(sh.frame());
        sh.tick(DT); clock += DT;
      }
      const rep = meter.report();
      assert.ok(rep.l2.x1.worstFraction < 0.25, `${cols}x${rows} ${art}: ${(rep.l2.x1.worstFraction * 100).toFixed(2)}%`);
    }
  });
}
