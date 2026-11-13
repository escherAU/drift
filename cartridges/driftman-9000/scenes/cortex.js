// CORTEX: the machine thinking aloud on four floating panes of glass (kind 'cells', rgb: true). The rest between the loud visions: under 5 %
// of the cells change in any frame, and nothing on it ever moves faster than a slow drift.
//
// The panes (glass background #0E1426, edge #4A6AB0, over the skin background #05060C), in a 2 x 2 spread that fits the screen:
//   A  an icosahedron wireframe in braille, turning 0.3 rad/s (about the vertical axis, tilted 0.5 rad), one hue per edge (30 edges, hues
//      spread round the wheel and drifting 4 degrees a second at a lightness that only follows depth, through safeHue);
//   B  a thought trace: a line graph in braille scrolling 2 dots (one column of a cell) every second, a sum of sines and seeded noise;
//   C  a ring of 24 numerals, one of them re-rolled every 0.5 s (the slot goes round the ring in order), lit for 1.2 s after its roll;
//   D  captions typed at 24 characters a second, held 4 s, then erased at 48 a second (a caption never dims, so its contrast stays up),
//      0.5 s of rest, the next; the order is a seeded shuffle of the five captions, a new shuffle every round, never the same caption twice in a row.
// Parallax: each pane of glass sits at x0 + round(2 sin(0.05 t + phase_p)), 2 columns either way (a step ripples down its rows over 0.6 s), sliding over its content (the content sits
// behind the glass, on a layer of its own that does not move, with 2 columns of margin each side so the glass always covers it). A pane that carried
// its whole content along would change a few hundred cells in the frame it steps; the glass alone changes its two side columns.
// Hairline connectors join the panes in a ring A, B, D, C (dashes and rounded corners, in a dim link colour). One ion pulse runs along one connector
// every 3 s (in 2.4 s, fading in and out), the connectors taking turns; the focus edge moves to the next pane of the ring every 8 s: the new pane's
// edge lights and the old one's dims in a sweep once round the border over 1 s, a cell at a time (each border cell steps once, so a pane's
// whole edge never changes in a single frame).
//
// Layout: the composition is at most 132 x 44 cells, centred; below 60 x 20 it is the dim centred message "This vision needs 60 x 20.".
// The colour clock (DRIFT-8 C3): the 4 degrees a second the icosahedron's edge hues drift reads TC = colourTime(t, params); the turning, the panes, the trace,
// the ring and the captions keep scene time T.
//
// Pure in (seed, T, TC) with T = t - t0 and TC = tc - tc0. The only state is caches that are functions of their keys (the layout and buffers for a size, the caption
// shuffle for a round) and are never mutated by a frame in a way it can see. No allocation per frame.
import { safeHue } from '../../../src/pixels.js';
import { sceneTime, colourTime, seedOf } from '../lib/clock.js';
import { hash1 } from '../lib/huefield.js';

export const MIN_W = 60, MIN_H = 20;
export const MESSAGE = 'This vision needs 60 x 20.';
export const BG = 0x05060c, PANE_BG = 0x0e1426, EDGE = 0x4a6ab0, EDGE_FOCUS = 0x7e9ce0, LINK = 0x2a3a68;
const DIM = 0x5a6a94; // the message: dim mist
const RGB_CELL = 255;

export const PANE_COUNT = 4; // A, B, C, D
export const RING = Object.freeze([0, 1, 3, 2]); // the ring of panes (A, B, D, C): connector c joins RING[c] to RING[c + 1]
export const PARALLAX_AMP = 2, PARALLAX_RATE = 0.05;
export const PARALLAX_PHASE = Object.freeze([0, 0.93, 2.2, 1.86]); // chosen so that no two panes' one-column steps come within 3.18 s of each other (searched)
export const INSET = 2; // columns of glass the content keeps clear on each side: the glass slides over its content by up to 2 columns
export const ICO_RATE = 0.3, ICO_TILT = 0.5, ICO_HUE_RATE = 4;
export const TRACE_SPEED = 2; // dots a second
export const RING_N = 24, ROLL = 0.5, LIT = 1.2;
export const CAPTIONS = Object.freeze([
  'COMPOSING A COLOUR NO ONE HAS NAMED',
  'RECALLING 0.318 OF A DREAM',
  'FOLDING LIGHT ALONG ITS LONGEST AXIS',
  'COUNTING THE STARS AGAIN. SAME NUMBER.',
  'LISTENING. NOTHING YET. LISTENING.',
]);
export const TYPE_CPS = 24, HOLD = 4, ERASE_CPS = 48, REST = 0.5;
export const PULSE_PERIOD = 3, PULSE_TRAVEL = 2.4, FOCUS_PERIOD = 8, FOCUS_SWEEP = 1;
export const MAX_W = 132, MAX_H = 44;
const TAU = Math.PI * 2;
const CURSOR = 0x258c, DASH_H = 0x254c, DASH_V = 0x254e;
const BORDER = Object.freeze({ tl: 0x256d, tr: 0x256e, bl: 0x2570, br: 0x256f, h: 0x2500, v: 0x2502 });
const BRAILLE_BIT = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80]; // indexed row * 2 + column of the dot in its cell

