// DRIFT-5: scene B3, Late Caller (the cut scene, as a cells scene). The brief's promises, read off rendered frames:
//   - nine cards of an original late-night radio call (88.1 Moonlow FM, Rae Vesper, Danny from Exit 4), 511 characters typed at 30 a second,
//     the first at 1.5 s, each held 6 s after its last character, then replaced; the last one holds to 75 s
//   - a down arrow on a finished card that another follows, fading shade 1 to 3 in single steps over 1.5 s; none on the last card
//   - the letterbox, the road behind, the dashboard radio with a tuning bar, a streetlight band, and Ingrid's cassette deck: two reels that
//     step every 0.25 s and VU bars from sun to coral
//   - calm, and the whole tape (705 s without its fades) in the shell's scheduler
import test from 'node:test';
import assert from 'node:assert/strict';
import caller, { LAYOUTS, layoutFor, geometry, CARDS, TOTAL_CHARS, cardTimes, wrapCard, CPS, FIRST_START, HOLD, SCENE_SECONDS, REEL_STEP, VU_STEP, BAND_STEP, BAND_PERIOD, ARROW_CYCLE, ERASE_SECONDS } from '../cartridges/night-drive/scenes/caller.js';
import { renderScene } from '../src/cells.js';
import { Scheduler } from '../src/compose.js';
import { WHEEL_FRAMES } from '../cartridges/night-drive/lib/sprites.js';
import { geometry as roadGeometry, dashRow, laneX } from '../cartridges/night-drive/lib/road.js';
import { SUN, TANG, CORAL, MAG, CYAN, MINT, FAR, NEAR, TEXT, DIM, COUNT } from '../cartridges/night-drive/lib/palette.js';
import { FPS, MANIFEST, framer, rowText, rampViolations, changedShare, calmRun, walk, meanMs, cp, familyOf } from './helpers-night-drive.js';
import { mkShell } from './helpers-shell.js';
import { INSTALL_DIR } from '../src/cartridge/loader.js';

const frame = framer(caller);
const at = (f, x, y) => f.g[y * f.w + x];
const colAt = (f, x, y) => f.c[y * f.w + x];
const textAt = (f, x, y, n) => rowText(f, y).slice(x, x + n);

// ---- the script, pinned here (the design's "The script"): 9 cards, 511 characters not counting the speakers' names
const SCRIPT = [
  ['narrator', "88.1 MOONLOW FM. It's 2:14, and you're still out there."],
  ['rae', "This is Rae Vesper. Lines are open, the coffee's cold, and the coast road is all yours."],
  ['rae', "Caller, you're on the air."],
  ['caller', "Hi Rae. It's Danny, out by Exit 4. I've been driving since sundown. I don't want to stop."],
  ['rae', "Then don't. The night will wait for you."],
  ['caller', 'Is it strange that this feels more like home than home?'],
  ['rae', 'Not on this station, Danny. Not at this hour.'],
  ['rae', "Here's one for everyone with the windows down. Side B. Keep your lights on."],
  ['narrator', 'The tape clicks over. The road goes on.'],
];
const NAMES = { narrator: '', rae: 'RAE', caller: 'CALLER' };
// the timeline from the brief's numbers alone: a card begins, types at 30 a second, holds 6 s after its last character, the next begins
const STARTS = [], ENDS = [];
{
  let s = 1.5;
  for (const [, text] of SCRIPT) { STARTS.push(s); ENDS.push(s + [...text].length / 30); s = ENDS[ENDS.length - 1] + 6; }
}
const N_OF = (k) => [...SCRIPT[k][1]].length;
const typedAt = (k, T) => Math.max(0, Math.min(N_OF(k), Math.floor((T - STARTS[k]) * 30 + 1e-9)));

// What the text area of the box shows: its lines joined with single spaces (a wrap point is a space), and the name row
const regionLines = (f, g) => Array.from({ length: g.box.lines }, (_, j) => textAt(f, g.box.tx, g.box.ty + j, g.box.tw).trimEnd());
const shown = (f, g) => regionLines(f, g).filter(Boolean).join(' ');
const nameShown = (f, g) => textAt(f, g.box.nameX, g.box.nameY, 8).trim();
const arrowShade = (f, g) => (textAt(f, g.box.arrowX, g.box.arrowY, 1) === '▼' ? MAG.indexOf(colAt(f, g.box.arrowX, g.box.arrowY)) : -1);
const BIG = geometry(120, 40);

// ---- L1 the contract and the manifest

