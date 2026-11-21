// DRIFT-9 part 3 (b), item 5: the menu jump from Cortex into Rosette on the q156 clock, judged by the five playback-speed rules (L1, L2, L3, R and the colour rule C: X1_RULE_IDS), each at
// its own limit. Run in truecolor here and in 256 colours by the wrapper tests/flash-256-menu-cortex-rosette-clock.test.js (it sets DRIFT_FLASH_MODE=256 and imports this file, so the two
// colour modes run side by side; the title carries "[256 colours]" in that run).
//
// MEASURED: the real app (createApp, the Driftman 9000, 80x24, seeds 1 to 16) on the q156 clock (tests/helpers-clock.js: every timer fires on the next 15.625 ms tick), the app's own loop at
// 18 frames a second (the shipped default; --fps was not varied here), the screen read back by the independent terminal reader and shown to the meter once per 1 / 18 s of clock time.
// Each run presses the keys of a user: Enter (the menu opens), 0.8 s later Enter again on the first entry (Rosette: no arrow needed). The window is the one the menu-jump arm of
// tests/flash-256-fps.test.js uses: 6 s before the pick to 4 s after it, one fresh meter per run (so it holds the Rosette-to-Cortex dissolve before the jump, the menu and the jump dissolve).
//   real 4x: the `+` key four times (tests/helpers-flash-app.js PLAN_4X) 1 s into the running program, then the menu opened at 18.5, 24 and 30 s of running time. Cortex is on screen then
//            (Rosette holds 15 s at 4x, its dissolve into Cortex ends at about 17.8 s).
//   1x:      no keys. At 1x Rosette holds 60 s, so Cortex is NOT on screen at 18.5 to 30 s: the 1x arm opens the menu at the same offsets into Cortex's own run instead (Cortex's dissolve
//            ends at about 61.3 s; opens at 62, 67.5 and 73.5 s). Every run asserts that Cortex is on screen just before the open and Rosette just after the pick, so a jump that did not happen
//            cannot pass as a quiet window.
// Per arm the worst reading of each rule is printed with its limit, the margin in points and where it was read (seed, open time, time into the window), after the arm passed.
// The control (a copy of the tree whose program-switch dissolve is taken out, so the jump is a hard cut) must fail L3 at 4x and at 1x, so the arms can tell.
//
// NOT MEASURED: any --fps other than 18 (tests/flash-256-fps.test.js has the menu jump at 30 fps), other sizes, picks into Cortex or Bloomfall (flash-256-fps.test.js has two seeds of those), a pick
// made while a dissolve is running, the jitter clock and the exact grid. The cap-out tree (the 18 fps cap on full-colour frames in 256 colours taken out) does NOT fail these windows at 30 fps (16 seeds,
// three opens, measured while writing this file), so there is no control of that kind for the menu jump; the hard-cut tree is the control.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAppWindow, PLAN_4X, PLAN_1X, APP_FPS } from './helpers-flash-app.js';
import { failedRules, X1_RULE_IDS, ruleOf } from './helpers-flash.js';
import { FLASH_MODE, MODE_NOTE } from './helpers-flash-modes.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FPS = APP_FPS;                                        // 18, the shipped default
const CLOCK = { mode: 'q156', seed: 1 };
const COLS = 80, ROWS = 24;
const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);  // seeds 1 to 16
const OPENS_4X = [18.5, 24, 30];                            // seconds of running time at which the menu is opened, real 4x (Cortex on screen)
const OPENS_1X = [62, 67.5, 73.5];                          // the same offsets (0.7, 6.2 and 12.2 s) into Cortex's own run at 1x
const PICK_AFTER = 0.8, BEFORE = 6, AFTER = 4;              // the menu-jump arm of tests/flash-256-fps.test.js
const pc = (x) => (100 * x).toFixed(2);
const keysFor = (speed, open) => [...(speed === 4 ? PLAN_4X : PLAN_1X), { atRunning: open, key: '\r' }, { atRunning: open + PICK_AFTER, key: '\r' }];