export function smoothstep(a, b, x) {
  const u = (x - a) / (b - a);
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

// ---- the icosahedron

const PHI = (1 + Math.sqrt(5)) / 2;
const NORM = Math.sqrt(1 + PHI * PHI);
export const ICO_V = Object.freeze((() => {
  const v = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) { v.push([0, a / NORM, b * PHI / NORM]); v.push([a / NORM, b * PHI / NORM, 0]); v.push([b * PHI / NORM, 0, a / NORM]); }
  return v.map((p) => Object.freeze(p));
})());
export const ICO_E = Object.freeze((() => {
  const e = [];
  const edge2 = (2 / NORM) ** 2;
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
    const d = (ICO_V[i][0] - ICO_V[j][0]) ** 2 + (ICO_V[i][1] - ICO_V[j][1]) ** 2 + (ICO_V[i][2] - ICO_V[j][2]) ** 2;
    if (Math.abs(d - edge2) < 1e-9) e.push(Object.freeze([i, j]));
  }
  return e;
})());

// The figure turns in steps of 1/6 s (0.05 rad each, 0.3 rad/s on average): moving a wireframe by a fraction of a dot changes nearly every one of its
// cells, so a step every frame would cost the whole figure every frame. The steps fall 1/18 s after the multiples of a third of a second... of a sixth,
// which puts them one frame behind the thought trace's steps (every half second) at every clock phase, so the two never share a frame.
export const ICO_STEPS = 6;
export const icoStep = (T) => Math.floor((T - 1 / 18) * ICO_STEPS + 1e-9);
// The turning angle about the vertical axis at scene time T (seeded start).
export const icoAngle = (seed, T) => TAU * hash1(seed, 0x1c0) + (ICO_RATE * icoStep(T)) / ICO_STEPS;

// Rotated vertices (x, y, z; z towards the viewer) into out[0..35]: a turn about the vertical axis, then the fixed tilt about the horizontal one.
export function rotateIcosa(seed, T, out) {
  const a = icoAngle(seed, T), ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(ICO_TILT), st = Math.sin(ICO_TILT);
  for (let i = 0; i < 12; i++) {
    const v = ICO_V[i];
    const x1 = ca * v[0] + sa * v[2], z1 = -sa * v[0] + ca * v[2];
    out[3 * i] = x1;
    out[3 * i + 1] = ct * v[1] - st * z1;
    out[3 * i + 2] = st * v[1] + ct * z1;
  }
  return out;
}

// The hue of edge e at T (degrees, not wrapped): spread round the wheel, drifting.
// The hue drifts 4 degrees a second in steps of 3 degrees (a hue that changes every frame recolours every cell it is drawn in); each edge has its own
// offset inside the step, so the edges step to a new colour on different frames and never all in one.
export const HUE_STEP = 3, DEPTH_LEVELS = 7;
export const edgeHue = (seed, e, T) => HUE_STEP * Math.floor((360 * hash1(seed, 0x2e0) + 12 * e + HUE_STEP * hash1(seed, 0x2f0 + e) + ICO_HUE_RATE * T) / HUE_STEP);
// the lightness of an edge at depth d (-1 far .. 1 near): 8 levels from 0.50 to 0.74, so a turning edge does not change colour every few frames
export const edgeLightness = (d) => 0.5 + 0.24 * (Math.round((d + 1) * 0.5 * DEPTH_LEVELS) / DEPTH_LEVELS);

// ---- the thought trace

