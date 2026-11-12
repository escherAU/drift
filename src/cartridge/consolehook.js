// The cartridge side of the console hook (DRIFT-7 C11): what console.js must export, and the smoke render the loader runs on it.
//
// A cartridge with "console": "code" in its (format 2, install folder) manifest ships console.js, whose default export is
//
//   { id: 'name', drawConsole(frame, { phase, p, t, rect, screen, tier }) }
//
// drawConsole is pure: the same arguments draw the same cells, it keeps no state and it writes only inside ctx.rect of the
// frame. It draws the console BODY in full colour: a cell with shade 255 (RGB_CELL) takes its colours from frame.fg and
// frame.bg (0xRRGGBB; a bg of PALETTE_BG means "the palette's background"); a palette shade below 20 (the console's own
// colours) is also allowed; a blank cell is glyph 32 with shade 0, or shade 255 for a coloured background. The screen's text
// and the LEDs are the shell's and are drawn over whatever the hook leaves there. The context is documented where the shell
// builds it (drawHookBody in src/shell/library.js); insert.js and boot.js give p its values.
//
// The loader imports console.js only for an install-folder cartridge (the same wall as scene code), then calls checkConsoleExport
// and smokeConsole. A problem is an error on the whole cartridge, so it shows on the boot's error card and nothing is inserted.
import { newFrame } from '../shell/ui.js';
import { CONSOLE_W, CONSOLE_H, MINI_W, MINI_H } from '../shell/library.js';
import { isAllowedGlyph } from '../glyphs.js';
import { RGB_CELL, PALETTE_BG } from '../renderer.js';

export const CONSOLE_PHASES = Object.freeze(['insert', 'boot', 'eject']);
export const CONSOLE_PALETTE_SHADES = 20; // the console's own palette entries (silver 0-15, amber, cyan, graphite, dim)
export const SMOKE_MARGIN = 4; // cells of frame around the rect in the smoke render, so a write outside the rect is seen
export const SMOKE_MS = 250; // one smoke call may take this long at most; a hook cannot be interrupted, so a slow one is refused after it returns

const NAME = 'console.js';
const errText = (e) => (e && e.message ? String(e.message).split('\n')[0] : String(e));
const hex = (n) => '0x' + n.toString(16).toUpperCase();

export function checkConsoleExport(mod) {
  const h = mod && mod.default;
  if (!h || typeof h !== 'object' || Array.isArray(h)) return `${NAME}: the default export must be an object { id, drawConsole }`;
  if (typeof h.id !== 'string' || h.id.length === 0) return `${NAME}: the default export needs an id (a non-empty string)`;
  if (typeof h.drawConsole !== 'function') return `${NAME}: the default export needs a drawConsole function`;
  return null;
}

const snap = (f) => ({ glyphs: f.glyphs.slice(), shades: f.shades.slice(), fg: f.fg.slice(), bg: f.bg.slice() });
const same = (a, b) => {
  for (let i = 0; i < a.glyphs.length; i++) if (a.glyphs[i] !== b.glyphs[i] || a.shades[i] !== b.shades[i] || a.fg[i] !== b.fg[i] || a.bg[i] !== b.bg[i]) return false;
  return true;
};

// What is wrong with the cells inside the rect (a message) or null.
function badCell(f, i) {
  const g = f.glyphs[i], s = f.shades[i];
  if (!isAllowedGlyph(g)) return `drew U+${g.toString(16).toUpperCase().padStart(4, '0')}, which is not an allowed glyph`;
  if (s === RGB_CELL) {
    if (f.fg[i] > 0xFFFFFF) return `drew a full-colour cell with fg ${hex(f.fg[i])}, which is past 0xFFFFFF`;
    if (f.bg[i] > 0xFFFFFF && f.bg[i] !== PALETTE_BG) return `drew a full-colour cell with bg ${hex(f.bg[i])}, which is past 0xFFFFFF (PALETTE_BG is the only larger value)`;
    return null;
  }
  if (g === 32 && s !== 0) return `drew a blank cell with shade ${s} (a blank cell is shade 0, or 255 for a coloured background)`;
  if (s >= CONSOLE_PALETTE_SHADES) return `drew shade ${s}, which is neither a full-colour cell (255) nor one of the console's ${CONSOLE_PALETTE_SHADES} palette colours`;
  return null;
}

// Render the hook at the two console sizes, in a few phases and morph values, in a frame with a margin round the rect:
// it must not throw, take too long, write outside the rect, draw an invalid cell, or draw different cells on a second identical call.
export function smokeConsole(hook) {
  const M = SMOKE_MARGIN;
  const calls = [['insert', 0], ['insert', 0.25], ['insert', 0.55], ['boot', 0.55], ['boot', 0.8], ['boot', 1], ['eject', 0.3]];
  for (const [tier, w, h] of [['full', CONSOLE_W, CONSOLE_H], ['mini', MINI_W, MINI_H]]) {
    const rect = { x: M, y: M, w, h };
    const screen = tier === 'full' ? { x: M + 3, y: M + 4, w: 46, h: 9 } : null;
    const where = `${NAME}: smoke render at ${w}x${h}`;
    for (const [phase, p] of calls) {
      const t = phase === 'boot' ? 0.3 : 1.2;
      const run = () => {
        const f = newFrame(w + 2 * M, h + 2 * M);
        const before = snap(f);
        const bufs = [f.glyphs, f.shades, f.fg, f.bg];
        const ctx = { phase, p, t, rect: { ...rect }, screen: screen ? { ...screen } : null, tier };
        const t0 = Date.now();
        try { hook.drawConsole(f, ctx); } catch (e) { return { error: `${where} threw: ${errText(e)}` }; }
        const ms = Date.now() - t0;
        if (ms > SMOKE_MS) return { error: `${where} took ${ms} ms (${phase}, p ${p}); a console hook must draw in a few milliseconds` };
        if (f.glyphs !== bufs[0] || f.shades !== bufs[1] || f.fg !== bufs[2] || f.bg !== bufs[3]) return { error: `${where} replaced the frame's buffers` };
        for (let y = 0; y < f.rows; y++) {
          for (let x = 0; x < f.cols; x++) {
            const i = y * f.cols + x;
            const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
            if (inside) {
              const bad = badCell(f, i);
              if (bad) return { error: `${where} ${bad} (${phase}, p ${p})` };
            } else if (f.glyphs[i] !== before.glyphs[i] || f.shades[i] !== before.shades[i] || f.fg[i] !== before.fg[i] || f.bg[i] !== before.bg[i]) {
              return { error: `${where} wrote outside its rect, at column ${x}, row ${y} of the frame (${phase}, p ${p})` };
            }
          }
        }
        return { f };
      };
      const a = run();
      if (a.error) return a.error;
      const b = run();
      if (b.error) return b.error;
      if (!same(snap(a.f), snap(b.f))) return `${where} is not pure: two identical calls (${phase}, p ${p}) drew different cells`;
    }
  }
  return null;
}
