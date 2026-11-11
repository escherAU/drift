// DRIFT-5: Night Drive through the real shell: eject in the middle of other things (E4 of the shell-edge tests; see night-drive-shell-edges.test.js
// for the harness notes). The key-frame convention is the flash suite's (night-drive-flash.test.js section e): the frame that carries a key press is
// measured apart; every other frame must change 30% or less of the cells.
//   E4  eject during a dissolve (0.5, 1.5 and 1.9 s in) and 0.3 s after a deck pick reaches the library within 3 s with non-key frames at 30% or less;
//       Enter on the cartridge again starts the tape fresh (onramp, deck open, the screen drawing)  |  the plain eject (no dissolve) ends the same way
//   At 41x11 the deck covers the whole picture, so nothing is written while the deck is open and the screen is steady: there the "drawing" check is
//   made after Esc closes the deck (the scene behind it must be moving).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, reinsert, recorder, pick, MENU, SIX, SPACE, ESC, FLASH, pct } from './helpers-night-drive-shell.js';

const idxOfScene = (id) => MENU.findIndex((e) => e.scene === id);
const EJECT_CASES = [['dissolve 0.5 s in', 0.5], ['dissolve 1.5 s in', 1.5], ['dissolve 1.9 s in', 1.9], ['0.3 s after a deck pick', 'pick'], ['no dissolve (plain)', 'plain']];
const DECK_COVERS_PICTURE = (cols, rows) => cols === 41 && rows === 11;

for (const [cols, rows] of SIX) {
  test(`shell edges (E4) ${cols}x${rows}: eject during a dissolve (0.5, 1.5, 1.9 s in) or 0.3 s after a deck pick reaches the library within 3 s with non-key frames at 30% or less; inserting again starts fresh at onramp with the deck open and the screen drawing; the plain eject ends the same way`, async () => {
    const c = await boot(cols, rows);
    const r = recorder(c);
    const table = [];
    for (const [label, how] of EJECT_CASES) {
      await pick(c, idxOfScene('diner'));
      c.tick(3);
      assert.equal(c.sh().sceneId, 'diner');
      r.sync(); r.reset();
      if (typeof how === 'number') { await r.press(SPACE); await r.run(how); }
      else if (how === 'pick') { await pick(c, idxOfScene('skyline'), r); await r.run(0.3 - 2 / 18); }
      await r.press('e');
      await r.run(3);
      table.push(`${label}: non-key ${pct(r.nonKey)}, key ${pct(r.key)}`);
      assert.equal(c.sh().screen, 'library', `${cols}x${rows} ${label}: the library within 3 s`);
      assert.ok(r.nonKey <= FLASH, `${cols}x${rows} ${label}: a non-key frame changed ${pct(r.nonKey)}`);
      // start again: Enter on the cartridge, fresh from the top of the tape
      await reinsert(c);
      assert.equal(c.sh().sceneId, 'onramp', `${label}: the tape starts again at the first track, not mid-tape`);
      assert.equal(c.sh().menu, true, 'with the deck open');
      const w = c.writes();
      c.tick(1);
      if (DECK_COVERS_PICTURE(cols, rows)) {
        assert.equal(c.writes(), w, `${label}: the deck covers the picture at ${cols}x${rows}: a steady screen`);
        c.key(ESC); c.tick(0.5);
        const w2 = c.writes();
        c.tick(1);
        assert.ok(c.writes() > w2, `${label}: with the deck closed the screen keeps drawing (not frozen or paused)`);
      } else {
        assert.ok(c.writes() > w, `${label}: the screen keeps drawing after the re-insert (not frozen or paused)`);
      }
    }
    console.log(`TABLE shell E4 ${cols}x${rows}:\n  ${table.join('\n  ')}`);
    c.done();
  });
}
