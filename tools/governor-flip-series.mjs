#!/usr/bin/env node
// DRIFT-13 correction 1: reviewer tool, NOT part of `npm test`. The per-read L2 series after an `i` press, on the real app: for each run (size, rate, seed, press time) the whole cycle is read up to
// 4 s after the press, the meter's worst readings are forgotten after every read (so each read is reported alone, the transition history stays) and the reads at or after the flip frame that are
// over L2's 25 % are listed as reads after the flip, with the share. This is what the flip's aftermath looks like (README: the flip guard's job): cells with two changes just before the flip are
// hot at it and stay hot until their oldest change is a second old.
//   node tools/governor-flip-series.mjs [ship|mut] [sizes] [fps list] [seeds] [press seconds]
//   node tools/governor-flip-series.mjs ship 40x10,41x11,42x12,80x24 9,18,30 1,6 31,45,61,62,63,95   (the defaults)
// `mut` runs the governor that forgets its history on every reset (the code before DRIFT-13 correction 1). The last line is the summary; tests/fixtures/governor-flip-series.json holds the one
// the README quotes (the defaults, plus 43x12,50x16,41x10,45x12 at seeds 2,3,4,7 and presses 31,62,94).
import fs from 'node:fs';
import { runLife, makeTree } from '../tests/helpers-life-app.js';

const [mode = 'ship', sizesArg = '40x10,41x11,42x12,80x24', fpsArg = '9,18,30', seedsArg = '1,6', pressArg = '31,45,61,62,63,95'] = process.argv.slice(2);
const sizes = sizesArg.split(',');
const fpsList = fpsArg.split(',').map(Number), seeds = seedsArg.split(',').map(Number), presses = pressArg.split(',').map(Number);
const root = mode === 'mut' ? makeTree('new', { 'src/governor.js': (t) => t.replace('if (opts.hard || !Gp) {', 'if (true) {') }) : null;
let runs = 0, over = 0, flipOnly = 0, latest = 0;
const rows = [];
try {
  for (const sz of sizes) for (const fps of fpsList) for (const seed of seeds) for (const at of presses) {
    const [cols, rws] = sz.split('x').map(Number);
    let prev = null, kf = null;
    const bad = [];
    await runLife({
      cols, rows: rws, fps, seed, clock: 'grid', clockSeed: seed, keys: [{ at, key: 'i' }], seconds: at + 4, feedAll: true, stopAtDissolve: false, sceneSeconds: 30, root,
      grab: (k, screen, app, f, meter) => {
        const st = app.getState();
        if (prev && kf === null && st.light !== prev.light) kf = k;
        prev = st;
        const rep = meter.report(); meter.forgetWorst();
        if (kf !== null && rep.l2.x1.worstFraction > 0.25) bad.push({ d: k - kf, v: rep.l2.x1.worstFraction });
      },
    });
    runs++;
    if (bad.length) {
      over++;
      const last = bad[bad.length - 1];
      latest = Math.max(latest, last.d / fps);
      if (bad.every((b) => b.d === 0)) flipOnly++;
      rows.push(`${sz} fps ${fps} seed ${seed} i@${at}: over at reads +${bad.map((b) => `${b.d}:${(b.v * 100).toFixed(1)}`).join(' ')} (last +${(last.d / fps).toFixed(2)} s)`);
    }
  }
} finally { if (root) fs.rmSync(root, { recursive: true, force: true }); }
if (rows.length) console.log(rows.join('\n'));
console.log(`${mode === 'mut' ? 'HISTORY CLEARED' : 'SHIPPED'}: runs ${runs}, runs with a read over 25 % at or after the flip frame ${over} (only the flip read itself ${flipOnly}), latest over-limit read ${latest.toFixed(2)} s after the flip`);
