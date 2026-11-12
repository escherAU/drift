// Headless frame capture: node tools/capture.mjs [--out captures] [--cartridges]   (--cartridges: only the cartridge console files,
// which include Delza's cart-delza-* set and Night Drive's cart-night-drive-* set; see the DRIFT-4 and DRIFT-5 blocks below)
// Writes, for each of the 5 scenes and a cross-fade, at 120x40 and 240x67:
//   <name>-<cols>x<rows>.txt   glyph characters only
//   <name>-<cols>x<rows>.ansi  same frames with truecolor SGR (Claude orange)
// Scene frames are taken at t = 0, 5, 10, 20 s, each from a fresh composer, so
// the output is fully deterministic. The cross-fade runs squiggle -> sunburst
// over the app's shipped fade length (DEFAULT_FADE_SECONDS, imported, not
// copied), at 0, 25, 50, 75 and 100% of its time (progress eased with the same
// smoothstep), so the first frame is pure squiggle and the last pure sunburst.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { SCENES, PLAYLISTS } from '../src/scenes/index.js';
import { MODES } from '../src/modes.js';
import { createCellComposer, renderScene } from '../src/cells.js';
import { createComposer, smoothstep } from '../src/compose.js';
import { frameToText, frameToAnsi } from '../src/renderer.js';
import { DEFAULT_FADE_SECONDS, DISSOLVE_SECONDS, createApp } from '../src/app.js';
import { makePalette, presetRGB } from '../src/color.js';
import artist, { timeline } from '../src/scenes/artist.js';
import { PIECES } from '../src/art/gallery.js';
import { buildPlan, pieceToText } from '../src/art/engine.js';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';
import { INSERT_END } from '../src/shell/insert.js';
import { BOOT_END } from '../src/shell/boot.js';
import { EJECT_FADE_SECONDS, EJECT_ANIM_SECONDS, resetFirstInsertHint } from '../src/shell/shell.js';
import { TURN, HIT_AT, CONTACT_AT } from '../cartridges/delza/scenes/cinderhorn.js';
import { LINES, STARTS, TYPE_CPS, DISSOLVE, FLUTTER_STEP } from '../cartridges/delza/scenes/lampwarden.js';
import { flickerShade } from '../cartridges/night-drive/scenes/diner.js';
import { CYCLE as WIPER_CYCLE, SWEEP_AT } from '../cartridges/night-drive/lib/rain.js';
import { RAIN_GREEN_BY } from '../cartridges/night-drive/lib/downpour.js';

export const CAPTURE_NAMES = [...SCENES.map((s) => s.id), 'crossfade'];
const SIZES = [[120, 40], [240, 67]];
const TIMES = [0, 5, 10, 20];
// the cross-fade is captured with the app's shipped fade length, at these fractions of it
const FADE_SEC = DEFAULT_FADE_SECONDS;
const FADE_POINTS = [0, 0.25, 0.5, 0.75, 1];

export function runCapture({ outDir, sizes = SIZES, times = TIMES, seed = 1 }) {
  fs.mkdirSync(outDir, { recursive: true });
  const palette = makePalette(presetRGB('claude', 0), 'truecolor');
  const written = [];
  for (const name of CAPTURE_NAMES) {
    for (const [cols, rows] of sizes) {
      let txt = '', ansi = '';
      const secs = name === 'crossfade' ? FADE_POINTS.map((f) => f * FADE_SEC) : times;
      for (const sec of secs) {
        const comp = createComposer({ scenes: SCENES, cols, rows, seed });
        const st = name === 'crossfade'
          ? { a: 0, b: 1, p: smoothstep(sec / FADE_SEC) }
          : { a: CAPTURE_NAMES.indexOf(name), b: CAPTURE_NAMES.indexOf(name), p: 0 };
        const f = comp.frame(st, sec);
        const frame = { cols, rows, glyphs: f.glyphs, shades: f.shades, palette };
        const head = `=== t=${sec}s ${cols}x${rows} ${name}${name === 'crossfade' ? ` progress=${st.p.toFixed(3)}` : ''}`;
        txt += `${head}\n${frameToText(frame)}\n`;
        ansi += `${head}\n${frameToAnsi(frame)}\n`;
      }
      const base = path.join(outDir, `${name}-${cols}x${rows}`);
      fs.writeFileSync(`${base}.txt`, txt);
      fs.writeFileSync(`${base}.ansi`, ansi);
      written.push(`${base}.txt`, `${base}.ansi`);
    }
  }
  return written;
}