test('night-drive caller (L1): a cells scene called caller, LAYOUTS widest first from 100x32, the manifest puts it between Luma\'s and Overdrive with a 75 s entry on the tape (705 s without the fades)', () => {
  assert.equal(caller.id, 'caller');
  assert.equal(caller.kind, 'cells');
  assert.ok(Array.isArray(LAYOUTS) && LAYOUTS.length >= 2);
  assert.deepEqual([LAYOUTS[0].minCols, LAYOUTS[0].minRows], [100, 32]);
  assert.deepEqual([LAYOUTS[LAYOUTS.length - 1].minCols, LAYOUTS[LAYOUTS.length - 1].minRows], [0, 0]);
  assert.equal(layoutFor(100, 32).name, LAYOUTS[0].name);
  assert.notEqual(layoutFor(99, 32).name, LAYOUTS[0].name);
  assert.notEqual(layoutFor(100, 31).name, LAYOUTS[0].name);
  const ids = MANIFEST.scenes.map((s) => s.id);
  assert.ok(ids.indexOf('diner') < ids.indexOf('caller') && ids.indexOf('caller') < ids.indexOf('overdrive'), 'tape order: B2 diner, B3 caller, B4 overdrive');
  const sc = MANIFEST.scenes.find((s) => s.id === 'caller');
  assert.deepEqual([sc.kind, sc.title], ['cells', 'Late Caller']);
  const tape = MANIFEST.programs[0];
  assert.deepEqual(tape.scenes, ids);
  assert.equal(tape.sceneSeconds, 90);
  assert.deepEqual(tape.seconds, { caller: 75 });
  assert.equal(SCENE_SECONDS, 75);
  const total = ids.reduce((n, id) => n + (tape.seconds[id] ?? tape.sceneSeconds), 0);
  assert.equal(total, 705, 'the tape is 11:45 (seven tracks of 90 s and the 75 s call)');
  assert.equal(`${Math.floor(total / 60)}:${total % 60}`, '11:45');
  const entry = MANIFEST.menu.find((e) => e.scene === 'caller');
  assert.ok(entry);
  assert.deepEqual([entry.label, entry.program, entry.note], ['B3  LATE CALLER', 'tape', '1:15']);
  assert.ok(entry.desc && [...entry.desc].length <= 76);
  const labels = MANIFEST.menu.map((e) => e.label);
  assert.ok(labels.indexOf("B2  LUMA'S, OPEN LATE") < labels.indexOf(entry.label) && labels.indexOf(entry.label) < labels.indexOf('B4  OVERDRIVE'));
});

// ---- L2 the script

test('night-drive caller (L2): nine cards, 511 characters (speakers\' names not counted), the original text pinned, speakers Rae, Danny and the narrator', () => {
  assert.equal(CARDS.length, 9);
  assert.deepEqual(CARDS.map((c) => c.text), SCRIPT.map((c) => c[1]));
  assert.deepEqual(CARDS.map((c) => c.who), SCRIPT.map((c) => c[0]));
  assert.deepEqual(CARDS.map((c) => c.name || ''), SCRIPT.map((c) => NAMES[c[0]]));
  const chars = SCRIPT.reduce((n, c) => n + [...c[1]].length, 0);
  assert.equal(chars, 511);
  assert.equal(TOTAL_CHARS, 511);
  const all = SCRIPT.map((c) => c[1]).join(' ');
  for (const w of ['Moonlow'.toUpperCase(), 'Rae Vesper', 'Danny', 'Exit 4', '88.1']) assert.ok(all.includes(w), w);
  assert.deepEqual([...new Set(SCRIPT.map((c) => c[0]))].sort(), ['caller', 'narrator', 'rae']);
  assert.deepEqual([CPS, FIRST_START, HOLD], [30, 1.5, 6]);
  // the timing the numbers give: the last card is typed by 66.533 s, the Danny card by 28.067 s
  const ct = cardTimes();
  assert.equal(ct.length, 9);
  ct.forEach((c, k) => { assert.ok(Math.abs(c.start - STARTS[k]) < 1e-9, `card ${k + 1} starts ${c.start}`); assert.ok(Math.abs(c.end - ENDS[k]) < 1e-9, `card ${k + 1} ends ${c.end}`); });
  assert.ok(ENDS[8] <= 66.6 && ENDS[8] > 66.5, `${ENDS[8]}`);
  assert.ok(ENDS[3] < 29 && STARTS[4] > 29, 'at 29 s the Danny card is finished and still up');
  assert.ok(STARTS[8] < 70 && 70 < 75, 'the narrator card is up at 70 s');
});

// ---- L3 card timing, read from the glyphs on screen

