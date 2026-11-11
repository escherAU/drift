// DRIFT-4 follow-up F2: the first insert of a process shows "e ejects · h shows the keys" on the progress-bar line
// instead of the plain bar; every later insert in the same process shows the plain bar. No config field: a module flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedGlyph } from '../src/glyphs.js';
import { FIRST_INSERT_HINT, drawBoot, bootPhases } from '../src/shell/boot.js';
import { resetFirstInsertHint } from '../src/shell/shell.js';
import { driftmanSkin, classicBootSkin } from '../src/shell/driftman.js';
import { screenRect } from '../src/shell/library.js';
import { newFrame } from '../src/shell/ui.js';
import { frameLines } from './helpers-help.js';
import { mkShell, runCartridge } from './helpers-shell.js';

const LIB = { screen: 'library' };
const HINT = 'e ejects · h shows the keys';
const BAR = /\[[█▉▊▋▌▍▎▏]* *\]/;

// seconds after Enter that sit between the end of the typed lines and the end of the bar for any skin that has no boot.seconds
const MID_BAR = 1.5 + 2.1;

async function insertAndLook(c, id, afterEnter) {
  c.goto(id);
  c.key('\r');
  c.tick(afterEnter);
  await c.settle();
  return c.text();
}

test('F2: the hint is the agreed words, allow-listed glyphs only, and fits the console screen at 120x40 and the compact tier at 80x24', () => {
  assert.equal(FIRST_INSERT_HINT, HINT);
  for (const ch of HINT) assert.ok(isAllowedGlyph(ch.codePointAt(0)), `glyph ${ch}`);
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const R = screenRect(w, h);
    assert.ok([...HINT].length <= R.w - 4, `${w}x${h}: ${[...HINT].length} cells in a ${R.w - 4}-wide text area`);
  }
});

test('F2: the first insert of a process shows the hint on the bar line, the second (same shell) and a second shell show the plain bar - 80x24 and 120x40', async () => {
  for (const [cols, rows] of [[80, 24], [120, 40]]) {
    resetFirstInsertHint();
    const c = mkShell({ cols, rows, startScreen: LIB });
    c.app.start();
    c.tick(0.3);
    let txt = await insertAndLook(c, 'fixture', MID_BAR);
    assert.equal(c.sh().screen, 'boot', `${cols}x${rows}: still booting`);
    assert.ok(txt.includes(HINT), `${cols}x${rows}: the first insert shows the hint`);
    assert.ok(!BAR.test(txt), `${cols}x${rows}: ... instead of the bar`);
    // finish, eject, insert again in the same shell
    c.tick(5);
    await c.settle();
    c.tick(1);
    assert.equal(c.sh().screen, 'running');
    c.key('\x1b');
    c.tick(0.6);
    c.key('e');
    c.tick(2);
    assert.equal(c.sh().screen, 'library');
    c.tick(0.5);
    txt = await insertAndLook(c, 'fixture', MID_BAR);
    assert.equal(c.sh().screen, 'boot');
    assert.ok(!txt.includes(HINT), `${cols}x${rows}: the second insert has no hint`);
    assert.ok(BAR.test(txt), `${cols}x${rows}: the second insert shows the plain bar`);
    c.done();
    // a brand new shell in the same process is still not the first insert
    const d = mkShell({ cols, rows, startScreen: LIB });
    d.app.start();
    d.tick(0.3);
    txt = await insertAndLook(d, 'fixture', MID_BAR);
    assert.ok(!txt.includes(HINT) && BAR.test(txt), `${cols}x${rows}: another shell in the same process shows the plain bar`);
    d.done();
  }
});

test('F2: resetFirstInsertHint makes the next insert the first again (control for the per-process flag)', async () => {
  resetFirstInsertHint();
  const a = mkShell({ startScreen: LIB });
  a.app.start();
  a.tick(0.3);
  assert.ok((await insertAndLook(a, 'fixture', MID_BAR)).includes(HINT));
  a.done();
  resetFirstInsertHint();
  const b = mkShell({ startScreen: LIB });
  b.app.start();
  b.tick(0.3);
  assert.ok((await insertAndLook(b, 'fixture', MID_BAR)).includes(HINT));
  b.done();
});

test('F2: Classic as the first insert also shows the hint; the hint stays on its own row (no typed line is overwritten) and drawBoot without the flag is unchanged', () => {
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const P = bootPhases(classicBootSkin);
    const t = (P.linesEnd + P.barEnd) / 2;
    const base = newFrame(w, h), hinted = newFrame(w, h);
    drawBoot(base, { skin: classicBootSkin, t, title: 'Drift Classic' }, driftmanSkin);
    drawBoot(hinted, { skin: classicBootSkin, t, title: 'Drift Classic', hint: HINT }, driftmanSkin);
    const a = frameLines(base), b = frameLines(hinted);
    assert.ok(a.some((r) => BAR.test(r)) && !a.some((r) => r.includes(HINT)), `${w}x${h}: plain`);
    assert.ok(b.some((r) => r.includes(HINT)) && !b.some((r) => BAR.test(r)), `${w}x${h}: hinted`);
    const diff = a.map((r, i) => (r === b[i] ? -1 : i)).filter((i) => i >= 0);
    assert.equal(diff.length, 1, `${w}x${h}: only the bar row differs`);
  }
});
