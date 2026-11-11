// DRIFT-5: Night Drive's tape deck through the real shell (library -> insert -> boot -> running), keys as the console really binds them
// (src/keymap.js SHELL_KEYMAP: Enter opens the menu or chooses, up/down move the cursor, space is the next scene, Esc closes, e ejects).
// The clock is the fake one (app.tick); nothing sleeps. Every test pins both arms of its pair. Labels, notes, descriptions, the title and the
// prompt are read from the manifest and the skin; the literals that remain (B2, B4, the key bytes) are the point of their tests.
//   M1  all nine entries and the selected description, nothing scrolling at 120x40, 80x24 and 79x25  |  the detector reports a scroll at 79x14
//   M2  B2 plays the diner now and the tape plays on to the caller about 92 s later                  |  at 60 s it is still the diner
//   M3  choosing the entry that is playing changes nothing                                          |  choosing another one does
//   M4  B4 plays overdrive and the tape wraps to the first track after it                           |  before that it is still overdrive
//   M5  space moves to the next track, B4 wraps to A1                                               |  space neither ejects nor opens the menu
//   M6  the Eject entry ejects to the library                                                       |  a track does not
//   M7  the * follows the playing track (pick, space, the tape playing on); one at a time; moving the cursor leaves it
//   M8  the menu title and the prompt show at 120x40 and 80x24                                      |  not with the menu closed
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { INSTALL_DIR } from '../src/cartridge/loader.js';
import { mkShell, DT } from './helpers-shell.js';
import { changedFraction } from './helpers-flash.js';

const dirs = [{ dir: INSTALL_DIR, trusted: true }];
const read = (f) => JSON.parse(fs.readFileSync(path.join(INSTALL_DIR, 'night-drive', f), 'utf8'));
const MANIFEST = read('manifest.json');
const SKIN = read('skin.json');
const TAPE = MANIFEST.programs.find((p) => p.id === MANIFEST.start);
const ORDER = TAPE.scenes;
const holdOf = (id) => (TAPE.seconds && TAPE.seconds[id]) ?? TAPE.sceneSeconds;
const FADE = 2; // DISSOLVE_SECONDS: the tape dissolves a scene into the next over 2 s
const MENU = MANIFEST.menu;
const labelOf = (i) => MENU[i].label;
const indexOfLabel = (prefix) => { const i = MENU.findIndex((e) => e.label.startsWith(prefix)); assert.ok(i >= 0, `no menu entry ${prefix}`); return i; };
const indexOfScene = (id) => { const i = MENU.findIndex((e) => e.scene === id); assert.ok(i >= 0, `no menu entry for ${id}`); return i; };
const nextScene = (id) => ORDER[(ORDER.indexOf(id) + 1) % ORDER.length];
const EJECT = MENU.findIndex((e) => e.action === 'eject');
const UP = '\x1b[A', DOWN = '\x1b[B', ENTER = '\r', ESC = '\x1b', SPACE = ' ';

// ---- harness

async function boot(cols = 120, rows = 40) {
  const c = mkShell({ dirs, cols, rows, startScreen: { screen: 'library' } });
  c.app.start();
  c.tick(2);
  assert.ok(c.goto('night-drive'), 'the cursor reaches night-drive');
  c.key(ENTER);
  for (let k = 0; k < 18 * 30 && !(c.sh().screen === 'running' && c.sh().menu); k++) { c.tick(DT); if (k % 9 === 0) await c.settle(5); }
  assert.equal(c.sh().screen, 'running');
  assert.equal(c.sh().menu, true, 'the tape deck opens on arrival');
  c.tick(1);
  return c;
}
// long waits in coarser steps (the scene clock is the same sum); the shell tests do not sleep
const wait = (c, seconds) => c.tick(seconds, 0.2);
const until = (c, pred, maxSeconds) => { for (let t = 0; t < maxSeconds && !pred(); t += 0.2) c.tick(0.2, 0.2); return pred(); };

