// DRIFT-8 C4: must-fail (and must-pass) controls for rule C, the colour-flicker rule of the flash meter (tests/helpers-flash.js, "Rule C").
//
// Same shape as tests/helpers-flash-controls.js: `make(cols, rows, options) -> (t) => frame`, pure in t (seconds), the buffers reused.
// Every control here holds BRIGHTNESS steady (OKLab lightness L fixed, so the WCAG-style rules read nothing) and moves only colour: the one thing
// the brightness rules cannot see.
//
// This file does its own OKLab (it must not use the colour code under test): labPack is strict, it throws when a colour leaves the sRGB gamut
// instead of quietly reducing its chroma, so a control means exactly the colours it says.
import { newFrame, pack } from './helpers-flash-controls.js';

const enc = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const GAMUT_SLACK = 0.002; // how far a linear channel may sit outside 0..1 before the colour counts as out of gamut

// OKLab (L, a, b) -> 0xRRGGBB, or a throw when the colour is outside sRGB
export function labPack(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  for (const v of rgb) if (v < -GAMUT_SLACK || v > 1 + GAMUT_SLACK) throw new RangeError(`labPack(${L}, ${a.toFixed(3)}, ${b.toFixed(3)}) is outside sRGB (${rgb.map((x) => x.toFixed(3))})`);
  return pack(enc(Math.min(1, Math.max(0, rgb[0]))) * 255, enc(Math.min(1, Math.max(0, rgb[1]))) * 255, enc(Math.min(1, Math.max(0, rgb[2]))) * 255);
}
// the same by hue (turns) at chroma C
export const labHue = (L, C, hTurns) => labPack(L, C * Math.cos(hTurns * 2 * Math.PI), C * Math.sin(hTurns * 2 * Math.PI));

function fillSolid(f, colour) { f.glyphs.fill(32); f.fg.fill(colour); f.bg.fill(colour); return f; }

export const CONTROL_L = 0.68; // the lightness every colour control holds
export const CONTROL_CHROMA = 0.11; // in gamut at CONTROL_L for every hue (labHue throws if not)

// The whole field alternates between two colours `hz` times a second (two changes per cycle: 2 * hz swings a second on the axes that see the difference).
export function colourPair(cols, rows, { c1, c2, hz = 4 } = {}) {
  const f = newFrame(cols, rows);
  return (t) => fillSolid(f, Math.floor(t * hz * 2) % 2 === 0 ? c1 : c2);
}

// The pair that differs by (da, db) = (0.09, 0.09) in OKLab at one lightness: dE 0.127. Each of a and b moves 0.09, under the 0.10 swing; only the diagonal
// (a + b) / sqrt 2 moves, by 0.127. A meter that follows a and b alone reads it as no change. (a - b stays put.)
export const DIAG_BASE = { a: 0, b: 0.05 };
export const DIAG_1 = labPack(CONTROL_L, DIAG_BASE.a - 0.045, DIAG_BASE.b - 0.045);
export const DIAG_2 = labPack(CONTROL_L, DIAG_BASE.a + 0.045, DIAG_BASE.b + 0.045);
// and the pair that moves only along the other diagonal (a - b), for the mirror
export const ANTI_1 = labPack(CONTROL_L, DIAG_BASE.a - 0.045, DIAG_BASE.b + 0.045);
export const ANTI_2 = labPack(CONTROL_L, DIAG_BASE.a + 0.045, DIAG_BASE.b - 0.045);
export const diagonalPair = (cols, rows, { hz = 4, anti = false } = {}) => colourPair(cols, rows, { c1: anti ? ANTI_1 : DIAG_1, c2: anti ? ANTI_2 : DIAG_2, hz });

// The hue wobbles `amp` degrees either side of `centre` degrees (OKLab hue angle), `hz` cycles a second, at one lightness and chroma.
export function hueWobble(cols, rows, { centre = 45, amp = 40, hz = 4, L = CONTROL_L, C = CONTROL_CHROMA } = {}) {
  const f = newFrame(cols, rows);
  return (t) => fillSolid(f, labHue(L, C, (centre + amp * Math.sin(2 * Math.PI * hz * t)) / 360));
}

// The whole screen turns through every hue at `cps` cycles a second, at one lightness and chroma. Each of the axes a and b swings twice a cycle, so the rule's
// limit (7 swings a second) is 3.5 cycles a second: 3.0 passes, 3.6 fails.
export function hueSpin(cols, rows, { cps = 3, L = CONTROL_L, C = CONTROL_CHROMA } = {}) {
  const f = newFrame(cols, rows);
  return (t) => fillSolid(f, labHue(L, C, cps * t));
}
