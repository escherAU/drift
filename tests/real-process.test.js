import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENTER, LEAVE } from '../src/term.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'drift.js');
const CFG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-rp-'));
const TIMEOUT_MS = 10000;

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Spawn bin/drift.js; `drive(child, out)` is called once the first frame has
// been seen (or after 1.5 s) so it can send input. Always killed on timeout.
function run({ env = {}, drive, waitForFrame = true }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN], {
      env: { ...process.env, DRIFT_CONFIG: path.join(CFG_DIR, 'config.json'), DRIFT_TEST_COLS: '60', DRIFT_TEST_ROWS: '20', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const chunks = [], errChunks = [];
    let timedOut = false, driven = false;
    const doDrive = () => { if (!driven) { driven = true; if (drive) drive(child); } };
    child.stdout.on('data', (d) => {
      chunks.push(d);
      if (waitForFrame && Buffer.concat(chunks).toString('utf8').includes('\x1b[2J')) doDrive();
    });
    child.stderr.on('data', (d) => errChunks.push(d));
    child.stdin.on('error', () => {});
    const kick = setTimeout(doDrive, 1500);
    const killer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(kick); clearTimeout(killer);
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

test.after(() => fs.rmSync(CFG_DIR, { recursive: true, force: true }));