function smooth1(seed, x) {
  const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
  const a = 2 * hash1(seed, 0x300 + (i & 0xffff)) - 1, b = 2 * hash1(seed, 0x300 + ((i + 1) & 0xffff)) - 1;
  return a + (b - a) * s;
}
// The trace at dot column u (it grows without end; the pane scrolls over it): -1..1.
export function traceValue(seed, u) {
  const p1 = TAU * hash1(seed, 0x201), p2 = TAU * hash1(seed, 0x202), p3 = TAU * hash1(seed, 0x203);
  const v = 0.48 * Math.sin(0.11 * u + p1) + 0.3 * Math.sin(0.047 * u + p2) + 0.12 * Math.sin(0.29 * u + p3) + 0.3 * smooth1(seed, u / 5);
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
export const traceScroll = (T) => Math.floor(TRACE_SPEED * T);

// ---- the ring of numerals

// Events (re-rolls) completed by T: event n happens at (n + 1) ROLL and re-rolls slot n mod 24.
export const rollsDone = (T) => Math.floor(T / ROLL + 1e-9);
export function rollsOfSlot(slot, T) {
  const E = rollsDone(T);
  return E > slot ? Math.floor((E - slot - 1) / RING_N) + 1 : 0;
}
// The numeral in slot at T: it starts from a seeded digit and every roll adds 1 to 9 (so a roll always changes it).
export function ringValue(seed, slot, T) {
  let v = Math.floor(10 * hash1(seed, 0x400 + slot));
  const r = rollsOfSlot(slot, T);
  for (let q = 1; q <= r; q++) v = (v + 1 + Math.floor(9 * hash1(seed * 31 + slot, 0x500 + q))) % 10;
  return v;
}
// Seconds since the slot last rolled (a large number if it has not).
export function rollAge(slot, T) {
  const r = rollsOfSlot(slot, T);
  return r === 0 ? 1e9 : T - (slot + RING_N * (r - 1) + 1) * ROLL;
}

// ---- the captions

const durType = (s) => s.length / TYPE_CPS, durErase = (s) => s.length / ERASE_CPS;
export const captionSeconds = (s) => durType(s) + HOLD + durErase(s) + REST;
export const ROUND_SECONDS = CAPTIONS.reduce((a, s) => a + captionSeconds(s), 0);
const orders = new Map(); // seed -> array of rounds (each an array of 5 indices)
export function captionOrder(seed, round) {
  let list = orders.get(seed | 0);
  if (!list) { if (orders.size >= 24) orders.clear(); list = []; orders.set(seed | 0, list); }
  while (list.length <= round) {
    const r = list.length, o = [0, 1, 2, 3, 4];
    for (let j = 4; j > 0; j--) { const k = Math.floor(hash1(seed * 7919 + r, 0x600 + j) * (j + 1)); const t = o[j]; o[j] = o[k]; o[k] = t; }
    if (r > 0 && o[0] === list[r - 1][4]) { const t = o[0]; o[0] = o[1]; o[1] = t; }
    list.push(o);
  }
  return list[round];
}
// out = { index, text, n (characters shown), phase ('type' | 'hold' | 'erase' | 'rest'), start }
export function captionState(seed, T, out) {
  const round = Math.floor(T / ROUND_SECONDS), ord = captionOrder(seed, round);
  let t = T - round * ROUND_SECONDS, start = round * ROUND_SECONDS;
  for (let k = 0; k < 5; k++) {
    const s = CAPTIONS[ord[k]], d = captionSeconds(s);
    if (t < d || k === 4) {
      const len = s.length, tt = t, dt = durType(s), de = durErase(s);
      out.index = ord[k]; out.text = s; out.start = start;
      if (tt < dt) { out.phase = 'type'; out.n = Math.min(len, Math.floor(tt * TYPE_CPS)); }
      else if (tt < dt + HOLD) { out.phase = 'hold'; out.n = len; }
      else if (tt < dt + HOLD + de) { out.phase = 'erase'; out.n = Math.max(0, len - Math.floor((tt - dt - HOLD) * ERASE_CPS)); }
      else { out.phase = 'rest'; out.n = 0; }
      return out;
    }
    t -= d; start += d;
  }
  return out;
}

// ---- pulse and focus

// out = { k (pulse number), conn (connector 0..3), p (0..1 progress along it, or -1 between pulses), amp (0..1) }
export function pulseState(T, out) {
  const k = Math.floor(T / PULSE_PERIOD + 1e-9), tau = T - k * PULSE_PERIOD, p = tau / PULSE_TRAVEL;
  out.k = k; out.conn = k & 3;
  if (p >= 1) { out.p = -1; out.amp = 0; } else { out.p = p; out.amp = smoothstep(0, 0.15, p) * (1 - smoothstep(0.85, 1, p)); }
  return out;
}
// out = { f (ring position 0..3), pane (pane index), tau (seconds into this stretch), prev (pane index that held the focus before, or -1) }
export function focusState(T, out) {
  const n = Math.floor(T / FOCUS_PERIOD + 1e-9);
  out.f = n & 3; out.pane = RING[n & 3]; out.tau = T - n * FOCUS_PERIOD; out.prev = n > 0 ? RING[(n + 3) & 3] : -1;
  return out;
}

// ---- parallax

export const parallaxExact = (i, T) => PARALLAX_AMP * Math.sin(PARALLAX_RATE * T + PARALLAX_PHASE[i]);
export const offsetOf = (i, T) => Math.round(parallaxExact(i, T));
// A one-column step does not happen to a pane's rows at once but runs down it over RIPPLE seconds (row r of h takes its offset RIPPLE r/(h-1) seconds
// late), so the glass ripples one column instead of changing both its side columns in a single frame. At any instant a pane is two straight
// pieces, an upper one at the new offset and a lower one at the old.
export const RIPPLE = 0.6;
export const paneRowOffset = (i, row, h, T) => offsetOf(i, T - (RIPPLE * row) / Math.max(1, h - 1));

// ---- the layout of a size

// panes: base rects { id, x, y, w, h } of A, B, C, D (offsets are added per frame); ring: 24 cells [x, y] relative to the interior of pane C
export function computeLayout(W, H) {
  const bw = Math.min(W, MAX_W), bh = Math.min(H, MAX_H);
  const ox = Math.floor((W - bw) / 2), oy = Math.floor((H - bh) / 2);
  const mx = 2 + Math.round(bw * 0.03), my = 1 + Math.round(bh * 0.07);
  const gapX = Math.max(8, Math.round(bw * 0.07)), gapY = Math.max(3, Math.round(bh * 0.09));
  const availW = bw - 2 * mx - gapX, availH = bh - 2 * my - gapY;
  const wL = Math.round(availW * 0.44), wR = availW - wL;
  const hT = Math.round(availH * 0.58), hB = availH - hT;
  const x0 = ox + mx, x1 = x0 + wL + gapX, y0 = oy + my, y1 = y0 + hT + gapY;
  const panes = [
    { id: 'A', x: x0, y: y0, w: wL, h: hT },
    { id: 'B', x: x1, y: y0, w: wR, h: hT },
    { id: 'C', x: x0, y: y1, w: wL, h: hB },
    { id: 'D', x: x1, y: y1, w: wR, h: hB },
  ];
  const content = panes.map((q) => ({ x: q.x + 1 + INSET, y: q.y + 1, w: q.w - 2 - 2 * INSET, h: q.h - 2 }));
  return { w: W, h: H, panes, content, ring: ringCells(content[2].w, content[2].h), textW: Math.max(8, content[3].w - 1) };
}

// 24 distinct cells round an ellipse in an iw x ih interior, first at the top and going round clockwise.
export function ringCells(iw, ih) {
  const cx = (iw - 1) / 2, cy = (ih - 1) / 2;
  const b = cy, a = Math.min(cx - 1, 2.6 * b + 4);
  const taken = new Set(), out = [];
  const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0]];
  for (let i = 0; i < RING_N; i++) {
    const th = (TAU * i) / RING_N - Math.PI / 2;
    const px = Math.round(cx + a * Math.cos(th)), py = Math.round(cy + b * Math.sin(th));
    let placed = false;
    for (const [dx, dy] of near) {
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= iw || y >= ih || taken.has(y * iw + x)) continue;
      taken.add(y * iw + x); out.push([x, y]); placed = true; break;
    }
    for (let q = 0; !placed && q < iw * ih; q++) if (!taken.has(q)) { taken.add(q); out.push([q % iw, Math.floor(q / iw)]); placed = true; }
  }
  return out;
}

