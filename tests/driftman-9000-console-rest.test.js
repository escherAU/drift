// DRIFT-7 C13: the Driftman 9000 at rest (p = 1, phase boot) and the finished machine at p = 0.55 (where an eject folds back from).
// Brightness never moves at rest: only hue does, and every moving colour goes through safeHue (no cell in the saturated-red zone).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newFrame } from '../src/shell/ui.js';
import { shelfLayout } from '../src/shell/library.js';
import { sizeTier } from '../src/shell/ui.js';
import {
  hook, FULL, MINI, DT, flush, drawHook, localCells, cellY, textAt, copyFrame, shell9000, RGB_CELL, PALETTE_BG,
} from './helpers-driftman-console.js';

const BANNED = [0x222b, 0x2261, 0x25cd, 0x25ce, 0x25d0, 0x25d1, 0x25d2, 0x25d3, 0x25e2, 0x25e3];
const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const redShare = (rgb) => { const r = lin((rgb >>> 16) & 255), g = lin((rgb >>> 8) & 255), b = lin(rgb & 255); return r + g + b > 0 ? r / (r + g + b) : 0; };
const rest = (size, t) => localCells(drawHook(size, 'boot', 1, t));

// ---- the rest frame is the designer's machine

test('9000 rest, full: the shelf, the pane, the panel, the name, the stripe and the ring are where the design puts them', () => {
  const c = rest(FULL, 3.4);
  const at = (x, y) => String.fromCodePoint(c.glyphs[y * c.cols + x]);
  // the shelf: 34 heavy lines with the pane's feet either side
  assert.equal(textAt(c, 24, 2, 36), '┴' + '━'.repeat(34) + '┴');
  assert.equal(at(0, 2), '╶'); assert.equal(at(83, 2), '╴');
  // the pane's foot and the lit slot
  assert.equal(textAt(c, 27, 0, 30), '╰──┬' + '─'.repeat(22) + '┬──╯');
  assert.equal(textAt(c, 30, 1, 24), '│' + '▌'.repeat(22) + '│');
  // the glass pane round the screen: the 2000's screen rectangle (interior 3..48 by 4..12)
  assert.equal(textAt(c, 2, 3, 48), '╭' + '─'.repeat(46) + '╮');
  assert.equal(textAt(c, 2, 13, 48), '╰' + '─'.repeat(46) + '╯');
  for (let y = 4; y <= 12; y++) {
    assert.equal(at(2, y), '│'); assert.equal(at(49, y), '│');
    for (let x = 3; x <= 48; x++) { assert.equal(c.shades[y * c.cols + x], RGB_CELL); assert.equal(c.bg[y * c.cols + x], 0x0E1426, `glass at ${x},${y}`); }
  }
  // the panel: the spectrum, 13 x 5 of full blocks; the orbit; the labels and the hints
  for (let y = 5; y <= 9; y++) assert.equal(textAt(c, 67, y, 13), '█'.repeat(13));
  assert.equal(at(66, 7), ' '); assert.equal(at(80, 7), ' '); assert.equal(at(70, 4), ' '); assert.equal(at(70, 10) === '█', false);
  assert.equal(textAt(c, 56, 10, 5), 'ORBIT'); assert.equal(textAt(c, 69, 10, 8), 'SPECTRUM');
  assert.equal(textAt(c, 56, 12, 13), 'e · fold away'); assert.equal(textAt(c, 72, 12, 8), 'h · keys');
  let beads = 0, centre = 0;
  for (let y = 5; y <= 9; y++) for (let x = 54; x <= 62; x++) if (at(x, y) === '◆') { beads++; if (x === 58 && y === 7) centre++; }
  assert.equal(beads, 17, '16 on the orbit and the centre diamond');
  assert.equal(centre, 1);
  // the name, the stripe, the model
  assert.equal(textAt(c, 3, 15, 25), 'D R I F T M A N   9 0 0 0');
  assert.equal(textAt(c, 31, 15, 34), '────────◇────────◆────────◇───────');
  assert.equal(textAt(c, 68, 15, 13), 'MODEL DM-9000');
  assert.equal(textAt(c, 21, 14, 42), '┈'.repeat(42));
  // the ring of light: braille arcs on rows 16 (upper) and 17 (lower), x 9..74, curling at the ends
  assert.equal(textAt(c, 9, 16, 66), '⢀⡠⠤⠒⠊' + '⠉'.repeat(56) + '⠑⠒⠤⢄⡀');
  assert.equal(textAt(c, 9, 17, 66), '⠈⠑⠒⠤⢄' + '⣀'.repeat(56) + '⡠⠤⠒⠊⠁');
  // nothing past the 2000's old furniture: no dial, no grille, no TUNE, no feet, no title of the old machine
  for (let y = 0; y < 18; y++) for (let x = 0; x < 84; x++) {
    const g = c.glyphs[y * 84 + x];
    assert.ok(![0x2592, 0x2550, 0x255e, 0x2561, 0x2580, 0x2554, 0x2557, 0x255a, 0x255d, 0x2551].includes(g), `a 2000 glyph U+${g.toString(16)} at ${x},${y}`);
  }
  assert.ok(!/2000|TUNE|EJECT|RESET/.test(Array.from({ length: 18 }, (_, y) => textAt(c, 0, y, 84)).join('\n')));
});

