// Headless frame capture: node tools/capture.mjs [--out captures] [--cartridges]   (--cartridges: only the cartridge console files)
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
import { EJECT_SECONDS } from '../src/shell/shell.js';

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
//                          <ms> after `e`, at the same fractions of EJECT_SECONDS as the insert moments are of INSERT_END
//   cart-help-classic-120x40.txt   the help panel (h) while Classic runs, after the console has handed back to it
// Unlocked cartridges only get insert/boot/eject. Driven through the real app on a fake terminal, with a fake clock.
const CART_DT = 1 / 18;
const CART_SIZES = [[120, 40], [80, 24]];
// seconds after Enter: the insert is over at INSERT_END (1.5 s), the boot runs on to about 5.8 s
export const CART_MOMENTS = [0.4, 0.9, 1.25, 1.6, 2.5, 3.6, 4.2, 5.0, 5.6];
export const EJECT_MOMENTS = CART_MOMENTS.filter((m) => m < INSERT_END).map((m) => (m / INSERT_END) * EJECT_SECONDS);
const CART_DIRS = () => [{ dir: INSTALL_DIR, trusted: true }];
const sizeTag = (cols, rows) => (cols === 120 && rows === 40 ? '' : `-${cols}x${rows}`);
const ms = (sec) => Math.round(sec * 1000);

const installed = (dirs) => discoverCartridges({ dirs: dirs || CART_DIRS() }).cartridges;
const isShellRun = (c) => c.manifest && c.manifest.runtime !== 'classic';

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
  return names;
}

function cartApp(seed, cols, rows, dirs) {
  const stdin = new EventEmitter();
  Object.assign(stdin, { isTTY: true, setRawMode() { return stdin; }, resume() { return stdin; }, pause() { return stdin; }, unref() {}, ref() {}, setEncoding() { return stdin; } });
  const stdout = new EventEmitter();
  Object.assign(stdout, { isTTY: true, columns: cols, rows, write(_s, cb) { if (typeof cb === 'function') cb(); return true; } });
  const proc = new EventEmitter();
  proc.exit = () => {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-capture-cart-'));
  const app = createApp({
    stdin, stdout, stderr: { write() { return true; } }, proc, env: { COLORTERM: 'truecolor' },
    configPath: path.join(dir, 'config.json'), dirs, autoLoop: false, seed, startScreen: { screen: 'library' },
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
    for (let i = 0; i < n + 1 && app.getState().shell.cartridge !== id; i++) { app.handleKey('\x1b[C'); app.tick(0.5); }
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

export async function runCaptureCartridges({ outDir, seed = 1, dirs = CART_DIRS() }) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const put = (name, text) => { const f = path.join(outDir, name); fs.writeFileSync(f, text); written.push(f); };
  const found = installed(dirs);
  const classicId = (found.find((c) => !isShellRun(c)) || found[0] || {}).id;

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
        app.handleKey('\x1b'); // close the menu
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
