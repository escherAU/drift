// B3. Late Caller: the cut scene, as a cells scene. A late-night radio call on 88.1 Moonlow FM (Rae Vesper on the air, Danny calling from
// Exit 4), typed one card at a time into a heavy-lined box over a dim view of the road from the driver's seat. 75 s of scene time (the tape
// gives this one track a `seconds` of 75; the rest are 90).
//
//   cards      nine, 511 characters in all (the speakers' names are not counted). A card types at 30 characters a second; the first begins at
//              1.5 s; each is held for 6 s after its last character, and the next card begins then. The script is complete at 66.53 s; the last
//              card holds to 75 s. A card is wrapped whole before it is typed, so a character never moves once it has appeared. When the next
//              card begins, what is left of the old one is wiped away in reading order at 120 characters a second (under 0.75 s) while the new
//              one types over it: a whole card vanishing in one frame would be a fifth of a small window
//   arrow      a ▼ on a finished card that another follows (cards 1 to 8, never the last): magenta shade 1, 2, 3, 2 and round again, 0.375 s
//              a shade, a 1.5 s cycle, so a 4x frame (0.222 s) never spans two steps
//   speakers   a name in cyan 3 over RAE's and Danny's lines (CALLER); the station ident and the closing card are the narrator: dim, no name
//   road       the lane dashes (┃, sun 0) coming at the A1 pace (lib/road.js) and the road edges, wherever the box and the dashboard leave room
//   radio      on the dashboard: 88.1 MOONLOW FM in mint 3 and a tuning bar with its needle
//   band       a streetlight sweeps the dashboard every 3 s: a 6-column band in far silhouette over the near one, a column per 0.04 s (25 columns a
//              second: at 4x that is 5.5 columns a frame), only on the dashboard's solid cells (the radio and deck are cut out) and, in the
//              compact layout, only on its top two rows, because over all five a 4x frame at 80x24 came to 5.4%
//   deck       Ingrid's cassette deck under the radio: two reels whose spinner steps every 0.25 s, and a row of VU bars, 3 rows high, every 0.25 s;
//              the bars take their colour from their row (sun at the foot, tang, coral at the top) and only their height changes, so no cell ever
//              changes colour
//
// Compact rule (anything under 100 columns or 32 rows, such as 80x24): the box is 70 wide, the radio 2 rows and unboxed. The deck is kept where
// the rows allow it (it fits at 80x24). Under 40 columns or 18 rows the picture is blank.
// kind 'cells'. Pure in (t, w, h, seed): the seed sets the phases of the VU bars; t0 in params shifts the scene's own clock. The still part of the picture is drawn once per (w, h) and
// copied in. The background is never drawn: a blank cell is a space in colour 0.
import { rand } from '../../../src/scenes/util.js';
import { canvas, clear, put, text } from '../lib/canvas.js';
import { sceneTime, seedOf } from '../lib/clock.js';
import { SUN, TANG, CORAL, MAG, CYAN, MINT, TEXT, DIM, FAR, NEAR } from '../lib/palette.js';
import { geometry as roadGeometry, edgeL, edgeR, dashRow, laneX, DASH_COUNT } from '../lib/road.js';
import { WHEEL_FRAMES } from '../lib/sprites.js';

// Breakpoints, widest first; a window gets the first layout it is at least as big as.
export const LAYOUTS = Object.freeze([
  Object.freeze({ name: 'full', minCols: 100, minRows: 32 }),
  Object.freeze({ name: 'compact', minCols: 0, minRows: 0 }),
]);
export function layoutFor(w, h) {
  return LAYOUTS.find((l) => w >= l.minCols && h >= l.minRows) || LAYOUTS[LAYOUTS.length - 1];
}

export const MIN_W = 40, MIN_H = 18; // under this the window is too small for the picture, and stays blank
export const SCENE_SECONDS = 75;
export const CPS = 30, FIRST_START = 1.5, HOLD = 6; // characters a second; when the first card begins; seconds a finished card is held
export const ERASE_CPS = 120, ERASE_SECONDS = 0.75; // the wipe of the old card: characters a second; an upper bound on its length
export const ARROW_CYCLE = 1.5;
export const BAND_PERIOD = 3, BAND_STEP = 0.04, BAND_WIDTH = 6;
export const REEL_STEP = 0.25, VU_STEP = 0.25;
const COMPACT_BAND_ROWS = 2; // the band only lights the top two rows of a small dashboard (at 80x24 4x a band over all five was a 5.4% frame)
const cp = (ch) => ch.codePointAt(0);

