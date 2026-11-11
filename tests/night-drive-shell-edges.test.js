// DRIFT-5: Night Drive through the real shell, the key edge cases (part one; part two is night-drive-shell-edges-b.test.js).
// Library -> Enter -> insert -> boot -> running with the deck open, then keys as the console binds them (src/keymap.js SHELL_KEYMAP: Enter, up/down,
// Esc, e eject, l library, space next scene, p pause, + - speed, h help, q quit). The clock is the fake one (app.tick); nothing sleeps.
// c.sh() exposes screen, cartridge, program, sceneId, menu and help only: pause and speed are NOT observable there, so pause is observed by
// c.writes() staying constant and by the screenshot not changing. Every item pins both arms.
//   E1  space moves to the next track from each of the 8 tracks (B4 wraps to A1) at 120x40, 80x24 and 41x11
//         |  space neither opens the deck nor ejects, and without the space the scene stays the picked one
//   E2  pause, speed keys and space on a cells track (caller) and a sim track (redlight): nothing is drawn while paused and the space is queued,
//       then resuming plays it; faster/slower change when the hold ends  |  without the pause space switches at once; without + it does not end early
//   E2b the shipped asymmetry: while paused a deck pick switches and draws but space does not (a question for the owner, see the test)
//   E5  a deck pick during a dissolve: the outgoing track is a no-op, the incoming one restarts at once, Esc changes nothing (120x40)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boot, recorder, pick, grab, same, diff, until, DT, MENU, ORDER, holdOf, nextScene, EJECT,
  ENTER, ESC, SPACE, DOWN, FLASH, pct, selectedIndex, starredIndexes, titleOf,
} from './helpers-night-drive-shell.js';

const idxOfScene = (id) => MENU.findIndex((e) => e.scene === id);
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]; // src/shell/runtime.js; the console starts at 1x (index 3)

// ---- E1

for (const [cols, rows] of [[120, 40], [80, 24], [41, 11]]) {
  test(`shell edges (E1) ${cols}x${rows}: space moves to the next track from each of the 8 tracks (B4 wraps to A1); it neither opens the deck nor ejects; without the space the scene stays the picked one`, async () => {
    const c = await boot(cols, rows);
    const got = [];
    for (let i = 0; i < ORDER.length; i++) {
      await pick(c, idxOfScene(ORDER[i]));
      c.tick(3);
      assert.equal(c.sh().sceneId, ORDER[i], `${cols}x${rows}: ${ORDER[i]} is the picked track after 3 s (no space yet)`);
      assert.equal(c.sh().menu, false, 'the deck closed on the pick');
      c.key(SPACE);
      c.tick(3);
      const want = ORDER[(i + 1) % ORDER.length];
      got.push(`${ORDER[i]}->${c.sh().sceneId}`);
      assert.equal(c.sh().sceneId, want, `${cols}x${rows}: space from ${ORDER[i]} gives ${want}`);
      assert.equal(c.sh().screen, 'running', 'space does not eject');
      assert.equal(c.sh().menu, false, 'space does not open the deck');
      c.tick(3); // exactly one track: a second, queued skip would move on again by 4 s
      assert.equal(c.sh().sceneId, want, `${cols}x${rows}: still ${want} 6 s after the space (one space is one track)`);
    }
    assert.equal(got[ORDER.length - 1], `overdrive->${ORDER[0]}`, 'the last track wraps to the first');
    c.done();
  });
}

// ---- E2

// Returns the rows of the track: its manifest index and kind.
const TRACKS = [['caller', 'cells'], ['redlight', 'sim']];
for (const [id, kind] of TRACKS) {
  test(`shell edges (E2) ${id} (${kind} track): p, then + + - and space: no screen writes and an identical picture for 3 s, the scene unchanged (the space is queued, not lost); p again plays the next track within 3 s with every frame at 30% or less; the control without the pause switches within 3 s`, async () => {
    const c = await boot(120, 40);
    const r = recorder(c);
    const i = idxOfScene(id);
    await pick(c, i);
    c.tick(3);
    assert.equal(c.sh().sceneId, id);
    // paused
    await r.press('p');
    await r.run(0.5);
    const w0 = c.writes();
    await r.run(2);
    assert.equal(c.writes(), w0, 'p: nothing is written for 2 s');
    assert.equal(c.sh().sceneId, id);
    for (const k of ['+', '+', '-', SPACE]) c.key(k);
    c.tick(DT); // the frame that carries the keys (anything they force is drawn here)
    const shot = grab(c), w1 = c.writes();
    await r.run(3);
    assert.equal(c.writes(), w1, 'after + + - and space: still no writes 3 s later');
    assert.ok(same(grab(c), shot), 'the screenshot is identical 3 s later');
    assert.equal(c.sh().sceneId, id, 'the space is queued, not played: the scene is unchanged');
    assert.equal(c.sh().screen, 'running');
    // resume: the queued space plays
    r.reset();
    await r.press('p');
    await r.run(3);
    assert.equal(c.sh().sceneId, nextScene(id), `p again: the queued space gives ${nextScene(id)} within 3 s`);
    console.log(`TABLE shell E2 ${id}: resume frames worst ${pct(r.nonKey)} (key frame ${pct(r.key)})`);
    await r.run(3);
    assert.equal(c.sh().sceneId, nextScene(id), 'and still that track 3 s later: the one space played once');
    assert.ok(r.nonKey <= FLASH, `every frame from the p press on changes ${pct(r.nonKey)}, over 30%`);
    c.done();
  });

  test(`shell edges (E2 control) ${id}: without the pause, space switches to the next track within 3 s`, async () => {
    const c = await boot(120, 40);
    await pick(c, idxOfScene(id));
    c.tick(3);
    assert.equal(c.sh().sceneId, id);
    c.key(SPACE);
    c.tick(3);
    assert.equal(c.sh().sceneId, nextScene(id));
    c.tick(3);
    assert.equal(c.sh().sceneId, nextScene(id), 'one space is one track');
    c.done();
  });

  test(`shell edges (E2 speed) ${id}: p, + four times (1x to 4x), p: the hold ends in a quarter of the time; the control without the + keys is still on the track at the same moment; with - three times (0.25x) it is still on it at 100 s`, async () => {
    assert.equal(SPEEDS[3], 1);
    assert.equal(SPEEDS[SPEEDS.length - 1], 4);
    const hold = holdOf(id);
    const atWall = hold / 4 + 1.5; // 22.5 s of the 90 s hold at 4x, plus the dissolve and a margin: 24 s
    const run = async (keys, seconds) => {
      const c = await boot(120, 40);
      await pick(c, idxOfScene(id));
      c.key('p'); c.tick(0.3);
      for (const k of keys) c.key(k);
      c.tick(0.3);
      c.key('p');
      c.tick(seconds - 0.6);
      const s = c.sh().sceneId;
      c.done();
      return s;
    };
    assert.equal(await run(['+', '+', '+', '+'], atWall), nextScene(id), `at 4x the ${hold} s hold is over at ${atWall} s`);
    assert.equal(await run([], atWall), id, 'control: at 1x it is still the same track at the same moment');
    assert.equal(await run(['-', '-', '-'], 100), id, 'at 0.25x it is still the same track at 100 s');
  });
}

