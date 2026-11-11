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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../src/app.js';
import { PLAYLISTS, findScene } from '../src/scenes/index.js';
import { MODES } from '../src/modes.js';
import { ENTER, LEAVE } from '../src/term.js';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';

// Every scene of every mode (with its mode), then the calm mix.
export function measureTargets() {
  return [...MODES.flatMap((m) => PLAYLISTS[m].map((sc) => ({ scene: sc.id, mode: m }))), { scene: 'mix', mode: 'calm' }];
}

// Console runs (DRIFT-4): `library` measures the cartridge library (right arrow every `cycle` seconds when
// given); `cartridge` = { id, program?, scene? } measures a running cartridge: the boot is skipped and sampling
// starts only after app.whenRunning(), so the load is not in the numbers (it is reported as loadMs).
export function runMeasure({ seconds = 60, cols = 240, rows = 67, scene = 'mix', mode = 'calm', fps = 18, sampleMs = 1000, mixSceneSeconds = 10, mixFadeSeconds = 4, quiet = false, library = false, cycle = 0, cartridge = null, dirs = null } = {}) {
  return new Promise((resolve, reject) => {
    if (cartridge) {
      const c = discoverCartridges({ dirs: dirs || [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.find((x) => x.id === cartridge.id);
      if (!c) { reject(new Error(`no cartridge called '${cartridge.id}'`)); return; }
      if (c.locked || !c.manifest.scenes) { reject(new Error(`cartridge '${cartridge.id}' has no scenes to measure (${c.locked ? 'it is locked' : 'it is Classic: use --scene'})`)); return; }
    }
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
    const consoleRun = !!(library || cartridge);
    // a console run persists lastCartridge on insert, so it gets a throwaway config folder
    const tmpCfg = consoleRun ? fs.mkdtempSync(path.join(os.tmpdir(), 'drift-measure-')) : null;
    const app = createApp({
      stdin, stdout, stderr: sink, proc, env: { COLORTERM: 'truecolor' },
      configPath: tmpCfg ? path.join(tmpCfg, 'config.json') : path.join(os.tmpdir(), 'drift-measure-none', 'config.json'),
      fps, seed: 1, startScene, startMode,
      sceneSeconds: mix ? mixSceneSeconds : 1e9,
      fadeSeconds: mixFadeSeconds,
      ...(consoleRun ? { dirs: dirs || [{ dir: INSTALL_DIR, trusted: true }], startScreen: cartridge ? { screen: 'cartridge', cartridge: cartridge.id, skipBoot: true } : { screen: 'library' } } : {}),
    });
    const samples = [];
    let lastCpu = process.cpuUsage(), lastWall = process.hrtime.bigint();
    let t0 = Date.now();
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
    let total0, wall0, iv = null, loadMs = null;
    const begin = () => {
      t0 = Date.now(); lastCpu = process.cpuUsage(); lastWall = process.hrtime.bigint();
      total0 = process.cpuUsage();
      wall0 = process.hrtime.bigint();
      iv = setInterval(sample, sampleMs);
    };
    proc.exit = () => {
      if (iv) clearInterval(iv);
      if (!iv) { if (tmpCfg) fs.rmSync(tmpCfg, { recursive: true, force: true }); return; } // stopped before sampling began
      if (tmpCfg) fs.rmSync(tmpCfg, { recursive: true, force: true });
      if (Date.now() - t0 - samples.length * sampleMs >= 300) sample();
      const tc = process.cpuUsage(total0);
      const wallSec = Number(process.hrtime.bigint() - wall0) / 1e9;
      const cores = os.cpus().length;
      const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
      const cpuCoreMean = (tc.user + tc.system) / 1e6 / wallSec;
      const steady = samples.slice(1);
      resolve({
        ...stats, samples, wallSec, mode: startMode, loadMs,
        summary: {
          cores, cpuCoreMean, cpuMachineMean: cpuCoreMean / cores,
          cpuCoreSteady: mean((steady.length ? steady : samples).map((s) => s.cpuCore)),
          cpuCoreMax: Math.max(...samples.map((s) => s.cpuCore)),
          rssMeanMB: mean(samples.map((s) => s.rssMB)), rssPeakMB: Math.max(...samples.map((s) => s.rssMB)),
          bytesPerSec: stats.bytes / wallSec, framesPerSec: stats.frames / wallSec,
        },
      });
    };
    if (!consoleRun) {
      begin();
      app.start();
      setTimeout(() => app.quit(0), seconds * 1000);
      return;
    }
    // console runs: start, wait for the screen to be up, then sample
    const loadStart = Date.now();
    app.start();
    const go = () => {
      stats.frames = 0; stats.bytes = 0;
      begin();
      if (library && cycle > 0) setInterval(() => stdin.emit('data', '\x1b[C'), cycle * 1000).unref();
      setTimeout(() => app.quit(0), seconds * 1000);
    };
    const up = cartridge
      ? Promise.race([app.whenRunning(), new Promise((res) => setTimeout(() => res('timeout'), 30000).unref())])
      : Promise.resolve(true);
    up.then(async (ok) => {
      if (ok !== true) throw new Error(ok === 'timeout' ? 'the cartridge did not start within 30 s' : 'the cartridge did not start');
      loadMs = Date.now() - loadStart;
      if (cartridge) {
        const err = await chooseInCartridge(app, stdin, cartridge, dirs || [{ dir: INSTALL_DIR, trusted: true }]);
        if (err) throw new Error(err);
      }
      go();
    }).catch((e) => { app.quit(1); reject(e); });
  });
}

// Pick --program and --scene inside a running cartridge with the same keys a person uses: Enter opens the
// menu, down moves, Enter chooses; space skips to the next scene. A program switch dissolves for
// DISSOLVE_SECONDS and a scene only counts as reached once its fade has finished (a crossfade program can
// take its whole fade length per hop), so sampling starts on a settled scene. Resolves to an error text, or null.
async function chooseInCartridge(app, stdin, { id, program, scene }, dirs) {
  const key = (k) => stdin.emit('data', k);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cart = discoverCartridges({ dirs }).cartridges.find((c) => c.id === id);
  const m = cart && cart.manifest;
  if (!m || !m.programs) return `cartridge '${id}' has no programs`;
  if (program !== undefined) {
    const list = m.menu || [...m.programs.map((p) => ({ program: p.id })), { action: 'eject' }];
    const at = list.findIndex((e) => e.program === program);
    if (at < 0) return `cartridge '${id}' has no program '${program}' in its menu`;
    if (app.getState().shell.program !== program) {
      key('\r'); // the menu opens at its first entry
      for (let i = 0; i < at; i++) key('\x1b[B');
      key('\r');
      if (app.getState().shell.program !== program) return `could not switch to program '${program}'`;
      await sleep(2500);
    }
  }
  if (scene !== undefined) {
    const sceneOf = () => app.getState().shell.sceneId;
    const prog = m.programs.find((p) => p.id === app.getState().shell.program);
    if (!prog || !prog.scenes.includes(scene)) return `program '${prog && prog.id}' does not hold scene '${scene}'`;
    for (let hop = 0; hop < prog.scenes.length && sceneOf() !== scene; hop++) {
      const before = sceneOf();
      key(' ');
      const until = Date.now() + 90000;
      while (sceneOf() === before && Date.now() < until) await sleep(50);
    }
    if (sceneOf() !== scene) return `could not reach scene '${scene}'`;
  }
  return null;
}

// Every scene of every unlocked install cartridge that runs scenes (Classic and locked ones have none),
// each with the first program that holds it.
export function cartridgeTargets(dirs = [{ dir: INSTALL_DIR, trusted: true }]) {
  const out = [];
  for (const c of discoverCartridges({ dirs }).cartridges) {
    if (c.locked || !c.manifest.scenes) continue;
    for (const sc of c.manifest.scenes) {
      const p = c.manifest.programs.find((x) => x.scenes.includes(sc.id));
      if (p) out.push({ cartridge: c.id, program: p.id, scene: sc.id });
    }
  }
  return out;
}

// Console options (DRIFT-4), in addition to the usage line in the header:
//   --library [--cycle N]                 the cartridge library; press right arrow every N seconds
//   --cartridge <id> [--program P] [--scene S]   a running cartridge (boot skipped; sampling starts once it runs)
//   --cartridge all                       one fresh process per unlocked cartridge scene
async function cli() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const seconds = Number(arg('--seconds', 60)), cols = Number(arg('--cols', 240)), rows = Number(arg('--rows', 67));
  const fps = Number(arg('--fps', 18)), scene = arg('--scene', 'mix'), mode = arg('--mode', 'calm');
  const cartId = arg('--cartridge', undefined);
  if (cartId === 'all') {
    const here = fileURLToPath(import.meta.url);
    const targets = cartridgeTargets();
    if (targets.length === 0) {
      console.log('measure: no unlocked cartridge has scenes to measure (Classic and the locked cartridges have none). Use --scene all for Classic.');
      return;
    }
    for (const t of targets) {
      spawnSync(process.execPath, [here, '--seconds', String(seconds), '--cols', String(cols), '--rows', String(rows), '--fps', String(fps), '--cartridge', t.cartridge, '--program', t.program, '--scene', t.scene], { stdio: 'inherit' });
    }
    return;
  }
  if (cartId !== undefined || argv.includes('--library')) {
    const cartridge = cartId !== undefined ? { id: cartId, program: arg('--program', undefined), scene: arg('--scene', undefined) } : null;
    const cycle = Number(arg('--cycle', 0));
    const what = cartridge ? `cartridge=${cartId}${cartridge.program ? ' program=' + cartridge.program : ''}${cartridge.scene ? ' scene=' + cartridge.scene : ''}` : `library${cycle > 0 ? ' cycle=' + cycle + 's' : ' idle'}`;
    console.log(`measure: ${what} size=${cols}x${rows} fps=${fps} for ${seconds}s (real app loop, fake TTY that counts bytes)`);
    let r;
    try { r = await runMeasure({ seconds, cols, rows, fps, library: !cartridge, cycle, cartridge }); } catch (e) { console.log(`measure: ${e.message}`); process.exit(2); }
    const s = r.summary;
    const tag = cartridge ? `cartridge=${cartId} program=${cartridge.program || '-'} scene=${cartridge.scene || '-'}` : `library cycle=${cycle}`;
    console.log(`RESULT ${tag} size=${cols}x${rows} frames=${r.frames} (${s.framesPerSec.toFixed(1)}/s) bytes=${r.bytes} bytes/s=${s.bytesPerSec.toFixed(0)} (${(s.bytesPerSec / 1024).toFixed(1)} KB/s)`);
    console.log(`RESULT cpu_core_mean=${(s.cpuCoreMean * 100).toFixed(2)}% steady=${(s.cpuCoreSteady * 100).toFixed(2)}% max=${(s.cpuCoreMax * 100).toFixed(2)}% machine(${s.cores} logical)=${(s.cpuMachineMean * 100).toFixed(3)}% rss_mean=${s.rssMeanMB.toFixed(1)}MB rss_peak=${s.rssPeakMB.toFixed(1)}MB`);
    console.log(`RESULT load_ms=${r.loadMs}`);
    process.exit(0);
  }
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
