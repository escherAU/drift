// DRIFT-5: scene B2, Luma's, Open Late. The design's promises, read off rendered frames:
//   - a diner at night: the rooftop sign LUMA'S in tube letters (6 wide, 5 tall, 2-column gaps, the apostrophe one tube), DINER under it, a far
//     silhouette facade with booth windows, a scalloped awning, a door with OPEN LATE, PIE · COFFEE · 24 HRS, the Quarterlight Arcade next door
//     (a marquee ringed with chase bulbs, a cabinet screen running a tiny game), the kerb, and the Halcyon parked in profile (wheels still)
//   - motion: bulbs step every 0.25 s; the apostrophe and the M's diagonal dip 3 -> 1 -> 3 over 0.4 s at most every 2.5 s and never go off;
//     a server walks a window a column per 0.3 s; steam rises a cell per 0.5 s; the game steps every 0.25 s; a customer every 40 s
//   - calm: under 5% of the cells change in a frame, no kept glyph moves more than a shade step
import test from 'node:test';
import assert from 'node:assert/strict';
import diner, { LAYOUTS, layoutFor, geometry, dipStart, flickerShade, DIP_LEN, DIP_GAP_MIN, CHASE_STEP, WALK_STEP, STEAM_STEP, GAME_STEP, CUSTOMER_EVERY } from '../cartridges/night-drive/scenes/diner.js';
import { renderScene } from '../src/cells.js';
import * as S from '../cartridges/night-drive/lib/sprites.js';
import { SUN, CORAL, MAG, CYAN, MINT, ICE, VIOLET, TEXT, NEAR, COUNT } from '../cartridges/night-drive/lib/palette.js';
import { FPS, MANIFEST, framer, rowText, cellsOf, rampViolations, changedShare, calmRun, walk, meanMs, cp } from './helpers-night-drive.js';

const frame = framer(diner);
const at = (f, x, y) => f.g[y * f.w + x];
const colAt = (f, x, y) => f.c[y * f.w + x];
const textAt = (f, x, y, n) => rowText(f, y).slice(x, x + n);

// ---- D1 the contract and the manifest

test('night-drive diner (D1): a cells scene called diner, LAYOUTS widest first from 100x32, layoutFor, and the manifest lists it between Red Light, Rain and Overdrive with its menu entry', () => {
  assert.equal(diner.id, 'diner');
  assert.equal(diner.kind, 'cells');
  assert.ok(Array.isArray(LAYOUTS) && LAYOUTS.length >= 2);
  assert.deepEqual([LAYOUTS[0].minCols, LAYOUTS[0].minRows], [100, 32]);
  assert.deepEqual([LAYOUTS[LAYOUTS.length - 1].minCols, LAYOUTS[LAYOUTS.length - 1].minRows], [0, 0]);
  assert.equal(layoutFor(120, 40).name, LAYOUTS[0].name);
  assert.equal(layoutFor(100, 32).name, LAYOUTS[0].name, 'at the breakpoint: the big layout');
  assert.notEqual(layoutFor(99, 32).name, LAYOUTS[0].name);
  assert.notEqual(layoutFor(100, 31).name, LAYOUTS[0].name);
  assert.notEqual(layoutFor(80, 24).name, LAYOUTS[0].name);
  const ids = MANIFEST.scenes.map((s) => s.id);
  assert.ok(ids.indexOf('redlight') < ids.indexOf('diner') && ids.indexOf('diner') < ids.indexOf('overdrive'), 'tape order: B1 redlight, B2 diner, B4 overdrive');
  const sc = MANIFEST.scenes.find((s) => s.id === 'diner');
  assert.deepEqual([sc.kind, sc.title], ['cells', "Luma's, Open Late"]);
  assert.deepEqual(MANIFEST.programs[0].scenes, ids);
  const entry = MANIFEST.menu.find((e) => e.scene === 'diner');
  assert.ok(entry);
  assert.deepEqual([entry.label, entry.program, entry.note], ["B2  LUMA'S, OPEN LATE", 'tape', '1:30']);
  assert.equal([...entry.label].length, 21);
  assert.ok(entry.desc && [...entry.desc].length <= 76);
  const labels = MANIFEST.menu.map((e) => e.label);
  assert.ok(labels.indexOf('B1  RED LIGHT, RAIN') < labels.indexOf(entry.label) && labels.indexOf(entry.label) < labels.indexOf('B4  OVERDRIVE'));
});

// ---- D2 purity