// ---- DRIFT-2: the non-calm modes. Plain text only, 120x40, written next to the calm files:
//   <mode>-<scene>-1.txt, -2.txt   two frames of each non-calm scene (t = 3 s and 12 s; sims are
//                                  stepped from a fresh state, so each file stands alone)
//   help-<mode>.txt                the help panel as the real app draws it (all four modes)
//   dissolve-<mode>.txt            the 2 s dissolve from the mode's first scene to its next one
//                                  (a one-scene mode dissolves into the next mode's first scene)
//                                  at 0, 25, 50, 75, 100% of the dissolve
const MODE_COLS = 120, MODE_ROWS = 40;
const MODE_TIMES = [3, 12];
const DISSOLVE_POINTS = [0, 0.25, 0.5, 0.75, 1];
const NON_CALM = MODES.filter((m) => m !== 'calm');

export const MODE_CAPTURE_NAMES = [
  ...MODES.map((m) => `help-${m}.txt`),
  ...NON_CALM.map((m) => `dissolve-${m}.txt`),
  ...NON_CALM.flatMap((m) => PLAYLISTS[m].flatMap((s) => [`${m}-${s.id}-1.txt`, `${m}-${s.id}-2.txt`])),
];

function helpShot(mode, seed) {
  const stdin = new EventEmitter();
  Object.assign(stdin, { isTTY: true, setRawMode() { return stdin; }, resume() { return stdin; }, pause() { return stdin; }, unref() {}, ref() {}, setEncoding() { return stdin; } });
  const stdout = new EventEmitter();
  Object.assign(stdout, { isTTY: true, columns: MODE_COLS, rows: MODE_ROWS, write(_s, cb) { if (typeof cb === 'function') cb(); return true; } });
  const proc = new EventEmitter();
  proc.exit = () => {};
  const app = createApp({
    stdin, stdout, stderr: { write() { return true; } }, proc, env: { COLORTERM: 'truecolor' },
    configPath: path.join(os.tmpdir(), 'drift-capture-none', 'config.json'), // never written: no key here saves anything
    autoLoop: false, seed, startMode: mode, startScene: 0,
  });
  app.start();
  app.tick(0.05);
  app.handleKey('h');
  app.tick(0);
  const shot = app.screenshot();
  app.quit(0);
  return shot;
}

export function runCaptureModes({ outDir, seed = 1 }) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const put = (name, text) => { const f = path.join(outDir, name); fs.writeFileSync(f, text); written.push(f); };
  for (const mode of NON_CALM) {
    for (const scene of PLAYLISTS[mode]) {
      MODE_TIMES.forEach((sec, k) => {
        const f = renderScene(scene, sec, MODE_COLS, MODE_ROWS, seed);
        const head = `=== t=${sec}s ${MODE_COLS}x${MODE_ROWS} ${mode}/${scene.id}`;
        put(`${mode}-${scene.id}-${k + 1}.txt`, `${head}\n${frameToText({ cols: MODE_COLS, rows: MODE_ROWS, glyphs: f.glyphs })}\n`);
      });
    }
  }
  for (const mode of MODES) {
    const s = helpShot(mode, seed);
    put(`help-${mode}.txt`, `=== help ${MODE_COLS}x${MODE_ROWS} ${mode}\n${frameToText(s)}\n`);
  }
  for (let mi = 0; mi < NON_CALM.length; mi++) {
    const mode = NON_CALM[mi];
    const list = PLAYLISTS[mode];
    const A = list[0];
    const B = list.length > 1 ? list[1] : PLAYLISTS[NON_CALM[(mi + 1) % NON_CALM.length]][0];
    const cc = createCellComposer({ scenes: [A, B], cols: MODE_COLS, rows: MODE_ROWS, seed });
    const T = 3;
    for (let k = 0; k <= T * 18; k++) cc.frame({ a: 0, b: 1, p: 0 }, k / 18); // let sims run to t = 3 s
    let txt = '';
    for (const p of DISSOLVE_POINTS) {
      const f = cc.frame({ a: 0, b: 1, p }, T);
      txt += `=== p=${p} ${MODE_COLS}x${MODE_ROWS} ${A.id} -> ${B.id} (${DISSOLVE_SECONDS} s dissolve)\n${frameToText({ cols: MODE_COLS, rows: MODE_ROWS, glyphs: f.glyphs })}\n`;
    }
    put(`dissolve-${mode}.txt`, txt);
  }
  return written;
}