test('night-drive caller (L3): nothing is typed before 1.5 s; 30 characters a second (30 at 2.5 s); each card holds 6 s after its last character and is then replaced; the script is complete by 66.6 s', () => {
  const g = BIG;
  for (const t of [0, 0.7, 1.4, 1.49]) { const f = frame(t); assert.equal(shown(f, g), '', `t=${t}`); assert.equal(nameShown(f, g), ''); assert.equal(arrowShade(f, g), -1); }
  assert.equal(shown(frame(1.5 + 1 / 30 + 0.002), g), SCRIPT[0][1].slice(0, 1), 'the first character at 1.5 s + 1/30');
  assert.equal(shown(frame(2.5), g), SCRIPT[0][1].slice(0, 30), '30 characters at 2.5 s');
  assert.equal(shown(frame(2.5), g).length, 30);
  for (let k = 0; k < 9; k++) {
    const text = SCRIPT[k][1];
    const nextAt = k < 8 ? STARTS[k + 1] : 75;
    // typing: at several offsets the screen holds exactly the first N characters of the card
    for (const dt of [0.9, 1.2, 1.7, 2.3, N_OF(k) / 30 - 0.02]) {
      const t = STARTS[k] + dt;
      if (t >= nextAt || dt < ERASE_SECONDS + 0.05) continue;
      const n = typedAt(k, t);
      assert.equal(shown(frame(t), g), text.slice(0, n).trimEnd(), `card ${k + 1} at ${t.toFixed(3)} s (${n} typed)`);
    }
    // complete once its last character is typed, and held for 6 s, then replaced
    assert.equal(shown(frame(ENDS[k] + 0.03), g), text, `card ${k + 1} complete`);
    if (k < 8) {
      assert.equal(shown(frame(ENDS[k] + 5.9), g), text, `card ${k + 1} still up 5.9 s on`);
      assert.equal(shown(frame(nextAt - 0.02), g), text, 'and a moment before the next begins');
      assert.equal(shown(frame(nextAt + 0.9), g), SCRIPT[k + 1][1].slice(0, typedAt(k + 1, nextAt + 0.9)).trimEnd(), `card ${k + 2} has replaced it`);
      assert.ok(Math.abs(nextAt - (ENDS[k] + 6)) < 1e-9, 'the next card begins 6 s after the last character');
    }
  }
  assert.notEqual(shown(frame(66.4), g), SCRIPT[8][1], 'not complete at 66.4 s');
  assert.equal(shown(frame(66.6), g), SCRIPT[8][1], 'complete by 66.6 s');
  for (const t of [70, 74.9, 75, 80, 200]) assert.equal(shown(frame(t), g), SCRIPT[8][1], `the last card holds at ${t} s`);
  // control: typing at 30 a second is not 20 a second
  assert.notEqual(shown(frame(2.5), g).length, 20);
});

// ---- L4 the down arrow

test('night-drive caller (L4): the arrow is on a finished card that another follows (cards 1 to 8), absent while typing and before the first, absent on the last card; it fades shade 1-2-3-2 over 1.5 s in single steps', () => {
  assert.equal(ARROW_CYCLE, 1.5);
  const g = BIG;
  for (let k = 0; k < 8; k++) {
    for (const t of [ENDS[k] + 0.03, ENDS[k] + 2, ENDS[k] + 5.5, STARTS[k + 1] - 0.02]) assert.ok(arrowShade(frame(t), g) >= 1, `card ${k + 1}: an arrow at ${t.toFixed(2)} s`);
    for (const t of [STARTS[k] + 0.9, (STARTS[k] + ENDS[k]) / 2 + 0.3]) if (t < ENDS[k] - 0.05 && t > STARTS[k] + 0.9 - 1e-9) assert.equal(arrowShade(frame(t), g), -1, `card ${k + 1}: no arrow while typing at ${t.toFixed(2)} s`);
  }
  for (const t of [0, 1, 1.6, 2.5, 3, 66.6, 70, 74.9, 75, 80]) assert.equal(arrowShade(frame(t), g), -1, `no arrow at ${t} s`);
  // the cycle: one card's finished time, sampled at 72 fps over 5.5 s
  const k = 3;
  const shades = [];
  for (let i = 0; i <= 5.5 * 72; i++) { const t = ENDS[k] + 0.02 + i / 72; shades.push({ t, s: arrowShade(frame(t), g) }); }
  for (const x of shades) assert.ok(x.s >= 1 && x.s <= 3, `shade ${x.s}`);
  for (let i = 1; i < shades.length; i++) assert.ok(Math.abs(shades[i].s - shades[i - 1].s) <= 1, `a single step at ${shades[i].t.toFixed(3)} s`);
  assert.deepEqual([...new Set(shades.map((x) => x.s))].sort(), [1, 2, 3]);
  // periodic with 1.5 s
  for (let i = 0; i < 72; i++) assert.equal(shades[i].s, shades[i + 108].s, `period 1.5 s at ${i}`);
  // each level lasts 0.375 s: no two steps closer than that (so a 4x frame never spans two)
  const changes = [];
  for (let i = 1; i < shades.length; i++) if (shades[i].s !== shades[i - 1].s) changes.push(shades[i].t);
  for (let i = 1; i < changes.length; i++) assert.ok(changes[i] - changes[i - 1] >= 0.375 - 1 / 72 - 1e-9, `steps ${changes[i] - changes[i - 1]} apart`);
  // control: a jump of two shades is what the check would catch
  assert.throws(() => assert.ok(Math.abs(3 - 1) <= 1));
});

// ---- L5 key frames

