// Headless frame capture: node tools/capture.mjs [--out captures]
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--out');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = i >= 0 ? path.resolve(process.argv[i + 1]) : path.join(here, '..', 'captures');
  const files = runCapture({ outDir: out });
  const more = runCaptureModes({ outDir: out });
  console.log(`wrote ${files.length} calm files and ${more.length} mode files to ${out}`);
}