// where pane i's row r (0 = the top border row) starts at T, in columns (for the tests; the scene itself does not allocate)
export function paneRowX(W, H, i, row, T) {
  const p = computeLayout(W, H).panes[i];
  return p.x + paneRowOffset(i, row, p.h, T);
}

// ---- the size cache

function wrapCaption(text, width) {
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    if (cur === '') cur = w; else if (cur.length + 1 + w.length <= width) cur += ' ' + w; else { lines.push(cur); cur = w; }
  }
  lines.push(cur);
  const len = text.length, xs = new Int16Array(len).fill(-1), ys = new Int16Array(len).fill(-1), cx = new Int16Array(len + 1), cy = new Int16Array(len + 1);
  let idx = 0;
  for (let li = 0; li < lines.length; li++) {
    for (let k = 0; k < lines[li].length; k++) { xs[idx] = k; ys[idx] = li; cx[idx] = k; cy[idx] = li; idx++; }
    if (li < lines.length - 1) { cx[idx] = lines[li].length; cy[idx] = li; idx++; } // the space the line broke at: nothing is drawn there
  }
  cx[len] = lines[lines.length - 1].length; cy[len] = lines.length - 1;
  return { lines: lines.length, xs, ys, cx, cy };
}

let cache = null;
export function cacheFor(w, h) {
  if (cache && cache.w === w && cache.h === h) return cache;
  const L = computeLayout(w, h);
  const dwA = 2 * L.content[0].w, dhA = 4 * L.content[0].h, dwB = 2 * L.content[1].w, dhB = 4 * L.content[1].h;
  cache = {
    w, h, layout: L,
    wraps: CAPTIONS.map((s) => wrapCaption(s, L.textW)),
    icoBits: new Uint8Array(Math.ceil(dwA / 2) * Math.ceil(dhA / 4)), icoCol: new Uint32Array(Math.ceil(dwA / 2) * Math.ceil(dhA / 4)),
    trBits: new Uint8Array(Math.ceil(dwB / 2) * Math.ceil(dhB / 4)), trCol: new Uint32Array(Math.ceil(dwB / 2) * Math.ceil(dhB / 4)),
    rx: new Int32Array(4), ry: new Int32Array(4), rw: new Int32Array(4), rh: new Int32Array(4),
    pathX: new Int32Array(2 * (w + h)), pathY: new Int32Array(2 * (w + h)),
    actX: new Int32Array(2 * (w + h)), actY: new Int32Array(2 * (w + h)), actN: 0,
    proj: new Float64Array(36), px: new Float64Array(12), py: new Float64Array(12),
    edgeOrder: new Int32Array(30), edgeDepth: new Float64Array(30),
    cap: { index: 0, text: '', n: 0, phase: 'type', start: 0 }, pulse: { k: 0, conn: 0, p: 0, amp: 0 }, focus: { f: 0, pane: 0, tau: 0, prev: -1 },
  };
  return cache;
}

