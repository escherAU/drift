// DRIFT-4 slice 2, A2: the library at rest. Four small movements and nothing else: the selected shell LED
// breathes, a ripple crosses a watery label, a scanline walks down the console screen, the prompt cursor
// fades in and out. Locked cartridges never animate; unchanged frames cost nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { driftmanSkin } from '../src/shell/driftman.js';
import {
  cartridgeGrid, consoleGrid, consoleStyle, gridRows, drawLibrary, shelfLayout, ledLevelAt, rippleColAt, scanAt, cursorShadeAt,
  idleSignature, CART_W, CART_H, LABEL_W, LABEL_H,
} from '../src/shell/library.js';
import { createShell } from '../src/shell/shell.js';
import { discoverCartridges } from '../src/cartridge/loader.js';
import { newFrame } from '../src/shell/ui.js';
import { changedFraction, snap } from './helpers-flash.js';
import { makeRoot, mkShell, DT } from './helpers-shell.js';
import { frameLines } from './helpers-help.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const labelOf = (id) => fs.readFileSync(path.join(ROOT, 'cartridges', id, 'label.txt'), 'utf8').split(/\r?\n/).map((l) => l.replace(/ +$/, '')).slice(0, 10);
const ui = driftmanSkin.palette.ui;
const st = consoleStyle(driftmanSkin);

const SHELF = [
  ['classic', 'Drift Classic', 'DM-00', false, "Today's Drift, exactly as you know it. Calm by default, four modes, 21 scenes.", ['4 modes', '21 scenes', 'the original']],
  ['night-drive', 'Night Drive', 'DM-02', true, 'Neon highway, endless dusk, and a car that never needs fuel.', []],
  ['last-fantasy', 'Last Fantasy', 'DM-04', true, 'Twin moons, a sea of cloud, and one beacon at the edge of the world.', []],
  ['arcade', 'Arcade', 'DM-03', true, 'Bricks, a ball, a paddle, and a high score nobody remembers setting.', []],
  ['delza', 'Delza', 'DM-01', false, "A lamplighter's apprentice crosses the Hollowmere Reach to relight a dark city.", ['6 scenes', 'woodsy fantasy', 'about 16 min']],
];
const carts = () => SHELF.map(([id, title, code, locked, blurb, facts], i) => ({ id, title, code, locked, blurb, facts, label: labelOf(id === 'delza' ? 'classic' : id), ink: null, tint: 20 + 4 * i }));
const view = (index, idle) => ({ cartridges: carts(), index, prev: index, slide: 1, message: '', dip: 0, idle });
const draw = (cols, rows, v) => { const f = newFrame(cols, rows); drawLibrary(f, v, driftmanSkin); return f; };
const cellsDiffering = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };

// ---- the default is the old, still picture

test('idle: no idle field (or 0) draws exactly the still picture the pure tests expect', () => {
  for (const [cols, rows] of [[120, 40], [240, 67], [80, 24], [60, 14]]) {
    for (const index of [0, 1]) {
      const a = draw(cols, rows, { ...view(index), idle: undefined }), b = draw(cols, rows, view(index, 0));
      assert.deepEqual(Array.from(a.glyphs), Array.from(b.glyphs));
      assert.deepEqual(Array.from(a.shades), Array.from(b.shades));
    }
  }
});

// ---- the LED

test('idle: the selected LED breathes shades 3, 2, 1, 2, 3 (so 1 to 3 to 1) with a 4 s period, in the cartridge tint', () => {
  const seq = [];
  for (let t = 0; t <= 8.0001; t += 0.05) {
    const lv = ledLevelAt(t);
    assert.ok(lv >= 1 && lv <= 3);
    if (seq[seq.length - 1] !== lv) seq.push(lv);
    assert.equal(ledLevelAt(t + 4), lv, `period 4 s at ${t.toFixed(2)}`);
  }
  assert.deepEqual(seq, [3, 2, 1, 2, 3, 2, 1, 2, 3]);
  assert.equal(ledLevelAt(2), 1, 'the dimmest point is half a period in');
  // one level at a time, each held at least half a second
  let held = 0, prevLv = ledLevelAt(0);
  for (let t = 0.05; t < 8; t += 0.05) { const lv = ledLevelAt(t); if (lv === prevLv) held += 0.05; else { assert.ok(Math.abs(lv - prevLv) === 1); held = 0; prevLv = lv; } }
  // in the picture: the LED cell of the selected, unlocked cartridge
  const L = shelfLayout(120, 40, 'full');
  const ledAt = (t) => { const f = draw(120, 40, view(0, t)); return { g: f.glyphs[(L.cartTop + 1) * 120 + L.cartX + 25], s: f.shades[(L.cartTop + 1) * 120 + L.cartX + 25] }; };
  const tint = carts()[0].tint;
  assert.deepEqual([0.1, 1, 2, 3, 4.1].map((t) => ledAt(t).s - tint), [3, 2, 1, 2, 3]);
  assert.ok([0.1, 1, 2].every((t) => ledAt(t).g === 0x25cf));
  // it is the only thing on the cartridge that changes with the LED
  const g1 = cartridgeGrid(carts()[0], { selected: true, level: 3, ui, led: 1 }), g3 = cartridgeGrid(carts()[0], { selected: true, level: 3, ui, led: 3 });
  assert.equal(cellsDiffering(g1.s, g3.s) + cellsDiffering(g1.g, g3.g), 1);
});

