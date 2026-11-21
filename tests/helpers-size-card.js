// DRIFT-12 part A: the harness for Classic's "make the window bigger" card. It drives createApp itself (a fake terminal, the app's own loop on a clock from
// tests/helpers-clock.js or one app.tick per frame), reads the bytes the renderer writes back through the independent terminal reader (tests/helpers-ansi.js)
// and can resize the fake terminal the way a window drag does: set columns and rows, emit 'resize', and read what follows on a FRESH reader of the new size
// (a resize repaints with a clear, src/renderer.js).
//
// What the card must be is written out HERE, independently of src/: the words, the greedy wrap and the centring are the shell's card (src/shell/ui.js drawTooSmall)
// restated by hand, so a change in the source cannot move the expectation with it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp as realCreateApp } from '../src/app.js';
import { createScreen, COLOUR_256 } from './helpers-ansi.js';
import { createClock } from './helpers-clock.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';

export const MIN_COLS = 40, MIN_ROWS = 10;
export const CARD_WORDS = 'Make the window bigger to see drift.';
export const MODES = ['calm', 'chaos', 'contrast', 'experimental'];
export const CMODES = ['256', 'truecolor'];

// the greedy wrap of the shell's card: words joined by one space while they fit, a word longer than the width cut into pieces of the width
export function wrapCard(text, width) {
  const w = Math.max(1, width | 0);
  const lines = [];
  let cur = '';
  for (let word of text.split(' ').filter(Boolean)) {
    while (word.length > w) {
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(word.slice(0, w));
      word = word.slice(w);
    }
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= w) cur += ' ' + word;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// the screen the card makes at cols x rows, as rows of text (blank cells are spaces): centred, vertically centred on the rows it needs, cut at the edges
export function expectedCardRows(cols, rows) {
  const lines = wrapCard(CARD_WORDS, cols);
  const y0 = Math.max(0, Math.floor((rows - lines.length) / 2));
  const out = Array.from({ length: rows }, () => ' '.repeat(cols));
  lines.forEach((line, k) => {
    const y = y0 + k;
    if (y >= rows) return;
    const x0 = Math.max(0, Math.floor((cols - line.length) / 2));
    out[y] = (' '.repeat(x0) + line + ' '.repeat(cols)).slice(0, cols);
  });
  return out;
}
// The renderer never draws the bottom-right cell of the screen (it would scroll the terminal, src/renderer.js), so a card whose last letter lands there shows without it:
// the expectation blanks that cell, as it does for the art.
export function expectedCardText(cols, rows) {
  const r = expectedCardRows(cols, rows);
  if (cols > 0 && rows > 0) r[rows - 1] = r[rows - 1].slice(0, cols - 1) + ' ';
  return r.join('\n');
}
export const isCardSize = (cols, rows) => cols < MIN_COLS || rows < MIN_ROWS;

// the colours of the two tones the reader sees in high contrast (the renderer's own SGR for the two-tone palette)
export function twoToneOf(cmode, inverted) {
  const white = cmode === 'truecolor' ? 0xffffff : COLOUR_256 | 231, black = cmode === 'truecolor' ? 0x000000 : COLOUR_256 | 16;
  return inverted ? { fg: black, bg: white } : { fg: white, bg: black };
}
// every (fg, bg) pair the screen shows (but the bottom-right cell, which is never drawn), as a Set of "fg/bg" strings
export function colourPairs(screen) {
  const s = new Set();
  for (let i = 0; i < screen.glyphs.length - 1; i++) s.add(`${screen.fg[i]}/${screen.bg[i]}`);
  return s;
}

// A running app on a fake terminal.
//   startMode: 'calm' | 'chaos' | 'contrast' | 'experimental'; cmode: '256' | 'truecolor'; invert: start in inverted high contrast
//   clock: 'tick' (one app.tick per frame, the default) or 'grid' | 'q156' | 'jitter' (the app's own loop on that clock)
//   root: a copy of the tree to run instead of this one (the mutants); playlists: injected scene lists (the cost and held pins)
export async function startCard({
  cols = 80, rows = 24, startMode = 'calm', cmode = '256', seed = 1, invert = false, clock = 'tick', clockSeed = 1, fps = 18,
  sceneSeconds = 180, root = null, playlists = null, startScene = 0, reported = null,
} = {}) {
  const createApp = root ? (await import(pathToFileURL(path.join(root, 'src', 'app.js')).href)).createApp : realCreateApp;
  const useClock = clock && clock !== 'tick';
  const c = useClock ? createClock({ mode: clock, seed: clockSeed }) : null;
  const stdout = fakeStdout({ columns: reported ? reported.cols : cols, rows: reported ? reported.rows : rows });
  const stdin = fakeStdin(), stderr = fakeStderr(), proc = fakeProc();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-size-card-'));
  const cfg = path.join(tmp, 'config.json');
  if (invert) fs.writeFileSync(cfg, JSON.stringify({ invert: true }));
  const env = cmode === 'truecolor' ? { COLORTERM: 'truecolor' } : {};
  const app = createApp({
    stdin, stdout, stderr, proc, env, configPath: cfg, dirs: [], startMode, startScene, sceneSeconds, seed, fps,
    ...(playlists ? { playlists, scenes: playlists.calm } : {}),
    autoLoop: useClock, now: c ? c.now : undefined, timer: c ? c.timer : undefined,
  });
  let screen = createScreen(cols, rows);
  let size = { cols, rows };
  const writesAll = [];
  const feed = () => { for (const w of stdout.writes.splice(0)) { writesAll.push(w); screen.feed(w); } };
  app.start();
  feed();
  const h = {
    app, stdout, stdin, proc, clock: c, fps, get size() { return size; },
    get screen() { return screen; },
    writesAll,
    // advance `seconds` of time: the clock's, or app.tick steps of 1 / fps (the last one shorter)
    advance(seconds) {
      if (c) c.advanceTo(c.now() + seconds * 1000);
      else { let left = seconds; while (left > 1e-9) { const d = Math.min(1 / fps, left); app.tick(d); left -= d; } }
      feed();
    },
    key(k) { stdin.emit('data', k); feed(); },
    // resize the terminal the way a window drag does; the reader starts afresh at the new size
    resize(cc, rr) {
      feed();
      stdout.columns = cc; stdout.rows = rr;
      screen = createScreen(cc, rr);
      size = { cols: cc, rows: rr };
      stdout.emit('resize');
      feed();
    },
    text: () => screen.text(),
    snap() { return { text: screen.text(), glyphs: screen.glyphs.slice(), fg: screen.fg.slice(), bg: screen.bg.slice(), state: app.getState(), cols: size.cols, rows: size.rows }; },
    close() {
      try { proc.emit('exit'); } catch { /* ignore */ }
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
  return h;
}

// the screen read back is exactly the last frame the app drew (no stale cell from an earlier screen): every glyph equals the screenshot's
export function assertScreenIsFrame(h, assert, label = '') {
  const shot = h.app.screenshot();
  assert.ok(shot, `${label}: a frame was drawn`);
  const { cols, rows } = h.size;
  assert.equal(shot.cols, cols, `${label}: the frame is ${cols} wide`);
  assert.equal(shot.rows, rows, `${label}: the frame is ${rows} high`);
  for (let i = 0; i < cols * rows - 1; i++) { // the bottom-right cell is never drawn
    if (h.screen.glyphs[i] !== shot.glyphs[i]) assert.fail(`${label}: stale or wrong cell ${i % cols},${Math.floor(i / cols)}: the screen has ${h.screen.glyphs[i]}, the frame ${shot.glyphs[i]}`);
  }
}

// every cursor move the bytes make stays inside cols x rows (the reader clamps a move, so this reads the raw bytes)
export function assertWritesInside(writes, cols, rows, assert, label = '') {
  for (const w of writes) {
    for (const m of w.matchAll(/\x1b\[(\d+);(\d+)H/g)) {
      assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= rows && Number(m[2]) >= 1 && Number(m[2]) <= cols, `${label}: a move to row ${m[1]}, column ${m[2]} is outside ${cols}x${rows}`);
    }
  }
}

// how many cells of the screen are not blank
export const inkOf = (screen) => { let n = 0; for (let i = 0; i < screen.glyphs.length; i++) if (screen.glyphs[i] !== 32) n++; return n; };
