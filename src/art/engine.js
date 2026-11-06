// The artist's engine: pure functions, no fs, no clock.
//
//   parsePiece(text)  -> { title, width, height, cells }   (the art, cropped to its bounding box)
//   buildPlan(piece)  -> the pen's route through the cells, worked out once and cached
//   paintPiece(...)   -> one frame of drawing, holding, or erasing at a given second
//
// A piece file is: first line `title: <name>`, a line `---`, then the raw art lines. CRLF is
// fine. Trailing spaces are trimmed. Blank cells (spaces) are never drawn.
//
// STROKE ORDER (automatic). Cells split into two passes: OUTLINE cells (line characters:
// ASCII line punctuation, box drawing, half blocks, wedge triangles) are drawn first, then
// FILL cells (letters, digits, shades, braille, Greek, maths, shapes, ...). Within a pass the
// cells are grouped into connected shapes (8-neighbour); the shapes are visited in reading
// order of their top-left cell, and each is traced by a pen: it keeps going in the direction
// it was going when it can, otherwise takes the neighbour that leaves the fewest dead ends,
// and when it is boxed in it lifts and lands on the nearest undrawn cell of the same shape.
// A lift costs a little extra time, like a real pen.

export const FADE_SEC = 1.0; // a new stroke fades from bright to its base brightness in this long
export const PEN_LEVEL = 15;
const LIFT_COST = 3; // a pen lift is worth this many cells of time
const CELLS_PER_SEC = 48; // drawing speed
export const MIN_DRAW_SEC = 8;
export const MAX_DRAW_SEC = 18;

export function parsePiece(text) {
  const lines = String(text).split(/\r?\n/);
  const m = /^title:\s*(.+?)\s*$/.exec(lines[0] || '');
  if (!m) throw new Error('piece: first line must be "title: <name>"');
  if ((lines[1] || '').trim() !== '---') throw new Error('piece: second line must be "---"');
  const art = lines.slice(2).map((l) => Array.from(l.replace(/\s+$/, '')));
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  art.forEach((row, y) => row.forEach((ch, x) => {
    if (ch !== ' ') {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }));
  const cells = [];
  if (maxX >= 0) {
    for (let y = minY; y <= maxY; y++) {
      const row = art[y];
      for (let x = minX; x <= maxX && x < row.length; x++) {
        if (row[x] !== ' ') cells.push({ x: x - minX, y: y - minY, cp: row[x].codePointAt(0) });
      }
    }
  }
  return { title: m[1], width: maxX >= 0 ? maxX - minX + 1 : 0, height: maxY >= 0 ? maxY - minY + 1 : 0, cells };
}

// The piece as rows of text (its bounding box), for captures and tests.
export function pieceToText(piece) {
  const rows = [];
  for (let y = 0; y < piece.height; y++) rows.push(new Array(piece.width).fill(' '));
  for (const c of piece.cells) rows[c.y][c.x] = String.fromCodePoint(c.cp);
  return rows.map((r) => r.join('').replace(/\s+$/, '')).join('\n');
}

const OUTLINE_ASCII = '/\\|_-()[]{}<>\'`^~.,:;!=+"';

export function isOutlineGlyph(cp) {
  if (cp < 0x80) return OUTLINE_ASCII.includes(String.fromCharCode(cp));
  if (cp >= 0x2500 && cp <= 0x257f) return true; // box drawing
  if (cp >= 0x2580 && cp <= 0x259f) return cp !== 0x2588 && !(cp >= 0x2591 && cp <= 0x2593); // half blocks, not full or shades
  if (cp >= 0x25e2 && cp <= 0x25e5) return true; // wedge triangles
  return false;
}

// Resting brightness (colour index 4..12) by glyph: faint marks dimmer, dense marks brighter.
export function baseLevel(cp) {
  if (cp === 0x2591) return 6;
  if (cp === 0x2592) return 8;
  if (cp === 0x2593) return 10;
  if (cp === 0x2588) return 12;
  if (cp >= 0x2800 && cp <= 0x28ff) {
    let n = 0;
    for (let b = cp - 0x2800; b; b >>= 1) n += b & 1;
    return n <= 2 ? 6 : n <= 5 ? 8 : 10;
  }
  if (cp === 0x2e || cp === 0x2c || cp === 0x27 || cp === 0x60 || cp === 0xb7 || cp === 0x3a || cp === 0x3b) return 7;
  if (cp === 0x7e || cp === 0x2d || cp === 0x5f) return 9;
  if (cp >= 0x25a0 && cp <= 0x25ff) return 12;
  return 10;
}

// ---- stroke order -----------------------------------------------------------------------
const NB = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]; // orthogonals first

