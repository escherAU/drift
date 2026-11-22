#!/usr/bin/env node
// DRIFT-13 phase 2: reviewer tool, NOT part of `npm test`. What the flash governor does when it is WIRED into the app (src/app.js govern()): the real app in Classic high contrast, the whole
// 170 s cycle (five scenes and the four dissolves between them, scene length 30 s of scene time, `sceneSeconds = 30 * speed`), the app's own loop on a clock from tests/helpers-clock.js,
// 256 colours. It runs a SPY TREE (tests/helpers-governor-app.js: a copy of src/ that only reports each governed paint) and, for every paint, compares the composed frame the scenes
// made (help panel included) with what was PAINTED:
//   engagement   paints with any held cell, cells held, and the cells the composer changed (composed frame against the composed frame before it): held / changed is the share held
//   staleness    how long a held cell waits: from the paint that first shows it different from the composed frame to the paint that shows it equal again (in paints, and in seconds of the
//                app's real time); a cell still waiting when the run ends counts as waited so far
//   deviation    cells of the painted screen that differ from the composed frame, per paint, as a share of the screen (mean, p99, max; kept in tenths of a per cent so runs of different sizes merge):
//                over every paint and over the paints that changed something
// Output: one JSON line per case and label (a scene, or "dis:<scene it fades from>"); `--report <files>` aggregates them.
//   node tools/governor-wired.mjs --sizes 80x24,120x40 --fps 12,18,26,30 --clocks grid,q156 --speeds 1x,4x --seeds 1,2,3 --out wired.jsonl
//   node tools/governor-wired.mjs --report wired-*.jsonl [--by size|fps|clock|speed|scene] [--where size=80x24,speed=1x]
import fs from 'node:fs';
import { runSpied } from '../tests/helpers-governor-app.js';
import { PLAN, SPEED_OF, isCardBoard } from '../tests/helpers-life-app.js';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const list = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);

// a histogram: Map value -> count; the percentile of a merged histogram
const add = (m, v, k = 1) => m.set(v, (m.get(v) || 0) + k);
function histP(m, p) {
  const keys = [...m.keys()].sort((a, b) => a - b);
  let total = 0; for (const k of keys) total += m.get(k);
  if (!total) return 0;
  const need = Math.ceil(p * total); let c = 0;
  for (const k of keys) { c += m.get(k); if (c >= need) return k; }
  return keys[keys.length - 1];
}
const histJSON = (m) => [...m].map(([k, c]) => [k, c]);
const histOf = (a) => new Map(a);

async function runCase({ cols, rows, fps, clock, speed, seed }) {
  const n = cols * rows;
  const labels = new Map();
  const rec = (l) => {
    let r = labels.get(l);
    if (!r) { r = { paints: 0, active: 0, heldPaints: 0, composed: 0, held: 0, waitPaints: new Map(), waitMs: new Map(), devAll: new Map(), devActive: new Map() }; labels.set(l, r); }
    return r;
  };
  let prevF = null, last = 'life', paintNo = 0;
  const since = new Int32Array(n).fill(-1), sinceT = new Float64Array(n);
  let firstPaint = true;
  const onPaint = (f, g, gov, wall, app) => {
    const st = app.getState();
    if (!st.fading) last = st.sceneId;
    const r = rec(st.fading ? 'dis:' + last : st.sceneId);
    paintNo++;
    r.paints++;
    let changed = 0, dev = 0;
    for (let i = 0; i < n; i++) {
      if (prevF && (f.glyphs[i] !== prevF[i])) changed++;
      const differs = g.glyphs[i] !== f.glyphs[i] || g.shades[i] !== f.shades[i];
      if (differs) {
        dev++;
        if (since[i] < 0) { since[i] = paintNo; sinceT[i] = wall; }
      } else if (since[i] >= 0) {
        add(r.waitPaints, paintNo - since[i]); add(r.waitMs, Math.round((wall - sinceT[i]) * 1000));
        since[i] = -1;
      }
    }
    if (firstPaint) { firstPaint = false; changed = 0; }
    const heldNow = gov.stats.last.held;
    r.composed += changed; r.held += heldNow;
    if (changed > 0 || heldNow > 0 || dev > 0) r.active++;
    if (heldNow > 0) r.heldPaints++;
    const permille = Math.round((1000 * dev) / n); // the deviation in tenths of a per cent of the screen, so runs of different sizes merge
    add(r.devAll, permille);
    if (changed > 0 || dev > 0) add(r.devActive, permille);
    if (!prevF) prevF = new f.glyphs.constructor(n);
    prevF.set(f.glyphs);
  };
  const keys = PLAN[speed];
  const res = await runSpied({ cols, rows, mode: '256', seed, clock, clockSeed: seed, fps, seconds: 170, sceneSeconds: 30 * SPEED_OF[speed], keys, feedAll: true, stopAtDissolve: false, meter: false }, { onPaint });
  // cells still waiting at the end
  const lastLabel = [...labels.keys()].pop();
  if (lastLabel) { const r = labels.get(lastLabel); for (let i = 0; i < n; i++) if (since[i] >= 0) { add(r.waitPaints, paintNo - since[i]); add(r.waitMs, 0); } }
  return { labels: [...labels].map(([label, r]) => ({ label, ...r, waitPaints: histJSON(r.waitPaints), waitMs: histJSON(r.waitMs), devAll: histJSON(r.devAll), devActive: histJSON(r.devActive) })), n, built: res.built };
}