// ---- DRIFT-2 S4: the artist's gallery, plain text at 120x40 (shipped defaults: seed 1)
//   artist-<piece file>-half.txt   the piece 50% drawn (pen and fading strokes included)
//   artist-<piece file>-full.txt   the finished piece
//   artist-gallery.txt             every piece, titled, exactly as it is drawn when complete
export function galleryCaptureNames() {
  return [...PIECES.flatMap((p) => { const b = p.file.replace(/\.txt$/i, ''); return [`artist-${b}-half.txt`, `artist-${b}-full.txt`]; }), 'artist-gallery.txt'];
}

export function runCaptureGallery({ outDir, seed = 1 }) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const put = (name, text) => { const f = path.join(outDir, name); fs.writeFileSync(f, text); written.push(f); };
  const tl = timeline(PIECES, MODE_COLS, MODE_ROWS, seed);
  let all = '';
  for (const p of PIECES) {
    const e = tl.list.find((x) => x.piece === p);
    if (!e) continue; // does not fit 120x40
    const base = p.file.replace(/\.txt$/i, '');
    const plan = buildPlan(p);
    const shot = (t) => frameToText({ cols: MODE_COLS, rows: MODE_ROWS, glyphs: renderScene(artist, t, MODE_COLS, MODE_ROWS, seed).glyphs });
    put(`artist-${base}-half.txt`, `=== ${p.title} (${p.file}) 50% drawn, t=${(e.start + plan.drawSec / 2).toFixed(1)}s ${MODE_COLS}x${MODE_ROWS}\n${shot(e.start + plan.drawSec / 2)}\n`);
    put(`artist-${base}-full.txt`, `=== ${p.title} (${p.file}) finished, t=${e.drawEnd.toFixed(1)}s ${MODE_COLS}x${MODE_ROWS}\n${shot(e.drawEnd)}\n`);
    all += `=== ${p.title} (${p.file}) ${p.width}x${p.height}\n${pieceToText(p)}\n\n`;
  }
  put('artist-gallery.txt', all);
  return written;
}

// ---- DRIFT-4: the cartridge console, plain text, from the install cartridges only (so the files do not depend
// on what a user has in %APPDATA%). Its own list of names; K3 above is untouched. Every file starts with an
// "=== ..." header line and holds exactly one frame.
//   cart-library-<id>-120x40.txt, cart-library-<id>-80x24.txt
//                          the library with the cursor on that cartridge (every installed one, locked too)
//   cart-library-240x67.txt        the extra-large library, Classic selected
//   cart-library-list-60x14.txt    the text-list tier, Classic selected
//   cart-insert-<id>-t<ms>.txt     the insert animation <ms> after Enter (120x40; before INSERT_END, 1.5 s)
//   cart-boot-<id>-t<ms>.txt       the boot screen <ms> after Enter (120x40; from INSERT_END on)
//   cart-insert-<id>-80x24-t<ms>.txt, cart-boot-<id>-80x24-t<ms>.txt   the same on the compact console
//   cart-eject-<id>[-80x24]-t<ms>.txt   a cartridge that RUNS in the shell (not Classic, which has no eject) ejecting,
//                          <ms> after `e`: the animation (EJECT_ANIM_SECONDS) starts after the fade to blank (EJECT_FADE_SECONDS), so the moments
//                          are EJECT_FADE_SECONDS + the same fractions of EJECT_ANIM_SECONDS as the insert moments are of INSERT_END
//   cart-help-classic-120x40.txt   the help panel (h) while Classic runs, after the console has handed back to it
// Unlocked cartridges only get insert/boot/eject. Driven through the real app on a fake terminal, with a fake clock.
const CART_DT = 1 / 18;
const CART_SIZES = [[120, 40], [80, 24]];
// seconds after Enter: the insert is over at INSERT_END (1.5 s), the boot runs on to about 5.8 s. The 3.4 s moment sits
// where Classic's progress bar is whole (the old 3.6 s moment caught it with a one-cell gap).
export const CART_MOMENTS = [0.4, 0.9, 1.25, 1.6, 2.5, 3.4, 4.2, 5.0, 5.6];
export const EJECT_MOMENTS = CART_MOMENTS.filter((m) => m < INSERT_END).map((m) => EJECT_FADE_SECONDS + (m / INSERT_END) * EJECT_ANIM_SECONDS);
const CART_DIRS = () => [{ dir: INSTALL_DIR, trusted: true }];
const sizeTag = (cols, rows) => (cols === 120 && rows === 40 ? '' : `-${cols}x${rows}`);
const ms = (sec) => Math.round(sec * 1000);

