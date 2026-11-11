// DRIFT-4: scene VI, The Lampwarden (the 45 s cut scene). It is a 'cells' scene, not 'text': it needs portraits, a speaker's name and
// colour, a letterbox and the room behind the box. Read off rendered frames at three sizes:
//   - the six lines of the script appear whole, each typed at 30 characters per second and followed 3.5 s after it is complete by the next
//   - at least four distinct text states over the 45 s; a `▼` fades in and out once a line is whole; the speaker's name sits in the box edge
//   - portraits swap by a 0.5 s cell dissolve; the narrator has none; Pim flutters twice
//   - letterbox bars of empty rows top and bottom; candle flames move one shade at a time; the Ember Lantern climbs the stair
//   - the words fade out after the last line; the scene loops at 45 s; calm frame to frame; no banned glyph
import test from 'node:test';
import assert from 'node:assert/strict';
import lampwarden, { layoutOf, stateAt, wrap, LINES, STARTS, FADE_AT, CYCLE, LEAD, TYPE_CPS, GAP, DISSOLVE, FADE_OUT, PORTRAITS } from '../cartridges/delza/scenes/lampwarden.js';
import { renderScene } from '../src/cells.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { GOLD, PARCH, DIM } from '../cartridges/delza/lib/palette.js';

const cp = (ch) => ch.codePointAt(0);
const BANNED = [0x25cd, 0x25ce, 0x25d1, 0x25e2, 0x25e3, 0x222b, 0x2261];
const SIZES = [[240, 67], [120, 40], [80, 24]];
const frameAt = (t, w = 120, h = 40, seed = 1) => renderScene(lampwarden, t, w, h, seed);
const rowOf = (f, y, x0 = 0, n = f.cols) => String.fromCodePoint(...f.glyphs.slice(y * f.cols + x0, y * f.cols + x0 + n));
// the words in the box's text pane, rows joined with single spaces
function wordsAt(t, w, h) {
  const f = frameAt(t, w, h), L = layoutOf(w, h);
  const rows = [];
  for (let r = 2; r <= 6; r++) rows.push(rowOf(f, L.boxY + r, L.textX, L.textW).trim());
  return rows.filter(Boolean).join(' ');
}
const nameAt = (t, w, h) => { const f = frameAt(t, w, h), L = layoutOf(w, h); const m = /╡ (\w+) ╞/.exec(rowOf(f, L.boxY, L.textX, 14)); return m ? m[1] : null; };
const portraitAt = (t, w, h) => { const f = frameAt(t, w, h), L = layoutOf(w, h); return Array.from({ length: 7 }, (_, r) => rowOf(f, L.boxY + 1 + r, L.boxX + 2, 12)); };
const done = (i) => STARTS[i] + LINES[i].text.length / TYPE_CPS;

test('lampwarden: kind cells (not text), an id, 45 s, and the timings the storyboard gives (30 characters a second, 3.5 s between lines, 0.5 s dissolve)', () => {
  assert.equal(lampwarden.kind, 'cells');
  assert.equal(lampwarden.id, 'lampwarden');
  assert.deepEqual([CYCLE, TYPE_CPS, GAP, DISSOLVE], [45, 30, 3.5, 0.5]);
  assert.equal(LINES.length, 6);
  assert.deepEqual(LINES.map((l) => l.who), ['MAREN', 'ORRIN', 'MAREN', 'PIM', null, null]);
  for (let i = 1; i < LINES.length; i++) assert.ok(Math.abs(STARTS[i] - done(i - 1) - GAP) < 1e-9, `line ${i + 1} follows 3.5 s after line ${i}`);
  assert.ok(FADE_AT + FADE_OUT < CYCLE, 'the words are gone before the scene ends');
  assert.ok(STARTS[0] === LEAD && LEAD > 3, 'a lead-in of candlelight first');
});

