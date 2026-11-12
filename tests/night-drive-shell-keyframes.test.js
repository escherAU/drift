// DRIFT-5: Night Drive through the real shell: the key frames (E6 of the shell-edge tests; see night-drive-shell-edges.test.js for the harness notes).
// A key frame is the first tick after a key press, the frame that carries the key's effect. The flash suite (night-drive-flash.test.js section e)
// measures it apart and holds it to a 40% hard ceiling; the console draws it, not the cartridge.
//   For each of six window sizes: 8 deck picks (the Enter that chooses a track other than the one playing, after 3 s of play) and 4 ejects (the e key,
//   from sundown, coast, redlight and overdrive after 3 s of play, each followed by a fresh insert). The eject key frame depends on the picture it
//   fades out of, so the ejects are taken from the tracks that measured worst.
//   (1) a green ratchet: no key frame is worse than the maximum measured on HEAD plus 3 points, printed as a TABLE
//   (2) every key frame is 40% or less at all six sizes (the eject frame was over 40% at all six until DRIFT-7 C9 made it a 0.3 s dissolve of
//       the frozen running frame to blank; its key frame is now the first 1/18 s of that dissolve, 8.5 to 10.8% at the worst track)
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, reinsert, recorder, pick, MENU, SIX, HARD_CEILING, pct } from './helpers-night-drive-shell.js';

const idxOfScene = (id) => MENU.findIndex((e) => e.scene === id);
const EJECT_FROM = ['sundown', 'coast', 'redlight', 'overdrive'];

const keyCache = new Map();
function keyFrames(cols, rows) {
  const k = `${cols}x${rows}`;
  if (!keyCache.has(k)) keyCache.set(k, measureKeyFrames(cols, rows));
  return keyCache.get(k);
}
async function measureKeyFrames(cols, rows) {
  const c = await boot(cols, rows);
  const r = recorder(c);
  const picks = [], ejects = [];
  try {
    for (const idx of [1, 2, 3, 4, 5, 6, 7, 0]) {
      await r.run(3);
      picks.push(await pick(c, idx, r));
    }
    for (const id of EJECT_FROM) {
      await pick(c, idxOfScene(id));
      c.tick(3); r.sync();
      ejects.push(await r.press('e'));
      await r.run(3);
      assert.equal(c.sh().screen, 'library');
      await reinsert(c); r.sync();
    }
  } finally { c.done(); }
  return { pick: Math.max(...picks), eject: Math.max(...ejects), picks, ejects };
}

// The maxima measured on HEAD, plus 3 points. A key frame that gets worse than this fails; a better one passes (and the limit can come down).
// The eject column came down at DRIFT-7 C9 (it was 0.720, 0.654, 0.699, 0.704, 0.657, 0.548): maximum measured 0.1079, 0.0871, 0.0942, 0.0943,
// 0.1042, 0.0850, rounded up to a tenth of a point, plus 3 points.
const RATCHET = {
  '120x40': { pick: 0.079, eject: 0.138 },
  '89x40': { pick: 0.091, eject: 0.118 },
  '79x25': { pick: 0.126, eject: 0.125 },
  '80x24': { pick: 0.129, eject: 0.125 },
  '41x11': { pick: 0.225, eject: 0.135 },
  '240x67': { pick: 0.050, eject: 0.115 },
};

test('shell edges (E6) key frames: the Enter that picks a track and the eject key change no more of the cells than the measured ratchet (maximum on HEAD + 3 points) at six sizes', async () => {
  const lines = [], bad = [];
  for (const [cols, rows] of SIX) {
    const m = await keyFrames(cols, rows);
    const lim = RATCHET[`${cols}x${rows}`];
    lines.push(`${cols}x${rows}: pick max ${pct(m.pick)} (limit ${pct(lim.pick)}), eject max ${pct(m.eject)} (limit ${pct(lim.eject)}; per track ${EJECT_FROM.map((id, i) => `${id} ${pct(m.ejects[i])}`).join(', ')})`);
    if (m.pick > lim.pick) bad.push(`${cols}x${rows} pick ${pct(m.pick)} > ${pct(lim.pick)}`);
    if (m.eject > lim.eject) bad.push(`${cols}x${rows} eject ${pct(m.eject)} > ${pct(lim.eject)}`);
  }
  console.log(`TABLE shell E6 key frames\n  ${lines.join('\n  ')}`);
  assert.deepEqual(bad, []);
});

test('shell edges (E6) every key frame is under the 40% hard ceiling at all six sizes', async () => {
  const bad = [];
  for (const [cols, rows] of SIX) {
    const m = await keyFrames(cols, rows);
    if (m.pick > HARD_CEILING) bad.push(`${cols}x${rows} pick ${pct(m.pick)}`);
    if (m.eject > HARD_CEILING) bad.push(`${cols}x${rows} eject ${pct(m.eject)}`);
  }
  assert.deepEqual(bad, [], 'key frames over 40%');
});
