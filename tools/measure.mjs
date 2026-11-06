// CPU / memory harness. Runs the REAL app (createApp: same scene maths,
// compose, hysteresis, diff renderer, same fps timer) against a fake TTY whose
// write() only counts bytes. Samples process CPU and RSS once a second.
//
// Includes: scene maths, cross-fade, band mapping, diff + string build,
//           the timer loop, Node/V8 itself (GC, JIT), the byte counting.
// Excludes: the real console / Windows Terminal parsing and drawing the bytes
//           (that cost lives in another process and is NOT measured here).
//
// Also reported: bytes per second written (the terminal-side cost scales with it).
// Modes: a scene name starts in that scene's own mode (glyphrain = chaos, life = high
// contrast, bounce = experimental); `--mode M` sets the start mode for `mix`; `--scene all`
// runs every scene of every mode, then the calm mix, one fresh node process each.
//
//   node tools/measure.mjs --seconds 60 --cols 240 --rows 67 [--scene mix|<scene id>|all] [--mode calm|chaos|contrast|experimental] [--fps 18]
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../src/app.js';
import { PLAYLISTS, findScene } from '../src/scenes/index.js';
import { MODES } from '../src/modes.js';
import { ENTER, LEAVE } from '../src/term.js';

// Every scene of every mode (with its mode), then the calm mix.
export function measureTargets() {
  return [...MODES.flatMap((m) => PLAYLISTS[m].map((sc) => ({ scene: sc.id, mode: m }))), { scene: 'mix', mode: 'calm' }];
}

export function runMeasure({ seconds = 60, cols = 240, rows = 67, scene = 'mix', mode = 'calm', fps = 18, sampleMs = 1000, mixSceneSeconds = 10, mixFadeSeconds = 4, quiet = false } = {}) {
  return new Promise((resolve) => {
    const stdin = new EventEmitter();
    Object.assign(stdin, { isTTY: true, setRawMode() { return stdin; }, resume() { return stdin; }, pause() { return stdin; }, unref() {}, ref() {}, setEncoding() { return stdin; } });
    const stats = { frames: 0, bytes: 0, firstWrite: null, lastWrite: null };
    const stdout = new EventEmitter();
    Object.assign(stdout, {
      isTTY: true, columns: cols, rows,
      write(s, cb) {
        if (stats.firstWrite === null) stats.firstWrite = s;
        stats.lastWrite = s;
        if (s !== ENTER && s !== LEAVE) { stats.frames++; stats.bytes += Buffer.byteLength(s); }
        if (typeof cb === 'function') cb();
        return true;
      },
    });
    const proc = new EventEmitter();
    const sink = { write(_s, cb) { if (cb) cb(); return true; } };
    const mix = scene === 'mix';
    const found = mix ? null : findScene(scene);
    const startMode = found ? found.mode : (MODES.includes(mode) ? mode : 'calm');
    const startScene = found ? found.index : 0;
    const app = createApp({
      stdin, stdout, stderr: sink, proc, env: { COLORTERM: 'truecolor' },
      configPath: path.join(os.tmpdir(), 'drift-measure-none', 'config.json'),
      fps, seed: 1, startScene, startMode,
      sceneSeconds: mix ? mixSceneSeconds : 1e9,
      fadeSeconds: mixFadeSeconds,
    });
    const samples = [];
    let lastCpu = process.cpuUsage(), lastWall = process.hrtime.bigint();
    const t0 = Date.now();
    const sample = () => {
      const cpu = process.cpuUsage(), wall = process.hrtime.bigint();
      const dCpu = (cpu.user - lastCpu.user) + (cpu.system - lastCpu.system); // microseconds
      const dWall = Number(wall - lastWall) / 1000;
      samples.push({ atSec: (Date.now() - t0) / 1000, cpuCore: dCpu / dWall, rssMB: process.memoryUsage.rss() / 1048576 });
      lastCpu = cpu; lastWall = wall;
      if (!quiet) {
        const s = samples.at(-1);
        console.log(`  t=${s.atSec.toFixed(0).padStart(3)}s cpu(core)=${(s.cpuCore * 100).toFixed(2)}% rss=${s.rssMB.toFixed(1)}MB`);
      }
    };
    const total0 = process.cpuUsage();
    const wall0 = process.hrtime.bigint();
    const iv = setInterval(sample, sampleMs);
    proc.exit = () => {
      clearInterval(iv);
      if (Date.now() - t0 - samples.length * sampleMs >= 300) sample();
      const tc = process.cpuUsage(total0);
      const wallSec = Number(process.hrtime.bigint() - wall0) / 1e9;
      const cores = os.cpus().length;
      const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
      const cpuCoreMean = (tc.user + tc.system) / 1e6 / wallSec;
      const steady = samples.slice(1);
      resolve({
        ...stats, samples, wallSec, mode: startMode,
        summary: {
          cores, cpuCoreMean, cpuMachineMean: cpuCoreMean / cores,
          cpuCoreSteady: mean((steady.length ? steady : samples).map((s) => s.cpuCore)),
          cpuCoreMax: Math.max(...samples.map((s) => s.cpuCore)),
          rssMeanMB: mean(samples.map((s) => s.rssMB)), rssPeakMB: Math.max(...samples.map((s) => s.rssMB)),
          bytesPerSec: stats.bytes / wallSec, framesPerSec: stats.frames / wallSec,
        },
      });
    };
    app.start();
    setTimeout(() => app.quit(0), seconds * 1000);
  });
}

async function cli() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const seconds = Number(arg('--seconds', 60)), cols = Number(arg('--cols', 240)), rows = Number(arg('--rows', 67));
  const fps = Number(arg('--fps', 18)), scene = arg('--scene', 'mix'), mode = arg('--mode', 'calm');
  if (scene === 'all') {
    // one fresh node process per scene so RSS and JIT state do not bleed together
    const here = fileURLToPath(import.meta.url);
    for (const tgt of measureTargets()) {
      spawnSync(process.execPath, [here, '--seconds', String(seconds), '--cols', String(cols), '--rows', String(rows), '--fps', String(fps), '--scene', tgt.scene, '--mode', tgt.mode], { stdio: 'inherit' });
    }
    return;
  }
  const startMode = scene === "mix" ? mode : (findScene(scene) || { mode }).mode;
  console.log(`measure: scene=${scene} start-mode=${startMode} size=${cols}x${rows} fps=${fps} for ${seconds}s (real app loop, fake TTY that counts bytes)`);
  const r = await runMeasure({ seconds, cols, rows, scene, mode, fps });
  const s = r.summary;
  console.log(`RESULT scene=${scene} mode=${r.mode} size=${cols}x${rows} frames=${r.frames} (${s.framesPerSec.toFixed(1)}/s) bytes=${r.bytes} bytes/s=${s.bytesPerSec.toFixed(0)} (${(s.bytesPerSec / 1024).toFixed(1)} KB/s)`);
  console.log(`RESULT cpu_core_mean=${(s.cpuCoreMean * 100).toFixed(2)}% steady=${(s.cpuCoreSteady * 100).toFixed(2)}% max=${(s.cpuCoreMax * 100).toFixed(2)}% machine(${s.cores} logical)=${(s.cpuMachineMean * 100).toFixed(3)}% rss_mean=${s.rssMeanMB.toFixed(1)}MB rss_peak=${s.rssPeakMB.toFixed(1)}MB`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli();
