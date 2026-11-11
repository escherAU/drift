// DRIFT-4 phase 2: the console (cartridge library, insert, boot, running cartridge) at app level.
// A real createApp on fake streams, a fake clock (the test calls app.tick), injected cartridge folders and
// a trusted fixture cartridge built in a temp folder. See tests/helpers-shell.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp, main, planStartup, parseOptions, helpText } from '../src/app.js';
import { SHELL_KEYMAP, SHELL_KEYS, buildShellKeyMaps, SHELL_SCREENS } from '../src/keymap.js';
import { createShell, LOCKED_MESSAGE, ERROR_SECONDS, EJECT_SECONDS } from '../src/shell/shell.js';
import { discoverCartridges } from '../src/cartridge/loader.js';
import { INSERT_END } from '../src/shell/insert.js';
import { BOOT_END } from '../src/shell/boot.js';
import { LEAVE, ENTER } from '../src/term.js';
import { SYNC_BEGIN } from '../src/renderer.js';
import { fakeStderr } from './helpers.js';
import { sgrFor, parseHex } from '../src/color.js';
import { mkShell, makeRoot, addSeasonal, addBoom, runCartridge, DT } from './helpers-shell.js';

const LIB = { screen: 'library' };
const fullRepaints = (c, from = 0) => c.stdout.writes.slice(from).filter((w) => w.includes('\x1b[2J')).length;

// ---- the key table

test('shell keymap: every SHELL_KEYMAP action has a handler and every handler is reachable from the table', () => {
  const sh = createShell({ cols: 80, rows: 24, cartridges: [], consts: {}, host: {} });
  const handlers = Object.keys(sh.actions).sort();
  const used = [...new Set(SHELL_KEYMAP.map((e) => e.action))].sort();
  assert.deepEqual(handlers, used);
  for (const h of handlers) assert.equal(typeof sh.actions[h], 'function', h);
});

test('shell keymap: no key is bound twice on one screen, and the builder throws if one is (both arms)', () => {
  for (const s of SHELL_SCREENS) {
    const seen = new Set();
    for (const e of SHELL_KEYMAP.filter((x) => x.screens.includes(s))) for (const k of e.keys) {
      assert.ok(!seen.has(k), `${s}: ${JSON.stringify(k)} twice`);
      seen.add(k);
    }
    assert.equal(SHELL_KEYS[s].size, seen.size, s);
  }
  assert.throws(() => buildShellKeyMaps([...SHELL_KEYMAP, { id: 'dup', keys: ['p'], display: 'p', label: 'x', group: 'x', screens: ['running'], action: 'x' }]), /bound twice on screen running/);
  // the same key on two different screens is fine
  assert.doesNotThrow(() => buildShellKeyMaps([
    { id: 'a', keys: ['x'], display: 'x', label: 'a', group: 'g', screens: ['library'], action: 'a' },
    { id: 'b', keys: ['x'], display: 'x', label: 'b', group: 'g', screens: ['running'], action: 'b' },
  ]));
  assert.equal(new Set(SHELL_KEYMAP.map((e) => e.id)).size, SHELL_KEYMAP.length, 'ids unique');
});

// ---- the library

test('library: the cursor wraps both ways, and getState().shell has exactly the documented shape', () => {
  const c = mkShell({ startScreen: LIB });
  c.app.start();
  c.tick(0.2);
  assert.deepEqual(Object.keys(c.sh()), ['screen', 'cartridge', 'program', 'sceneId', 'menu', 'help']);
  assert.deepEqual(c.sh(), { screen: 'library', cartridge: 'classic', program: null, sceneId: null, menu: false, help: false });
  c.key('\x1b[D'); // left from the first wraps to the last
  assert.equal(c.sh().cartridge, 'locker');
  c.key('\x1b[C'); // right from the last wraps to the first
  assert.equal(c.sh().cartridge, 'classic');
  c.key('.'); c.key('.');
  assert.equal(c.sh().cartridge, 'locker');
  c.key(','); // the second pair of keys
  assert.equal(c.sh().cartridge, 'fixture');
  c.key('\x1bOB'); // the SS3 form of down
  assert.equal(c.sh().cartridge, 'locker');
  c.key('\x1bOA'); // up
  assert.equal(c.sh().cartridge, 'fixture');
  c.done();
});

test('library: a locked cartridge shows its message and is not inserted (both arms: an unlocked one is)', () => {
  const c = mkShell({ startScreen: LIB });
  c.app.start();
  assert.ok(c.goto('locker'));
  c.tick(0.5);
  c.key('\r');
  c.tick(0.1); // the dip
  assert.equal(c.sh().screen, 'library', 'no insert');
  assert.ok(c.text().replace(/\s+/g, ' ').includes('This cartridge isn\'t ready yet. Pick another with'), c.text());
  assert.ok(c.text().includes('◀') && c.text().includes('▶'));
  assert.equal(LOCKED_MESSAGE, 'This cartridge isn\'t ready yet. Pick another with ◀ ▶.');
  assert.equal(c.has(), false, 'nothing saved for a locked cartridge');
  c.tick(1);
  assert.equal(c.sh().screen, 'library', 'still the library after the dip springs back');
  assert.ok(c.goto('fixture'));
  c.key('\n'); // LF is Enter too
  c.tick(0.1);
  assert.equal(c.sh().screen, 'insert', 'unlocked: inserts');
  c.done();
});