test('lampwarden script: the lines are the storyboard\'s, word for word', () => {
  assert.equal(LINES[0].text, 'You came all the way from Lowmarrow?');
  assert.equal(LINES[1].text, 'The lamp on your tower went dark. We saw it from the Reach.');
  assert.equal(LINES[2].text, 'Then take the Moonwax Key. The stair has not been climbed in a hundred years.');
  assert.equal(LINES[3].text, '(flutters twice, which means yes)');
  assert.equal(LINES[4].text, 'Up he went, the Ember Lantern swinging, step after step.');
  assert.equal(LINES[5].text, 'And for the first time in a long while, Highcandle was whole.');
});

for (const [w, h] of SIZES) {
  test(`lampwarden ${w}x${h}: every line of the script appears whole, at least four distinct text states, no banned glyph`, () => {
    const states = new Set();
    const seen = new Set();
    for (let t = 0; t < CYCLE; t += 0.1) {
      const words = wordsAt(t, w, h);
      states.add(words);
      for (const l of LINES) if (words === l.text) seen.add(l.text);
    }
    assert.equal(seen.size, 6, `lines whole on screen: ${[...seen].length}`);
    assert.ok(states.size >= 4, `${states.size} text states`);
    assert.ok(states.size >= 6 + 6, 'and many more while they type');
    for (const t of [0, 3, 10, 20, 30, 38, 44]) {
      const f = frameAt(t, w, h);
      for (let i = 0; i < f.glyphs.length; i++) { assert.ok(!BANNED.includes(f.glyphs[i])); assert.ok(isAllowedGlyph(f.glyphs[i])); }
    }
  });
}

test('lampwarden typing: 30 characters a second, no reflow while a line types, the box empty in the lead-in', () => {
  for (const [w, h] of SIZES) {
    assert.equal(wordsAt(1, w, h), '', 'no words in the lead-in');
    assert.equal(wordsAt(LEAD - 0.01, w, h), '');
    for (let i = 0; i < LINES.length; i++) {
      for (const k of [0.4, 0.8]) {
        const t = STARTS[i] + k;
        const want = Math.min(LINES[i].text.length, Math.floor(k * TYPE_CPS + 1e-6));
        const shown = wordsAt(t, w, h).replace(/ /g, '');
        assert.equal(shown, LINES[i].text.slice(0, want).replace(/ /g, ''), `${w}x${h} line ${i + 1} ${k} s in`);
      }
    }
  }
  // the wrapped rows of a whole line are the same whatever has been typed: row 1 keeps its words
  const full = wrap(LINES[2].text, layoutOf(80, 24).textW);
  assert.ok(full.length >= 2 && full.every((r) => r.length <= layoutOf(80, 24).textW));
  assert.equal(full.join(' '), LINES[2].text);
});

test('lampwarden prompt: a ▼ fades in and out once a line is whole (not while it types, not in the lead-in), and the next line follows 3.5 s later', () => {
  const [w, h] = [120, 40];
  const L = layoutOf(w, h);
  const prompt = (t) => { const f = frameAt(t, w, h); const i = (L.boxY + 7) * w + L.boxX + L.boxW - 4; return f.glyphs[i] === cp('▼') ? f.colours[i] : -1; };
  assert.equal(prompt(2), -1);
  assert.equal(prompt(STARTS[0] + 0.5), -1, 'not while typing');
  const shades = new Set();
  for (let t = done(0) + 0.01; t < STARTS[1] - 0.01; t += 0.05) { const c = prompt(t); assert.ok(c >= 0, `prompt visible at ${t.toFixed(2)}`); shades.add(c); }
  assert.ok(shades.size >= 3 && [...shades].every((c) => GOLD.includes(c)), `${[...shades]} - fades through gold shades`);
  assert.equal(prompt(STARTS[1] + 0.2), -1, 'gone when the next line begins');
  // after the last line is read the words fade out and the prompt goes
  assert.equal(prompt(FADE_AT + 0.5), -1);
});