// ---- the label ripple

test('idle: a ripple crosses a label with water, one column per 0.4 s, at most 4 cells changing per step', () => {
  assert.equal(rippleColAt(0.01), 0);
  assert.equal(rippleColAt(0.39), 0);
  assert.equal(rippleColAt(0.41), 1);
  assert.equal(rippleColAt(0.4 * 24 + 0.01), 0, 'wraps after the 24 columns of the window');
  for (let c = 0; c < 30; c++) assert.equal(rippleColAt(0.4 * c + 0.2), c % LABEL_W);
  const cart = carts()[0];
  const grid = (col) => cartridgeGrid(cart, { selected: true, level: 3, ui, ripple: col });
  const base = grid(-1);
  let swapped = 0;
  for (let col = 0; col < LABEL_W; col++) {
    const g = grid(col), next = grid((col + 1) % LABEL_W);
    const d = cellsDiffering(g.g, base.g);
    assert.ok(d <= 2, `column ${col} changes ${d} cells`);
    swapped += d;
    assert.ok(cellsDiffering(g.g, next.g) <= 4, `one step changes at most 4 cells (column ${col})`);
    assert.equal(cellsDiffering(g.s, base.s), 0, 'shades never change');
    for (let i = 0; i < g.g.length; i++) if (g.g[i] !== base.g[i]) {
      assert.ok(('~≈').includes(String.fromCharCode(g.g[i])) && ('~≈').includes(String.fromCharCode(base.g[i])), 'only ~ and ≈ swap, and only inside the label window');
      assert.notEqual(g.g[i], base.g[i]);
    }
  }
  assert.ok(swapped > 0, 'the ripple moves something on Classic');
});

test('idle: the ripple is generic - any label with ~ or ≈ ripples, a label without them does not (both arms)', () => {
  const wet = { ...carts()[0], label: ['', '', '', '', '', '', '', '~~~~~~~~~~~~~~~~~~~~~~~~', '≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈', '~≈~≈~≈~≈~≈~≈~≈~≈~≈~≈~≈'] };
  const dry = { ...carts()[0], label: ['  ▄▄▄▄  ', ' ▟████▙ ', ' ██▓███ ', '  ▀▀▀▀  '] };
  const frames = (cart) => Array.from({ length: LABEL_W }, (_, col) => Array.from(cartridgeGrid(cart, { selected: true, level: 3, ui, ripple: col }).g).join());
  assert.ok(new Set(frames(wet)).size > 1, 'a made-up wet label ripples');
  assert.equal(new Set(frames(dry)).size, 1, 'a dry label has no movement');
  // the row below is also water-only: a column never changes more than 2 of the three wet rows
  for (let col = 0; col < LABEL_W; col++) assert.ok(cellsDiffering(cartridgeGrid(wet, { selected: true, level: 3, ui, ripple: col }).g, cartridgeGrid(wet, { selected: true, level: 3, ui, ripple: -1 }).g) <= 2);
  // not selected, or locked: no ripple even when asked
  const still = Array.from(cartridgeGrid(carts()[0], { selected: false, level: 1, ui, ripple: -1 }).g).join();
  assert.equal(Array.from(cartridgeGrid(carts()[0], { selected: false, level: 1, ui, ripple: 5 }).g).join(), still);
  const locked = { ...carts()[1] };
  assert.equal(Array.from(cartridgeGrid(locked, { selected: true, level: 3, ui, ripple: 3 }).g).join(), Array.from(cartridgeGrid(locked, { selected: true, level: 3, ui, ripple: -1 }).g).join());
});