// The tape-deck box on the screen: { lines: its body rows, text: its words joined and collapsed } or null when its title is not on screen.
function deck(c) {
  const lines = c.text().split('\n');
  const ti = lines.findIndex((l) => l.includes(SKIN.menu.title));
  if (ti < 0) return null;
  const col0 = lines[ti].indexOf(SKIN.menu.title) - 4; // the corner and the title's frame: '┏━┥ '
  const col1 = lines[ti].lastIndexOf('┓');
  const body = [];
  for (let y = ti + 1; y < lines.length && lines[y][col0] !== '┗'; y++) body.push(lines[y].slice(col0 + 1, col1));
  return { lines: body, text: body.map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ') };
}
const SCROLL_MARK = /[↑↓] \d+ more/;
// What the deck shows: which labels are on screen, whether the description of the selected entry is, and whether it scrolls or clips.
function view(c) {
  const d = deck(c);
  if (!d) return { open: false, labels: [], desc: false, scrolls: false, selected: -1, starred: [] };
  const labels = MENU.map((e, i) => (d.lines.some((l) => l.includes(e.label)) ? i : -1)).filter((i) => i >= 0);
  const selRow = d.lines.find((l) => l.includes('▶'));
  const selected = selRow ? MENU.findIndex((e) => selRow.includes(e.label)) : -1;
  const starred = MENU.map((e, i) => (d.lines.some((l) => l.includes(e.label + ' *')) ? i : -1)).filter((i) => i >= 0);
  const want = selected >= 0 && MENU[selected].desc ? MENU[selected].desc.replace(/\s+/g, ' ') : null;
  return { open: true, labels, desc: want ? d.text.includes(want) : false, scrolls: d.lines.some((l) => SCROLL_MARK.test(l)), selected, starred, text: d.text };
}
const opened = (c) => { if (!c.sh().menu) { c.key(ENTER); c.tick(0.4); } return view(c); };
// Opens the deck if it is closed, walks the cursor to entry `idx` (a key at a time) and presses Enter.
function pick(c, idx) {
  let v = opened(c);
  for (let k = 0; k < MENU.length + 1 && v.selected !== idx; k++) {
    const down = (idx - v.selected + MENU.length) % MENU.length <= MENU.length / 2;
    c.key(down ? DOWN : UP); c.tick(DT * 2);
    v = view(c);
  }
  assert.equal(v.selected, idx, `the cursor reaches ${labelOf(idx)}`);
  c.key(ENTER); c.tick(DT * 2);
}
const grab = (c) => { const f = c.app.screenshot(); return { g: f.glyphs.slice(), s: f.shades.slice() }; };

// ---- M1

test('night-drive menu (M1): all nine entries (8 tracks and Eject) are on screen with their labels, the selected entry\'s description shows and nothing scrolls, at 120x40, 80x24 and 79x25; the detector does report a scroll where the deck is cut (79x14)', async () => {
  assert.equal(MENU.length, 9);
  assert.equal(MENU.filter((e) => e.scene).length, 8, 'eight tracks');
  assert.equal(EJECT, 8, 'Eject is the ninth entry');
  for (const [cols, rows] of [[120, 40], [80, 24], [79, 25]]) {
    const c = await boot(cols, rows);
    const v = view(c);
    assert.ok(v.open, `${cols}x${rows}: the deck is on screen`);
    assert.deepEqual(v.labels, MENU.map((e, i) => i), `${cols}x${rows}: every entry's label is on screen`);
    assert.equal(v.selected, 0, 'the cursor starts on the first track');
    assert.ok(v.desc, `${cols}x${rows}: the description of ${labelOf(v.selected)} shows`);
    assert.equal(v.scrolls, false, `${cols}x${rows}: no "N more" marker`);
    // the description follows the cursor
    c.key(DOWN); c.tick(0.3);
    const v1 = view(c);
    assert.equal(v1.selected, 1);
    assert.ok(v1.desc && v1.text.includes(MENU[1].desc), `${cols}x${rows}: the description of ${labelOf(1)} shows`);
    assert.equal(v1.scrolls, false);
    c.done();
  }
  // the other arm: smaller, the deck scrolls (a window of rows with "N more" at the bottom) and the detector says so
  const small = await boot(79, 14);
  const sv = view(small);
  assert.ok(sv.open, '79x14: the deck is there');
  assert.equal(sv.scrolls, true, '79x14: the detector reports the scroll marker');
  assert.ok(sv.labels.length < MENU.length, `79x14 shows ${sv.labels.length} of ${MENU.length} entries`);
  small.done();
  // and a size just above it does not (the cut-off is between 79x14 and 79x16)
  const fits = await boot(79, 16);
  assert.equal(view(fits).scrolls, false);
  assert.equal(view(fits).labels.length, MENU.length);
  fits.done();
  // control: the marker the detector looks for is the shell's own wording
  assert.ok(SCROLL_MARK.test('↓ 3 more') && SCROLL_MARK.test('↑ 1 more') && !SCROLL_MARK.test('B4  OVERDRIVE'));
});

// ---- M2

test('night-drive menu (M2): picking B2 plays the diner now, and about 92 s later (90 s hold and the 2 s dissolve) the tape has played on to the caller; at 60 s it is still the diner', async () => {
  const i = indexOfLabel('B2');
  const diner = MENU[i].scene;
  assert.equal(diner, 'diner');
  const after = nextScene(diner);
  assert.equal(after, 'caller');
  const c = await boot();
  assert.equal(c.sh().sceneId, ORDER[0]);
  pick(c, i);
  assert.equal(c.sh().menu, false, 'the deck closes');
  assert.equal(c.sh().sceneId, diner, 'the diner plays now');
  assert.equal(c.sh().program, TAPE.id);
  wait(c, 60);
  assert.equal(c.sh().sceneId, diner, 'still the diner at 60 s');
  wait(c, holdOf(diner) - 60 - 1);
  assert.equal(c.sh().sceneId, diner, 'and at the end of the hold, before the dissolve is over');
  wait(c, 1 + FADE + 0.5);
  assert.equal(c.sh().sceneId, after, 'the tape plays on to the caller');
  c.done();
});

// ---- M3

test('night-drive menu (M3): picking the entry that is already playing does nothing (same timeline, same picture, no dissolve); picking another entry does change the scene', async () => {
  const i = indexOfLabel('B2');
  const diner = MENU[i].scene;
  // run X picks the playing entry again, run Y opens the deck and closes it with Esc: identical unless the pick did something
  const run = async (second) => {
    const c = await boot();
    pick(c, i);
    wait(c, 30);
    if (second === 'repick') pick(c, i); else { opened(c); c.key(ESC); c.tick(DT * 2); }
    assert.equal(c.sh().menu, false);
    assert.equal(c.sh().sceneId, diner);
    c.tick(0.6, DT); // a dissolve from a restart or a switch would be under way by now
    const shot = grab(c);
    return { c, shot };
  };
  const x = await run('repick'), y = await run('esc');
  assert.equal(changedFraction(x.shot.g, y.shot.g, x.shot.s, y.shot.s), 0, 'the same picture as if nothing had been chosen');
  assert.equal(x.c.sh().program, y.c.sh().program);
  // no restart: the original 90 s still count. 30.6 + 59.4 = 90, then the 2 s dissolve and the caller at 92 s from the first pick
  wait(x.c, holdOf(diner) - 30.6 - 1);
  assert.equal(x.c.sh().sceneId, diner, 'still the diner at the end of the original hold');
  wait(x.c, 1 + FADE + 0.5);
  assert.equal(x.c.sh().sceneId, nextScene(diner), 'the caller follows on the original timeline, not 30 s later');
  x.c.done(); y.c.done();
  // other arm: choosing a different entry does change the scene and the picture
  const a = await boot();
  pick(a, i);
  wait(a, 5);
  const before = grab(a);
  assert.equal(a.sh().sceneId, diner);
  pick(a, indexOfLabel('A1'));
  assert.equal(a.sh().sceneId, ORDER[0], 'A1 plays');
  a.tick(0.6, DT);
  const now = grab(a);
  assert.ok(changedFraction(before.g, now.g, before.s, now.s) > 0.05, 'and the picture dissolves away from the diner');
  a.done();
});

// ---- M4

test('night-drive menu (M4): picking B4 plays overdrive, and after its 90 s and the dissolve the next scene is the first track (the tape wraps); before that it is still overdrive', async () => {
  const i = indexOfLabel('B4');
  const od = MENU[i].scene;
  assert.equal(od, 'overdrive');
  assert.equal(ORDER[ORDER.length - 1], od, 'overdrive is the last scene of the tape');
  const first = nextScene(od);
  assert.equal(first, ORDER[0]);
  assert.equal(first, 'onramp');
  const c = await boot();
  pick(c, i);
  assert.equal(c.sh().sceneId, od);
  wait(c, holdOf(od) - 1);
  assert.equal(c.sh().sceneId, od, 'overdrive until its 90 s are up');
  wait(c, 1 + FADE - 0.7);
  assert.equal(c.sh().sceneId, od, 'and through most of the dissolve');
  wait(c, 0.7 + 0.5);
  assert.equal(c.sh().sceneId, first, 'then the first track');
  c.done();
});

// ---- M5

test('night-drive menu (M5): space moves to the next track (A1 to A2, and from B4 round to A1); it neither ejects nor opens the menu', async () => {
  const c = await boot();
  c.key(ESC); c.tick(0.6);
  assert.equal(c.sh().menu, false);
  assert.equal(c.sh().sceneId, ORDER[0]);
  c.key(SPACE);
  assert.ok(until(c, () => c.sh().sceneId !== ORDER[0], 4), 'the scene changes');
  assert.equal(c.sh().sceneId, ORDER[1], 'A1 -> A2');
  // the other arm: space is not eject and not the menu
  assert.equal(c.sh().screen, 'running', 'space does not eject');
  assert.equal(c.sh().menu, false, 'space does not open the menu');
  // from the last track it wraps to the first
  pick(c, indexOfLabel('B4'));
  assert.equal(c.sh().sceneId, 'overdrive');
  c.tick(0.6);
  assert.equal(c.sh().menu, false);
  c.key(SPACE);
  assert.ok(until(c, () => c.sh().sceneId !== 'overdrive', 4));
  assert.equal(c.sh().sceneId, ORDER[0], 'B4 -> A1');
  assert.equal(c.sh().screen, 'running');
  assert.equal(c.sh().menu, false);
  c.done();
});

// ---- M6

test('night-drive menu (M6): the Eject entry ejects the tape (back to the library); picking a track does not', async () => {
  const c = await boot();
  pick(c, indexOfLabel('B1'));
  c.tick(1);
  assert.equal(c.sh().screen, 'running', 'picking a track does not eject');
  assert.equal(c.sh().cartridge, 'night-drive');
  pick(c, EJECT);
  assert.ok(until(c, () => c.sh().screen === 'library', 12), `the library after the eject (screen ${c.sh().screen})`);
  assert.equal(c.sh().menu, false);
  c.done();
});

// ---- M7

test('night-drive menu (M7): the * is on the row of the playing track only, and moves after a pick, after space and after the tape plays on by itself; moving the cursor without picking leaves it', async () => {
  const c = await boot();
  const star = () => view(c).starred;
  const reopen = () => { c.key(ESC); c.tick(0.5); c.key(ENTER); c.tick(0.5); return view(c); };
  assert.deepEqual(star(), [0], 'A1 is playing and starred');
  // moving the cursor without picking leaves the star where it was
  c.key(DOWN); c.tick(0.3); c.key(DOWN); c.tick(0.3);
  let v = view(c);
  assert.equal(v.selected, 2);
  assert.deepEqual(v.starred, [0], 'the cursor is on A3 and the star is still on A1');
  // a pick moves it
  pick(c, indexOfLabel('B2'));
  c.tick(1);
  v = opened(c);
  assert.deepEqual(v.starred, [indexOfLabel('B2')], 'after picking B2 the star is on B2 alone');
  c.key(UP); c.tick(0.3);
  assert.deepEqual(view(c).starred, [indexOfLabel('B2')], 'and the cursor moving off it leaves it there');
  // the tape plays on by itself: the star follows to B3 once the diner is over
  c.key(ESC); c.tick(0.5);
  wait(c, holdOf('diner') + FADE + 0.5 - 1);
  assert.equal(c.sh().sceneId, 'caller');
  v = reopen();
  assert.deepEqual(v.starred, [indexOfScene('caller')], 'the star follows the tape on to the caller');
  // space moves it too (the deck is closed first)
  c.key(ESC); c.tick(0.5);
  c.key(SPACE);
  assert.ok(until(c, () => c.sh().sceneId !== 'caller', 4));
  v = reopen();
  assert.deepEqual(v.starred, [indexOfScene(nextScene('caller'))], 'and after space it is on the next track');
  // the other arm of "one at a time": at every step above there was exactly one
  assert.equal(v.starred.length, 1);
  c.done();
});

// ---- M8

test('night-drive menu (M8): the menu title and the prompt of the skin are on screen at 120x40 and 80x24; with the deck closed they are not', async () => {
  const title = SKIN.menu.title, prompt = SKIN.menu.prompt;
  assert.ok(title && prompt);
  for (const [cols, rows] of [[120, 40], [80, 24]]) {
    const c = await boot(cols, rows);
    const text = c.text();
    assert.ok(text.includes(title), `${cols}x${rows}: the title "${title}" shows`);
    assert.ok(text.includes(prompt), `${cols}x${rows}: the prompt "${prompt}" shows`);
    c.key(ESC); c.tick(1);
    assert.equal(c.sh().menu, false);
    const closed = c.text();
    assert.ok(!closed.includes(title), `${cols}x${rows}: no title with the deck closed`);
    assert.ok(!closed.includes(prompt), `${cols}x${rows}: no prompt with the deck closed`);
    c.done();
  }
});
