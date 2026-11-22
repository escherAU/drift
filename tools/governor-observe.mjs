#!/usr/bin/env node
// DRIFT-13: reviewer tool, NOT part of `npm test`. The flash governor (src/governor.js) in OBSERVE mode on the REAL app: Classic high contrast, the whole 170 s cycle (five scenes and the
// four dissolves between them, scene length 30 s of scene time, `sceneSeconds = 30 * speed` as tools/life-matrix.mjs), the app's own loop on a clock from tests/helpers-clock.js. Every
// paint the app writes is read back through the independent terminal reader (tests/helpers-ansi.js) and handed to a governor that holds NOTHING and counts what each rule would hold:
//   strict   the per-cell rule: a third change of a cell inside W = max(1, round(fps) / fps) seconds
//   blocks   the relaxed per-block rule (see src/governor.js): the third change is allowed while the cell's block has triple-cell budget
//   read     the per-read cap: more than floor(0.30 n) distinct cells changed inside one 1 / fps
// Output: one JSON line per case and per label (a scene, or "dis:<scene it fades from>") with counts of paints, of paints that change something, of cell changes, and of what each rule
// would hold (cells, and paints with at least one held cell). `--report <files>` aggregates JSON lines into tables.
//   --variant blocks|nbhd picks the relaxed rule whose budget is counted (strict is counted whatever the variant; default blocks)
//   --lum ESTIMATE ONLY: hands the governor the glyph's ink coverage in eighths instead of the glyph, so only a change of brightness counts as a change (what a luminance-aware governor would see)
//   node tools/governor-observe.mjs --sizes 80x24,120x40 --fps 12,18,26,30 --clocks grid,q156 --speeds 1x,4x --seeds 1,2,3 --out observe.jsonl
//   node tools/governor-observe.mjs --report observe-*.jsonl [--by size|fps|clock|speed|scene] [--where size=80x24,speed=1x]
// 256 colours. The governor's "shade" is the pair (foreground, background) the terminal was told to show, so a colour change counts as a change too.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createScreen } from '../tests/helpers-ansi.js';
import { createClock } from '../tests/helpers-clock.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from '../tests/helpers.js';
import { plusKeys, SPEED_OF, isCardBoard } from '../tests/helpers-life-app.js';
import { createGovernor } from '../src/governor.js';
import { glyphCoverage } from '../tests/helpers-flash.js';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const list = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);
const SP = { '1x': 0, '4x': 4 };

