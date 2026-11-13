// Fixtures for the foil label suites (DRIFT-7 C12). Everything is built in temp folders as INSTALL-folder cartridges (trusted),
// so no cartridge folder is added to cartridges/. The cartridges are data-only (a builtin scene) with a dense 24 x 10 label and an
// ink file that uses all four brightness levels, so every label cell is a foil cell and every level is seen.
import fs from 'node:fs';
import path from 'node:path';
import { tmpRoot, writeCart, dataManifest } from './helpers-cartridge.js';
import { INSTALL_DIR } from '../src/cartridge/loader.js';
import { discoverCartridges } from '../src/cartridge/loader.js';
import { createShell } from '../src/shell/shell.js';

export const FPS = 18;
export const DT = 1 / FPS;

// Sam's five hues (the Driftman 9000 design, section 1)
export const SAM_HUES = ['#3FE8FF', '#A77BFF', '#FF4FD8', '#FFD36B', '#5CFFB8'];

// 10 rows of 24 allowed glyphs, none blank
const GLYPHS = ['█', '▓', '▒', '░', '#', '*', '+', '◆'];
export const DENSE_LABEL = Array.from({ length: 10 }, (_, y) => Array.from({ length: 24 }, (_, x) => GLYPHS[(x * 3 + y * 5) % GLYPHS.length]).join('')).join('\n') + '\n';
// ink digits 0..3 in a diagonal pattern: all four levels appear on every row
export const DENSE_INK = Array.from({ length: 10 }, (_, y) => Array.from({ length: 24 }, (_, x) => String((x + y) % 4)).join('')).join('\n') + '\n';

export function foilManifest(id, over = {}) {
  return dataManifest(id, { format: 2, title: 'Foil ' + id, labelHue: '#7FB069', code: 'FX-01', facts: ['one fact'], foil: { hues: SAM_HUES, style: 'holo' }, ...over });
}

// Write one cartridge with the dense label. `over` goes into the manifest (foil: undefined leaves the foil out).
export function writeFoilCart(root, id, over = {}, art = 'dense') {
  const m = foilManifest(id, over);
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  // art 'dense': every cell inked, all four levels; 'delza': the real shipped label and ink of Delza
  const label = art === 'delza' ? fs.readFileSync(path.join(INSTALL_DIR, 'delza', 'label.txt'), 'utf8') : DENSE_LABEL;
  const ink = art === 'delza' ? fs.readFileSync(path.join(INSTALL_DIR, 'delza', 'label-ink.txt'), 'utf8') : DENSE_INK;
  return writeCart(root, id, { 'manifest.json': m, 'label.txt': label, 'label-ink.txt': ink });
}

// A shelf (sorted by id): `aaa` plain, `foil-a` holo, `foil-b` sweep (a second foil next to the first, so a selected foil has a foil
// neighbour), `zzz` plain. withFoil false builds the same shelf with no foil anywhere (the baseline for "no worse than the plain label").
export function foilRoot({ withFoil = true, hues = SAM_HUES, art = 'dense' } = {}) {
  const root = tmpRoot('drift-foil-');
  writeFoilCart(root, 'aaa', { foil: undefined, labelHue: '#9DB8A8', code: 'FX-00' }, art);
  writeFoilCart(root, 'foil-a', { foil: withFoil ? { hues, style: 'holo' } : undefined, code: 'FX-01' }, art);
  writeFoilCart(root, 'foil-b', { foil: withFoil ? { hues: hues.slice().reverse(), style: 'sweep' } : undefined, labelHue: '#4ECDC4', code: 'FX-02' }, art);
  writeFoilCart(root, 'zzz', { foil: undefined, labelHue: '#CC8866', code: 'FX-03' }, art);
  return root;
}

export const HOST = { persist() {}, quit() {}, leaveToClassic() {} };

// -> { sh, carts } a library shell on the foil shelf, with the cursor on `select` (default foil-a), idle clock at 0
export function foilShell(cols, rows, { root = foilRoot(), select = 'foil-a', seed = 1, start = null, shellOpts = {}, cmode = 'truecolor' } = {}) {
  const d = discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
  if (d.errors.length) throw new Error('fixture cartridge refused: ' + JSON.stringify(d.errors));
  const sh = createShell({
    cols, rows, cartridges: d.cartridges, seed, cmode, host: HOST, lastCartridge: select,
    consts: { SPEEDS: [1, 2, 3, 4], DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 },
    ...(start ? { start } : {}),
    ...shellOpts,
  });
  return { sh, carts: d.cartridges };
}

export const copyOf = (f) => ({
  glyphs: f.glyphs.slice(), shades: f.shades.slice(), fg: f.fg ? f.fg.slice() : new Uint32Array(f.glyphs.length), bg: f.bg ? f.bg.slice() : new Uint32Array(f.glyphs.length),
  palette: f.palette, cols: f.cols, rows: f.rows,
});

export const sameFrame = (a, b) => {
  for (let i = 0; i < a.glyphs.length; i++) {
    if (a.glyphs[i] !== b.glyphs[i] || a.shades[i] !== b.shades[i]) return false;
    if (a.shades[i] === 255 && (a.fg[i] !== b.fg[i] || a.bg[i] !== b.bg[i])) return false;
  }
  return true;
};

// Run the library for `seconds` at DT, one frame per tick. -> frames (copies)
export function runFrames(sh, seconds, onTick = null) {
  const out = [];
  const n = Math.round(seconds * FPS);
  for (let k = 0; k < n; k++) {
    if (onTick) onTick(k, sh);
    out.push(copyOf(sh.frame()));
    sh.tick(DT);
  }
  return out;
}