test('night-drive diner (D2): the same (t, w, h, seed) draws the same frame; t0 shifts the scene\'s own clock; the seed changes the picture; odd times do not throw', () => {
  for (const [w, h] of [[120, 40], [80, 24], [100, 32], [240, 67]]) {
    for (const t of [0, 5.3, 12, 33.7, 41]) {
      const a = frame(t, w, h, 1), b = frame(t, w, h, 1);
      assert.deepEqual(a.g, b.g);
      assert.deepEqual(a.c, b.c);
    }
  }
  const early = frame(10, 120, 40, 1, 0), later = frame(40, 120, 40, 1, 30);
  assert.deepEqual(later.g, early.g, 'the frame at t = 40 with t0 = 30 is the frame at t = 10');
  assert.deepEqual(later.c, early.c);
  assert.notDeepEqual(frame(10, 120, 40, 1, 0).g, frame(10, 120, 40, 1, 3).g, 'a different t0 is a different moment');
  assert.notDeepEqual(frame(10, 120, 40, 1).g, frame(10, 120, 40, 2).g, 'the seed matters');
  for (const t of [-5, NaN, Infinity, -Infinity, 1e9]) assert.doesNotThrow(() => frame(t), String(t));
  assert.deepEqual(frame(-5).g, frame(0).g);
  assert.deepEqual(Array.from(renderScene(diner, 12.5, 120, 40, 1).glyphs), Array.from(frame(12.5).g), 'the shared renderer gives the same picture');
});

// ---- D3 the parked car

test('night-drive diner (D3): the Halcyon is parked in profile and its wheels are the still plus in every frame of 90 s, never a glyph of the spinner', () => {
  const W = 120, H = 40, g = geometry(W, H);
  assert.ok(g.car, 'a car at full size');
  const spots = S.PROFILE_WHEELS.map((wh) => [g.car.x + wh.x, g.car.y + wh.y]);
  let frames = 0;
  for (let k = 0; k <= 90 * FPS; k++) {
    const f = frame(k / FPS, W, H);
    for (const [x, y] of spots) {
      const s = textAt(f, x, y, 3);
      assert.equal(s, S.WHEEL_PARKED, `frame ${k}: the wheel at ${x},${y} reads ${s}`);
      assert.ok(!S.WHEEL_FRAMES.includes(s));
    }
    frames++;
  }
  assert.equal(frames, 90 * FPS + 1);
  // the body of the car is the sprite, its tail and headlight are off (no lit ice 3 or coral 3 on it)
  const f = frame(3, W, H);
  assert.equal(textAt(f, g.car.x + 8, g.car.y, 9), S.PROFILE_33[0].slice(8, 17));
  assert.equal(textAt(f, g.car.x + 2, g.car.y + 2, 29), S.PROFILE_33[2].slice(2, 31));
  for (let j = 0; j < S.PROFILE_H; j++) for (let i = 0; i < S.PROFILE_W; i++) {
    const c = colAt(f, g.car.x + i, g.car.y + j);
    assert.ok(c !== ICE[3] && c !== CORAL[3], `lights off at ${i},${j}`);
  }
});

// ---- D4 the flicker

// The rules for one flicker series [{ t, shade }]: every sample is drawn at shade 1 to 3, the minimum is 1, a step is one shade, a dip lasts DIP_LEN
// and two dips start at least DIP_GAP_MIN apart. Returns the dip starts.
function checkSeries(series, fps, label) {
  const step = 1 / fps;
  let min = 9;
  const dips = [];
  let inDip = null;
  for (let k = 0; k < series.length; k++) {
    const { t, shade } = series[k];
    assert.ok(shade >= 1 && shade <= 3, `${label}: shade ${shade} at ${t.toFixed(3)} s (never off)`);
    if (shade < min) min = shade;
    if (k && Math.abs(shade - series[k - 1].shade) > 1) assert.fail(`${label}: shade ${series[k - 1].shade} -> ${shade} at ${t.toFixed(3)} s`);
    if (shade < 3 && inDip === null) inDip = t;
    if (shade === 3 && inDip !== null) { dips.push({ start: inDip, len: t - inDip }); inDip = null; }
  }
  assert.equal(min, 1, `${label}: the dip reaches shade 1`);
  for (const d of dips) assert.ok(Math.abs(d.len - DIP_LEN) <= step + 1e-9, `${label}: a dip of ${d.len.toFixed(3)} s at ${d.start.toFixed(3)} s`);
  for (let k = 1; k < dips.length; k++) assert.ok(dips[k].start - dips[k - 1].start >= DIP_GAP_MIN - step - 1e-9, `${label}: dips ${(dips[k].start - dips[k - 1].start).toFixed(3)} s apart`);
  return dips;
}

