// Real-process harness for the Driftman 9000 arms (DRIFT-7 stage F): the same pattern as tests/real-process.test.js (spawn bin/drift.js on pipes with the
// test-only force-tty flag, wait for text on stdout, send keys, check the terminal was restored and the exit code), kept in a helper so the 9000's arms live
// in their own file and run beside it. `run` also takes `drive`'s child so an arm can look at whether the process is still alive when a key should not quit.
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ENTER, LEAVE } from '../src/term.js';
import { StringDecoder } from 'node:string_decoder';
import { discoverCartridges } from '../src/cartridge/loader.js';
import { createScreen } from './helpers-ansi.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = path.join(ROOT, 'bin', 'drift.js');
export const CFG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-rp9-'));
export const TIMEOUT_MS = 25000;
export const FORCE = { DRIFT_TEST_FORCE_TTY: '1', COLORTERM: 'truecolor' };
export const RIGHT = '\x1b[C', ESC = '\x1b', ENTER_KEY = '\r';
export const PLAIN = /\x1b\[[0-9;?]*[A-Za-z]/g; // an escape sequence, to read the screen text without them
export const show = (s) => JSON.stringify(s);

export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// A fresh config folder per arm, so the library cursor starts on the first cartridge whatever an earlier arm inserted.
export function freshConfig() {
  const dir = fs.mkdtempSync(path.join(CFG_DIR, 'cfg-'));
  return { file: path.join(dir, 'config.json'), env: { DRIFT_CONFIG: path.join(dir, 'config.json') } };
}

// Spawn bin/drift.js. `waitFor` holds the drive back until that string is in stdout, or, when it is a function, until it returns true for the text of the
// screen the stream has drawn so far (read by helpers-ansi.js: the renderer writes only the cells that changed, so a menu that dissolves in arrives in
// pieces and its words are never in the stream as one run); otherwise it is driven at the first full repaint. Killed on the timer (the arm then reports timedOut). `drive(child)` sends the input.
export function run({ env = {}, drive, args = [], timeoutMs = TIMEOUT_MS, waitFor = null }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, DRIFT_CONFIG: path.join(CFG_DIR, 'config.json'), DRIFT_TEST_COLS: '120', DRIFT_TEST_ROWS: '40', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const chunks = [], errChunks = [];
    const cols = Number(env.DRIFT_TEST_COLS || 120), rows = Number(env.DRIFT_TEST_ROWS || 40);
    const screen = typeof waitFor === 'function' ? createScreen(cols, rows) : null, decoder = new StringDecoder('utf8');
    let timedOut = false, driven = false;
    const doDrive = () => { if (!driven) { driven = true; if (drive) drive(child); } };
    child.stdout.on('data', (d) => {
      chunks.push(d);
      if (screen) { screen.feed(decoder.write(d)); if (waitFor(screen.text())) doDrive(); } else if (waitFor !== null) { if (Buffer.concat(chunks).toString('utf8').includes(waitFor)) doDrive(); }
      else if (Buffer.concat(chunks).toString('utf8').includes('\x1b[2J')) doDrive();
    });
    child.stderr.on('data', (d) => errChunks.push(d));
    child.stdin.on('error', () => {});
    const killer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(killer);
      resolve({
        code, timedOut, pid: child.pid, gone: !pidAlive(child.pid),
        stdout: Buffer.concat(chunks).toString('utf8'), stderr: Buffer.concat(errChunks).toString('utf8'),
      });
    });
  });
}

// The terminal came back: the process left on its own, is gone, entered the alt screen with the cursor hidden, and left it once, showing the cursor again.
export function assertRestored(r, t, label) {
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

// The shelf order the app builds: Classic first, the rest as the loader lists them.
export const SHELF = discoverCartridges({ dirs: [{ dir: path.join(ROOT, 'cartridges'), trusted: true }] }).cartridges
  .map((c) => c.id).sort((a, b) => (a === 'classic' ? -1 : b === 'classic' ? 1 : 0));

// Send `keys`, a list of [delay ms after the previous key, bytes]. `probe(child, i)` runs just before key i is written (to look at the live process).
export function sendKeys(child, keys, probe = null) {
  let at = 0;
  keys.forEach(([delay, bytes], i) => {
    at += delay;
    setTimeout(() => { if (probe) probe(child, i); child.stdin.write(bytes); }, at);
  });
}
export const alive = (child) => child.exitCode === null && child.signalCode === null;
