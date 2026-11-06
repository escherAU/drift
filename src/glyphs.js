// Allow-list of code points the non-calm modes (and the help panel) may draw.
// Every one is in the Basic Multilingual Plane (one UTF-16 unit, which the renderer's
// String.fromCharCode relies on) and is single-width in a terminal. Cascadia Mono
// coverage of the list could NOT be verified from the build machine (see README).
//
// Banned on purpose: anything >= U+10000, U+2300-23FF, U+2600-27BF, U+2B00-2BFF
// (emoji-presentation and wide risk), combining marks, FE00-FE0F, 200D, controls.

// [lo, hi] inclusive
const RANGES = [
  [0x20, 0x7e], // printable ASCII
  [0xb0, 0xb1], [0xb7, 0xb7], [0xd7, 0xd7], [0xf7, 0xf7], // degree, plus-minus, middle dot, times, divide
  [0x391, 0x3a1], [0x3a3, 0x3a9], // Greek capitals (0x3A2 is unassigned)
  [0x3b1, 0x3c9], // Greek small
  [0x2190, 0x2199], // arrows
  [0x2500, 0x257f], // box drawing
  [0x2580, 0x259f], // block elements
  [0x2800, 0x28ff], // braille
  // maths operators (a hand-picked subset of 2200-22FF)
  [0x2202, 0x2202], [0x2205, 0x2208], [0x220f, 0x220f], [0x2211, 0x2212], [0x221a, 0x221a], [0x221e, 0x221e],
  [0x2227, 0x222b], [0x2248, 0x2248], [0x2260, 0x2261], [0x2264, 0x2265],
  // geometric shapes (a hand-picked subset of 25A0-25FF; 25FD-25FE are Wide)
  [0x25a0, 0x25a1], [0x25aa, 0x25ab], [0x25b2, 0x25b3], [0x25b6, 0x25b7], [0x25bc, 0x25bd],
  [0x25c0, 0x25c1], [0x25c6, 0x25c7], [0x25cb, 0x25cf], [0x25d0, 0x25d5], [0x25e2, 0x25e5],
];

export const ALLOWED_RANGES = RANGES;

export function isAllowedGlyph(cp) {
  for (let i = 0; i < RANGES.length; i++) {
    if (cp >= RANGES[i][0] && cp <= RANGES[i][1]) return true;
  }
  return false;
}

// every allowed code point, for tests and for scenes that want to pick from sets
export function allowedList() {
  const out = [];
  for (const [lo, hi] of RANGES) for (let c = lo; c <= hi; c++) out.push(c);
  return out;
}