// Returns { order: Int32Array of indexes into piece.cells, lifts: Uint8Array parallel to order }
export function strokeOrder(piece) {
  const { width: W, height: H, cells } = piece;
  const grid = new Int32Array(W * H).fill(-1); // piece.cells index, or -1
  cells.forEach((c, k) => { grid[c.y * W + c.x] = k; });
  const pass = (k) => (isOutlineGlyph(cells[k].cp) ? 0 : 1);
  const done = new Uint8Array(cells.length);
  const order = [];
  const lifts = [];

  for (let p = 0; p < 2; p++) {
    // connected shapes of this pass (cells are row-major sorted, so the first cell met is top-left)
    const comp = new Int32Array(cells.length).fill(-1);
    const shapes = [];
    for (let k = 0; k < cells.length; k++) {
      if (pass(k) !== p || comp[k] >= 0) continue;
      const id = shapes.length;
      const members = [k];
      comp[k] = id;
      for (let q = 0; q < members.length; q++) {
        const c = cells[members[q]];
        for (const [dx, dy] of NB) {
          const x = c.x + dx, y = c.y + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const j = grid[y * W + x];
          if (j >= 0 && pass(j) === p && comp[j] < 0) { comp[j] = id; members.push(j); }
        }
      }
      shapes.push({ start: k, size: members.length });
    }
    for (const shape of shapes) {
      let cur = shape.start;
      let left = shape.size;
      let dir = [0, 0];
      let lifted = order.length > 0 ? 1 : 0; // starting a new shape = the pen travels there
      const land = (k) => { done[k] = 1; order.push(k); lifts.push(lifted); lifted = 0; left--; };
      const free = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return -1;
        const j = grid[y * W + x];
        return j >= 0 && pass(j) === p && !done[j] ? j : -1;
      };
      land(cur);
      while (left > 0) {
        const c = cells[cur];
        let best = -1, bestScore = -Infinity, bestDir = null;
        for (const [dx, dy] of NB) {
          const j = free(c.x + dx, c.y + dy);
          if (j < 0) continue;
          let onward = 0;
          for (const [ex, ey] of NB) if (free(c.x + dx + ex, c.y + dy + ey) >= 0) onward++;
          const len = Math.hypot(dx, dy);
          const straight = (dir[0] * dx + dir[1] * dy) / len; // 1 straight on, 0 sideways, -1 back
          const score = straight * 4 - onward * 0.5 - (dx !== 0 && dy !== 0 ? 0.3 : 0);
          if (score > bestScore + 1e-9) { best = j; bestScore = score; bestDir = [dx / len, dy / len]; }
        }
        if (best >= 0) { dir = bestDir; cur = best; land(cur); continue; }
        // boxed in: lift the pen to the nearest undrawn cell of this shape (breadth-first over the shape)
        const seen = new Set([cur]);
        const queue = [cur];
        let target = -1;
        for (let q = 0; q < queue.length && target < 0; q++) {
          const cc = cells[queue[q]];
          for (const [dx, dy] of NB) {
            const x = cc.x + dx, y = cc.y + dy;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const j = grid[y * W + x];
            if (j < 0 || pass(j) !== p || seen.has(j)) continue;
            seen.add(j);
            if (!done[j]) { target = j; break; }
            queue.push(j);
          }
        }
        if (target < 0) { // unreachable cannot happen inside one shape; stay safe anyway
          for (let k = 0; k < cells.length; k++) if (!done[k] && pass(k) === p && comp[k] === comp[shape.start]) { target = k; break; }
        }
        dir = [0, 0];
        lifted = 1;
        cur = target;
        land(cur);
      }
    }
  }
  return { order: Int32Array.from(order), lifts: Uint8Array.from(lifts) };
}