test('night-drive caller (L5): key frame 1 (t = 29 s, 120x40) is Danny\'s card, typed, in text colour under CALLER in cyan 3, with the arrow; key frame 2 (t = 70 s) is the narrator card in dim, no name, no arrow', () => {
  const g = BIG;
  const f1 = frame(29);
  assert.equal(shown(f1, g), SCRIPT[3][1]);
  assert.equal(nameShown(f1, g), 'CALLER');
  for (let i = 0; i < 6; i++) assert.equal(colAt(f1, g.box.nameX + i, g.box.nameY), CYAN[3]);
  assert.ok(arrowShade(f1, g) >= 1, 'the arrow');
  let n = 0;
  for (let j = 0; j < g.box.lines; j++) for (let i = 0; i < g.box.tw; i++) if (at(f1, g.box.tx + i, g.box.ty + j) !== 32) { n++; assert.equal(colAt(f1, g.box.tx + i, g.box.ty + j), TEXT); }
  assert.equal(n, SCRIPT[3][1].replace(/ /g, '').length);
  const f2 = frame(70);
  assert.equal(shown(f2, g), SCRIPT[8][1]);
  assert.equal(nameShown(f2, g), '');
  assert.equal(arrowShade(f2, g), -1);
  n = 0;
  for (let j = 0; j < g.box.lines; j++) for (let i = 0; i < g.box.tw; i++) if (at(f2, g.box.tx + i, g.box.ty + j) !== 32) { n++; assert.equal(colAt(f2, g.box.tx + i, g.box.ty + j), DIM); }
  assert.ok(n > 20);
  // the other speakers
  assert.equal(nameShown(frame(STARTS[1] + 1), g), 'RAE');
  assert.equal(nameShown(frame(STARTS[0] + 1), g), '', 'the station ident is the narrator');
  // the radio, the heavy box and the rules
  const rows = Array.from({ length: 40 }, (_, y) => rowText(f1, y));
  assert.ok(rows.some((r) => r.includes('88.1 MOONLOW FM')));
  const rc = cp('8');
  assert.equal(colAt(f1, g.radio.x + 12, g.radio.y + 1), MINT[3], 'the station name is mint 3');
  assert.ok(at(f1, g.radio.x + 12, g.radio.y + 1) === rc);
  assert.equal(textAt(f1, g.box.x, g.box.y, 1), '┏');
  assert.equal(textAt(f1, g.box.x + g.box.w - 1, g.box.y + g.box.h - 1, 1), '┛');
  assert.equal(colAt(f1, g.box.x, g.box.y), MAG[3]);
  assert.ok(rows[g.box.y].includes('┏' + '━'.repeat(g.box.w - 2) + '┓'));
  assert.ok(rows[g.box.y + 3].startsWith(' '.repeat(g.box.x) + '┃'));
});

// ---- L6 the cassette deck

const deckCells = (g) => {
  const d = g.deck, out = [];
  for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) out.push(y * 1000 + x);
  return out;
};

test('night-drive caller (L6): the two reels step through the spinner every 0.25 s exactly and never faster; the VU bars rise and fall from sun to coral, each cell in one colour family and changing at most one shade step a frame, at 18 fps and at 4x', () => {
  assert.equal(REEL_STEP, 0.25);
  const g = BIG;
  assert.ok(g.deck, 'a deck at 120x40');
  assert.ok(g.deck.x >= g.radio.x && g.deck.x + g.deck.w <= g.radio.x + g.radio.w, 'inside the radio\'s footprint');
  assert.ok(g.deck.y >= g.box.y + g.box.h, 'out of the dialogue box');
  // reels
  const reelAt = (f, r) => textAt(f, r.x + 1, r.y + 1, 3);
  const dt = 1 / 72;
  let prev = g.deck.reels.map((r) => reelAt(frame(0), r)), steps = 0;
  assert.ok(prev.every((s) => WHEEL_FRAMES.includes(s)));
  let last = 0;
  for (let k = 1; k <= 40 * 72; k++) {
    const t = k / 72;
    const f = frame(t);
    const cur = g.deck.reels.map((r) => reelAt(f, r));
    assert.ok(cur.every((s) => WHEEL_FRAMES.includes(s)), `${cur} at ${t}`);
    if (cur.join() !== prev.join()) {
      steps++;
      assert.ok(Math.abs(t - Math.round(t / 0.25) * 0.25) <= dt + 1e-9, `a reel stepped at ${t.toFixed(3)} s`);
      assert.ok(t - last >= 0.25 - dt - 1e-9, 'never faster than 0.25 s');
      cur.forEach((s, i) => assert.equal(WHEEL_FRAMES.indexOf(s), (WHEEL_FRAMES.indexOf(prev[i]) + 1) % 4, 'the next frame of the spinner'));
      last = t;
    }
    prev = cur;
  }
  assert.equal(steps, 160, 'a step every 0.25 s for 40 s');
  // reel frames: the boxes around the spinners are still
  const f0 = frame(0), f1 = frame(0.9);
  for (const r of g.deck.reels) for (const [x, y] of [[0, 0], [4, 0], [0, 2], [4, 2], [0, 1], [4, 1]]) assert.equal(at(f0, r.x + x, r.y + y), at(f1, r.x + x, r.y + y));

  // VU bars: inside the deck, between the reels
  const vu = g.deck.vu;
  assert.ok(vu.bars >= 8 && vu.h === 3);
  const cellsOfVu = [];
  for (let b = 0; b < vu.bars; b++) for (let r = 0; r < 3; r++) cellsOfVu.push([vu.x + 2 * b, vu.y + r]);
  const VU_COLOURS = new Set([SUN[3], TANG[3], CORAL[3]]);
  const heights = [];
  const colourOf = new Map();
  let changes = 0, prevF = frame(0);
  const walkVu = (speed, seconds) => {
    let pf = frame(0);
    for (let k = 1; k <= Math.ceil((seconds * FPS) / speed); k++) {
      const t = (k * speed) / FPS, f = frame(t);
      for (const [x, y] of cellsOfVu) {
        const a = at(pf, x, y), b = at(f, x, y), ca = colAt(pf, x, y), cb = colAt(f, x, y);
        if (a !== b) { changes++; assert.ok(Math.abs(t - Math.round(t / 0.25) * 0.25) <= speed / FPS + 1e-9, `a bar changed at ${t.toFixed(3)} s, not on a 0.25 s step`); }
        if (a !== 32 && b !== 32 && a === b && ca !== cb) {
          const fa = familyOf(ca), fb = familyOf(cb);
          assert.ok(fa && fb && fa[0] === fb[0] && Math.abs(fa[1].indexOf(ca) - fb[1].indexOf(cb)) <= 1, `${speed}x: ${ca} -> ${cb}`);
        }
      }
      pf = f;
    }
  };
  walkVu(1, 40);
  walkVu(4, 40);
  assert.ok(changes > 200, `${changes} cell changes in the bars`);
  for (let k = 0; k <= 40 * 18; k++) {
    const f = frame(k / 18);
    const hs = [];
    for (let b = 0; b < vu.bars; b++) {
      let h = 0;
      for (let r = 0; r < 3; r++) {
        const x = vu.x + 2 * b, y = vu.y + 2 - r, gl = at(f, x, y), c = colAt(f, x, y);
        if (gl === 32) { assert.equal(c, 0); continue; }
        assert.ok('▁▂▃▄▅▆▇█'.includes(String.fromCharCode(gl)), `bar glyph U+${gl.toString(16)}`);
        assert.ok(VU_COLOURS.has(c), `bar colour ${c} (sun, tang or coral only)`);
        assert.equal(c, [SUN[3], TANG[3], CORAL[3]][r], 'sun at the foot, coral at the top');
        const key = `${b}:${r}`;
        if (colourOf.has(key)) assert.equal(colourOf.get(key), c, 'a cell stays in one colour'); else colourOf.set(key, c);
        h += gl === 0x2588 ? 8 : gl - 0x2580;
      }
      hs.push(h);
    }
    heights.push(...hs);
  }
  assert.ok(Math.max(...heights) >= 18 && Math.min(...heights) <= 6, `the bars rise (${Math.max(...heights)}) and fall (${Math.min(...heights)})`);
  // the gaps between bars and the margins hold nothing
  for (let k = 0; k < 40; k++) {
    const f = frame(k * 0.7);
    for (let b = 0; b < vu.bars - 1; b++) for (let r = 0; r < 3; r++) assert.equal(at(f, vu.x + 2 * b + 1, vu.y + r), 32);
  }
  // control: a cell that jumps from the sun colour to coral under one glyph breaks the ramp rule
  const a = frame(1), b = { g: a.g.slice(), c: a.c.slice(), w: a.w, h: a.h };
  const i = (vu.y + 2) * a.w + vu.x;
  a.g[i] = cp('█'); a.c[i] = SUN[3]; b.g[i] = cp('█'); b.c[i] = CORAL[3];
  assert.equal(rampViolations(a, b).length, 1, 'sun to coral in one frame is caught');
  assert.equal(prevF.w, 120);
});

