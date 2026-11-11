// Shared harness for the Night Drive shell-edge tests (DRIFT-5): a real createApp on fake streams (tests/helpers-shell.js), the library ->
// insert -> boot -> running path with the tape deck open, and the readers the edge tests share. The clock is the fake one (app.tick); nothing
// sleeps. Key frame convention (tests/night-drive-flash.test.js section e): the first tick after a key press is measured apart from every
// other frame, because the console draws a key's effect (deck open or close, eject) in one step.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { INSTALL_DIR } from '../src/cartridge/loader.js';
import { mkShell, DT } from './helpers-shell.js';
import { changedFraction } from './helpers-flash.js';

export { DT };
export const FPS = 18;
export const dirs = [{ dir: INSTALL_DIR, trusted: true }];
const read = (f) => JSON.parse(fs.readFileSync(path.join(INSTALL_DIR, 'night-drive', f), 'utf8'));
export const MANIFEST = read('manifest.json');
export const SKIN = read('skin.json');
export const TAPE = MANIFEST.programs.find((p) => p.id === MANIFEST.start);
export const ORDER = TAPE.scenes;
export const MENU = MANIFEST.menu;
export const EJECT = MENU.findIndex((e) => e.action === 'eject');
export const holdOf = (id) => (TAPE.seconds && TAPE.seconds[id]) ?? TAPE.sceneSeconds;
export const nextScene = (id) => ORDER[(ORDER.indexOf(id) + 1) % ORDER.length];
export const titleOf = (id) => MANIFEST.scenes.find((s) => s.id === id).title;
export const UP = '\x1b[A', DOWN = '\x1b[B', ENTER = '\r', ESC = '\x1b', SPACE = ' ';
export const SIX = [[120, 40], [89, 40], [79, 25], [80, 24], [41, 11], [240, 67]];
export const HARD_CEILING = 0.4;
export const FLASH = 0.3;
export const pct = (x) => `${(x * 100).toFixed(1)}%`;

export async function boot(cols = 120, rows = 40) {
  const c = mkShell({ dirs, cols, rows, startScreen: { screen: 'library' } });
  c.app.start();
  c.tick(2);
  assert.ok(c.goto('night-drive'), 'the cursor reaches night-drive');
  await insert(c);
  return c;
}
// Enter on the cartridge in the library, then insert and boot until running with the deck open.
export async function insert(c) {
  c.key(ENTER);
  for (let k = 0; k < 18 * 30 && !(c.sh().screen === 'running' && c.sh().menu); k++) { c.tick(DT); if (k % 9 === 0) await c.settle(5); }
  assert.equal(c.sh().screen, 'running', 'the tape runs');
  assert.equal(c.sh().menu, true, 'the tape deck opens on arrival');
  c.tick(1);
}
// After an eject: the library again; the cursor goes back to the cartridge, Enter, and the same insert.
export async function reinsert(c) {
  assert.equal(c.sh().screen, 'library');
  assert.ok(c.goto('night-drive'));
  await insert(c);
}
export const grab = (c) => { const f = c.app.screenshot(); return { g: f.glyphs.slice(), s: f.shades.slice() }; };
export const same = (a, b) => changedFraction(a.g, b.g, a.s, b.s) === 0;
export const diff = (a, b) => changedFraction(a.g, b.g, a.s, b.s);

// A recorder: ticks one frame at a time, measures the share of cells that change from frame to frame, apart for key frames.
export function recorder(c) {
  let prev = grab(c), n = 0;
  const r = { nonKey: 0, nonKeyAt: 0, key: 0, keys: [], frames: 0 };
  r.reset = () => { r.nonKey = 0; r.nonKeyAt = 0; r.key = 0; r.keys = []; r.frames = 0; prev = grab(c); };
  r.sync = () => { prev = grab(c); };
  r.frame = async (isKey) => {
    c.tick(DT);
    if (++n % 9 === 0) await c.settle(5);
    const f = grab(c);
    const s = changedFraction(f.g, prev.g, f.s, prev.s);
    prev = f;
    if (isKey) { r.keys.push(s); if (s > r.key) r.key = s; } else { r.frames++; if (s > r.nonKey) { r.nonKey = s; r.nonKeyAt = r.frames; } }
    return s;
  };
  r.run = async (seconds) => { for (let k = 0, m = Math.round(seconds * FPS); k < m; k++) await r.frame(false); };
  r.press = async (k) => { c.key(k); return r.frame(true); };
  return r;
}

// The deck's cursor row: which MENU entry the arrow is on (-1 when the deck shows no arrow).
export function selectedIndex(c) {
  const line = c.text().split('\n').find((l) => l.includes('▶'));
  if (!line) return -1;
  const after = line.slice(line.indexOf('▶') + 1).trimStart();
  return MENU.findIndex((e) => (e.action === 'eject' ? after.includes('EJECT') : after.startsWith(e.label.slice(0, 2) + ' ')));
}
// The entries whose row carries the star (' *' after the label).
export function starredIndexes(c) {
  const out = [];
  for (const l of c.text().split('\n')) {
    if (!l.includes(' *')) continue;
    const row = l.replace(/^[^A-Z▲]*/, '');
    const i = MENU.findIndex((e) => e.scene && row.startsWith(e.label.slice(0, 2) + ' '));
    if (i >= 0) out.push(i);
  }
  return out;
}
// Opens the deck if it is closed (Enter) and walks the cursor to `idx` a key at a time, then Enter. With a recorder the frames are measured and the
// share of the Enter key frame is returned; without one it just ticks.
export async function pick(c, idx, r) {
  const press = async (k) => { if (r) return r.press(k); c.key(k); return 0; };
  const run = async (s) => { if (r) await r.run(s); else c.tick(s); };
  if (!c.sh().menu) { await press(ENTER); await run(0.4); }
  let v = selectedIndex(c);
  for (let k = 0; k < MENU.length + 1 && v !== idx; k++) {
    const down = (idx - v + MENU.length) % MENU.length <= MENU.length / 2;
    await press(down ? DOWN : UP); await run(DT * 2);
    v = selectedIndex(c);
  }
  assert.equal(v, idx, `the cursor reaches ${MENU[idx].label}`);
  const s = await press(ENTER);
  await run(DT * 2);
  return s;
}
export const until = (c, pred, maxSeconds) => { for (let t = 0; t < maxSeconds && !pred(); t += DT) c.tick(DT); return pred(); };
