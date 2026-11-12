// Render-output pin (DRIFT-7 C0). Feeds the real, untouched diff renderer (src/renderer.js createRenderer)
// with fixed, seeded frames and hashes every byte it emits, so any later change to what the renderer
// writes (colour handling, palette keys, diff logic) shows up as a named case.
//
//   node tools/render-hash.mjs            prints one line per case group and `TOTAL <hex>`
//   node tools/render-hash.mjs --list     prints every case with its hash
//   node tools/render-hash.mjs --check    compares with tests/fixtures/render-hash.json; exit 1 on mismatch
//   node tools/render-hash.mjs --write    regenerates tests/fixtures/render-hash.json (records git HEAD + node version)
//
// Cases (each is one createRenderer fed frame after frame; the hash covers every string it returned):
//   cart/<cart>/<scene>/<size>/<cmode>        every install cartridge scene solo, 90 frames at t = k/18
//   dissolve/<cart>/<a>><b>/<size>/<cmode>    each consecutive program pair (and the wrap), the first 2 s of the
//                                             dissolve, 37 frames, p = smoothstep(t / 2) as the Scheduler gives it
//   calm/<scene>/<preset>/<size>/<cmode>      Classic calm scenes, default (claude) and blend presets
//   calm/crossfade/...                        squiggle -> sunburst mid-fade, claude preset
//   chaos/neon/<scene>/..., contrast/normal|inverted/<scene>/..., experimental/<scene>/..
//   app/<variant>/<size>/<cmode>              the real createApp (fake terminal, fake clock), Classic, 10 s;
//                                             the hash covers every byte written to the terminal
// The shell (library, cartridge console) is not covered here on purpose: later commits change it legitimately.
// No wall clock, no Math.random: seeds are 1, time is k/18, the app runs on tick(1/18) with a fake clock.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRenderer } from '../src/renderer.js';
import { createCellComposer } from '../src/cells.js';
import { createComposer, smoothstep } from '../src/compose.js';
import { SCENES, PLAYLISTS } from '../src/scenes/index.js';
import { makePalette, presetRGB, makeMultiPalette, makeTwoTone, DEFAULT_CHAOS_PALETTE } from '../src/color.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { discoverCartridges, loadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { createApp, DISSOLVE_SECONDS } from '../src/app.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE = path.resolve(HERE, '..', 'tests', 'fixtures', 'render-hash.json');

