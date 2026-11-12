// Fixtures for the Driftman 9000 console hook (DRIFT-7 C13): the hook called directly, and a real shell with the installed 9000.
import { newFrame } from '../src/shell/ui.js';
import { createShell } from '../src/shell/shell.js';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';
import { luminanceOf, glyphCoverage } from './helpers-flash.js';
import hook from '../cartridges/driftman-9000/console.js';

export { hook };
export const FPS = 18;
export const DT = 1 / FPS;
export const FULL = Object.freeze({ tier: 'full', w: 84, h: 18 });
export const MINI = Object.freeze({ tier: 'mini', w: 38, h: 4 });
export const PALETTE_BG = 0x1000000;
export const RGB_CELL = 255;
export const MARGIN = 4;
export const BG_RGB = 0x0A0C10; // the console palette's background, which PALETTE_BG stands for in direct calls
export const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

export const screenOf = (tier, x, y) => (tier === 'full' ? { x: x + 3, y: y + 4, w: 46, h: 9 } : null);

// The hook drawn into a fresh frame with a margin round the rect. -> { f, rect, ctx }
export function drawHook(size, phase, p, t, margin = MARGIN) {
  const rect = { x: margin, y: margin, w: size.w, h: size.h };
  const f = newFrame(size.w + 2 * margin, size.h + 2 * margin);
  const ctx = { phase, p, t, rect: { ...rect }, screen: screenOf(size.tier, margin, margin), tier: size.tier };
  hook.drawConsole(f, ctx);
  return { f, rect, ctx };
}

export const snapshot = (f) => ({ glyphs: f.glyphs.slice(), shades: f.shades.slice(), fg: f.fg.slice(), bg: f.bg.slice(), cols: f.cols, rows: f.rows });

// The console's cells only (rect-local), as a snapshot of w x h.
export function localCells(d) {
  const { f, rect } = d;
  const w = rect.w, h = rect.h;
  const out = { glyphs: new Uint16Array(w * h), shades: new Uint8Array(w * h), fg: new Uint32Array(w * h), bg: new Uint32Array(w * h), cols: w, rows: h };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (rect.y + y) * f.cols + rect.x + x, o = y * w + x;
      out.glyphs[o] = f.glyphs[s]; out.shades[o] = f.shades[s]; out.fg[o] = f.fg[s]; out.bg[o] = f.bg[s];
    }
  }
  return out;
}

// Brightness Y of one cell with the meter's own rule (coverage * Y(fg) + (1 - coverage) * Y(bg)).
export function cellY(c, i, bgRgb = BG_RGB) {
  const g = c.glyphs[i];
  if (c.shades[i] !== RGB_CELL) return 0;
  const f = c.fg[i], b = c.bg[i] === PALETTE_BG ? bgRgb : c.bg[i];
  const cov = glyphCoverage(g);
  return cov * luminanceOf(f) + (1 - cov) * luminanceOf(b);
}

export const textAt = (c, x, y, n) => { let s = ''; for (let k = 0; k < n; k++) s += String.fromCodePoint(c.glyphs[y * c.cols + x + k]); return s; };

// Number of cells that differ (glyph, shade, fg or bg) between two snapshots of the same size.
export function changedCells(a, b) {
  let n = 0;
  for (let i = 0; i < a.glyphs.length; i++) {
    if (a.glyphs[i] !== b.glyphs[i] || a.shades[i] !== b.shades[i]) { n++; continue; }
    if (a.shades[i] === RGB_CELL && (a.fg[i] !== b.fg[i] || a.bg[i] !== b.bg[i])) n++;
  }
  return n;
}

// ---- a real shell with the installed Driftman 9000 inserted (screen 'insert' at t = 0)
const HOST = { persist() {}, quit() {}, leaveToClassic() {} };
const SPEEDS = [1, 2, 3, 4];
export function shell9000(cols, rows, { withHook = true } = {}) {
  const d = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
  if (d.errors.length) throw new Error('install cartridges refused: ' + JSON.stringify(d.errors));
  const sh = createShell({
    cols, rows, cartridges: d.cartridges, seed: 1, cmode: 'truecolor', host: HOST,
    consts: { SPEEDS, DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 },
    start: { cartridge: 'driftman-9000' },
    ...(withHook ? {} : { loadScenes: async (cart) => { const { loadScenes } = await import('../src/cartridge/loader.js'); const r = await loadScenes(cart); const { console: _c, ...rest } = r; return rest; } }),
  });
  return sh;
}

// One frame of the shell, copied.
export function copyFrame(f) {
  return { glyphs: f.glyphs.slice(), shades: f.shades.slice(), fg: f.fg ? f.fg.slice() : null, bg: f.bg ? f.bg.slice() : null, palette: f.palette, cols: f.cols, rows: f.rows };
}

// The hook's real call sequence in a real shell: every (phase, p, t) the shell drew, through insert + boot, and through the eject.
// -> { up: [{ phase, p, t }], down: [{ phase, p, t }], tier }
export async function recordCalls(cols, rows) {
  const { loadScenes } = await import('../src/cartridge/loader.js');
  const log = [];
  const d = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
  const sh = createShell({
    cols, rows, cartridges: d.cartridges, seed: 1, cmode: 'truecolor', host: HOST,
    consts: { SPEEDS, DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 },
    start: { cartridge: 'driftman-9000' },
    loadScenes: async (cart) => {
      const r = await loadScenes(cart);
      if (!r.console) return r;
      const inner = r.console;
      return { ...r, console: { id: inner.id, drawConsole(f, c) { log.push({ phase: c.phase, p: c.p, t: c.t, tier: c.tier }); return inner.drawConsole(f, c); } } };
    },
  });
  await flush();
  for (let k = 0; k < 400 && sh.state().screen !== 'running'; k++) { sh.frame(); sh.tick(DT); }
  const mark = log.length;
  for (let k = 0; k < 10; k++) { sh.frame(); sh.tick(DT); }
  sh.key('e');
  for (let k = 0; k < 400 && sh.state().screen === 'eject'; k++) { sh.frame(); sh.tick(DT); }
  const tier = log.length ? log[0].tier : 'full';
  return { up: log.slice(0, mark), down: log.slice(mark), tier };
}

// The sizes the console is drawn at, and the sizes just above each layout breakpoint (full 88x39, extra-large 176x58, compact 78x24).
export const SIZES = [[120, 40], [80, 24], [240, 67], [88, 39], [176, 58], [78, 24]];