// ---- the scanline

test('idle: the console scanline walks down the 9 screen rows, 1 row per 0.5 s, one row at a time, then rests 8 s', () => {
  const firstSeen = new Map();
  let quietFrom = null, longestQuiet = 0, lastRow = null;
  for (let t = 0.01; t < 40; t += 0.01) {
    const s = scanAt(t);
    if (!s) { if (quietFrom === null) quietFrom = t; longestQuiet = Math.max(longestQuiet, t - quietFrom); continue; }
    quietFrom = null;
    assert.ok(s.p >= 0 && s.p <= 1);
    assert.ok(s.row >= -1 && s.row < 9 && s.from >= -1 && s.from < 9);
    if (s.row >= 0 && s.p === 1) assert.equal(s.from, -1, 'fully arrived: only one row is lit');
    if (s.from >= 0) assert.equal(s.from, s.row >= 0 ? s.row - 1 : 8, 'the row being left is the one just above (or the last one fading away)');
    if (s.row >= 0 && !firstSeen.has(s.row + ':' + Math.floor(t / 12.5))) firstSeen.set(s.row + ':' + Math.floor(t / 12.5), t);
    lastRow = s.row;
  }
  assert.ok(lastRow !== null);
  assert.ok(longestQuiet >= 7.6 && longestQuiet <= 8.01, `rests about 8 s (longest quiet ${longestQuiet.toFixed(2)})`);
  for (const cycle of [0, 1]) {
    const times = [];
    for (let r = 0; r < 9; r++) { const t = firstSeen.get(r + ':' + cycle); assert.ok(t !== undefined, `row ${r} in cycle ${cycle}`); times.push(t); }
    for (let r = 1; r < 9; r++) assert.ok(Math.abs(times[r] - times[r - 1] - 0.5) < 0.0201, `row ${r} comes 0.5 s after row ${r - 1} (${(times[r] - times[r - 1]).toFixed(3)})`);
  }
  // the cycle repeats every 12.5 s
  for (let t = 0.1; t < 14; t += 0.37) assert.deepEqual(scanAt(t), scanAt(t + 12.5));
  // idle 0 is the still picture
  assert.equal(scanAt(0), null);
});

// one palette step towards brighter: tint levels up, graphite -> dim -> text silver
const nextShade = (s, tint) => (s >= tint && s < tint + 3 ? s + 1 : s === 19 ? 15 : s === 18 ? 19 : s < 15 ? s + 1 : s);

test('idle: the scanline changes only its own screen row: text one shade brighter, blank cells a faint ░', () => {
  const sel = carts()[0];
  const base = consoleGrid(sel, { st, ui, n: 5 });
  const rowCells = (g, j) => gridRows(g)[4 + j];
  for (let j = 0; j < 9; j++) {
    const lit = consoleGrid(sel, { st, ui, n: 5, scan: { row: j, from: -1, p: 1 } });
    for (let y = 0; y < 18; y++) {
      const same = Array.from(lit.g.subarray(y * 84, (y + 1) * 84)).every((v, i) => v === base.g[y * 84 + i])
        && Array.from(lit.s.subarray(y * 84, (y + 1) * 84)).every((v, i) => v === base.s[y * 84 + i]);
      if (y === 4 + j) assert.ok(!same, `screen row ${j} changed`);
      else assert.ok(same, `row ${y} untouched by the scan of screen row ${j}`);
    }
    // only the 44 wide text area, and text never gets darker
    for (let x = 0; x < 84; x++) {
      const i = (4 + j) * 84 + x;
      if (lit.g[i] !== base.g[i] || lit.s[i] !== base.s[i]) {
        assert.ok(x >= 4 && x < 48, `column ${x} is inside the text area`);
        if (base.g[i] !== 32) { assert.equal(lit.g[i], base.g[i]); assert.equal(lit.s[i], nextShade(base.s[i], sel.tint), 'one shade brighter'); }
        else assert.equal(lit.g[i], 0x2591);
      }
    }
  }
  // half way through a step both rows are partly lit, and p = 0 / p = 1 bracket it
  const a = consoleGrid(sel, { st, ui, n: 5, scan: { row: 3, from: 2, p: 0 } }), b = consoleGrid(sel, { st, ui, n: 5, scan: { row: 3, from: 2, p: 1 } });
  const mid = consoleGrid(sel, { st, ui, n: 5, scan: { row: 3, from: 2, p: 0.5 } });
  assert.ok(cellsDiffering(mid.g, a.g) + cellsDiffering(mid.s, a.s) > 0 && cellsDiffering(mid.s, b.s) + cellsDiffering(mid.g, b.g) > 0);
  assert.equal(rowCells(a, 0).length, 84);
});

