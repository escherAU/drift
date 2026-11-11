// VI. The Lampwarden: the cut scene, 45 s, then the tale loops. A letterboxed picture (empty bars top and bottom) of the dim tower
// room at Highcandle: a round window onto the night, candles on two shelves, a stair climbing the right-hand wall. In front of it a
// dialogue box in Delza's chrome, a portrait panel on its left and the speaker's name set into its top edge.
//
// Why 'cells' and not 'text': a text scene is one centred card of words. This scene needs the portraits, the speaker's name and
// colour, the letterbox and the room behind the box, which only a cells scene can draw.
//
// The story (times from the scene's own start, the lead-in is 4.5 s of candlelight):
//   each line types at 30 characters per second; a `▼` fades in and out once it is complete; the next line follows 3.5 s later
//   the portrait swaps by a 0.5 s cell dissolve when the speaker changes (the narrator has no portrait)
//   Pim's line shows the moth fluttering twice (out, in, out, in, then at rest out; 0.3 s each, after the portrait has dissolved in)
//   from line 5 the Ember Lantern climbs the stair, a step at a time, and reaches the top as the scene ends
//   after the last line has been read, the words fade out over 2 s
//   candle flames flicker one shade at a time, each at its own pace
//
// kind 'cells'. Pure in (t, w, h, seed): time is counted from the scene's own start (params.t0) and wraps at 45 s.
import { rand } from '../../../src/scenes/util.js';
import { canvas, clear, put, text, label, fillRect, glow } from '../lib/canvas.js';
import { sceneTime, seedOf } from '../lib/clock.js';
import { BARK, PARCH, GOLD, STONE, DUSK, DIM } from '../lib/palette.js';

export const CYCLE = 45, LEAD = 4.5, TYPE_CPS = 30, GAP = 3.5, DISSOLVE = 0.5, FADE_OUT = 2, FLUTTER_STEP = 0.3;
export const LINES = Object.freeze([
  { who: 'MAREN', text: 'You came all the way from Lowmarrow?' },
  { who: 'ORRIN', text: 'The lamp on your tower went dark. We saw it from the Reach.' },
  { who: 'MAREN', text: 'Then take the Moonwax Key. The stair has not been climbed in a hundred years.' },
  { who: 'PIM', text: '(flutters twice, which means yes)' },
  { who: null, text: 'Up he went, the Ember Lantern swinging, step after step.' },
  { who: null, text: 'And for the first time in a long while, Highcandle was whole.' },
]);
const cp = (ch) => ch.codePointAt(0);

// When each line starts typing, and when the last has been read and the words fade.
export const STARTS = (() => {
  const s = [LEAD];
  for (let i = 1; i < LINES.length; i++) s.push(s[i - 1] + LINES[i - 1].text.length / TYPE_CPS + GAP);
  return Object.freeze(s);
})();
export const FADE_AT = STARTS[LINES.length - 1] + LINES[LINES.length - 1].text.length / TYPE_CPS + GAP;

// ---- portraits, 12 wide and 7 tall
const pad = (rows) => rows.map((r) => r.padEnd(12));
const MAREN = pad(['   ▄▄▄▄▄    ', '  ▟▓▓▓▓▓▙   ', '  ▓▌· ·▐▓   ', '  ▓▌ ─ ▐▓   ', '  ▓▙▄▄▄▟▓   ', ' ▟▓▓▓◆▓▓▓▙  ', '▐▓▓▓▓▓▓▓▓▓▓▌']);
const ORRIN = pad(['   ▄▄▄      ', '  ▟███▙     ', '  █· ·█     ', '  ▐ ─ ▌  ●  ', '  ▝▙▄▟▘  │  ', ' ▟▓▓▓▓▓▙ │  ', '▐▓▓▓▓▓▓▓▌│  ']);
const PIM_OUT = pad(['            ', '  ▄▄    ▄▄  ', ' ▟██▙▐▌▟██▙ ', '▐████▐▌████▌', ' ▜██▛▐▌▜██▛ ', '  ▀▀ ▐▌ ▀▀  ', '     ╱╲     ']);
const PIM_IN = pad(['            ', '            ', '     ▄▄     ', '    ▟██▙    ', '    ▐██▌    ', '    ▝▐▌▘    ', '     ╱╲     ']);
export const PORTRAITS = Object.freeze({ MAREN, ORRIN, PIM_OUT, PIM_IN });
const TINT = { MAREN: DUSK[2], ORRIN: STONE[2], PIM: PARCH[3] };
function portraitOf(who, T) {
  if (who === 'MAREN') return MAREN;
  if (who === 'ORRIN') return ORRIN;
  if (who === 'PIM') {
    const k = Math.floor((T - STARTS[3] - DISSOLVE) / FLUTTER_STEP); // the flutter starts once the portrait has dissolved in
    return k >= 0 && k < 4 && (k & 1) ? PIM_IN : PIM_OUT;
  }
  return null;
}
function portraitColour(who, ch) {
  if (ch === '·' || ch === '─') return PARCH[3];
  if (ch === '◆' || ch === '●') return GOLD[3];
  if (ch === '│') return BARK[2];
  if (ch === '╱' || ch === '╲') return DUSK[3];
  return TINT[who];
}

