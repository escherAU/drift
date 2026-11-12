// The Driftman 9000 at rest: the cells of the finished machine, in rect-local coordinates, for the full console (84 x 18) and the
// mini console (38 x 4). A glass pane floats over a lit shelf; a ring of light runs under it. Nothing here moves: every cell has a
// fixed glyph, and a KIND that says how its colour is found (see rest.js). The shell paints the screen text and the LEDs over this.
//
// A cell is { x, y, g (glyph), k (kind), a, b (kind parameters), c (fixed colour for K_STATIC), dx (0..1 distance from the centre
// line), dn (the same, kept for the fan) }. The morph (morph.js) gives each cell a time to appear from its position.
export const K_STATIC = 0; // fixed colour c, on the palette background
export const K_FILL = 1; // a blank cell on the glass background (the pane's interior)
export const K_HALO = 2; // a = angle round the ring, in degrees
export const K_SPEC = 3; // a = column of the spectrum (0..12)
export const K_SHELF = 4; // a = place along the shelf, b = its length
export const K_NAME = 5; // a = letter number, b = letters in the name
export const K_ORBIT = 6; // a = place on the orbit, b = places on it

export const GLASS_BG = 0x0E1426; // the pane's inside
export const GLASS_EDGE = 0x4A6AB0;
export const HAIRLINE = 0x2A3A66;
export const MIST = 0x8A9BC4;
export const SPEC_COLS = 13;
export const SPEC_ROWS = 5;
export const ORBIT_PLACES = 16;
export const NAME_FULL = 'D R I F T M A N   9 0 0 0';
export const NAME_PLAIN = 'DRIFTMAN 9000';

const cache = new Map();