// one arm: every seed, every open time; the five rules; the jump itself asserted per run
async function arm({ speed, opens, root = null }) {
  const bad = [], missed = [], worst = Object.fromEntries(X1_RULE_IDS.map((id) => [id, { v: -1 }]));
  let windows = 0;
  for (const seed of SEEDS) for (const open of opens) {
    const pick = open + PICK_AFTER;
    const res = await runAppWindow({ cols: COLS, rows: ROWS, mode: FLASH_MODE, fps: FPS, clock: CLOCK.mode, clockSeed: CLOCK.seed, seed, keys: keysFor(speed, open), pickAt: pick, before: BEFORE, after: AFTER, root });
    windows++;
    const before = res.ids[Math.round(open * FPS) - 2], after = res.ids[Math.round(pick * FPS) + 2];
    if (before !== 'cortex' || after !== 'rosette') missed.push(`seed ${seed} open ${open}: ${before} then ${after}`);
    for (const id of X1_RULE_IDS) {
      const x = ruleOf(res.report, id);
      if (x.worstFraction > worst[id].v) worst[id] = { v: x.worstFraction, limit: x.limit, seed, open, timeS: x.details.timeS };
    }
    const f = failedRules(res.report, { only: X1_RULE_IDS });
    if (f.length) bad.push(`seed ${seed} open ${open}: ${f.join(',')} ${X1_RULE_IDS.map((id) => `${id} ${pc(ruleOf(res.report, id).worstFraction)}`).join(' ')}`);
  }
  const tag = `${COLS}x${ROWS} ${FLASH_MODE} ${speed}x, ${CLOCK.mode} clock, ${FPS} fps, seeds ${SEEDS[0]}-${SEEDS.at(-1)}, opens ${opens.join(' ')} s, ${windows} windows`;
  return { bad, missed, worst, windows, tag };
}
function judge(r) {
  assert.deepEqual(r.missed, [], `${r.tag}: the jump did not run as planned (Cortex before, Rosette after): ${r.missed.join(' | ')}`);
  assert.deepEqual(r.bad, [], `${r.tag}: ${r.bad.length} of ${r.windows} windows fail: ${r.bad.join(' | ')}`);
  for (const id of X1_RULE_IDS) { // printed only after both assertions held: a failing number is in a failure message above
    const w = r.worst[id];
    console.log(`MENU CORTEX>ROSETTE ${r.tag}: worst ${id} ${pc(w.v)} % of ${pc(w.limit)} % limit, margin ${pc(w.limit - w.v)} points (seed ${w.seed}, open ${w.open} s, ${w.timeS.toFixed(1)} s into the window)`);
  }
}

test(`menu Cortex into Rosette${MODE_NOTE}, real 4x, ${COLS}x${ROWS}, q156 clock, seeds 1-16, menu opened at ${OPENS_4X.join(' ')} s: every window passes the five rules`, async () => {
  judge(await arm({ speed: 4, opens: OPENS_4X }));
});

test(`menu Cortex into Rosette${MODE_NOTE}, 1x, ${COLS}x${ROWS}, q156 clock, seeds 1-16, menu opened ${OPENS_1X.join(' ')} s in (the same offsets into Cortex's run; Cortex is not on screen at 18.5 to 30 s at 1x): every window passes the five rules`, async () => {
  judge(await arm({ speed: 1, opens: OPENS_1X }));
});

// control: the program-switch dissolve taken out of a copy of the tree (the jump becomes a hard cut). The same helper, windows and judge must fail it, on L3, at 4x and at 1x.
function hardCutTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-menu-hardcut-'));
  fs.cpSync(path.join(REPO, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(REPO, 'cartridges'), path.join(dir, 'cartridges'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(dir, 'package.json'));
  const g = path.join(dir, 'src', 'shell', 'runtime.js');
  const raw = fs.readFileSync(g, 'utf8');
  const crlf = raw.includes('\r\n');
  const src = raw.replace(/\r\n/g, '\n');
  const find = 'if (last) xfade = { glyphs: last.glyphs.slice(), shades: last.shades.slice(), fg: last.fg.slice(), bg: last.bg.slice(), t: 0 };';
  assert.equal(src.split(find).length, 2, 'the program-switch dissolve is where this test expects it (src/shell/runtime.js)');
  const out = src.replace(find, 'if (last) xfade = null;');
  fs.writeFileSync(g, crlf ? out.replace(/\n/g, '\r\n') : out);
  return dir;
}
test(`control${MODE_NOTE}: a tree with the program-switch dissolve taken out (the jump is a hard cut) fails L3 in these windows, real 4x (open 24 s) and 1x (open 67.5 s), seeds 1 and 2`, async () => {
  const dir = hardCutTree();
  try {
    for (const [speed, open] of [[4, 24], [1, 67.5]]) for (const seed of [1, 2]) {
      const pick = open + PICK_AFTER;
      const res = await runAppWindow({ cols: COLS, rows: ROWS, mode: FLASH_MODE, fps: FPS, clock: CLOCK.mode, clockSeed: CLOCK.seed, seed, keys: keysFor(speed, open), pickAt: pick, before: BEFORE, after: AFTER, root: dir });
      const f = failedRules(res.report, { only: X1_RULE_IDS });
      assert.ok(f.includes('l3'), `${speed}x seed ${seed}: the hard-cut tree should fail L3, failing: ${f.join(',') || 'none'} (L3 ${pc(res.report.l3.worstFraction)} %)`);
      assert.ok(res.report.l3.worstFraction > res.report.l3.limit, `${speed}x seed ${seed}: L3 ${pc(res.report.l3.worstFraction)} % should be over ${pc(res.report.l3.limit)} %`);
      console.log(`MENU CONTROL ${FLASH_MODE} ${speed}x seed ${seed} open ${open} s, hard-cut tree: L3 ${pc(res.report.l3.worstFraction)} % is over the ${pc(res.report.l3.limit)} % limit; failing ${f.join(',')}`); // after the asserts held
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
