// DRIFT-7 item 2b: walking the shelf is fast AND flash-safe. (Item 2 first made the shelf take one step per 1.2 s and drop the presses in between;
// that read as a laggy or broken keyboard.) Now no press is ever refused: the cursor moves at once on every press, the dots and the console screen
// follow it on the very next frame, and what is DRAWN is made safe instead (src/shell/scrub.js):
//   a lone press          the normal 0.36 s slide, frame for frame what 4d2f8da drew;
//   any other press       the art waits (it may change at full contrast at most twice in SCRUB_GATE_SECONDS), then dissolves into a dimmed strip
//                         that follows the cursor, and when the presses stop dissolves back to full art once.
// These tests pin: every press lands (wrap and both directions); the answer to a press is on screen at once; five presses register inside 1.5 s; the
// four brightness rules pass ABSOLUTELY (no slack) in a held-key walk and a burst at the six sizes, dense art and Delza's, at four clock phases;
// a lone press is byte-identical to the 4d2f8da golden; the old hard-sliding walk FAILS the same meter (so the test bites). The mutation proofs
// (remove the dissolves, the dimming, the gate; drop a press) are in shell-shelf-scrub-mutation.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as shellModule from '../src/shell/shell.js';
import { SLIDE_SECONDS, LOCKED_MESSAGE } from '../src/shell/shell.js';
import { SCRUB_GATE_SECONDS, SCRUB_IN_SECONDS, SCRUB_HOLD_SECONDS, SCRUB_OUT_SECONDS, SCRUB_STRIP_SECONDS, SCRUB_TEXT_Y, SCRUB_BLOCK_Y } from '../src/shell/scrub.js';
import { shelfLayout } from '../src/shell/library.js';
import { createFlashMeter } from './helpers-flash.js';
import { sizeTier } from '../src/shell/ui.js';
import { tmpRoot, writeCart, lockedManifest, LABEL } from './helpers-cartridge.js';
import {
  SIZES, ORDER, DT, FPS, foilRoot, foilShell, play, heldPresses, burstPresses, walkReport, showRep, passes1x, pc,
  frameHash, loneRun, LONE_PRESSES, readShelf, saysCursor, platesCard,
} from './helpers-shelf.js';

const TABLE = [];
// the row of position dots (full tier), the one row the strip leaves at full brightness; -1 where there is none
const readDotsRow = (cols, rows) => (sizeTier(cols, rows) === 'full' ? shelfLayout(cols, rows, 'full').dotsY : -1);
const N = ORDER.length;
const STEP = { next: 1, prev: -1 };

test('shelf: the lock-out is gone and the constants are what the README says', () => {
  assert.equal('SHELF_MOVE_SECONDS' in shellModule, false, 'the 1.2 s step is removed');
  assert.equal(SLIDE_SECONDS, 0.36);
  assert.ok(SCRUB_GATE_SECONDS >= 1.0 && SCRUB_GATE_SECONDS <= 1.1, 'the gate is the meter\'s 1 s window plus a frame');
  assert.ok(SCRUB_IN_SECONDS <= 0.3 && SCRUB_OUT_SECONDS <= 0.3 && SCRUB_HOLD_SECONDS <= 0.3, 'the dissolves and the pause are short');
  assert.ok(SCRUB_STRIP_SECONDS >= 0.25, 'the strip is redrawn at most four times a second (each redraw rewrites the shelf)');
  assert.ok(SCRUB_TEXT_Y * 0.35 + 0.0036 < 0.1 && SCRUB_BLOCK_Y + 0.0036 < 0.1, 'the dim caps keep any swing under the meter\'s 0.10');
});

// ---- (a) every press lands: index after n presses = start + n (mod the shelf), both directions, wrap included

const SCHEDULES = {
  'held next': () => heldPresses({ dir: 'next' }), 'held prev': () => heldPresses({ dir: 'prev' }), 'held alt': () => heldPresses({ dir: 'alt' }),
  'burst next': () => burstPresses({ dir: 'next' }), 'burst prev': () => burstPresses({ dir: 'prev' }), 'burst alt': () => burstPresses({ dir: 'alt' }),
};