test('9000 rest, mini: the 38 x 4 machine has the plain name, the shelf, the pane\'s foot and the ring\'s lower arc', () => {
  const c = rest(MINI, 3.4);
  assert.equal(textAt(c, 19, 2, 13), 'DRIFTMAN 9000');
  assert.equal(textAt(c, 0, 1, 38), '╶' + '─'.repeat(7) + '┴' + '━'.repeat(20) + '┴' + '─'.repeat(7) + '╴');
  assert.equal(textAt(c, 5, 0, 28), '╰──┬' + '─'.repeat(20) + '┬──╯');
  assert.equal(textAt(c, 1, 3, 36), '⠈⠑⠒⠤⢄' + '⣀'.repeat(26) + '⡠⠤⠒⠊⠁');
  assert.equal(String.fromCodePoint(c.glyphs[2 * 38 + 17]), '◆');
  // the shell's LEDs are drawn at columns 2..14 of row 2; the hook leaves that stretch empty
  for (let x = 0; x < 17; x++) assert.equal(c.glyphs[2 * 38 + x], 32, 'column ' + x);
});

test('9000 rest: no round LED eye (U+25CF, U+25CB, U+25C9), none of the banned glyphs; the centre mark is a cool diamond (blue over red) with no red-leaning colour anywhere', () => {
  for (const size of [FULL, MINI]) {
    for (const [phase, p, t] of [['boot', 1, 3.4], ['insert', 0.55, 1.5], ['boot', 0.8, 0.2]]) {
      const c = localCells(drawHook(size, phase, p, t));
      for (let i = 0; i < c.glyphs.length; i++) {
        const g = c.glyphs[i];
        assert.ok(![0x25cf, 0x25cb, 0x25c9, ...BANNED].includes(g), 'glyph U+' + g.toString(16));
        if (c.shades[i] !== RGB_CELL) continue;
        for (const rgb of [c.fg[i], c.bg[i]]) if (rgb !== PALETTE_BG) assert.ok(redShare(rgb) < 0.75, `red share ${redShare(rgb).toFixed(2)} at cell ${i} (${size.tier} ${phase} ${p})`);
      }
    }
  }
  const c = rest(FULL, 0);
  const i = 7 * 84 + 58;
  assert.equal(String.fromCodePoint(c.glyphs[i]), '◆');
  assert.ok((c.fg[i] & 255) > ((c.fg[i] >>> 16) & 255) + 40, 'blue well over red: ' + c.fg[i].toString(16));
});

// ---- brightness never moves at rest; hue does, and only through safeHue

for (const [size, name] of [[FULL, 'full'], [MINI, 'mini']]) {
  test(`9000 rest, ${name}: over 60 s, at four clock phases, the glyphs do not change and every cell keeps its brightness (hue moves, lightness does not)`, () => {
    const ref = rest(size, 0);
    const TOL = 0.02; // measured 0.0123 (the 6-bit colour grid under safeHue); the meter's swing is 0.10
    let worst = 0, hueMoves = 0;
    const seen = new Set();
    for (const phaseOff of [0, 0.25, 0.5, 0.75]) {
      for (let k = 0; k < 18 * 60; k += 3) {
        const t = (k + phaseOff) * DT;
        const c = rest(size, t);
        for (let i = 0; i < c.glyphs.length; i++) {
          assert.equal(c.glyphs[i], ref.glyphs[i], `glyph moved at cell ${i}, t ${t.toFixed(3)}`);
          assert.equal(c.shades[i], ref.shades[i]);
          const d = Math.abs(cellY(c, i) - cellY(ref, i));
          if (d > worst) worst = d;
          if (c.shades[i] === RGB_CELL && c.fg[i] !== ref.fg[i]) { hueMoves++; if (seen.size < 5000) seen.add(c.fg[i]); }
        }
      }
    }
    console.log(`REST ${name} worst cell brightness change over 60 s x 4 phases: ${worst.toFixed(5)}; fg changes ${hueMoves}; distinct colours ${seen.size}`);
    assert.ok(worst < TOL, `a cell's brightness moved by ${worst}`);
    assert.ok(hueMoves > 1000 && seen.size > 150, 'the hue does move (not a vacuous check): ' + hueMoves + ' / ' + seen.size);
  });
}

