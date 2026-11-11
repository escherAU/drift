// DRIFT-4 schema items 3 and 4 end to end: per-scene seconds and menu entries that jump to a scene,
// in a real runtime reached through the app (library -> insert -> boot -> running).
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeCart, LABEL, NOTE_TEXT } from './helpers-cartridge.js';
import { mkShell, makeRoot, runCartridge } from './helpers-shell.js';

function addJumper(root, over = {}) {
  return writeCart(root, 'jumper', {
    'manifest.json': {
      format: 1, id: 'jumper', title: 'Jumper', version: '1.0.0', author: 'Test', blurb: 'Three text scenes.',
      runtime: 'cartridge',
      scenes: [{ id: 'sa', kind: 'text' }, { id: 'sb', kind: 'text' }, { id: 'sc', kind: 'text' }],
      programs: [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: ['sa', 'sb', 'sc'], sceneSeconds: 30 }],
      start: 'main',
      menu: [
        { label: 'Start', program: 'main' },
        { label: 'Scene b', program: 'main', scene: 'sb', note: 'jump', desc: 'Go straight to the second scene.' },
        { label: 'Scene c', program: 'main', scene: 'sc' },
        { label: 'Eject', action: 'eject' },
      ],
      ...over,
    },
    'label.txt': LABEL,
    'scenes/sa.txt': NOTE_TEXT, 'scenes/sb.txt': NOTE_TEXT, 'scenes/sc.txt': NOTE_TEXT,
  });
}

async function start(over) {
  const root = makeRoot();
  addJumper(root, over);
  const c = mkShell({ startScreen: { screen: 'library' }, root });
  c.app.start();
  await runCartridge(c, 'jumper');
  return c;
}

test('menu scene jump: Enter on a scene entry plays that scene on the same program, then on to the next', async () => {
  const c = await start();
  assert.equal(c.sh().program, 'main');
  assert.equal(c.sh().sceneId, 'sa');
  c.key('\x1b[B'); // Scene b
  c.key('\r');
  assert.equal(c.sh().menu, false);
  assert.equal(c.sh().program, 'main');
  assert.equal(c.sh().sceneId, 'sb', 'jumped to b');
  c.tick(29);
  assert.equal(c.sh().sceneId, 'sb', 'still b before its 30 s are up');
  c.tick(5); // 30 s hold plus the 2 s dissolve
  assert.equal(c.sh().sceneId, 'sc', 'plays on to c after b');
  c.done();
});

test('menu scene jump: choosing the scene that is already playing changes nothing (no dissolve, no restart)', async () => {
  const c = await start();
  c.key('\x1b[B'); c.key('\r'); // now on b
  c.tick(10);
  c.key('\r'); // open: the cursor is still on Scene b
  assert.equal(c.sh().menu, true);
  c.key('\r'); // choose b again
  const after = c.sh();
  assert.equal(after.sceneId, 'sb');
  assert.equal(after.program, 'main');
  assert.equal(after.menu, false, 'the menu still closes');
  // no restart: 30 s from the first jump are still counted, so b ends at ~30 s, not 40 s
  c.tick(20);
  assert.equal(c.sh().sceneId, 'sb', '30 s after the first jump minus 10 s elapsed minus the new 20 s: still inside b');
  c.tick(4);
  assert.equal(c.sh().sceneId, 'sc', 'b ran its original 30 s plus the dissolve, not a fresh 30 s');
  c.done();
});

test('menu entries mark current only for the playing scene; a plain program entry is current only when no scene is named', async () => {
  const c = await start();
  // the screenshot shows the star on the playing entry's row
  const starRow = () => c.text().split('\n').filter((l) => l.includes('*')).join('|');
  c.tick(0.5);
  assert.match(starRow(), /Start/, 'on scene a the plain Start entry is current');
  assert.doesNotMatch(starRow(), /Scene [bc]/);
  c.key('\x1b[B'); c.key('\r'); // jump to b
  c.tick(0.5);
  c.key('\r');
  c.tick(0.5);
  assert.match(starRow(), /Scene b/, 'on scene b the b entry is current');
  assert.doesNotMatch(starRow(), /Scene c/, 'and the c entry is not');
  assert.doesNotMatch(starRow(), /Eject/);
  c.key('\x1b[B'); c.key('\r'); // jump to c
  c.tick(0.5);
  c.key('\r');
  c.tick(0.5);
  assert.match(starRow(), /Scene c/);
  assert.doesNotMatch(starRow(), /Scene b/);
  c.done();
});

test('per-scene seconds (item 3): {a:20,b:45,c:20} advances a->b at 20 s plus the fade and b->c at 45 s later', async () => {
  const root = makeRoot();
  addJumper(root, {
    programs: [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: ['sa', 'sb', 'sc'], sceneSeconds: 30, seconds: { sa: 20, sb: 45, sc: 20 } }],
    menu: [{ label: 'Start', program: 'main' }, { label: 'Eject', action: 'eject' }],
  });
  const c = mkShell({ startScreen: { screen: 'library' }, root });
  c.app.start();
  // the program's clock starts when the console reaches 'running': count from that tick
  c.goto('jumper');
  c.key('\r');
  c.tick(1.6);
  await c.settle();
  for (let i = 0; i < 40 * 18 && c.sh().screen !== 'running'; i++) c.tick(1 / 18);
  assert.equal(c.sh().screen, 'running');
  assert.equal(c.app.getState().speed, 1);
  let el = 0, tB = null, tC = null;
  for (let i = 0; i < 100 * 18 && tC === null; i++) {
    c.tick(1 / 18); el += 1 / 18;
    const sid = c.sh().sceneId;
    if (sid === 'sb' && tB === null) tB = el;
    if (sid === 'sc' && tC === null) tC = el;
  }
  assert.ok(tB !== null && tC !== null, 'both advances happened');
  assert.ok(tB >= 20 && tB <= 22.3, `a -> b at ${tB}`);
  assert.ok(tC - tB >= 46.5 && tC - tB <= 47.3, `b held 45 s plus the 2 s dissolve (got ${tC - tB})`);
  assert.ok(tC >= 68 && tC <= 70, `b -> c at ${tC}`);
  c.done();
});
