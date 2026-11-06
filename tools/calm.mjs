// Calmness metric. Runs the same scene -> composer pipeline the app uses
// (hysteresis included) at a fixed fps and counts, between consecutive frames:
//   frac     fraction of cells whose glyph OR colour level changed
//              (blank cells have no colour, so only their glyph counts)
//   meanAbs  mean absolute change of the 0..255 intensity per cell
// Reported per scene as mean and max of frac over the run, and mean of meanAbs.
//
//   node tools/calm.mjs [--seconds 60] [--fps 18]
import { SCENES } from '../src/scenes/index.js';
import { createComposer, smoothstep } from '../src/compose.js';
import { DEFAULT_FADE_SECONDS } from '../src/app.js';
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

// Same metric through one full cross-fade a -> b, driven exactly as the
// Scheduler does (p = smoothstep(progress)), at the app's fade length by default.
// Scene time runs at 1x. The composer is warmed up on pure A first.
export function measureFade({ a, b, cols, rows, fadeSec = DEFAULT_FADE_SECONDS, fps = 18, seed = 1, t0 = 8, scenes = SCENES }) {
  const n = cols * rows;
  const comp = createComposer({ scenes, cols, rows, seed });
  const total = Math.max(1, Math.round(fadeSec * fps));
  const warm = 18;
  let pg = null, ps = null, sum = 0, max = 0, frames = 0;
  for (let k = -warm; k <= total; k++) {
    const p = k <= 0 ? 0 : smoothstep(k / total);
    const f = comp.frame({ a, b, p }, t0 + (k + warm) / fps);
    if (pg && k >= 1) {
      let changed = 0;
      for (let i = 0; i < n; i++) {
        const g = f.glyphs[i];
        if (g !== pg[i] || (g === 32 ? 0 : f.shades[i]) !== ps[i]) changed++;
      }
      const frac = changed / n;
      sum += frac; frames++;
      if (frac > max) max = frac;
    }
    if (!pg) { pg = new Uint16Array(n); ps = new Uint8Array(n); }
    for (let i = 0; i < n; i++) { const g = f.glyphs[i]; pg[i] = g; ps[i] = g === 32 ? 0 : f.shades[i]; }
  }
  return { meanFrac: sum / frames, maxFrac: max, frames };
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

  console.log('');
  console.log(`cross-fades at the shipped default (${DEFAULT_FADE_SECONDS} s, smoothstep with per-cell stagger), ${fps} fps, seed 1 (frac per frame through one full fade)`);
  console.log('| fade                | size       | mean frac | max frac |');
  console.log('|---------------------|------------|-----------|----------|');
  for (const [cols, rows] of [[120, 40], [240, 67]]) {
    for (let a = 0; a < SCENES.length; a++) {
      const b = (a + 1) % SCENES.length;
      const c = measureFade({ a, b, cols, rows, fps });
      const name = `${SCENES[a].id} > ${SCENES[b].id}`;
      console.log(`| ${name.padEnd(19)} | ${(cols + 'x' + rows).padEnd(10)} | ${(c.meanFrac * 100).toFixed(2).padStart(8)}% | ${(c.maxFrac * 100).toFixed(2).padStart(7)}% |`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