function build(tier) {
  const mini = tier === 'mini';
  const W = mini ? 38 : 84, H = mini ? 4 : 18;
  const cx = (W - 1) / 2;
  const cells = [];
  const add = (x, y, g, k, a = 0, b = 0, c = 0) => {
    const cp = typeof g === 'string' ? g.codePointAt(0) : g;
    cells.push({ x, y, g: cp, k, a, b, c, dx: Math.min(1, Math.abs(x - cx) / (W / 2)) });
  };
  const run = (x, y, g, n, k, c) => { for (let i = 0; i < n; i++) add(x + i, y, g, k, 0, 0, c); };
  const text = (x, y, s, c) => { let i = 0; for (const ch of s) { if (ch !== ' ') add(x + i, y, ch, K_STATIC, 0, 0, c); i++; } };

  if (mini) {
    // 38 x 4: the pane's foot, the shelf, the name, the ring's lower arc
    add(2, 0, '╷', K_STATIC, 0, 0, HAIRLINE); add(35, 0, '╷', K_STATIC, 0, 0, HAIRLINE);
    add(5, 0, '╰', K_STATIC, 0, 0, GLASS_EDGE); run(6, 0, '─', 2, K_STATIC, GLASS_EDGE); add(8, 0, '┬', K_STATIC, 0, 0, GLASS_EDGE);
    run(9, 0, '─', 20, K_STATIC, GLASS_EDGE); add(29, 0, '┬', K_STATIC, 0, 0, GLASS_EDGE); run(30, 0, '─', 2, K_STATIC, GLASS_EDGE); add(32, 0, '╯', K_STATIC, 0, 0, GLASS_EDGE);
    add(0, 1, '╶', K_STATIC, 0, 0, HAIRLINE); run(1, 1, '─', 7, K_STATIC, HAIRLINE); add(8, 1, '┴', K_STATIC, 0, 0, HAIRLINE);
    for (let i = 0; i < 20; i++) add(9 + i, 1, '━', K_SHELF, i, 20);
    add(29, 1, '┴', K_STATIC, 0, 0, HAIRLINE); run(30, 1, '─', 7, K_STATIC, HAIRLINE); add(37, 1, '╴', K_STATIC, 0, 0, HAIRLINE);
    add(17, 2, '◆', K_STATIC, 0, 0, -1); // -1: the diamond's own colour (see rest.js)
    const letters = [...NAME_PLAIN].filter((ch) => ch !== ' ');
    let li = 0, xi = 19;
    for (const ch of NAME_PLAIN) { if (ch !== ' ') add(xi, 2, ch, K_NAME, li++, letters.length); xi++; }
    add(34, 2, '◇', K_STATIC, 0, 0, MIST);
    ringRow(add, 3, 1, 36, cx, 18, false);
    return { W, H, cx, cells, letters: letters.length };
  }

  // 84 x 18. Rows 0-2: the pane's foot, the lit slot, the shelf
  add(24, 0, '╷', K_STATIC, 0, 0, HAIRLINE); add(59, 0, '╷', K_STATIC, 0, 0, HAIRLINE);
  add(27, 0, '╰', K_STATIC, 0, 0, GLASS_EDGE); run(28, 0, '─', 2, K_STATIC, GLASS_EDGE); add(30, 0, '┬', K_STATIC, 0, 0, GLASS_EDGE);
  run(31, 0, '─', 22, K_STATIC, GLASS_EDGE); add(53, 0, '┬', K_STATIC, 0, 0, GLASS_EDGE); run(54, 0, '─', 2, K_STATIC, GLASS_EDGE); add(56, 0, '╯', K_STATIC, 0, 0, GLASS_EDGE);
  add(24, 1, '│', K_STATIC, 0, 0, HAIRLINE); add(30, 1, '│', K_STATIC, 0, 0, GLASS_EDGE);
  run(31, 1, '▌', 22, K_STATIC, -2); // -2: the slot's glow (see rest.js)
  add(53, 1, '│', K_STATIC, 0, 0, GLASS_EDGE); add(59, 1, '│', K_STATIC, 0, 0, HAIRLINE);
  add(0, 2, '╶', K_STATIC, 0, 0, HAIRLINE); run(1, 2, '─', 23, K_STATIC, HAIRLINE); add(24, 2, '┴', K_STATIC, 0, 0, HAIRLINE);
  for (let i = 0; i < 34; i++) add(25 + i, 2, '━', K_SHELF, i, 34);
  add(59, 2, '┴', K_STATIC, 0, 0, HAIRLINE); run(60, 2, '─', 23, K_STATIC, HAIRLINE); add(83, 2, '╴', K_STATIC, 0, 0, HAIRLINE);
  // rows 3-13: the glass pane round the screen (the 2000's screen rectangle: bezel at 2..49, interior 3..48 by 4..12)
  add(2, 3, '╭', K_STATIC, 0, 0, GLASS_EDGE); run(3, 3, '─', 46, K_STATIC, GLASS_EDGE); add(49, 3, '╮', K_STATIC, 0, 0, GLASS_EDGE);
  for (let y = 4; y <= 12; y++) {
    add(2, y, '│', K_STATIC, 0, 0, GLASS_EDGE); add(49, y, '│', K_STATIC, 0, 0, GLASS_EDGE);
    for (let x = 3; x <= 48; x++) add(x, y, 32, K_FILL);
  }
  add(2, 13, '╰', K_STATIC, 0, 0, GLASS_EDGE); run(3, 13, '─', 46, K_STATIC, GLASS_EDGE); add(49, 13, '╯', K_STATIC, 0, 0, GLASS_EDGE);
  // the panel: ORBIT (a ring of diamonds with one lit diamond going round it, a diamond at its centre) and SPECTRUM (13 x 5)
  for (let k = 0; k < ORBIT_PLACES; k++) {
    const a = (2 * Math.PI * k) / ORBIT_PLACES;
    add(58 + Math.round(4 * Math.cos(a)), 7 + Math.round(2 * Math.sin(a)), '◆', K_ORBIT, k, ORBIT_PLACES);
  }
  add(58, 7, '◆', K_STATIC, 0, 0, -1);
  text(56, 10, 'ORBIT', MIST); text(69, 10, 'SPECTRUM', MIST);
  for (let y = 5; y < 5 + SPEC_ROWS; y++) for (let i = 0; i < SPEC_COLS; i++) add(67 + i, y, '█', K_SPEC, i);
  text(56, 12, 'e · fold away', MIST); text(72, 12, 'h · keys', MIST);
  // rows 14-15: the hairline, the name, the stripe with its diamonds, the model
  run(21, 14, '┈', 42, K_STATIC, HAIRLINE);
  const letters = [...NAME_FULL].filter((ch) => ch !== ' ');
  let li = 0, xi = 3;
  for (const ch of NAME_FULL) { if (ch !== ' ') add(xi, 15, ch, K_NAME, li++, letters.length); xi++; }
  const stripe = '────────◇────────◆────────◇───────';
  let sx = 31;
  for (const ch of stripe) { add(sx, 15, ch, K_STATIC, 0, 0, ch === '─' ? GLASS_EDGE : ch === '◇' ? MIST : -1); sx++; }
  text(68, 15, 'MODEL DM-9000', MIST);
  // rows 16-17: the ring of light, an ellipse seen edge-on: its upper arc on row 16, its lower arc on row 17
  ringRow(add, 16, 9, 74, cx, 32.5, true);
  ringRow(add, 17, 9, 74, cx, 32.5, false);
  return { W, H, cx, cells, letters: letters.length };
}

// One arc of the ring: braille glyphs from x0 to x1, the ends curling round; the angle of a cell is its place on the ellipse.
function ringRow(add, y, x0, x1, cx, rx, upper) {
  const n = x1 - x0 + 1;
  // the end caps are 5 cells; the middle is a straight run of dots
  const capTop = ['⢀', '⡠', '⠤', '⠒', '⠊'], capTopR = ['⠑', '⠒', '⠤', '⢄', '⡀'];
  const capBot = ['⠈', '⠑', '⠒', '⠤', '⢄'], capBotR = ['⡠', '⠤', '⠒', '⠊', '⠁'];
  const midTop = '⠉', midBot = '⣀';
  for (let i = 0; i < n; i++) {
    let g;
    if (i < 5) g = (upper ? capTop : capBot)[i];
    else if (i >= n - 5) g = (upper ? capTopR : capBotR)[i - (n - 5)];
    else g = upper ? midTop : midBot;
    const u = Math.max(-1, Math.min(1, (x0 + i - cx) / rx));
    const deg = (Math.acos(u) * 180) / Math.PI;
    add(x0 + i, y, g, K_HALO, upper ? deg : 360 - deg);
  }
}

export function machine(tier) {
  const key = tier === 'mini' ? 'mini' : 'full';
  let v = cache.get(key);
  if (!v) { v = build(key); cache.set(key, v); }
  return v;
}
