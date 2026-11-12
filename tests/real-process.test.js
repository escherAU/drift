import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENTER, LEAVE } from '../src/term.js';
import { INSERT_END } from '../src/shell/insert.js';
import { bootPhases } from '../src/shell/boot.js';
import { classicBootSkin } from '../src/shell/driftman.js';
import { discoverCartridges } from '../src/cartridge/loader.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'drift.js');
const CFG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-rp-'));
const TIMEOUT_MS = 10000;

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Spawn bin/drift.js; `drive(child, out)` is called once the first frame has
// been seen (or after 1.5 s) so it can send input. Always killed on timeout.
// Optional: `waitFor` (a string) holds the drive back until that text has been written to stdout (no 1.5 s kick; if
// it never shows, the kill timer fires and the arm fails as timedOut), and `timeoutMs` raises the kill timer for a
// cartridge boot (5.8 s) that the default 10 s cap would squeeze.
function run({ env = {}, drive, waitForFrame = true, args = [], timeoutMs = TIMEOUT_MS, waitFor = null }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, DRIFT_CONFIG: path.join(CFG_DIR, 'config.json'), DRIFT_TEST_COLS: '60', DRIFT_TEST_ROWS: '20', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const chunks = [], errChunks = [];
    let timedOut = false, driven = false;
    const doDrive = () => { if (!driven) { driven = true; if (drive) drive(child); } };
    child.stdout.on('data', (d) => {
      chunks.push(d);
      if (waitFor !== null) { if (Buffer.concat(chunks).toString('utf8').includes(waitFor)) doDrive(); }
      else if (waitForFrame && Buffer.concat(chunks).toString('utf8').includes('\x1b[2J')) doDrive();
    });
    child.stderr.on('data', (d) => errChunks.push(d));
    child.stdin.on('error', () => {});
    const kick = waitFor !== null ? null : setTimeout(doDrive, 1500);
    const killer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code) => {
      if (kick) clearTimeout(kick);
      clearTimeout(killer);
      resolve({
        code, timedOut, pid: child.pid, gone: !pidAlive(child.pid),
        stdout: Buffer.concat(chunks).toString('utf8'), stderr: Buffer.concat(errChunks).toString('utf8'),
      });
    });
  });
}

const show = (s) => JSON.stringify(s);
function assertRestored(r, t, label) {
  assert.equal(r.timedOut, false, 'child must exit on its own');
  assert.equal(r.gone, true, 'child pid must be gone');
  assert.ok(r.stdout.startsWith(ENTER), `begins with enter sequences: ${show(r.stdout.slice(0, 40))}`);
  assert.ok(r.stdout.endsWith(LEAVE), `ends with exact leave sequences: ${show(r.stdout.slice(-40))}`);
  assert.ok(r.stdout.startsWith('\x1b[?1049h\x1b[?25l'));
  assert.ok(r.stdout.endsWith('\x1b[?25h\x1b[?1049l\x1b[0m'));
  assert.equal(r.stdout.split('\x1b[?1049l').length - 1, 1, 'leaves the alt screen exactly once');
  t.diagnostic(`${label} head: ${show(r.stdout.slice(0, 48))}`);
  t.diagnostic(`${label} tail: ${show(r.stdout.slice(-48))}`);
  t.diagnostic(`${label} exit code ${r.code}, pid ${r.pid} gone=${r.gone}, bytes ${r.stdout.length}`);
}

const FORCE = { DRIFT_TEST_FORCE_TTY: '1', COLORTERM: 'truecolor' };

test('real process (a): q on stdin restores the terminal, exit 0', async (t) => {
  const r = await run({ env: FORCE, drive: (c) => c.stdin.write('q') });
  assertRestored(r, t, '(a) q');
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('\x1b[2J'), 'drew at least one frame');
});

test('real process (b): byte 0x03 on stdin restores the terminal', async (t) => {
  const r = await run({ env: FORCE, drive: (c) => c.stdin.write(Buffer.from([0x03])) });
  assertRestored(r, t, '(b) 0x03');
  assert.equal(r.code, 130);
});

test('real process (c): a thrown error restores the terminal and exits non-zero', async (t) => {
  const r = await run({ env: { ...FORCE, DRIFT_TEST_THROW_AFTER_MS: '400' }, waitForFrame: false });
  assertRestored(r, t, '(c) throw');
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /DRIFT_TEST_THROW/);
});

