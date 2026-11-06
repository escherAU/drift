// Experimental / artist: sketches ASCII pictures stroke by stroke, as if by hand. A bright
// pen cell leads and the new strokes fade to the piece's resting brightness; the finished
// piece is held, then erased (wiped in reverse stroke order, or dissolved cell by cell,
// alternating), the screen rests, and the next piece of the gallery begins. Forever.
//
// kind 'cells', pure in t. The pieces live in src/art/pieces/*.txt and the drawing maths in
// src/art/engine.js. A piece that does not fit the terminal is skipped; if none fit, the
// screen stays blank. The seed rotates which piece comes first. Colour index = brightness
// level 2..15 of the single-hue calm palette.
import { PIECES } from '../art/gallery.js';
import { buildPlan, paintPiece } from '../art/engine.js';

export const HOLD_SEC = 8; // the finished piece stays
export const ERASE_SEC = 4.5; // wipe or dissolve
export const REST_SEC = 1.5; // empty screen between pieces

// The play list for a grid: the gallery rotated by the seed, minus pieces that do not fit.
// Each entry has its start second within the cycle and the ends of its phases.
export function timeline(pieces, w, h, seed = 1) {
  const n = pieces.length;
  const rot = n ? ((seed | 0) % n + n) % n : 0;
  const list = [];
  let at = 0;
  for (let k = 0; k < n; k++) {
    const piece = pieces[(rot + k) % n];
    if (piece.width > w || piece.height > h || piece.cells.length === 0) continue;
    const draw = buildPlan(piece).drawSec;
    const drawEnd = at + draw, holdEnd = drawEnd + HOLD_SEC, eraseEnd = holdEnd + ERASE_SEC, end = eraseEnd + REST_SEC;
    list.push({ piece, start: at, drawEnd, holdEnd, eraseEnd, end });
    at = end;
  }
  return { list, period: at };
}

let cache = { key: '', value: null };
function timelineFor(w, h, seed) {
  const key = `${w}x${h}:${seed}:${PIECES.length}`;
  if (cache.key !== key) cache = { key, value: timeline(PIECES, w, h, seed) };
  return cache.value;
}

// Which phase the cycle is in at time t. Exported for the tests.
//   { index (position in the play list), seq (pieces shown since t = 0), phase, sec, piece }
export function stateAt(tl, t) {
  if (tl.list.length === 0 || !(tl.period > 0)) return null;
  const T = Number.isFinite(t) && t > 0 ? t : 0;
  const lap = Math.floor(T / tl.period);
  const pos = T - lap * tl.period;
  let index = tl.list.length - 1;
  for (let i = 0; i < tl.list.length; i++) if (pos < tl.list[i].end) { index = i; break; }
  const e = tl.list[index];
  const seq = lap * tl.list.length + index;
  const eraseStyle = seq % 2 === 0 ? 'wipe' : 'dissolve';
  let phase, sec;
  if (pos < e.drawEnd) { phase = 'draw'; sec = pos - e.start; }
  else if (pos < e.holdEnd) { phase = 'hold'; sec = pos - e.drawEnd; }
  else if (pos < e.eraseEnd) { phase = eraseStyle; sec = pos - e.holdEnd; }
  else { phase = 'rest'; sec = pos - e.eraseEnd; }
  return { index, seq, phase, sec, piece: e.piece };
}

export default function artist(t, w, h, params) {
  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
  const g = params.glyphs, c = params.colours;
  g.fill(32);
  c.fill(0);
  if (W === 0 || H === 0) return;
  const seed = Number.isFinite(params.seed) ? params.seed | 0 : 1;
  const st = stateAt(timelineFor(W, H, seed), t);
  if (!st || st.phase === 'rest') return;
  const p = st.piece;
  paintPiece(p, st.phase, st.sec, ERASE_SEC, {
    glyphs: g, colours: c, cols: W, x0: Math.floor((W - p.width) / 2), y0: Math.floor((H - p.height) / 2),
  });
}
artist.id = 'artist';
artist.kind = 'cells';
