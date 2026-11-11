// DRIFT-5: Night Drive through the real shell, the edge cases of the deck in a dissolve, help and small windows (part two; part one is
// night-drive-shell-edges.test.js, eject is night-drive-shell-eject.test.js, key frames night-drive-shell-keyframes.test.js). Same harness (tests/helpers-night-drive-shell.js): a real createApp on fake streams, the fake clock, keys as the
// console binds them. The key-frame convention is the flash suite's (night-drive-flash.test.js section e): the frame that carries a key press is
// measured apart; every other frame must change 30% or less of the cells, and a key frame must stay under the 40% hard ceiling.
//   E3  the deck opens in the middle of a dissolve and a pick made there lands (six sizes)       |  the star follows the pick, no flash
//   E7  help (h) names the tape and the playing track, for every track, at 80x23 and four more sizes  |  tight windows show "(+N more, enlarge window)"
//   E8  the deck at the sizes just above the console tiers shows all nine entries  |  at 41x11 and 40x10 it scrolls and the cursor stays right
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boot, recorder, pick, selectedIndex, starredIndexes, DT, MENU, ORDER, EJECT, SKIN, SIX,
  ENTER, ESC, SPACE, DOWN, UP, FLASH, pct, titleOf,
} from './helpers-night-drive-shell.js';

const idxOfScene = (id) => MENU.findIndex((e) => e.scene === id);

// ---- E3

for (const [cols, rows] of SIX) {
  test(`shell edges (E3) ${cols}x${rows}: the deck opens 0.6 s into a dissolve, and a pick made there (Down x3, Enter) lands: non-key frames under 30%, the picked track plays, the star is on it`, async () => {
    const c = await boot(cols, rows);
    const r = recorder(c);
    await pick(c, idxOfScene('sundown'), r);
    await r.run(3);
    assert.equal(c.sh().sceneId, 'sundown');
    r.reset();
    await r.press(SPACE);
    await r.run(0.6);
    await r.press(ENTER);
    assert.equal(c.sh().menu, true, 'the deck opens mid-dissolve');
    await r.run(2);
    for (let k = 0; k < 3; k++) { await r.press(DOWN); await r.run(DT); }
    const target = selectedIndex(c);
    assert.ok(target >= 0 && target < EJECT, `the cursor is on a track (${target})`);
    assert.notEqual(MENU[target].scene, 'coast', 'a track other than the one fading in');
    await r.press(ENTER);
    await r.run(3);
    console.log(`TABLE shell E3 ${cols}x${rows}: non-key worst ${pct(r.nonKey)} (frame ${r.nonKeyAt} of ${r.frames}), key frames max ${pct(r.key)}, picked ${MENU[target].label.slice(0, 2)}`);
    assert.ok(r.nonKey < FLASH, `${cols}x${rows}: a non-key frame changed ${pct(r.nonKey)}`);
    assert.equal(c.sh().sceneId, MENU[target].scene, 'the picked track plays');
    assert.equal(c.sh().menu, false);
    assert.equal(c.sh().screen, 'running');
    // the other arm: the star is on the picked track alone, and not on the track that was fading in
    c.key(ENTER); c.tick(0.5);
    assert.deepEqual(starredIndexes(c), [target], 'the star is on the picked track');
    c.done();
  });
}

// ---- E7

const HELP_SIZES = [[80, 23], [89, 40], [88, 39], [79, 25], [78, 24]];
const TIGHT_SIZES = [[41, 11], [40, 10], [39, 10], [40, 9]];
const HELP_NEED = ['Tracks', 'Glovebox', 'quit Drift', 'eject the tape', 'skip to the next track'];
const helpLine = (c) => c.text().split('\n').find((l) => l.includes('track:')) || '';