for (const [cols, rows] of [[120, 40], [80, 24]]) {
  for (const startId of ['aaa', 'foil-b']) {
    test(`shelf ${cols}x${rows} from ${startId}: every press of a held key and of a burst lands on the right card, wrap included, and the art settles on the last`, () => {
      for (const [name, make] of Object.entries(SCHEDULES)) {
        const presses = make();
        const { sh, carts } = foilShell(cols, rows, { root: foilRoot(), select: startId });
        const titles = carts.map((c) => c.title);
        let want = ORDER.indexOf(startId);
        const { log } = play(sh, presses, 10);
        assert.equal(log.length, presses.length, `${name}: every press was delivered`);
        log.forEach((e, k) => {
          want = (want + N + STEP[presses[k][1]]) % N;
          assert.equal(e.indexAfter, want, `${name}: press ${k + 1} at ${presses[k][0].toFixed(2)} s`);
        });
        assert.equal(sh.state().cartridge, ORDER[want], `${name}: the cursor ended on ${ORDER[want]}`);
        // the other arm: nothing is left waiting; after the dissolves the picture is the cursor's card, dots and name and the card in the slot
        const f = sh.frame();
        assert.ok(saysCursor(f, titles, want), `${name}: dots and name say ${ORDER[want]}: ${JSON.stringify(readShelf(f, titles))}`);
        assert.ok(platesCard(f, titles, want), `${name}: the card in the slot is ${ORDER[want]}: ${JSON.stringify(readShelf(f, titles))}`);
      }
    });
  }
}

// ---- (b) the answer to a press is on screen at once; (c) five presses register inside 1.5 s

for (const [cols, rows] of SIZES) {
  test(`shelf ${cols}x${rows}: after every press the dots and the console screen show the new cursor within 0.15 s (one frame once the shelf scrubs), for a held key and a burst`, () => {
    for (const [name, make] of [['held alt', SCHEDULES['held alt']], ['burst next', SCHEDULES['burst next']], ['held next', SCHEDULES['held next']]]) {
      const presses = make();
      const { sh, carts } = foilShell(cols, rows, { root: foilRoot(), select: 'aaa' });
      const titles = carts.map((c) => c.title);
      const says = []; // per frame: does it say the cursor as of that frame?
      const { log } = play(sh, presses, 8, { onFrame: (f, k, clock, s) => says.push({ clock, ok: saysCursor(f, titles, ORDER.indexOf(s.state().cartridge)) }) });
      // the lone first press types its name in over 0.3 s (the slide, unchanged): judge from 0.12 s after it; every later frame must say the cursor
      const from = presses[0][0] + 0.12;
      const wrong = says.filter((s) => s.clock >= from && !s.ok).map((s) => s.clock.toFixed(2));
      assert.deepEqual(wrong, [], `${name}: frames that did not say the cursor`);
      // latency of each press: the first frame at or after it that says the cursor
      let worst = 0;
      log.forEach((e) => {
        const k0 = Math.ceil(e.t * FPS - 1e-9);
        let k = k0;
        while (k < says.length && !says[k].ok) k++;
        const lat = k < says.length ? (k - k0) * DT + (k0 * DT - e.t) : Infinity;
        worst = Math.max(worst, lat);
      });
      assert.ok(worst <= 0.15, `${name}: worst response ${worst.toFixed(3)} s`);
      TABLE.push(`${cols}x${rows}`.padEnd(8) + `response ${name.padEnd(10)} worst ${worst.toFixed(3)} s over ${log.length} presses`);
    }
  });
}

test('shelf: five presses register within 1.5 s for a held key (30 ms repeats after a 0.3 and a 0.5 s delay), a burst, and a tap every 0.25 s', () => {
  const taps = Array.from({ length: 5 }, (_, k) => [0.5 + k * 0.25, 'next']);
  for (const [name, presses] of [['held 0.3', heldPresses({ delay: 0.3 })], ['held 0.5', heldPresses({ delay: 0.5 })], ['burst', burstPresses({})], ['taps', taps]]) {
    const { sh } = foilShell(120, 40, { root: foilRoot(), select: 'aaa' });
    const { log } = play(sh, presses, 4);
    const span = log[4].t - log[0].t;
    assert.ok(span <= 1.5, `${name}: five presses took ${span.toFixed(2)} s`);
    assert.equal(log[4].indexAfter, 5 % N, `${name}: five steps right from the first card`);
    TABLE.push(`walk speed ${name.padEnd(9)} five presses registered in ${span.toFixed(2)} s`);
  }
  // the walk keeps that pace: by 1.4 s, 0.9 s into the key being held, about twenty presses had landed and the cursor is where they put it
  const { sh } = foilShell(120, 40, { root: foilRoot(), select: 'aaa' });
  const { log } = play(sh, heldPresses({ delay: 0.3 }), 1.4);
  assert.ok(log.length >= 18, `${log.length} presses landed by 1.4 s`);
  assert.equal(sh.state().cartridge, ORDER[log.length % N]);
});

