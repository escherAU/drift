// Tiny seeded generator shared by the experimental physics sims (mulberry32 on s.rs).
// Same seed, same call order: same numbers. The caller owns the state object `s` and
// sets s.rs once at init, so a sim's whole history is a function of (size, seed, steps).
export function seedState(seed, salt) {
  return (Number.isFinite(seed) ? seed | 0 : 0) ^ salt;
}

export function rnd(s) {
  let a = (s.rs = (s.rs + 0x6d2b79f5) | 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Glyph for a straight stroke, from its direction in isotropic units (x in columns, y in
// half-rows, y growing downward). Box-drawing strokes only.
export function strokeGlyph(dx, dy) {
  const a = Math.abs(dx), b = Math.abs(dy);
  if (b > 2.4 * a) return 0x2502; // vertical
  if (a > 2.4 * b) return 0x2500; // horizontal
  return dx * dy > 0 ? 0x2572 : 0x2571; // down-right slash, or down-left
}
