// DRIFT-10: the flash meter watching Classic high contrast (the Life scene) in the REAL app. createApp itself, started in contrast mode on scene 0 (life), a
// fake terminal, the app's own loop on a clock from tests/helpers-clock.js ('grid', 'q156', 'jitter') or one app.tick(1 / fps) per frame ('tick'), real key presses
// (`+` raises the speed one step: 1x, 1.5x, 2x, 3x, 4x, SPEEDS in src/app.js), the bytes the renderer writes read back through the independent terminal reader
// (tests/helpers-ansi.js), and those screens through the flash meter with the full rule set (L1, L2, L3, R, C). 256-colour runs read the index the terminal was told
// to show, truecolor the 24-bit value. The meter reads one screen per 1 / fps of clock time, the viewer's grid, as in tests/helpers-flash-app.js.
//
// Only the Life scene is judged: frames count while the scheduler is holding scene `life` (not fading to the next one) and the run stops when the hold ends (a
// dissolve into the tunnel scene is another scene's business). `sceneSeconds` is the scheduler's hold in SCENE seconds, which run `speed` times faster than the
// wall clock: a run at 4x with sceneSeconds 30 sees Life for 7.5 real seconds; pass sceneSeconds = 30 * speed to see it for 30 real seconds at that speed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp as realCreateApp, CLASSIC_MIN_COLS, CLASSIC_MIN_ROWS } from '../src/app.js';
import { createScreen } from './helpers-ansi.js';
import { createFlashMeter } from './helpers-flash.js';
import { createClock } from './helpers-clock.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';
import { rgbOf } from './helpers-flash-app.js';
import assert from 'node:assert/strict';
import { expectedCardText } from './helpers-size-card.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';

// DRIFT-12: below 40x10 Classic shows the size card, never a scene (src/app.js CLASSIC_MIN_COLS x CLASSIC_MIN_ROWS). A run at such a size is a run of the CARD: runLife refuses it unless the
// caller says `card: true` (so no test can pass on a board it believes is running Life), and then checks every frame it meters is the card. `cardRun` is what a test asserts of one.
export const isCardBoard = (cols, rows) => cols < CLASSIC_MIN_COLS || rows < CLASSIC_MIN_ROWS;
export function cardRun(r, cols, rows, label) {
  assert.equal(r.card, true, `${label}: a run of the size card`);
  assert.equal(r.endedAt, null, `${label}: the scene clock stands still under the card, so the scheduler never reaches the dissolve`);
  assert.ok(r.frames > 0, `${label}: frames were metered`);
  assert.deepEqual(failedRules(r.rep, { only: X1_RULE_IDS }), [], `${label}: the five rules pass on the card`);
  const ch = (id) => r.rep[id.split('.')[0]][id.split('.')[1] || 'x1'];
  for (const id of ['l1.x1', 'l2.x1']) assert.equal(ch(id).worstFraction, 0, `${label}: a static card does not change (${id})`);
  assert.equal(r.rep.l3.worstFraction, 0, `${label}: a static card does not change (l3)`);
}

export const LIFE_FPS = 18;
export const LIFE_SECONDS_FRAMES = 30 * LIFE_FPS; // a whole 30 s scene read at 18 fps, 1x
const DEF_FG = 0xcccccc, DEF_BG = 0x0c0c0c;

// the keys of a speed plan: `+` pressed n times, the first `at` seconds in, 0.2 s apart (the plan of PLAN_4X in helpers-flash-app.js is four presses at 1 s)
export const plusKeys = (n, at = 1) => Array.from({ length: n }, (_, i) => ({ at: at + 0.2 * i, key: '+' }));
// SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]: from 1x, one press is 1.5x, two are 2x, three 3x, four 4x
// `-` pressed n times from the first frame (SPEEDS: from 1x, one press is 0.75x, two 0.5x, three 0.25x)
export const minusKeys = (n, at = 0) => Array.from({ length: n }, (_, i) => ({ at: at + 0.2 * i, key: '-' }));
export const PLAN = { '1x': [], '2x': plusKeys(2), '4x': plusKeys(4), '0.5x': minusKeys(2), '0.25x': minusKeys(3) };
export const SPEED_OF = { '1x': 1, '2x': 2, '4x': 4, '0.5x': 0.5, '0.25x': 0.25 };