function merge(rows) {
  const a = { paints: 0, active: 0, heldPaints: 0, composed: 0, held: 0, waitPaints: new Map(), waitMs: new Map(), devAll: new Map(), devActive: new Map(), n: 0, cases: 0 };
  for (const r of rows) {
    for (const k of ['paints', 'active', 'heldPaints', 'composed', 'held']) a[k] += r[k];
    for (const k of ['waitPaints', 'waitMs', 'devAll', 'devActive']) for (const [v, c] of r[k]) add(a[k], v, c);
    a.n = r.n; a.cases++;
  }
  return a;
}
function histMean(m) { let s = 0, c = 0; for (const [v, k] of m) { s += v * k; c += k; } return c ? s / c : 0; }
const pc = (x, y) => (y ? ((100 * x) / y).toFixed(3) : '0.000');

function report(files) {
  const rows = [];
  for (const f of files) for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    for (const k of ['waitPaints', 'waitMs', 'devAll', 'devActive']) r[k] = histOf(r[k]);
    rows.push(r);
  }
  const by = opt('by', 'scene');
  const where = Object.fromEntries(list(opt('where', '')).map((kv) => kv.split('=')));
  const keyOf = { size: (r) => r.size, fps: (r) => String(r.fps), clock: (r) => r.clock, speed: (r) => r.speed, scene: (r) => r.label, seed: (r) => String(r.seed) };
  const groups = new Map();
  for (const r of rows) {
    let ok = true;
    for (const [k, v] of Object.entries(where)) if (keyOf[k](r) !== v) ok = false;
    if (!ok) continue;
    const key = keyOf[by](r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  console.log(`${by.padEnd(14)} ${'paints'.padStart(8)} ${'heldP%'.padStart(7)} ${'held/chg%'.padStart(9)} | wait paints mean p99 max | wait s mean p99 max | dev% (active) mean p99 max | dev% (all) p99 max`);
  for (const [k, g] of [...groups].sort()) {
    const a = merge(g);
    const wp = a.waitPaints, wm = a.waitMs;
    const maxOf = (m) => (m.size ? Math.max(...m.keys()) : 0);
    const devPct = (m, f) => (f(m) / 10).toFixed(2);
    console.log(`${k.padEnd(14)} ${String(a.paints).padStart(8)} ${pc(a.heldPaints, a.paints).padStart(7)} ${pc(a.held, a.composed).padStart(9)} | ${histMean(wp).toFixed(2).padStart(5)} ${String(histP(wp, 0.99)).padStart(4)} ${String(maxOf(wp)).padStart(4)} | ${(histMean(wm) / 1000).toFixed(3).padStart(6)} ${(histP(wm, 0.99) / 1000).toFixed(3).padStart(6)} ${(maxOf(wm) / 1000).toFixed(3).padStart(6)} | ${devPct(a.devActive, histMean).padStart(6)} ${devPct(a.devActive, (m) => histP(m, 0.99)).padStart(6)} ${devPct(a.devActive, maxOf).padStart(6)} | ${devPct(a.devAll, (m) => histP(m, 0.99)).padStart(6)} ${devPct(a.devAll, maxOf).padStart(6)}`);
  }
}

if (argv.includes('--report')) { report(argv.slice(argv.indexOf('--report') + 1).filter((a) => !a.startsWith('--') && fs.existsSync(a))); process.exit(0); }

const sizes = list(opt('sizes', '80x24')), fpsList = list(opt('fps', '18')).map(Number), clocks = list(opt('clocks', 'grid')), speeds = list(opt('speeds', '1x'));
const seeds = list(opt('seeds', '1')).map(Number), out = opt('out', null);
for (const size of sizes) for (const fps of fpsList) for (const clock of clocks) for (const speed of speeds) for (const seed of seeds) {
  const [cols, rows] = size.split('x').map(Number);
  if (isCardBoard(cols, rows)) { console.error(`skip ${size}: below Classic's minimum (size card)`); continue; }
  const t0 = Date.now();
  const r = await runCase({ cols, rows, fps, clock, speed, seed });
  for (const l of r.labels) {
    const line = JSON.stringify({ size, fps, clock, speed, seed, n: r.n, ...l });
    if (out) fs.appendFileSync(out, line + '\n'); else console.log(line);
  }
  console.error(`done ${size} fps ${fps} ${clock} ${speed} seed ${seed} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
