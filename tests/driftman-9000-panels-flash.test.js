// DRIFT-7 stage F, item 2: the flash meter (createFlashMeter: L1, L2, L3, R at the meter's 1x and 4x views) over the menu and the help box opening and closing
// over EACH vision of the Driftman 9000, in a real shell with the installed cartridge (the runtime, the skin, the chrome border that comes with the menu).
// The flow, from about 20 s into the vision: rest 1 s, Enter (the menu ramps in), 1 s, Esc (it ramps out), 1 s, h (the help box ramps in), 1 s, h (it ramps out), 1 s.
// Runtime speed 1x and 4x (the scene clock; the panels' ramps are real seconds), the three usual sizes and the size just above each layout breakpoint.
// Every rule at its own limit, no per-size exceptions, except that the meter's 4x view of L2 is printed and not judged (see NOT_JUDGED). The control: the same flow with each ramp stepped over in one tick (the old hard cut) must be flagged.
import test from 'node:test';
import { RULE_IDS, ruleOf } from './helpers-flash.js';
import assert from 'node:assert/strict';
import { shownMeter, FLASH_MODE, MODE_NOTE } from './helpers-flash-modes.js';
import { arrive9000, stepFrames, stepSeconds, pickVision, VISIONS, FPS } from './helpers-driftman-panels.js';

const SIZES = [[120, 40], [80, 24], [240, 67], [88, 39], [176, 58], [78, 24]];
const RULES = RULE_IDS.map((id) => [id, (r) => ruleOf(r, id)]); // the shared list (helpers-flash.js): the brightness and red rules and C (DRIFT-8 C4)
const pc = (x) => (x * 100).toFixed(1);
const showOne = (rep) => `L1 ${pc(rep.l1.x1.worstFraction)}/${pc(rep.l1.x4.worstFraction)} L2 ${pc(rep.l2.x1.worstFraction)}/${pc(rep.l2.x4.worstFraction)} L3 ${pc(rep.l3.worstFraction)} R ${pc(rep.r.x1.worstFraction)}/${pc(rep.r.x4.worstFraction)} C ${pc(rep.c.worstFraction)}`;
// the cell grid (the old reading) and the pixel grid (DRIFT-8 C2)
const show = (rep) => `${showOne(rep.cell)} | pixel ${showOne(rep.pixel)}`;
// The shell's flows are held at 1x for L2 (the speed key reaches only the scene clock, so the meter's own 4x view of a menu or help ramp is a stress outside the
// shell's speeds; the foil walk and the shelf are held the same way): l2.x4 is measured and printed but not judged. Every other rule is judged at its own limit.
const NOT_JUDGED = new Set(['l2.x4']);
const failing = (rep) => RULES.filter(([n, get]) => !NOT_JUDGED.has(n) && !get(rep).pass).map(([n]) => n);
const TABLE = [];

async function run(cols, rows, id, speed, { hard = false, offset = 0 } = {}) {
  const sh = await arrive9000(cols, rows, { speed, cmode: FLASH_MODE });
  const rt = sh.runtime();
  if (id !== 'rosette') pickVision(sh, id); else sh.key('esc');
  stepSeconds(sh, 0.6);
  const from = rt.state().t;
  while (rt.state().t < from + 20) stepFrames(sh, 9);
  assert.equal(sh.state().sceneId, id);
  if (offset > 0) sh.tick(offset / FPS); // offset is a fraction of a frame (0, 1/4, 1/2, 3/4): the clock phase against the scene's own steps
  const meter = shownMeter(cols, rows, FPS);
  const push = (f) => meter.push(f);
  const rest = (s) => stepSeconds(sh, s, push);
  const press = (key) => {
    sh.key(key);
    push(sh.frame());
    if (hard) { sh.tick(0.3); push(sh.frame()); } else { sh.tick(1 / FPS); push(sh.frame()); }
  };
  rest(1);
  press('enter'); assert.equal(sh.state().menu, true); rest(1);
  press('esc'); assert.equal(sh.state().menu, false); rest(1);
  press('h'); assert.equal(sh.state().help, true); rest(1);
  press('h'); assert.equal(sh.state().help, false); rest(1);
  return meter.report();
}

for (const [cols, rows] of SIZES) {
  test(`panels flash${MODE_NOTE} ${cols}x${rows}: menu open/close and help open/close over Rosette, Cortex and Bloomfall at 1x and 4x pass L1, L2, L3 and R`, async () => {
    const bad = [];
    for (const id of VISIONS) {
      for (const speed of [1, 4]) {
        const rep = await run(cols, rows, id, speed);
        TABLE.push(`${cols}x${rows}`.padEnd(8) + `${speed}x ${id.padEnd(9)} ` + show(rep));
        for (const n of failing(rep)) bad.push(`${id} ${speed}x ${n}`);
      }
    }
    assert.deepEqual(bad, [], `${cols}x${rows}`);
  });
}

test(`panels flash control${MODE_NOTE}: each panel cut in at once (the ramp stepped in one tick) over the Rosette is flagged where the panel is a large part of the screen (80x24, 78x24)`, async () => {
  const lines = [], unflagged = [];
  for (const [cols, rows] of SIZES) {
    const rep = await run(cols, rows, 'rosette', 1, { hard: true });
    lines.push(`${cols}x${rows} hard cut ${show(rep)} failing: ${failing(rep).join(',') || 'none'}`);
    if ((cols <= 88 && rows <= 24) && failing(rep).length === 0) unflagged.push(`${cols}x${rows}`);
  }
  TABLE.push(...lines);
  assert.deepEqual(unflagged, [], 'the hard cut passed the meter at the compact sizes: the meter is not seeing the panels');
});


test(`panels flash${MODE_NOTE}: the clock phase (the first tick lands 0, 1/4, 1/2 and 3/4 of a frame into the step) at 120x40 and 80x24, runtime 4x, over every vision: all judged rules pass`, async () => {
  const bad = [];
  for (const [cols, rows] of [[120, 40], [80, 24]]) {
    for (const id of VISIONS) {
      for (const k of [1, 2, 3]) { // phase 0 is the plain run above
        const rep = await run(cols, rows, id, 4, { offset: k / 4 });
        TABLE.push(`${cols}x${rows}`.padEnd(8) + `phase ${k}/4 ${id.padEnd(9)} ` + show(rep));
        for (const n of failing(rep)) bad.push(`${cols}x${rows} ${id} phase ${k}/4 ${n}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test(`panels flash TABLE${MODE_NOTE}: every measured value`, () => {
  console.log([`TABLE panels flash meter${MODE_NOTE} (x1/x4 views; limits L1 25, L2 25, L3 30, R 25; cell grid | pixel grid)`, ...TABLE.map((l) => '  ' + l)].join('\n'));
  assert.ok(TABLE.length > 0);
});
