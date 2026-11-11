// DRIFT-4: scene III, The Cinderhorn (the fight). The storyboard's promises, checked on rendered frames:
//   - a hit glow lifts only the creature's own cells, under 3% of the screen, and two glows are never closer than 1.5 s
//   - the turn cycle is the same every loop, five turns of 4 s then the calm, and the cursor follows the plan
//   - health bars step down on the hits; at 80x24 the sprites are their normal size and the command box is one row
//   - the calm: Pim crosses to the stag, the embers cool to stone, the line of narration, the stag walks off
// The glow detector is proven on a synthetic scene that glows twice in half a second (it must be caught).
import test from 'node:test';
import assert from 'node:assert/strict';
import cinderhorn, { TURN, PLAN, FIGHT, HIT_AT, CONTACT_AT, glowLevel, placeOf, timelineOf, OPTIONS } from '../cartridges/delza/scenes/cinderhorn.js';
import { renderScene } from '../src/cells.js';
import { FAMILIES, EMBER, GOLD, STONE, LEAF, PARCH } from '../cartridges/delza/lib/palette.js';
import { STAG_W, STAG_H, ORRIN_W, ORRIN_H } from '../cartridges/delza/lib/sprites.js';

const FPS = 18;
const cp = (ch) => ch.codePointAt(0);
const famOf = (c) => { for (const [k, f] of Object.entries(FAMILIES)) { const i = f.indexOf(c); if (i >= 0) return [k, i]; } return null; };

function frames(scene, w, h, seconds, seed = 1, from = 0) {
  const out = [];
  for (let k = 0; k < seconds * FPS; k++) {
    const f = renderScene(scene, from + k / FPS, w, h, seed);
    out.push({ g: f.glyphs.slice(), c: f.colours.slice(), t: from + k / FPS });
  }
  return out;
}

// Cells that kept their glyph and rose in brightness inside their own family between two frames. The shield's ring of o glyphs
// ramps up on purpose (it is not a creature's glow), so its cells are left out.
function risers(a, b) {
  const cells = [];
  for (let i = 0; i < a.g.length; i++) {
    if (a.g[i] === 32 || a.g[i] !== b.g[i] || a.c[i] === b.c[i] || a.g[i] === cp('○')) continue;
    const fa = famOf(a.c[i]), fb = famOf(b.c[i]);
    if (fa && fb && fa[0] === fb[0] && fb[1] > fa[1]) cells.push(i);
  }
  return cells;
}

// The glow events in a run: clusters of consecutive frames in which at least `min` cells rose. Returns { worstShare, events: [t] }.
function glowEvents(fr, w, h, min = 6, rows = [0, h - 1]) {
  let worstShare = 0, worstCount = 0;
  const events = [];
  let inCluster = false;
  for (let k = 1; k < fr.length; k++) {
    const n = risers(fr[k - 1], fr[k]).filter((i) => Math.floor(i / w) >= rows[0] && Math.floor(i / w) <= rows[1]).length;
    worstShare = Math.max(worstShare, n / (w * h));
    worstCount = Math.max(worstCount, n);
    if (n >= min && !inCluster) events.push(fr[k].t);
    inCluster = n >= min;
  }
  return { worstShare, worstCount, events };
}

for (const [w, h] of [[120, 40], [80, 24], [240, 67]]) {
  test(`cinderhorn ${w}x${h}: over two full loops every glow is under 3% of the screen and two glows are at least 1.5 s apart; seven a loop`, () => {
    const TL = timelineOf(w, h);
    const fr = frames(cinderhorn, w, h, TL.cycle * 2 + 1);
    const P = placeOf(w, h);
    // the creatures' rows; the command box's gold word is text, not a creature, and sits below them
    const { worstShare, worstCount, events } = glowEvents(fr, w, h, 6, [P.sy - 1, P.base + 1]);
    assert.ok(worstShare < 0.03, `worst frame: ${(worstShare * 100).toFixed(2)}% of the screen brightened`);
    assert.ok(worstCount >= 20, `and the glow is really there (${worstCount} cells)`);
    for (let i = 1; i < events.length; i++) assert.ok(events[i] - events[i - 1] >= 1.5, `glows at ${events[i - 1].toFixed(2)} and ${events[i].toFixed(2)}`);
    const perLoop = PLAN.length - 1 + 0; // swings: three hits on the stag
    const swings = PLAN.filter((p) => p === 'swing').length, contacts = PLAN.filter((p) => p !== 'shield').length;
    assert.equal(events.filter((t) => t < TL.cycle).length, swings + contacts, `${swings} stag hits and ${contacts} contacts in a loop (${perLoop})`);
    // the two creatures' own cells only: every cell that rose lies inside the sprites' rows and the width between them
    for (let k = 1; k < fr.length; k += 3) {
      for (const i of risers(fr[k - 1], fr[k])) {
        const x = i % w, y = Math.floor(i / w);
        if (y > P.base + 1) { assert.equal(y, h - (P.tall ? 2 : 1), `outside the creatures' rows only the command word brightens (row ${y})`); continue; }
        assert.ok(y >= P.sy - 2, `row ${y} at t=${fr[k].t.toFixed(2)}`);
        assert.ok(x >= P.ox0 - 2 && x <= P.sx0 + STAG_W + 8, `column ${x}`);
      }
    }
  });
}