test('9000 rest: every moving element moves in hue (spectrum 20 deg/s, halo 30 deg/s, shelf one cell per 0.5 s, name three steps a second, the orbit diamond one place per 0.375 s) and nothing else does', () => {
  const a = rest(FULL, 10.0), b = rest(FULL, 10.5), c0 = rest(FULL, 10 + 1 / 3);
  const fgAt = (c, x, y) => c.fg[y * c.cols + x];
  assert.notEqual(fgAt(a, 70, 6), fgAt(b, 70, 6), 'spectrum');
  assert.notEqual(fgAt(a, 30, 16), fgAt(b, 30, 16), 'halo');
  assert.notEqual(fgAt(a, 40, 2), fgAt(b, 40, 2), 'shelf steps after 0.5 s');
  assert.equal(fgAt(rest(FULL, 10.0), 40, 2), fgAt(rest(FULL, 10.4), 40, 2), 'the shelf holds between steps');
  assert.notEqual(fgAt(a, 3, 15), fgAt(c0, 3, 15), 'name steps 3 a second');
  assert.equal(fgAt(rest(FULL, 10.0), 3, 15), fgAt(rest(FULL, 10.3), 3, 15), 'the name holds between steps');
  // the orbit: the gold diamond is on one place; 0.375 s later it is on the next
  const gold = (c) => { const out = []; for (let y = 5; y <= 9; y++) for (let x = 54; x <= 62; x++) if (c.glyphs[y * 84 + x] === 0x25c6 && !(x === 58 && y === 7) && ((c.fg[y * 84 + x] >>> 16) & 255) > (c.fg[y * 84 + x] & 255)) out.push(x + ',' + y); return out; };
  const g0 = gold(rest(FULL, 12.0)), g1 = gold(rest(FULL, 12.375));
  assert.ok(g0.length >= 1 && g0.length <= 5 && g1.length >= 1, `${g0} / ${g1}`);
  assert.notDeepEqual(g0, g1);
  // after a full 6 s turn it is back
  assert.deepEqual(gold(rest(FULL, 18.0)), g0);
  // static parts do not move: the pane's edge, the hairlines, the labels
  for (const [x, y] of [[2, 3], [10, 2], [60, 10], [72, 15], [24, 0]]) assert.equal(fgAt(a, x, y), fgAt(rest(FULL, 41.7), x, y), `static ${x},${y}`);
});

// ---- p = 0.55: the whole, finished machine (an eject folds back from here)

for (const [size, name] of [[FULL, 'full'], [MINI, 'mini']]) {
  test(`9000 p = 0.55, ${name}: the finished machine is whole - the name, the diamond mark, the ring and ${name === 'full' ? 'the 13 x 5 spectrum ' : ''}are all there, and the glyphs are the rest frame's`, () => {
    const whole = localCells(drawHook(size, 'insert', 0.55, 1.5));
    const r = rest(size, 3.4);
    let same = 0, n = 0;
    for (let i = 0; i < r.glyphs.length; i++) { n++; if (whole.glyphs[i] === r.glyphs[i] && whole.shades[i] === r.shades[i]) same++; }
    console.log(`P055 ${name}: ${same}/${n} cells share the rest frame's glyph`);
    assert.ok(same / n >= 0.9, 'glyph set shared with rest: ' + same / n);
    assert.equal(same, n, 'in fact all of them');
    if (name === 'full') {
      assert.equal(textAt(whole, 3, 15, 25), 'D R I F T M A N   9 0 0 0');
      for (let y = 5; y <= 9; y++) assert.equal(textAt(whole, 67, y, 13), '█'.repeat(13));
      assert.equal(textAt(whole, 9, 16, 66), '⢀⡠⠤⠒⠊' + '⠉'.repeat(56) + '⠑⠒⠤⢄⡀');
      assert.equal(String.fromCodePoint(whole.glyphs[7 * 84 + 58]), '◆');
    } else {
      assert.equal(textAt(whole, 19, 2, 13), 'DRIFTMAN 9000');
      assert.equal(textAt(whole, 1, 3, 36), '⠈⠑⠒⠤⢄' + '⣀'.repeat(26) + '⡠⠤⠒⠊⠁');
    }
    // none of the 2000 is left, and its brightness is the rest frame's within the hue-only fan
    for (let i = 0; i < whole.glyphs.length; i++) assert.ok(Math.abs(cellY(whole, i) - cellY(r, i)) < 0.06, `cell ${i} Y ${cellY(whole, i)} vs ${cellY(r, i)}`);
  });
}