// ---- drawing

function message(w, h, params) {
  const { glyphs, fg, bg, colours } = params;
  const n = w * h;
  for (let i = 0; i < n; i++) { glyphs[i] = 32; fg[i] = BG; bg[i] = BG; colours[i] = RGB_CELL; }
  const row = Math.floor(h / 2), x0 = Math.floor((w - MESSAGE.length) / 2);
  for (let k = 0; k < MESSAGE.length; k++) {
    const x = x0 + k;
    if (x < 0 || x >= w) continue;
    const i = row * w + x;
    glyphs[i] = MESSAGE.charCodeAt(k); fg[i] = DIM;
  }
}

// the sweep index of a border cell, clockwise from the top left, and the border's length
const borderIndex = (dx, dy, w, h) => (dy === 0 ? dx : dx === w - 1 ? w - 1 + dy : dy === h - 1 ? 2 * (w - 1) + h - 1 - dx : 2 * (w - 1) + 2 * (h - 1) - dy);

// A pane's frame: its glass and its border. The border cell k of Np steps to (or from) the focus colour at tau >= FOCUS_SWEEP k / Np.
function drawGlass(params, W, H, x0, y, w, h, role, tau, pane, T) {
  const { glyphs, fg, bg } = params;
  const np = 2 * (w - 1) + 2 * (h - 1);
  for (let dy = 0; dy < h; dy++) {
    const py = y + dy;
    if (py < 0 || py >= H) continue;
    const x = x0 + paneRowOffset(pane, dy, h, T);
    for (let dx = 0; dx < w; dx++) {
      const px = x + dx;
      if (px < 0 || px >= W) continue;
      const i = py * W + px;
      bg[i] = PANE_BG; glyphs[i] = 32; fg[i] = PANE_BG;
      const onB = dy === 0 || dy === h - 1 || dx === 0 || dx === w - 1;
      if (!onB) continue;
      const k = borderIndex(dx, dy, w, h);
      const swept = tau >= (FOCUS_SWEEP * k) / np;
      const lit = role === 1 ? swept : role === 2 ? !swept : false; // 1 holds the focus now, 2 held it before
      fg[i] = lit ? EDGE_FOCUS : EDGE;
      glyphs[i] = dy === 0 ? (dx === 0 ? BORDER.tl : dx === w - 1 ? BORDER.tr : BORDER.h) : dy === h - 1 ? (dx === 0 ? BORDER.bl : dx === w - 1 ? BORDER.br : BORDER.h) : BORDER.v;
    }
  }
}