const installed = (dirs) => discoverCartridges({ dirs: dirs || CART_DIRS() }).cartridges;
const isShellRun = (c) => c.manifest && c.manifest.runtime !== 'classic';
const hasDelza = (c) => c.id === 'delza' && !c.locked && isShellRun(c);
const hasNightDrive = (c) => c.id === 'night-drive' && !c.locked && isShellRun(c);

export function cartridgeCaptureNames({ dirs } = {}) {
  const names = ['cart-library-240x67.txt', 'cart-library-list-60x14.txt', 'cart-help-classic-120x40.txt'];
  for (const c of installed(dirs)) {
    for (const [cols, rows] of CART_SIZES) {
      names.push(`cart-library-${c.id}-${cols}x${rows}.txt`);
      if (c.locked) continue;
      const tag = sizeTag(cols, rows);
      for (const m of CART_MOMENTS) names.push(`cart-${m < INSERT_END ? 'insert' : 'boot'}-${c.id}${tag}-t${ms(m)}.txt`);
      if (isShellRun(c)) for (const m of EJECT_MOMENTS) names.push(`cart-eject-${c.id}${tag}-t${ms(m)}.txt`);
    }
  }
  if (installed(dirs).some(hasDelza)) names.push(...delzaCaptureNames());
  if (installed(dirs).some(hasNightDrive)) names.push(...nightDriveCaptureNames());
  return names;
}

// ---- Delza's own captures (cart-delza-*.txt), all through the real app on the fake terminal at the shipped defaults:
//   cart-delza-library-240x67.txt       the extra-large library, cursor on Delza
//   cart-delza-journal-120x40.txt, -80x24.txt   the Journal menu as it opens when the boot ends
//   cart-delza-help-120x40.txt, -80x24.txt      the reskinned help panel (h) while the tale plays
//   cart-delza-boot-hint-t<ms>.txt      the FIRST insert of a process, which has "e ejects · h shows the keys" on the bar line
//   cart-delza-scene-<id>-t<s>.txt      every scene at 2, 20 and 40 s of scene time (120x40), chosen from the Journal menu
//   cart-delza-fight-t<ms>.txt          the Cinderhorn through its third turn (a swing): the cursor walking, the word gold, the
//                                       lantern landing, the stag pawing, the stag's charge landing
//   cart-delza-cutscene-t<ms>.txt       the Lampwarden: line 1 half typed, line 3 whole, Pim's flutter, the last line whole
// The plain boot captures (cart-boot-*) must show the plain bar, so the per-process first-insert flag is spent first and
// only the hint capture sets it again with resetFirstInsertHint().
export const DELZA_ID = 'delza';
export const DELZA_SCENE_IDS = ['thornwell', 'tallow', 'cinderhorn', 'reach', 'highcandle', 'lampwarden'];
export const DELZA_SCENE_TIMES = [2, 20, 40];
export const HINT_MOMENT = 3.4;
const round2 = (x) => Math.round(x * 100) / 100;
const TURN3 = 2 * TURN; // the third turn of the fight's plan is a swing
export const FIGHT_MOMENTS = [0.3, 0.8, HIT_AT + 0.1, 2.5, CONTACT_AT + 0.1].map((o) => round2(TURN3 + o));
const lineEnd = (i) => STARTS[i] + LINES[i].text.length / TYPE_CPS;
export const CUTSCENE_MOMENTS = [
  STARTS[0] + (lineEnd(0) - STARTS[0]) / 2,
  lineEnd(2) + 0.8,
  STARTS[3] + DISSOLVE + FLUTTER_STEP + FLUTTER_STEP / 2,
  lineEnd(5) + 1,
].map(round2);
export function delzaCaptureNames() {
  const names = ['cart-delza-library-240x67.txt', `cart-delza-boot-hint-t${ms(HINT_MOMENT)}.txt`];
  for (const sz of ['120x40', '80x24']) names.push(`cart-delza-journal-${sz}.txt`, `cart-delza-help-${sz}.txt`);
  for (const id of DELZA_SCENE_IDS) for (const sec of DELZA_SCENE_TIMES) names.push(`cart-delza-scene-${id}-t${sec}.txt`);
  for (const m of FIGHT_MOMENTS) names.push(`cart-delza-fight-t${ms(m)}.txt`);
  for (const m of CUTSCENE_MOMENTS) names.push(`cart-delza-cutscene-t${ms(m)}.txt`);
  return names;
}