test('night-drive diner (D4): the apostrophe and the M\'s diagonal dip from shade 3 to 1 and back over 0.4 s in single steps, at most once every 2.5 s, and the glyphs are never blank, at 18 and 72 frames a second and for other seeds', () => {
  assert.equal(DIP_LEN, 0.4);
  assert.equal(DIP_GAP_MIN, 2.5);
  const W = 120, H = 40, g = geometry(W, H);
  assert.equal(g.flicker.length, 3, 'the apostrophe and the two cells of the M\'s diagonal');
  for (const seed of [1, 2, 3, 9]) {
    for (const fps of [18, 72]) {
      const per = g.flicker.map(() => []);
      for (let k = 0; k <= 90 * fps; k++) {
        const t = k / fps;
        const f = frame(t, W, H, seed);
        g.flicker.forEach((c, n) => {
          assert.equal(at(f, c.x, c.y), cp(c.glyph), `seed ${seed} ${fps} fps t=${t.toFixed(3)}: the glyph is drawn`);
          const col = colAt(f, c.x, c.y);
          assert.notEqual(col, 0, 'never colour 0');
          assert.ok(MAG.includes(col), 'the sign stays magenta');
          per[n].push({ t, shade: MAG.indexOf(col) });
        });
      }
      const dips = per.map((s, n) => checkSeries(s, fps, `seed ${seed} ${fps} fps cell ${n}`));
      assert.ok(dips[0].length >= 20, `${dips[0].length} dips in 90 s`);
      for (let n = 1; n < 3; n++) assert.deepEqual(per[n].map((s) => s.shade), per[0].map((s) => s.shade), 'the three cells dip together');
    }
  }
  // the schedule's own functions agree with what is drawn
  for (let k = 0; k < 10; k++) {
    const d = dipStart(k, 1);
    assert.equal(flickerShade(d - 0.01, 1), 3);
    assert.equal(flickerShade(d + 0.2, 1), 1, 'the bottom of the dip');
    assert.equal(flickerShade(d + DIP_LEN + 0.01, 1), 3);
    if (k) assert.ok(d - dipStart(k - 1, 1) >= DIP_GAP_MIN);
  }
  // the dip is also bounded in a window with a clock far from zero
  assert.ok(flickerShade(1e6, 1) >= 1 && flickerShade(1e6, 1) <= 3);
  // control: a flicker that goes to zero fails the check
  const bad = [3, 3, 2, 1, 0, 1, 2, 3].map((shade, k) => ({ t: k / 18, shade }));
  assert.throws(() => checkSeries(bad, 18, 'control'), /never off/);
  const jump = [3, 3, 1, 1, 2, 3].map((shade, k) => ({ t: k / 18, shade }));
  assert.throws(() => checkSeries(jump, 18, 'control'), /3 -> 1/);
});

// ---- D5 the chase bulbs

test('night-drive diner (D5): the marquee bulbs step one place every 0.25 s exactly, 20 to 40 cells change a step, and never more than one step in 0.25 s', () => {
  assert.equal(CHASE_STEP, 0.25);
  for (const [W, H] of [[120, 40], [100, 32], [80, 24]]) {
    const g = geometry(W, H);
    assert.ok(g.ring.length >= 60 && g.ring.length % 4 === 0, `${W}x${H}: a ring of ${g.ring.length} bulbs`);
    const state = (f) => g.ring.map((c) => {
      const s = textAt(f, c.x, c.y, 1), col = colAt(f, c.x, c.y);
      if (s === '●' && col === SUN[3]) return 1;
      if (s === '○' && col === SUN[0]) return 0;
      return assert.fail(`${W}x${H}: a bulb cell reads ${s} in colour ${col}`);
    });
    let prev = state(frame(0, W, H)), steps = 0, last = 0;
    const dt = 1 / 72;
    for (let k = 1; k <= 60 * 72; k++) {
      const t = k / 72;
      const cur = state(frame(t, W, H));
      let diff = 0;
      for (let i = 0; i < cur.length; i++) if (cur[i] !== prev[i]) diff++;
      if (diff) {
        steps++;
        const boundary = Math.round(t / 0.25) * 0.25;
        assert.ok(Math.abs(t - boundary) <= dt + 1e-9, `${W}x${H}: bulbs changed at ${t.toFixed(3)} s, not on a quarter second`);
        assert.ok(t - last >= 0.25 - dt - 1e-9, 'never more than one step in 0.25 s');
        assert.ok(diff >= 20 && diff <= 40, `${W}x${H}: ${diff} cells changed in a step`);
        // the pattern moved one place along the ring
        for (let i = 0; i < cur.length; i++) assert.equal(cur[i], prev[(i + cur.length - 1) % cur.length], `${W}x${H}: bulb ${i} at ${t.toFixed(3)} s`);
        last = t;
      }
      prev = cur;
    }
    assert.equal(steps, 240, `${W}x${H}: 240 steps in 60 s`);
  }
  // key frame 2: a quarter second on, the bulbs have stepped one place
  const g = geometry(120, 40);
  const a = g.ring.map((c) => textAt(frame(0.01, 120, 40), c.x, c.y, 1)).join('');
  const b = g.ring.map((c) => textAt(frame(0.26, 120, 40), c.x, c.y, 1)).join('');
  assert.notEqual(a, b);
  assert.equal(b, a.slice(-1) + a.slice(0, -1));
});