// How many of the metered frames show a different screen from the frame before: a count of how often Life moves in the 30 real seconds of the run at `speed` (a key of PLAN).
// Life steps from the real-time clock, which runs at min(speed, 1) of real time (src/app.js rt), so it moves about half as often at 0.5x and a quarter as often at 0.25x.
export async function movingFrames(speed, o = {}) {
  let prev = null, moving = 0;
  const r = await runLife({
    cols: 80, rows: 24, mode: '256', clock: 'grid', seconds: 36, keys: PLAN[speed], sceneSeconds: 30 * SPEED_OF[speed], ...o,
    grab: (k, screen) => {
      const g = screen.glyphs.slice();
      if (prev) for (let i = 0; i < g.length; i++) if (g[i] !== prev[i]) { moving++; break; }
      prev = g;
    },
  });
  return { moving, r };
}

// Runs Life in the real app and returns { rep, frames, endedAt, ids, app-less facts }. `root`: a copy of the tree (src/) to run instead of this one (the controls).
// writes: an array that gets every string the app wrote (in order); beforeFrame(k, { stdout, stdin, app }) runs at the start of frame k (a test stalls the terminal there); meter: false skips the
// terminal reader and the meter (the rep is null) for the tools and tests that only watch the spy (tests/helpers-governor-app.js).
// feedAll: meter every frame of the run (the dissolves and the scenes after Life too); the tests never do, the README's "not covered" figures come from it.
// `grab(k, screen, app, f, meter)` is called on every frame the meter reads (after it was pushed; meter.forgetWorst() makes the final rep the worst over the LATER frames only), for the look tests (lit counts, glyphs). `forceDead(app)` is not offered: quiet states use the scene directly.
export async function runLife({
  cols = 80, rows = 24, mode = '256', seed = 1, seconds = 32, keys = [], clock = 'grid', clockSeed = 1, root = null, fps = LIFE_FPS,
  sceneSeconds = 30, invert = false, dirs = [], grab = null, startMode = 'contrast', stopAtDissolve = true, feedAll = false, scene = 'life', startScene = 0, card = false, onApp = null, meter: useMeter = true, writes = null, beforeFrame = null,
} = {}) {
  const tiny = isCardBoard(cols, rows);
  if (tiny && !card) throw new Error(`runLife: ${cols}x${rows} is below Classic's 40x10 minimum, where Classic shows the size card and no scene (DRIFT-12); pass card: true to run the card knowingly`);
  const createApp = root ? (await import(pathToFileURL(path.join(root, 'src', 'app.js')).href)).createApp : realCreateApp;
  const useClock = clock && clock !== 'tick';
  const c = useClock ? createClock({ mode: clock, seed: clockSeed }) : null;
  const stdout = fakeStdout({ columns: cols, rows });
  const stdin = fakeStdin(), stderr = fakeStderr(), proc = fakeProc();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-life-app-'));
  const cfg = path.join(tmp, 'config.json');
  if (invert) fs.writeFileSync(cfg, JSON.stringify({ invert: true }));
  const env = mode === 'truecolor' ? { COLORTERM: 'truecolor' } : {};
  const app = createApp({
    stdin, stdout, stderr, proc, env, configPath: cfg, dirs, startMode, startScene, sceneSeconds, seed, fps,
    autoLoop: useClock, now: c ? c.now : undefined, timer: c ? c.timer : undefined,
  });
  const ids = [];
  const n = cols * rows;
  if (onApp) onApp(app);
  try {
    app.start();
    const screen = createScreen(cols, rows);
    const meter = useMeter ? createFlashMeter(cols, rows, fps) : null;
    const total = Math.round(seconds * fps);
    const keyAt = new Map();
    for (const kk of keys) { const f = Math.round(kk.at * fps); keyAt.set(f, (keyAt.get(f) || []).concat(kk.key)); }
    let frames = 0, endedAt = null, speedMax = 0;
    for (let k = 0; k < total && !proc.exits.length; k++) {
      for (const key of keyAt.get(k) || []) stdin.emit('data', key);
      if (beforeFrame) beforeFrame(k, { stdout, stdin, app });
      if (c) c.advanceTo(((k + 1) * 1000) / fps); else app.tick(1 / fps);
      for (const w of stdout.writes.splice(0)) { if (writes) writes.push(w); if (useMeter || tiny) screen.feed(w); }
      if (k % 8 === 0) await new Promise((r) => setImmediate(r));
      if (tiny && screen.text() !== expectedCardText(cols, rows)) throw new Error(`runLife ${cols}x${rows} frame ${k}: the screen is not the size card`);
      const st = app.getState();
      speedMax = Math.max(speedMax, st.speed);
      ids.push(st.fading ? 'fading' : st.sceneId);
      if (!feedAll && (st.fading || st.sceneId !== scene)) { if (stopAtDissolve) { endedAt = k / fps; break; } continue; }
      if (!useMeter) { frames++; continue; } // onApp / the spy only: no terminal reader, no meter (tools/governor-wired.mjs)
      const f = { cols, rows, glyphs: new Uint32Array(n), fg: new Uint32Array(n), bg: new Uint32Array(n) };
      for (let j = 0; j < n; j++) { f.glyphs[j] = screen.glyphs[j]; f.fg[j] = rgbOf(screen.fg[j], DEF_FG); f.bg[j] = rgbOf(screen.bg[j], DEF_BG); }
      meter.push(f, undefined);
      frames++;
      if (grab) grab(k, screen, app, f, meter);
    }
    return { rep: meter ? meter.report() : null, frames, endedAt, ids, speedMax, card: tiny, state: app.getState(), exits: proc.exits.slice() };
  } finally {
    try { proc.emit('exit'); } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- trees for the controls: a copy of src/ with the Life scene swapped for the old one (tests/fixtures/life-before-drift10.js) or with a one-line mutation of the new one.
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SRC = path.join(HERE, '..', 'src');
export const OLD_LIFE_FILE = path.join(HERE, 'fixtures', 'life-before-drift10.js');
export const OLD_WIRE_FILE = path.join(HERE, 'fixtures', 'wire-before-drift11.js'); // DRIFT-11: wire.js and blocktype.js as they were at 7c2f34c (pure in t, kind 'cells')
export const OLD_BLOCKTYPE_FILE = path.join(HERE, 'fixtures', 'blocktype-before-drift11.js');
export const OLD_TUNNEL_FILE = path.join(HERE, 'fixtures', 'tunnel-before-drift12.js'); // DRIFT-12: tunnel.js as it was at 1cb2b62 (pure in t, kind 'cells', flows with the scene clock)
export const V1_LIFE_FILE = path.join(HERE, 'fixtures', 'life-before-fps-fix.js'); // DRIFT-10's first fix (33f8142): the flip gap and a per-STEP share only, no per-frame cap
// life: 'old' (the fixture), 'v1' (the first DRIFT-10 fix, fixture), 'new' (this tree's), or a function (text) -> text that edits the new one (it must change it: a mutation that matches nothing throws).
// edits: { 'src/app.js': (text) => text, ... } the same for any other file of src/.
// scenes: { wire, blocktype, tunnel } each 'old' (the DRIFT-11 fixture), 'new' (this tree's) or a function (text) -> text that edits this tree's file (it must change it).
export function makeTree(life = 'new', edits = {}, scenes = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-life-tree-'));
  fs.cpSync(SRC, path.join(root, 'src'), { recursive: true });
  const file = path.join(root, 'src', 'scenes', 'life.js');
  if (life === 'old') fs.copyFileSync(OLD_LIFE_FILE, file);
  else if (life === 'v1') fs.copyFileSync(V1_LIFE_FILE, file);
  else if (typeof life === 'function') {
    const before = fs.readFileSync(file, 'utf8');
    const after = life(before);
    if (after === before) throw new Error('makeTree: the mutation changed nothing');
    fs.writeFileSync(file, after);
  }
  for (const [name, how] of Object.entries(scenes)) {
    const f = path.join(root, 'src', 'scenes', name + '.js');
    if (how === 'old') fs.copyFileSync({ wire: OLD_WIRE_FILE, blocktype: OLD_BLOCKTYPE_FILE, tunnel: OLD_TUNNEL_FILE }[name], f);
    else if (typeof how === 'function') {
      const before = fs.readFileSync(f, 'utf8'), after = how(before);
      if (after === before) throw new Error(`makeTree: the mutation of ${name}.js changed nothing`);
      fs.writeFileSync(f, after);
    }
  }
  for (const [rel, fn] of Object.entries(edits)) {
    const f = path.join(root, rel);
    const before = fs.readFileSync(f, 'utf8'), after = fn(before);
    if (after === before) throw new Error(`makeTree: the mutation of ${rel} changed nothing`);
    fs.writeFileSync(f, after);
  }
  return root;
}
export const rmTree = (root) => fs.rmSync(root, { recursive: true, force: true });

// DRIFT-12: the app as it was at 1cb2b62 where DRIFT-12 changed it: the scheduler's cross-fade at scene speed (no fadeScale) and the contrast composer without realTimeIds. With the old tunnel
// (makeTree('new', BEFORE12_EDITS, { tunnel: 'old' })) this is the whole Classic high contrast mode as it was; tools/life-matrix.mjs --tree before12 runs it. Strict: an edit that matches nothing throws.
const must = (text, from, to) => { if (!text.includes(from)) throw new Error('tree edit (BEFORE12_EDITS, BEFORE13_EDITS): no match for ' + from); return text.replace(from, to); };
export const BEFORE12_EDITS = {
  'src/app.js': (t) => must(must(t, "advance(d, shown.mode === 'contrast' ? Math.min(SPEEDS[speedIdx], 1) / SPEEDS[speedIdx] : 1);", 'advance(d);'), ", realTimeIds: mode === 'contrast' ? ['maze'] : [] })", ' })'),
};

// DRIFT-13: the app as it was before the flash governor was wired in (src/app.js hands the renderer the composed frame itself): the control that shows Desmond's cases are real failures.
// makeTree('new', BEFORE13_EDITS) is Classic high contrast at 153cc21 (the scenes' own fixes of DRIFT-10 to 12 stay). Strict: an edit that matches nothing throws.
export const GOVERN_LINE = "const painted = shown.mode === 'contrast' ? govern(f) : f;";
export const BEFORE13_EDITS = {
  'src/app.js': (t) => must(t, GOVERN_LINE, 'const painted = f;'),
};

// DRIFT-13: a tree for the controls of DRIFT-10 to 12 (the old Life, the old wire, blocktype and tunnel, the one-line mutants of the scene fixes): the same tree makeTree makes, with the governor taken out of app.js.
// Those controls show what each SCENE fix does on its own, so they run in the world they were written in; the governor would otherwise cover the old scenes and every must-fail control would pass.
// (Applied after makeTree's own edits, so a mutation that matches nothing still throws there.)
export function makeTreeNoGov(life = 'new', edits = {}, scenes = {}) {
  const root = makeTree(life, edits, scenes);
  const f = path.join(root, 'src', 'app.js');
  fs.writeFileSync(f, BEFORE13_EDITS['src/app.js'](fs.readFileSync(f, 'utf8')));
  return root;
}

// the five rules' worst readings in per cent (X1 views: the viewer's own second), and the rules that fail
export function nums(rep) {
  const v = (r) => r.worstFraction * 100;
  return { l1: v(rep.l1.x1), l2: v(rep.l2.x1), l3: v(rep.l3), r: v(rep.r.x1), c: v(rep.c) };
}

// the run read the whole Life scene: 540 frames (30 s at 18 fps), or one or two fewer when a late timer started the dissolve a frame early
export function wholeScene(r, label) {
  assert.ok(r.frames >= LIFE_SECONDS_FRAMES - 2 && r.frames <= LIFE_SECONDS_FRAMES, `${label}: the whole 30 s Life scene was metered (${r.frames} frames, ended at ${r.endedAt} s)`);
}