test('real process (d) negative control: no force flag + piped stdin = no alt screen, exit 0, message', async (t) => {
  const r = await run({ env: { DRIFT_TEST_FORCE_TTY: '' }, waitForFrame: false });
  assert.equal(r.timedOut, false);
  assert.equal(r.gone, true);
  assert.equal(r.code, 0);
  assert.ok(!r.stdout.includes('\x1b'), `no escape sequences: ${show(r.stdout)}`);
  assert.match(r.stdout, /terminal/i);
  t.diagnostic(`(d) stdout: ${show(r.stdout)}`);
});

test('real process: the force flag is inert unless set to 1', async () => {
  const r = await run({ env: { DRIFT_TEST_FORCE_TTY: '0' }, waitForFrame: false });
  assert.ok(!r.stdout.includes('\x1b[?1049h'));
  assert.equal(r.code, 0);
});

// ---- the cartridge library and cartridge starts (DRIFT-4). Every arm goes through assertRestored
// (the --cartridge nope arm never enters the alt screen, so it checks for no escape bytes instead).
// The running-code-cartridge arm waits for slice 3 (a real code cartridge).

test('real process (library a): --library then q restores the terminal, exit 0', async (t) => {
  const r = await run({ args: ['--library'], env: FORCE, drive: (c) => c.stdin.write('q') });
  assertRestored(r, t, '(lib a) q');
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('\x1b[2J'), 'drew the library');
});

test('real process (library b): --library then byte 0x03 restores the terminal, exit 130', async (t) => {
  const r = await run({ args: ['--library'], env: FORCE, drive: (c) => c.stdin.write(Buffer.from([0x03])) });
  assertRestored(r, t, '(lib b) 0x03');
  assert.equal(r.code, 130);
});

test('real process (library c): --library, Enter, then q within 300 ms (mid-insert) restores the terminal, exit 0', async (t) => {
  const r = await run({
    args: ['--library'], env: FORCE,
    drive: (c) => { c.stdin.write('\r'); setTimeout(() => c.stdin.write('q'), 250); },
  });
  assertRestored(r, t, '(lib c) mid-insert');
  assert.equal(r.code, 0);
});

test('real process (cartridge a): --cartridge classic then q during the insert animation: exit 0', async (t) => {
  const r = await run({ args: ['--cartridge', 'classic'], env: FORCE, drive: (c) => setTimeout(() => c.stdin.write('q'), 500) });
  assertRestored(r, t, '(cart a) insert');
  assert.equal(r.code, 0);
});

test('real process (cartridge b): --cartridge classic then q during the boot screen: exit 0', async (t) => {
  // the middle of the boot, counted from the first frame: the insert animation, then half the boot
  const ms = Math.round((INSERT_END + bootPhases(classicBootSkin).end / 2) * 1000);
  const r = await run({ args: ['--cartridge', 'classic'], env: FORCE, drive: (c) => setTimeout(() => c.stdin.write('q'), ms) });
  assertRestored(r, t, '(cart b) boot');
  assert.equal(r.code, 0);
});

test('real process (cartridge c): --cartridge with a thrown error restores the terminal and exits non-zero', async (t) => {
  const r = await run({ args: ['--cartridge', 'classic'], env: { ...FORCE, DRIFT_TEST_THROW_AFTER_MS: '400' }, waitForFrame: false });
  assertRestored(r, t, '(cart c) throw');
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /DRIFT_TEST_THROW/);
});

test('real process (cartridge d): --cartridge nope exits 2 with a plain "drift:" message and no escape byte on either stream', async (t) => {
  const r = await run({ args: ['--cartridge', 'nope'], env: FORCE, waitForFrame: false });
  assert.equal(r.timedOut, false);
  assert.equal(r.gone, true);
  assert.equal(r.code, 2);
  assert.ok(r.stderr.startsWith('drift:'), show(r.stderr));
  assert.ok(!r.stderr.includes('\x1b'), 'no ESC byte on stderr');
  assert.ok(!r.stdout.includes('\x1b'), 'no ESC byte on stdout');
  t.diagnostic('(cart d) stderr: ' + show(r.stderr) + ' stdout: ' + show(r.stdout));
});

// ---- Delza, the first real code cartridge (DRIFT-4 part C). Each arm has its own config folder so the library
// cursor starts on Classic whatever an earlier arm inserted. The Journal menu is waited for by its first entry
// (it shows at about 6 s: the insert is 1.5 s, the boot runs to 5.8 s); the kill timer is 20 s.
// Quitting from the library itself is (library a) above; quitting from inside the running cartridge is (delza a).
const DELZA_TIMEOUT = 20000;
const freshConfig = () => {
  const dir = fs.mkdtempSync(path.join(CFG_DIR, 'cfg-'));
  return { file: path.join(dir, 'config.json'), env: { DRIFT_CONFIG: path.join(dir, 'config.json') } };
};