// ---- (a) the meter passes ABSOLUTELY in a held-key walk and a burst: L1, L2, L3, R at 1x, no slack, six sizes, dense art and Delza's, foil on and off

for (const [cols, rows] of SIZES) {
  test(`shelf ${cols}x${rows}: a held-key walk (30 ms repeats after 0.3 s, 3 s) and a burst of five pass L1, L2, L3 and R at 1x, same and alternating directions, foil on and off, dense art and Delza's`, () => {
    const worst = { held: null, burst: null };
    for (const art of ['dense', 'delza']) for (const withFoil of [true, false]) {
      for (const [kind, names] of [['held', ['held next', 'held alt']], ['burst', ['burst next', 'burst alt']]]) {
        for (const name of names) {
          const { rep } = walkReport(cols, rows, SCHEDULES[name](), { art, withFoil, seconds: 9 });
          assert.ok(passes1x(rep), `${cols}x${rows} ${art} foil ${withFoil} ${name}: ${showRep(rep)}`);
          assert.equal(rep.c.pass, true, `${cols}x${rows} ${art} foil ${withFoil} ${name}: the colour rule`);
          const cur = worst[kind];
          if (!cur || rep.l2.x1.worstFraction + rep.l1.x1.worstFraction + rep.l3.worstFraction > cur.s) worst[kind] = { s: rep.l2.x1.worstFraction + rep.l1.x1.worstFraction + rep.l3.worstFraction, rep, tag: `${art} ${withFoil ? 'foil' : 'none'} ${name}` };
        }
      }
    }
    for (const kind of ['held', 'burst']) TABLE.push(`${cols}x${rows}`.padEnd(8) + `meter ${kind.padEnd(5)} (worst of 8 runs: ${worst[kind].tag}) ${showRep(worst[kind].rep)}`);
  });
}

// The strip is dim by construction: while it is on screen (a held key, from the end of the dissolve in until the dissolve back begins) no cell of
// the frame (but the position dots, which are the answer to the key press) has a luminance above what a letter or a full block can swing the meter by.
test('shelf scrub: the dim strip - every cell of every frame while it is up has a luminance under 0.0905, so no two states of a cell differ by the meter\'s 0.10 (and it carries no foil)', () => {
  for (const [cols, rows] of [[80, 24], [120, 40], [240, 67], [78, 24]]) {
    for (const art of ['dense', 'delza']) {
      const { sh } = foilShell(cols, rows, { root: foilRoot({ art }), select: 'aaa' });
      const meter = createFlashMeter(cols, rows, FPS);
      const dotsY = readDotsRow(cols, rows);
      let top = 0, low = 1, seen = 0, rgb = 0;
      play(sh, SCHEDULES['held alt'](), 6, {
        onFrame: (f, k, clock) => {
          meter.push(f);
          if (clock < 2.2 || clock > 4.0) return; // the strip is up from 1.8 s (first press 0.5 s + the gate + the dissolve in) to the end of the key at 4.0 s
          seen++;
          if (f.shades.includes(255)) rgb++;
          for (let i = 0; i < cols * rows; i++) {
            if (Math.floor(i / cols) === dotsY) continue;
            top = Math.max(top, meter.cellY(i)); low = Math.min(low, meter.cellY(i));
          }
        },
      });
      assert.ok(seen >= 20);
      assert.equal(rgb, 0, `${cols}x${rows} ${art}: no full-colour (foil) cell in the strip`);
      assert.ok(top <= 0.0905, `${cols}x${rows} ${art}: brightest cell ${top.toFixed(4)}`);
      assert.ok(top - low < 0.1, `${cols}x${rows} ${art}: swing ${(top - low).toFixed(4)}`);
      assert.ok(top > 0.05, `${cols}x${rows} ${art}: the strip is not black (${top.toFixed(4)})`);
    }
  }
});

