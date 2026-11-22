#!/usr/bin/env node
// DRIFT-13 phase 3: reviewer tool, NOT part of `npm test`. The whole Classic high contrast cycle (Life, tunnel, wire, maze, blocktype and the four dissolves between them, 170 s, feedAll, scene
// length 30 s of scene time: sceneSeconds = 30 * speed) on the REAL app, metered on the viewer's grid against the five X1 rules at their limits (L1, L2, L3, R, C: tests/helpers-flash.js
// X1_RULE_IDS), over axes you choose. One line per case. It always prints the FULL-FACTORIAL line count of the axes you gave next to the lines it ran, so no claim is wider than the run.
//   node tools/contrast-matrix.mjs [--tree after|before13|before|before11|before12|<dir>] [--sizes S] [--fps F] [--speeds V] [--clocks C] [--modes M] [--seeds D]
//                                   [--sample N [--sample-seed K]] [--jobs K] [--out results.jsonl [--resume]] [--summary-only] [--stop-on-fail] [--plan]
//   --sizes   COLSxROWS list; ranges (40-50x10-16 is all 77 pairs of 40..50 columns x 10..16 rows); sets: breakpoints (78x24,80x24,88x39,120x40), breakpoints-all (adds 176x58, 240x67). Default 80x24.
//             Below 40x10 Classic shows the size card (nothing to flash): such sizes run as the card and the tool says so.
//   --fps     integers or ranges (8-30, 9,12,18). Default 18.     --speeds  1x,1.5x,2x,3x,4x (real `+` presses: 1, 2, 3, 4 of them; SPEEDS in src/app.js). Default 1x.
//   --clocks  grid,q156,jitter (tests/helpers-clock.js). Default grid.   --modes 256,truecolor. Default 256.   --seeds 1,2,... or 1-8 (app seed = clock seed). Default 1.
//   --tree    after (default) is this tree as shipped; before13 is this tree with only the governor taken out (BEFORE13_EDITS); before, before11 and before12 are the DRIFT-10 to 12 controls (all without the governor, as life-matrix.mjs); a directory runs the src/ in it.
//   --sample  N: not the whole cross but a SEEDED, STRATIFIED draw of N cases (--sample-seed, default 1; tests/helpers-contrast-matrix.js drawSample): with N at least sizes x fps, every
//             (size, fps) pair is met floor(N / pairs) times or more; the other axes come off shuffled decks so each value is met about N / its length times. The coverage is printed.
//   --jobs    K worker processes, one case at a time each. --out FILE writes one JSON line per case as it finishes; --resume continues from the cases already in FILE (same tree and axes values;
//             a case in FILE that is not in this run's set is ignored by the summary). --stop-on-fail stops handing out cases after the first failing line. --plan prints the counts and the coverage and runs nothing.
// Exit 0 when every line passes, 1 when any line fails (or a run errored), 2 on a bad argument.
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runLife, makeTreeNoGov, rmTree, nums, isCardBoard, BEFORE12_EDITS } from '../tests/helpers-life-app.js';
import { failedRules, X1_RULE_IDS } from '../tests/helpers-flash.js';
import {
  parseSizes, parseInts, parseSpeeds, parseList, CLOCK_LIST, MODE_LIST, SPEED_KEYS, fullFactorial, expandAll, drawSample, coverage, summarise, caseKey, caseLabel, RULES, LIMITS,
} from '../tests/helpers-contrast-matrix.js';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const has = (name) => argv.includes('--' + name);
const pct = (v) => v.toFixed(2).padStart(6);
const fmt = (n) => n.toLocaleString('en-US');

// ---- one case, in this process (the worker's job)
async function runCase(c, root) {
  const [cols, rows] = c.size.split('x').map(Number);
  const t0 = Date.now();
  try {
    const r = await runLife({ cols, rows, mode: c.mode, seed: c.seed, clock: c.clock, clockSeed: c.seed, keys: SPEED_KEYS[c.speed], seconds: 170, sceneSeconds: 30 * c.speed, root, fps: c.fps, card: isCardBoard(cols, rows), feedAll: true, stopAtDissolve: false });
    const n = nums(r.rep);
    return { ...c, l1: n.l1, l2: n.l2, l3: n.l3, r: n.r, c: n.c, fails: failedRules(r.rep, { only: X1_RULE_IDS }), ms: Date.now() - t0 };
  } catch (e) {
    return { ...c, l1: 0, l2: 0, l3: 0, r: 0, c: 0, fails: [], error: String((e && e.message) || e).slice(0, 300), ms: Date.now() - t0 };
  }
}

if (has('worker')) {
  const root = opt('root', '') || null;
  process.on('message', async (m) => {
    if (m.type === 'exit') process.exit(0);
    const res = await runCase(m.case, root);
    process.send({ type: 'done', id: m.id, result: res });
  });
  process.send({ type: 'ready' });
} else {
  await main();
}