// Greedy word wrap.
export function wrap(str, width) {
  const rows = [];
  let row = '';
  for (const word of String(str).split(' ')) {
    if (row && row.length + 1 + word.length > width) { rows.push(row); row = word; }
    else row = row ? row + ' ' + word : word;
  }
  if (row) rows.push(row);
  return rows;
}

export function layoutOf(w, h) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const lb = H >= 30 ? 4 : 2;
  const boxW = Math.min(W - 4, 116), boxH = 9;
  const boxX = Math.floor((W - boxW) / 2), boxY = H - lb - boxH - 1;
  const roomTop = lb, roomBot = boxY - 2; // rows of the room, inclusive
  const roomH = roomBot - roomTop + 1;
  const wh = Math.max(5, Math.min(15, roomH - 3)), ww = wh * 2 + 4;
  const cx = Math.floor(W / 2), wx = cx - Math.floor(ww / 2), wy = roomTop + Math.max(0, Math.floor((roomH - wh) / 2));
  const sx = wx + ww + 14;
  const stairN = Math.max(0, Math.min(roomH - 2, Math.floor((W - 3 - sx) / 2)));
  return { W, H, lb, boxW, boxH, boxX, boxY, roomTop, roomBot, roomH, wh, ww, wx, wy, sx, stairN, hasBox: boxW >= 28 && boxY > lb + 2, textX: boxX + 17, textW: boxW - 20 };
}

// Which line is showing at cycle time Tc (-1 in the lead-in) and how far it has typed.
export function stateAt(Tc) {
  let i = -1;
  for (let k = 0; k < LINES.length; k++) if (Tc >= STARTS[k]) i = k;
  if (i < 0) return { i: -1, typed: 0, done: false, doneAt: 0 };
  const len = LINES[i].text.length;
  const typed = Math.min(len, Math.floor((Tc - STARTS[i]) * TYPE_CPS + 1e-9));
  return { i, typed, done: typed >= len, doneAt: STARTS[i] + len / TYPE_CPS };
}

