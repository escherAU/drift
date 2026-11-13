// DRIFT-8 C5: the rig for the shell clock test. A REAL createApp (the same options bin/drift.js builds with parseOptions, the real loop and the
// real renderer) driven by node's mock timers: nothing waits for wall time. The app's own clock is `now`, which this rig owns, so the loop's dt
// is exactly the milliseconds the rig stepped, and a flow is timed in those milliseconds from the key that starts it to the frame that ends it.
//
// What is observed, and why (the shell hides its animation clocks, so the rig reads only what the app shows):
//   screen flows (insert, boot, eject, error card)   app.getState().shell.screen, read at every loop tick
//   ramp flows (fade, slide, dip, message, scrub, menu, help, program switch, season)
//                                                    the renderer spy: renderFrame() calls renderer.render once per drawn frame, and the shell asks for a
//                                                    frame (dirty) for as long as the flow animates and for no longer, so the LAST render of a burst is the
//                                                    tick on which the flow finished. (Not the last CHANGED frame: the dip is invisible after 0.25 s of its 0.3.)
// The library runs at 60x20 (the list tier): the full and compact tiers redraw an idle animation (the LED, the scan, the cursor) that would put renders
// after a flow and blur where it ends. The flows themselves do not depend on the tier.
import { mock } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, parseOptions } from '../src/app.js';
import { defaultConfigPath } from '../src/config.js';
import { createRenderer } from '../src/renderer.js';
import { discoverCartridges, loadScenes as realLoadScenes } from '../src/cartridge/loader.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';
import { makeRoot, addSeasonal } from './helpers-shell.js';
import { makeFixtureCartridge } from './helpers-cartridge.js';

let shared = null;
// One cartridge root for the whole file: classic, fixture, locker (locked), seasonal (has skin seasons), zfail (a fixture whose load is made to fail).
// Scenes are loaded once with real I/O before any timer is mocked, then handed back at once, so the insert never waits on the file system.
export async function sharedCarts() {
  if (shared) return shared;
  const root = makeRoot();
  addSeasonal(root);
  makeFixtureCartridge(root, 'zfail');
  const dirs = [{ dir: root, trusted: true }];
  const found = discoverCartridges({ dirs });
  const loaded = new Map();
  for (const c of found.cartridges) if (!c.locked && c.runtime !== 'classic') loaded.set(c.id, await realLoadScenes(c));
  shared = { root, dirs, loaded, found };
  return shared;
}
export function disposeShared() { if (shared) { fs.rmSync(shared.root, { recursive: true, force: true }); shared = null; } }

// Burst analysis: render times -> runs of consecutive frames (a gap of more than 1.6 frames ends a run).
export function bursts(times, frameMs) {
  const out = [];
  let cur = null;
  for (const t of times) {
    if (cur && t - cur.last <= frameMs * 1.6 + 2) { cur.last = t; cur.n++; } else { cur = { first: t, last: t, n: 1 }; out.push(cur); }
  }
  return out;
}

// The seconds of game time one loop frame adds: 1/fps, but the app never leaps more than 0.25 s after a stall (src/app.js loop), so below 4 fps a
// frame adds 0.25 s while 1/fps of real time goes by. scale = real seconds per game second.
export const gameStep = (fps) => Math.min(1 / fps, 0.25);
export const realPerGame = (fps) => (1 / fps) / gameStep(fps);