// ---- the script (the design's "The script", unchanged): who says it, and the line. The narrator has no name.
export const CARDS = Object.freeze([
  { who: 'narrator', name: null, text: "88.1 MOONLOW FM. It's 2:14, and you're still out there." },
  { who: 'rae', name: 'RAE', text: "This is Rae Vesper. Lines are open, the coffee's cold, and the coast road is all yours." },
  { who: 'rae', name: 'RAE', text: "Caller, you're on the air." },
  { who: 'caller', name: 'CALLER', text: "Hi Rae. It's Danny, out by Exit 4. I've been driving since sundown. I don't want to stop." },
  { who: 'rae', name: 'RAE', text: "Then don't. The night will wait for you." },
  { who: 'caller', name: 'CALLER', text: 'Is it strange that this feels more like home than home?' },
  { who: 'rae', name: 'RAE', text: 'Not on this station, Danny. Not at this hour.' },
  { who: 'rae', name: 'RAE', text: "Here's one for everyone with the windows down. Side B. Keep your lights on." },
  { who: 'narrator', name: null, text: 'The tape clicks over. The road goes on.' },
].map((c) => Object.freeze(c)));
const LENS = CARDS.map((c) => [...c.text].length);
export const TOTAL_CHARS = LENS.reduce((a, b) => a + b, 0);

// When each card begins, when its last character is typed, and when the next begins (seconds of scene time).
export function cardTimes() {
  const out = [];
  let s = FIRST_START;
  for (let k = 0; k < CARDS.length; k++) {
    const end = s + LENS[k] / CPS;
    out.push({ start: s, end, next: end + HOLD });
    s = end + HOLD;
  }
  return out;
}
const TIMES = cardTimes();

