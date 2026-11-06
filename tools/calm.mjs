// Calmness metric. Runs the same scene -> composer pipeline the app uses
// (hysteresis included) at a fixed fps and counts, between consecutive frames:
//   frac     fraction of cells whose glyph OR colour level changed
//              (blank cells have no colour, so only their glyph counts)
//   meanAbs  mean absolute change of the 0..255 intensity per cell
// Reported per scene as mean and max of frac over the run, and mean of meanAbs.
//
//   node tools/calm.mjs [--seconds 60] [--fps 18]
import { SCENES } from '../src/scenes/index.js';
import { createComposer } from '../src/compose.js';
import { pathToFileURL } from 'node:url';

export function measureCalm({ sceneIndex, cols, rows, seconds = 60, fps = 18, seeds = [1], timeScale = 1, scenes = SCENES }) {
  let sumFrac = 0, maxFrac = 0, sumAbs = 0, frames = 0;
  const n = cols * rows;
  for (const seed of seeds) {
    const comp = createComposer({ scenes, cols, rows, seed });
    const st = { a: sceneIndex, b: sceneIndex, p: 0 };
    const total = Math.round(seconds * fps);
    let pg = null, ps = null, pf = null;
    const t0 = 5 + seed * 3; // start away from t=0 so every scene is in full swing
    for (let k = 0; k <= total; k++) {
      const f = comp.frame(st, (t0 + k / fps) * timeScale);
      if (pg) {
        let changed = 0, abs = 0;
        for (let i = 0; i < n; i++) {
          const g = f.glyphs[i];
          const s = g === 32 ? 0 : f.shades[i];
          if (g !== pg[i] || s !== ps[i]) changed++;
          abs += Math.abs(f.field[i] - pf[i]);
        }
        const frac = changed / n;
        sumFrac += frac; sumAbs += abs / n; frames++;
        if (frac > maxFrac) maxFrac = frac;
      } else {
        pg = new Uint16Array(n); ps = new Uint8Array(n); pf = new Uint8Array(n);
      }
      for (let i = 0; i < n; i++) { const g = f.glyphs[i]; pg[i] = g; ps[i] = g === 32 ? 0 : f.shades[i]; pf[i] = f.field[i]; }
    }
  }
  return { meanFrac: sumFrac / frames, maxFrac, meanAbs: sumAbs / frames, frames };
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
  const seconds = arg('--seconds', 60), fps = arg('--fps', 18);
  const rowsOut = [];
  for (const [cols, rows] of [[120, 40], [240, 67]]) {
    for (const [i, sc] of SCENES.entries()) {
      const c = measureCalm({ sceneIndex: i, cols, rows, seconds, fps, seeds: [1, 2, 3] });
      rowsOut.push(`| ${sc.id.padEnd(8)} | ${cols}x${rows}`.padEnd(24) + ` | ${(c.meanFrac * 100).toFixed(2).padStart(6)}% | ${(c.maxFrac * 100).toFixed(2).padStart(6)}% | ${c.meanAbs.toFixed(3).padStart(7)} |`);
    }
  }
  console.log(`calmness at ${fps} fps, ${seconds} s per run, seeds 1-3 (frac = cells whose glyph or colour level changed between frames)`);
  console.log('| scene    | size       | mean frac | max frac | mean abs dI |');
  console.log('|----------|------------|-----------|----------|-------------|');
  for (const r of rowsOut) console.log(r);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