// ---- L7 typing never reflows

test('night-drive caller (L7): a character that has appeared never moves or changes until its card is replaced (the card is wrapped whole first); a word is never split', () => {
  for (const [W, H] of [[120, 40], [80, 24]]) {
    const g = geometry(W, H);
    for (let k = 0; k < 9; k++) {
      const seen = new Map();
      const begin = STARTS[k] + ERASE_SECONDS + 0.02;
      const stop = (k < 8 ? STARTS[k + 1] : 75) - 0.02;
      let frames = 0;
      for (let t = begin; t < stop; t += 1 / 18) {
        const f = frame(t, W, H);
        for (let j = 0; j < g.box.lines; j++) for (let i = 0; i < g.box.tw; i++) {
          const x = g.box.tx + i, y = g.box.ty + j, v = at(f, x, y), key = y * 1000 + x;
          if (seen.has(key)) assert.equal(v, seen.get(key), `${W}x${H} card ${k + 1}: cell ${i},${j} changed at ${t.toFixed(3)} s`);
          else if (v !== 32) seen.set(key, v);
        }
        frames++;
      }
      assert.ok(frames > 100);
      // the lines the card was wrapped to, whole words only
      const lines = wrapCard(SCRIPT[k][1], g.box.tw);
      assert.equal(lines.join(' '), SCRIPT[k][1], 'no word split, nothing lost');
      assert.ok(lines.every((l) => [...l].length <= g.box.tw));
      assert.ok(lines.length <= g.box.lines);
    }
  }
  // the positions in a half-typed card are the positions they will have in the finished one
  const g = BIG;
  const half = frame(STARTS[3] + 1.5), done = frame(ENDS[3] + 1);
  for (let j = 0; j < g.box.lines; j++) for (let i = 0; i < g.box.tw; i++) {
    const v = at(half, g.box.tx + i, g.box.ty + j);
    if (v !== 32) assert.equal(at(done, g.box.tx + i, g.box.ty + j), v);
  }
});

// ---- L8 layout