for (const [cols, rows] of HELP_SIZES) {
  test(`shell edges (E7) ${cols}x${rows}: h shows the manual for each of the 8 tracks (the tape and the playing track named in full, the key groups and labels there), nothing is written for 2 s while it is open, and h closes it and the picture moves again`, async () => {
    const c = await boot(cols, rows);
    for (let i = 0; i < ORDER.length; i++) {
      await pick(c, idxOfScene(ORDER[i]));
      c.tick(3);
      assert.equal(c.sh().sceneId, ORDER[i]);
      assert.equal(c.sh().help, false, 'the manual is closed before h');
      c.key('h'); c.tick(0.6);
      assert.equal(c.sh().help, true, `${ORDER[i]}: h opens the manual`);
      const text = c.text();
      assert.ok(text.includes("OWNER'S MANUAL · keys"), 'the manual has its title');
      const m = /tape: (.*?)\s+track: (.*?)\s*┃/.exec(helpLine(c));
      assert.ok(m, `${ORDER[i]}: a line names the tape and the track (${JSON.stringify(helpLine(c))})`);
      assert.equal(m[1], 'Night Drive', 'the tape is named');
      assert.equal(m[2], titleOf(ORDER[i]), `${cols}x${rows}: the playing track is named in full`);
      for (const s of HELP_NEED) assert.ok(text.includes(s), `${cols}x${rows} ${ORDER[i]}: the manual says "${s}"`);
      const w = c.writes();
      c.tick(2);
      assert.equal(c.writes(), w, `${ORDER[i]}: no screen writes for 2 s while the manual is open`);
      c.key('h'); c.tick(0.6);
      assert.equal(c.sh().help, false, 'h closes it');
      assert.ok(!c.text().includes("OWNER'S MANUAL"), 'and the manual is off the screen');
      const w2 = c.writes();
      c.tick(1);
      assert.ok(c.writes() > w2, `${ORDER[i]}: the scene moves again`);
    }
    c.done();
  });
}

for (const [cols, rows] of TIGHT_SIZES) {
  test(`shell edges (E7 tight) ${cols}x${rows}: the manual is the tight panel ending in "(+N more, enlarge window)" (N at least 1); both h and Esc close it`, async () => {
    const c = await boot(cols, rows);
    c.key(ESC); c.tick(0.6);
    assert.equal(c.sh().menu, false);
    const tracks = cols === 41 ? ORDER : [ORDER[0]];
    for (const id of tracks) {
      if (cols === 41) { await pick(c, idxOfScene(id)); c.tick(3); }
      c.key('h'); c.tick(0.6);
      assert.equal(c.sh().help, true);
      const m = /\(\+(\d+) more, enlarge window\)/.exec(c.text());
      assert.ok(m && +m[1] >= 1, `${cols}x${rows} ${id}: the panel ends in "(+N more, enlarge window)"`);
      if (id === ORDER[0]) console.log(`TABLE shell E7 tight ${cols}x${rows}: (+${m[1]} more, enlarge window)`);
      c.key('h'); c.tick(0.6);
      assert.equal(c.sh().help, false, 'h closes it');
      c.key('h'); c.tick(0.6);
      assert.equal(c.sh().help, true);
      c.key(ESC); c.tick(0.6);
      assert.equal(c.sh().help, false, 'Esc closes it');
      assert.equal(c.sh().screen, 'running', 'Esc closed the manual, nothing more');
    }
    c.done();
  });
}

async function helpAt41() {
  const c = await boot(41, 11);
  c.key(ESC); c.tick(0.6);
  c.key('h'); c.tick(0.6);
  const text = c.text();
  c.done();
  return text;
}

test('shell edges (E7 todo a) 41x11: the manual names the playing track (the tape and track line is cut at the box)', { todo: "at 41x11 the manual title line reads 'OWNER'S MANUAL · keys  tape: Night Dr', cut at the 37-column box: the tape name is cut and 'track: Midnight On-Ramp' never shows; the manual does not name the playing track" }, async () => {
  const text = await helpAt41();
  assert.ok(text.includes('tape: Night Drive'), 'the tape is named');
  assert.ok(text.includes(`track: ${titleOf(ORDER[0])}`), `the playing track is named: ${JSON.stringify(text.split('\n').filter((l) => l.includes('MANUAL')))}`);
});

test('shell edges (E7 todo b) 41x11: key labels longer than 23 characters are shown whole, not cut', { todo: 'at 41x11 the manual cuts key labels at 23 characters: "open the tape deck, or" (skin: 27 chars), "tape deck: previous tra" (25), "close the tape deck or" (27); wording lives in skin.json' }, async () => {
  const text = await helpAt41();
  const long = Object.values(SKIN.wording.keys).filter((l) => l.length > 23);
  const seen = long.filter((l) => text.includes(l.slice(0, 15)));
  assert.ok(seen.length >= 1, 'some long labels are on the tight panel (so the check sees them)');
  const cut = seen.filter((l) => !text.includes(l));
  assert.deepEqual(cut, [], 'labels shown cut');
});

// ---- E8