// ---- D6 the small motions

test('night-drive diner (D6): the server walks a window row a column per 0.3 s and turns at both ends; steam rises a cell per 0.5 s; the game steps every 0.25 s; a customer comes out every 40 s', () => {
  assert.deepEqual([WALK_STEP, STEAM_STEP, GAME_STEP, CUSTOMER_EVERY], [0.3, 0.5, 0.25, 40]);
  const W = 120, H = 40, g = geometry(W, H);
  const dt = 1 / 72;

  // --- the walker: the near-silhouette cells inside window 2
  const win = g.walkWindow; // { x, y, w, h } of the interior
  const walkerX = (f) => {
    const xs = [], ys = [];
    for (let y = win.y; y < win.y + win.h; y++) for (let x = win.x; x < win.x + win.w; x++) if (colAt(f, x, y) === NEAR && at(f, x, y) !== 32) { xs.push(x); ys.push(y); }
    assert.ok(xs.length >= 5 && xs.length <= 7, `${xs.length} walker cells`);
    return Math.min(...xs);
  };
  let prevX = walkerX(frame(0, W, H)), moves = 0, lastT = 0, dir = 0, turns = 0, minX = 1e9, maxX = -1;
  for (let k = 1; k <= 60 * 72; k++) {
    const t = k / 72, x = walkerX(frame(t, W, H));
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    if (x !== prevX) {
      moves++;
      assert.equal(Math.abs(x - prevX), 1, `a column at a time (${prevX} -> ${x} at ${t.toFixed(3)} s)`);
      const bt = Math.round(t / 0.3) * 0.3;
      assert.ok(Math.abs(t - bt) <= dt + 1e-9, `the walker moved at ${t.toFixed(3)} s, not on a 0.3 s step`);
      assert.ok(t - lastT >= 0.3 - dt - 1e-9);
      const d = Math.sign(x - prevX);
      if (dir && d !== dir) turns++;
      dir = d; lastT = t;
    }
    prevX = x;
  }
  assert.equal(moves, 200, 'a step every 0.3 s for 60 s');
  assert.equal(minX, win.x, 'to the left end of the window');
  assert.equal(maxX, win.x + win.w - 3, 'to the right end of the window');
  assert.ok(turns >= 8, `${turns} turns`);

  // --- steam: a glyph of ice 0 in the column above the mug, rising a cell every 0.5 s
  const steam = g.steam; // { x, rows: [h1, h2, h3] }
  const steamAt = (f) => steam.rows.map((y) => {
    const s = textAt(f, steam.x, y, 1);
    return (s === '°' || s === '·') && colAt(f, steam.x, y) === ICE[0] ? s : '';
  });
  let prevS = steamAt(frame(0, W, H)).join('|'), seen = new Set([prevS]), changes = 0;
  for (let k = 1; k <= 30 * 72; k++) {
    const t = k / 72, s = steamAt(frame(t, W, H)).join('|');
    if (s !== prevS) {
      changes++;
      const bt = Math.round(t / 0.5) * 0.5;
      assert.ok(Math.abs(t - bt) <= dt + 1e-9, `steam changed at ${t.toFixed(3)} s`);
    }
    seen.add(s);
    prevS = s;
  }
  assert.equal(changes, 60, 'a change every 0.5 s');
  assert.deepEqual([...seen].sort(), ['||', '||°', '|°|', '·||'].sort(), 'a puff rises one cell at a time and thins out at the top');
  const rising = [0, 0.5, 1, 1.5].map((t) => steamAt(frame(t + 0.01, W, H)).map((s) => (s ? 1 : 0)).join(''));
  assert.deepEqual(rising, ['100', '010', '001', '000']);

  // --- the game: ball and paddles inside the cabinet screen
  const fld = g.game; // { x, y, w: 6, h: 3 }
  assert.deepEqual([fld.w, fld.h], [6, 3]);
  const gameAt = (f) => {
    let ball = null, paddles = 0;
    for (let y = fld.y; y < fld.y + fld.h; y++) for (let x = fld.x; x < fld.x + fld.w; x++) {
      const ch = textAt(f, x, y, 1);
      if (ch === '●') { assert.equal(ball, null); ball = [x - fld.x, y - fld.y]; }
      else if (ch === '▌') paddles++;
      else assert.equal(ch, ' ');
    }
    assert.equal(paddles, 2, 'two paddles');
    return ball ? ball.join(',') : '';
  };
  let prevB = gameAt(frame(0, W, H)), gchanges = 0;
  for (let k = 1; k <= 30 * 72; k++) {
    const t = k / 72;
    const f = frame(t, W, H);
    const b = gameAt(f);
    const paddleSig = f.g.slice(fld.y * W, (fld.y + fld.h) * W).join();
    if (b !== prevB) {
      gchanges++;
      const bt = Math.round(t / 0.25) * 0.25;
      assert.ok(Math.abs(t - bt) <= dt + 1e-9, `the ball moved at ${t.toFixed(3)} s`);
      const [x0, y0] = prevB.split(',').map(Number), [x1, y1] = b.split(',').map(Number);
      assert.ok(Math.abs(x1 - x0) <= 1 && Math.abs(y1 - y0) <= 1, `${prevB} -> ${b}`);
      assert.ok(x1 >= 1 && x1 <= fld.w - 2, 'the ball is between the paddles');
    }
    assert.ok(paddleSig.length > 0);
    prevB = b;
  }
  assert.equal(gchanges, 120, 'a step every 0.25 s');

  // --- the customer: the door interior holds near-silhouette cells from 40 s to 46 s, from 80 s to 86 s and not otherwise
  const d = g.door;
  const inDoor = (f) => { let n = 0; for (let y = d.y + 1; y < d.y + d.h - 1; y++) for (let x = d.x + 1; x < d.x + d.w - 1; x++) if (colAt(f, x, y) === NEAR && at(f, x, y) !== 32) n++; return n; };
  for (const t of [0, 1, 20, 39.9, 46.2, 60, 79.9, 86.2, 100]) assert.equal(inDoor(frame(t, W, H)), 0, `nobody at the door at ${t} s`);
  for (const t of [41, 43, 45.5, 81, 85.5]) assert.ok(inDoor(frame(t, W, H)) >= 4, `a customer at the door at ${t} s`);
  assert.ok(inDoor(frame(40.1, W, H)) >= 1 && inDoor(frame(40.1, W, H)) < inDoor(frame(41, W, H)), 'they come out a piece at a time');
});

