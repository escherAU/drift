// Night Drive's colours, as palette indexes (skin.json: the hue is the magenta at 16 brightness levels, indexes 0 to 15, then
// the fixed colours from 16). Each family below is four shades, dim to bright (38, 58, 80 and 100 percent of its hue).
//
//   sun  tang  coral  mag  violet  cyan  mint  ice        (indexes 16 to 47, four each)
//   TEXT 48   DIM 49   FAR 50   NEAR 51                   (single colours)
//
// Text uses only TEXT, DIM, a shade-3 hue, or cyan, sun, mint and ice at shade 2: the other mid shades (mag.2, violet.2)
// do not reach 4.5:1 on the background, so they are for pictures only.
const family = (k) => Object.freeze([16 + 4 * k, 17 + 4 * k, 18 + 4 * k, 19 + 4 * k]);
export const SUN = family(0); // dashes, windows, sun
export const TANG = family(1); // street lamps
export const CORAL = family(2); // tail lights, glow on the road
export const MAG = family(3); // chrome, accent, the horizon
export const VIOLET = family(4); // car body, mountains
export const CYAN = family(5); // road edges, headings
export const MINT = family(6); // green lights
export const ICE = family(7); // stars, headlights, the plate
export const TEXT = 48; // #EDE6FF, interface text
export const DIM = 49; // #8576B0, hints
export const FAR = 50; // #2A1E5C, far silhouettes
export const NEAR = 51; // #1A1240, near silhouettes and tyres
export const COUNT = 52; // palette entries in all

export const FAMILIES = Object.freeze({ sun: SUN, tang: TANG, coral: CORAL, mag: MAG, violet: VIOLET, cyan: CYAN, mint: MINT, ice: ICE });

// The colour of a family name at a shade 0 to 3 (the shade is clamped; an unknown name is ice).
export function colour(name, shade) {
  const f = FAMILIES[name] || ICE;
  return f[shade < 0 ? 0 : shade > 3 ? 3 : shade | 0];
}