// ---- the prompt cursor

test('idle: the prompt cursor fades in and out over 2 s on a ramp of shades - never blinks', () => {
  const seq = [];
  for (let t = 0.001; t < 4; t += 0.01) {
    const s = cursorShadeAt(t);
    assert.ok(s >= 0 && s <= 15, 'a silver ramp level');
    if (seq[seq.length - 1] !== s) seq.push(s);
    assert.equal(cursorShadeAt(t + 2), s, 'period 2 s');
  }
  assert.ok(Math.max(...seq) >= 12 && Math.min(...seq) <= 6 && Math.min(...seq) > 0, 'it never goes out');
  assert.equal(new Set(seq).size, 3, 'dark, middle, bright');
  for (let i = 1; i < seq.length; i++) assert.ok(Math.abs(seq[i] - seq[i - 1]) <= 6, `small steps: ${seq[i - 1]} -> ${seq[i]}`);
  assert.ok(seq.length >= 8, 'at least 8 steps over two periods');
  assert.deepEqual(seq.slice(0, 5), [3, 9, 15, 9, 3]);
  // each level is held at least 0.4 s (the ripple's beat, which the LED keeps too)
  let run = 0, prev = cursorShadeAt(0.001), minHold = Infinity;
  for (let t = 0.011; t < 2; t += 0.01) { const s = cursorShadeAt(t); if (s === prev) run += 0.01; else { minHold = Math.min(minHold, run); run = 0; prev = s; } }
  assert.ok(minHold >= 0.4 - 0.011, `each shade is held at least 0.4 s (${minHold.toFixed(3)})`);
  // in the picture, and amber when there is no idle clock
  const sel = carts()[0];
  const cur = (cursor) => { const g = consoleGrid(sel, { st, ui, n: 5, cursor }); const i = 11 * 84 + 2 + 2 + 17; return [g.g[i], g.s[i]]; };
  assert.deepEqual(cur(undefined), [0x258c, 16]);
  assert.deepEqual(cur(9), [0x258c, 9]);
  // a locked cartridge has no prompt and so no cursor
  const lk = carts()[1];
  assert.ok(!gridRows(consoleGrid(lk, { st, ui, n: 5, cursor: 9 })).slice(4, 13).map((r) => [...r].slice(4, 48).join('')).join('').includes('▌'));
});

// ---- locked cartridges never animate

test('idle: a locked cartridge is the same picture for 10 s (label, LED, plate); the console may still run (both arms)', () => {
  const L = shelfLayout(120, 40, 'full');
  const region = (f) => {
    const out = [];
    for (let y = L.cartTop; y < L.cartTop + CART_H; y++) for (let x = L.cartX; x < L.cartX + CART_W; x++) out.push(f.glyphs[y * 120 + x], f.shades[y * 120 + x]);
    return out.join();
  };
  const first = region(draw(120, 40, view(1, 0.1)));
  for (let t = 0.1; t <= 10.0001; t += 0.1) assert.equal(region(draw(120, 40, view(1, t))), first, `locked label frame at ${t.toFixed(1)} s`);
  // control: the unlocked one moves in the same time
  const seen = new Set();
  for (let t = 0.1; t <= 10.0001; t += 0.1) seen.add(region(draw(120, 40, view(0, t))));
  assert.ok(seen.size > 10, `the unlocked cartridge animates (${seen.size} distinct frames)`);
  // the console scanline still runs under a locked cartridge
  const screenOf = (t) => gridRows(consoleGrid(carts()[1], { st, ui, n: 5, scan: scanAt(t) })).join('\n');
  assert.notEqual(screenOf(3.2), screenOf(2));
  // and the signature the shell watches is blind to what cannot change
  const cs = carts();
  const sigs = new Set();
  for (let t = 0.1; t < 12; t += 0.05) { const s = idleSignature(t, cs[1], 'full'); sigs.add(s.replace(/scan:.*$/, '')); }
  assert.equal(sigs.size, 1, 'no LED, ripple or cursor part in a locked signature');
});

