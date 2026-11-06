// Colour presets, shading, truecolor / 256-colour SGR, blend.
import { LEVELS } from './ramp.js';

export const DEFAULT_PRESET = 'claude';

export const PRESETS = [
  { id: 'claude', name: 'Claude orange', rgb: [0xd9, 0x77, 0x57] },
  { id: 'amber', name: 'Amber phosphor', rgb: [255, 176, 0] },
  { id: 'green', name: 'Green phosphor', rgb: [51, 255, 102] },
  { id: 'ice', name: 'Ice blue', rgb: [143, 201, 255] },
  { id: 'violet', name: 'Violet', rgb: [176, 140, 255] },
  { id: 'white', name: 'White', rgb: [232, 232, 232] },
  // Slow two-colour blend: Claude orange <-> violet over BLEND_PERIOD seconds.
  { id: 'blend', name: 'Orange/violet blend', blend: ['claude', 'violet'] },
];

export const BLEND_PERIOD = 120; // seconds for one orange -> violet -> orange loop
export const BLEND_STEPS = 60; // palette steps per half loop; keeps repaints rare

export function presetIndex(id) {
  return PRESETS.findIndex((p) => p.id === id);
}
export function nextPreset(id) {
  const i = presetIndex(id);
  return PRESETS[(i + 1) % PRESETS.length].id;
}

export function parseHex(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpRGB(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// 0 -> 1 -> 0 smoothly over `period` seconds (cosine, zero slope at both ends).
export function loopT(time, period) {
  const ph = (((time % period) + period) % period) / period;
  const t = (1 - Math.cos(2 * Math.PI * ph)) / 2;
  return ph === 0 ? 0 : t;
}

// RGB of a preset at time `time` (only blend varies with time).
export function presetRGB(id, time = 0) {
  const p = PRESETS[presetIndex(id)] || PRESETS[0];
  if (!p.blend) return p.rgb.slice();
  const a = presetRGB(p.blend[0]), b = presetRGB(p.blend[1]);
  // quantise so the palette (and a full repaint) changes only BLEND_STEPS*2 times per loop
  const t = Math.round(loopT(time, BLEND_PERIOD) * BLEND_STEPS) / BLEND_STEPS;
  return lerpRGB(a, b, t);
}

const FLOOR = 0.2; // brightness of level 0 relative to full
export function shadeRGB(rgb, level) {
  const f = FLOOR + (1 - FLOOR) * (level / (LEVELS - 1));
  return [Math.round(rgb[0] * f), Math.round(rgb[1] * f), Math.round(rgb[2] * f)];
}

const CUBE = [0, 95, 135, 175, 215, 255];
export function rgbTo256(rgb) {
  const [r, g, b] = rgb;
  const ci = (c) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < 6; i++) { const d = Math.abs(c - CUBE[i]); if (d < bd) { bd = d; best = i; } }
    return best;
  };
  const ri = ci(r), gi = ci(g), bi = ci(b);
  const cube = [CUBE[ri], CUBE[gi], CUBE[bi]];
  const avg = (r + g + b) / 3;
  const gi2 = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)));
  const gv = 8 + gi2 * 10;
  const dist = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  if (dist(rgb, [gv, gv, gv]) < dist(rgb, cube)) return 232 + gi2;
  return 16 + 36 * ri + 6 * gi + bi;
}

export function sgrFor(rgb, level, mode) {
  const s = shadeRGB(rgb, level);
  if (mode === 'truecolor') return `\x1b[38;2;${s[0]};${s[1]};${s[2]}m`;
  return `\x1b[38;5;${rgbTo256(s)}m`;
}

export function detectColorMode(env = {}) {
  const ct = String(env.COLORTERM || '').toLowerCase();
  if (ct === 'truecolor' || ct === '24bit') return 'truecolor';
  if (env.WT_SESSION) return 'truecolor';
  return '256';
}

export function makePalette(rgb, mode) {
  const sgr = new Array(LEVELS);
  for (let l = 0; l < LEVELS; l++) sgr[l] = sgrFor(rgb, l, mode);
  return { key: `${mode}:${rgb[0]},${rgb[1]},${rgb[2]}`, sgr };
}
