// Fixtures for the Driftman 9000's panels over a running vision (DRIFT-7 stage F): the menu (tiles at 100+ columns, a list below) with its prompt row
// and start-by-itself countdown, the help box, and the chrome border the skin draws round the screen while the menu is up. A real shell with the installed
// cartridge, the real runtime, the real skin.
//
// The cells a panel owns are found by drawing the panel with the SAME functions the shell calls (drawMenu, drawChrome, drawHelp) into a sentinel frame
// (glyph 1, shade 200) and taking every cell that changed; nothing about the geometry is copied. A panel is whole when the shell's frame holds, on every one of
// those cells, the glyph and shade the replica drew (so the replica is the shell's own picture, not a guess), and no cell is a full-colour cell (shade 255).
import assert from 'node:assert/strict';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';
import { drawMenu } from '../src/shell/menu.js';
import { drawChrome } from '../src/shell/chrome.js';
import { drawHelp } from '../src/overlay.js';
import { shellHelpLines } from '../src/keymap.js';
import { newFrame } from '../src/shell/ui.js';
import { shell9000, flush, DT, FPS, RGB_CELL } from './helpers-driftman-console.js';

export { DT, FPS, RGB_CELL, flush };
export const CART = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.find((c) => c.id === 'driftman-9000');
export const SKIN = CART.skin;
export const MANIFEST = CART.manifest;
export const VISIONS = MANIFEST.menu.map((m) => m.scene); // rosette, cortex, bloomfall: the menu's order
export const BG = 0x05060C; // the skin's background, which every panel cell sits on
const SENTINEL_GLYPH = 1, SENTINEL_SHADE = 200;

// A shell with the 9000 run through insert and boot to the running screen (menu open, countdown just started). speed: the runtime's speed from the start.
export async function arrive9000(cols, rows, opts = {}) {
  const sh = shell9000(cols, rows, opts); // opts: { speed, cmode, withHook }
  await flush();
  for (let k = 0; k < 900 && sh.state().screen !== 'running'; k++) { sh.frame(); sh.tick(DT); if (k % 10 === 0) await flush(); }
  assert.equal(sh.state().screen, 'running', `${cols}x${rows}: the 9000 reached the running screen`);
  return sh;
}

// n frames: draw, hand to each(frame, k), then tick one 18 fps step.
export function stepFrames(sh, n, each) {
  for (let k = 0; k < n; k++) { const f = sh.frame(); if (each) each(f, k); sh.tick(DT); }
}
export const stepSeconds = (sh, s, each) => stepFrames(sh, Math.round(s * FPS), each);

// Choose a vision from the open menu (cursor moves with 'right', Enter takes it); the dissolve (2 s) is then run out.
export function pickVision(sh, id) {
  assert.ok(sh.state().menu, 'the menu is open to choose from');
  const at = VISIONS.indexOf(id);
  assert.ok(at >= 0, id);
  for (let i = 0; i < at; i++) sh.key('right');
  sh.key('enter');
  assert.equal(sh.state().sceneId, id);
  stepSeconds(sh, 2.6);
}

const sentinel = (cols, rows) => { const f = newFrame(cols, rows); f.glyphs.fill(SENTINEL_GLYPH); f.shades.fill(SENTINEL_SHADE); return f; };
const touched = (f) => { const set = []; for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] !== SENTINEL_GLYPH || f.shades[i] !== SENTINEL_SHADE) set.push(i); return set; };

// The menu as the runtime draws it: the chrome border (skin.frame.show is 'menu'), then drawMenu with the manifest's entries. countdown: the whole seconds shown, or null.
export function menuReplica(cols, rows, { index = 0, playingId, countdown = null }) {
  const f = sentinel(cols, rows);
  drawChrome(f, SKIN);
  const entries = MANIFEST.menu.map((e) => {
    const o = { label: e.label, program: e.program, scene: e.scene, action: e.action, current: e.scene === playingId };
    if (e.note !== undefined) o.note = e.note;
    if (e.desc !== undefined) o.desc = e.desc;
    return o;
  });
  drawMenu(f, { entries, index, title: SKIN.menu && SKIN.menu.title, prompt: SKIN.menu && SKIN.menu.prompt, countdown: countdown === null ? null : `starts by itself in ${countdown} s` }, SKIN);
  return { f, cells: touched(f) };
}

// The help box as the shell draws it for a running cartridge (helpInfo('running')).
export function helpReplica(cols, rows, { sceneId, ui }) {
  const scene = MANIFEST.scenes.find((s) => s.id === sceneId);
  const glyphs = new Uint16Array(cols * rows).fill(SENTINEL_GLYPH), shades = new Uint8Array(cols * rows).fill(SENTINEL_SHADE);
  const sk = SKIN;
  const rect = drawHelp(glyphs, shades, cols, rows, {
    mode: 'running', modeName: 'running', sceneName: sceneId, ui,
    title: (sk.help && sk.help.title) || 'DRIFTMAN 2000  keys', box: sk.help && sk.help.box,
    lines: shellHelpLines('running', sk),
    modeLine: `${(sk.help && sk.help.modeLabel) || 'cartridge'}: ${CART.title}    ${(sk.help && sk.help.sceneLabel) || 'scene'}: ${(scene && scene.title) || sceneId}`,
  });
  const f = { glyphs, shades, cols, rows };
  return { f, cells: touched(f), rect };
}

// ---- the rule F checkers (pure: a frame, a replica -> problems)

// "colour < 255": a panel cell is a palette cell, never a full-colour (shade 255) cell of the scene behind it.
export function rgbCellsIn(frame, rep) {
  const bad = [];
  for (const i of rep.cells) if (!(frame.shades[i] < RGB_CELL)) bad.push(i);
  return bad;
}
// the shell's frame IS the replica on those cells
export function mismatchesIn(frame, rep) {
  const bad = [];
  for (const i of rep.cells) if (frame.glyphs[i] !== rep.f.glyphs[i] || frame.shades[i] !== rep.f.shades[i]) bad.push(i);
  return bad;
}

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = (rgb) => 0.2126 * lin((rgb >> 16) & 255) + 0.7152 * lin((rgb >> 8) & 255) + 0.0722 * lin(rgb & 255);
export const contrast = (a, b) => { const A = luminance(a), B = luminance(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
export const isTextGlyph = (g) => (g >= 48 && g <= 57) || (g >= 65 && g <= 90) || (g >= 97 && g <= 122);

// Text cells (letters and digits) of a panel and the contrast of their colour on the skin's background.
export function textContrast(frame, rep) {
  const byShade = new Map();
  for (const i of rep.cells) {
    if (!isTextGlyph(frame.glyphs[i])) continue;
    const s = frame.shades[i];
    if (s >= RGB_CELL) continue; // reported by rgbCellsIn
    byShade.set(s, (byShade.get(s) || 0) + 1);
  }
  const out = [];
  for (const [s, n] of byShade) out.push({ shade: s, cells: n, ratio: contrast(frame.palette.fgRgb[s], BG) });
  return out.sort((a, b) => a.shade - b.shade);
}
export const lowContrast = (rows, min = 4.5) => rows.filter((r) => r.ratio < min);

// one frame of the shell, copied so a checker can hold it
export function copyOf(f) {
  return { glyphs: f.glyphs.slice(), shades: f.shades.slice(), fg: f.fg ? f.fg.slice() : null, bg: f.bg ? f.bg.slice() : null, palette: f.palette, cols: f.cols, rows: f.rows };
}