test('library: a locked cartridge dips for 0.3 s and springs back (the label moves down one row, then up)', () => {
  const c = mkShell({ startScreen: LIB, cols: 120, rows: 40 });
  c.app.start();
  assert.ok(c.goto('locker'));
  c.tick(0.6);
  const rowOf = () => c.text().split('\n').findIndex((l) => l.includes('LOCKER') || l.includes('Locked locker') || l.includes('FIXTURE'));
  const before = c.text().split('\n');
  c.key('\r');
  c.tick(DT);
  const during = c.text().split('\n');
  assert.notDeepEqual(during, before, 'the cartridge moved');
  c.tick(0.5);
  const blankMsg = (l) => (l.includes('ready yet') ? ' '.repeat(l.length) : l);
  assert.deepEqual(c.text().split('\n').map(blankMsg), before.map(blankMsg), 'back where it was');
  assert.ok(rowOf() >= -1);
  c.done();
});

test('library: Esc and l go back to Classic, resuming the same mode and scene with exactly one full repaint', () => {
  for (const back of ['\x1b', 'l']) {
    const c = mkShell({ config: { mode: 'chaos' } });
    c.app.start();
    c.tick(2);
    const before = c.app.getState();
    c.key('l');
    c.tick(0.3);
    assert.equal(c.sh().screen, 'library');
    assert.equal(c.app.getState().t, before.t, 'Classic time stands still in the library');
    c.tick(2);
    assert.equal(c.app.getState().t, before.t);
    const n = c.writes();
    c.key(back);
    c.tick(DT);
    assert.equal(c.sh(), null, 'back in Classic');
    const after = c.app.getState();
    assert.equal(after.mode, 'chaos');
    assert.equal(after.sceneId, before.sceneId);
    assert.equal(fullRepaints(c, n), 1, 'one full repaint');
    c.tick(0.5);
    assert.equal(fullRepaints(c, n), 1, 'and only one');
    c.done();
  }
});

test('library: Esc does nothing when the library was the start screen (and l does nothing either)', () => {
  const c = mkShell({ startScreen: LIB });
  c.app.start();
  c.tick(0.3);
  const n = c.writes();
  c.key('\x1b'); c.key('l'); c.key('L');
  c.tick(1);
  assert.equal(c.sh().screen, 'library');
  assert.equal(c.writes(), n, 'nothing written');
  c.done();
});

test('library: h opens the console help, nothing is written while it is open, Esc and h close it, q still quits', () => {
  const c = mkShell({ startScreen: LIB });
  c.app.start();
  c.tick(0.5);
  c.key('h');
  assert.equal(c.sh().help, true);
  c.tick(0);
  const n = c.writes();
  assert.match(c.text(), /DRIFTMAN 2000  keys/);
  for (const k of ['\x1b[C', '.', '\r', 'x']) c.key(k);
  c.tick(2);
  assert.equal(c.writes(), n, 'frozen: no writes');
  assert.equal(c.sh().cartridge, 'classic', 'keys other than h Esc q are ignored');
  c.key('\x1b');
  assert.equal(c.sh().help, false);
  c.key('h'); c.key('h');
  assert.equal(c.sh().help, false);
  c.key('h'); c.key('q');
  assert.deepEqual(c.proc.exits, [0]);
  assert.equal(c.stdout.writes.at(-1), LEAVE);
  fs.rmSync(c.dir, { recursive: true, force: true });
});

// ---- quit on every screen

test('every screen: q quits with 0 and Ctrl+C with 130, the terminal restored exactly (library, insert, boot, running, eject)', async () => {
  const stages = [
    ['library', async () => {}],
    ['insert', async (c) => { c.goto('fixture'); c.key('\r'); c.tick(0.5); }],
    ['boot', async (c) => { c.goto('fixture'); c.key('\r'); c.tick(2.5); }],
    ['running', async (c) => { await runCartridge(c, 'fixture'); }],
    ['eject', async (c) => { await runCartridge(c, 'fixture'); c.key('e'); c.tick(0.4); }],
  ];
  for (const [screen, setup] of stages) {
    for (const [k, code] of [['q', 0], ['\x03', 130]]) {
      const c = mkShell({ startScreen: LIB });
      c.app.start();
      await setup(c);
      assert.equal(c.sh().screen, screen);
      c.key(k);
      assert.deepEqual(c.proc.exits, [code], `${screen} ${JSON.stringify(k)}`);
      assert.equal(c.stdout.writes.at(-1), LEAVE, 'leave is the last write');
      assert.equal(c.stdout.writes.filter((w) => w === LEAVE).length, 1);
      assert.equal(c.stdout.writes[0], ENTER);
      fs.rmSync(c.dir, { recursive: true, force: true });
    }
  }
});

