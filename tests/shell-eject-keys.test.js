// DRIFT-4 follow-up F3: both e and l eject a running Delza-style cartridge, the help panel lists them, and in Classic
// (the Classic cartridge running) l is the way back to the library. One test per key.
//
// The installed arcade, night-drive and last-fantasy cartridges are locked and have no scenes, so none can run; the
// fixture cartridge (skin, programs, every scene kind - the same shape a Delza cartridge has) stands in for them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EJECT_SECONDS } from '../src/shell/shell.js';
import { mkShell, runCartridge } from './helpers-shell.js';

const LIB = { screen: 'library' };

async function runningWithHelpChecked(c) {
  c.app.start();
  await runCartridge(c, 'fixture');
  c.key('\x1b'); // close the menu the cartridge opens on
  c.tick(0.6);
  c.key('h');
  assert.equal(c.sh().help, true);
  c.tick(0.6); // the panel ramps in over 0.25 s (DRIFT-7 C10)
  assert.match(c.text(), /e or l\s+eject the cartridge/, 'the help panel lists e and l as eject');
  c.key('h');
  assert.equal(c.sh().help, false);
  assert.equal(c.sh().screen, 'running');
}

for (const k of ['e', 'l']) {
  test(`running cartridge: ${k} ejects (reverse animation, then the library on the same cartridge) and the help panel lists it`, async () => {
    const c = mkShell({ startScreen: LIB });
    await runningWithHelpChecked(c);
    c.key(k);
    assert.equal(c.sh().screen, 'eject');
    c.tick(EJECT_SECONDS + 0.1);
    assert.equal(c.sh().screen, 'library');
    assert.equal(c.sh().cartridge, 'fixture');
    c.done();
  });
}

test('Classic cartridge running: the help lists l as the cartridge library, and l opens it (control: a key that is not bound does nothing)', async () => {
  const c = mkShell({ startScreen: LIB });
  c.app.start();
  c.tick(0.3);
  c.key('\r');
  c.tick(6);
  assert.equal(c.sh(), null, 'Classic is running');
  c.key('h');
  c.tick(0.3);
  assert.match(c.text(), /l\s+cartridge library/, 'the Classic help lists l');
  c.key('h');
  c.tick(0.3);
  c.key('j');
  c.tick(0.3);
  assert.equal(c.sh(), null, 'an unbound key leaves Classic as it is');
  c.key('l');
  c.tick(0.6);
  assert.equal(c.sh().screen, 'library');
  assert.equal(c.sh().cartridge, 'classic');
  c.done();
});