async function main() {
  const tree = opt('tree', 'after');
  let a;
  try {
    a = {
      sizes: parseSizes(opt('sizes', '80x24')), fps: parseInts(opt('fps', '18'), 'frame rate'), speeds: parseSpeeds(opt('speeds', '1x')),
      clocks: parseList(opt('clocks', 'grid'), CLOCK_LIST, 'clock'), modes: parseList(opt('modes', '256'), MODE_LIST, 'colour mode'), seeds: parseInts(opt('seeds', '1'), 'seed'),
    };
    for (const k of Object.keys(a)) if (!a[k].length) throw new Error(`--${k} is empty`);
    for (const f of a.fps) if (!(f >= 1 && f <= 120)) throw new Error(`bad frame rate ${f}`);
  } catch (e) { console.error(e.message); process.exit(2); }
  const jobs = Math.max(1, Number(opt('jobs', 1)) || 1);
  const full = fullFactorial(a);
  const sampleN = has('sample') ? Number(opt('sample')) : null;
  if (sampleN !== null && !(sampleN >= 1)) { console.error('--sample needs a count'); process.exit(2); }
  const sampleSeed = Number(opt('sample-seed', 1));
  const cases = (sampleN === null ? expandAll(a) : drawSample(a, sampleN, sampleSeed)).map((c) => ({ ...c, key: caseKey(tree, c) }));
  const cov = coverage(cases, a);
  const cross = `${a.sizes.length} sizes x ${a.fps.length} fps x ${a.speeds.length} speeds x ${a.clocks.length} clocks x ${a.modes.length} modes x ${a.seeds.length} seeds`;
  const drawn = sampleN === null ? `all ${fmt(cases.length)} (the whole cross)` : cases.length === full ? `all ${fmt(cases.length)} (--sample ${sampleN} is at or above the cross: the whole cross)` : `${fmt(cases.length)} of ${fmt(full)} (--sample ${sampleN}, sample seed ${sampleSeed}, stratified)`;
  const head = [
    `tree ${tree}: whole Classic high contrast cycle, 170 s, real app, five X1 rules (${RULES.map((r) => `${r.toUpperCase()} <= ${LIMITS[r]}`).join(', ')})`,
    `FULL FACTORIAL of these axes: ${cross} = ${fmt(full)} lines; drawn: ${drawn}`,
    `coverage (times met, min..max): sizes ${cov.sizes.min}..${cov.sizes.max}, fps ${cov.fps.min}..${cov.fps.max}, (size,fps) pairs ${cov.pairs.min}..${cov.pairs.max} over ${fmt(cov.pairs.values)} pairs, speeds ${cov.speeds.min}..${cov.speeds.max}, clocks ${cov.clocks.min}..${cov.clocks.max}, modes ${cov.modes.min}..${cov.modes.max}, seeds ${cov.seeds.min}..${cov.seeds.max}`,
  ];
  for (const s of a.sizes) if (isCardBoard(...s.split('x').map(Number))) { console.error(`note: ${s} is below Classic's 40x10 minimum: Classic shows the size card there, so these runs are the card (static, nothing to flash), not the scene`); }
  if (has('plan')) { console.log(head.join('\n')); process.exit(0); }

  // resume: lines already in --out
  const out = opt('out', null);
  const done = new Map();
  if (out && fs.existsSync(out)) {
    if (!has('resume')) { console.error(`${out} exists: pass --resume to continue it, or choose another file`); process.exit(2); }
    const text = fs.readFileSync(out, 'utf8');
    if (text.length && !text.endsWith('\n')) fs.appendFileSync(out, '\n'); // an interrupted run can leave a torn last line: end it, so the next line starts on its own
    for (const line of text.split('\n')) { if (!line.trim()) continue; try { const x = JSON.parse(line); if (x.key) done.set(x.key, x); } catch { /* a half-written last line from an interrupted run is run again */ } }
  } else if (has('resume') && !out) { console.error('--resume needs --out'); process.exit(2); }
  const results = [], pending = [];
  for (const c of cases) { if (done.has(c.key)) results.push(done.get(c.key)); else pending.push(c); }
  const resumed = results.length;
  console.error(head.join('\n'));
  if (resumed) console.error(`resume: ${fmt(resumed)} lines already in ${out}, ${fmt(pending.length)} to run`);

  const root = tree === 'after' ? null : tree === 'before' ? makeTreeNoGov('old') : tree === 'before11' ? makeTreeNoGov('new', {}, { wire: 'old', blocktype: 'old' }) : tree === 'before12' ? makeTreeNoGov('new', BEFORE12_EDITS, { tunnel: 'old' }) : tree === 'before13' ? makeTreeNoGov('new') : tree;
  const owned = root && ['before', 'before11', 'before12', 'before13'].includes(tree);
  const summaryOnly = has('summary-only'), stopOnFail = has('stop-on-fail');
  const self = fileURLToPath(import.meta.url);
  const workers = new Set();
  let stopped = false, cleaned = false;
  const cleanup = () => { if (cleaned) return; cleaned = true; for (const w of workers) { try { w.kill(); } catch { /* gone */ } } if (owned) rmTree(root); };
  process.on('SIGINT', () => { console.error('interrupted: partial results are in --out (use --resume)'); cleanup(); process.exit(130); });
  const t0 = Date.now();
  const emit = (x) => {
    results.push(x);
    if (out) fs.appendFileSync(out, JSON.stringify(x) + '\n');
    const bad = x.error ? ['ERROR ' + x.error] : x.fails;
    if (!summaryOnly || bad.length) console.log(`${tree.padEnd(8)} cycle ${x.clock.padEnd(6)} ${x.mode.padEnd(9)} ${String(x.speed).padStart(3)}x ${x.size.padEnd(7)} fps ${String(x.fps).padStart(2)} seed ${x.seed} | L1 ${pct(x.l1)} L2 ${pct(x.l2)} L3 ${pct(x.l3)} R ${pct(x.r)} C ${pct(x.c)} | ${bad.length ? 'FAIL ' + bad.join(' ') : 'pass'}`);
    if (bad.length && stopOnFail) stopped = true;
    const k = results.length - resumed;
    if (k % 25 === 0) { const el = (Date.now() - t0) / 1000; console.error(`progress ${fmt(k)}/${fmt(pending.length)} new lines in ${el.toFixed(0)} s, about ${(((pending.length - k) * el) / k / 60).toFixed(1)} min to go`); }
  };

  const queue = pending.slice();
  await new Promise((resolve) => {
    let busy = 0, respawns = 0;
    const spawn = () => {
      const w = fork(self, ['--worker', '--root', root || ''], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      workers.add(w);
      let current = null, nextId = 0;
      const feed = () => {
        if (stopped || !queue.length) { if (current === null) { try { w.send({ type: 'exit' }); } catch { /* gone */ } } return; }
        current = queue.shift(); busy++; w.send({ type: 'run', id: nextId++, case: current });
      };
      w.on('message', (m) => {
        if (m.type === 'ready') { feed(); return; }
        if (m.type === 'done') { const c = current; current = null; busy--; emit({ ...m.result, key: c.key }); feed(); if (!busy && (stopped || !queue.length)) resolve(); }
      });
      w.on('exit', (code) => {
        workers.delete(w);
        if (current !== null) { const c = current; current = null; busy--; emit({ ...c, l1: 0, l2: 0, l3: 0, r: 0, c: 0, fails: [], error: `worker exited (${code}) during the run`, ms: 0 }); if (respawns++ < 20 && !stopped && queue.length) spawn(); }
        if (!workers.size && !busy) resolve();
      });
    };
    if (!queue.length) { resolve(); return; }
    for (let i = 0; i < Math.min(jobs, queue.length); i++) spawn();
  });
  for (const w of workers) { try { w.send({ type: 'exit' }); } catch { /* gone */ } }
  cleanup();

  const s = summarise(results);
  const wall = (Date.now() - t0) / 1000;
  const L = [];
  L.push(`SUMMARY tree ${tree}`);
  L.push(`FULL FACTORIAL ${fmt(full)} lines (${cross}); lines drawn ${fmt(cases.length)}; lines run ${fmt(s.lines)} (${fmt(s.lines - resumed)} this invocation, ${fmt(resumed)} resumed from ${out || 'nothing'}${stopped ? '; STOPPED after the first failing line (--stop-on-fail)' : ''}); lines failing ${fmt(s.failing.length)}${s.failing.some((x) => x.error) ? ` (of which ${s.failing.filter((x) => x.error).length} errored)` : ''}`);
  L.push(`worst of each rule over the ${fmt(s.lines)} lines: ${RULES.map((r) => `${r.toUpperCase()} ${s.worst[r].value.toFixed(2)}`).join('  ')}`);
  for (const r of RULES) if (s.worst[r].at) L.push(`  worst ${r.toUpperCase()} ${s.worst[r].value.toFixed(2)} (limit ${LIMITS[r]}) at ${caseLabel(s.worst[r].at)}`);
  L.push(`lines reading within 1 point of the limit: ${RULES.map((r) => `${r.toUpperCase()} ${s.near[r]}`).join('  ')}`);
  L.push(`time: ${wall.toFixed(0)} s wall on ${jobs} job${jobs > 1 ? 's' : ''}, ${s.lines - resumed ? (s.ms / 1000 / (s.lines - resumed)).toFixed(2) : '0'} s per run`);
  if (s.failing.length) { L.push(`FAILING LINES (${s.failing.length}):`); for (const x of s.failing.slice(0, 200)) L.push(`  ${caseLabel(x)} | L1 ${pct(x.l1)} L2 ${pct(x.l2)} L3 ${pct(x.l3)} R ${pct(x.r)} C ${pct(x.c)} | ${x.error ? 'ERROR ' + x.error : 'FAIL ' + x.fails.join(' ')}`); if (s.failing.length > 200) L.push(`  ... and ${s.failing.length - 200} more (all of them are in --out)`); }
  else L.push('FAILING LINES: none');
  console.log(L.join('\n'));
  process.exitCode = s.failing.length ? 1 : 0;
}