// ---- D7 the sign

const LETTERS = {
  L: ['┃     ', '┃     ', '┃     ', '┃     ', '┗━━━━━'],
  U: ['┃    ┃', '┃    ┃', '┃    ┃', '┃    ┃', '┗━━━━┛'],
  M: ['┃╲  ╱┃', '┃ ╲╱ ┃', '┃    ┃', '┃    ┃', '┃    ┃'],
  A: ['┏━━━━┓', '┃    ┃', '┣━━━━┫', '┃    ┃', '┃    ┃'],
  "'": ['┃'],
  S: ['┏━━━━━', '┃     ', '┗━━━━┓', '     ┃', '━━━━━┛'],
};

test('night-drive diner (D7): the sign spells L U M A \' S in tube letters 6 wide and 5 tall with 2-column gaps (the apostrophe one tube), in magenta 3, and DINER is under it in cyan 3', () => {
  const W = 120, H = 40, g = geometry(W, H);
  assert.equal(g.sign.gap, 2);
  assert.equal(g.sign.w, 41);
  const f = frame(0, W, H);
  // build the expected block from the letter specs and compare cell by cell
  let x = g.sign.x;
  const spelled = [];
  for (const ch of "LUMA'S") {
    const art = LETTERS[ch];
    const w = ch === "'" ? 1 : 6;
    for (let j = 0; j < 5; j++) {
      for (let i = 0; i < w; i++) {
        const want = art[j] ? art[j][i] || ' ' : ' ';
        assert.equal(textAt(f, x + i, g.sign.y + j, 1), want, `letter ${ch} cell ${i},${j}`);
        if (want !== ' ') assert.equal(colAt(f, x + i, g.sign.y + j), MAG[3], `${ch} ${i},${j} is magenta 3`);
        else assert.equal(colAt(f, x + i, g.sign.y + j), 0);
      }
    }
    // two blank columns after it (but the last)
    if (ch !== 'S') for (let j = 0; j < 5; j++) for (let i = 0; i < 2; i++) assert.equal(at(f, x + w + i, g.sign.y + j), 32, `gap after ${ch}`);
    spelled.push(ch);
    x += w + 2;
  }
  assert.equal(spelled.join(''), "LUMA'S");
  assert.equal(x - 2, g.sign.x + g.sign.w, 'the sign is 41 wide');
  // nothing else of the sign's ink around it
  for (let j = -1; j <= 5; j++) { assert.equal(at(f, g.sign.x - 1, g.sign.y + j), 32); assert.equal(at(f, g.sign.x + g.sign.w, g.sign.y + j), 32); }
  // the apostrophe is one tube on the top row only
  assert.equal(at(f, g.sign.apos, g.sign.y), cp('┃'));
  for (let j = 1; j < 5; j++) assert.equal(at(f, g.sign.apos, g.sign.y + j), 32);
  // DINER, spaced, in cyan 3, under the sign
  const dr = g.diner;
  assert.equal(textAt(f, dr.x, dr.y, dr.text.length), dr.text);
  assert.ok(dr.text.includes('D I N E R'));
  for (let i = 0; i < dr.text.length; i++) if (dr.text[i] !== ' ') assert.equal(colAt(f, dr.x + i, dr.y), CYAN[3]);
  assert.ok(dr.y > g.sign.y + 4 && dr.y < g.facade.y + 1, 'under the sign and above the roof');
});

