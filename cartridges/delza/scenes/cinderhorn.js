// III. The Cinderhorn: a stag of embers blocks the road in the Ashen Clearing. A choreographed fight in the voice of an old
// turn-based story game, with nothing random in it: every turn is 4 s, five turns, then the stag is calmed, not killed.
//
//   turn plan   Swing lantern, Shield, Swing lantern, Wait, Swing lantern; then Calm it.
//   each turn   0.0 to 0.6   the cursor walks to the choice (a step every 0.2 s); 0.6 to 1.0 the chosen word turns gold
//   a swing     0.6 to 1.0   Orrin dashes at the stag (the gap shrinks by 6 columns on a normal screen)
//               0.9 to 1.7   a lantern arc of three glyphs, drawn in 0.3 s and faded out over 0.5 s
//               1.2          the lantern lands: the stag glows (the creature's own cells two shades up in 0.15 s, back in
//                            0.45 s), recoils 2 columns, eight embers scatter and fade over 1 s, "12" floats up 3 rows
//   the stag    2.2 to 2.8   paws the ground; 2.8 to 3.2 charges 4 columns; 3.2 contact: Orrin glows and gives 1 column;
//                            with Shield chosen a ring of o glyphs rises round Orrin and fades instead
//   the calm    Pim flies from the lantern to the stag; its colour cools from ember to stone over 3 s; it bows; it walks off
//               to the right ("The Cinderhorn's embers cool. It bows, and walks into the trees."); then the story loops.
//
// Liveliness is movement. A hit glow touches only the creature's own cells, once per 1.5 s at the very most (two of them in a
// turn are 2 s apart), well under 3% of the screen. No flash of the whole screen, no shake. Sprites stay their normal size at
// 80x24; the command box is one row there and a framed three rows from 30 rows up; the health bars are shorter under 100 columns.
//
// kind 'cells', pure in (t, w, h, seed): time is counted from the scene's own start (params.t0).
import { rand } from '../../../src/scenes/util.js';
import { canvas, clear, put, text, blit, fillRect } from '../lib/canvas.js';
import { sceneTime, seedOf } from '../lib/clock.js';
import { LEAF, EMBER, STONE, PARCH, GOLD, BARK, DIM } from '../lib/palette.js';
import { drawOrrin, drawPim, drawStag, drawStump, ORRIN_W, ORRIN_H, ORRIN_BRACE_LANTERN, ORRIN_LANTERN, STAG_W, STAG_H } from '../lib/sprites.js';

export const TURN = 4;
export const PLAN = Object.freeze(['swing', 'shield', 'swing', 'wait', 'swing']);
export const OPTIONS = Object.freeze(['Swing lantern', 'Shield', 'Calm it', 'Wait']);
const OPT_OF = { swing: 0, shield: 1, calm: 2, wait: 3 };
export const FIGHT = PLAN.length * TURN; // 20 s
export const HIT_AT = 1.2, CONTACT_AT = 3.2; // seconds into a turn
export const GLOW_UP = 0.15, GLOW_DOWN = 0.45;
const GAP = 10; // columns between Orrin and the stag at rest
const STAG_HP = 60, STAG_DAMAGE = 12, ORRIN_HP = 40, ORRIN_DAMAGE = 6;
const NARRATION = "The Cinderhorn's embers cool. It bows, and walks into the trees.";
const cp = (ch) => ch.codePointAt(0);
const ORBIT = [[3, 0], [2, 1], [0, 1], [-2, 1], [-3, 0], [-2, -1], [0, -1], [2, -1]];

export function placeOf(w, h) {
  const tall = h >= 30;
  const boxRows = tall ? 3 : 1;
  const groundRows = Math.max(2, Math.round(h * 0.16));
  const gTop = h - boxRows - groundRows;
  const base = gTop + Math.min(1, groundRows - 1); // the row the feet stand on
  const ox0 = Math.max(1, Math.round((w - (ORRIN_W + GAP + STAG_W)) / 2));
  const sx0 = ox0 + ORRIN_W + GAP;
  return { tall, boxRows, gTop, groundRows, base, ox0, sx0, oy: base - ORRIN_H + 1, sy: base - STAG_H + 1, barLen: w >= 100 ? 14 : 8 };
}

// How long the stag takes to walk off the right edge (a column per 0.2 s), and the whole loop.
export function timelineOf(w, h) {
  const P = placeOf(w, h);
  const exit = Math.max(6, Math.min(60, (w + 1 - P.sx0) * 0.2));
  // the loop is a whole number of half seconds, so the idle frames and Pim's wing beats fall the same way every time round
  return { exit, calmStart: FIGHT, bowAt: FIGHT + 6.4, walkAt: FIGHT + 8, cycle: Math.ceil((FIGHT + 8 + exit + 2) * 2) / 2 };
}