const rectsOf = (g) => ({ box: g.box, radio: g.radio, deck: g.deck });
const overlap = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('night-drive caller (L8): 120x40 has the letterbox rules at rows 5 and 34 and the box at rows 12-22; 80x24 has a 70-wide box and a 2-row radio; every card fits the box at 80x24, 79x25, 100x32 and 120x40 with no overflow and no split word', () => {
  const g = BIG;
  const f = frame(10);
  assert.deepEqual([g.topRule, g.botRule], [5, 34]);
  assert.equal(rowText(f, 5), '━'.repeat(120));
  assert.equal(rowText(f, 34), '━'.repeat(120));
  for (let x = 0; x < 120; x++) { assert.equal(colAt(f, x, 5), MAG[0]); assert.equal(colAt(f, x, 34), MAG[0]); }
  for (const y of [0, 1, 2, 3, 4, 35, 36, 37, 38, 39]) assert.equal(rowText(f, y).trim(), '', `row ${y} is the letterbox`);
  assert.deepEqual([g.box.y, g.box.y + g.box.h - 1], [12, 22]);
  assert.equal(g.box.w, 80);
  assert.equal(g.radio.h, 4);
  // dashes: lane lines in sun 0 coming toward us, where nothing covers them (rows 23 to 26)
  const rg = roadGeometry(120, 40);
  const seen = new Set();
  for (let k = 0; k < 40; k++) {
    const T = k * 0.37, fr = frame(T);
    for (let line = 1; line <= 2; line++) for (let i = 0; i < 3; i++) {
      const r = dashRow(rg, T, i), x = laneX(rg, r, line);
      if (r > g.box.y + g.box.h - 1 && r < g.radio.y) { assert.equal(textAt(fr, x, r, 1), '┃', `a dash at ${x},${r}`); assert.equal(colAt(fr, x, r), SUN[0]); seen.add(r); }
    }
  }
  assert.ok(seen.size >= 3, `dashes seen on ${seen.size} rows`);

  const s = geometry(80, 24);
  assert.equal(s.box.w, 70);
  assert.equal(s.radio.h, 2);
  assert.equal(s.layout, 'compact');
  assert.deepEqual([s.topRule, s.botRule], [3, 20]);
  assert.ok(s.deck, 'the deck fits at 80x24 under a 2-row radio');
  // every card fits, at every size
  for (const [W, H] of [[80, 24], [79, 25], [100, 32], [120, 40], [41, 18], [60, 20], [240, 67]]) {
    const gg = geometry(W, H);
    assert.equal(gg.ok, true);
    const R = rectsOf(gg);
    assert.ok(!overlap(R.box, R.radio) && !overlap(R.box, R.deck) && !overlap(R.radio, R.deck), `${W}x${H}: box, radio and deck are apart`);
    assert.ok(R.box.x >= 0 && R.box.x + R.box.w <= W && R.box.y >= gg.topRule && R.box.y + R.box.h - 1 <= gg.botRule, `${W}x${H}: the box is inside the letterbox`);
    for (let k = 0; k < 9; k++) {
      const lines = wrapCard(SCRIPT[k][1], gg.box.tw);
      assert.ok(lines.length <= gg.box.lines, `${W}x${H} card ${k + 1}: ${lines.length} lines in a box of ${gg.box.lines}`);
      assert.equal(lines.join(' '), SCRIPT[k][1]);
      const fr = frame(ENDS[k] + 0.5, W, H);
      assert.equal(shown(fr, gg), SCRIPT[k][1], `${W}x${H} card ${k + 1} on screen`);
      // nothing but the box frame outside the text area changed: the border is whole
      assert.equal(textAt(fr, gg.box.x, gg.box.y, 1), '┏');
      assert.equal(textAt(fr, gg.box.x + gg.box.w - 1, gg.box.y, 1), '┓');
      for (let j = 1; j < gg.box.h - 1; j++) { assert.equal(textAt(fr, gg.box.x, gg.box.y + j, 1), '┃', `${W}x${H} left edge row ${j}`); assert.equal(textAt(fr, gg.box.x + gg.box.w - 1, gg.box.y + j, 1), '┃'); }
      // and the text stays between the margins
      for (let j = 0; j < gg.box.h; j++) for (let x = gg.box.x + 1; x < gg.box.tx; x++) if (j > 0 && j < gg.box.h - 1) assert.equal(at(fr, x, gg.box.y + j), 32);
    }
  }
  // control: a box that is too narrow would overflow
  assert.ok(wrapCard(SCRIPT[3][1], 20).length > 2);
});

// ---- L-band the streetlight band, the road and the dashboard