// ---- D8 the compact layout

test('night-drive diner (D8): under 100x32 the sign is LUMA\'S only (no DINER), the arcade is just its marquee and there is no car; at 100x32 and up there are all three', () => {
  const full = frame(0, 100, 32), fg = geometry(100, 32);
  assert.ok(fg.car && fg.arcade && fg.diner);
  assert.ok(rowText(full, fg.diner.y).includes('D I N E R'));
  assert.equal(textAt(full, fg.car.x + 5, fg.car.y + 3, 3), S.WHEEL_PARKED);
  for (const [W, H] of [[80, 24], [99, 31], [100, 31], [99, 32], [90, 28], [120, 24], [72, 20]]) {
    const f = frame(0, W, H), g = geometry(W, H);
    assert.equal(g.layout, 'compact', `${W}x${H}`);
    assert.equal(g.car, null);
    assert.equal(g.arcade, null);
    assert.equal(g.diner, null);
    const all = Array.from({ length: H }, (_, y) => rowText(f, y)).join('\n');
    assert.ok(!all.includes('D I N E R'), `${W}x${H}: no DINER`);
    assert.ok(!all.includes('A R C A D E'), `${W}x${H}: no arcade body text`);
    assert.ok(all.includes('Q U A R T E R L I G H T'), `${W}x${H}: the marquee`);
    assert.ok(!all.includes('┼'), `${W}x${H}: no car`);
    assert.equal(cellsOf(f, '┌', CYAN[1]).length, 0, 'no cabinets');
    // the sign is still LUMA'S
    let x = g.sign.x;
    for (const ch of "LUMA'S") {
      const art = LETTERS[ch], w = ch === "'" ? 1 : 6;
      for (let j = 0; j < 5; j++) for (let i = 0; i < w; i++) assert.equal(textAt(f, x + i, g.sign.y + j, 1), art[j] ? art[j][i] || ' ' : ' ', `${W}x${H} ${ch}`);
      x += w + g.sign.gap;
    }
    assert.ok(all.includes('OPEN') && all.includes('LATE') && all.includes('PIE · COFFEE · 24 HRS'), `${W}x${H}: the door and the pie line`);
    assert.ok(g.ring.length >= 60 && g.ring.length % 4 === 0);
  }
  // the facade, the awning and the door in the compact picture
  const c = frame(0, 80, 24), cg = geometry(80, 24);
  assert.ok(cellsOf(c, '▛', CORAL[2]).length >= 8, 'the awning');
  assert.ok(cg.kerbY === 24 - 2 && /^─+$/.test(rowText(c, cg.kerbY)), 'the kerb');
});

