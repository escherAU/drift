// The shelf scrub (DRIFT-7 item 2b). Holding an arrow, or pressing it again while the shelf is still moving, must not be
// refused (every press moves the cursor at once) and must not flash. So what is DRAWN changes, not the input:
//
//   lone press  nothing scrubbing and no full-contrast change within SCRUB_GATE_SECONDS: the normal 0.36 s slide, frame for frame
//               what it always was (tests/fixtures/shelf-lone-press-4d2f8da.json).
//   any other   the cursor, the position dots and the console screen (the list at the compact tier) follow it on the next frame, drawn
//   press       in the dim cap, never dissolving. The ART waits ('stale': it is the art of the last slide) until the flash gate opens,
//               then dissolves into a DIM STRIP of the shelf (SCRUB_IN_SECONDS, each cell flips once) that follows the cursor at most
//               every SCRUB_STRIP_SECONDS. SCRUB_HOLD_SECONDS after the last press the full picture of the cursor dissolves in over
//               SCRUB_OUT_SECONDS, once, and the foil and the idle clock resume. A press during that dissolve starts over.
//
// The gate: the meter's L2 rule calls a cell hot after 3 swings of 0.10 in one second, and a slide already gives a dense art cell
// two (the new card enters dim, then ramps up). So the art may change at full contrast at most twice in SCRUB_GATE_SECONDS: a
// slide counts as two, a dissolve as one. Measured without it: Delza at 80 x 24 reaches 34-36% hot (limit 25).
//
// The dim cap: the meter reads luminance, Y = coverage * Y(fg) + (1 - coverage) * Y(bg). A glyph inks at most its coverage (full
// block, braille 8 dots: 1; every letter and box-drawing glyph: 0.35 or less). A cell drawn with Y(fg) <= SCRUB_TEXT_Y (letters,
// lines) or <= SCRUB_BLOCK_Y (block elements, braille) never has Y above about 0.09, so any two states of it differ by less than
// 0.10 whatever glyph sits in it: the dim strip is the frame passed through that cap, safe by construction at any press rate.
import { shadeRGB, unpackRgb, sgrFor } from '../color.js';

export const SCRUB_GATE_SECONDS = 1.05; // the art changes at full contrast at most twice in this long (a slide is two changes): the L2 rule counts 3 in a second
export const SCRUB_STRIP_SECONDS = 0.5; // the dim strip follows the cursor at most this often (a redraw rewrites the whole shelf: about 16 KB at 120x40)
export const SCRUB_IN_SECONDS = 0.2; // the picture dissolves from the full one into the dim strip
export const SCRUB_HOLD_SECONDS = 0.3; // no press for this long and the full picture comes back
export const SCRUB_OUT_SECONDS = 0.3; // ... dissolving in over this long
export const SCRUB_TEXT_Y = 0.25; // luminance cap of letters and lines (coverage 0.35: a swing of at most 0.087)
export const SCRUB_BLOCK_Y = 0.09; // cap of block elements and braille (coverage up to 1: a swing of at most 0.087)

const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const enc = (l) => { const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.floor(c * 255))); };
export const lumOf = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);

// the colour with its luminance brought down to `cap` (hue kept, scaled in linear light, rounded down); unchanged when already under it
export function capLum(c, cap) {
  const y = lumOf(c);
  if (y <= cap) return c;
  const k = cap / y;
  return [enc(lin(c[0]) * k), enc(lin(c[1]) * k), enc(lin(c[2]) * k)];
}

// Glyphs that ink more than a third of a cell: the block elements (U+2580-259F) and braille (U+2800-28FF).
export const isBlockGlyph = (cp) => (cp >= 0x2580 && cp <= 0x259f) || (cp >= 0x2800 && cp <= 0x28ff);

