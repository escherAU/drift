#!/usr/bin/env node
// DRIFT-9: reviewer tool, NOT part of `npm test`. The shelf scrub on the REAL app over a wide matrix of clocks, colour modes, sizes and tap intervals, every case metered on the
// viewer's 18 Hz grid against the five rules (L1, L2 x1, L3, R x1, C). One line per case: the clock, mode, size, tap interval, the five worst values in per cent, and which rules fail.
//   node tools/shelf-matrix.mjs [--clocks grid,q156,jitter] [--modes truecolor,256] [--sizes 41x11,78x24,...] [--taps held,0.3,...] [--seeds 1] [--fails-only] [--jobs N]
// Defaults: all three clocks, both modes, sizes 41x11, 78x24 to 84x24, 88x39 and 89x40, and 15 tap intervals from held down to 0.7 s (900 cases; about 0.5 s each on one core).
// --jobs N runs N worker processes on slices of the matrix (default 1). The summary line counts the cases that fail each rule.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes('--' + name);
const list = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);

const SIZES = ['41x11', '78x24', '79x24', '80x24', '81x24', '82x24', '83x24', '84x24', '88x39', '89x40'];
const TAPS = ['held', '0.3', '0.34', '0.38', '0.42', '0.44', '0.46', '0.48', '0.5', '0.52', '0.55', '0.58', '0.62', '0.66', '0.7'];
const clocks = list(opt('clocks', 'grid,q156,jitter')), modes = list(opt('modes', 'truecolor,256')), sizes = list(opt('sizes', SIZES.join(','))), taps = list(opt('taps', TAPS.join(',')));
const seeds = list(opt('seeds', '1')).map(Number);
const jobs = Math.max(1, Number(opt('jobs', 1)));

if (process.send) {
  // a worker: run the slice it is given and send each line back
  const { runShelf, showNums } = await import('../tests/helpers-shelf-real.js');
  process.on('message', async (cases) => {
    for (const k of cases) {
      const [cols, rows] = k.size.split('x').map(Number);
      const r = await runShelf({ clock: k.clock, clockSeed: k.seed, mode: k.mode, cols, rows, gap: k.tap === 'held' ? 'held' : Number(k.tap), seed: k.seed });
      process.send({ k, r: { nums: r.nums, fail: r.fail, screen: r.screen, paints: r.paints } });
    }
    process.send({ done: true });
  });
} else {
  const cases = [];
  for (const clock of clocks) for (const mode of modes) for (const size of sizes) for (const tap of taps) for (const seed of seeds) cases.push({ clock, mode, size, tap, seed });
  const results = new Array(cases.length);
  const slices = Array.from({ length: jobs }, () => []);
  cases.forEach((c, i) => slices[i % jobs].push({ ...c, i }));
  const tally = {};
  let failing = 0, done = 0;
  const show = (k, r) => `${k.clock.padEnd(6)} ${k.mode.padEnd(9)} ${k.size.padEnd(6)} tap ${String(k.tap).padEnd(4)} seed ${k.seed} | L1 ${r.nums.l1.toFixed(2)} L2 ${r.nums.l2.toFixed(2)} L3 ${r.nums.l3.toFixed(2)} R ${r.nums.r.toFixed(2)} C ${r.nums.c.toFixed(2)} | ${r.fail.length ? 'FAIL ' + r.fail.join(',') : 'pass'}${r.screen === 'library' ? '' : ' (screen ' + r.screen + ')'}`;
  await Promise.all(slices.map((slice) => new Promise((resolve) => {
    if (!slice.length) return resolve();
    const w = fork(fileURLToPath(import.meta.url), argv, { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
    w.on('message', (m) => {
      if (m.done) { w.kill(); return resolve(); }
      results[m.k.i] = m.r; done++;
      if (m.r.fail.length) { failing++; for (const f of m.r.fail) tally[f] = (tally[f] || 0) + 1; }
      if (!flag('fails-only') || m.r.fail.length) console.log(show(m.k, m.r));
    });
    w.send(slice);
  })));
  console.log(`SUMMARY ${done} cases, ${failing} fail; by rule: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
}