test('lampwarden speakers: the name sits in the box edge for Maren, Orrin and Pim, and the narrator has none', () => {
  const [w, h] = [120, 40];
  assert.deepEqual(LINES.map((l, i) => nameAt(done(i) - 0.05, w, h)), ['MAREN', 'ORRIN', 'MAREN', 'PIM', null, null]);
  assert.equal(nameAt(2, w, h), null);
  const wordColour = (i) => { const f = frameAt(done(i) - 0.05, w, h), L = layoutOf(w, h); for (let r = 2; r <= 6; r++) { const x = L.textX; if (f.glyphs[(L.boxY + r) * w + x] !== 32) return f.colours[(L.boxY + r) * w + x]; } return -1; };
  assert.equal(wordColour(0), PARCH[3]);
  assert.equal(wordColour(3), PARCH[2], 'Pim\'s action is a shade softer');
  assert.equal(wordColour(4), DIM, 'the narrator is dim parchment');
});

test('lampwarden portraits: the speaker\'s panel in the box, dissolving cell by cell over 0.5 s; the narrator has none', () => {
  const [w, h] = [120, 40];
  const sameAs = (rows, art) => rows.every((r, i) => r === art[i]);
  assert.ok(portraitAt(2, w, h).every((r) => r.trim() === ''), 'no portrait in the lead-in');
  assert.ok(sameAs(portraitAt(STARTS[0] + 0.6, w, h), PORTRAITS.MAREN), 'Maren');
  assert.ok(sameAs(portraitAt(STARTS[1] + 0.6, w, h), PORTRAITS.ORRIN), 'Orrin');
  assert.ok(sameAs(portraitAt(STARTS[2] + 0.6, w, h), PORTRAITS.MAREN), 'Maren again');
  // mid-dissolve: some cells old, some new, and the picture only ever shows cells of one or the other
  const mid = portraitAt(STARTS[1] + 0.25, w, h);
  let fromNew = 0, fromOld = 0, other = 0;
  for (let r = 0; r < 7; r++) for (let c = 0; c < 12; c++) {
    const g = mid[r][c];
    const n = PORTRAITS.ORRIN[r][c], o = PORTRAITS.MAREN[r][c];
    if (g === n && g !== o) fromNew++; else if (g === o && g !== n) fromOld++; else if (g !== n && g !== o) other++;
  }
  assert.ok(fromNew > 5 && fromOld > 5 && other === 0, `new ${fromNew}, old ${fromOld}, neither ${other}`);
  // the dissolve is monotone: a cell that has taken the new picture keeps it
  let prev = null;
  for (let k = 0; k <= 10; k++) {
    const p = portraitAt(STARTS[1] + k * 0.05 + 0.001, w, h);
    const now = new Set();
    for (let r = 0; r < 7; r++) for (let c = 0; c < 12; c++) if (p[r][c] === PORTRAITS.ORRIN[r][c] && p[r][c] !== PORTRAITS.MAREN[r][c]) now.add(r * 12 + c);
    if (prev) for (const x of prev) assert.ok(now.has(x), 'no cell goes back');
    prev = now;
  }
  assert.ok(portraitAt(STARTS[4] + 0.6, w, h).every((r) => r.trim() === ''), 'the narrator has no portrait');
});

test('lampwarden Pim: once his portrait has dissolved in he flutters twice (out, in, out, in, 0.3 s apiece) and then rests with wings out', () => {
  const [w, h] = [120, 40];
  const wings = (age) => {
    const p = portraitAt(STARTS[3] + age, w, h);
    return p.every((r, i) => r === PORTRAITS.PIM_OUT[i]) ? 'out' : p.every((r, i) => r === PORTRAITS.PIM_IN[i]) ? 'in' : '~';
  };
  const ages = [0.15, 0.45, 0.75, 1.05, 1.35, 1.65, 2.5].map((a) => DISSOLVE + a);
  assert.deepEqual(ages.map(wings), ['out', 'in', 'out', 'in', 'out', 'out', 'out']);
  assert.equal(wings(DISSOLVE / 2), '~', 'and the dissolve is still under way before that');
  // two closings of the wings, counted through the whole line
  let closings = 0, last = null;
  for (let a = DISSOLVE; a < 4; a += 0.05) { const s = wings(a); if (s === 'in' && last !== 'in') closings++; last = s; }
  assert.equal(closings, 2, 'twice, which means yes');
});