test('night-drive caller (L-band): a 6-column band one shade brighter sweeps the dashboard every 3 s, a column per 0.04 s', () => {
  assert.deepEqual([BAND_PERIOD, BAND_STEP], [3, 0.04]);
  const g = BIG;
  const side = (f) => {
    const cols = new Set();
    for (let y = g.dash.y; y < g.dash.y + g.dash.h; y++) for (let x = g.dash.x; x < g.dash.x + g.dash.w; x++) {
      if (x >= g.radio.x && x < g.radio.x + g.radio.w) continue;
      assert.equal(textAt(f, x, y, 1), '█', 'the dashboard is solid at the sides');
      if (colAt(f, x, y) === FAR) cols.add(x - g.dash.x); else assert.equal(colAt(f, x, y), NEAR);
    }
    return [...cols].sort((a, b) => a - b);
  };
  // the band lies in the left side from 0.04 * 5 s on, and moves a column per 0.04 s
  for (let c = 6; c < 14; c++) {
    const t = c * 0.04 + 0.01, cols = side(frame(t, 120, 40));
    assert.equal(cols.length, 6, `six columns at step ${c}`);
    assert.equal(cols[0], c - 5);
    assert.equal(cols[5], c);
  }
  // once per 3 s
  assert.deepEqual(side(frame(3.01 + 7 * 0.04, 120, 40)), side(frame(7 * 0.04 + 0.01, 120, 40)));
  // the dashboard is one shade (a step of the fixed pair NEAR / FAR), never the sweep fully across
  for (const t of [0.5, 1.9, 2.2, 2.9]) assert.ok(side(frame(t, 120, 40)).length <= 6);
});

// ---- L9 calm and safety

const SIZES = [[120, 40], [80, 24], [100, 32]];

test('night-drive caller (L9): 75 s at 1x and 4x at 120x40, 80x24 and 100x32: under 5% of the cells change a frame (never 30%), no kept glyph breaks the ramp rule, the background is never drawn, allowed glyphs only, none banned, colours inside the palette', () => {
  const rows = [];
  for (const [w, h] of SIZES) {
    for (const speed of [1, 4]) {
      const r = calmRun(frame, w, h, speed, 75);
      rows.push(`${w}x${h} ${speed}x worst ${(r.worst * 100).toFixed(2)}% at ${r.at.toFixed(2)} s`);
      assert.ok(r.worst < 0.3, `${w}x${h} ${speed}x: ${r.worst}`);
      assert.ok(r.worst < 0.05, `${w}x${h} ${speed}x: worst ${(r.worst * 100).toFixed(2)}% at ${r.at.toFixed(2)} s`);
      assert.ok(r.worst > 0.001, 'it moves');
      assert.equal(r.ramp, 0, `${w}x${h} ${speed}x: ${JSON.stringify(r.firstRamp)}`);
      assert.equal(r.blankBad, 0, 'a blank cell is colour 0 (the one background)');
      assert.equal(r.glyphBad, 0, 'allowed glyphs only');
      assert.equal(r.banned, 0, 'none of the banned set');
      assert.equal(r.colourBad, 0, `colours are the fixed families, below ${COUNT}`);
    }
  }
  console.log('# caller: ' + rows.join(' | '));
  // beyond the sizes it was tuned at
  for (const [w, h] of [[99, 31], [100, 31], [101, 33], [60, 20], [40, 18], [41, 19], [160, 48], [240, 67], [79, 25]]) {
    const r = calmRun(frame, w, h, 4, 75);
    assert.equal(r.ramp, 0, `${w}x${h}: ${JSON.stringify(r.firstRamp)}`);
    assert.ok(r.worst < 0.3, `${w}x${h}: ${r.worst}`);
    assert.equal(r.blankBad + r.glyphBad + r.banned + r.colourBad, 0, `${w}x${h}`);
  }
  // controls: a whole-box replacement in one frame would be over the share bound; a two-shade arrow would break the ramp rule
  const a = frame(ENDS[3] + 1, 80, 24), b = frame(STARTS[4] + 1.5, 80, 24);
  assert.ok(changedShare(a, b) > 0.03, 'a replaced card with no wipe is a large frame');
  const hi = { g: a.g.map(() => cp('▼')), c: a.c.map(() => MAG[3]), w: 80, h: 24 };
  const lo = { g: hi.g, c: hi.c.map(() => MAG[1]), w: 80, h: 24 };
  assert.equal(rampViolations(hi, lo).length, 80 * 24);
});

// ---- L10 sizes

test('night-drive caller (L10): 0x0, 1x1, 41x11, 99x31, 100x32, 240x67 and 400x120 do not throw; blank cells are glyph 32 in colour 0; small windows draw nothing', () => {
  const sizes = [[0, 0], [1, 1], [3, 3], [41, 11], [99, 31], [100, 32], [240, 67], [400, 120], [2, 200], [200, 2], [40, 18], [39, 40], [120, 17], [41, 18]];
  for (const [w, h] of sizes) {
    for (const t of [0, 1.6, 7.7, 29, 38.5, 70, 75, 1e6]) {
      let f;
      assert.doesNotThrow(() => { f = frame(t, w, h); }, `${w}x${h} t=${t}`);
      for (let i = 0; i < f.g.length; i++) if (f.g[i] === 32) assert.equal(f.c[i], 0);
    }
  }
  const lit = (w, h) => frame(29, w, h).g.reduce((n, v) => n + (v === 32 ? 0 : 1), 0);
  assert.equal(lit(41, 11), 0);
  assert.equal(lit(0, 0), 0);
  assert.equal(lit(39, 40), 0);
  assert.equal(lit(120, 17), 0);
  assert.ok(lit(40, 18) > 100 && lit(99, 31) > 200 && lit(100, 32) > 300 && lit(400, 120) > 1000);
  assert.deepEqual(Array.from(renderScene(caller, 29, 120, 40, 1).glyphs), Array.from(frame(29).g), 'the shared renderer gives the same picture');
  const early = frame(10, 120, 40, 1, 0), later = frame(40, 120, 40, 1, 30);
  assert.deepEqual(later.g, early.g, 't0 shifts the scene\'s clock');
  assert.deepEqual(frame(29, 120, 40, 1).g, frame(29, 120, 40, 1).g);
  assert.notDeepEqual(frame(10, 120, 40, 1).g, frame(10, 120, 40, 2).g, 'the seed sets the phases of the VU bars');
  for (const t of [-5, NaN, Infinity, -Infinity]) assert.doesNotThrow(() => frame(t), String(t));
});

