// Red Light, Rain: the street outside. The far buildings (a strip that repeats every PERIOD columns and slides left from 62 s), the
// zebra crossing, the pedestrian under an umbrella and the reflections of the light on the wet road.
import { rnd } from '../../../src/scenes/simrng.js';
import { put } from './canvas.js';
import { hash } from './hash.js';
import { inZone } from './dash.js';
import { FAR, MAG, SUN, VIOLET } from './palette.js';
import { REFLECTIONS, reflColour } from './bokeh.js';

const cp = (ch) => ch.codePointAt(0);

export const PERIOD = 144;
export const SLIDE_AT = 1860; // step 62 s
export const SLIDE_EVERY = 6; // steps: a column per 0.2 s
export const PED_EVERY = 12; // steps: a column per 0.4 s
export const PED_GAP = 20; // columns of nobody between one crossing and the next

// One strip of buildings: a height and a building start for every column of the period. Seeded, drawn from the sim's generator.
export function makeBuildings(s, L) {
  const h = [], st = [];
  let x = 0;
  while (x < PERIOD) {
    let w = 7 + Math.floor(rnd(s) * 9);
    if (PERIOD - x - w < 7) w = PERIOD - x;
    const ht = L.bMin + Math.floor(rnd(s) * (L.bMax - L.bMin + 1));
    for (let i = 0; i < w; i++) { h.push(ht); st.push(x); }
    x += w;
  }
  return { h, st };
}

// How many columns the strip has slid by step n: none until 62 s, then one at 62 s and one more every 6 steps.
export const slideAt = (n) => (n >= SLIDE_AT ? 1 + Math.floor((n - SLIDE_AT) / SLIDE_EVERY) : 0);

export function drawBuildings(cv, g, s) {
  const shift = slideAt(s.steps);
  for (let x = 0; x < g.W; x++) {
    const u = (x + shift) % PERIOD;
    const ht = s.bh[u];
    for (let r = 0; r < ht; r++) {
      const y = g.bb - ht + 1 + r;
      if (inZone(g, x, y)) continue; // the light hangs in a gap
      const k = u - s.bs[u];
      const lit = r % 2 === 1 && r < ht - 1 && k % 3 === 1 && hash(s.bs[u], u, r) % 100 < 30;
      put(cv, x, y, lit ? cp('▪') : cp('█'), lit ? SUN[0] : FAR);
    }
  }
}

// The crossing: a dashed line of ═ across the street, and nobody on it between crossings.
export function drawZebra(cv, g) {
  for (let x = g.pedX0 - 2; x <= g.pedX0 + g.span + 2; x++) if ((x - g.pedX0 + 2) % 4 !== 3) put(cv, x, g.zebraRow, cp('═'), VIOLET[0]);
}

// The pedestrian: an umbrella (mag.2) over a body in far silhouette, stepping a column every 0.4 s and swapping its legs on each step.
export function drawPed(cv, g, n) {
  const k = Math.floor(n / PED_EVERY);
  const p = k % (g.span + PED_GAP);
  if (p >= g.span) return;
  const x = g.pedX0 + p, y = g.pedRow;
  put(cv, x, y, cp('▗'), MAG[2]);
  put(cv, x + 1, y, cp('▄'), MAG[2]);
  put(cv, x + 2, y, cp('█'), MAG[2]);
  put(cv, x + 3, y, cp('▄'), MAG[2]);
  put(cv, x + 4, y, cp('▖'), MAG[2]);
  put(cv, x + 2, y + 1, cp('█'), FAR);
  put(cv, x + 1, y + 2, cp(k % 2 === 0 ? '▟' : '▙'), FAR);
  put(cv, x + 3, y + 2, cp(k % 2 === 0 ? '▙' : '▟'), FAR);
}

// The light's reflections on the road, a few streaks per row under the pedestrian's crossing.
export function drawReflections(cv, g, n, name, seed) {
  const rows = REFLECTIONS[name];
  for (let j = 0; j < rows.length && j < g.reflRows; j++) {
    const row = [...rows[j]];
    const x0 = g.cx - Math.floor(row.length / 2);
    row.forEach((ch, i) => {
      const o = j * 6 + (hash(j, i, seed + 11) % 6);
      const col = reflColour(n, o);
      if (col !== 0) put(cv, x0 + i, g.reflTop + j, cp(ch), col);
    });
  }
}