test('cinderhorn: the glow is a two-shade lift - 0.15 s up, 0.45 s down - and a hit moment starts every glow', () => {
  assert.equal(glowLevel(0), 0);
  assert.equal(glowLevel(0.15), 2);
  assert.equal(glowLevel(0.08), 1);
  assert.equal(glowLevel(0.4), 1);
  assert.equal(glowLevel(0.6), 0);
  assert.equal(glowLevel(-1), 0);
  let max = 0;
  for (let a = 0; a < 1; a += 0.01) max = Math.max(max, glowLevel(a));
  assert.equal(max, 2, 'never more than two shades');
  // on the stag: its cells go from shade 1 to 3 within 0.15 s of the hit and are back at 1 by 0.5 s
  const w = 120, h = 40, P = placeOf(w, h);
  const shadeAt = (t) => { const f = renderScene(cinderhorn, t, w, h, 1); const shades = new Set(); for (let y = P.sy; y < P.sy + STAG_H; y++) for (let x = P.sx0 + 2; x < P.sx0 + 11; x++) { const i = y * w + x; if (f.glyphs[i] === cp('▓')) shades.add(famOf(f.colours[i])[1]); } return [...shades]; };
  assert.deepEqual(shadeAt(HIT_AT - 0.05), [1], 'before the hit');
  assert.ok(shadeAt(HIT_AT + 0.16).includes(3), 'two shades up at 0.15 s');
  assert.deepEqual(shadeAt(HIT_AT + 0.56), [1], 'and back down by 0.5 s');
});

test('control: the detector catches a glow that comes twice in half a second, and a glow over a tenth of the screen', () => {
  const w = 60, h = 20;
  const twice = Object.assign((t, W, H, p) => {
    p.glyphs.fill(32); p.colours.fill(0);
    for (let i = 0; i < 12; i++) { p.glyphs[5 * W + 3 + i] = cp('▓'); p.colours[5 * W + 3 + i] = EMBER[(t >= 1 && t < 1.3) || (t >= 1.5 && t < 1.8) ? 3 : 1]; }
  }, { id: 'twice', kind: 'cells' });
  const ev = glowEvents(frames(twice, w, h, 3), w, h);
  assert.equal(ev.events.length, 2);
  assert.ok(ev.events[1] - ev.events[0] < 1.5, 'caught: two events closer than 1.5 s');
  const wide = Object.assign((t, W, H, p) => {
    p.glyphs.fill(cp('▓')); p.colours.fill(EMBER[t >= 1 ? 3 : 1]);
  }, { id: 'wide', kind: 'cells' });
  assert.ok(glowEvents(frames(wide, w, h, 2), w, h).worstShare > 0.1, 'a wide glow is far over 3%');
});

// ---- the cycle

test('cinderhorn: the turn cycle is the same every loop (frames match from the second of each loop on), and each turn is 4 s', () => {
  assert.equal(TURN, 4);
  assert.equal(FIGHT, 20);
  const w = 120, h = 40;
  const TL = timelineOf(w, h);
  // (times off the 0.05 s grid the story's moments sit on, so float rounding in t + cycle cannot tip a moment either way)
  for (const t of [1.57, 4.73, 9.97, 15.13, 19.93, 21.07, 26.31, 33.03, TL.cycle - 1.17]) {
    const a = renderScene(cinderhorn, t, w, h, 1), b = renderScene(cinderhorn, t + TL.cycle, w, h, 1);
    assert.deepEqual(Array.from(b.glyphs), Array.from(a.glyphs), `glyphs at ${t}`);
    assert.deepEqual(Array.from(b.colours), Array.from(a.colours), `colours at ${t}`);
  }
  // a scene that starts later counts from its own start: t0 shifts the story
  const base = renderScene(cinderhorn, 7.3, w, h, 1);
  const g = new Uint16Array(w * h), c = new Uint8Array(w * h);
  cinderhorn(107.3, w, h, { seed: 1, glyphs: g, colours: c, t0: 100 });
  assert.deepEqual(Array.from(g), Array.from(base.glyphs));
  assert.deepEqual(Array.from(c), Array.from(base.colours));
});

