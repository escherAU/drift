// DRIFT-13: the flash governor (src/governor.js) judged by the REAL flash meter (tests/helpers-flash.js, every rule on both grids), on the palette-index route with the real
// two-tone palette of Classic high contrast (src/color.js makeTwoTone: one entry, white on black), so luminance is real: a glyph's ink coverage is its brightness.
//
// runArm drives one timeline the way tests/helpers-life-app.js reads the real app: the app's own loop schedule on a clock from tests/helpers-clock.js ('grid', 'q156', 'jitter';
// createClock(...).ticks(fps, seconds) is the fire times the app's loop would get) paints at those times, and the meter reads the screen on the fps grid (read j at j / fps, seeing every
// paint at or before it). An ADVERSARY is the composed frame the scenes would hand the governor; the governor (or, for the control, nothing) turns it into what is painted.
import { createGovernor } from '../src/governor.js';
import { makeTwoTone } from '../src/color.js';
import { createFlashMeter, failedRules, X1_RULE_IDS, ruleOf, meterStats } from './helpers-flash.js';
import { createClock } from './helpers-clock.js';

export const SP = 32, FULL = 0x2588;
export const PALETTE = makeTwoTone(false, 'truecolor');
export const GLYPHS = [32, FULL, 0x2580, 0x2584, 0x2591, 0x2592, 0x2593, 0x23]; // ink coverage 0, 1, .5, .5, .25, .5, .75, .35

const hash = (i, c) => { let x = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(c + 7, 0x85ebca6b); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return (x >>> 0) / 4294967296; };

// An adversary: (p, t, glyphs) fills `glyphs` (a persistent Uint16Array: cells it does not write keep their last value) for paint number p at time t seconds.
export function adversary(kind, cols, rows) {
  const n = cols * rows;
  switch (kind) {
    case 'flip': return (p, t, g) => g.fill(p & 1 ? FULL : SP); // every cell flips every paint
    case 'checker': return (p, t, g) => { for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) g[y * cols + x] = (x + y + p) & 1 ? FULL : SP; }; // a checkerboard strobe
    case 'noise': return (p, t, g) => { for (let i = 0; i < n; i++) g[i] = GLYPHS[Math.floor(hash(i, p) * GLYPHS.length)]; }; // random glyphs every paint
    case 'sweep': { // a band half the screen wide moves an eighth of the width a paint; cells in it flip every paint
      const bw = Math.max(1, Math.floor(cols / 2)), step = Math.max(1, Math.floor(cols / 8));
      return (p, t, g) => { const s = (p * step) % cols; for (let y = 0; y < rows; y++) for (let k = 0; k < bw; k++) { const i = y * cols + ((s + k) % cols); g[i] = g[i] === FULL ? SP : FULL; } };
    }
    case 'dissolve': // threshold flips 0 .. 1 over 2 s and back: every cell flips twice in 4 s, at a time of its own
      return (p, t, g) => { const ph = (t % 4) / 2, prog = ph < 1 ? ph : 2 - ph; for (let i = 0; i < n; i++) g[i] = hash(i, 0) < prog ? FULL : SP; };
    case 'lockstep56': // a 56-cell board (14 x 4: the meter's field at 40x10 .. 42x12) flips as one; the rest is blank
      return (p, t, g) => { g.fill(SP); const v = p & 1 ? FULL : SP; for (let y = 0; y < Math.min(4, rows); y++) for (let x = 0; x < Math.min(14, cols); x++) g[y * cols + x] = v; };
    default: throw new Error(`unknown adversary ${kind}`);
  }
}
export const ADVERSARIES = ['flip', 'checker', 'noise', 'sweep', 'dissolve', 'lockstep56'];
// the ones that must FAIL the meter ungoverned (the dissolve flips each cell twice in 4 s: it is the legal-looking case the others are judged against)
export const MUST_FAIL = ['flip', 'checker', 'noise', 'sweep', 'lockstep56'];

// One run. governor: false (the control: the target is painted as it is), or { variant, mod, timeScale }: mod is the governor module to use (a mutant), timeScale feeds the governor
// `now * timeScale` (the scene-time mutant: a scene clock that runs `speed` times real time).
// paintRate: paints per read (the app paints at the rate it was asked for, so 1; a rate above 1 is an adversary that paints faster than the viewer reads: some reads then catch two paints).
export function runArm({ cols, rows, fps, clock = 'grid', seed = 1, seconds = 20, kind, governor = { variant: 'nbhd' }, paintRate = 1 }) {
  const c = createClock({ mode: clock, seed });
  const ticks = c.ticks(fps * paintRate, seconds);
  const meter = createFlashMeter(cols, rows, fps);
  const n = cols * rows;
  const target = new Uint16Array(n).fill(SP), shades = new Uint8Array(n);
  const make = adversary(kind, cols, rows);
  const gov = governor ? (governor.mod ? governor.mod.createGovernor : createGovernor)({ cols, rows, fps, variant: governor.variant || 'nbhd' }) : null;
  const scale = governor && governor.timeScale ? governor.timeScale : 1;
  const frame = { cols, rows, glyphs: target, shades };
  let painted = frame, p = 0, ti = 0;
  const reads = Math.round(seconds * fps);
  for (let j = 1; j <= reads; j++) {
    const readMs = (j * 1000) / fps;
    while (ti < ticks.length && ticks[ti] <= readMs + 1e-6) {
      const t = ticks[ti] / 1000;
      make(p, t, target);
      if (gov) { const o = gov.govern(target, shades, t * scale); painted = { cols, rows, glyphs: o.glyphs, shades: o.shades }; } else painted = frame;
      p++; ti++;
    }
    meter.push(painted, PALETTE);
  }
  return { rep: meter.report(), paints: p, reads, stats: gov ? gov.stats : null };
}

export const failed = (rep) => failedRules(rep, { only: X1_RULE_IDS });
export const numbers = (rep) => X1_RULE_IDS.map((id) => `${id} ${(ruleOf(rep, id).worstFraction * 100).toFixed(2)}`).join(' ');
export { meterStats };