// The dim twins of a library palette. base = the entries 0..skinN-1 (the console skin's), each cartridge adds four tint entries
// from tints[i]. Returns { sgr, fgs, text, block } where sgr/fgs are the entries to APPEND (their shades start at `start`) and
// text/block map every existing shade to its dim twin (itself when it is already under the cap). A cartridge's four tint
// levels share one twin of its hue (null hue: the neutral grey). All other entries share one neutral grey per class, so the count is 2 + 2 per cartridge
// (2 when no cartridge has a hue of its own).
export function scrubTwins({ start, skinFgs, tintHues, tints, cmode, base }) {
  const sgr = [], fgs = [];
  const text = new Uint8Array(start), block = new Uint8Array(start);
  for (let s = 0; s < start; s++) text[s] = block[s] = s;
  const add = (rgb) => { sgr.push(sgrFor(rgb, 15, cmode) + base); fgs.push(rgb); return start + sgr.length - 1; };
  const neutral = skinFgs[15] || skinFgs[skinFgs.length - 1]; // the console's brightest silver, capped
  const nText = add(capLum(neutral, SCRUB_TEXT_Y)), nBlock = add(capLum(neutral, SCRUB_BLOCK_Y));
  skinFgs.forEach((c, s) => {
    if (lumOf(c) > SCRUB_TEXT_Y) text[s] = nText;
    if (lumOf(c) > SCRUB_BLOCK_Y) block[s] = nBlock;
  });
  tintHues.forEach((hue, i) => {
    const top = hue && shadeRGB(hue, 15);
    const t = top ? add(capLum(top, SCRUB_TEXT_Y)) : nText, b = top ? add(capLum(top, SCRUB_BLOCK_Y)) : nBlock;
    for (let k = 0; k < 4; k++) { text[tints[i] + k] = t; block[tints[i] + k] = b; }
  });
  return { sgr, fgs, text, block };
}

// Pass a drawn library frame through the cap: every inked cell takes the dim twin of its shade for its glyph class. Rows listed
// in keepRows are left as drawn (the position dots, which are the answer to the key press). Cells of RGB_CELL shade
// (full colour: only the foil, which the scrub frame does not draw) are not touched.
export function dimFrame(f, twins, keepRow = -1) {
  const g = f.glyphs, s = f.shades, cols = f.cols, tx = twins.text, bl = twins.block;
  for (let i = 0; i < g.length; i++) {
    const cp = g[i];
    if (cp === 32 || cp === 0) continue;
    if (keepRow >= 0 && ((i / cols) | 0) === keepRow) continue;
    const sh = s[i];
    if (sh >= tx.length) continue;
    s[i] = isBlockGlyph(cp) ? bl[sh] : tx[sh];
  }
}

// ---- the dissolve between the full picture and the strip
//
// Cell by cell, each cell flips once at its own threshold (dissolveThresholds), like every dissolve here. One addition: the brightness-ramp
// rule (a cell that keeps its glyph may not move more than SHADE_STEP_LSTAR = 28 of L* in one frame) would see a border or a text cell
// that is the same glyph before and after, bright in one picture and dim in the other. Such a cell goes through the text twin of the brighter
// shade for a while (A, then the midway shade, then B; each step under 28), and ends at the same moment or earlier than a plain flip.
export const RAMP_LSTAR = 26; // a jump over this in a same-glyph cell takes the midway step (the rule's own limit is 28)
export const lstarOfY = (y) => (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y);
export function shadeLstars(fgRgb) {
  const t = new Float32Array(fgRgb.length);
  for (let i = 0; i < t.length; i++) t[i] = lstarOfY(lumOf(unpackRgb(fgRgb[i])));
  return t;
}
export function dissolveScrub(A, B, p, thr, out, twins, lstar) {
  const g = out.glyphs, s = out.shades, f = out.fg, b = out.bg, n = g.length;
  for (let i = 0; i < n; i++) {
    let src = A, sh = A.shades[i];
    const ga = A.glyphs[i], gb = B.glyphs[i], sa = sh, sb = B.shades[i];
    let mid = -1;
    if (ga === gb && ga !== 32 && sa !== sb && sa < lstar.length && sb < lstar.length && Math.abs(lstar[sa] - lstar[sb]) > RAMP_LSTAR) {
      const m = twins.text[lstar[sa] > lstar[sb] ? sa : sb];
      if (m !== sa && m !== sb && Math.abs(lstar[m] - lstar[sa]) <= RAMP_LSTAR && Math.abs(lstar[m] - lstar[sb]) <= RAMP_LSTAR) mid = m;
    }
    if (mid >= 0) {
      const p1 = thr[i] * 0.5, p2 = p1 + 0.4;
      if (p >= p2) src = B; else if (p >= p1) sh = mid;
    } else if (p >= thr[i]) src = B;
    g[i] = src.glyphs[i]; s[i] = src === B ? B.shades[i] : sh; f[i] = src.fg[i]; b[i] = src.bg[i];
  }
  return out;
}