// ---- Night Drive's own captures (cart-night-drive-*.txt), through the real app on the fake terminal at the shipped defaults:
//   cart-night-drive-scene-<id>-t<s>.txt          every track at 2, 20 and 40 s of scene time (120x40; the diner and the on-ramp at 2, 21 and 40), chosen from the tape-deck
//   cart-night-drive-scene-<id>-80x24-t<s>.txt    menu with the keys a person uses; the same on the compact console (the size suffix
//                                                 sits before the time, as in cart-boot-<id>-80x24-t<ms>.txt)
//   later moments, where each story moves (both sizes): sundown t75; redlight t9 (the wiper mid-stroke), t11 (just before the next sweep), t61 (the rain near the lamp has gone green, 60.1 s) and t62 (the buildings have begun to slide); diner t25
//                                                 (the bottom of a flicker dip, computed from the scene's own schedule); caller t29
//                                                 (Danny's card whole, with the arrow) and t70 (the narrator's card); overdrive t64
//                                                 (the far end is open, the city shows inside it; the freeway follows at 66 s)
//   cart-night-drive-menu-<size>.txt              the tape deck open over the running track: the * on the playing track, the cursor on the next
//   cart-night-drive-help-<size>.txt              the reskinned help panel (h) while a track plays
//   cart-night-drive-console-<size>.txt           the console takeover, 3.4 s after Enter: the skin's frame, grille, stripe and title.
//                                                 The console is only on screen while the tape goes in and boots, never while a track
//                                                 plays, so this is that moment (the compact 80x24 console has no stripe bar).
// Scene time is counted from the scene's first frame: the tick(0) after the last key of the pick (the scene's own params.t0), then 1/18 s
// ticks to the second. Every file is one frame under an "=== ..." header. Sizes are 120x40 and 80x24, as the generic files.
export const NIGHT_DRIVE_ID = 'night-drive';
export const ND_SCENE_IDS = ['onramp', 'skyline', 'sundown', 'coast', 'redlight', 'diner', 'caller', 'overdrive'];
export const ND_SCENE_TIMES = [2, 20, 40];
export const ND_CONSOLE_MOMENT = 3.4;
const DINER_DIP_T = Array.from({ length: 10 }, (_, i) => 24 + i).find((s) => flickerShade(s, 1) === 1); // the first whole second from 24 s at the bottom of a dip (25)
// Red Light's whole seconds, from the scene's own wiper constants (the sim runs 30 steps a second, a cycle is WIPER_CYCLE steps and the blade moves from step SWEEP_AT):
// mid-stroke is the first second whose step in the cycle is 6 to 12 steps into the sweep (the blade on its way up); just before is the first later second 1 to 6 steps short of it
const wiperStep = (sec) => (sec * 30) % WIPER_CYCLE;
const REDLIGHT_MID_T = Array.from({ length: 30 }, (_, i) => 5 + i).find((s) => { const p = wiperStep(s) - SWEEP_AT; return p >= 6 && p <= 12; });
const REDLIGHT_BEFORE_T = Array.from({ length: 30 }, (_, i) => REDLIGHT_MID_T + 1 + i).find((s) => { const p = SWEEP_AT - wiperStep(s); return p >= 1 && p <= 6; });
const REDLIGHT_GREEN_T = Math.ceil(RAIN_GREEN_BY / 30); // the first whole second after the rain near the lamp is all green
export const REDLIGHT_MOMENTS = Object.freeze({ mid: REDLIGHT_MID_T, before: REDLIGHT_BEFORE_T, green: REDLIGHT_GREEN_T, slide: 62 });
export const ND_LATER_TIMES = { sundown: [75], redlight: [REDLIGHT_MID_T, REDLIGHT_BEFORE_T, REDLIGHT_GREEN_T, 62], diner: [DINER_DIP_T], caller: [29, 70], overdrive: [64] };
// the diner (both sizes) and the on-ramp at 80x24 draw the same picture at 2 s and at 20 s (every motion in them repeats within
// 18 s), so the middle moment of those two tracks is 21 s at both sizes
export const ND_BASE_TIMES = { diner: [2, 21, 40], onramp: [2, 21, 40] };
const ndTimes = (id) => [...(ND_BASE_TIMES[id] || ND_SCENE_TIMES), ...(ND_LATER_TIMES[id] || [])].sort((a, b) => a - b); // the clock only runs forward
export function nightDriveCaptureNames() {
  const names = [];
  for (const [cols, rows] of CART_SIZES) {
    const tag = sizeTag(cols, rows);
    for (const id of ND_SCENE_IDS) for (const sec of ndTimes(id)) names.push(`cart-night-drive-scene-${id}${tag}-t${sec}.txt`);
    for (const what of ['menu', 'help', 'console']) names.push(`cart-night-drive-${what}-${cols}x${rows}.txt`);
  }
  return names;
}