// The dissolves are dissolves: the picture goes to the strip over several frames (and back), no frame carries more than half of the change, no cell
// changes more than twice (once, or once through the midway step that keeps a same-glyph cell under the ramp rule).
test('shelf scrub: dissolve shape - into the strip and back to full art over at least four frames each, no frame carrying more than half, no cell changing more than twice', () => {
  for (const [cols, rows] of [[120, 40], [80, 24], [88, 39]]) {
    for (const [name, presses, windows] of [
      ['held alt', SCHEDULES['held alt'](), { in: [1.5, 1.95], out: [4.3, 4.9] }],
    ]) {
      const { sh } = foilShell(cols, rows, { root: foilRoot({ art: 'delza' }), select: 'aaa' });
      let prev = null;
      const series = [], flips = new Uint8Array(cols * rows);
      play(sh, presses, 7, {
        onFrame: (f, k, clock) => {
          let n = 0;
          if (prev) {
            for (let i = 0; i < f.glyphs.length; i++) {
              if (f.glyphs[i] !== prev.g[i] || f.shades[i] !== prev.s[i]) { n++; if (clock >= windows.in[0] && clock <= windows.in[1]) flips[i]++; }
            }
          }
          series.push({ clock, n });
          prev = { g: f.glyphs.slice(), s: f.shades.slice() };
        },
      });
      for (const [which, [a, b]] of Object.entries(windows)) {
        const w = series.filter((s) => s.clock >= a && s.clock <= b && s.n >= 0.01 * cols * rows);
        const total = w.reduce((x, s) => x + s.n, 0);
        const max = Math.max(...w.map((s) => s.n));
        assert.ok(w.length >= 4, `${cols}x${rows} ${name} ${which}: ${w.length} frames carry the dissolve`);
        assert.ok(max <= 0.5 * total, `${cols}x${rows} ${name} ${which}: one frame carries ${(100 * max / total).toFixed(0)}% of the change`);
      }
      assert.ok(Math.max(...flips) <= 2, `${cols}x${rows} ${name}: a cell changed ${Math.max(...flips)} times in the dissolve in`);
    }
  }
});

// (i) the dissolves are clock-stepped: four phases of the 18 fps frame clock (the first tick lands 0, 1/4, 1/2, 3/4 of a frame in)
test('shelf: the scrub-in and the dissolve back to full art pass every rule at four phases of the frame clock, held key and burst, dense art and Delza\'s', () => {
  for (const [cols, rows] of [[80, 24], [88, 39], [120, 40]]) {
    for (const k of [0, 1, 2, 3]) {
      for (const art of ['dense', 'delza']) {
        for (const name of ['held alt', 'burst next']) {
          const { rep } = walkReport(cols, rows, SCHEDULES[name](), { art, seconds: 9, offset: (k / 4) * DT });
          assert.ok(passes1x(rep), `${cols}x${rows} phase ${k}/4 ${art} ${name}: ${showRep(rep)}`);
        }
      }
    }
  }
});

// a schedule none of the above was tuned on: random bursts and pauses, from a seed
test('shelf: random walks (bursts of 1-12 presses at 30-100 ms, pauses of 0.15-2 s) that nothing was tuned on pass every rule at the six sizes', () => {
  let s = 20261112;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let trial = 0; trial < 3; trial++) {
    const presses = [];
    for (let t = 0.3; t < 12;) {
      const burst = Math.floor(rnd() * 12) + 1, rate = [0.03, 0.03, 0.05, 0.1][Math.floor(rnd() * 4)];
      for (let k = 0; k < burst; k++) { presses.push([t, rnd() < 0.25 ? 'prev' : 'next']); t += rate; }
      t += [0.15, 0.3, 0.45, 0.7, 1.0, 1.3, 2.0][Math.floor(rnd() * 7)];
    }
    for (const [cols, rows] of SIZES) {
      const { rep } = walkReport(cols, rows, presses, { art: trial % 2 ? 'dense' : 'delza', seconds: 15, offset: (trial / 3) * DT });
      assert.ok(passes1x(rep), `${cols}x${rows} trial ${trial}: ${showRep(rep)}`);
    }
  }
});

// ---- (e) the control: the hard-sliding walk (a full-contrast slide on every press, nothing waiting) fails the same meter