function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const plans = new WeakMap();

// The pen's route and timings for a piece; computed once per piece object.
//   order[j]  index into piece.cells of the j-th cell drawn
//   rank[k]   j for cell k
//   at[k]     fraction of the drawing time (0 <= at < 1) at which cell k is drawn
//   u[k]      a fixed pseudo-random number in [0, 1) per cell (the dissolve order)
//   base[k]   resting brightness
//   drawSec   how long the drawing takes
export function buildPlan(piece) {
  let plan = plans.get(piece);
  if (plan) return plan;
  const n = piece.cells.length;
  const { order, lifts } = strokeOrder(piece);
  const rank = new Int32Array(n), at = new Float64Array(n), u = new Float64Array(n), base = new Uint8Array(n);
  // time of cell j = cost spent before it, plus its own lift
  const costs = new Float64Array(n);
  let acc = 0;
  for (let j = 0; j < n; j++) {
    if (lifts[j]) acc += LIFT_COST;
    costs[j] = acc;
    acc += 1;
  }
  const total = Math.max(1, acc);
  let s = hash32(piece.title) || 1;
  for (let j = 0; j < n; j++) {
    const k = order[j];
    rank[k] = j;
    at[k] = costs[j] / total;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    u[k] = s / 4294967296;
    base[k] = baseLevel(piece.cells[k].cp);
  }
  const drawSec = Math.min(MAX_DRAW_SEC, Math.max(MIN_DRAW_SEC, total / CELLS_PER_SEC));
  plan = { order, rank, at, u, base, drawSec, count: n };
  plans.set(piece, plan);
  return plan;
}

// ---- painting ---------------------------------------------------------------------------
// phase 'draw' | 'hold' | 'wipe' | 'dissolve'; sec = seconds into that phase;
// eraseSec = how long the erase takes (wipe / dissolve). Writes only the cells of the piece
// into dst = { glyphs, colours, cols, x0, y0 } (the caller blanks the buffers first).
const DISSOLVE_FADE = 0.8; // a dissolving cell dims for this long before it goes
const WIPE_LEAD = 0.5; // the eraser's bright edge

export function paintPiece(piece, phase, sec, eraseSec, dst) {
  const plan = buildPlan(piece);
  const { cells } = piece;
  const g = dst.glyphs, c = dst.colours;
  for (let k = 0; k < cells.length; k++) {
    const cell = cells[k];
    let level = plan.base[k];
    if (phase === 'draw' || phase === 'hold') {
      const age = phase === 'hold' ? plan.drawSec + sec - plan.at[k] * plan.drawSec : sec - plan.at[k] * plan.drawSec;
      if (age < 0) continue;
      if (age < FADE_SEC) level = Math.round(level + (PEN_LEVEL - level) * (1 - age / FADE_SEC));
    } else if (phase === 'wipe') {
      // reverse stroke order: the last cell drawn goes first
      const gone = (1 - plan.at[k]) * eraseSec;
      const ahead = gone - sec;
      if (ahead <= 0) continue;
      if (ahead < WIPE_LEAD) level = Math.round(level + (PEN_LEVEL - level) * (1 - ahead / WIPE_LEAD));
    } else {
      const gone = DISSOLVE_FADE + plan.u[k] * Math.max(0, eraseSec - DISSOLVE_FADE);
      const ahead = gone - sec;
      if (ahead <= 0) continue;
      if (ahead < DISSOLVE_FADE) level = Math.max(2, Math.round(2 + (level - 2) * (ahead / DISSOLVE_FADE)));
    }
    const i = (dst.y0 + cell.y) * dst.cols + dst.x0 + cell.x;
    g[i] = cell.cp;
    c[i] = level;
  }
}
