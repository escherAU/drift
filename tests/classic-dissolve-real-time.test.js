// DRIFT-12: Classic high contrast runs on the REAL-TIME clock at every speed from 1x up, and its dissolves last 2 real seconds. Before, the dissolve between two scenes was 2 s of SCENE time
// (DISSOLVE_SECONDS, src/app.js): half a real second at 4x, which put a cell's last change in the outgoing scene, its flip and its first change in the incoming one inside one second (rule L2: with
// the tunnel fixed the whole cycle read L2 39.09 % at 4x on 79x25 and 30.36 % at 2x on 40x10, tests/tunnel-flash-controls.test.js). And the maze, the one sim of the mode that does not ask for
// realClock, ran at the scene clock (read L3 31.71 % at 4x on the q156 clock at 41x11). Now the scheduler's cross-fade is scaled by min(speed, 1) / speed in contrast mode only (the Driftman 9000's
// runtime does the same, src/shell/runtime.js) and the contrast composer steps the maze, the one sim of the mode that does not ask for realClock, from the real-time clock (realTimeIds, src/cells.js, set in src/app.js).
// What this file pins (the real app on the exact clock, frames counted by the scene id the app reports):
//   contrast    the first dissolve lasts 2 s (36 frames at 18 fps, one frame either way; 2 x fps at 8 and 30) at 1x, 2x and 4x (real `+` presses); at 0.5x (real `-` presses) it lasts 4 s as before
//   unchanged   calm (15 s cross-fade, 3.75 s at 4x), chaos and experimental (2 s, 0.5 s at 4x) dissolve as before: the change is Classic high contrast's alone
//   turn        the speed keys still shorten a scene's turn: a scene length of 30 scene seconds ends at about 30, 15 and 7.5 real seconds at 1x, 2x and 4x
//   composer    counted steps, no app: a scene named in realTimeIds (or with realClock) steps at the real-time count, in and out of a dissolve; any other at the scene clock's
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLife, PLAN, SPEED_OF } from './helpers-life-app.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';

// the length in frames of the first run of 'fading' frames
async function firstFade({ startMode = 'contrast', speed = '1x', sceneLen = 30, fps = 18, seconds = 60, scene = 'life', startScene = 0 }) {
  const r = await runLife({ cols: 80, rows: 24, mode: '256', seed: 1, clock: 'grid', fps, seconds, sceneSeconds: sceneLen * SPEED_OF[speed], keys: PLAN[speed], feedAll: true, stopAtDissolve: false, startMode, scene, startScene });
  const a = r.ids.indexOf('fading');
  assert.ok(a > 0, 'a dissolve began');
  let b = a;
  while (b < r.ids.length && r.ids[b] === 'fading') b++;
  assert.ok(b < r.ids.length, 'and ended inside the run');
  return { frames: b - a, at: a / fps, ids: r.ids, rep: r.rep };
}

test('DRIFT-12 contrast: the first dissolve lasts 2 real seconds (36 frames at 18 fps, one either way) at 1x, 2x and 4x, and the same at --fps 8 and 30', async () => {
  for (const speed of ['1x', '2x', '4x']) {
    const f = await firstFade({ speed });
    assert.ok(f.frames >= 35 && f.frames <= 37, `${speed}: ${f.frames} frames of dissolve (began at ${f.at.toFixed(1)} s)`);
    assert.deepEqual(failedRules(f.rep, { only: X1_RULE_IDS }), [], `${speed}: the first minute of the cycle (Life, the dissolve, the tunnel) passes the five rules`);
  }
  for (const fps of [8, 30]) for (const speed of ['1x', '4x']) {
    const f = await firstFade({ speed, fps });
    assert.ok(Math.abs(f.frames - 2 * fps) <= 2, `${speed} fps ${fps}: ${f.frames} frames of dissolve`);
  }
});

test('DRIFT-12 contrast at 0.5x: the dissolve still lasts 2 scene seconds, 4 real ones (the real-time clock does not run faster than the scene clock below 1x)', async () => {
  const f = await firstFade({ speed: '0.5x', sceneLen: 30, seconds: 40 });
  assert.ok(f.frames >= 71 && f.frames <= 73, `${f.frames} frames of dissolve`);
});

test('DRIFT-12 calm and chaos dissolve as before at 4x: calm 15 scene seconds (3.75 s real, 67 or 68 frames), chaos 2 scene seconds (0.5 s real, 9 frames)', async () => {
  const calm = await firstFade({ startMode: 'calm', speed: '4x', seconds: 60 });
  assert.ok(calm.frames >= 66 && calm.frames <= 69, `calm: ${calm.frames} frames`);
  const chaos = await firstFade({ startMode: 'chaos', speed: '4x', seconds: 60 });
  assert.ok(chaos.frames >= 8 && chaos.frames <= 10, `chaos: ${chaos.frames} frames`);
});