// ---- D9 key frames

test('night-drive diner (D9): key frame 1 (t = 0, 120x40) has the sign tubes, OPEN LATE in mint 3, the pie line, the awning in coral 2, the arcade marquee and cabinets, the kerb on row 33 and the car; key frame 3 shows the dip at its bottom', () => {
  const W = 120, H = 40, g = geometry(W, H), f = frame(0, W, H);
  const all = Array.from({ length: H }, (_, y) => rowText(f, y)).join('\n');
  for (const ch of '┃━┏┓┗┛┣┫') assert.ok(all.includes(ch), `the sign has ${ch}`);
  for (const w of ['OPEN', 'LATE']) { const [c] = cellsOf(f, w[0], MINT[3]); assert.ok(c, w); }
  assert.ok(g.door.openAt && textAt(f, g.door.openAt.x, g.door.openAt.y, 4) === 'OPEN' && textAt(f, g.door.lateAt.x, g.door.lateAt.y, 4) === 'LATE');
  for (let i = 0; i < 4; i++) { assert.equal(colAt(f, g.door.openAt.x + i, g.door.openAt.y), MINT[3]); assert.equal(colAt(f, g.door.lateAt.x + i, g.door.lateAt.y), MINT[3]); }
  assert.equal(textAt(f, g.pie.x, g.pie.y, 21), 'PIE · COFFEE · 24 HRS');
  assert.equal(colAt(f, g.pie.x, g.pie.y), TEXT);
  assert.ok(all.includes('Q U A R T E R L I G H T') && all.includes('A R C A D E'));
  assert.ok(cellsOf(f, '▛', CORAL[2]).length >= 15 && cellsOf(f, '▜', CORAL[2]).length >= 15, 'scalloped awning');
  assert.ok(cellsOf(f, '●', SUN[3]).length >= 15 && cellsOf(f, '○', SUN[0]).length >= 15, 'chase bulbs');
  assert.equal(g.kerbY, 33);
  assert.ok(/^─+$/.test(rowText(f, 33)), 'the kerb on row 33');
  assert.equal(g.cabinets.length, 2);
  for (const cab of g.cabinets) { assert.equal(textAt(f, cab.x, cab.y, 1), '┌'); assert.equal(colAt(f, cab.x, cab.y), CYAN[1]); }
  assert.equal(textAt(f, g.car.x + 5, g.car.y + 3, 3), S.WHEEL_PARKED);
  // body violet 0 and rim magenta 1
  assert.ok(cellsOf(f, "█", VIOLET[0]).length >= 20, 'the body is violet 0');
  assert.ok(cellsOf(f, '▄', MAG[1]).length >= 8, 'the rim is magenta 1');
  // key frame 3: the first dip, at its bottom
  const d = dipStart(0, 1);
  const bottom = frame(d + 0.2, W, H);
  for (const c of g.flicker) assert.equal(colAt(bottom, c.x, c.y), MAG[1]);
  const before = frame(d - 0.05, W, H);
  for (const c of g.flicker) assert.equal(colAt(before, c.x, c.y), MAG[3]);
});

// ---- D10 calm and safety

const SIZES = [[120, 40], [80, 24], [100, 32]];

test('night-drive diner (D10): 90 s at 1x and 4x at 120x40, 80x24 and 100x32: under 5% of the cells change a frame (never 30%), no kept glyph breaks the ramp rule, the background is never drawn, allowed glyphs only, none banned, colours inside the palette', () => {
  const rows = [];
  for (const [w, h] of SIZES) {
    for (const speed of [1, 4]) {
      const r = calmRun(frame, w, h, speed);
      rows.push(`${w}x${h} ${speed}x worst ${(r.worst * 100).toFixed(2)}% at ${r.at.toFixed(2)} s`);
      assert.ok(r.worst < 0.3, `${w}x${h} ${speed}x: ${r.worst}`);
      assert.ok(r.worst < 0.05, `${w}x${h} ${speed}x: worst ${(r.worst * 100).toFixed(2)}% at ${r.at.toFixed(2)} s`);
      assert.ok(r.worst > 0.001, 'it moves');
      assert.equal(r.ramp, 0, `${w}x${h} ${speed}x: ${JSON.stringify(r.firstRamp)}`);
      assert.equal(r.blankBad, 0, 'a blank cell is colour 0 (the one background)');
      assert.equal(r.glyphBad, 0, 'allowed glyphs only');
      assert.equal(r.banned, 0, 'none of the banned set');
      assert.equal(r.colourBad, 0, `colours are the fixed families, below ${COUNT}`);
      assert.ok(r.litMin > w * h * 0.1, `${w}x${h}: never nearly blank (${r.litMin} cells lit)`);
    }
  }
  console.log('# diner: ' + rows.join(' | '));
  // controls: everything redrawn is over the share bound; the dip jumping 3 -> 1 in one frame breaks the ramp rule
  const a = frame(0), b = { g: a.g.map(() => cp('█')), c: a.c.map(() => ICE[3]), w: 120, h: 40 };
  assert.ok(changedShare(a, b) > 0.9);
  const hi = { g: a.g.map(() => cp('┃')), c: a.c.map(() => MAG[3]), w: 120, h: 40 };
  const lo = { g: hi.g, c: hi.c.map(() => MAG[1]), w: 120, h: 40 };
  assert.equal(rampViolations(hi, lo).length, 120 * 40);
});