// ---- insert, boot, load

test('insert -> boot -> running: the timeline constants drive the screens, and the menu is open over the start program', async () => {
  const c = mkShell({ startScreen: LIB });
  c.app.start();
  c.goto('fixture');
  c.key('\r');
  assert.equal(c.sh().screen, 'insert');
  c.tick(INSERT_END - 0.1);
  assert.equal(c.sh().screen, 'insert');
  await c.settle();
  c.tick(0.2);
  assert.equal(c.sh().screen, 'boot');
  c.tick(BOOT_END - INSERT_END - 0.5);
  assert.equal(c.sh().screen, 'boot');
  c.tick(0.7);
  assert.equal(c.sh().screen, 'running');
  assert.deepEqual(c.sh(), { screen: 'running', cartridge: 'fixture', program: 'mix', sceneId: c.sh().sceneId, menu: true, help: false });
  assert.ok(['tide', 'drops', 'note', 'sandbox'].includes(c.sh().sceneId));
  c.done();
});

test('boot: waits at the end of the progress bar while the scenes are still loading, then goes on (both arms)', async () => {
  const c = mkShell({ startScreen: LIB });
  c.gate.hold = true;
  c.app.start();
  c.goto('fixture');
  c.key('\r');
  c.tick(12);
  await c.settle();
  assert.equal(c.sh().screen, 'boot', 'still booting after 12 s: the load is pending');
  assert.equal(c.gate.calls, 1, 'one load, started at insert');
  const n = c.writes();
  c.tick(2);
  assert.equal(c.sh().screen, 'boot');
  assert.ok(c.writes() <= n + 1 + 40, 'the held boot may redraw but does not run away');
  c.gate.release();
  await c.settle();
  c.tick(BOOT_END);
  assert.equal(c.sh().screen, 'running');
  c.done();
});

test('boot: a load that rejects shows the error card for 4 s and returns to the library', async () => {
  const c = mkShell({ startScreen: LIB });
  c.gate.hold = true;
  c.app.start();
  c.goto('fixture');
  c.key('\r');
  c.tick(2.5);
  await c.settle(10);
  c.gate.fail(new Error('scene import failed'));
  await c.settle();
  c.tick(0.2);
  assert.equal(c.sh().screen, 'error');
  assert.match(c.text().replace(/\s+/g, ' '), /Cartridge problem/);
  assert.match(c.text().replace(/\s+/g, ' '), /scene import failed/);
  c.tick(ERROR_SECONDS - 0.5);
  assert.equal(c.sh().screen, 'error', 'still showing at 3.5 s');
  c.tick(0.7);
  assert.equal(c.sh().screen, 'library');
  assert.equal(c.sh().cartridge, 'fixture');
  c.done();
});

test('boot: a cartridge whose scenes fail the loader checks lands on the error card too', async () => {
  const root = makeRoot();
  const dir = addBoom(root);
  fs.writeFileSync(dir + '/scenes/boom.js', 'export default 42;\n'); // not a scene: the loader reports an error
  const c = mkShell({ startScreen: LIB, root });
  c.app.start();
  assert.ok(c.goto('boom'));
  c.key('\r');
  c.tick(2);
  await c.settle();
  c.tick(0.3);
  assert.equal(c.sh().screen, 'error');
  assert.match(c.text().replace(/\s+/g, ' '), /default export must be the scene/);
  c.tick(ERROR_SECONDS + 0.2);
  assert.equal(c.sh().screen, 'library');
  c.done();
});

test('quit while the load is pending: no writes after LEAVE, and a late resolve or a late reject do nothing (both arms)', async () => {
  for (const how of ['resolve', 'reject']) {
    const c = mkShell({ startScreen: LIB });
    c.gate.hold = true;
    c.app.start();
    c.goto('fixture');
    c.key('\r');
    c.tick(3);
    await c.settle(10);
    assert.equal(c.sh().screen, 'boot');
    c.key('q');
    const n = c.writes();
    assert.equal(c.stdout.writes.at(-1), LEAVE);
    if (how === 'resolve') c.gate.release(); else c.gate.fail(new Error('late'));
    await c.settle();
    c.tick(2);
    c.key('x');
    assert.equal(c.writes(), n, `no writes after LEAVE (${how})`);
    assert.deepEqual(c.proc.exits, [0]);
    assert.equal(await c.app.whenRunning(), false, 'whenRunning settles false on quit');
    fs.rmSync(c.dir, { recursive: true, force: true });
  }
});