// ---- the cost of rest

const SIZES = [[120, 40], [240, 67], [80, 24]];
for (const [cols, rows] of SIZES) {
  test(`idle ${cols}x${rows}: no frame step changes more than about 1% of the cells over 60 s (selected unlocked and locked)`, () => {
    for (const index of [0, 1]) {
      let prev = null, worst = 0, moving = 0, frames = 0;
      for (let k = 0; k <= 60 * 18; k++) {
        const s = snap(draw(cols, rows, view(index, k / 18)));
        if (prev) {
          const fr = changedFraction(s.g, prev.g, s.c, prev.c);
          if (k > 1) worst = Math.max(worst, fr);
          if (fr > 0) moving++;
          frames++;
        }
        prev = s;
      }
      assert.ok(worst <= 0.011, `${cols}x${rows} index ${index}: worst step ${(worst * 100).toFixed(2)}%`);
      if (cols >= 88) assert.ok(moving > 0, 'something moves');
    }
  });
}

test('idle: the shell redraws only when something visible changed - no wasted frames, a fraction of the ticks, all sizes', () => {
  const root = makeRoot();
  const found = discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
  for (const [cols, rows] of SIZES) {
    const sh = createShell({ cols, rows, cartridges: found.cartridges, consts: {}, host: { quit() {}, persist() {}, leaveToClassic() {} } });
    sh.frame();
    let prev = snap({ glyphs: sh.frame().glyphs, shades: sh.frame().shades });
    let draws = 0, wasted = 0;
    const ticks = 60 * 18;
    for (let k = 0; k < ticks; k++) {
      sh.tick(DT);
      if (!sh.dirty()) continue;
      draws++;
      const f = sh.frame();
      const s = snap(f);
      if (changedFraction(s.g, prev.g, s.c, prev.c) === 0) wasted++;
      prev = s;
    }
    assert.equal(wasted, 0, `${cols}x${rows}: ${wasted} redraws drew the same picture`);
    assert.ok(draws > 0, 'it does animate');
    assert.ok(draws < ticks * 0.6, `${cols}x${rows}: ${draws} of ${ticks} ticks redrew`);
  }
});

test('idle: through the real app an idle library writes only changed cells, never an empty or repeated frame', () => {
  const c = mkShell({ startScreen: { screen: 'library' }, cols: 120, rows: 40 });
  c.app.start();
  c.tick(0.5);
  const n0 = c.writes();
  let steps = 0, prev = snap(c.app.screenshot());
  for (let k = 0; k < 60 * 18; k++) {
    c.app.tick(DT);
    const s = snap(c.app.screenshot());
    if (changedFraction(s.g, prev.g, s.c, prev.c) > 0) steps++;
    prev = s;
  }
  const writes = c.writes() - n0;
  assert.equal(writes, steps, 'exactly one write per visible change, none for the rest');
  assert.ok(steps > 20 && steps < 60 * 18 * 0.5, `${steps} visible changes in 60 s`);
  const bytes = c.stdout.writes.slice(n0).reduce((a, w) => a + w.length, 0);
  assert.ok(bytes / 60 < 5000, `${(bytes / 60).toFixed(0)} B/s`);
  c.done();
});

test('idle: nothing idles during insert, boot and eject - the picture there is the still one', () => {
  const c = mkShell({ startScreen: { screen: 'library' }, cols: 120, rows: 40 });
  c.app.start();
  c.tick(12); // deep into idle
  c.goto('fixture');
  c.tick(5);
  const sigBefore = idleSignature(5, carts()[0], 'full');
  assert.notEqual(sigBefore, idleSignature(0, carts()[0], 'full'));
  c.key('\r');
  assert.equal(c.sh().screen, 'insert');
  // during the insert the same instant always draws the same picture whatever the library clock was
  c.tick(DT);
  const a = c.text();
  c.done();
  const d = mkShell({ startScreen: { screen: 'library' }, cols: 120, rows: 40 });
  d.app.start();
  d.tick(0.5);
  d.goto('fixture');
  d.tick(0.4);
  d.key('\r');
  assert.equal(d.sh().screen, 'insert');
  d.tick(DT);
  assert.equal(d.text(), a, 'insert frame 0 does not depend on how long the library idled');
  d.done();
});
