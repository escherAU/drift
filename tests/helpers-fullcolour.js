// Fixtures for the full-colour plumbing suites (DRIFT-7 C3b): one full-colour (rgb: true) cells scene and one palette
// scene, both pure in t (so a dissolve between them is checkable cell by cell), plus the cell comparison they share.
import { renderScene } from '../src/cells.js';

export const RGB_CELL = 255;
export const GLOW_GLYPH = 88; // X
export const PLAIN_GLYPH = 111; // o
export const PLAIN_SHADE = 3;
export const GLOW_PAL_SHADE = 7; // every 5th cell of the glow scene is a palette cell (index 7)

// 0xRRGGBB with the two low bits of each channel clear (the renderer drops them), different per cell
export const glowFg = (i) => ((((i * 37 + 11) & 0xfc) << 16) | (((i * 91 + 5) & 0xfc) << 8) | ((i * 53 + 3) & 0xfc)) >>> 0;
export const glowBg = (i) => ((((i * 29 + 7) & 0xfc) << 16) | (((i * 17 + 9) & 0xfc) << 8) | ((i * 61 + 1) & 0xfc)) >>> 0;

// A full-colour cells scene. It never writes colours for its full-colour cells: the composer pre-fills them with
// RGB_CELL. It records the buffers it was given (the pooled-buffer test reads them).
export function makeGlow(record = null) {
  const glow = (t, w, h, params) => {
    if (record) record.push({ g: params.glyphs, c: params.colours, fg: params.fg, bg: params.bg });
    const n = w * h;
    for (let i = 0; i < n; i++) {
      params.glyphs[i] = GLOW_GLYPH;
      if (i % 5 === 3) params.colours[i] = GLOW_PAL_SHADE;
      else { params.fg[i] = glowFg(i); params.bg[i] = glowBg(i); }
    }
  };
  glow.id = 'glow'; glow.kind = 'cells'; glow.rgb = true;
  return glow;
}

// A palette scene: it writes every glyph and every colour, and never touches fg/bg.
export function makePlain() {
  const plain = (t, w, h, params) => {
    const n = w * h;
    for (let i = 0; i < n; i++) { params.glyphs[i] = PLAIN_GLYPH; params.colours[i] = PLAIN_SHADE; }
  };
  plain.id = 'plain'; plain.kind = 'cells';
  return plain;
}

// One frame of a scene as { glyphs, shades, fg, bg } (what the cell composer would hold).
export function sceneFrame(scene, w, h) {
  const f = renderScene(scene, 0, w, h, 1);
  return { glyphs: f.glyphs, shades: f.colours, fg: f.fg, bg: f.bg };
}

// Does cell i of `f` equal cell i of `r` as a whole: glyph, shade and, for a full-colour cell, fg and bg?
export function sameCell(f, r, i) {
  if (f.glyphs[i] !== r.glyphs[i] || f.shades[i] !== r.shades[i]) return false;
  if (f.shades[i] === RGB_CELL && (f.fg[i] !== r.fg[i] || f.bg[i] !== r.bg[i])) return false;
  return true;
}

// Every cell of `out` is a whole cell of A or of B. -> { a, b, bad: first index that is neither, or -1 }
export function pickCounts(out, A, B) {
  let a = 0, b = 0, bad = -1;
  for (let i = 0; i < out.glyphs.length; i++) {
    if (sameCell(out, A, i)) a++;
    else if (sameCell(out, B, i)) b++;
    else if (bad < 0) bad = i;
  }
  return { a, b, bad };
}

// A tiny terminal: applies the renderer's output (cursor moves, CLEAR, RESET, 38;2 / 48;2 colours, printable text) to a
// grid so a test can compare what the screen WOULD show with the frame the app drew. 24-bit colours only.
export function makeScreen(cols, rows) {
  const ch = new Uint16Array(cols * rows).fill(32), fg = new Int32Array(cols * rows).fill(-1), bg = new Int32Array(cols * rows).fill(-1);
  let cx = 0, cy = 0, cf = -1, cb = -1;
  const rgb = (a, i) => ((a[i] << 16) | (a[i + 1] << 8) | a[i + 2]) >>> 0;
  function write(s) {
    s = String(s).replace(/\x1b\[\?2026[hl]/g, '');
    for (let i = 0; i < s.length;) {
      if (s[i] === '\x1b' && s[i + 1] === '[') {
        const m = /^\x1b\[([?0-9;]*)([A-Za-z])/.exec(s.slice(i, i + 64));
        if (!m) throw new Error('bad escape at ' + i);
        const nums = m[1] === '' ? [] : m[1].split(';').map(Number);
        if (m[1].startsWith('?')) { /* a private mode (cursor, alternate screen): not part of the picture */ } else if (m[2] === 'J') { ch.fill(32); fg.fill(-1); bg.fill(-1); } else if (m[2] === 'H') { cy = (nums[0] || 1) - 1; cx = (nums[1] || 1) - 1; } else if (m[2] === 'm') {
          if (nums.length === 0) nums.push(0);
          for (let k = 0; k < nums.length;) {
            if (nums[k] === 0) { cf = -1; cb = -1; k++; } else if (nums[k] === 38 && nums[k + 1] === 2) { cf = rgb(nums, k + 2); k += 5; } else if (nums[k] === 48 && nums[k + 1] === 2) { cb = rgb(nums, k + 2); k += 5; } else k++;
          }
        } else throw new Error('unhandled CSI ' + m[0].slice(1));
        i += m[0].length;
        continue;
      }
      const idx = cy * cols + cx;
      if (idx >= 0 && idx < ch.length && cx < cols) { ch[idx] = s.charCodeAt(i); fg[idx] = cf; bg[idx] = cb; }
      cx++; i++;
    }
  }
  return { write, ch, fg, bg };
}