// Greedy word wrap of a whole card: the lines, with one space between lines dropped. Line j starts at character index
// sum(len of earlier lines + 1).
export function wrapCard(str, width) {
  const lines = [];
  let cur = '';
  for (const word of str.split(' ')) {
    if (cur === '') cur = word;
    else if ([...cur].length + 1 + [...word].length <= width) cur += ' ' + word;
    else { lines.push(cur); cur = word; }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

// ---- where everything stands in a window of w x h (plain numbers)
export function geometry(w, h) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const L = layoutFor(W, H);
  const out = { W, H, layout: L.name, ok: W >= MIN_W && H >= MIN_H };
  if (!out.ok) return out;
  const full = L.name === 'full';
  const lb = Math.round(H * 0.125);
  const c0 = lb + 1, c1 = H - 2 - lb; // the rows between the two rules
  const boxW = full ? 80 : Math.min(70, W - 2);
  const margin = full ? 3 : 2;
  const tw = boxW - 2 - 2 * margin;
  const maxLines = Math.max(...CARDS.map((c) => wrapCard(c.text, tw).length));
  const lines = full ? Math.max(4, maxLines) : maxLines;
  const radioRows = full ? 4 : 2, radioW = full ? 40 : Math.min(40, W - 4);
  let pick = null;
  for (const tr of [{ pad: 1, deck: true }, { pad: 1, deck: false }, { pad: 0, deck: false }]) {
    const boxH = (tr.pad ? lines + 5 : lines + 2) + 2;
    const stackTop = c1 - (radioRows + (tr.deck ? 3 : 0)) + 1;
    pick = { ...tr, boxH, stackTop, maxTop: stackTop - 1 - boxH };
    if (pick.maxTop >= c0) break;
  }
  const boxTop = Math.max(c0, Math.min(full ? Math.round(H * 0.3) : c0 + 1, pick.maxTop));
  const bx = (W - boxW) >> 1;
  const ty = boxTop + (pick.pad ? 4 : 2);
  const rx = (W - radioW) >> 1;
  const dw = full ? 80 : boxW;
  Object.assign(out, {
    lb, topRule: lb, botRule: H - 1 - lb, c0, c1,
    box: { x: bx, y: boxTop, w: boxW, h: pick.boxH, tx: bx + 1 + margin, ty, tw, lines, nameX: bx + 1 + margin, nameY: boxTop + (pick.pad ? 2 : 1), arrowX: bx + boxW - 4, arrowY: ty + lines },
    radio: { x: rx, y: pick.stackTop, w: radioW, h: radioRows },
    dash: { x: (W - dw) >> 1, y: pick.stackTop, w: dw, h: c1 - pick.stackTop + 1 },
    deck: null,
  });
  if (pick.deck) {
    const dy = pick.stackTop + radioRows;
    out.deck = {
      x: rx, y: dy, w: radioW, h: 3,
      reels: [{ x: rx + 1, y: dy }, { x: rx + radioW - 6, y: dy }],
      vu: { x: rx + 8, y: dy, h: 3, w: radioW - 16, bars: Math.floor((radioW - 16 + 1) / 2) },
    };
  }
  return out;
}

// ---- the still picture, per (w, h)
const memo = new Map();
function planOf(W, H) {
  const key = W + 'x' + H;
  let p = memo.get(key);
  if (p) return p;
  p = buildPlan(W, H);
  memo.set(key, p);
  if (memo.size > 6) memo.delete(memo.keys().next().value);
  return p;
}

const inBox = (g, x, y) => x >= g.box.x && x < g.box.x + g.box.w && y >= g.box.y && y < g.box.y + g.box.h;

function buildPlan(W, H) {
  const g = geometry(W, H);
  const n = W * H;
  const sg = new Uint16Array(n).fill(32), sc = new Uint8Array(n);
  const cv = canvas(sg, sc, W, H);
  const full = g.layout === 'full';
  const rg = roadGeometry(W, H);

  // the road's edges, where the box and the dashboard leave room
  for (let r = Math.max(g.c0, rg.horizon + 1); r < g.dash.y; r++) {
    const xl = edgeL(rg, r), xr = edgeR(rg, r);
    if (!inBox(g, xl, r)) put(cv, xl, r, cp('╱'), CYAN[0]);
    if (!inBox(g, xr, r)) put(cv, xr, r, cp('╲'), CYAN[0]);
  }

  // the dashboard: solid near silhouette, with the radio and the deck cut out of it
  const d = g.dash;
  for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) put(cv, x, y, cp('█'), NEAR);
  const rd = g.radio;
  for (let y = rd.y; y < rd.y + rd.h + (g.deck ? 3 : 0); y++) for (let x = rd.x; x < rd.x + rd.w; x++) put(cv, x, y, 32, 0);
  if (full) {
    for (let i = 1; i < rd.w - 1; i++) { put(cv, rd.x + i, rd.y, cp('─'), DIM); put(cv, rd.x + i, rd.y + rd.h - 1, cp('─'), DIM); }
    for (let j = 1; j < rd.h - 1; j++) { put(cv, rd.x, rd.y + j, cp('│'), DIM); put(cv, rd.x + rd.w - 1, rd.y + j, cp('│'), DIM); }
    put(cv, rd.x, rd.y, cp('┌'), DIM); put(cv, rd.x + rd.w - 1, rd.y, cp('┐'), DIM);
    put(cv, rd.x, rd.y + rd.h - 1, cp('└'), DIM); put(cv, rd.x + rd.w - 1, rd.y + rd.h - 1, cp('┘'), DIM);
  }
  const ry = full ? rd.y + 1 : rd.y;
  text(cv, rd.x + ((rd.w - 15) >> 1), ry, '88.1 MOONLOW FM', MINT[3]);
  text(cv, rd.x + 4, ry + 1, '▏▎▍▌▋▊▉█▉▊▋▌▍▎▏', CYAN[2]);
  put(cv, rd.x + 4 + 15 + 4, ry + 1, cp('▼'), CORAL[3]); // the needle

  // the deck: the reels' housings (the spinners inside them are drawn per frame)
  if (g.deck) {
    for (const r of g.deck.reels) {
      text(cv, r.x, r.y, '╭───╮', DIM);
      put(cv, r.x, r.y + 1, cp('│'), DIM); put(cv, r.x + 4, r.y + 1, cp('│'), DIM);
      text(cv, r.x, r.y + 2, '╰───╯', DIM);
    }
  }

  // the dialogue box
  const b = g.box;
  for (let i = 1; i < b.w - 1; i++) { put(cv, b.x + i, b.y, cp('━'), MAG[3]); put(cv, b.x + i, b.y + b.h - 1, cp('━'), MAG[3]); }
  for (let j = 1; j < b.h - 1; j++) { put(cv, b.x, b.y + j, cp('┃'), MAG[3]); put(cv, b.x + b.w - 1, b.y + j, cp('┃'), MAG[3]); }
  put(cv, b.x, b.y, cp('┏'), MAG[3]); put(cv, b.x + b.w - 1, b.y, cp('┓'), MAG[3]);
  put(cv, b.x, b.y + b.h - 1, cp('┗'), MAG[3]); put(cv, b.x + b.w - 1, b.y + b.h - 1, cp('┛'), MAG[3]);

  // the letterbox rules
  for (let x = 0; x < W; x++) { put(cv, x, g.topRule, cp('━'), MAG[0]); put(cv, x, g.botRule, cp('━'), MAG[0]); }

  const wraps = CARDS.map((c) => wrapCard(c.text, g.box.tw).map((l) => [...l]));
  return { g, rg, sg, sc, wraps };
}

