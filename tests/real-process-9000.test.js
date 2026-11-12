// DRIFT-7 stage F, item 4: the Driftman 9000 in a REAL process (bin/drift.js on pipes, the test-only force-tty flag), the pattern of tests/real-process.test.js.
// Both arms for each quit path:
//   quits   (a) --library with the 9000 selected on the shelf, then q: the process exits 0 and the terminal sequences are restored
//           (b) --cartridge driftman-9000 up to its menu, then q: quit from inside the running cartridge, menu open with the countdown running
//           (b2) the same after Esc (a running Rosette, no menu), (b3) from a running Cortex, (b4) from a running Bloomfall, (b5) byte 0x03 from inside: 130
//   stays   (a2) a key that is not a quit key on the shelf leaves the process running (alive 1.5 s later, and the screen kept drawing is not needed there)
//           (b6) keys that are not quit keys in the running cartridge leave it running and drawing, then a q ends it
// The terminal is 120x40 (the test-only DRIFT_TEST_COLS/ROWS), where the menu is the grid. The menu's prompt is waited for by its text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  run, assertRestored, freshConfig, FORCE, RIGHT, ESC, ENTER_KEY, SHELF, sendKeys, alive, show, CFG_DIR,
} from './helpers-real-process.js';
import { readAnsi } from './helpers-ansi.js';

const SLOT = SHELF.indexOf('driftman-9000');
const PROMPT = 'Choose a vision'; // the menu's prompt row; the menu dissolves in cell by cell, so it is looked for on the screen the stream has drawn
const menuUp = (screen) => screen.includes(PROMPT) && screen.includes('starts by itself in');
const STEP = 1300; // a shelf step takes 1.2 s: leave that long between arrow keys

test('real process (9000 shelf): the 9000 is on the shelf, after Classic', () => {
  assert.ok(SLOT > 0, `driftman-9000 is on the shelf: ${SHELF.join(', ')}`);
});

// ---- the library, 9000 selected

test('real process (9000 a): --library, the 9000 selected on the shelf, then q: exit 0, terminal restored; with another cartridge selected the screen differs', async (t) => {
  const arms = [];
  for (const rights of [SLOT, 0]) {
    const cfg = freshConfig();
    const r = await run({
      args: ['--library'], env: { ...FORCE, ...cfg.env },
      drive: (c) => { for (let i = 0; i < rights; i++) setTimeout(() => c.stdin.write(RIGHT), i * STEP); setTimeout(() => c.stdin.write('q'), rights * STEP + 800); },
    });
    assertRestored(r, t, `(9000 a) ${rights} right arrows (${SHELF[rights]} selected)`);
    assert.equal(r.code, 0);
    const text = readAnsi(r.stdout, 120, 40).text(); // the last screen the process drew
    arms.push({ rights, id: SHELF[rights], has9000: /far future/.test(text) });
  }
  t.diagnostic('(9000 a) arms: ' + show(arms));
  assert.equal(arms[0].id, 'driftman-9000');
  assert.equal(arms[0].has9000, true, 'with the 9000 selected, its blurb is on screen');
  assert.equal(arms[1].has9000, false, 'with Classic selected, it is not');
});

test('real process (9000 a2): on the shelf with the 9000 selected, a key that is not a quit key leaves the process running; q then ends it with exit 0', async (t) => {
  const cfg = freshConfig();
  const seen = {};
  const r = await run({
    args: ['--library'], env: { ...FORCE, ...cfg.env },
    drive: (c) => {
      const keys = [];
      for (let i = 0; i < SLOT; i++) keys.push([i === 0 ? 0 : STEP, RIGHT]);
      keys.push([STEP, 'x'], [200, 'z'], [1500, 'q']); // two keys that do nothing, then, 1.5 s later, the quit
      sendKeys(c, keys, (child, i) => { if (i === keys.length - 1) seen.aliveBeforeQ = alive(child); });
    },
  });
  assertRestored(r, t, '(9000 a2) x z then q');
  assert.equal(seen.aliveBeforeQ, true, 'the process was still running 1.5 s after the non-quit keys');
  assert.equal(r.code, 0);
});