test('lampwarden letterbox: four empty rows top and bottom from 30 rows up (two below), at every moment', () => {
  assert.equal(layoutOf(120, 40).lb, 4);
  assert.equal(layoutOf(240, 67).lb, 4);
  assert.equal(layoutOf(80, 24).lb, 2);
  for (const [w, h] of SIZES) {
    const lb = layoutOf(w, h).lb;
    for (const t of [0, 5, 12, 20, 30, 40]) {
      const f = frameAt(t, w, h);
      for (let y = 0; y < lb; y++) { assert.equal(rowOf(f, y).trim(), '', `${w}x${h} top row ${y} at ${t}`); assert.equal(rowOf(f, h - 1 - y).trim(), '', `bottom row ${y}`); }
    }
  }
});

test('lampwarden room: a round window drawn in ╭╮╰╯, candles on two shelves, a box in Delza chrome with a portrait panel on the left', () => {
  const f = frameAt(30);
  const L = layoutOf(120, 40);
  const text = Array.from({ length: f.rows }, (_, y) => rowOf(f, y)).join('\n');
  for (const ch of '╭╮╰╯') assert.ok(text.includes(ch), ch);
  assert.ok(text.includes('╭─╯') && text.includes('╰─╮'), 'the round window\'s shoulders');
  const flames = []; for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] === cp('▲') && GOLD.includes(f.colours[i])) flames.push(i);
  assert.equal(flames.length, 6, 'six candles');
  assert.equal(rowOf(f, L.boxY, L.boxX, 1), '◆');
  assert.equal(rowOf(f, L.boxY + 8, L.boxX + L.boxW - 1, 1), '◆');
  assert.equal(rowOf(f, L.boxY + 3, L.boxX, 1), '║');
  assert.equal(rowOf(f, L.boxY, L.boxX + 15, 1), '╦', 'the portrait panel is divided off on the left');
});

test('lampwarden candles: each flame moves one shade at a time, and they do not move together', () => {
  const [w, h] = [120, 40];
  let prev = null;
  const seen = new Set();
  const perFrame = [];
  for (let k = 0; k < 20 * 18; k++) {
    const f = frameAt(k / 18, w, h);
    const flames = [];
    for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] === cp('▲') && GOLD.includes(f.colours[i])) flames.push([i, GOLD.indexOf(f.colours[i])]);
    assert.equal(flames.length, 6);
    if (prev) {
      let moved = 0;
      flames.forEach(([i, s], n) => { assert.equal(i, prev[n][0]); const d = Math.abs(s - prev[n][1]); assert.ok(d <= 1, `one shade at a time (moved ${d})`); if (d) moved++; seen.add(s); });
      perFrame.push(moved);
    }
    prev = flames;
  }
  assert.ok(seen.size >= 3, 'through three shades');
  assert.ok(Math.max(...perFrame) <= 3, 'never all together');
});

test('lampwarden stair: the Ember Lantern is not there before line 5, then climbs a step at a time and reaches the top as the scene ends', () => {
  const [w, h] = [120, 40];
  const L = layoutOf(w, h);
  assert.ok(L.stairN >= 6);
  const lantern = (t) => { const f = frameAt(t, w, h); const out = []; for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] === cp('●') && f.colours[i] === GOLD[3] && Math.floor(i / w) >= L.roomTop && i % w > L.sx) out.push([i % w, Math.floor(i / w)]); return out; };
  assert.equal(lantern(STARTS[4] - 0.2).length, 0);
  let last = null;
  const steps = new Set();
  for (let t = STARTS[4] + 0.05; t < CYCLE - 0.05; t += 0.1) {
    const l = lantern(t);
    assert.equal(l.length, 1, `one lantern at ${t.toFixed(1)}`);
    if (last) { assert.ok(l[0][0] >= last[0] && l[0][1] <= last[1], 'only up and to the right'); assert.ok(l[0][0] - last[0] <= 2, 'a step at a time'); }
    steps.add(l[0].join());
    last = l[0];
  }
  assert.ok(steps.size >= L.stairN - 1, `${steps.size} of ${L.stairN} steps visited`);
  assert.equal(last[1], L.roomBot - (L.stairN - 1) - 1, 'at the top of the stair when the scene ends');
});