// The characters from..to-1 of a card, at the places the whole wrapped card puts them.
function drawChars(cv, p, k, from, to, col, spaces) {
  const b = p.g.box;
  let idx = 0;
  const lines = p.wraps[k];
  for (let j = 0; j < lines.length && j < b.lines; j++) {
    const line = lines[j];
    for (let c = Math.max(from, idx); c < Math.min(to, idx + line.length); c++) {
      const ch = line[c - idx];
      if (ch === ' ' && !spaces) continue;
      put(cv, b.tx + c - idx, b.ty + j, cp(ch), col);
    }
    idx += line.length + 1;
  }
}

const ARROW_SHADES = [1, 2, 3, 2];
const VU_COLOURS = [SUN[3], TANG[3], CORAL[3]];
const BARS = '▁▂▃▄▅▆▇';
const level = (b, n, S) => {
  const v = Math.round(12 + 7 * Math.sin(0.6 * n + 6.283 * rand(S + 81, b, 0)) + 4 * Math.sin(1.3 * n + 6.283 * rand(S + 83, b, 0)));
  return v < 0 ? 0 : v > 24 ? 24 : v;
};

function caller(t, w, h, params) {
  const cv = canvas(params.glyphs, params.colours, w, h);
  clear(cv);
  const W = cv.w, H = cv.h;
  if (W < MIN_W || H < MIN_H || cv.g.length < W * H || cv.c.length < W * H) return;
  const T = sceneTime(t, params);
  const S = seedOf(params);
  const p = planOf(W, H);
  const g = p.g;
  cv.g.set(p.sg, 0); cv.c.set(p.sc, 0);

  // the lane dashes coming toward us, where nothing covers them
  for (let line = 1; line <= 2; line++) {
    for (let i = 0; i < DASH_COUNT; i++) {
      const r = dashRow(p.rg, T, i);
      if (r < g.c0 || r >= g.dash.y) continue;
      const x = laneX(p.rg, r, line);
      if (!inBox(g, x, r)) put(cv, x, r, cp('┃'), SUN[0]);
    }
  }

  // the streetlight band over the dashboard's solid cells
  const bandRows = g.layout === 'full' ? g.dash.h : Math.min(g.dash.h, COMPACT_BAND_ROWS);
  const left = Math.floor((T % BAND_PERIOD) / BAND_STEP + 1e-9) - (BAND_WIDTH - 1);
  for (let x = Math.max(0, left); x <= Math.min(g.dash.w - 1, left + BAND_WIDTH - 1); x++) {
    const X = g.dash.x + x;
    if (X >= g.radio.x && X < g.radio.x + g.radio.w) continue;
    for (let y = g.dash.y; y < g.dash.y + bandRows; y++) put(cv, X, y, cp('█'), FAR);
  }

  // the deck
  if (g.deck) {
    const spin = WHEEL_FRAMES[Math.floor(T / REEL_STEP + 1e-9) & 3];
    for (const r of g.deck.reels) text(cv, r.x + 1, r.y + 1, spin, CYAN[2]);
    const n = Math.floor(T / VU_STEP + 1e-9), vu = g.deck.vu;
    for (let b = 0; b < vu.bars; b++) {
      const lvl = level(b, n, S);
      for (let r = 0; r < 3; r++) {
        const e = Math.max(0, Math.min(8, lvl - 8 * r));
        if (e > 0) put(cv, vu.x + 2 * b, vu.y + 2 - r, e === 8 ? cp('█') : cp(BARS[e - 1]), VU_COLOURS[r]);
      }
    }
  }

  // the cards
  let k = -1;
  for (let i = 0; i < TIMES.length; i++) if (T >= TIMES[i].start - 1e-9) k = i;
  if (k < 0) return;
  const colOf = (c) => (c.who === 'narrator' ? DIM : TEXT);
  if (k > 0) {
    const gone = Math.floor((T - TIMES[k].start) * ERASE_CPS + 1e-9);
    if (gone < LENS[k - 1]) drawChars(cv, p, k - 1, gone, LENS[k - 1], colOf(CARDS[k - 1]), false); // what is left of the old card
  }
  const typed = Math.max(0, Math.min(LENS[k], Math.floor((T - TIMES[k].start) * CPS + 1e-9)));
  if (CARDS[k].name) text(cv, g.box.nameX, g.box.nameY, CARDS[k].name, CYAN[3]);
  drawChars(cv, p, k, 0, typed, colOf(CARDS[k]), true);
  if (typed === LENS[k] && k < CARDS.length - 1 && T >= TIMES[k].end) {
    const shade = ARROW_SHADES[Math.floor((((T - TIMES[k].end) % ARROW_CYCLE) / ARROW_CYCLE) * 4 + 1e-9) & 3];
    put(cv, g.box.arrowX, g.box.arrowY, cp('▼'), MAG[shade]);
  }
}

caller.id = 'caller';
caller.kind = 'cells';
export default caller;