test('real process (delza a): --cartridge delza boots to the Journal menu, then q from inside the cartridge: exit 0', async (t) => {
  const cfg = freshConfig();
  const r = await run({ args: ['--cartridge', 'delza'], env: { ...FORCE, ...cfg.env }, waitFor: 'THORNWELL', timeoutMs: DELZA_TIMEOUT, drive: (c) => c.stdin.write('q') });
  assertRestored(r, t, '(delza a) q');
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('THORNWELL'), 'the Journal menu was drawn before the q');
});

test('real process (delza b): --cartridge delza then byte 0x03 from inside the running cartridge: exit 130', async (t) => {
  const cfg = freshConfig();
  const r = await run({ args: ['--cartridge', 'delza'], env: { ...FORCE, ...cfg.env }, waitFor: 'THORNWELL', timeoutMs: DELZA_TIMEOUT, drive: (c) => c.stdin.write(Buffer.from([0x03])) });
  assertRestored(r, t, '(delza b) 0x03');
  assert.equal(r.code, 130);
});

test('real process (delza c): --library, right arrow twice to Delza, Enter, then q mid-insert: exit 0, Delza was the one inserted', async (t) => {
  const cfg = freshConfig();
  const r = await run({
    args: ['--library'], env: { ...FORCE, ...cfg.env }, timeoutMs: DELZA_TIMEOUT,
    drive: (c) => {
      // the shelf is Classic, Arcade, Delza: the second key comes 0.6 s after the first, while the shelf is still scrubbing (DRIFT-7 item 2b); Enter inserts the cursor's cartridge
      c.stdin.write('\x1b[C');
      setTimeout(() => c.stdin.write('\x1b[C'), 600);
      setTimeout(() => c.stdin.write('\r'), 1300);
      setTimeout(() => c.stdin.write('q'), 1650); // 350 ms into the 1.5 s insert
    },
  });
  assertRestored(r, t, '(delza c) mid-insert');
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(fs.readFileSync(cfg.file, 'utf8')).lastCartridge, 'delza', 'the Enter inserted Delza, not another cartridge');
});

test('real process (delza d): --cartridge delza with a thrown error after the Journal menu is up restores the terminal and exits non-zero', async (t) => {
  const cfg = freshConfig();
  const r = await run({ args: ['--cartridge', 'delza'], env: { ...FORCE, ...cfg.env, DRIFT_TEST_THROW_AFTER_MS: '7000' }, waitForFrame: false, timeoutMs: DELZA_TIMEOUT });
  assertRestored(r, t, '(delza d) throw');
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /DRIFT_TEST_THROW/);
  assert.ok(r.stdout.includes('THORNWELL'), 'the throw came after the Journal menu was drawn (a running cartridge, not the insert)');
});

// ---- Night Drive, the second real code cartridge (DRIFT-5). The tape deck menu shows at about 6 s (the insert is 1.5 s,
// the boot 5.8 s): it is waited for by its prompt, 'Pick a track'. Enter then plays the first track; the running scene
// prints no words, so "it is running" is shown by the bytes it draws after the Enter (and the deck's first row not being among them).
// Quitting from the library is (library a); here the cartridge is selected on the shelf, and then quitting happens from
// inside it: while it plays, with the deck open over it, and after a track picked from the deck.
const NIGHT_BLURB = JSON.parse(fs.readFileSync(path.join(path.dirname(BIN), '..', 'cartridges', 'night-drive', 'manifest.json'), 'utf8')).blurb;
const NIGHT_PROMPT = 'MIDNIGHT'; // the first row of the tape deck (A1 MIDNIGHT ON-RAMP), written in one piece
// the shelf is the cartridge folders, Classic first, the rest by name (as src/app.js builds it)
const SHELF = discoverCartridges({ dirs: [{ dir: path.join(path.dirname(BIN), '..', 'cartridges'), trusted: true }] }).cartridges
  .map((c) => c.id).sort((a, b) => (a === 'classic' ? -1 : b === 'classic' ? 1 : 0));