function lampwarden(t, w, h, params) {
  const cv = canvas(params.glyphs, params.colours, w, h);
  clear(cv);
  const W = cv.w, H = cv.h;
  if (W === 0 || H === 0) return;
  const S = seedOf(params);
  const Tc = sceneTime(t, params) % CYCLE;
  const L = layoutOf(W, H);

  // ---- the room: old stone, a shelf of candles each side of the window, the stair
  for (let y = L.roomTop; y <= L.roomBot; y++) for (let x = 0; x < W; x++) if (rand(S + 31, x, y) < 0.2) put(cv, x, y, cp('░'), STONE[0]);

  // the round window onto the night
  const { wx, wy, ww, wh } = L;
  if (L.roomH >= 5 && W >= ww + 2) {
    fillRect(cv, wx, wy, ww, wh, 32, 0);
    const top = '╭' + '─'.repeat(ww - 6) + '╮';
    text(cv, wx + 2, wy, top, STONE[2]);
    text(cv, wx + 2, wy + wh - 1, '╰' + '─'.repeat(ww - 6) + '╯', STONE[2]);
    text(cv, wx, wy + 1, '╭─╯', STONE[2]); text(cv, wx + ww - 3, wy + 1, '╰─╮', STONE[2]);
    text(cv, wx, wy + wh - 2, '╰─╮', STONE[2]); text(cv, wx + ww - 3, wy + wh - 2, '╭─╯', STONE[2]);
    for (let y = wy + 2; y <= wy + wh - 3; y++) { put(cv, wx, y, cp('│'), STONE[2]); put(cv, wx + ww - 1, y, cp('│'), STONE[2]); }
    for (let y = wy + 1; y <= wy + wh - 2; y++) {
      const edge = y === wy + 1 || y === wy + wh - 2;
      for (let x = wx + (edge ? 3 : 1); x <= wx + ww - (edge ? 4 : 2); x++) if (rand(S + 33, x, y) < 0.07) put(cv, x, y, cp('·'), PARCH[1]);
    }
    put(cv, wx + Math.floor(ww * 0.68), wy + 2, cp('●'), PARCH[2]);
    // sill
    for (let x = wx - 1; x <= wx + ww; x++) put(cv, x, wy + wh, cp('▀'), BARK[1]);
  }

  // candles: three on each shelf; flames take one shade at a time, each candle at its own pace
  const shelfY = Math.min(L.roomBot, wy + wh - 1);
  [[wx - 14, 1], [wx + ww + 3, 2]].forEach(([sx0, side]) => {
    for (let x = sx0; x < sx0 + 11; x++) put(cv, x, shelfY + 1, cp('▀'), BARK[1]);
    for (let k = 0; k < 3; k++) {
      const x = sx0 + 1 + k * 4 + (side === 1 ? 1 : 0);
      const tall = 1 + ((k + side) % 2);
      for (let r = 0; r < tall; r++) put(cv, x, shelfY - r, cp('█'), PARCH[2]);
      const phase = Math.floor(Tc * 2.5 + rand(S + 35, k, side) * 4 + k * 0.7 + side);
      put(cv, x, shelfY - tall, cp('▲'), GOLD[[2, 3, 2, 1][phase & 3]]);
    }
  });

  // the stair, and the lantern that climbs it from line 5 on
  if (L.stairN >= 3) {
    for (let i = 0; i < L.stairN; i++) { put(cv, L.sx + 2 * i, L.roomBot - i, cp('▄'), BARK[1]); put(cv, L.sx + 2 * i + 1, L.roomBot - i, cp('▄'), BARK[1]); }
    if (Tc >= STARTS[4]) {
      const step = Math.min(L.stairN - 1, Math.floor(((Tc - STARTS[4]) / (CYCLE - 1 - STARTS[4])) * L.stairN));
      const lx = L.sx + 2 * step + 1, ly = L.roomBot - step - 1;
      glow(cv, lx, ly, 3, 1.5, 1);
      put(cv, lx, ly, cp('●'), GOLD[3]);
    }
  }

  if (!L.hasBox) return;

  // ---- the dialogue box in Delza's chrome
  const { boxX, boxY, boxW } = L;
  const bc = GOLD[2];
  fillRect(cv, boxX, boxY, boxW, L.boxH, 32, 0);
  const divX = boxX + 15;
  for (let x = boxX + 1; x < boxX + boxW - 1; x++) { put(cv, x, boxY, cp(x === divX ? '╦' : '═'), bc); put(cv, x, boxY + 8, cp(x === divX ? '╩' : '═'), bc); }
  put(cv, boxX, boxY, cp('◆'), bc); put(cv, boxX + boxW - 1, boxY, cp('◆'), bc);
  put(cv, boxX, boxY + 8, cp('◆'), bc); put(cv, boxX + boxW - 1, boxY + 8, cp('◆'), bc);
  for (let y = boxY + 1; y <= boxY + 7; y++) { put(cv, boxX, y, cp('║'), bc); put(cv, divX, y, cp('║'), bc); put(cv, boxX + boxW - 1, y, cp('║'), bc); }

  const st = stateAt(Tc);
  const line = st.i >= 0 ? LINES[st.i] : null;
  const faded = Tc >= FADE_AT;

  // portrait, dissolving from the last speaker's by cells over DISSOLVE seconds
  if (line) {
    const prev = st.i > 0 ? LINES[st.i - 1].who : null;
    const u = Math.min(1, (Tc - STARTS[st.i]) / DISSOLVE);
    const now = portraitOf(line.who, Tc), was = portraitOf(prev, STARTS[st.i] - 0.01);
    const px = boxX + 2, py = boxY + 1;
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 12; c++) {
        const useNew = u >= 1 || rand(S + 43, c, r) < u;
        const art = useNew ? now : was;
        const who = useNew ? line.who : prev;
        const ch = art ? art[r][c] : ' ';
        if (ch !== ' ') put(cv, px + c, py + r, cp(ch), portraitColour(who, ch));
      }
    }
    // the name set into the top edge
    if (line.who) {
      const nm = '╡ ' + line.who + ' ╞';
      label(cv, L.textX, boxY, nm, bc);
      text(cv, L.textX + 2, boxY, line.who, line.who === 'MAREN' ? GOLD[3] : line.who === 'ORRIN' ? STONE[3] : PARCH[3]);
    }
    // the words, wrapped on the whole line so nothing reflows while it types
    const rows = wrap(line.text, L.textW);
    const base = faded ? PARCH[Math.max(0, 3 - Math.floor(((Tc - FADE_AT) / FADE_OUT) * 4))] : line.who === null ? DIM : line.who === 'PIM' ? PARCH[2] : PARCH[3];
    const colour = faded && Tc - FADE_AT >= FADE_OUT ? 0 : base;
    let left = st.typed;
    for (let r = 0; r < rows.length && left > 0; r++) {
      const shown = rows[r].slice(0, left);
      if (colour !== 0) text(cv, L.textX, boxY + 2 + r, shown, colour);
      left -= rows[r].length + 1;
    }
    // the prompt that the line is whole
    if (st.done && !faded) {
      const ph = ((Tc - st.doneAt) % 1.6) / 1.6;
      put(cv, boxX + boxW - 4, boxY + 7, cp('▼'), GOLD[[0, 1, 2, 3, 2, 1][Math.floor(ph * 6)]]);
    }
  }
}

lampwarden.id = 'lampwarden';
lampwarden.kind = 'cells';
export default lampwarden;
