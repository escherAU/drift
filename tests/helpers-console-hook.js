// Fixtures for the console-hook suites (DRIFT-7 C11). Everything is built in temp folders as INSTALL-folder cartridges (trusted),
// so no cartridge folder is added to cartridges/. A hook is a console.js source string; the shell runs it through the real loader
// (import, export check, smoke render), exactly as it would a shipped one.
import { tmpRoot, writeCart, LABEL } from './helpers-cartridge.js';
import { discoverCartridges, loadScenes as realLoadScenes } from '../src/cartridge/loader.js';
import { createShell } from '../src/shell/shell.js';
import { driftmanSkin } from '../src/shell/driftman.js';

export const FPS = 18;
export const DT = 1 / FPS;
export const SPEEDS = [1, 2, 3, 4];
export const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

// A scene that draws nothing (all blank, palette 0): with it the running picture is dark, so a flash measure over the insert,
// boot and eject sees the console and nothing else.
export const DARK_SCENE = [
  'function dark(t, w, h, params) {',
  '  params.glyphs.fill(32);',
  '  params.colours.fill(0);',
  '}',
  "dark.id = 'dark';",
  "dark.kind = 'cells';",
  'export default dark;',
  '',
].join('\n');

export const CART_SKIN = { palette: { hue: '#7FB069', bg: '#0B140C' } };

export function manifestOf(id, over = {}) {
  return {
    format: 2, id, title: 'Hook ' + id, version: '1.0.0', author: 'Test', blurb: 'A cartridge with a console hook.', runtime: 'cartridge',
    labelHue: '#7FB069', console: 'code',
    scenes: [{ id: 'dark', kind: 'cells', title: 'Dark' }],
    programs: [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: ['dark'], sceneSeconds: 30 }],
    start: 'main',
    ...over,
  };
}

// Write one console cartridge into root and return its folder. `source` is console.js (null = no console.js file).
export function writeConsoleCart(root, id, { source, manifest = {}, skin = CART_SKIN, files = {} } = {}) {
  const f = { 'manifest.json': manifestOf(id, manifest), 'label.txt': LABEL, 'scenes/dark.js': DARK_SCENE, ...files };
  for (const k of Object.keys(f)) if (f[k] === null) delete f[k]; // files: { 'scenes/dark.js': null } leaves a file out
  if (skin) f['skin.json'] = skin;
  if (source !== null && source !== undefined) f['console.js'] = source;
  return writeCart(root, id, f);
}

// -> { root, cartridges, errors } for an install-folder (or, with trusted false, user-folder) discovery of one console cartridge
export function discoverConsoleCart(id, opts = {}, trusted = true) {
  const root = tmpRoot('drift-hook-');
  writeConsoleCart(root, id, opts);
  const d = discoverCartridges({ dirs: [{ dir: root, trusted }] });
  return { root, ...d };
}

// ---- hook sources (console.js text). No backslashes anywhere in them.

const COLOUR_LIB = [
  'const SR = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };',
  'const RS = (l) => { const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(s * 255))); };',
  // linear-light mix of two 0xRRGGBB colours: the luminance of the mix is the mix of the luminances
  'const mix = (a, b, p) => {',
  '  const ch = (sh) => RS(SR((a >> sh) & 255) + (SR((b >> sh) & 255) - SR((a >> sh) & 255)) * p);',
  '  return ((ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;',
  '};',
  'const PALETTE_BG = 0x1000000;',
];

// The body every fixture draws: the slot housing, the console frame, the screen bezel and the panel grille, as
// line glyphs; `line(p)` is the line colour and `fill(p)` the background of the cells between them (PALETTE_BG = none).
const BODY = [
  'function put(f, x, y, g, fg, bg) {',
  '  if (x < 0 || y < 0 || x >= f.cols || y >= f.rows) return;',
  '  const i = y * f.cols + x;',
  '  f.glyphs[i] = g; f.shades[i] = 255; f.fg[i] = fg; f.bg[i] = bg;',
  '}',
  'function box(f, x0, y0, w, h, set, fg, bg) {',
  '  for (let i = 1; i < w - 1; i++) { put(f, x0 + i, y0, set[1], fg, bg); put(f, x0 + i, y0 + h - 1, set[5], fg, bg); }',
  '  for (let j = 1; j < h - 1; j++) { put(f, x0, y0 + j, set[7], fg, bg); put(f, x0 + w - 1, y0 + j, set[3], fg, bg); }',
  '  put(f, x0, y0, set[0], fg, bg); put(f, x0 + w - 1, y0, set[2], fg, bg); put(f, x0, y0 + h - 1, set[6], fg, bg); put(f, x0 + w - 1, y0 + h - 1, set[4], fg, bg);',
  '}',
  'const ROUND = [...String.fromCodePoint(0x256d, 0x2500, 0x256e, 0x2502, 0x256f, 0x2500, 0x2570, 0x2502)].map((c) => c.codePointAt(0));',
  'const DOUBLE = [...String.fromCodePoint(0x2554, 0x2550, 0x2557, 0x2551, 0x255d, 0x2550, 0x255a, 0x2551)].map((c) => c.codePointAt(0));',
  'function body(f, c, line, fill) {',
  '  const r = c.rect;',
  '  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) put(f, r.x + x, r.y + y, 32, 0, fill);',
  '  if (c.tier === "full") {',
  '    for (let x = 28; x < 56; x++) put(f, r.x + x, r.y, 0x2584, line, fill);',
  '    put(f, r.x + 28, r.y + 1, 0x2588, line, fill); put(f, r.x + 55, r.y + 1, 0x2588, line, fill);',
  '    box(f, r.x, r.y + 2, r.w, r.h - 2, ROUND, line, fill);',
  '    box(f, r.x + 2, r.y + 3, 48, 11, DOUBLE, line, fill);',
  '    for (let y = 5; y < 10; y++) for (let x = 67; x < 80; x++) put(f, r.x + x, r.y + y, 0x2592, line, fill);',
  '  } else {',
  '    for (let x = 5; x < 33; x++) put(f, r.x + x, r.y, 0x2584, line, fill);',
  '    box(f, r.x, r.y + 1, r.w, r.h - 1, ROUND, line, fill);',
  '  }',
  '}',
];