function setCell(params, W, H, x, y, g, f, b) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = y * W + x;
  params.glyphs[i] = g; params.fg[i] = f; if (b !== -1) params.bg[i] = b;
}

// A line of dots between (x0, y0) and (x1, y1) into the cell bits of a dw x dh dot grid, tagging each cell with col.
function dotLine(bits, cols, dw, dh, x0, y0, x1, y1, col) {
  const cw = (dw + 1) >> 1;
  let ax = Math.round(x0), ay = Math.round(y0);
  const bx = Math.round(x1), by = Math.round(y1);
  const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay), sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 4096; guard++) {
    if (ax >= 0 && ay >= 0 && ax < dw && ay < dh) {
      const c = (ay >> 2) * cw + (ax >> 1);
      bits[c] |= BRAILLE_BIT[(ay & 3) * 2 + (ax & 1)]; cols[c] = col;
    }
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; ax += sx; }
    if (e2 <= dx) { err += dx; ay += sy; }
  }
}

function flushBraille(params, W, H, bits, cols, dw, dh, ix, iy) {
  const cw = (dw + 1) >> 1, ch = (dh + 3) >> 2;
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const c = cy * cw + cx, b = bits[c];
      if (b === 0) continue;
      setCell(params, W, H, ix + cx, iy + cy, 0x2800 + b, cols[c], -1);
      bits[c] = 0;
    }
  }
}

function drawIcosa(params, c, W, H, x, y, iw, ih, T, TC, seed) {
  if (iw < 4 || ih < 2) return;
  const dw = 2 * iw, dh = 4 * ih, bits = c.icoBits, cols = c.icoCol;
  const R = Math.min(0.34 * Math.min(dw, dh), 20), cx = dw / 2 - 0.5, cy = dh / 2 - 0.5;
  rotateIcosa(seed, T, c.proj);
  const p = c.proj, px = c.px, py = c.py;
  for (let i = 0; i < 12; i++) { px[i] = cx + R * p[3 * i]; py[i] = cy - R * p[3 * i + 1]; }
  // far to near, by the depth of the edge's middle
  const ord = c.edgeOrder, dep = c.edgeDepth;
  for (let e = 0; e < 30; e++) {
    const a = ICO_E[e][0], b = ICO_E[e][1];
    const d = 0.5 * (p[3 * a + 2] + p[3 * b + 2]);
    let j = e;
    while (j > 0 && dep[ord[j - 1]] > d) { ord[j] = ord[j - 1]; j--; }
    ord[j] = e; dep[e] = d;
  }
  for (let q = 0; q < 30; q++) {
    const e = ord[q], d = dep[e];
    const L = edgeLightness(d);
    dotLine(bits, cols, dw, dh, px[ICO_E[e][0]], py[ICO_E[e][0]], px[ICO_E[e][1]], py[ICO_E[e][1]], safeHue(edgeHue(seed, e, TC), L)); // the edges turn on scene time, their hue drifts on colour time
  }
  flushBraille(params, W, H, bits, cols, dw, dh, x, y);
}