test('real process (9000 a3): on the shelf with the 9000 selected, byte 0x03: exit 130, terminal restored', async (t) => {
  const cfg = freshConfig();
  const r = await run({
    args: ['--library'], env: { ...FORCE, ...cfg.env },
    drive: (c) => { for (let i = 0; i < SLOT; i++) setTimeout(() => c.stdin.write(RIGHT), i * STEP); setTimeout(() => c.stdin.write(Buffer.from([0x03])), SLOT * STEP + 800); },
  });
  assertRestored(r, t, '(9000 a3) 0x03');
  assert.equal(r.code, 130);
});

// ---- inside the running cartridge

const RUN9000 = (keys, seen, extraEnv = {}, probe = null) => run({
  args: ['--cartridge', 'driftman-9000'], env: { ...FORCE, ...freshConfig().env, ...extraEnv }, waitFor: menuUp,
  drive: (c) => {
    seen.after = '';
    c.stdout.on('data', (d) => { seen.after += d.toString('utf8'); });
    sendKeys(c, keys, probe);
  },
});

test('real process (9000 b): --cartridge driftman-9000 to its menu (countdown running), then q from inside the running cartridge: exit 0', async (t) => {
  const seen = {};
  const r = await RUN9000([[300, 'q']], seen);
  assertRestored(r, t, '(9000 b) q at the menu');
  assert.equal(r.code, 0);
  const last = readAnsi(r.stdout, 120, 40).text();
  assert.ok(menuUp(last), 'the menu and its countdown were on the screen when the q came');
});

test('real process (9000 b2): Esc closes the menu on the running Rosette, a second later q: exit 0, and the scene kept drawing in between', async (t) => {
  const seen = {};
  const r = await RUN9000([[0, ESC], [1500, 'q']], seen);
  assertRestored(r, t, '(9000 b2) Esc then q');
  assert.equal(r.code, 0);
  assert.ok(seen.after.length > 20000, `the Rosette ran after the Esc: ${seen.after.length} bytes drawn`);
});

test('real process (9000 b3): choose Cortex from the menu (right, Enter), let it run 3 s, then q: exit 0', async (t) => {
  const seen = {};
  const r = await RUN9000([[0, RIGHT], [300, ENTER_KEY], [3000, 'q']], seen);
  assertRestored(r, t, '(9000 b3) Cortex then q');
  assert.equal(r.code, 0);
  assert.ok(seen.after.length > 5000, `Cortex ran after the pick: ${seen.after.length} bytes drawn`);
});

test('real process (9000 b4): choose Bloomfall from the menu (right, right, Enter), let it run 3 s, then q: exit 0', async (t) => {
  const seen = {};
  const r = await RUN9000([[0, RIGHT], [200, RIGHT], [300, ENTER_KEY], [3000, 'q']], seen);
  assertRestored(r, t, '(9000 b4) Bloomfall then q');
  assert.equal(r.code, 0);
  assert.ok(seen.after.length > 20000, `Bloomfall ran after the pick: ${seen.after.length} bytes drawn`);
});

test('real process (9000 b5): byte 0x03 from inside the running Rosette: exit 130, terminal restored', async (t) => {
  const seen = {};
  const r = await RUN9000([[0, ESC], [1000, Buffer.from([0x03])]], seen);
  assertRestored(r, t, '(9000 b5) 0x03');
  assert.equal(r.code, 130);
});

test('real process (9000 b6): inside the running cartridge keys that are not quit keys (x, z, Esc) leave the process running and drawing; only then q ends it with exit 0', async (t) => {
  const seen = {}, marks = {};
  const r = await RUN9000([[0, 'x'], [200, 'z'], [200, ESC], [2000, 'q']], seen, {}, (child, i) => {
    if (i === 3) { marks.aliveBeforeQ = alive(child); marks.drawnBeforeQ = seen.after.length; }
  });
  assertRestored(r, t, '(9000 b6) x z Esc then q');
  assert.equal(marks.aliveBeforeQ, true, 'still running 2 s after the non-quit keys');
  assert.ok(marks.drawnBeforeQ > 20000, `and still drawing: ${marks.drawnBeforeQ} bytes since the first key`);
  assert.equal(r.code, 0);
});

test.after(() => fs.rmSync(CFG_DIR, { recursive: true, force: true }));