// ---- size classes (the full console, the compact mini console, a rect smaller than either)

test('9000 size classes: full draws the 84 x 18 machine (spaced name, 13 x 5 spectrum), mini draws the 38 x 4 one with the plain name and no spectrum, a smaller rect draws a clipped piece of the full one', () => {
  const full = rest(FULL, 3.4), mini = rest(MINI, 3.4);
  assert.equal(full.cols, 84);
  assert.equal(mini.cols, 38);
  assert.equal(textAt(full, 3, 15, 25), 'D R I F T M A N   9 0 0 0');
  for (let y = 5; y < 10; y++) assert.equal(textAt(full, 67, y, 13), '█'.repeat(13), 'spectrum row ' + y);
  assert.equal(textAt(mini, 19, 2, 13), 'DRIFTMAN 9000');
  for (let y = 0; y < 4; y++) assert.ok(!textAt(mini, 0, y, 38).includes('█'.repeat(13)), 'no spectrum in the mini console');
  // a tier says the layout; the rect clips it. Mini cells drawn with tier full would be wrong in count
  assert.notEqual(textAt(mini, 0, 2, 38), textAt(full, 0, 2, 38));
  // a rect smaller than the layout: the cells inside are the full draw's cells
  const small = { x: 6, y: 3, w: 40, h: 8 };
  const f = newFrame(60, 30);
  hook.drawConsole(f, { phase: 'boot', p: 1, t: 3.4, rect: { ...small }, screen: null, tier: 'full' });
  let inked = 0;
  for (let y = 0; y < small.h; y++) {
    for (let x = 0; x < small.w; x++) {
      const i = (small.y + y) * f.cols + small.x + x, j = y * full.cols + x;
      assert.equal(f.glyphs[i], full.glyphs[j], `clipped cell ${x},${y}`);
      if (f.glyphs[i] !== 32) inked++;
    }
  }
  assert.ok(inked > 30, 'the clipped rect still shows part of the machine: ' + inked);
  // and a rect hanging off the frame's left and top edges shows the rest of the machine
  const g = newFrame(60, 30);
  hook.drawConsole(g, { phase: 'boot', p: 1, t: 3.4, rect: { x: -20, y: -2, w: 84, h: 18 }, screen: null, tier: 'full' });
  for (let y = 0; y < 16; y++) for (let x = 0; x < 60; x++) assert.equal(g.glyphs[y * 60 + x], full.glyphs[(y + 2) * 84 + x + 20], `offset cell ${x},${y}`);
});

// ---- in a real shell, the 9000's console is the hook's; the others are not

test('9000 in the shell: while the 9000 is inserted its console is the hook\'s (the rect differs from the standard console in hundreds of cells)', async () => {
  const cols = 120, rows = 40;
  const lay = shelfLayout(cols, rows, sizeTier(cols, rows));
  const grab = async (withHook) => {
    const sh = shell9000(cols, rows, { withHook });
    await flush();
    let f = null;
    for (let k = 0; k < 60; k++) { f = copyFrame(sh.frame()); sh.tick(DT); }
    return f;
  };
  const withH = await grab(true), without = await grab(false);
  let diff = 0;
  for (let y = lay.consoleTop; y < lay.consoleTop + 18; y++) for (let x = lay.consoleX; x < lay.consoleX + 84; x++) if (withH.glyphs[y * cols + x] !== without.glyphs[y * cols + x]) diff++;
  assert.ok(diff > 300, 'the 9000 console differs from the standard one in ' + diff + ' cells');
});