test('DRIFT-12 experimental dissolves as before, at 1x and 4x (real + presses): 2 scene seconds, 36 frames at 1x and 9 at 4x (0.5 s real), while contrast at 4x lasts 36 (the control: only contrast changed)', async () => {
  const exp1 = await firstFade({ startMode: 'experimental', speed: '1x', seconds: 60 });
  assert.ok(exp1.frames >= 35 && exp1.frames <= 37, `experimental 1x: ${exp1.frames} frames`);
  const exp4 = await firstFade({ startMode: 'experimental', speed: '4x', seconds: 60 });
  assert.ok(exp4.frames >= 8 && exp4.frames <= 10, `experimental 4x: ${exp4.frames} frames (not scaled to real time: that is contrast's alone)`);
  const con4 = await firstFade({ startMode: 'contrast', speed: '4x', seconds: 60 });
  assert.ok(con4.frames >= 35 && con4.frames <= 37 && con4.frames > exp4.frames * 3, `control: contrast 4x ${con4.frames} frames against experimental ${exp4.frames}`);
});

test('DRIFT-12 contrast: the speed keys still shorten the scene\'s turn: with a scene length of 30 scene seconds the first dissolve starts at about 30, 15 and 7.5 real seconds at 1x, 2x and 4x (the keys are pressed in the second second)', async () => {
  const at = {};
  for (const speed of ['1x', '2x', '4x']) {
    const r = await runLife({ cols: 80, rows: 24, mode: '256', seed: 1, clock: 'grid', seconds: 40, sceneSeconds: 30, keys: PLAN[speed], feedAll: true, stopAtDissolve: false, scene: 'life', startScene: 0 });
    at[speed] = r.ids.indexOf('fading') / 18;
  }
  assert.ok(at['1x'] > 29 && at['1x'] < 31.1, JSON.stringify(at));
  assert.ok(at['2x'] > 15 && at['2x'] < 22, JSON.stringify(at));
  assert.ok(at['4x'] > 7.4 && at['4x'] < 17, JSON.stringify(at));
  assert.ok(at['1x'] > at['2x'] && at['2x'] > at['4x'], JSON.stringify(at));
});

// the composer by itself: counted steps, no app, no clock
import { createCellComposer } from '../src/cells.js';
function stepCounts(ids, p) {
  const counts = { a: 0, b: 0, rt: 0 };
  const mk = (name, realClock) => ({
    id: name, kind: 'sim', ...(realClock ? { realClock: true } : {}), init: () => ({}), step: () => { counts[name]++; },
    draw: (s, params) => { params.glyphs.fill(32); params.colours.fill(0); },
  });
  const comp = createCellComposer({ scenes: [mk('a'), mk('b'), mk('rt', true)], cols: 4, rows: 2, realTimeIds: ids });
  const st = { a: 0, b: 1, p, fading: p > 0 };
  for (let k = 0; k <= 18 * 4; k++) { const t = k / 18; comp.frame(st, t, t / 4); } // 4 scene seconds at 4x: 1 real second
  return counts;
}
test('DRIFT-12 composer: a scene named in realTimeIds is stepped at the real-time count (30 in a real second at 4x, in a dissolve or out of one), a scene that is not at the scene clock\'s (120 in 4 scene seconds); a realClock scene is at the real-time count either way', () => {
  const near = (v, want) => assert.ok(Math.abs(v - want) <= 2, `${v} steps, want about ${want}`);
  const on = stepCounts(['a', 'b'], 0.5), onIdle = stepCounts(['a', 'b'], 0), off = stepCounts([], 0.5), offIdle = stepCounts([], 0), onlyA = stepCounts(['a'], 0.5);
  near(on.a, 30); near(on.b, 30); near(onIdle.a, 30);
  near(off.a, 120); near(off.b, 120); near(offIdle.a, 120);
  near(onlyA.a, 30); near(onlyA.b, 120); // only the scene that is named
  for (const c of [on, onIdle, off, offIdle, onlyA]) assert.ok(c.rt === 0, 'the third scene is never drawn or stepped here');
  const rtOnly = (ids) => { let n = 0; const s = { id: 'r', kind: 'sim', realClock: true, init: () => ({}), step: () => { n++; }, draw: (_, p) => { p.glyphs.fill(32); p.colours.fill(0); } }; const comp = createCellComposer({ scenes: [s], cols: 4, rows: 2, realTimeIds: ids }); for (let k = 0; k <= 72; k++) { const tt = k / 18; comp.frame({ a: 0, b: 0, p: 0, fading: false }, tt, tt / 4); } return n; };
  near(rtOnly([]), 30); near(rtOnly(['r']), 30);
});