function drawTrace(params, c, W, H, x, y, iw, ih, T, seed) {
  if (iw < 4 || ih < 2) return;
  const dw = 2 * iw, dh = 4 * ih, bits = c.trBits, cols = c.trCol;
  const amp = 0.62 * (dh / 2 - 1.5), cy = (dh - 1) / 2, s = traceScroll(T);
  let prev = 0;
  for (let dx = 0; dx < dw; dx++) {
    const u = dx + s;
    const yy = cy - amp * traceValue(seed, u);
    const col = safeHue(190 + 40 * Math.sin(0.03 * u), 0.7);
    if (dx === 0) prev = yy;
    dotLine(bits, cols, dw, dh, dx - (dx === 0 ? 0 : 1), prev, dx, yy, col);
    prev = yy;
  }
  flushBraille(params, W, H, bits, cols, dw, dh, x, y);
}

function drawRing(params, c, W, H, ix, iy, iw, ih, T, seed) {
  const ring = c.layout.ring;
  for (let s = 0; s < RING_N; s++) {
    const age = rollAge(s, T);
    const lit = age < LIT ? 1 - smoothstep(0, LIT, age) : 0;
    const col = lit > 0 ? safeHue(150 + 45 * (1 - lit), 0.66 + 0.24 * lit) : safeHue(195 + 4 * s, 0.66);
    setCell(params, W, H, ix + ring[s][0], iy + ring[s][1], 48 + ringValue(seed, s, T), col, -1);
  }
}

let TEXT = 0, CUR = 0;
function drawCaption(params, c, W, H, ix, y, iw, ih, T, seed) {
  const cap = c.cap;
  captionState(seed, T, cap);
  if (TEXT === 0) { TEXT = safeHue(205, 0.8); CUR = safeHue(190, 0.9); }
  const wr = c.wraps[cap.index], top = y + ((ih - wr.lines) >> 1);
  for (let k = 0; k < cap.n; k++) {
    if (wr.xs[k] < 0) continue;
    setCell(params, W, H, ix + wr.xs[k], top + wr.ys[k], cap.text.charCodeAt(k), TEXT, -1);
  }
  setCell(params, W, H, ix + wr.cx[cap.n], top + wr.cy[cap.n], CURSOR, CUR, -1);
}

// A connector from pane a to pane b (geometric: a is the left or upper one) into X, Y; returns the cell count.
function buildPath(horizontal, ax, ay, aw, ah, bx, by, bw, bh, X, Y) {
  let n = 0;
  if (horizontal) {
    const sx = ax + aw, ex = bx - 1, sy = ay + (ah >> 1), ey = by + (bh >> 1), mx = (sx + ex) >> 1;
    for (let x = sx; x <= mx; x++) { X[n] = x; Y[n++] = sy; }
    const step = ey > sy ? 1 : -1;
    if (ey !== sy) for (let y = sy + step; y !== ey + step; y += step) { X[n] = mx; Y[n++] = y; }
    for (let x = mx + 1; x <= ex; x++) { X[n] = x; Y[n++] = ey; }
  } else {
    const sy = ay + ah, ey = by - 1, sx = ax + (aw >> 1), ex = bx + (bw >> 1), my = (sy + ey) >> 1;
    for (let y = sy; y <= my; y++) { X[n] = sx; Y[n++] = y; }
    const step = ex > sx ? 1 : -1;
    if (ex !== sx) for (let x = sx + step; x !== ex + step; x += step) { X[n++] = x; Y[n - 1] = my; }
    for (let y = my + 1; y <= ey; y++) { X[n] = ex; Y[n++] = y; }
  }
  return n;
}

// the glyph of cell i of a path: dashes along it, rounded corners where it turns
function pathGlyph(X, Y, n, i, horizontal) {
  const hasPrev = i > 0, hasNext = i < n - 1;
  let l = false, r = false, u = false, d = false;
  if (hasPrev) { const dx = X[i - 1] - X[i], dy = Y[i - 1] - Y[i]; if (dx < 0) l = true; else if (dx > 0) r = true; else if (dy < 0) u = true; else if (dy > 0) d = true; }
  if (hasNext) { const dx = X[i + 1] - X[i], dy = Y[i + 1] - Y[i]; if (dx < 0) l = true; else if (dx > 0) r = true; else if (dy < 0) u = true; else if (dy > 0) d = true; }
  if ((l || r) && (u || d)) return r && d ? BORDER.tl : l && d ? BORDER.tr : r && u ? BORDER.bl : BORDER.br;
  if (l || r) return DASH_H;
  if (u || d) return DASH_V;
  return horizontal ? DASH_H : DASH_V;
}