const SCROLL = /[↑↓] (\d+) more/g;
const deckText = (c) => c.text().replace(/[┃┏┓┗┛━]/g, ' ').replace(/\s+/g, ' ');
const hidden = (c) => {
  let up = 0, down = 0;
  for (const m of c.text().matchAll(SCROLL)) { if (m[0].startsWith('↑')) up += +m[1]; else down += +m[1]; }
  return { up, down };
};
const rowVisible = (c, e) => c.text().split('\n').some((l) => {
  const row = l.replace(/^[^A-Z▲]*/, '');
  return e.action === 'eject' ? row.startsWith('▲') && row.includes('EJECT') : row.startsWith(e.label.slice(0, 2) + ' ');
});
const visibleCount = (c) => MENU.filter((e) => rowVisible(c, e)).length;

for (const [cols, rows] of [[89, 40], [88, 39], [79, 25], [78, 24]]) {
  test(`shell edges (E8) ${cols}x${rows}: the deck shows all nine labels and the selected description, with no "N more" marker`, async () => {
    const c = await boot(cols, rows);
    const t = deckText(c);
    for (const e of MENU) assert.ok(t.includes(e.label.replace(/\s+/g, ' ')), `${cols}x${rows}: ${e.label}`);
    assert.ok(t.includes(MENU[0].desc.replace(/\s+/g, ' ')), 'the description of the selected entry shows');
    assert.deepEqual(hidden(c), { up: 0, down: 0 });
    assert.equal(c.text().match(SCROLL), null, 'no marker');
    c.key(DOWN); c.tick(0.3);
    assert.ok(deckText(c).includes(MENU[1].desc.replace(/\s+/g, ' ')), 'the description follows the cursor');
    c.done();
  });
}

for (const [cols, rows, win] of [[41, 11, 3], [40, 10, 4]]) {
  test(`shell edges (E8) ${cols}x${rows}: the deck scrolls: "N more" at the top, ${win} entries in the window and ${9 - win} hidden at every step, the arrow always on the right entry through A1..B4, Eject, A1, A2; one Up from A3 returns to A2; Eject is reachable`, async () => {
    const c = await boot(cols, rows);
    let h = hidden(c);
    assert.ok(h.down >= 1 && h.up === 0, `the "↓ N more" marker is there at the top (${JSON.stringify(h)})`);
    const walked = [];
    for (let k = 0; k <= 10; k++) {
      const want = k % 9;
      const sel = selectedIndex(c);
      h = hidden(c);
      walked.push(`${MENU[want].label.slice(0, 2)}${sel === want ? '' : '!'}(${h.up}/${h.down})`);
      assert.equal(sel, want, `${cols}x${rows} step ${k}: the arrow is on ${MENU[want].label}`);
      assert.equal(h.up + h.down, 9 - win, `${cols}x${rows} step ${k}: hidden ${h.up}+${h.down}`);
      assert.equal(visibleCount(c), win, `${cols}x${rows} step ${k}: ${win} entries in the window`);
      if (want === EJECT) assert.ok(c.text().includes('EJECT'), 'Eject is reachable');
      c.key(DOWN); c.tick(0.3);
    }
    console.log(`TABLE shell E8 ${cols}x${rows}: ${walked.join(' ')}`);
    // the cursor is on A3 now (step 10 was A2, one Down since): one Up returns to A2
    assert.equal(selectedIndex(c), 2);
    c.key(UP); c.tick(0.3);
    assert.equal(selectedIndex(c), 1, 'one Up from A3 returns to A2');
    c.done();
  });
}

test('shell edges (E8) 41x11: the description is not shown and the footer prompt is cut (the Esc hint is lost)', async () => {
  // skin wording menuHint: "↑ ↓ pick a track · Enter plays on from there · Esc closes". At 41x11 the box is too narrow for the whole line: it is cut
  // to "↑ ↓ pick a track · Enter plays on", so the player is never told that Esc closes the deck. Pinned as it ships; a wider footer should update it.
  return boot(41, 11).then((c) => {
    const t = deckText(c);
    assert.ok(!t.includes(MENU[0].desc.slice(0, 20)), 'no description at 41x11');
    assert.ok(t.includes('↑ ↓ pick a track · Enter plays on'), `the footer starts: ${JSON.stringify(c.text().split('\n').filter((l) => l.includes('pick a track')))}`);
    assert.ok(!t.includes('Enter plays on from there'), 'and is cut before "from there"');
    assert.ok(!t.includes('Esc'), 'so the Esc hint is lost');
    assert.equal(SKIN.wording.menuHint, '↑ ↓ pick a track · Enter plays on from there · Esc closes');
    // the other arm: at 78x24 the whole hint is there
    return boot(78, 24).then((d) => {
      assert.ok(deckText(d).includes(SKIN.wording.menuHint), 'the whole hint shows at 78x24');
      d.done();
      c.done();
    });
  });
});