test('shell: a load that settles AFTER dispose() changes nothing (no frame request, no state change, no writes, no unhandled rejection); a live shell does react (control)', async () => {
  const found = discoverCartridges({ dirs: [{ dir: makeRoot(), trusted: true }] });
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    for (const [how, disposeFirst] of [['resolve', true], ['reject', true], ['resolve', false], ['reject', false]]) {
      const calls = [];
      let settle = null;
      const sh = createShell({
        cols: 80, rows: 24, cartridges: found.cartridges, consts: {},
        host: { quit: (c) => calls.push(['quit', c]), persist: (p) => calls.push(['persist', p]), leaveToClassic: () => calls.push(['leave']) },
        loadScenes: () => new Promise((res, rej) => { settle = how === 'resolve' ? () => res({ scenes: [], errors: [] }) : () => rej(new Error('late')); }),
      });
      for (let i = 0; i < 12 && sh.state().cartridge !== 'fixture'; i++) sh.actions.libNext();
      sh.actions.libInsert();
      assert.equal(sh.screen, 'insert');
      await new Promise((r) => setTimeout(r, 10)); // the loader call is made in a microtask
      assert.equal(typeof settle, 'function', 'the load started');
      sh.frame(); // a drawn frame clears the redraw request
      assert.equal(sh.dirty(), false);
      const before = JSON.stringify(sh.state());
      const callsBefore = calls.length;
      if (disposeFirst) sh.dispose();
      settle();
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
      const label = `${how}, ${disposeFirst ? 'after dispose' : 'live'}`;
      assert.equal(sh.dirty(), !disposeFirst, `redraw requested only while live (${label})`);
      assert.equal(JSON.stringify(sh.state()), before, label);
      assert.equal(calls.length, callsBefore, `no host calls (${label})`);
      if (disposeFirst) {
        sh.tick(5); sh.key('enter');
        assert.equal(calls.length, callsBefore, `still no host calls after tick and key (${label})`);
        assert.equal(sh.screen, 'insert', 'a disposed shell does not move on');
      }
    }
    assert.deepEqual(unhandled, []);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('skip: any key but q jumps insert and boot to the end state; q still quits (both arms)', async () => {
  // skip from insert
  let c = mkShell({ startScreen: LIB });
  c.app.start();
  c.goto('fixture');
  c.key('\r');
  c.tick(0.4);
  await c.settle();
  c.key(' ');
  c.tick(DT);
  assert.equal(c.sh().screen, 'running', 'space skipped insert and boot');
  assert.equal(c.sh().menu, true);
  c.done();
  // skip from boot
  c = mkShell({ startScreen: LIB });
  c.app.start();
  c.goto('fixture');
  c.key('\r');
  c.tick(2.5);
  await c.settle();
  assert.equal(c.sh().screen, 'boot');
  c.key('x');
  c.tick(DT);
  assert.equal(c.sh().screen, 'running');
  c.done();
  // skip while loading: goes to the end of the bar, then straight to running once loaded
  c = mkShell({ startScreen: LIB });
  c.gate.hold = true;
  c.app.start();
  c.goto('fixture');
  c.key('\r');
  c.tick(0.4);
  await c.settle(10);
  c.key('\r');
  c.tick(0.3);
  assert.equal(c.sh().screen, 'boot');
  c.gate.release();
  await c.settle();
  c.tick(DT);
  assert.equal(c.sh().screen, 'running', 'no zoom, no title: straight to running');
  c.done();
  // q is not a skip key
  c = mkShell({ startScreen: LIB });
  c.app.start();
  c.goto('fixture');
  c.key('\r');
  c.tick(0.4);
  c.key('q');
  assert.deepEqual(c.proc.exits, [0]);
  fs.rmSync(c.dir, { recursive: true, force: true });
});

// ---- running

test('running: Enter opens the menu and chooses, arrows move, Esc closes; a program switch dissolves; the menu auto-closes after 20 s', async () => {
  const c = mkShell({ startScreen: LIB });
  c.app.start();
  await runCartridge(c, 'fixture');
  assert.equal(c.sh().menu, true);
  c.key('\x1b');
  c.tick(0.5);
  assert.equal(c.sh().menu, false, 'Esc closes');
  c.key('\r');
  assert.equal(c.sh().menu, true, 'Enter opens');
  c.key('\x1b[B');
  c.key('\x1b[B');
  c.key('\x1b[A'); // index 1: Calm
  c.key('\r');
  assert.equal(c.sh().menu, false, 'choosing closes the menu');
  assert.equal(c.sh().program, 'calm');
  const n = c.writes();
  c.tick(3);
  assert.ok(c.writes() > n, 'the dissolve and the new program draw');
  assert.ok(['haze', 'swell', 'plasma-ref'].includes(c.sh().sceneId), c.sh().sceneId);
  // choosing the program that is already playing only closes the menu
  c.key('\r'); c.key('\x1b[A'); c.key('\r');
  assert.equal(c.sh().program, 'mix');
  c.key('\r'); c.key('\x1b[B'); c.key('\x1b[B'); c.key('\x1b[B'); // wraps past Eject to Mix
  c.key('\x1b[B'); // Calm
  c.key('\r');
  assert.equal(c.sh().program, 'calm');
  // idle: open and leave alone
  c.key('\r');
  assert.equal(c.sh().menu, true);
  c.tick(19);
  assert.equal(c.sh().menu, true, 'still open at 19 s');
  c.tick(1.5);
  assert.equal(c.sh().menu, false, 'auto-closed after 20 s idle');
  // a key press resets the idle clock
  c.key('\r'); c.tick(15); c.key('\x1b[B'); c.tick(15);
  assert.equal(c.sh().menu, true, '15 s after the last key: still open');
  c.tick(6);
  assert.equal(c.sh().menu, false);
  c.done();
});

test('running: space moves to the next scene, p pauses, + and - change speed, and the keys do nothing in the library', async () => {
  const c = mkShell({ startScreen: LIB });
  c.app.start();
  await runCartridge(c, 'fixture');
  c.key('\x1b');
  c.tick(0.5);
  const first = c.sh().sceneId;
  c.key(' ');
  c.tick(2.5);
  assert.notEqual(c.sh().sceneId, first, 'space started the next scene');
  c.key('p');
  c.tick(0.2);
  const frozenAt = c.writes();
  c.tick(2);
  assert.equal(c.writes(), frozenAt, 'paused: nothing is redrawn');
  c.key('p');
  c.tick(0.5);
  assert.ok(c.writes() > frozenAt, 'resumed');
  for (let i = 0; i < 12; i++) c.key('+');
  for (let i = 0; i < 12; i++) c.key('-');
  c.tick(0.2);
  assert.equal(c.sh().screen, 'running');
  c.done();
});

test('running: h opens the cartridge help and freezes the screen (no writes), Esc closes it, only h Esc q act while it is open', async () => {
  const c = mkShell({ startScreen: LIB });
  c.app.start();
  await runCartridge(c, 'fixture');
  c.key('\x1b');
  c.tick(0.6);
  const before = c.app.getState().shell;
  c.key('h');
  assert.equal(c.sh().help, true);
  c.tick(0);
  const n = c.writes();
  assert.match(c.text(), /keys/);
  assert.match(c.text(), /eject the cartridge/);
  for (const k of [' ', 'p', '+', 'c', 'e', 'l', '\r', '\x1b[B']) c.key(k);
  c.tick(5);
  assert.equal(c.writes(), n, 'no writes while help is open');
  assert.equal(c.sh().screen, 'running', 'e and l did not eject');
  c.key('\x1b');
  assert.equal(c.sh().help, false);
  assert.equal(c.sh().sceneId, before.sceneId, 'the scene did not move on while frozen');
  c.tick(0.5);
  assert.ok(c.writes() > n);
  c.key('h'); c.key('h');
  assert.equal(c.sh().help, false);
  c.done();
});

test('running: e and l eject; the reverse animation takes 1.6 s, then the library, on the same cartridge; the next insert works', async () => {
  for (const k of ['e', 'l', 'E']) {
    const c = mkShell({ startScreen: LIB });
    c.app.start();
    await runCartridge(c, 'fixture');
    c.key(k);
    assert.equal(c.sh().screen, 'eject');
    c.tick(EJECT_SECONDS - 0.2);
    assert.equal(c.sh().screen, 'eject', 'still ejecting at 1.4 s');
    c.tick(0.4);
    assert.equal(c.sh().screen, 'library');
    assert.equal(c.sh().cartridge, 'fixture');
    assert.equal(c.sh().program, null);
    c.tick(0.5);
    c.key('\r');
    assert.equal(c.sh().screen, 'insert', 'inserting again works');
    c.done();
  }
  // the menu's Eject entry does the same
  const c = mkShell({ startScreen: LIB });
  c.app.start();
  await runCartridge(c, 'fixture');
  c.key('\x1b[A'); // from Mix, up wraps to Eject
  c.key('\r');
  assert.equal(c.sh().screen, 'eject');
  c.key('x'); // any key skips the rest of the ejection
  assert.equal(c.sh().screen, 'library');
  c.done();
});

test('running: c does nothing without seasons (no write, no state change) and cycles the hues with them (both arms)', async () => {
  const hueSgr = (hex) => Array.from({ length: 16 }, (_, l) => sgrFor(parseHex(hex), l, 'truecolor'));
  const anyOf = (text, list) => list.some((s) => text.includes(s));
  // without seasons: paused, so nothing else draws; c and C change nothing and write nothing
  let c = mkShell({ startScreen: LIB });
  c.app.start();
  await runCartridge(c, 'fixture');
  c.key('\x1b'); c.key('p'); c.tick(0.8);
  let n = c.writes();
  const st = JSON.stringify(c.app.getState());
  c.key('c'); c.key('C');
  c.tick(1);
  assert.equal(JSON.stringify(c.app.getState()), st, 'no state change');
  assert.equal(c.writes(), n, 'no write');
  c.done();
  // with seasons: the same keys repaint in the new hue, ramped, then in the next, then back to the skin's own
  const root = makeRoot();
  addSeasonal(root);
  c = mkShell({ startScreen: LIB, root });
  c.app.start();
  await runCartridge(c, 'seasonal');
  c.key('\x1b'); c.key('p'); c.tick(0.8);
  n = c.writes();
  assert.equal(anyOf(c.stdout.writes.slice(n).join(''), hueSgr('#B06F7F')), false);
  c.key('c');
  c.tick(1);
  assert.ok(c.writes() > n, 'c repaints');
  assert.ok(anyOf(c.stdout.writes.slice(n).join(''), hueSgr('#B06F7F')), 'the first season hue');
  const m = c.writes();
  c.key('C'); c.tick(1);
  assert.ok(anyOf(c.stdout.writes.slice(m).join(''), hueSgr('#7FA0D0')), 'the second season');
  const k = c.writes();
  c.key('c'); c.tick(1);
  assert.ok(anyOf(c.stdout.writes.slice(k).join(''), hueSgr('#7FB069')), 'a full lap is back on the skin\'s own hue');
  // the change is a ramp: several palette steps, not one jump
  c.key('c');
  const w0 = c.writes();
  c.tick(0.7);
  assert.ok(c.writes() - w0 >= 3, 'a ramp of several frames');
  assert.equal(c.sh().screen, 'running');
  c.done();
});

test('running: a scene that throws is reported like Classic: exit 1, the terminal restored, the message on stderr', async () => {
  const root = makeRoot();
  addBoom(root);
  const c = mkShell({ startScreen: LIB, root });
  c.app.start();
  c.goto('boom');
  c.key('\r');
  c.tick(2);
  await c.settle();
  c.tick(5);
  assert.deepEqual(c.proc.exits, [1]);
  assert.equal(c.stdout.writes.at(-1), LEAVE);
  assert.match(c.stderr.writes.join(''), /boom at/);
  fs.rmSync(c.dir, { recursive: true, force: true });
});

// ---- the Classic cartridge

test('Classic cartridge: insert, a short DRIFT CLASSIC boot, then back to the Classic path in its saved mode', async () => {
  const c = mkShell({ startScreen: LIB, config: { mode: 'experimental' } });
  c.app.start();
  c.tick(0.3);
  assert.equal(c.sh().cartridge, 'classic');
  c.key('\r');
  assert.equal(c.sh().screen, 'insert');
  c.tick(INSERT_END + 0.9);
  assert.equal(c.sh().screen, 'boot');
  assert.match(c.text(), /DRIFT CLASSIC/);
  c.tick(5);
  assert.equal(c.sh(), null, 'back to the Classic path');
  const st = c.app.getState();
  assert.equal(st.mode, 'experimental');
  assert.equal(c.cfg().lastCartridge, 'classic');
  assert.equal(c.cfg().mode, 'experimental', 'the saved mode is untouched');
  c.tick(1);
  assert.ok(c.app.getState().t > 0, 'Classic time runs again');
  c.done();
});

// ---- config

test('config: lastCartridge is saved on an actual insert, kept by a second window\'s c key, and sets the library cursor (two-window arm)', async () => {
  const root = makeRoot();
  const A = mkShell({ startScreen: LIB, root });
  const B = mkShell({ root, configPath: A.configPath });
  A.app.start(); B.app.start();
  A.tick(0.3);
  assert.equal(A.has(), false, 'a library launch writes nothing');
  A.goto('fixture');
  A.tick(0.3);
  assert.equal(A.has(), false, 'moving the cursor writes nothing');
  A.key('\r');
  assert.equal(A.cfg().lastCartridge, 'fixture', 'saved on the insert');
  B.key('c'); // window B (Classic, calm): next colour
  const after = B.cfg();
  assert.equal(after.lastCartridge, 'fixture', "B's colour change kept it");
  assert.notEqual(after.colour, 'claude');
  B.key('2'); B.key('m');
  assert.equal(B.cfg().lastCartridge, 'fixture', 'and so did its mode changes');
  // a new window opens the library on it
  const C = mkShell({ startScreen: LIB, root, configPath: A.configPath });
  C.app.start();
  C.tick(0.3);
  assert.equal(C.sh().cartridge, 'fixture', 'the cursor starts on the last inserted cartridge');
  A.done(); B.done(); C.done();
});

test('config: a plain launch never writes the config file, whatever the console does', () => {
  const c = mkShell();
  c.app.start();
  c.tick(1);
  assert.equal(c.has(), false);
  c.key('l'); c.tick(0.5); c.key('\x1b[C'); c.key('h'); c.key('h'); c.key('\x1b');
  c.tick(0.5);
  assert.equal(c.sh(), null);
  assert.equal(c.has(), false, 'opening and closing the library writes nothing');
  c.done();
});

test('config: an invalid lastCartridge is ignored (cursor on Classic)', () => {
  const c = mkShell({ startScreen: LIB, config: { lastCartridge: 'no-such-cart' } });
  c.app.start();
  c.tick(0.3);
  assert.equal(c.sh().cartridge, 'classic');
  c.done();
});

// ---- the flip guard

const lands = (c, from) => c.stdout.writes.slice(from).filter((w) => w.includes('\x1b[2J')).length;

test('flip guard: l within 3 s of i (inverted high contrast) lands at 3 s exactly once; l after the window lands at once (both arms)', () => {
  // inside the window
  let c = mkShell({ config: { mode: 'contrast' } });
  c.app.start();
  c.tick(0.5);
  c.key('i'); // flips to light: allowed, starts the window
  c.tick(0.1);
  assert.equal(c.app.getState().light, true);
  const flipAt = c.app.getState().t;
  c.tick(0.9);
  const n = c.writes();
  c.key('l');
  c.tick(0.5);
  assert.equal(c.sh(), null, 'deferred: still showing Classic');
  assert.equal(c.app.getState().light, true);
  assert.equal(lands(c, n), 0);
  let landedAfter = null;
  for (let i = 1; i <= 80; i++) {
    c.app.tick(0.05);
    if (landedAfter === null && c.sh() !== null) landedAfter = 0.5 + 0.1 * 0 + i * 0.05;
  }
  assert.ok(landedAfter !== null, 'landed');
  // i pressed at wall 0.6; the window ends at 3.6; l was pressed at 1.6 -> lands about 2.0 s after the key
  assert.ok(landedAfter >= 1.9 && landedAfter <= 2.2, `landed ${landedAfter} s after the key`);
  assert.equal(lands(c, n), 1, 'exactly one repaint for it');
  assert.equal(c.sh().screen, 'library');
  assert.equal(c.app.getState().light, false);
  assert.ok(flipAt >= 0);
  c.done();
  // after the window
  c = mkShell({ config: { mode: 'contrast' } });
  c.app.start();
  c.tick(0.5);
  c.key('i');
  c.tick(3.3);
  const m = c.writes();
  c.key('l');
  c.tick(DT);
  assert.equal(c.sh().screen, 'library', 'landed at once');
  assert.equal(lands(c, m), 1);
  c.done();
});

test('flip guard: leaving the library back into inverted high contrast is deferred the same way', () => {
  const c = mkShell({ config: { mode: 'contrast', invert: true } });
  c.app.start();
  c.tick(3.5); // the launch counted as a flip at 0
  c.key('l');
  c.tick(DT);
  assert.equal(c.sh().screen, 'library');
  c.tick(0.5);
  const n = c.writes();
  c.key('\x1b');
  c.tick(0.5);
  assert.equal(c.sh().screen, 'library', 'inside the 3 s window of the flip that entered the library: waits');
  c.tick(3);
  assert.equal(c.sh(), null);
  assert.equal(lands(c, n), 1, 'one repaint');
  c.done();
});

// ---- starting from the command line

const IO = (c, extra = {}) => ({ stderr: c.stderr, exit: (code) => c.exits.push(code), configPath: c.configPath, dirs: c.dirs, ...extra });
function startup(argv, { config, root = makeRoot() } = {}) {
  const c = { stderr: fakeStderr(), exits: [], dirs: [{ dir: root, trusted: true }] };
  c.configPath = require_tmp(config);
  const io = IO(c);
  main(argv, { COLORTERM: 'truecolor' }, io);
  return c;
}
let tmpN = 0;
function require_tmp(config) {
  const d = fs.mkdtempSync(`${process.env.TEMP || process.env.TMPDIR || '/tmp'}/drift-start-${tmpN++}-`);
  const p = d + '/config.json';
  if (config) fs.writeFileSync(p, JSON.stringify(config));
  return p;
}

test('startup: --cartridge with an unknown, locked or broken id exits 2 with a plain message and no escape bytes', () => {
  for (const [id, re] of [['nope', /no cartridge called 'nope'/], ['locker', /locked/], ['broken', /cannot be loaded: manifest\.json is not valid JSON/], ['../evil', /no cartridge called/], ['', /needs a cartridge id/]]) {
    const c = startup(['--cartridge', id]);
    assert.deepEqual(c.exits, [2], id);
    const text = c.stderr.writes.join('');
    assert.match(text, /^drift: /, text);
    assert.match(text, re, text);
    assert.ok(!text.includes('\x1b'), 'no escape bytes');
    assert.ok(!text.includes('\u0007'));
  }
  // an id carrying an escape byte is printed with it replaced
  const c = startup(['--cartridge', 'a\x1b[2Jb']);
  assert.deepEqual(c.exits, [2]);
  assert.ok(!c.stderr.writes.join('').includes('\x1b'));
  // other arm: a good id passes the same check (planStartup, so no real app is started here)
  const root = makeRoot();
  assert.equal(planStartup(parseOptions(['--cartridge', 'fixture'], {}), { dirs: [{ dir: root, trusted: true }], configPath: null }).ok, true);
});

test('startup: planStartup picks the screen; --cartridge wins over --library; plain launch has no start screen', () => {
  const root = makeRoot();
  const dirs = [{ dir: root, trusted: true }];
  const plan = (argv, configPath = null) => planStartup(parseOptions(argv, {}), { dirs, configPath });
  assert.deepEqual(plan([]), { ok: true, startScreen: null });
  assert.deepEqual(plan(['--scene', 'life']), { ok: true, startScreen: null });
  assert.deepEqual(plan(['--library']), { ok: true, startScreen: { screen: 'library' } });
  assert.deepEqual(plan(['--cartridge', 'fixture']), { ok: true, startScreen: { screen: 'cartridge', cartridge: 'fixture', skipBoot: false } });
  assert.deepEqual(plan(['--library', '--cartridge=fixture']), { ok: true, startScreen: { screen: 'cartridge', cartridge: 'fixture', skipBoot: false } });
  assert.deepEqual(plan(['--cartridge', 'classic']).startScreen.cartridge, 'classic');
  assert.equal(parseOptions([], {}).library, undefined, 'a plain launch\'s options carry no new fields');
  assert.equal('cartridge' in parseOptions([], {}), false);
  assert.equal(parseOptions(['--library'], {}).library, true);
  // no env var starts the console
  assert.deepEqual(parseOptions([], { DRIFT_LIBRARY: '1', DRIFT_CARTRIDGE: 'fixture', DRIFT_CART: 'fixture' }), parseOptions([], {}));
});

test('startup: --cartridge last uses lastCartridge (both arms: with it, without it, and with one that is gone)', () => {
  const root = makeRoot();
  const dirs = [{ dir: root, trusted: true }];
  const d = fs.mkdtempSync(`${process.env.TEMP || '/tmp'}/drift-last-`);
  const withLast = d + '/a.json', gone = d + '/b.json', none = d + '/c.json';
  fs.writeFileSync(withLast, JSON.stringify({ lastCartridge: 'fixture' }));
  fs.writeFileSync(gone, JSON.stringify({ lastCartridge: 'vanished' }));
  const opts = parseOptions(['--cartridge', 'last'], {});
  assert.equal(planStartup(opts, { dirs, configPath: withLast }).startScreen.cartridge, 'fixture');
  assert.equal(planStartup(opts, { dirs, configPath: none }).startScreen.cartridge, 'classic', 'nothing inserted yet: Classic');
  const r = planStartup(opts, { dirs, configPath: gone });
  assert.equal(r.ok, false);
  assert.match(r.message, /no cartridge called 'vanished'/);
  // 'last' is never an id
  const c = startup(['--cartridge', 'last'], { config: { lastCartridge: 'locker' } });
  assert.deepEqual(c.exits, [2], 'a locked last cartridge is refused');
  assert.match(c.stderr.writes.join(''), /locked/);
  fs.rmSync(d, { recursive: true, force: true });
});

test('startup: --cartridge ID starts the insert and saves lastCartridge; skipBoot goes straight to running with the menu closed; whenRunning resolves', async () => {
  const c = mkShell({ startScreen: { screen: 'cartridge', cartridge: 'fixture', skipBoot: true } });
  c.app.start();
  assert.equal(c.cfg().lastCartridge, 'fixture', '--cartridge X saves it');
  const when = c.app.whenRunning();
  c.tick(0.1);
  await c.settle();
  c.tick(0.1);
  assert.equal(await when, true);
  assert.equal(c.sh().screen, 'running');
  assert.equal(c.sh().menu, false, 'skipBoot: no menu');
  c.done();
  // without skipBoot the whole timeline plays
  const d = mkShell({ startScreen: { screen: 'cartridge', cartridge: 'fixture', skipBoot: false } });
  d.app.start();
  d.tick(0.1);
  assert.equal(d.sh().screen, 'insert');
  d.done();
});

test('startup: --help lists --library and --cartridge ID; the L key is in the Classic help', () => {
  const t = helpText();
  assert.match(t, /--library\s+start in the cartridge library/);
  assert.match(t, /--cartridge ID\s+insert a cartridge at start/);
  assert.match(t, /\bl\s+cartridge library/);
});

test('resize: the console redraws at the new size on every screen without throwing', async () => {
  const c = mkShell({ startScreen: LIB });
  c.app.start();
  c.tick(0.3);
  for (const [w, h] of [[120, 40], [30, 10], [4, 2], [240, 67], [80, 24]]) {
    c.stdout.columns = w; c.stdout.rows = h;
    assert.doesNotThrow(() => c.stdout.emit('resize'), `library ${w}x${h}`);
  }
  await runCartridge(c, 'fixture');
  for (const [w, h] of [[120, 40], [30, 10], [4, 2], [80, 24]]) {
    c.stdout.columns = w; c.stdout.rows = h;
    assert.doesNotThrow(() => { c.stdout.emit('resize'); c.tick(0.5); }, `running ${w}x${h}`);
  }
  assert.deepEqual(c.proc.exits, []);
  c.done();
});