const NIGHT_SLOT = SHELF.indexOf('night-drive');
const PLAIN = /\x1b\[[0-9;?]*[A-Za-z]/g; // an escape sequence, to read the screen text without them
const RIGHT = '\x1b[C', DOWN = '\x1b[B';

// send `keys` (a list of [delay ms after the previous key, bytes]) after the deck is up; collects what is drawn after
// the first key into `seen.after`
function afterDeck(keys, seen) {
  return (c) => {
    seen.after = '';
    let at = 0;
    keys.forEach(([delay, bytes], i) => {
      at += delay;
      setTimeout(() => {
        if (i === 0) c.stdout.on('data', (d) => { seen.after += d.toString('utf8'); });
        c.stdin.write(bytes);
      }, at);
    });
  };
}
const NIGHT_RUN = (keys, seen, extraEnv = {}) => run({ args: ['--cartridge', 'night-drive'], env: { ...FORCE, ...freshConfig().env, ...extraEnv }, waitFor: NIGHT_PROMPT, timeoutMs: DELZA_TIMEOUT, drive: afterDeck(keys, seen) });

test('real process (night-drive a): --library, Night Drive selected on the shelf, then q: exit 0; the other arms (not selected) also exit 0 and the output differs', async (t) => {
  assert.ok(NIGHT_SLOT > 0, `Night Drive is on the shelf: ${SHELF.join(', ')}`);
  const arms = [];
  for (const rights of [NIGHT_SLOT, 0, 2]) {
    const cfg = freshConfig();
    const r = await run({
      args: ['--library'], env: { ...FORCE, ...cfg.env }, timeoutMs: DELZA_TIMEOUT,
      drive: (c) => {
        // a key every 0.6 s: every press registers at once and the shelf scrubs (DRIFT-7 item 2b)
        for (let i = 0; i < rights; i++) setTimeout(() => c.stdin.write(RIGHT), i * 600);
        setTimeout(() => c.stdin.write('q'), rights * 600 + 700);
      },
    });
    assertRestored(r, t, `(night-drive a) ${rights} right arrows (${SHELF[rights]} selected)`);
    assert.equal(r.code, 0);
    arms.push({ rights, id: SHELF[rights], hasBlurb: r.stdout.replace(PLAIN, '').includes(NIGHT_BLURB.slice(0, 12)) });
  }
  t.diagnostic('(night-drive a) arms: ' + show(arms));
  assert.equal(arms[0].id, 'night-drive');
  assert.equal(arms[0].hasBlurb, true, 'with Night Drive selected, its blurb is on screen');
  assert.equal(arms[1].hasBlurb, false, 'with the first cartridge selected, Night Drive\'s blurb is not (the arms differ)');
  assert.equal(arms[2].hasBlurb, false, 'with another cartridge selected, Night Drive\'s blurb is not');
});

test('real process (night-drive b): --cartridge night-drive plays, then q from inside the running tape: exit 0', async (t) => {
  const seen = {};
  const r = await NIGHT_RUN([[0, '\r'], [2000, 'q']], seen);
  assertRestored(r, t, '(night-drive b) q');
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes(NIGHT_PROMPT), 'the tape deck was drawn before the Enter');
  assert.ok(seen.after.length > 1000 && !seen.after.includes('▶'), `the tape ran after the Enter: ${seen.after.length} bytes drawn`);
});

test('real process (night-drive b2): --cartridge night-drive playing, then byte 0x03 from inside the running tape: same exit code as Delza (130)', async (t) => {
  const seen = {};
  const r = await NIGHT_RUN([[0, '\r'], [2000, Buffer.from([0x03])]], seen);
  assertRestored(r, t, '(night-drive b2) 0x03');
  assert.equal(r.code, 130);
  assert.ok(seen.after.length > 1000, `the tape ran after the Enter: ${seen.after.length} bytes drawn`);
});

test('real process (night-drive b3): q while the tape deck is open over the running scene: exit 0', async (t) => {
  const seen = {};
  const r = await NIGHT_RUN([[0, '\r'], [1500, '\r'], [900, 'q']], seen); // play, open the deck over the scene, quit
  assertRestored(r, t, '(night-drive b3) q with the deck open');
  assert.equal(r.code, 0);
  assert.ok(seen.after.includes('▶') && seen.after.includes('┏'), 'the deck (its cursor and box) was drawn again over the running scene before the q');
});

test('real process (night-drive b4): pick track B2 from the deck (Enter, down arrows, Enter), then q: exit 0', async (t) => {
  const seen = {};
  // play A1, open the deck (its cursor starts on the next track, A2), four downs to B2, Enter, run a moment, quit
  const keys = [[0, '\r'], [1500, '\r'], [900, DOWN], [200, DOWN], [200, DOWN], [200, DOWN], [600, '\r'], [2500, 'q']];
  const r = await NIGHT_RUN(keys, seen);
  assertRestored(r, t, '(night-drive b4) B2 then q');
  assert.equal(r.code, 0);
  assert.ok(seen.after.length > 5000, `the tape kept drawing through the pick: ${seen.after.length} bytes`);
});

test.after(() => fs.rmSync(CFG_DIR, { recursive: true, force: true }));