const lines = (f, w, h) => { const out = []; for (let y = 0; y < h; y++) { let s = ''; for (let x = 0; x < w; x++) s += String.fromCodePoint(f.glyphs[y * w + x]); out.push(s); } return out; };

test('cinderhorn: the cursor walks to each turn\'s choice and the chosen word turns gold; the plan is Swing, Shield, Swing, Wait, Swing, then Calm it', () => {
  const w = 120, h = 40;
  const P = placeOf(w, h);
  const rowY = P.tall ? h - 2 : h - 1;
  const want = [...PLAN.map((p) => ({ swing: 0, shield: 1, wait: 3 }[p])), 2];
  want.forEach((idx, n) => {
    const t = n * TURN + 2.0;
    const f = renderScene(cinderhorn, t, w, h, 1);
    const row = lines(f, w, h)[rowY];
    const cursorAt = row.indexOf('▶');
    assert.ok(cursorAt >= 0, `turn ${n}: a cursor`);
    assert.equal(row.slice(cursorAt + 2, cursorAt + 2 + OPTIONS[idx].length), OPTIONS[idx], `turn ${n}: the cursor is on ${OPTIONS[idx]}: ${row.trim()}`);
    const wordX = cursorAt + 2;
    assert.equal(f.colours[rowY * w + wordX], GOLD[3], `turn ${n}: the chosen word is gold`);
    const other = row.indexOf(OPTIONS[(idx + 1) % 4]);
    assert.notEqual(f.colours[rowY * w + other], GOLD[3], 'and the others are not');
  });
  // the cursor is at the previous choice when the turn begins, and arrives within 0.6 s
  const start = lines(renderScene(cinderhorn, TURN * 1 + 0.05, w, h, 1), w, h)[rowY];
  assert.ok(start.indexOf('▶') < start.indexOf('Shield'), 'turn 1 starts on Swing lantern');
});

test('cinderhorn: health bars step down on the hits - the stag by 12 of 60 for each swing, Orrin by 6 of 40 for each contact - and fill back each loop', () => {
  const w = 120, h = 40;
  const count = (f, y, from, to) => { let n = 0; for (let x = from; x < to; x++) if (f.glyphs[y * w + x] === cp('█') && f.colours[y * w + x] !== 0) n++; return n; };
  const stagFilled = (t) => count(renderScene(cinderhorn, t, w, h, 1), 1, w - 2 - 14, w - 2);
  const orrinFilled = (t) => count(renderScene(cinderhorn, t, w, h, 1), 1, 2 + 6, 2 + 6 + 14);
  assert.equal(stagFilled(0.5), 14);
  assert.equal(orrinFilled(0.5), 14);
  assert.equal(stagFilled(HIT_AT + 0.1), Math.round((48 / 60) * 14));
  assert.equal(stagFilled(2 * TURN + HIT_AT + 0.1), Math.round((36 / 60) * 14));
  assert.equal(stagFilled(4 * TURN + HIT_AT + 0.1), Math.round((24 / 60) * 14));
  assert.equal(orrinFilled(CONTACT_AT + 0.1), Math.round((34 / 40) * 14));
  assert.equal(orrinFilled(TURN + CONTACT_AT + 0.1), Math.round((34 / 40) * 14), 'a Shield turn costs nothing');
  assert.equal(orrinFilled(19.9), Math.round((16 / 40) * 14));
  assert.equal(orrinFilled(timelineOf(w, h).cycle + 3), 14, 'full again in the next loop');
  // under 100 columns the bars are shorter
  assert.equal(placeOf(80, 24).barLen, 8);
  assert.equal(placeOf(120, 40).barLen, 14);
});

