// Helpers for the shelf scrub suites (DRIFT-7 item 2b): press schedules and a driver that plays them against a library shell the
// way the app does (one tick and one frame per 1/18 s; the presses that fall in an interval arrive before its frame, with no tick
// between them).
import { createFlashMeter } from './helpers-flash.js';
import { foilRoot, foilShell, copyOf, DT, FPS } from './helpers-foil.js';

export { DT, FPS, foilRoot, foilShell, copyOf };
export const ORDER = ['aaa', 'foil-a', 'foil-b', 'zzz'];
export const SIZES = [[120, 40], [80, 24], [240, 67], [88, 39], [176, 58], [78, 24]];
export const KEY = { next: 'libNext', prev: 'libPrev' };

// a key held down: the first press, then repeats every `rate` s after `delay` s, until `until`; dir 'next' / 'prev' / 'alt' (alternating)
export function heldPresses({ start = 0.5, delay = 0.3, rate = 0.03, until = 3.5, dir = 'next' } = {}) {
  const out = [[start, dir === 'prev' ? 'prev' : 'next']];
  let n = 1;
  for (let t = start + delay; t < start + until - 1e-9; t += rate) out.push([t, dir === 'alt' ? (n++ % 2 ? 'prev' : 'next') : dir]);
  return out;
}
// n presses `gap` s apart from `start`
export function burstPresses({ start = 0.5, n = 5, gap = 0.03, dir = 'next' } = {}) {
  return Array.from({ length: n }, (_, k) => [start + k * gap, dir === 'alt' ? (k % 2 ? 'prev' : 'next') : dir]);
}

// Play `presses` ([[seconds, 'next' | 'prev'], ...] sorted) for `seconds`. onFrame(frame, k, clock, sh) gets every frame after its presses.
// Returns { sh, log } where log[i] = { t, dir, indexAfter } (the cursor right after each press).
export function play(sh, presses, seconds, { onFrame = null, offset = 0 } = {}) {
  if (offset > 0) sh.tick(offset);
  const log = [];
  let next = 0;
  const at = () => ORDER.indexOf(sh.state().cartridge);
  for (let k = 0, clock = 0; k < Math.round(seconds * FPS); k++, clock = k * DT) {
    while (next < presses.length && presses[next][0] <= clock + 1e-9) {
      const [t, dir] = presses[next++];
      sh.actions[KEY[dir]]();
      log.push({ t, dir, indexAfter: at() });
    }
    if (onFrame) onFrame(sh.frame(), k, clock, sh);
    sh.tick(DT);
  }
  return { sh, log };
}

// The flash meter's report for a press schedule on the foil shelf (`seconds` long), at 1x
export function walkReport(cols, rows, presses, { art = 'dense', withFoil = true, seconds = 6, offset = 0, select = 'aaa', shellOpts = {} } = {}) {
  const { sh } = foilShell(cols, rows, { root: foilRoot({ withFoil, art }), select, shellOpts });
  const meter = createFlashMeter(cols, rows, FPS);
  const r = play(sh, presses, seconds, { onFrame: (f) => meter.push(f), offset });
  return { rep: meter.report(), log: r.log, sh };
}

export const pc = (x) => (x * 100).toFixed(2);
export const showRep = (rep) => `L1 ${pc(rep.l1.x1.worstFraction)} L2 ${pc(rep.l2.x1.worstFraction)} L3 ${pc(rep.l3.worstFraction)} R ${pc(rep.r.x1.worstFraction)}`;
export const passes1x = (rep) => rep.l1.x1.pass && rep.l2.x1.pass && rep.l3.pass && rep.r.x1.pass;

// ---- lone presses: the frames must be exactly what 4d2f8da drew (tests/fixtures/shelf-lone-press-4d2f8da.json)
//
// A hash of what the terminal would show for a frame: every cell's glyph and the SGR string of its shade (or its fg/bg for a
// full-colour cell), so a renumbered palette entry with the same colour hashes the same and a changed colour does not.
import crypto from 'node:crypto';
export function frameHash(f) {
  const h = crypto.createHash('sha256');
  const sgr = f.palette.sgr;
  const parts = [];
  for (let i = 0; i < f.glyphs.length; i++) {
    const g = f.glyphs[i];
    if (g === 32) { parts.push(' '); continue; }
    const s = f.shades[i];
    parts.push(String.fromCharCode(g) + (s === 255 ? `#${f.fg[i]},${f.bg[i]}` : sgr[s]));
  }
  h.update(parts.join('|'));
  return h.digest('hex').slice(0, 12);
}

// four lone presses 1.5 s apart (next, next, prev, next), 8 s of frames: the hash of every frame
export const LONE_PRESSES = [[1, 'next'], [2.5, 'next'], [4, 'prev'], [5.5, 'next']];
export function loneRun(cols, rows, art) {
  const { sh } = foilShell(cols, rows, { root: foilRoot({ art }), select: 'aaa' });
  const hashes = [];
  play(sh, LONE_PRESSES, 8, { onFrame: (f) => hashes.push(frameHash(f)) });
  return hashes;
}

// ---- reading what a frame says about the cursor (the position dots, the console screen / list, the card on show)
import { shelfLayout } from '../src/shell/library.js';
import { sizeTier } from '../src/shell/ui.js';
// (the console screen's idle scanline puts a faint light shade ░ in the blank cells of a row; read it as a blank)
const rowText = (f, y, x, w) => { let o = ''; for (let k = 0; k < w && x + k < f.cols; k++) o += String.fromCharCode(f.glyphs[y * f.cols + x + k] || 32); return o.replace(/░/g, ' '); };
// -> { dot: index the dots (or "k / n") point at | -1, name: the selected cartridge's name on the console screen (full) or in the list (compact), plate: the name on the card in the slot }
export function readShelf(f, titles) {
  const tier = sizeTier(f.cols, f.rows);
  const L = shelfLayout(f.cols, f.rows, tier);
  const n = titles.length;
  let dot = -1, name = '';
  if (tier === 'full') {
    const row = rowText(f, L.dotsY, 0, f.cols);
    const pos = row.indexOf('●');
    if (pos >= 0) dot = (pos - row.search(/\S/)) / 2;
    else { const m = /(\d+) \/ (\d+)/.exec(row); if (m) dot = Number(m[1]) - 1; }
    name = rowText(f, L.consoleTop + 4, L.consoleX + 4, 44).trim();
  } else if (tier === 'compact') {
    const m = /(\d+) \/ (\d+)/.exec(rowText(f, L.cartTop, L.listX, L.listW));
    if (m) dot = Number(m[1]) - 1;
    for (let y = L.cartTop + 2; y < L.cartTop + 9 && !name; y++) { const t = rowText(f, y, L.listX, L.listW); if (t.startsWith('▶ ')) name = t.slice(2).trim(); }
  }
  const plate = rowText(f, L.cartTop + 14, L.cartX + 3, 19).trim();
  return { tier, dot, name, plate, n };
}
// does the frame say the cursor is on cartridge i (dots and name)? titles = the shelf's titles in order
export const saysCursor = (f, titles, i) => {
  const r = readShelf(f, titles);
  return r.dot === i && r.name.toUpperCase().startsWith(titles[i].toUpperCase());
};
export const platesCard = (f, titles, i) => readShelf(f, titles).plate.toUpperCase() === titles[i].toUpperCase().slice(0, 19);