function cartApp(seed, cols, rows, dirs, startScreen = { screen: 'library' }) {
  const stdin = new EventEmitter();
  Object.assign(stdin, { isTTY: true, setRawMode() { return stdin; }, resume() { return stdin; }, pause() { return stdin; }, unref() {}, ref() {}, setEncoding() { return stdin; } });
  const stdout = new EventEmitter();
  Object.assign(stdout, { isTTY: true, columns: cols, rows, write(_s, cb) { if (typeof cb === 'function') cb(); return true; } });
  const proc = new EventEmitter();
  proc.exit = () => {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-capture-cart-'));
  const app = createApp({
    stdin, stdout, stderr: { write() { return true; } }, proc, env: { COLORTERM: 'truecolor' },
    configPath: path.join(dir, 'config.json'), dirs, autoLoop: false, seed, startScreen,
  });
  app.start();
  return { app, dir };
}

const shotText = (app) => frameToText(app.screenshot());
const settle = () => new Promise((r) => setTimeout(r, 20));

// a fresh app at cols x rows with the library cursor on `id` (at most one lap of the arrow key); fn(app, step)
// gets a clock that advances in 1/18 s ticks to an absolute time and then lets pending scene imports settle
async function withCartApp({ seed, cols, rows, dirs, id }, fn) {
  const { app, dir } = cartApp(seed, cols, rows, dirs);
  try {
    app.tick(0.05);
    const n = installed(dirs).length;
    for (let i = 0; i < n + 1 && app.getState().shell.cartridge !== id; i++) { app.handleKey('\x1b[C'); app.tick(1.2); } // a shelf step takes 1.2 s (DRIFT-7 item 2)
    app.tick(0.5);
    let t = 0;
    const step = async (to) => { while (t < to - 1e-9) { const d = Math.min(CART_DT, to - t); app.tick(d); t += d; } await settle(); };
    const restart = () => { t = 0; };
    return await fn(app, step, restart);
  } finally {
    app.quit(0);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A cartridge's scenes (Delza's by default) at scene-local times: a fresh app with the boot skipped, the scene chosen from its menu with the
// keys a person uses (Enter, Down to the entry, Enter), then a clock that counts from the first frame of that scene (the
// scene's own params.t0), so `sec` is exactly the scene time. Returns [{ sec, text }] for each of `times`.
async function sceneShots({ seed, cols, rows, dirs, sceneId, times, cartId = DELZA_ID, has = hasDelza }) {
  const cart = installed(dirs).find(has);
  const { app, dir } = cartApp(seed, cols, rows, dirs, { screen: 'cartridge', cartridge: cartId, skipBoot: true });
  const out = [];
  try {
    for (let i = 0; i < 200 && app.getState().shell.screen !== 'running'; i++) { app.tick(0); await settle(); }
    if (app.getState().shell.screen !== 'running') throw new Error('capture: ' + cartId + ' did not start');
    const at = cart.manifest.menu.findIndex((e) => e.scene === sceneId);
    if (at < 0) throw new Error('capture: no menu entry for ' + sceneId);
    if (at > 0) { // the first scene is already playing; the others are chosen
      app.handleKey('\r');
      for (let i = 0; i < at; i++) app.handleKey('\x1b[B');
      app.handleKey('\r');
    }
    app.tick(0); // the scene's first frame: its clock starts here
    if (app.getState().shell.sceneId !== sceneId) throw new Error('capture: could not reach ' + sceneId);
    let t = 0;
    for (const sec of times) {
      while (t < sec - 1e-9) { const d = Math.min(CART_DT, sec - t); app.tick(d); t += d; }
      await settle();
      out.push({ sec, text: shotText(app) });
    }
  } finally {
    app.quit(0);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

// Night Drive with a track playing: the tape deck open (Enter, then Down: the cursor is on the track after the playing one), settled for
// 1.5 s, then closed again and the help panel (h) over the running track. Returns { menu, help } as screenshots.
async function ndPanelShots({ seed, cols, rows, dirs }) {
  const { app, dir } = cartApp(seed, cols, rows, dirs, { screen: 'cartridge', cartridge: NIGHT_DRIVE_ID, skipBoot: true });
  try {
    for (let i = 0; i < 200 && app.getState().shell.screen !== 'running'; i++) { app.tick(0); await settle(); }
    if (app.getState().shell.screen !== 'running') throw new Error('capture: ' + NIGHT_DRIVE_ID + ' did not start');
    let t = 0;
    const step = async (to) => { while (t < to - 1e-9) { const d = Math.min(CART_DT, to - t); app.tick(d); t += d; } await settle(); };
    await step(10);
    app.handleKey('\r');
    app.handleKey('\x1b[B');
    await step(11.5);
    const menu = shotText(app);
    app.handleKey('\x1b');
    await step(13);
    app.handleKey('h');
    app.tick(0.3); // the help panel ramps in over 0.25 s
    return { menu, help: shotText(app) };
  } finally {
    app.quit(0);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function runCaptureCartridges({ outDir, seed = 1, dirs = CART_DIRS() }) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const put = (name, text) => { const f = path.join(outDir, name); fs.writeFileSync(f, text); written.push(f); };
  const found = installed(dirs);
  const classicId = (found.find((c) => !isShellRun(c)) || found[0] || {}).id;
  // spend the per-process first-insert flag so every boot capture below shows the plain bar (a process's first insert
  // shows the hint instead); Delza's hint capture at the end sets it again on purpose with resetFirstInsertHint()
  const firstOpen = found.find((c) => !c.locked);
  if (firstOpen) await withCartApp({ seed, cols: 120, rows: 40, dirs, id: firstOpen.id }, async (app, step) => { app.handleKey('\r'); await step(0.2); });

  // the library, per cartridge and size, then the two single-purpose sizes
  for (const c of found) {
    for (const [cols, rows] of CART_SIZES) {
      await withCartApp({ seed, cols, rows, dirs, id: c.id }, (app) => {
        put(`cart-library-${c.id}-${cols}x${rows}.txt`, `=== library ${cols}x${rows} cursor on ${c.id}${c.locked ? ' (locked)' : ''}\n${shotText(app)}\n`);
      });
    }
  }
  for (const [name, cols, rows, what] of [['cart-library-240x67.txt', 240, 67, 'extra-large'], ['cart-library-list-60x14.txt', 60, 14, 'text-list tier']]) {
    await withCartApp({ seed, cols, rows, dirs, id: classicId }, (app) => {
      put(name, `=== library ${cols}x${rows} (${what}) cursor on ${classicId}\n${shotText(app)}\n`);
    });
  }

  // insert and boot (and eject) for each unlocked cartridge at both sizes; one run per size, frames at the moments
  for (const c of found.filter((x) => !x.locked)) {
    for (const [cols, rows] of CART_SIZES) {
      const tag = sizeTag(cols, rows);
      await withCartApp({ seed, cols, rows, dirs, id: c.id }, async (app, step) => {
        app.handleKey('\r');
        for (const m of CART_MOMENTS) {
          await step(m);
          const kind = m < INSERT_END ? 'insert' : 'boot';
          put(`cart-${kind}-${c.id}${tag}-t${ms(m)}.txt`, `=== ${kind} t=${m}s after Enter ${cols}x${rows} ${c.id}\n${shotText(app)}\n`);
        }
        if (!isShellRun(c)) return;
        await step(BOOT_END + 1.5); // running, with the menu open over it
        if (hasDelza(c)) put(`cart-delza-journal-${cols}x${rows}.txt`, `=== Journal menu ${cols}x${rows} ${round2(BOOT_END + 1.5)}s after Enter (the boot ends at ${round2(BOOT_END)}s) delza\n${shotText(app)}\n`);
        app.handleKey('\x1b'); // close the menu
        if (hasDelza(c)) {
          await step(BOOT_END + 2);
          app.handleKey('h');
          app.tick(0.3); // the help panel ramps in over 0.25 s
          put(`cart-delza-help-${cols}x${rows}.txt`, `=== help ${cols}x${rows} while the tale plays delza\n${shotText(app)}\n`);
          app.handleKey('h');
        }
        await step(BOOT_END + 3);
        app.handleKey('e');
        let t = 0;
        for (const m of EJECT_MOMENTS) {
          while (t < m - 1e-9) { const d = Math.min(CART_DT, m - t); app.tick(d); t += d; }
          await settle();
          put(`cart-eject-${c.id}${tag}-t${ms(m)}.txt`, `=== eject t=${m.toFixed(3)}s after e ${cols}x${rows} ${c.id}\n${shotText(app)}\n`);
        }
      });
    }
  }

  // the help panel while Classic runs: Enter on Classic, through insert and boot to the hand-back, then h
  if (classicId) {
    await withCartApp({ seed, cols: 120, rows: 40, dirs, id: classicId }, async (app, step) => {
      app.handleKey('\r');
      await step(BOOT_END + 1);
      app.handleKey('h');
      app.tick(0);
      put('cart-help-classic-120x40.txt', `=== help 120x40 while ${classicId} runs (after the console handed back)\n${shotText(app)}\n`);
    });
  }

  // Delza's own set: the extra-large library, the first-insert hint, then every scene
  if (found.some(hasDelza)) {
    await withCartApp({ seed, cols: 240, rows: 67, dirs, id: DELZA_ID }, (app) => {
      put('cart-delza-library-240x67.txt', `=== library 240x67 (extra-large) cursor on ${DELZA_ID}\n${shotText(app)}\n`);
    });
    resetFirstInsertHint();
    await withCartApp({ seed, cols: 120, rows: 40, dirs, id: DELZA_ID }, async (app, step) => {
      app.handleKey('\r');
      await step(HINT_MOMENT);
      put(`cart-delza-boot-hint-t${ms(HINT_MOMENT)}.txt`, `=== boot t=${HINT_MOMENT}s after Enter 120x40 delza, the first insert of the process (hint on the bar line)\n${shotText(app)}\n`);
    });
    for (const id of DELZA_SCENE_IDS) {
      for (const sh of await sceneShots({ seed, cols: 120, rows: 40, dirs, sceneId: id, times: DELZA_SCENE_TIMES })) {
        put(`cart-delza-scene-${id}-t${sh.sec}.txt`, `=== scene t=${sh.sec}s of scene time 120x40 delza/${id}\n${sh.text}\n`);
      }
    }
    for (const sh of await sceneShots({ seed, cols: 120, rows: 40, dirs, sceneId: 'cinderhorn', times: FIGHT_MOMENTS })) {
      put(`cart-delza-fight-t${ms(sh.sec)}.txt`, `=== fight t=${sh.sec}s of scene time (turn 3 of 5, a swing: ${round2(sh.sec - TURN3)}s into the turn) 120x40 delza/cinderhorn\n${sh.text}\n`);
    }
    for (const sh of await sceneShots({ seed, cols: 120, rows: 40, dirs, sceneId: 'lampwarden', times: CUTSCENE_MOMENTS })) {
      put(`cart-delza-cutscene-t${ms(sh.sec)}.txt`, `=== cut scene t=${sh.sec}s of scene time 120x40 delza/lampwarden\n${sh.text}\n`);
    }
  }

  // Night Drive's own set: every track at its moments, then the tape deck, the help panel and the console takeover
  if (found.some(hasNightDrive)) {
    for (const [cols, rows] of CART_SIZES) {
      const tag = sizeTag(cols, rows);
      for (const id of ND_SCENE_IDS) {
        for (const sh of await sceneShots({ seed, cols, rows, dirs, sceneId: id, times: ndTimes(id), cartId: NIGHT_DRIVE_ID, has: hasNightDrive })) {
          put(`cart-night-drive-scene-${id}${tag}-t${sh.sec}.txt`, `=== scene t=${sh.sec}s of scene time ${cols}x${rows} night-drive/${id}\n${sh.text}\n`);
        }
      }
      const panels = await ndPanelShots({ seed, cols, rows, dirs });
      put(`cart-night-drive-menu-${cols}x${rows}.txt`, `=== tape deck ${cols}x${rows} open over the running track (the * is on the playing one, the cursor on the next) night-drive\n${panels.menu}\n`);
      put(`cart-night-drive-help-${cols}x${rows}.txt`, `=== help ${cols}x${rows} while a track plays night-drive\n${panels.help}\n`);
      await withCartApp({ seed, cols, rows, dirs, id: NIGHT_DRIVE_ID }, async (app, step) => {
        app.handleKey('\r');
        await step(ND_CONSOLE_MOMENT);
        put(`cart-night-drive-console-${cols}x${rows}.txt`, `=== console takeover ${cols}x${rows} ${ND_CONSOLE_MOMENT}s after Enter (the skin's frame, grille, stripe and title; the console is only on screen while the tape goes in) night-drive\n${shotText(app)}\n`);
      });
    }
  }
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--out');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = i >= 0 ? path.resolve(process.argv[i + 1]) : path.join(here, '..', 'captures');
  if (process.argv.includes('--cartridges')) { // only the console captures (about 10 s instead of the whole set)
    const only = await runCaptureCartridges({ outDir: out });
    console.log('wrote ' + only.length + ' cartridge files to ' + out);
    process.exit(0);
  }
  const files = runCapture({ outDir: out });
  const more = runCaptureModes({ outDir: out });
  const art = runCaptureGallery({ outDir: out });
  const carts = await runCaptureCartridges({ outDir: out });
  console.log(`wrote ${files.length} calm files, ${more.length} mode files, ${art.length} gallery files and ${carts.length} cartridge files to ${out}`);
}