export const FPS = 18;
export const FRAMES = 90;
export const SIZES = [[120, 40], [80, 24], [41, 11]];
export const CMODES = ['truecolor', '256'];
const SEED = 1;
const APP_SECONDS = 10;
const INSTALL_CARTS = ['delza', 'night-drive'];

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Feeds frames to ONE fresh createRenderer and hashes everything it returns (the empty string for "nothing
// changed" included, as a length-prefixed entry, so a lost frame changes the hash too).
function hasher() {
  const h = crypto.createHash('sha256');
  return { add(out) { h.update(`${out.length}:`); h.update(out); h.update('\n'); }, hex: () => h.digest('hex') };
}

function runFrames(frames, cols, rows, palette, frameAt) {
  const r = createRenderer();
  const h = hasher();
  for (let k = 0; k < frames; k++) {
    const f = frameAt(k);
    h.add(r.render({ cols, rows, glyphs: f.glyphs, shades: f.shades, palette: typeof palette === 'function' ? palette(k) : palette }));
  }
  return h.hex();
}

const tAt = (k) => k / FPS;
const sizeName = ([c, r]) => `${c}x${r}`;

// ---- cartridge cases

async function cartridgeCases() {
  const found = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
  const cases = [];
  for (const id of INSTALL_CARTS) {
    const cart = found.cartridges.find((c) => c.id === id);
    if (!cart || !cart.skin) throw new Error(`install cartridge '${id}' not found or has no skin`);
    const loaded = await loadScenes(cart);
    if (loaded.errors.length) throw new Error(`cartridge '${id}' did not load: ${loaded.errors[0].reason}`);
    const byId = new Map(loaded.scenes.map((s) => [s.id, s]));
    for (const e of loaded.scenes) if (e.kind === 'field') throw new Error(`${id}/${e.id}: field scenes are not covered by this tool`);
    const pal = (cmode) => makeSkinPalette(cart.skin, cmode, cart.id);
    for (const e of loaded.scenes) {
      for (const sz of SIZES) for (const cmode of CMODES) {
        cases.push({
          group: 'cart', name: `cart/${id}/${e.id}/${sizeName(sz)}/${cmode}`,
          run: () => {
            const comp = createCellComposer({ scenes: [e.scene], cols: sz[0], rows: sz[1], seed: SEED });
            return runFrames(FRAMES, sz[0], sz[1], pal(cmode), (k) => comp.frame({ a: 0, b: 0, p: 0 }, tAt(k)));
          },
        });
      }
    }
    for (const prog of cart.manifest.programs) {
      const ids = prog.scenes;
      for (let i = 0; i < ids.length; i++) {
        const A = byId.get(ids[i]), B = byId.get(ids[(i + 1) % ids.length]);
        const pairName = `${A.id}>${B.id}`;
        for (const sz of SIZES) for (const cmode of CMODES) {
          cases.push({
            group: 'dissolve', name: `dissolve/${id}/${pairName}/${sizeName(sz)}/${cmode}`,
            run: () => {
              const comp = createCellComposer({ scenes: [A.scene, B.scene], cols: sz[0], rows: sz[1], seed: SEED });
              const n = DISSOLVE_SECONDS * FPS + 1; // 37 frames: 0 s .. 2 s inclusive
              return runFrames(n, sz[0], sz[1], pal(cmode), (k) => comp.frame({ a: 0, b: 1, p: smoothstep(tAt(k) / DISSOLVE_SECONDS) }, tAt(k)));
            },
          });
        }
      }
    }
  }
  return cases;
}

// ---- Classic cases

function calmCases() {
  const cases = [];
  const presets = [['claude', 0], ['blend', 30]]; // blend starts mid-loop so its palette really changes inside the 5 s
  for (const [preset, t0] of presets) {
    SCENES.forEach((sc, idx) => {
      for (const sz of SIZES) for (const cmode of CMODES) {
        cases.push({
          group: 'calm', name: `calm/${sc.id}/${preset}/${sizeName(sz)}/${cmode}`,
          run: () => {
            const comp = createComposer({ scenes: SCENES, cols: sz[0], rows: sz[1], seed: SEED });
            return runFrames(FRAMES, sz[0], sz[1], (k) => makePalette(presetRGB(preset, t0 + tAt(k)), cmode),
              (k) => comp.frame({ a: idx, b: idx, p: 0 }, t0 + tAt(k)));
          },
        });
      }
    });
  }
  for (const sz of SIZES) for (const cmode of CMODES) {
    cases.push({
      group: 'calm', name: `calm/crossfade/squiggle>sunburst/claude/${sizeName(sz)}/${cmode}`,
      run: () => {
        const comp = createComposer({ scenes: SCENES, cols: sz[0], rows: sz[1], seed: SEED });
        const pal = makePalette(presetRGB('claude', 0), cmode);
        const T0 = 6, FADE = 15; // seconds 6 .. 11 of a 15 s fade
        return runFrames(FRAMES, sz[0], sz[1], pal, (k) => comp.frame({ a: 0, b: 1, p: smoothstep((T0 + tAt(k)) / FADE) }, T0 + tAt(k)));
      },
    });
  }
  return cases;
}

function modeCases() {
  const cases = [];
  const sets = [
    ['chaos', 'chaos/neon', PLAYLISTS.chaos, (cmode) => makeMultiPalette(DEFAULT_CHAOS_PALETTE, cmode)],
    ['contrast', 'contrast/normal', PLAYLISTS.contrast, (cmode) => makeTwoTone(false, cmode)],
    ['contrast', 'contrast/inverted', PLAYLISTS.contrast, (cmode) => makeTwoTone(true, cmode)],
    ['experimental', 'experimental', PLAYLISTS.experimental, (cmode) => makePalette(presetRGB('claude', 0), cmode)],
  ];
  for (const [group, prefix, list, palFor] of sets) {
    list.forEach((sc, idx) => {
      for (const sz of SIZES) for (const cmode of CMODES) {
        cases.push({
          group, name: `${prefix}/${sc.id}/${sizeName(sz)}/${cmode}`,
          run: () => {
            const comp = createCellComposer({ scenes: list, cols: sz[0], rows: sz[1], seed: SEED });
            return runFrames(FRAMES, sz[0], sz[1], palFor(cmode), (k) => comp.frame({ a: idx, b: idx, p: 0 }, tAt(k)));
          },
        });
      }
    });
  }
  return cases;
}

// ---- real-app arm

function fakeStdin() {
  const e = new EventEmitter();
  Object.assign(e, { isTTY: true, setRawMode() { return e; }, resume() { return e; }, pause() { return e; }, unref() {}, ref() {}, setEncoding() { return e; } });
  return e;
}

// Variants are Classic start states, written to a throwaway config file (the app's own config path).
const APP_VARIANTS = [
  ['calm', { mode: 'calm' }],
  ['calm-blend', { mode: 'calm', colour: 'blend' }],
  ['chaos', { mode: 'chaos' }],
  ['contrast', { mode: 'contrast' }],
  ['contrast-inverted', { mode: 'contrast', invert: true }],
  ['experimental', { mode: 'experimental' }],
];

function runApp(variantCfg, sz, cmode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-render-hash-'));
  try {
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(variantCfg));
    const stdout = new EventEmitter();
    const h = hasher();
    Object.assign(stdout, { isTTY: true, columns: sz[0], rows: sz[1], write(s, cb) { h.add(String(s)); if (typeof cb === 'function') cb(); return true; } });
    const proc = new EventEmitter();
    proc.exit = () => {};
    const sink = { write(_s, cb) { if (typeof cb === 'function') cb(); return true; } };
    let ms = 1000; // fake clock: only moves when we say so
    const app = createApp({
      stdin: fakeStdin(), stdout, stderr: sink, proc, env: {}, configPath, colorMode: cmode,
      fps: FPS, seed: SEED, autoLoop: false, now: () => ms,
    });
    if (!app.start()) throw new Error('fake terminal refused to start');
    for (let k = 0; k < APP_SECONDS * FPS; k++) { ms += 1000 / FPS; app.tick(1 / FPS); }
    app.quit(0);
    return h.hex();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function appCases() {
  const cases = [];
  for (const [vname, cfg] of APP_VARIANTS) {
    for (const sz of SIZES) for (const cmode of CMODES) {
      cases.push({ group: 'app', name: `app/${vname}/${sizeName(sz)}/${cmode}`, run: () => runApp(cfg, sz, cmode) });
    }
  }
  return cases;
}

// ---- driver

export async function buildCases() {
  return [...(await cartridgeCases()), ...calmCases(), ...modeCases(), ...appCases()];
}

export function totalOf(list) {
  return sha(list.map((c) => `${c.name}\t${c.hash}\n`).join(''));
}

// -> { cases: [{ name, hash, group }], total }
export async function computeAll() {
  const cases = [];
  for (const c of await buildCases()) cases.push({ name: c.name, group: c.group, hash: c.run() });
  return { cases, total: totalOf(cases) };
}

export function readFixture(file = FIXTURE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// -> { ok, differing: [names], missing: [names in the fixture but not produced], extra: [names produced but not
// in the fixture], nodeDiffers, message }
export function compare(fixture, current, nodeVersion = process.version) {
  const want = new Map(fixture.cases.map((c) => [c.name, c.hash]));
  const got = new Map(current.cases.map((c) => [c.name, c.hash]));
  const differing = [], missing = [], extra = [];
  for (const [n, h] of want) { if (!got.has(n)) missing.push(n); else if (got.get(n) !== h) differing.push(n); }
  for (const n of got.keys()) if (!want.has(n)) extra.push(n);
  const nodeDiffers = fixture.node !== nodeVersion;
  const ok = !differing.length && !missing.length && !extra.length && fixture.total === current.total;
  const lines = [];
  if (!ok) {
    lines.push(`render output differs from tests/fixtures/render-hash.json (recorded at ${fixture.head} on node ${fixture.node}; running node ${nodeVersion}).`);
    lines.push(nodeDiffers
      ? 'The Node version differs from the recorded one: a Node change could be the cause (check that first), but do not assume it.'
      : 'The Node version is the same as the recorded one, so this is a code change.');
    for (const n of differing) lines.push(`  differs: ${n}`);
    for (const n of missing) lines.push(`  missing (in fixture, not produced): ${n}`);
    for (const n of extra) lines.push(`  extra (produced, not in fixture): ${n}`);
    if (!differing.length && !missing.length && !extra.length) lines.push(`  every case matches but the total differs (fixture ${fixture.total}, now ${current.total})`);
  }
  return { ok, differing, missing, extra, nodeDiffers, message: lines.join('\n') };
}

function headSha() {
  return execFileSync('git', ['-C', path.resolve(HERE, '..'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

async function main(argv) {
  const t0 = process.hrtime.bigint();
  const cur = await computeAll();
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  if (argv.includes('--write')) {
    const fx = { head: headSha(), node: process.version, total: cur.total, count: cur.cases.length, cases: cur.cases.map(({ name, hash }) => ({ name, hash })) };
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify(fx, null, 1) + '\n');
    console.log(`wrote ${FIXTURE} (${fx.count} cases, head ${fx.head}, node ${fx.node})`);
  } else if (argv.includes('--check')) {
    const r = compare(readFixture(), cur);
    if (!r.ok) { console.error(r.message); console.error(`TOTAL ${cur.total}`); return 1; }
    console.log(`render-hash: ${cur.cases.length} cases match`);
  } else if (argv.includes('--list')) {
    for (const c of cur.cases) console.log(`${c.hash}  ${c.name}`);
  } else {
    const groups = new Map();
    for (const c of cur.cases) groups.set(c.group, (groups.get(c.group) || 0) + 1);
    for (const [g, n] of groups) console.log(`${g.padEnd(13)} ${n} cases`);
    console.log(`cases ${cur.cases.length}  (${secs.toFixed(1)} s, node ${process.version})`);
  }
  console.log(`TOTAL ${cur.total}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e && e.stack ? e.stack : e); process.exitCode = 2; });
}