test('lampwarden ending: after the last line has been read the words fade out over 2 s and the box is empty; the scene loops at 45 s', () => {
  const [w, h] = [120, 40];
  const L = layoutOf(w, h);
  const colours = new Set();
  for (let t = FADE_AT - 0.05; t < FADE_AT + FADE_OUT + 0.05; t += 0.1) {
    const f = frameAt(t, w, h);
    for (let r = 2; r <= 6; r++) for (let x = L.textX; x < L.textX + L.textW; x++) if (f.glyphs[(L.boxY + r) * w + x] !== 32) colours.add(f.colours[(L.boxY + r) * w + x]);
  }
  assert.ok(colours.size >= 4, `the words pass through ${colours.size} colours on their way out`);
  assert.equal(wordsAt(FADE_AT + FADE_OUT + 0.1, w, h), '');
  assert.equal(wordsAt(CYCLE - 0.5, w, h), '');
  // looping: the same frame one cycle later
  for (const t of [6.37, 17.77, 31.13, 44.57]) assert.deepEqual(Array.from(frameAt(t).glyphs), Array.from(frameAt(t + CYCLE).glyphs), `t=${t}`);
  // and the start of a cycle is as quiet as the end (no jump at the wrap)
  const a = frameAt(CYCLE - 0.03), b = frameAt(CYCLE + 0.03);
  let c = 0; for (let i = 0; i < a.glyphs.length; i++) if (a.glyphs[i] !== b.glyphs[i] || a.colours[i] !== b.colours[i]) c++;
  assert.ok(c / a.glyphs.length < 0.02, `${c} cells change at the wrap`);
});

for (const [w, h] of SIZES) {
  test(`lampwarden ${w}x${h}: calm - from one frame to the next at most 5% of the screen changes over two loops, and it moves`, () => {
    let prev = null, worst = 0, worstT = 0;
    for (let k = 0; k < 2 * CYCLE * 18; k++) {
      const f = frameAt(k / 18, w, h);
      if (prev) { let c = 0; for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] !== prev.g[i] || f.colours[i] !== prev.c[i]) c++; if (c / f.glyphs.length > worst) { worst = c / f.glyphs.length; worstT = k / 18; } }
      prev = { g: f.glyphs.slice(), c: f.colours.slice() };
    }
    assert.ok(worst < 0.05, `worst frame changed ${(worst * 100).toFixed(2)}% at ${worstT.toFixed(2)} s`);
    assert.ok(worst > 0.001);
  });
}

test('lampwarden: the seed changes the walls and the stars; tiny windows do not throw; the box needs room to appear', () => {
  assert.notDeepEqual(Array.from(frameAt(30, 120, 40, 1).glyphs), Array.from(frameAt(30, 120, 40, 2).glyphs));
  for (const [w, h] of [[0, 0], [1, 1], [3, 3], [12, 8], [2, 200], [200, 2], [30, 10]]) assert.doesNotThrow(() => frameAt(33, w, h), `${w}x${h}`);
  assert.equal(layoutOf(80, 24).hasBox, true);
  assert.equal(layoutOf(20, 24).hasBox, false);
  assert.deepEqual(stateAt(1), { i: -1, typed: 0, done: false, doneAt: 0 });
  assert.equal(stateAt(done(0) + 0.1).done, true);
});
