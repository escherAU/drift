// How the 9000 is coloured, at rest and while it wakes. Every moving colour goes through safeHue at a fixed lightness, so at rest
// only hue moves: the brightness of a cell never changes (the flash meter reads brightness; hue at one lightness is free).
//
//   restHue(cell, t)       the hue (degrees) a hue-kind cell has at rest at time t, stepped (6 steps a second, the foil 2 and 3)
//   levelOf(kind)          the OKLab lightness that kind is held at
//   finalColour(cell, t, v)  the fg colour of a cell (the bg colour of a K_FILL cell) at time t with the fan v (0..1)
//   mixLinear(a, b, s)     a colour s of the way from a to b in linear light (equal-luminance ends keep their luminance)
//
// The fan v: before the machine is awake (the end of the insert, p = 0.55) every light is the same ion hue, 200 degrees. From there
// to the end of the boot each light's hue opens out to where the rest animation has it, the centre first. At v = 1 it IS the rest hue.
import { safeHue } from '../../../src/pixels.js';
import { K_STATIC, K_FILL, K_HALO, K_SPEC, K_SHELF, K_NAME, K_ORBIT, GLASS_BG } from './machine.js';

export const ION_HUE = 200;
export const L_HALO = 0.55;
export const L_SPEC = 0.70;
export const L_SHELF = 0.60;
export const L_NAME = 0.80;
export const L_ORBIT = 0.62;
export const HALO_DEG_PER_S = 30;
export const SPEC_DEG_PER_S = 20;
export const HUE_STEPS_PER_S = 6;
export const NAME_STEPS_PER_S = 3;
export const SHELF_CELLS_PER_S = 2;
export const ORBIT_SECONDS = 6;

export const DIAMOND = safeHue(200, 0.76); // the centre mark: a cool, bright diamond
export const SLOT_GLOW = safeHue(208, 0.5);
const FOIL = [208, 292, 335, 450, 525, 568]; // the label's foil hues in order (cyan, violet, magenta, gold, mint, back to cyan)

export const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

// a foil ramp: r in [0, 1) walks the five hues and comes back to the first
export function foilHue(r) {
  const f = (((r % 1) + 1) % 1) * 5;
  const i = Math.min(4, Math.floor(f));
  return FOIL[i] + (FOIL[i + 1] - FOIL[i]) * (f - i);
}

export function levelOf(k) {
  switch (k) {
    case K_HALO: return L_HALO;
    case K_SPEC: return L_SPEC;
    case K_SHELF: return L_SHELF;
    case K_NAME: return L_NAME;
    default: return L_ORBIT;
  }
}

export function restHue(c, t) {
  const tt = Math.max(0, t);
  const ts = Math.floor(tt * HUE_STEPS_PER_S) / HUE_STEPS_PER_S;
  switch (c.k) {
    case K_HALO: return c.a - HALO_DEG_PER_S * ts;
    case K_SPEC: return ION_HUE + c.a * (360 / 13) + SPEC_DEG_PER_S * ts;
    case K_SHELF: return foilHue((c.a - Math.floor(tt * SHELF_CELLS_PER_S)) / c.b);
    case K_NAME: return foilHue((c.a - Math.floor(tt * NAME_STEPS_PER_S)) / c.b);
    default: { // K_ORBIT: a gold diamond with a short trail goes round a ring of cool ones
      const lead = Math.floor((tt * c.b) / ORBIT_SECONDS) % c.b;
      const d = (lead - c.a + c.b) % c.b;
      return d < 5 ? 85 + 25 * d : 208;
    }
  }
}

function fan(h, vloc) {
  if (vloc >= 1) return h;
  if (vloc <= 0) return ION_HUE;
  return ION_HUE + vloc * wrap180(h - ION_HUE);
}

export function finalColour(c, t, v) {
  if (c.k === K_STATIC) return c.c === -1 ? DIAMOND : c.c === -2 ? SLOT_GLOW : c.c;
  if (c.k === K_FILL) return GLASS_BG;
  const vloc = Math.max(0, Math.min(1, v * 1.5 - 0.5 * c.dx));
  return safeHue(fan(restHue(c, t), vloc), levelOf(c.k));
}

// ---- linear-light mixing
const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) { const s = i / 255; LIN[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
const enc = (l) => { const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(s * 255))); };

export function mixLinear(a, b, s) {
  const ch = (sh) => {
    const x = LIN[(a >>> sh) & 255], y = LIN[(b >>> sh) & 255];
    return enc(x + (y - x) * s);
  };
  return ((ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
}

export const lumOf = (rgb) => 0.2126 * LIN[(rgb >>> 16) & 255] + 0.7152 * LIN[(rgb >>> 8) & 255] + 0.0722 * LIN[rgb & 255];