function module(id, head, drawBody) {
  return [...COLOUR_LIB, ...BODY, ...head, 'export default {', `  id: ${JSON.stringify(id)},`, '  drawConsole(f, c) {', ...drawBody, '  },', '};', ''].join('\n');
}

// "Calm": a plausible real hook. The lines go from the console's graphite to a teal of EXACTLY the same luminance (a mix in linear
// light of two colours with one Y), the cells between them stay the palette background: hue only, lightness held.
export function calmHookSource(id = 'calm-console') {
  return module(id, [
    'const GREY = 0x606060;',
    'const Y0 = 0.2126 * SR(0x60) + 0.7152 * SR(0x60) + 0.0722 * SR(0x60);',
    'const K = Y0 / (0.2126 * 0.05 + 0.7152 * 0.6 + 0.0722 * 0.45);',
    'const TEAL = ((RS(0.05 * K) << 16) | (RS(0.6 * K) << 8) | RS(0.45 * K)) >>> 0;',
  ], ['    body(f, c, mix(GREY, TEAL, c.p), PALETTE_BG);']);
}

// "Harsh": a lit console. The lines go from graphite to a bright amber (Y 0.12 to 0.63) and every cell between them takes a dark
// blue-grey background (Y 0.006 to 0.037) as p goes 0 to 1: lightness AND hue move, and the whole 84 x 18 is opaque.
export function harshHookSource(id = 'harsh-console') {
  return module(id, [
    'const GREY = 0x606060, AMBER = 0xFFC060, PANEL0 = 0x0B140C, PANEL1 = 0x30343C;',
  ], ['    body(f, c, mix(GREY, AMBER, c.p), c.p <= 0 ? PALETTE_BG : mix(PANEL0, PANEL1, c.p));']);
}

// A strobing console (must-fail control for the flash meter): the lines and the fill flip between black and bright every frame.
export function strobeHookSource(id = 'strobe-console') {
  return module(id, [], [
    '    const on = (Math.floor(c.t * 18 + 0.5) % 2) === 0;',
    '    body(f, c, on ? 0xFFFFFF : 0x000000, on ? 0x808080 : 0x000000);',
  ]);
}

// ---- shells

// The real loader, held back until `gate()` resolves (to resolve a hook's load at a chosen moment).
export function gatedLoader(gate) {
  return async (cart) => { const r = await realLoadScenes(cart); await gate; return r; };
}

export const SHELL_SKIN = { ...driftmanSkin, frame: { ...driftmanSkin.frame, show: 'never' } };
const HOST = { persist() {}, quit() {}, leaveToClassic() {} };

// A shell with one console cartridge (install-folder, through the real loader) already inserted: screen 'insert' at t = 0. -> { sh, cart }
export function insertedShell(cols, rows, { source, manifest = {}, skin = CART_SKIN, loadScenes = realLoadScenes, start = true, seed = 1 } = {}) {
  const root = tmpRoot('drift-hook-sh-');
  writeConsoleCart(root, 'fx', { source, manifest, skin });
  const d = discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
  if (d.errors.length) throw new Error('fixture cartridge refused: ' + JSON.stringify(d.errors));
  const sh = createShell({
    cols, rows, cartridges: d.cartridges, seed, cmode: 'truecolor', loadScenes, host: HOST,
    consts: { SPEEDS, DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 },
    ...(start ? { start: { cartridge: 'fx' } } : {}),
  });
  return { sh, cart: d.cartridges[0] };
}

export const copyOf = (f) => ({
  glyphs: f.glyphs.slice(), shades: f.shades.slice(), fg: f.fg ? f.fg.slice() : null, bg: f.bg ? f.bg.slice() : null,
  palette: f.palette, cols: f.cols, rows: f.rows,
});

// The sizes the console is drawn at, and the sizes just above each layout breakpoint (full 88x39, extra-large 176x58, compact 78x24).
export const SIZES = [[120, 40], [80, 24], [240, 67], [88, 39], [176, 58], [78, 24]];
