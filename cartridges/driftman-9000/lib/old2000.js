// The Driftman 2000's console body as the shell draws it just after the cartridge clicks home (insert step 5, p = 0): the
// cells the 9000 sheds. The shell paints the screen text and the LEDs over every console, so they are not listed here.
// Colours are the 2000's own palette entries written out in full (graphite, dim, silver), so the first frame the 9000 draws is
// the picture that was on screen the frame before. Each entry is [x, y, glyph, rgb] in rect-local cells.
export const GRAPHITE = 0x5D6474;
export const DIM = 0x8B93A1;
export const SILVER = 0xC8CCD4;

const cache = new Map();

function build(tier) {
  const out = [];
  const put = (x, y, g, c) => out.push([x, y, typeof g === 'string' ? g.codePointAt(0) : g, c]);
  const run = (x, y, g, n, c) => { for (let i = 0; i < n; i++) put(x + i, y, g, c); };
  const text = (x, y, s, c) => { let i = 0; for (const ch of s) { if (ch !== ' ') put(x + i, y, ch, c); i++; } };
  if (tier === 'mini') {
    // 38 x 4: the slot housing, the frame, the name
    run(5, 0, '▄', 28, GRAPHITE);
    put(0, 1, '╭', GRAPHITE); run(1, 1, '─', 4, GRAPHITE);
    put(5, 1, '█', GRAPHITE); put(6, 1, '▌', GRAPHITE); put(31, 1, '▐', GRAPHITE); put(32, 1, '█', GRAPHITE);
    run(33, 1, '─', 4, GRAPHITE); put(37, 1, '╮', GRAPHITE);
    put(0, 2, '│', GRAPHITE); put(37, 2, '│', GRAPHITE);
    text(19, 2, 'DRIFTMAN 2000', SILVER);
    put(0, 3, '╰', GRAPHITE); run(1, 3, '─', 36, GRAPHITE); put(37, 3, '╯', GRAPHITE);
    return out;
  }
  // 84 x 18: the slot housing and its floor (rows 0-2)
  run(28, 0, '▄', 28, GRAPHITE);
  put(28, 1, '█', GRAPHITE); put(29, 1, '▌', GRAPHITE); put(54, 1, '▐', GRAPHITE); put(55, 1, '█', GRAPHITE);
  put(0, 2, '╭', GRAPHITE); run(1, 2, '─', 27, GRAPHITE);
  put(28, 2, '█', GRAPHITE); put(29, 2, '▙', GRAPHITE); run(30, 2, '▄', 24, GRAPHITE); put(54, 2, '▟', GRAPHITE); put(55, 2, '█', GRAPHITE);
  run(56, 2, '─', 27, GRAPHITE); put(83, 2, '╮', GRAPHITE);
  // the screen's bezel (rows 3-13) and the console frame either side
  for (let k = 0; k < 11; k++) {
    const y = 3 + k;
    put(0, y, '│', GRAPHITE); put(83, y, '│', GRAPHITE);
    if (k === 0) { put(2, y, '╔', GRAPHITE); run(3, y, '═', 46, GRAPHITE); put(49, y, '╗', GRAPHITE); }
    else if (k === 10) { put(2, y, '╚', GRAPHITE); run(3, y, '═', 46, GRAPHITE); put(49, y, '╝', GRAPHITE); }
    else { put(2, y, '║', GRAPHITE); put(49, y, '║', GRAPHITE); }
  }
  // the panel: the TUNE dial, the grille, the labels
  const DIAL = ['  ╭───╮  ', ' ╱     ╲ ', '│   ●   │', ' ╲     ╱ ', '  ╰───╯  '];
  for (let r = 0; r < DIAL.length; r++) {
    for (let c = 0; c < 9; c++) {
      const ch = DIAL[r][c];
      if (ch !== ' ') put(54 + c, 5 + r, ch, ch === '●' ? SILVER : GRAPHITE);
    }
    run(67, 5 + r, '▒', 13, GRAPHITE);
  }
  text(56, 10, 'TUNE', DIM);
  text(56, 12, '[ EJECT ]', DIM);
  text(69, 12, '[ RESET ]', DIM);
  // the chrome band (row 14), the title bar (row 15), the frame's foot (row 16) and the feet (row 17)
  put(0, 14, '╞', GRAPHITE); run(1, 14, '═', 82, GRAPHITE); put(83, 14, '╡', GRAPHITE);
  put(0, 15, '│', GRAPHITE); put(83, 15, '│', GRAPHITE);
  text(3, 15, 'D R I F T M A N   2 0 0 0', SILVER);
  text(31, 15, '═'.repeat(30) + '╱╱╱╱', GRAPHITE);
  text(68, 15, 'MODEL DM-2000', DIM);
  put(0, 16, '╰', GRAPHITE); run(1, 16, '─', 82, GRAPHITE); put(83, 16, '╯', GRAPHITE);
  run(3, 17, '▀', 6, GRAPHITE); run(75, 17, '▀', 6, GRAPHITE);
  return out;
}

export function old2000(tier) {
  const key = tier === 'mini' ? 'mini' : 'full';
  let v = cache.get(key);
  if (!v) { v = build(key); cache.set(key, v); }
  return v;
}