test('shelf control: a press every 0.5 s with the old hard slides (scrub off) FAILS the meter at all six sizes; with the scrub the same presses pass', () => {
  const taps = Array.from({ length: 12 }, (_, k) => [0.5 + k * 0.5, 'next']);
  const hard = [], soft = [];
  for (const [cols, rows] of SIZES) {
    const a = walkReport(cols, rows, taps, { art: 'delza', seconds: 9, shellOpts: { scrub: false } });
    const b = walkReport(cols, rows, taps, { art: 'delza', seconds: 9 });
    if (passes1x(a.rep)) hard.push(`${cols}x${rows}`);
    assert.ok(passes1x(b.rep), `${cols}x${rows} with the scrub: ${showRep(b.rep)}`);
    TABLE.push(`${cols}x${rows}`.padEnd(8) + `control taps 0.5 s: hard slides ${showRep(a.rep)} | scrub ${showRep(b.rep)}`);
    assert.equal(a.log.length, taps.length, 'the hard-sliding shell took every press too (it is the flash that is wrong, not the input)');
  }
  assert.deepEqual(hard, [], 'the hard-sliding walk must fail at every size');
  // and a held key on the compact layout (the one card is replaced in place, dense art): fails there too
  for (const [cols, rows] of [[80, 24], [78, 24]]) {
    const a = walkReport(cols, rows, SCHEDULES['held next'](), { art: 'delza', seconds: 9, shellOpts: { scrub: false } });
    assert.equal(passes1x(a.rep), false, `${cols}x${rows} held key with hard slides: ${showRep(a.rep)}`);
  }
});

// ---- (d) a lone press is the slide it always was: frame for frame the golden captured from a git archive export of 4d2f8da

test('shelf: four lone presses (1.5 s apart) draw exactly the frames 4d2f8da drew, at six sizes with dense art and Delza\'s (hash of every frame)', () => {
  const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/shelf-lone-press-4d2f8da.json', import.meta.url), 'utf8'));
  assert.equal(golden.source, '4d2f8da');
  assert.equal(Object.keys(golden.runs).length, SIZES.length * 2);
  for (const [cols, rows] of SIZES) {
    for (const art of ['dense', 'delza']) {
      const want = golden.runs[`${cols}x${rows}/${art}`], got = loneRun(cols, rows, art);
      assert.equal(got.length, want.length);
      const bad = got.map((h, k) => (h === want[k] ? -1 : k)).filter((k) => k >= 0);
      assert.deepEqual(bad.slice(0, 5), [], `${cols}x${rows} ${art}: frames that differ from 4d2f8da (of ${got.length})`);
      assert.ok(new Set(got).size > 20, 'the run really moves (slides and idle steps)');
    }
  }
});

test('shelf: the golden bites - a changed cell changes the hash, and two presses 0.3 s apart (not lone) do not draw the golden', () => {
  const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/shelf-lone-press-4d2f8da.json', import.meta.url), 'utf8'));
  const { sh } = foilShell(120, 40, { root: foilRoot(), select: 'aaa' });
  const f = sh.frame();
  const h0 = frameHash(f);
  const i = f.glyphs.findIndex((g) => g !== 32);
  f.shades[i] = (f.shades[i] + 1) % 16;
  assert.notEqual(frameHash(f), h0, 'one shade changed');
  const hashes = [];
  const { sh: s2 } = foilShell(120, 40, { root: foilRoot({ art: 'dense' }), select: 'aaa' });
  play(s2, [[1, 'next'], [1.3, 'next'], [4, 'prev'], [5.5, 'next']], 8, { onFrame: (fr) => hashes.push(frameHash(fr)) });
  const want = golden.runs['120x40/dense'];
  assert.ok(hashes.some((h, k) => h !== want[k]), 'a hurried second press draws something else');
  assert.equal(LONE_PRESSES.length, 4);
});

// ---- (h) locked cartridges, wrap, Enter, help and quit while the shelf scrubs

function lockedShelf(over = {}) {
  const root = foilRoot();
  writeCart(root, 'zzz-locked', { 'manifest.json': lockedManifest('zzz-locked'), 'label.txt': LABEL });
  const calls = { quit: [], persist: [] };
  const host = { persist: (x) => calls.persist.push(x), quit: (c) => calls.quit.push(c), leaveToClassic() {} };
  const { sh, carts } = foilShell(120, 40, { root, select: 'aaa', shellOpts: { host }, ...over });
  return { sh, carts, calls, ids: carts.map((c) => c.id) };
}
// ticks in frame-sized steps and draws, as the app does (one big tick advances the scrub one phase at a time)
const run = (s, seconds) => { for (let t = 0; t < seconds - 1e-9; t += DT) { s.frame(); s.tick(DT); } };
const RIGHT = 'right', LEFT = 'left'; // the shell takes key names (the app turns escape sequences into them)