export async function makeRig({ fps, env = {}, cols = 60, rows = 20, config } = {}) {
  const sh = await sharedCarts();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-clock-'));
  const envFull = { COLORTERM: 'truecolor', ...env };
  if (config) {
    envFull.DRIFT_CONFIG = path.join(tmp, 'cfg', 'config.json');
    fs.mkdirSync(path.dirname(envFull.DRIFT_CONFIG), { recursive: true });
    fs.writeFileSync(envFull.DRIFT_CONFIG, JSON.stringify(config));
  }
  const configPath = envFull.DRIFT_CONFIG ? defaultConfigPath(envFull) : path.join(tmp, 'cfg', 'config.json');
  const opts = parseOptions(fps === undefined ? [] : ['--fps', String(fps)], envFull); // what main() does with argv and the environment
  const realFps = opts.fps;

  let ms = 1000, nowCalls = 0;
  const now = () => { nowCalls++; return ms; };
  const renders = [];
  const realRenderer = createRenderer();
  const renderer = {
    render(a) { renders.push({ ms }); return realRenderer.render(a); },
    invalidate() { realRenderer.invalidate(); },
  };
  const stdin = fakeStdin(), stdout = fakeStdout({ columns: cols, rows }), proc = fakeProc();
  const wrote = []; // { ms, s } for every write
  const origWrite = stdout.write;
  stdout.write = (s, cb) => { wrote.push({ ms, s: String(s) }); return origWrite(s, cb); };
  const loadScenes = (cart) => (cart.id === 'zfail'
    ? Promise.resolve({ scenes: null, errors: [{ reason: 'this cartridge cannot be loaded (made up for the test)' }] })
    : Promise.resolve(sh.loaded.get(cart.id)));
  mock.timers.enable({ apis: ['setTimeout'] });
  const app = createApp({
    stdin, stdout, stderr: fakeStderr(), proc, env: envFull, ...opts, configPath, dirs: sh.dirs, loadScenes, now, renderer, startScreen: null,
  });
  app.start();

  const frameMs = 1000 / realFps;
  const rig = {
    app, stdin, stdout, proc, renders, wrote, fps: realFps, frameMs, opts,
    get ms() { return ms; },
    get nowCalls() { return nowCalls; },
    shell: () => app.getState().shell,
    screen: () => { const s = app.getState().shell; return s ? s.screen : 'classic'; },
    micro: async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); },
    step() { ms += 1; mock.timers.tick(1); },
    // advance 1 ms at a time (the loop's timer fires on the step it is due); cond is read at the start and after each loop tick only, so reading state stays cheap
    async until(cond, capMs, what) {
      const end = ms + capMs;
      let seen = nowCalls;
      if (cond()) return ms;
      for (;;) {
        if (ms >= end) throw new Error(`timed out after ${capMs} ms waiting for ${what}`);
        rig.step();
        if (nowCalls !== seen) { seen = nowCalls; await rig.micro(); if (cond()) return ms; }
      }
    },
    // the same, but cond (a function of the clock alone) is read every millisecond
    async untilMs(cond, capMs, what) {
      const end = ms + capMs;
      let seen = nowCalls;
      while (!cond()) {
        if (ms >= end) throw new Error(`timed out after ${capMs} ms waiting for ${what}`);
        rig.step();
        if (nowCalls !== seen) { seen = nowCalls; await rig.micro(); }
      }
      return ms;
    },
    // stop just after a loop tick, in the same millisecond, so a key lands exactly on a frame boundary
    async aligned() { const seen = nowCalls; await rig.until(() => nowCalls !== seen, 5 * frameMs + 50, 'a loop tick'); },
    async key(k) { stdin.emit('data', k); await rig.micro(); },
    // no render for `gameSeconds` of game time (real time is scaled when fps is below 4)
    async quiet(gameSeconds) {
      const q = gameSeconds * 1000 * realPerGame(realFps), t0 = ms;
      await rig.untilMs(() => ms - Math.max(t0, renders.length ? renders[renders.length - 1].ms : 0) >= q, q * 40 + 120000, 'a quiet screen');
    },
    // press a key on a frame boundary, wait for quiet, return the render bursts as ms from the key
    async measure(k, quietSeconds = 1.5) {
      await rig.aligned();
      const k0 = ms, r0 = renders.length, w0 = wrote.length;
      await rig.key(k);
      await rig.quiet(quietSeconds);
      const times = renders.slice(r0).map((r) => r.ms);
      const bs = bursts(times, frameMs).map((b) => ({ first: b.first - k0, last: b.last - k0, n: b.n }));
      return { k0, bursts: bs, writes: wrote.slice(w0).map((w) => w.s), renders: times.length };
    },
    // move the cursor to a cartridge with presses far enough apart that each is a lone slide (not a scrub)
    async goto(id) {
      for (let i = 0; i < 8 && rig.shell().cartridge !== id; i++) { await rig.key('\x1b[C'); await rig.quiet(1.2); }
      if (rig.shell().cartridge !== id) throw new Error(`cursor did not reach ${id}`);
    },
    // the speed index the key presses reach from the default (3 = 1x): + or - that many times
    async speedKeys(idx) {
      const d = idx - 3;
      for (let i = 0; i < Math.abs(d); i++) await rig.key(d > 0 ? '+' : '-');
    },
    done() {
      app.quit(0);
      mock.timers.reset();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
  return rig;
}

const RIGHT = '\x1b[C', DOWN = '\x1b[B', ESC = '\x1b', ENTER = '\r';

