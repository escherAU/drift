// Shared checks for Night Drive's cells scenes (DRIFT-5): a frame helper, the walk over consecutive frames at 1x and 4x, the ramp rule (a cell
// that keeps its glyph moves one shade step at most, inside one colour family, and no more than 28 L* in brightness), and the calm run that
// reads every frame of 90 s for glyphs, colours, blanks and the share of cells that change. Each check throws through assert, so a control
// can prove it bites with assert.throws or by counting violations.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { lstarTable, SHADE_STEP_LSTAR } from './helpers-flash.js';
import { FAMILIES, COUNT } from '../cartridges/night-drive/lib/palette.js';

export const FPS = 18;
export const BANNED = [0x25cd, 0x25ce, 0x25d1, 0x25e2, 0x25e3, 0x222b, 0x2261, 0x25d0, 0x25d3, 0x25d2]; // the brief's banned set plus the wheel circles
export const cp = (ch) => ch.codePointAt(0);

const found = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
const cart = found.cartridges.find((c) => c.id === 'night-drive');
assert.ok(cart, 'night-drive is on the shelf');
export const MANIFEST = JSON.parse(fs.readFileSync(path.join(INSTALL_DIR, 'night-drive', 'manifest.json'), 'utf8'));
export const LTAB = lstarTable(makeSkinPalette(cart.skin, 'truecolor', 'night-drive'));

// A frame maker for a scene: (t, w, h, seed, t0) -> { g, c, w, h }
export function framer(scene) {
  return (t, w = 120, h = 40, seed = 1, t0) => {
    const g = new Uint16Array(w * h), c = new Uint8Array(w * h);
    scene(t, w, h, { seed, glyphs: g, colours: c, ...(t0 !== undefined ? { t0 } : {}) });
    return { g, c, w, h };
  };
}

export const rowText = (f, y) => String.fromCharCode(...f.g.slice(y * f.w, (y + 1) * f.w));
export function cellsOf(f, ch, col) {
  const out = [];
  for (let i = 0; i < f.g.length; i++) {
    if (f.g[i] === cp(ch) && (col === undefined || (Array.isArray(col) ? col.includes(f.c[i]) : f.c[i] === col))) out.push([i % f.w, Math.floor(i / f.w)]);
  }
  return out;
}

export const familyOf = (col) => Object.entries(FAMILIES).find(([, f]) => f.includes(col));

// Cells that kept a glyph (not blank) and broke the ramp rule between frames a and b. Returns the list of broken cells.
export function rampViolations(a, b) {
  const bad = [];
  for (let i = 0; i < a.g.length; i++) {
    if (a.g[i] === 32 || a.g[i] !== b.g[i] || a.c[i] === b.c[i]) continue;
    const fa = familyOf(a.c[i]), fb = familyOf(b.c[i]);
    if (fa && fb && (fa[0] !== fb[0] || Math.abs(fa[1].indexOf(a.c[i]) - fb[1].indexOf(b.c[i])) !== 1)) bad.push({ i, why: 'family or more than one shade', from: a.c[i], to: b.c[i] });
    else if (Math.abs(LTAB[a.c[i]] - LTAB[b.c[i]]) > SHADE_STEP_LSTAR) bad.push({ i, why: 'brightness', from: a.c[i], to: b.c[i] });
  }
  return bad;
}

export function changedShare(a, b) {
  let n = 0;
  for (let i = 0; i < a.g.length; i++) if (a.g[i] !== b.g[i] || a.c[i] !== b.c[i]) n++;
  return n / a.g.length;
}

// Every frame of `seconds` of the scene at `speed`x (the clock advances speed/18 s a frame), with each(prev, cur, t).
export function walk(frame, w, h, speed, seconds, each, seed = 1) {
  let prev = frame(0, w, h, seed);
  const total = Math.ceil((seconds * FPS) / speed);
  for (let k = 1; k <= total; k++) {
    const t = (k * speed) / FPS;
    const cur = frame(t, w, h, seed);
    each(prev, cur, t);
    prev = cur;
  }
}

const okGlyph = new Map();
const allowed = (g) => { let v = okGlyph.get(g); if (v === undefined) { v = isAllowedGlyph(g); okGlyph.set(g, v); } return v; };

// The calm run: 90 s at `speed`x, every frame. Returns { worst, at, ramp, firstRamp, glyphBad, colourBad, blankBad, banned, lit }.
export function calmRun(frame, w, h, speed, seconds = 90) {
  const r = { worst: 0, at: 0, ramp: 0, firstRamp: null, glyphBad: 0, colourBad: 0, blankBad: 0, banned: 0, litMin: Infinity };
  const scanFrame = (f) => {
    let lit = 0;
    for (let i = 0; i < f.g.length; i++) {
      const g = f.g[i], c = f.c[i];
      if (g === 32) { if (c !== 0) r.blankBad++; continue; }
      lit++;
      if (!allowed(g)) r.glyphBad++;
      if (BANNED.includes(g)) r.banned++;
      if (c < 16 || c >= COUNT) r.colourBad++; // colour 0 to 15 is the hue ramp: Night Drive draws with the fixed families only
    }
    if (lit < r.litMin) r.litMin = lit;
  };
  let first = true;
  walk(frame, w, h, speed, seconds, (a, b, t) => {
    if (first) { scanFrame(a); first = false; }
    scanFrame(b);
    const s = changedShare(a, b);
    if (s > r.worst) { r.worst = s; r.at = t; }
    const v = rampViolations(a, b);
    if (v.length) { r.ramp += v.length; if (!r.firstRamp) r.firstRamp = { t, ...v[0] }; }
  });
  return r;
}

export function meanMs(fn, n) {
  fn(0); fn(1);
  const t0 = performance.now();
  for (let k = 0; k < n; k++) fn(k * 0.37);
  return (performance.now() - t0) / n;
}