test('shelf scrub: the wrap, a locked cartridge in the walk, Enter on it, Enter on an unlocked one, help and quit keys all behave while the shelf scrubs', () => {
  const rows = (f) => { const o = []; for (let y = 0; y < f.rows; y++) o.push(String.fromCharCode(...f.glyphs.subarray(y * f.cols, (y + 1) * f.cols))); return o.join('\n'); };
  // wrap forwards and backwards through five cartridges, the last one locked
  let { sh, ids, carts } = lockedShelf();
  const titles = carts.map((c) => c.title);
  assert.equal(ids.length, 5);
  assert.equal(ids[4], 'zzz-locked');
  sh.tick(1);
  for (let k = 0; k < 7; k++) sh.key(RIGHT);
  assert.equal(sh.state().cartridge, ids[2], 'seven presses right from the first card');
  for (let k = 0; k < 3; k++) sh.key(LEFT);
  assert.equal(sh.state().cartridge, ids[4], 'three left from the third card wraps back onto the locked card');
  // Enter on the locked card, mid-scrub: it dips and says so, nothing is inserted
  sh.tick(0.05);
  sh.key('enter');
  assert.equal(sh.state().screen, 'library');
  sh.tick(0.1);
  assert.ok(rows(sh.frame()).includes(LOCKED_MESSAGE), 'the locked message is on screen');
  assert.equal(sh.state().cartridge, ids[4]);
  run(sh, 4);
  assert.equal(sh.state().screen, 'library');
  // Enter after the shelf has settled works the same
  sh.key('enter');
  assert.equal(sh.state().screen, 'library', 'locked: still the library');

  // Enter on an unlocked card straight after quick presses inserts the CURSOR's card, not the one the art still shows
  let calls;
  ({ sh, ids, calls } = lockedShelf());
  sh.tick(1);
  sh.key(RIGHT); sh.tick(0.1); sh.key(RIGHT); sh.key(RIGHT); // the art is still on foil-a (the slide), the cursor on foil-b... then zzz
  const cursor = sh.state().cartridge;
  assert.equal(cursor, ids[3]);
  sh.key('enter');
  assert.equal(sh.state().screen, 'insert');
  assert.equal(sh.state().cartridge, ids[3], 'the insert is of the cursor\'s cartridge');
  assert.deepEqual(calls.persist, [{ lastCartridge: ids[3] }]);
  sh.tick(0.3);
  const f = sh.frame();
  assert.ok(f.shades.every((s) => s < f.palette.sgr.length || s === 255), 'every shade of the insert frame is in the palette');

  // help while scrubbing: opens (the keys are listed), closes, and the walk goes on and settles
  ({ sh, ids, calls } = lockedShelf());
  sh.tick(1);
  sh.key(RIGHT); sh.tick(0.1); sh.key(RIGHT); sh.key(RIGHT);
  sh.key('h');
  assert.equal(sh.state().help, true, 'help opens mid-scrub');
  sh.tick(0.2);
  assert.ok(rows(sh.frame()).toLowerCase().includes('keys'), 'the help panel is drawn');
  sh.key(RIGHT); // the other arm: a shelf key while help is open does nothing
  assert.equal(sh.state().cartridge, ids[3]);
  sh.key('h');
  assert.equal(sh.state().help, false);
  sh.key(LEFT);
  assert.equal(sh.state().cartridge, ids[2], 'the walk goes on after help');
  run(sh, 5);
  assert.ok(platesCard(sh.frame(), titles, 2) && saysCursor(sh.frame(), titles, 2), 'and the art settled on the cursor');

  // quit keys while scrubbing: q quits with 0, Ctrl+C with 130
  const a = lockedShelf();
  a.sh.tick(1); a.sh.key(RIGHT); a.sh.tick(0.1); a.sh.key(RIGHT);
  a.sh.key('q');
  assert.deepEqual(a.calls.quit, [0]);
  const b = lockedShelf();
  b.sh.tick(1); b.sh.key(RIGHT); b.sh.key(RIGHT);
  b.sh.key('\x03');
  assert.deepEqual(b.calls.quit, [130]);
});

test('shelf scrub: the geometry the readers use is the library\'s own (guards the helpers against a layout change)', () => {
  const L = shelfLayout(120, 40, 'full');
  assert.equal(typeof L.dotsY, 'number');
  assert.ok(L.consoleTop + 4 < 40);
});

test('shelf TABLE: every measured value', () => {
  console.log(['TABLE shelf scrub (1x; limits L1 25, L2 25, L3 30, R 25 percent)', ...TABLE.map((l) => '  ' + l)].join('\n'));
  assert.ok(TABLE.length > 0 && pc(0.5) === '50.00');
});