const LINKS = [ // connector c: geometric pane a (left or upper) and b, horizontal or not, and whether the ring runs from b to a
  { a: 0, b: 1, horizontal: true, rev: false },
  { a: 1, b: 3, horizontal: false, rev: false },
  { a: 2, b: 3, horizontal: true, rev: true },
  { a: 0, b: 2, horizontal: false, rev: true },
];

function cortex(t, w, h, params) {
  if (!(w > 0 && h > 0)) return;
  if (w < MIN_W || h < MIN_H) { message(w, h, params); return; }
  const T = sceneTime(t, params), TC = colourTime(t, params), seed = seedOf(params);
  const c = cacheFor(w, h);
  const { glyphs, fg, bg, colours } = params;
  const n = w * h;
  for (let i = 0; i < n; i++) { glyphs[i] = 32; fg[i] = BG; bg[i] = BG; colours[i] = RGB_CELL; }

  const P = c.layout.panes;
  for (let i = 0; i < 4; i++) { c.rx[i] = P[i].x; c.ry[i] = P[i].y; c.rw[i] = P[i].w; c.rh[i] = P[i].h; }
  const pulse = pulseState(T, c.pulse), foc = focusState(T, c.focus);

  // connectors (dim), keeping the pulse's own path
  c.actN = 0;
  for (let k = 0; k < 4; k++) {
    const L = LINKS[k];
    // a connector meets each pane at the row it leaves from: the middle row for a side, the bottom row (of the upper pane) or the top row (of the lower one)
    const ra = L.horizontal ? c.rh[L.a] >> 1 : c.rh[L.a] - 1, rb = L.horizontal ? c.rh[L.b] >> 1 : 0;
    const xa = c.rx[L.a] + paneRowOffset(L.a, ra, c.rh[L.a], T), xb = c.rx[L.b] + paneRowOffset(L.b, rb, c.rh[L.b], T);
    const m = buildPath(L.horizontal, xa, c.ry[L.a], c.rw[L.a], c.rh[L.a], xb, c.ry[L.b], c.rw[L.b], c.rh[L.b], c.pathX, c.pathY);
    for (let i = 0; i < m; i++) setCell(params, w, h, c.pathX[i], c.pathY[i], pathGlyph(c.pathX, c.pathY, m, i, L.horizontal), LINK, -1);
    if (k === pulse.conn && pulse.p >= 0) {
      for (let i = 0; i < m; i++) { c.actX[i] = c.pathX[i]; c.actY[i] = c.pathY[i]; }
      c.actN = m;
    }
  }

  // panes
  for (let i = 0; i < 4; i++) {
    const role = i === foc.pane ? 1 : i === foc.prev ? 2 : 0;
    const x = c.rx[i], y = c.ry[i], pw = c.rw[i], ph = c.rh[i];
    drawGlass(params, w, h, x, y, pw, ph, role, foc.tau, i, T);
    const k = c.layout.content[i];
    if (i === 0) drawIcosa(params, c, w, h, k.x, k.y, k.w, k.h, T, TC, seed);
    else if (i === 1) drawTrace(params, c, w, h, k.x, k.y, k.w, k.h, T, seed);
    else if (i === 2) drawRing(params, c, w, h, k.x, k.y, k.w, k.h, T, seed);
    else drawCaption(params, c, w, h, k.x, k.y, k.w, k.h, T, seed);
  }

  // the ion pulse on its connector: a head and a two-cell tail
  if (c.actN > 0 && pulse.amp > 0) {
    const m = c.actN, L = LINKS[pulse.conn];
    const idx = Math.min(m - 1, Math.floor(pulse.p * m));
    const dir = L.rev ? -1 : 1, head = L.rev ? m - 1 - idx : idx;
    for (let q = 2; q >= 0; q--) {
      const j = head - dir * q;
      if (j < 0 || j >= m) continue;
      const Lq = 0.3 + 0.62 * pulse.amp * (q === 0 ? 1 : q === 1 ? 0.62 : 0.4);
      const i = c.actY[j] * w + c.actX[j];
      if (q === 0) glyphs[i] = 0x25c6;
      fg[i] = safeHue(195, Lq);
    }
  }
}
cortex.id = 'cortex';
cortex.kind = 'cells';
cortex.rgb = true;

export default cortex;