// Every shell flow, one after the other, on one app. Classic and the cartridge runtime are both put at speed index `speedIdx` first (SPEEDS in
// src/app.js; the keys are + and -), and the Classic scene and the running scene are paused so that nothing else draws while a flow is timed.
// Returns each flow's time in ms, from its key (pressed on a loop-tick boundary) to the tick that finished it, and the raw bursts for the structure checks.
export async function runFlows(rig, speedIdx) {
  const cap = 90000 * realPerGame(rig.fps);
  const out = { raw: {} };
  const burst = (name, m, i) => { out.raw[name] = m.bursts; return m.bursts[i < 0 ? m.bursts.length + i : i]; };

  await rig.until(() => rig.nowCalls >= 8, 12 * rig.frameMs + 2000, 'the first frames');
  await rig.key('p'); // Classic held: it draws nothing while a flow is timed
  await rig.speedKeys(speedIdx);
  out.classicSpeed = rig.app.getState().speed; // the + and - keys reached Classic
  await rig.quiet(0.5);
  // (a start config that is inverted high contrast holds the first background flip for FLIP_WINDOW_SECONDS, 3 s: open the library after that)
  const t3 = rig.ms + 3300 * realPerGame(rig.fps);
  await rig.untilMs(() => rig.ms >= t3, 90000, 'the flip window');

  // library: opened from Classic (the fade), a lone slide, the locked dip and message, the shelf scrub
  let m = await rig.measure('l', 1.5);
  out.libFade = burst('libFade', m, 0).last;
  m = await rig.measure(RIGHT, 1.5);
  out.slide = burst('slide', m, 0).last;
  await rig.goto('locker');
  m = await rig.measure(ENTER, 3.2);
  out.dip = burst('dip', m, 0).last;
  out.message = burst('message', m, -1).last;
  // two quick presses: the second makes the art wait (stale); once the flash gate opens it dissolves back (out) in SCRUB_OUT_SECONDS
  await rig.aligned();
  const r0 = rig.renders.length, k0 = rig.ms;
  await rig.key(RIGHT);
  await rig.aligned();
  await rig.key(RIGHT);
  await rig.quiet(2);
  const sb = bursts(rig.renders.slice(r0).map((r) => r.ms), rig.frameMs).map((b) => ({ first: b.first - k0, last: b.last - k0, n: b.n }));
  out.raw.scrub = sb;
  out.scrubOut = sb[sb.length - 1].last - sb[sb.length - 1].first;
  out.scrubFirstOut = sb[sb.length - 1].first;

  // insert and boot of the cartridge with skin seasons
  await rig.goto('seasonal');
  await rig.aligned();
  let t0 = rig.ms;
  await rig.key(ENTER);
  if (rig.screen() !== 'insert') throw new Error(`Enter did not insert: ${rig.screen()}`);
  const tBoot = await rig.until(() => rig.screen() !== 'insert', cap, 'the insert to end');
  out.insert = tBoot - t0;
  if (rig.screen() !== 'boot') throw new Error(`insert ended on ${rig.screen()}`);
  const tRun = await rig.until(() => rig.screen() === 'running', cap, 'the boot to end');
  out.boot = tRun - tBoot;

  // running: hold the scene (the ramps still run), then speed
  await rig.key('p');
  await rig.quiet(1);
  await rig.speedKeys(speedIdx);
  m = await rig.measure(ESC, 1.5); // the menu is open on arrival: Esc ramps it out
  out.menuOut = burst('menuOut', m, 0).last;
  m = await rig.measure(ENTER, 1.5);
  out.menuIn = burst('menuIn', m, 0).last;
  await rig.measure(ESC, 1.5);
  m = await rig.measure('h', 1.5);
  out.helpIn = burst('helpIn', m, 0).last;
  m = await rig.measure('h', 1.5);
  out.helpOut = burst('helpOut', m, 0).last;
  await rig.measure(ENTER, 1.5); // the menu again
  await rig.key(DOWN); // ... on Calm
  await rig.quiet(1);
  m = await rig.measure(ENTER, 3);
  out.switch = burst('switch', m, -1).last;
  m = await rig.measure('c', 1.5);
  out.season = burst('season', m, -1).last;

  // eject (the running picture dissolves, then the insert animation plays backwards), then an insert that fails to load: the error card
  await rig.aligned();
  t0 = rig.ms;
  await rig.key('e');
  if (rig.screen() !== 'eject') throw new Error(`e did not eject: ${rig.screen()}`);
  out.eject = (await rig.until(() => rig.screen() === 'library', cap, 'the eject to end')) - t0;
  await rig.quiet(1.5);
  await rig.goto('zfail');
  await rig.aligned();
  await rig.key(ENTER);
  const tErr = await rig.until(() => rig.screen() === 'error', cap, 'the error card');
  out.error = (await rig.until(() => rig.screen() === 'library', cap, 'the error card to end')) - tErr;
  return out;
}

// The eject as the terminal receives it: every byte written from the e key to quiet, the scene held (the same picture at 1x and at 4x)
export async function ejectBytes(rig, speedIdx) {
  await rig.until(() => rig.nowCalls >= 8, 12 * rig.frameMs + 2000, 'the first frames');
  await rig.key('p');
  await rig.speedKeys(speedIdx);
  await rig.quiet(0.5);
  await rig.key('l');
  await rig.quiet(1.5);
  await rig.goto('seasonal');
  await rig.aligned();
  await rig.key(ENTER);
  await rig.until(() => rig.screen() === 'boot', 90000, 'the boot');
  await rig.until(() => rig.screen() === 'running', 90000, 'running');
  await rig.key('p'); // on the arrival tick: the scene time is the same whatever the speed was
  await rig.speedKeys(speedIdx);
  await rig.quiet(1.5);
  const m = await rig.measure('e', 2.5);
  return m.writes;
}