// ---- L11 scale

test('night-drive caller (L11): a 240x67 frame costs under 20 ms on average over 200 frames; a scan of the whole picture a few thousand times would not', () => {
  const g = new Uint16Array(240 * 67), c = new Uint8Array(240 * 67);
  const ms = meanMs((t) => caller(t, 240, 67, { seed: 1, glyphs: g, colours: c }), 200);
  console.log(`# caller 240x67: ${ms.toFixed(3)} ms a frame`);
  assert.ok(ms < 20, `${ms} ms`);
  const slow = (t, w, h, p) => { for (let k = 0; k < 6000; k++) for (let i = 0; i < p.glyphs.length; i++) p.glyphs[i] = (k + i) & 0xff; };
  const slowMs = meanMs((t) => slow(t, 240, 67, { glyphs: g, colours: c }), 5);
  assert.ok(slowMs > 20, `the control costs ${slowMs} ms and fails the bound`);
});

// ---- L12 the shell plays it for 75 s and the tape wraps

test('night-drive caller (L12): the tape\'s scheduler holds the call for 75 s (not 90), dissolves into overdrive, and after 7 x 90 + 75 = 705 s of holds (and the 8 dissolves) wraps to onramp', () => {
  const tape = MANIFEST.programs[0];
  const holdOf = (id) => tape.seconds?.[id] ?? tape.sceneSeconds;
  const sched = new Scheduler({ count: tape.scenes.length, durationSec: tape.sceneSeconds, fadeSec: 2, start: 0, durations: tape.scenes.map(holdOf) });
  const ci = tape.scenes.indexOf('caller'), oi = tape.scenes.indexOf('overdrive');
  assert.ok(ci > 0 && oi === ci + 1);
  let t = 0, callerFrom = null, fadeFrom = null, overFrom = null, wrapAt = null, holds = 0, prevCur = 0;
  const dt = 0.25;
  for (let k = 0; k < 4 * 800 && wrapAt === null; k++) {
    sched.advance(dt); t += dt;
    const st = sched.state();
    if (sched.cur !== prevCur) {
      if (sched.cur === ci) callerFrom = t;
      if (sched.cur === oi) overFrom = t;
      if (sched.cur === 0 && prevCur === tape.scenes.length - 1) wrapAt = t;
      prevCur = sched.cur;
    }
    if (sched.cur === ci && st.fading && fadeFrom === null) fadeFrom = t;
  }
  assert.ok(callerFrom !== null && fadeFrom !== null && overFrom !== null && wrapAt !== null);
  assert.ok(Math.abs(fadeFrom - callerFrom - 75) <= dt + 1e-9, `the call dissolves ${fadeFrom - callerFrom} s after it starts`);
  assert.ok(Math.abs(overFrom - fadeFrom - 2) <= dt + 1e-9, 'into overdrive over 2 s');
  holds = 7 * 90 + 75;
  assert.equal(holds, 705);
  assert.ok(Math.abs(wrapAt - (holds + 8 * 2)) <= dt + 1e-9, `the tape wraps at ${wrapAt} s: ${holds} s of holds and 8 dissolves of 2 s`);
});

test('night-drive caller (L12): in the real shell, B3 plays the call for 75 s and then dissolves into overdrive; B1 to B3 are all on the menu', async () => {
  const c = mkShell({ cols: 80, rows: 24, dirs: [{ dir: INSTALL_DIR, trusted: true }], startScreen: { screen: 'library' } });
  try {
    c.app.start();
    assert.ok(c.goto('night-drive'));
    c.key('\r');
    c.tick(1.6);
    await c.settle();
    for (let i = 0; i < 400 && c.sh().screen !== 'running'; i++) c.tick(0.1);
    assert.equal(c.sh().screen, 'running');
    const idx = MANIFEST.menu.findIndex((e) => e.scene === 'caller');
    for (let k = 0; k < idx; k++) c.key('\x1b[B');
    c.key('\r');
    c.tick(0.5);
    await c.settle();
    assert.equal(c.sh().sceneId, 'caller');
    assert.equal(c.sh().menu, false);
    c.tick(60, 0.25);
    assert.equal(c.sh().sceneId, 'caller', 'still the call at 60 s');
    c.tick(14, 0.25);
    assert.equal(c.sh().sceneId, 'caller', 'and at 74.5 s');
    c.tick(1.5, 0.25);
    assert.equal(c.sh().sceneId, 'caller', 'dissolving at 76 s');
    c.tick(2.5, 0.25);
    await c.settle();
    assert.equal(c.sh().sceneId, 'overdrive', 'overdrive from 77 s on: 75 s of call and 2 s of dissolve, not 90');
  } finally { c.done(); }
});