test('night-drive diner (D10): other seeds, the sizes around the breakpoints and a spread of windows, 24 s at 4x and 1x: the ramp rule, the 30% rule, the 5% rule and the glyph rules hold', () => {
  for (const seed of [2, 3, 5]) {
    for (const speed of [1, 4]) {
      const r = calmRun((t, w, h) => frame(t, w, h, seed), 80, 24, speed, 40);
      assert.equal(r.ramp, 0, `seed ${seed} ${speed}x: ${JSON.stringify(r.firstRamp)}`);
      assert.ok(r.worst < 0.05, `seed ${seed} ${speed}x: ${r.worst}`);
    }
  }
  for (const [w, h] of [[99, 31], [100, 31], [99, 32], [101, 33], [60, 20], [40, 18], [41, 19], [160, 48], [240, 67], [200, 30]]) {
    const r = calmRun(frame, w, h, 4, 24);
    assert.equal(r.ramp, 0, `${w}x${h}: ${JSON.stringify(r.firstRamp)}`);
    assert.ok(r.worst < 0.3, `${w}x${h}: ${r.worst}`);
    assert.equal(r.blankBad + r.glyphBad + r.banned + r.colourBad, 0, `${w}x${h}`);
  }
});

// ---- D11 sizes

test('night-drive diner (D11): 0x0, 1x1, 41x11, 99x31, 100x32, 240x67 and 400x120 do not throw; blank cells are glyph 32 in colour 0; small windows draw nothing', () => {
  const sizes = [[0, 0], [1, 1], [3, 3], [41, 11], [99, 31], [100, 32], [240, 67], [400, 120], [2, 200], [200, 2], [40, 18], [39, 40], [120, 17]];
  for (const [w, h] of sizes) {
    for (const t of [0, 7.7, 12, 38.5, 41, 1e6]) {
      let f;
      assert.doesNotThrow(() => { f = frame(t, w, h); }, `${w}x${h} t=${t}`);
      for (let i = 0; i < f.g.length; i++) if (f.g[i] === 32) assert.equal(f.c[i], 0);
    }
  }
  const lit = (w, h) => frame(5, w, h).g.reduce((n, v) => n + (v === 32 ? 0 : 1), 0);
  assert.equal(lit(41, 11), 0);
  assert.equal(lit(0, 0), 0);
  assert.equal(lit(39, 40), 0);
  assert.equal(lit(120, 17), 0);
  assert.ok(lit(40, 18) > 100 && lit(99, 31) > 300 && lit(100, 32) > 500 && lit(400, 120) > 2000);
});

// ---- D12 scale

test('night-drive diner (D12): a 240x67 frame costs under 20 ms on average over 200 frames; a scan of the whole picture a few thousand times would not', () => {
  const g = new Uint16Array(240 * 67), c = new Uint8Array(240 * 67);
  const ms = meanMs((t) => diner(t, 240, 67, { seed: 1, glyphs: g, colours: c }), 200);
  console.log(`# diner 240x67: ${ms.toFixed(3)} ms a frame`);
  assert.ok(ms < 20, `${ms} ms`);
  const slow = (t, w, h, p) => { for (let k = 0; k < 6000; k++) for (let i = 0; i < p.glyphs.length; i++) p.glyphs[i] = (k + i) & 0xff; };
  const slowMs = meanMs((t) => slow(t, 240, 67, { glyphs: g, colours: c }), 5);
  assert.ok(slowMs > 20, `the control costs ${slowMs} ms and fails the bound`);
});