async function runCase({ cols, rows, fps, clock, speed, seed, variant, lum }) {
  const n = cols * rows;
  const c = createClock({ mode: clock, seed });
  const stdout = fakeStdout({ columns: cols, rows });
  const stdin = fakeStdin(), stderr = fakeStderr(), proc = fakeProc();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-gov-observe-'));
  const screen = createScreen(cols, rows);
  const gov = createGovernor({ cols, rows, fps, observe: true, variant });
  const glyphs = new Uint16Array(n), keys = new Uint32Array(n);
  const labels = new Map();
  let label = 'life', last = 'life', app = null;
  const rec = (l) => { let r = labels.get(l); if (!r) { r = { paints: 0, active: 0, changes: 0, strict: 0, blocks: 0, read: 0, pStrict: 0, pBlocks: 0, pRead: 0, maxChanged: 0 }; labels.set(l, r); } return r; };
  const origWrite = stdout.write;
  stdout.write = (s, cb) => {
    screen.feed(String(s));
    for (let j = 0; j < n; j++) { glyphs[j] = lum ? Math.round(glyphCoverage(screen.glyphs[j]) * 8) : screen.glyphs[j]; keys[j] = Math.imul(screen.fg[j], 0x9e3779b1) ^ screen.bg[j]; }
    const st = gov.stats, s0 = st.strictHeld, b0 = st.blocksHeld, r0 = st.readHeld;
    gov.govern(glyphs, keys, c.now() / 1000);
    const r = rec(label);
    r.paints++;
    const w = st.last.wanted;
    if (w > 0) r.active++;
    r.changes += w; if (w > r.maxChanged) r.maxChanged = w;
    const ds = st.strictHeld - s0, db = st.blocksHeld - b0, dr = st.readHeld - r0;
    r.strict += ds; r.blocks += db; r.read += dr;
    if (ds > 0) r.pStrict++; if (db > 0) r.pBlocks++; if (dr > 0) r.pRead++;
    return origWrite(s, cb);
  };
  const sceneSeconds = 30 * SPEED_OF[speed];
  app = createApp({ stdin, stdout, stderr, proc, env: {}, configPath: path.join(tmp, 'config.json'), dirs: [], startMode: 'contrast', startScene: 0, sceneSeconds, seed, fps, autoLoop: true, now: c.now, timer: c.timer });
  try {
    app.start();
    const total = Math.round(170 * fps);
    const keyAt = new Map();
    for (const kk of plusKeys(SP[speed])) { const f = Math.round(kk.at * fps); keyAt.set(f, (keyAt.get(f) || []).concat(kk.key)); }
    for (let k = 0; k < total && !proc.exits.length; k++) {
      for (const key of keyAt.get(k) || []) stdin.emit('data', key);
      const st0 = app.getState();
      label = st0.fading ? 'dis:' + last : st0.sceneId;
      if (!st0.fading) last = st0.sceneId;
      c.advanceTo(((k + 1) * 1000) / fps);
      const st = app.getState();
      if (st.fading) label = 'dis:' + last; else { label = st.sceneId; last = st.sceneId; }
      if (k % 8 === 0) await new Promise((r) => setImmediate(r));
    }
    return { labels: [...labels].map(([l, r]) => ({ label: l, ...r })), cap: gov.limits.stepCap, W: gov.limits.W, blockCap: gov.limits.blockCap };
  } finally {
    try { proc.emit('exit'); } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- the report
function report(files) {
  const rows = [];
  for (const f of files) for (const line of fs.readFileSync(f, 'utf8').split('\n')) { if (line.trim()) rows.push(JSON.parse(line)); }
  const by = opt('by', 'scene');
  const where = Object.fromEntries(list(opt('where', '')).map((kv) => kv.split('=')));
  const keyOf = { size: (r) => r.size, fps: (r) => String(r.fps), clock: (r) => r.clock, speed: (r) => r.speed, scene: (r) => r.label, seed: (r) => String(r.seed) };
  const agg = new Map();
  for (const r of rows) {
    let ok = true;
    for (const [k, v] of Object.entries(where)) if (keyOf[k](r) !== v) ok = false;
    if (!ok) continue;
    const key = keyOf[by](r);
    let a = agg.get(key);
    if (!a) { a = { paints: 0, active: 0, changes: 0, strict: 0, blocks: 0, read: 0, pStrict: 0, pBlocks: 0, pRead: 0 }; agg.set(key, a); }
    for (const k of Object.keys(a)) a[k] += r[k];
  }
  const pc = (x, y) => (y ? ((100 * x) / y).toFixed(3) : '0.000').padStart(8);
  console.log(`${by.padEnd(14)} ${'paints'.padStart(8)} ${'active'.padStart(8)} ${'changes'.padStart(10)} | strict %chg %paints | blocks %chg %paints | read %chg %paints`);
  for (const [k, a] of [...agg].sort()) {
    console.log(`${k.padEnd(14)} ${String(a.paints).padStart(8)} ${String(a.active).padStart(8)} ${String(a.changes).padStart(10)} | ${pc(a.strict, a.changes)} ${pc(a.pStrict, a.active)} | ${pc(a.blocks, a.changes)} ${pc(a.pBlocks, a.active)} | ${pc(a.read, a.changes)} ${pc(a.pRead, a.active)}`);
  }
}

if (argv.includes('--report')) { report(argv.slice(argv.indexOf('--report') + 1).filter((a) => !a.startsWith('--') && fs.existsSync(a))); process.exit(0); }

const sizes = list(opt('sizes', '80x24')), fpsList = list(opt('fps', '18')).map(Number), clocks = list(opt('clocks', 'grid')), speeds = list(opt('speeds', '1x'));
const seeds = list(opt('seeds', '1')).map(Number), out = opt('out', null), variant = opt('variant', 'blocks'), lum = argv.includes('--lum');
for (const size of sizes) for (const fps of fpsList) for (const clock of clocks) for (const speed of speeds) for (const seed of seeds) {
  const [cols, rows] = size.split('x').map(Number);
  if (isCardBoard(cols, rows)) { console.error(`skip ${size}: below Classic's minimum (size card)`); continue; }
  const t0 = Date.now();
  const r = await runCase({ cols, rows, fps, clock, speed, seed, variant, lum });
  for (const l of r.labels) {
    const line = JSON.stringify({ variant: variant + (lum ? '+lum' : ''), size, fps, clock, speed, seed, cap: r.cap, W: r.W, blockCap: r.blockCap, ...l });
    if (out) fs.appendFileSync(out, line + '\n'); else console.log(line);
  }
  console.error(`done ${size} fps ${fps} ${clock} ${speed} seed ${seed} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
