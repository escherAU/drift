// Delza's colours, as palette indexes (skin.json: the hue is the leaf green at 16 brightness levels, indexes 0 to 15,
// then the fixed colours from 16). Each family below is four shades, dim to bright (38, 58, 80 and 100 percent).
//
//   a bark  b leaf  c moss  d parchment  e gold  f ember  g dusk  h stone
//
// The leaf family comes from the hue ramp, so the c key (seasons) recolours the pines and nothing else.
export const LEAF = Object.freeze([5, 8, 11, 15]);
const family = (k) => Object.freeze([16 + 4 * k, 17 + 4 * k, 18 + 4 * k, 19 + 4 * k]);
export const MOSS = family(0);
export const BARK = family(1);
export const PARCH = family(2);
export const GOLD = family(3);
export const EMBER = family(4);
export const DUSK = family(5);
export const STONE = family(6);
export const DIM = 44; // #8F8466, the interface's quiet text
export const COUNT = 45; // palette entries in all

export const FAMILIES = Object.freeze({ a: BARK, b: LEAF, c: MOSS, d: PARCH, e: GOLD, f: EMBER, g: DUSK, h: STONE });

// The colour of a hue letter at a shade 0 to 3 (the shade is clamped).
export function colour(hue, shade) {
  const f = FAMILIES[hue] || PARCH;
  return f[shade < 0 ? 0 : shade > 3 ? 3 : shade | 0];
}

// brighter[i] is the entry one shade up in i's own family (the top shade, and any entry outside a family, map to themselves).
const UP = new Uint8Array(COUNT);
for (let i = 0; i < COUNT; i++) UP[i] = i;
for (const f of Object.values(FAMILIES)) for (let s = 0; s < 3; s++) UP[f[s]] = f[s + 1];

// n shades brighter within the entry's family (n of 0 or less changes nothing).
export function brighter(idx, n = 1) {
  let i = idx;
  for (let k = 0; k < n; k++) i = UP[i] === undefined ? i : UP[i];
  return i;
}