// The glow level (0 to 2) `age` seconds after a hit: up in GLOW_UP, back down over GLOW_DOWN.
export function glowLevel(age) {
  if (!(age >= 0)) return 0;
  if (age < GLOW_UP) return Math.round((2 * age) / GLOW_UP);
  if (age < GLOW_UP + GLOW_DOWN) return Math.round(2 * (1 - (age - GLOW_UP) / GLOW_DOWN));
  return 0;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// stepped ease: n equal steps from 0 to 1 across [a, b]
const stepped = (u, a, b, n) => Math.floor(clamp01((u - a) / (b - a)) * n + 1e-9) / n;

function bar(cv, x, y, name, fraction, n, fillCol, nameCol, right) {
  const filled = Math.max(0, Math.min(n, Math.round(fraction * n)));
  const s = name + ' ' + '█'.repeat(filled) + '░'.repeat(n - filled);
  const x0 = right ? x - s.length : x;
  text(cv, x0, y, name, nameCol);
  for (let i = 0; i < n; i++) put(cv, x0 + name.length + 1 + i, y, i < filled ? cp('█') : cp('░'), i < filled ? fillCol : STONE[0]);
}

function cinderhorn(t, w, h, params) {
  const cv = canvas(params.glyphs, params.colours, w, h);
  clear(cv);
  const W = cv.w, H = cv.h;
  if (W === 0 || H === 0) return;
  const T = sceneTime(t, params);
  const S = seedOf(params);
  const P = placeOf(W, H);
  const TL = timelineOf(W, H);
  const cycle = Math.floor(T / TL.cycle);
  const Tc = T - cycle * TL.cycle;
  const rs = S; // the same story every loop: only the first second of a later loop differs (the reveal)

  // ---- the clearing: ash ground, burnt stumps
  for (let y = Math.max(0, P.gTop); y < H - P.boxRows; y++) {
    for (let x = 0; x < W; x++) {
      const r = rand(S + 31, x, y);
      if (r > 0.95) put(cv, x, y, cp('·'), STONE[1]);
      else put(cv, x, y, y === P.gTop ? cp('▒') : cp('░'), y === P.gTop ? STONE[1] : STONE[0]);
    }
  }
  const stumps = Math.max(2, Math.floor(W / 28));
  for (let i = 0; i < stumps; i++) {
    const sx = Math.floor(((i + 0.5) * W) / stumps + (rand(S + 33, i, 0) - 0.5) * (W / stumps) * 0.6);
    if (sx > P.ox0 - 4 && sx < P.sx0 + STAG_W + 4) continue; // none behind the fight
    drawStump(cv, sx, P.gTop - 1 + (i % 2), 0);
  }

  // ---- what each turn did so far (health) and the turn we are in
  const inFight = Tc < FIGHT;
  const turn = inFight ? Math.floor(Tc / TURN) : PLAN.length; // PLAN.length is the calm turn
  const u = inFight ? Tc - turn * TURN : Tc - FIGHT;
  const plan = (n) => (n < PLAN.length ? PLAN[n] : 'calm');
  let stagHits = 0, orrinHits = 0;
  for (let n = 0; n < PLAN.length; n++) {
    if (plan(n) === 'swing' && Tc >= n * TURN + HIT_AT) stagHits++;
    if (plan(n) !== 'shield' && Tc >= n * TURN + CONTACT_AT) orrinHits++;
  }

  // ---- health bars
  bar(cv, 2, 1, 'ORRIN', 1 - (orrinHits * ORRIN_DAMAGE) / ORRIN_HP, P.barLen, LEAF[2], PARCH[3], false);
  bar(cv, W - 2, 1, 'CINDERHORN', 1 - (stagHits * STAG_DAMAGE) / STAG_HP, P.barLen, EMBER[2], PARCH[3], true);

  // ---- positions
  let dash = 0, stagDx = 0, orrinDx = 0, brace = false, stagFrame = 0;
  const D = Math.max(6, Math.min(30, GAP - 4)); // columns Orrin dashes: 6 on a normal screen
  let arcAge = -1, swingHit = -1, contactAt = -1, ring = -1;
  if (inFight) {
    if (plan(turn) === 'swing') {
      brace = u >= 0.6 && u < 1.9;
      dash = u < 1.4 ? Math.round(D * stepped(u, 0.6, 1.0, 4)) : Math.round(D * (1 - stepped(u, 1.4, 1.8, 4)));
      if (u >= 0.9 && u < 1.7) arcAge = u - 0.9;
      if (u >= HIT_AT) swingHit = u - HIT_AT;
      // the recoil: 2 columns for 0.6 s, then home in two steps
      if (swingHit >= 0 && swingHit < 1.2) stagDx = swingHit < 0.6 ? 2 : swingHit < 0.9 ? 1 : 0;
    }
    // the stag's turn: paws 2.2 to 2.8, charges 2.8 to 3.2 (four columns), pulls back 3.6 to 3.9
    if (u >= 2.2 && u < 2.8) stagFrame = Math.floor((u - 2.2) / 0.2) % 2;
    if (u >= 2.8 && u < 3.2) stagDx -= Math.round(4 * stepped(u, 2.8, 3.2, 4));
    else if (u >= 3.2 && u < 3.6) stagDx -= 4;
    else if (u >= 3.6 && u < 4) stagDx -= Math.round(4 * (1 - stepped(u, 3.6, 3.9, 4)));
    if (u >= CONTACT_AT) contactAt = u - CONTACT_AT;
    if (plan(turn) !== 'shield' && contactAt >= 0 && contactAt < 0.4) orrinDx = -1;
    if (plan(turn) === 'shield' && u >= 2.4 && u < 3.8) ring = u < 3.2 ? stepped(u, 2.4, 3.2, 3) : 1 - stepped(u, 3.2, 3.8, 3);
  }

  // ---- the calm
  const calm = !inFight ? Tc - FIGHT : -1;
  let stage = 0, bow = 0, walkX = 0, narration = false;
  if (calm >= 0) {
    if (calm >= 3.4) stage = Math.min(3, Math.floor((calm - 3.4) / 0.75) + 1) - (calm >= 6.4 ? 0 : 0);
    if (calm >= 6.4) { bow = 1; narration = true; }
    if (calm >= 8) { bow = 0; walkX = Math.floor((calm - 8) / 0.2); narration = true; }
  }
  const stagX = P.sx0 + stagDx + walkX - bow;
  const stagY = P.sy + bow;
  const stagGone = stagX > W;

  // reveal at the start of each loop: the two figures come in cell by cell over a second
  const reveal = Tc < 1 && cycle > 0 ? Tc : 1;
  const keep = reveal >= 1 ? null : (x, y) => rand(rs + 21, x, y) < reveal;

  // ---- the figures (a hit lifts the creature's own cells two shades, nothing else)
  const stagGlow = swingHit >= 0 ? glowLevel(swingHit) : 0;
  const orrinGlow = contactAt >= 0 && plan(turn) !== 'shield' ? glowLevel(contactAt) : 0;
  const ox = P.ox0 + dash + orrinDx;
  if (!stagGone) {
    const cool = [{}, { e: 'f' }, { e: 'h', f: 'h' }, { e: 'h', f: 'h' }][stage];
    const shade = stage >= 3 ? 1 : stage === 2 ? 2 : 1 + stagGlow;
    drawStag(cv, stagX, stagY, stagFrame, { shade: Math.min(3, shade), remap: cool, keep: keep || undefined });
  }
  drawOrrin(cv, ox, P.oy, brace ? 'brace' : Math.floor(Tc / 0.5) & 1, { shade: Math.min(3, 1 + orrinGlow), keep: keep || undefined });
  const lantern = brace ? ORRIN_BRACE_LANTERN : ORRIN_LANTERN;
  const lx = ox + lantern.x, ly = P.oy + lantern.y;
  put(cv, lx, ly, cp('●'), GOLD[3]);

  // ---- the lantern arc: three glyphs, drawn over 0.3 s, faded over 0.5 s
  if (arcAge >= 0) {
    const arc = '╱─╲';
    const shade = arcAge < 0.3 ? 3 : Math.max(0, 3 - Math.floor((arcAge - 0.3) / 0.15));
    const ax = ox + ORRIN_W + 1;
    for (let i = 0; i < 3; i++) if (arcAge >= i * 0.1) put(cv, ax + i, P.oy + 1, cp(arc[i]), GOLD[shade]);
  }

  // ---- embers scatter from the stag, and the damage number floats up (a swing's hit), 1 s each
  if (swingHit >= 0 && swingHit < 1) {
    const ex = stagX + 5, ey = stagY + 2;
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + ((i - 3.5) / 3.5) * 1.3 + (rand(rs + 41, turn, i) - 0.5) * 0.3;
      const sp = 7 + 9 * rand(rs + 43, turn, i);
      const px = ex + Math.cos(a) * sp * swingHit;
      const py = ey + Math.sin(a) * sp * 0.5 * swingHit + 5 * swingHit * swingHit;
      const shade = 3 - Math.min(3, Math.floor(swingHit / 0.25));
      put(cv, px, py, swingHit < 0.4 ? cp('·') : cp('°'), EMBER[shade]);
    }
    text(cv, stagX + 6, stagY - 1 - Math.floor(swingHit * 3), String(STAG_DAMAGE), PARCH[3 - Math.min(3, Math.floor(swingHit / 0.3))]);
  }
  if (contactAt >= 0 && contactAt < 1 && plan(turn) !== 'shield' && inFight) {
    text(cv, ox + 2, P.oy - 1 - Math.floor(contactAt * 3), String(ORRIN_DAMAGE), EMBER[3 - Math.min(3, Math.floor(contactAt / 0.3))]);
  }

  // ---- the shield: a ring of o glyphs round Orrin that rises and fades
  if (ring > 0) {
    const shade = Math.max(0, Math.min(3, Math.round(ring * 3)));
    const rx0 = ox - 2, rx1 = ox + ORRIN_W + 1, ry0 = P.oy - 1, ry1 = P.oy + ORRIN_H;
    for (let x = rx0; x <= rx1; x += 2) { put(cv, x, ry0, cp('○'), STONE[shade]); put(cv, x, ry1, cp('○'), STONE[shade]); }
    for (let y = ry0 + 1; y < ry1; y++) { put(cv, rx0, y, cp('○'), STONE[shade]); put(cv, rx1, y, cp('○'), STONE[shade]); }
  }

  // ---- Pim: round the lantern, and in the calm across to the stag
  const beat = Math.floor(Tc / 0.25);
  let px = lx + ORBIT[beat & 7][0], py = ly + ORBIT[beat & 7][1];
  if (calm >= 1.2 && !stagGone) {
    const f = stepped(calm, 1.2, 3.4, 8);
    const hx = stagX + 3, hy = stagY - 1;
    const bx = Math.round(lx + (hx - lx) * f), by = Math.round(ly + (hy - ly) * f);
    px = bx + (f >= 1 ? ORBIT[beat & 7][0] : 0); py = by + (f >= 1 ? ORBIT[beat & 7][1] : 0);
  }
  if (!(calm >= 1.2 && stagGone)) drawPim(cv, px, py, beat);

  // ---- the command box
  const labels = OPTIONS.map((o) => '  ' + o);
  const boxText = labels.join('    ');
  const bw = boxText.length + 4;
  const bx0 = Math.max(0, Math.floor((W - bw) / 2));
  const by0 = H - P.boxRows;
  if (P.tall) {
    const box = '╔═╗║╝═╚║';
    fillRect(cv, bx0, by0, bw, 3, 32, 0);
    for (let i = 1; i < bw - 1; i++) { put(cv, bx0 + i, by0, cp(box[1]), STONE[1]); put(cv, bx0 + i, by0 + 2, cp(box[5]), STONE[1]); }
    put(cv, bx0, by0 + 1, cp(box[7]), STONE[1]); put(cv, bx0 + bw - 1, by0 + 1, cp(box[3]), STONE[1]);
    put(cv, bx0, by0, cp(box[0]), STONE[1]); put(cv, bx0 + bw - 1, by0, cp(box[2]), STONE[1]);
    put(cv, bx0, by0 + 2, cp(box[6]), STONE[1]); put(cv, bx0 + bw - 1, by0 + 2, cp(box[4]), STONE[1]);
  }
  const rowY = P.tall ? by0 + 1 : by0;
  if (narration) {
    const nx = Math.max(0, Math.floor((W - NARRATION.length) / 2));
    text(cv, nx, rowY, NARRATION, PARCH[3]);
  } else {
    const prev = turn === 0 ? 0 : OPT_OF[plan(turn - 1)];
    const target = OPT_OF[plan(turn)];
    const steps = Math.floor(u / 0.2);
    const cur = prev + Math.sign(target - prev) * Math.min(Math.abs(target - prev), steps);
    const gold = u < 0.6 ? 0 : stepped(u, 0.6, 1.0, 3);
    let x = bx0 + 2;
    OPTIONS.forEach((o, i) => {
      const chosen = i === target && u >= 0.6;
      const colour = chosen ? [PARCH[2], GOLD[1], GOLD[2], GOLD[3]][Math.round(gold * 3)] : i === cur ? PARCH[3] : DIM;
      if (i === cur) put(cv, x, rowY, cp('▶'), GOLD[3]);
      text(cv, x + 2, rowY, o, colour);
      x += o.length + 6;
    });
  }
}

cinderhorn.id = 'cinderhorn';
cinderhorn.kind = 'cells';
export default cinderhorn;