// ---- E2b

test('shell edges (E2b) the asymmetry: while paused a deck pick DOES switch the track and draws, but space does not', async () => {
  // This is the SHIPPED behaviour, pinned as it is. It is a question for the owner whether it is wanted: a pick restarts the program at once
  // (switchProgram), a space only queues a skip on the scheduler (sched.skip), which waits for the clock to run again.
  const c = await boot(120, 40);
  await pick(c, idxOfScene('sundown'));
  c.tick(3);
  c.key('p'); c.tick(1);
  const paused = grab(c);
  const w0 = c.writes();
  // arm 1: space while paused: nothing
  c.key(SPACE); c.tick(DT); const afterSpace = grab(c), w1 = c.writes();
  c.tick(3);
  assert.equal(c.sh().sceneId, 'sundown', 'space while paused does not switch');
  assert.equal(c.writes(), w1, 'and writes nothing more');
  assert.ok(same(grab(c), afterSpace), 'and the picture does not change');
  // arm 2: a deck pick while paused: switches and draws
  await pick(c, idxOfScene('diner'));
  const w2 = c.writes();
  c.tick(3);
  assert.equal(c.sh().sceneId, 'diner', 'a deck pick while paused switches the track');
  assert.equal(c.sh().menu, false);
  assert.ok(c.writes() > w1, `and writes (${w2 - w0} writes since the pause)`);
  assert.ok(diff(grab(c), paused) > 0.05, `the picture changes within 3 s (${pct(diff(grab(c), paused))} of cells)`);
  c.done();
});

// ---- E5

async function duringDissolve() {
  const c = await boot(120, 40);
  c.key(ENTER); c.tick(3); // A1 plays (Enter on the highlighted first track closes the deck)
  assert.equal(c.sh().sceneId, 'onramp');
  c.key(SPACE); c.tick(1.0); // the dissolve A1 -> A2, 1 s in
  assert.equal(c.sh().sceneId, 'onramp', 'during the dissolve the scene is still the outgoing one');
  c.key(ENTER); c.tick(0.4);
  assert.equal(c.sh().menu, true, 'the deck opens during the dissolve');
  assert.deepEqual(starredIndexes(c), [0], 'the star is on the outgoing track, A1');
  assert.equal(selectedIndex(c), 0, 'the cursor is on A1');
  return c;
}

test('shell edges (E5 i) a deck pick of the starred OUTGOING track during a dissolve restarts nothing: still onramp 0.1 s later, skyline 1.3 s later (the dissolve completed)', async () => {
  const c = await duringDissolve();
  c.key(ENTER);
  c.tick(0.1);
  assert.equal(c.sh().sceneId, 'onramp', '0.1 s after the pick: still onramp');
  c.tick(1.2);
  assert.equal(c.sh().sceneId, 'skyline', '1.3 s after the pick: the dissolve finished and skyline plays');
  c.done();
});

test('shell edges (E5 ii) a deck pick of the INCOMING track during a dissolve restarts it at once: skyline 0.1 s later and still skyline at 46 s', async () => {
  const c = await duringDissolve();
  c.key(DOWN); c.tick(DT * 2);
  assert.equal(selectedIndex(c), 1, 'the cursor is on A2');
  c.key(ENTER);
  c.tick(0.1);
  assert.equal(c.sh().sceneId, 'skyline', 'skyline at once (the pick restarted it; the outgoing onramp would still show without it)');
  c.tick(1.2);
  assert.equal(c.sh().sceneId, 'skyline');
  c.tick(5);
  c.tick(40);
  assert.equal(c.sh().sceneId, 'skyline', 'still skyline at 46 s');
  c.done();
});

test('shell edges (E5 iii) Esc instead of a pick during a dissolve changes nothing: the same as (i)', async () => {
  const c = await duringDissolve();
  c.key(ESC);
  c.tick(0.1);
  assert.equal(c.sh().menu, false, 'Esc closes the deck');
  assert.equal(c.sh().sceneId, 'onramp', '0.1 s later: still onramp');
  c.tick(1.2);
  assert.equal(c.sh().sceneId, 'skyline', '1.3 s later: skyline');
  c.done();
});
