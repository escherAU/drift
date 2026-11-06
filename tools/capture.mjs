// Headless frame capture: node tools/capture.mjs [--out captures]
// Writes, for each of the 5 scenes and a cross-fade, at 120x40 and 240x67:
//   <name>-<cols>x<rows>.txt   glyph characters only
//   <name>-<cols>x<rows>.ansi  same frames with truecolor SGR (Claude orange)
// Frames are taken at t = 0, 5, 10, 20 s, each from a fresh composer, so the
// output is fully deterministic. The cross-fade runs squiggle -> sunburst over
// 20 s (progress eased), so t=0 is pure squiggle and t=20 is pure sunburst.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCENES } from '../src/scenes/index.js';
import { createComposer, smoothstep } from '../src/compose.js';
import { frameToText, frameToAnsi } from '../src/renderer.js';
import { makePalette, presetRGB } from '../src/color.js';

export const CAPTURE_NAMES = [...SCENES.map((s) => s.id), 'crossfade'];
const SIZES = [[120, 40], [240, 67]];
const TIMES = [0, 5, 10, 20];
const FADE_SEC = 20;

export function runCapture({ outDir, sizes = SIZES, times = TIMES, seed = 1 }) {
  fs.mkdirSync(outDir, { recursive: true });
  const palette = makePalette(presetRGB('claude', 0), 'truecolor');
  const written = [];
  for (const name of CAPTURE_NAMES) {
    for (const [cols, rows] of sizes) {
      let txt = '', ansi = '';
      for (const sec of times) {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--out');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = i >= 0 ? path.resolve(process.argv[i + 1]) : path.join(here, '..', 'captures');
  const files = runCapture({ outDir: out });
  console.log(`wrote ${files.length} files to ${out}`);
}