test('cinderhorn at 80x24: the sprites keep their normal size and the command box is one row; from 30 rows it is framed in three', () => {
  const small = renderScene(cinderhorn, 2, 80, 24, 1);
  const ls = lines(small, 80, 24);
  assert.ok(ls[23].includes('Swing lantern') && ls[23].includes('Wait'));
  assert.ok(!ls[22].includes('╔') && !ls[22].includes('═'), 'no frame at 24 rows');
  const P = placeOf(80, 24);
  assert.equal(P.boxRows, 1);
  // the stag is the full 15 x 6 sprite and Orrin the full 6 x 4 one (their horns and head are on the rows the sprite says)
  assert.equal(ls[P.sy].slice(P.sx0, P.sx0 + 7).trim(), 'ψ ψ');
  assert.equal(ls[P.sy + STAG_H - 1].slice(P.sx0 + 5, P.sx0 + 15).replace(/ /g, '').length >= 8, true);
  assert.equal(ls[P.oy].slice(P.ox0, P.ox0 + ORRIN_W).includes('▄▄'), true);
  assert.equal(P.base - P.oy + 1, ORRIN_H);
  const big = lines(renderScene(cinderhorn, 2, 120, 40, 1), 120, 40);
  assert.ok(big[37].includes('╔') && big[39].includes('╚'), 'a framed three-row box from 30 rows up');
  assert.ok(big[38].includes('Swing lantern'));
});

test('cinderhorn: the calm - Pim crosses to the stag, the embers cool to stone, the narration appears, the stag walks off to the right, then the loop starts again', () => {
  const w = 120, h = 40;
  const P = placeOf(w, h);
  const TL = timelineOf(w, h);
  const stagColours = (t) => { const f = renderScene(cinderhorn, t, w, h, 1); const set = new Set(); for (let y = P.sy; y < P.sy + STAG_H + 1; y++) for (let x = P.sx0 - 6; x < P.sx0 + STAG_W + 6; x++) { const i = y * w + x; if (f.glyphs[i] !== 32 && [cp('▓'), cp('▄'), cp('▌'), cp('▐'), cp('ψ')].includes(f.glyphs[i])) set.add(famOf(f.colours[i])[0]); } return set; };
  assert.ok(stagColours(FIGHT + 1).has('f') || stagColours(FIGHT + 1).has('e'), 'ember before the cooling');
  const cold = stagColours(FIGHT + 6);
  assert.ok(!cold.has('f') && !cold.has('e') && cold.has('h'), `cold stone at 6 s into the calm: ${[...cold]}`);
  const text = (t) => lines(renderScene(cinderhorn, t, w, h, 1), w, h).join('\n');
  assert.ok(!text(FIGHT + 3).includes("The Cinderhorn's embers cool."));
  assert.ok(text(FIGHT + 6.6).includes("The Cinderhorn's embers cool. It bows, and walks into the trees."));
  // Pim: next to the lantern at the start of the calm, over the stag's head by 3.5 s in
  const pimAt = (t) => { const f = renderScene(cinderhorn, t, w, h, 1); for (let i = 0; i < f.glyphs.length; i++) if ((f.glyphs[i] === cp('ω') || f.glyphs[i] === cp('v')) && f.colours[i] === PARCH[3]) return [i % w, Math.floor(i / w)]; return null; };
  const near = pimAt(FIGHT + 0.3), over = pimAt(FIGHT + 3.6);
  assert.ok(near && over);
  assert.ok(Math.abs(near[0] - (P.ox0 + 5)) <= 4, `Pim by the lantern: ${near}`);
  assert.ok(Math.abs(over[0] - (P.sx0 + 3)) <= 4 && over[1] < P.sy + 2, `Pim over the stag: ${over}`);
  // the stag walks off the right edge and is gone for the rest of the loop
  const horns = (t) => lines(renderScene(cinderhorn, t, w, h, 1), w, h).slice(P.sy - 1, P.sy + STAG_H + 2).join('\n').includes('ψ ψ');
  assert.equal(horns(FIGHT + 9), true, 'walking');
  assert.equal(horns(TL.cycle - 1), false, 'gone before the loop ends');
  assert.equal(horns(TL.cycle + 3), true, 'and back, rekindled, in the next loop');
});

test('cinderhorn: a shield turn draws a ring of o glyphs round Orrin that rises and fades; a swing turn has none', () => {
  const w = 120, h = 40;
  const rings = (t) => { const f = renderScene(cinderhorn, t, w, h, 1); let n = 0; for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] === cp('○') && STONE.includes(f.colours[i])) n++; return n; };
  assert.equal(rings(0.5), 0);
  assert.ok(rings(TURN + 3.1) >= 10, 'ring up at the top of a shield turn');
  assert.equal(rings(TURN + 3.95), 0, 'faded by the end of the turn');
  assert.equal(rings(2 * TURN + 3.1), 0, 'none on the next swing');
  assert.ok(LEAF.length === 4);
});
