// Full-frame truecolor ANSI captures of the Driftman 9000: node tools/capture-ansi.mjs [--out captures-ansi]   (zero dependencies)
//
// Each file is one frame of the REAL app (a fresh createApp on a fake terminal at the shipped defaults, COLORTERM=truecolor, seed 1), taken the way the text
// captures of tools/capture.mjs are taken (the same drivers: withCartApp, sceneShots, driftman9000PanelShots, driftman9000MorphShots), and serialised by the
// app's own renderer: createRenderer().render(app.screenshot()) on a fresh renderer, which is exactly the string the app writes the first time it paints that
// frame (clear the screen, then every cell with its 24-bit foreground and background; the app wraps it in the synchronized-output markers, which a file
// does not need). There is no second serialiser here. The one thing added is a tail: reset the colours and put the cursor on the last row.
//
// View one in a truecolor terminal of at least the size in its name (the file clears the screen and addresses cells absolutely, so it must not scroll):
//   cat captures-ansi/menu-grid-120x40.ansi        (Git Bash, WSL, macOS, Linux; `clear` afterwards)
//   type captures-ansi\menu-grid-120x40.ansi       (cmd.exe in Windows Terminal, after `chcp 65001`; `cls` afterwards)
//   Get-Content -Raw -Encoding utf8 captures-ansi\menu-grid-120x40.ansi | Write-Host -NoNewline      (PowerShell)
// The renderer never draws the bottom-right cell of the screen (writing it can scroll some terminals), so that one cell of every file is blank.
//
// The files and what they are (name -> frame):
//   library-driftman-9000-selected-120x40   the shelf with the 9000 selected          label-24x10   its label, cropped from that frame (foil and all)
//   insert-t400 / t900 / t1250-120x40       the cartridge going in (0.4, 0.9, 1.25 s after Enter)
//   morph-insert-t1000 ... t1500-120x40     the 2000 turning into the 9000, every 0.1 s, the last third of the insert
//   morph-boot-t1700 / t1800-120x40         the last of the morph (the boot's first 0.4 s settle the colours)     morph-rest-t2000-120x40  the awake machine
//   boot-t2500 / t4200 / t5600-120x40       the boot screen                       console-rest-120x40 and -80x24   the awake console, boot lines typed (3.4 s)
//   menu-grid-120x40, menu-list-80x24       the menu over the running Rosette (tiles; list)      help-120x40, help-80x24   the help box over it
//   rosette / cortex / bloomfall-120x40 and -80x24   each vision 20 s into its play (menu closed)
//   eject-t727 / t1260 / t1633-120x40       the cartridge coming out
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRenderer } from '../src/renderer.js';
import { INSTALL_DIR } from '../src/cartridge/loader.js';
import { shelfLayout, LABEL_W, LABEL_H } from '../src/shell/library.js';
import { sizeTier } from '../src/shell/ui.js';
import { BOOT_END } from '../src/shell/boot.js';
import {
  withCartApp, sceneShots, driftman9000PanelShots, driftman9000MorphShots, installed, CART_MOMENTS, EJECT_MOMENTS, CART_DT, CART_SIZES, DRIFTMAN_ID,
} from './capture.mjs';

const DIRS = [{ dir: INSTALL_DIR, trusted: true }];
const ms = (sec) => Math.round(sec * 1000);
const settle = () => new Promise((r) => setTimeout(r, 20));
const shot = (app) => app.screenshot();
const size = (c, r) => `${c}x${r}`;

// The file a frame becomes: the renderer's first paint of it, then the colours reset and the cursor on the last row.
export function frameToAnsiFile(frame) {
  const body = createRenderer().render(frame);
  return `${body}\x1b[0m\x1b[${frame.rows};1H`;
}

// Name -> the text capture (in captures/) the frame is the twin of, or null: used by the tests to check the cells against the text.
const MORPH_INSERT = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5];
const MORPH_LATER = [['boot', 1.7], ['boot', 1.8], ['rest', 2.0]];
const INSERT_PICK = [0.4, 0.9, 1.25];
const BOOT_PICK = [2.5, 4.2, 5.6];

// The names, in the order they are written; no run needed. Each: { name, cols, rows, twin }.
export function ansiSpecs() {
  const out = [];
  const add = (name, cols, rows, twin = null) => out.push({ name, cols, rows, twin });
  add('library-driftman-9000-selected-120x40', 120, 40, 'cart-library-driftman-9000-120x40.txt');
  add('label-24x10', LABEL_W, LABEL_H, null);
  for (const m of INSERT_PICK) add(`insert-t${ms(m)}-120x40`, 120, 40, `cart-insert-driftman-9000-t${ms(m)}.txt`);
  for (const m of MORPH_INSERT) add(`morph-insert-t${ms(m)}-120x40`, 120, 40, `cart-driftman-9000-morph-t${ms(m)}.txt`);
  for (const [kind, m] of MORPH_LATER) add(`morph-${kind}-t${ms(m)}-120x40`, 120, 40, null);
  for (const m of BOOT_PICK) add(`boot-t${ms(m)}-120x40`, 120, 40, `cart-boot-driftman-9000-t${ms(m)}.txt`);
  add('console-rest-120x40', 120, 40, 'cart-boot-driftman-9000-t3400.txt');
  add('console-rest-80x24', 80, 24, 'cart-boot-driftman-9000-80x24-t3400.txt');
  add('menu-grid-120x40', 120, 40, 'cart-driftman-9000-menu-120x40.txt');
  add('menu-list-80x24', 80, 24, 'cart-driftman-9000-menu-80x24.txt');
  add('help-120x40', 120, 40, 'cart-driftman-9000-help-120x40.txt');
  add('help-80x24', 80, 24, 'cart-driftman-9000-help-80x24.txt');
  for (const id of ['rosette', 'cortex', 'bloomfall']) for (const [c, r] of CART_SIZES) add(`${id}-${size(c, r)}`, c, r, null);
  for (const m of EJECT_MOMENTS) add(`eject-t${ms(m)}-120x40`, 120, 40, `cart-eject-driftman-9000-t${ms(m)}.txt`);
  return out;
}
export const ANSI_NAMES = () => ansiSpecs().map((s) => `${s.name}.ansi`);

// The frame (cols, rows, glyphs, shades, palette, and fg/bg/mode when it carries full-colour cells) of a rectangle of another: how the label is cut out of the shelf.
function crop(frame, x0, y0, w, h) {
  const out = { cols: w, rows: h, glyphs: new Uint16Array(w * h), shades: new Uint8Array(w * h), palette: frame.palette };
  if (frame.fg) { out.fg = new Uint32Array(w * h); out.bg = new Uint32Array(w * h); out.mode = frame.mode; }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y0 + y) * frame.cols + x0 + x, d = y * w + x;
      out.glyphs[d] = frame.glyphs[s]; out.shades[d] = frame.shades[s];
      if (frame.fg) { out.fg[d] = frame.fg[s]; out.bg[d] = frame.bg[s]; }
    }
  }
  return out;
}

// Every frame, by name: Map(name -> frame). Fresh apps throughout; deterministic.
export async function collectAnsiFrames({ seed = 1, dirs = DIRS } = {}) {
  const frames = new Map();
  const found = installed(dirs);
  if (!found.some((c) => c.id === DRIFTMAN_ID && !c.locked)) throw new Error('capture-ansi: the Driftman 9000 is not installed');
  // spend the per-process first-insert flag, as the text captures do, so the boot bar is the plain one
  const firstOpen = found.find((c) => !c.locked);
  await withCartApp({ seed, cols: 120, rows: 40, dirs, id: firstOpen.id }, async (app, step) => { app.handleKey('\r'); await step(0.2); });

  // the shelf, then insert, boot and eject, in one run per size with the text captures' moments (the clock is stepped the same way, so the frames are the same)
  for (const [cols, rows] of CART_SIZES) {
    await withCartApp({ seed, cols, rows, dirs, id: DRIFTMAN_ID }, async (app, step) => {
      if (cols === 120) {
        const lib = shot(app);
        frames.set('library-driftman-9000-selected-120x40', lib);
        const L = shelfLayout(cols, rows, sizeTier(cols, rows));
        frames.set('label-24x10', crop(lib, L.cartX + 3, L.cartTop + 3, LABEL_W, LABEL_H));
      }
      app.handleKey('\r');
      for (const m of CART_MOMENTS) {
        await step(m);
        const f = shot(app);
        if (cols === 120) {
          if (INSERT_PICK.includes(m)) frames.set(`insert-t${ms(m)}-120x40`, f);
          if (BOOT_PICK.includes(m)) frames.set(`boot-t${ms(m)}-120x40`, f);
        }
        if (m === 3.4) frames.set(`console-rest-${size(cols, rows)}`, f);
      }
      if (cols !== 120) return;
      await step(BOOT_END + 1.5);
      app.handleKey('\x1b');
      await step(BOOT_END + 3);
      app.handleKey('e');
      let t = 0;
      for (const m of EJECT_MOMENTS) {
        while (t < m - 1e-9) { const d = Math.min(CART_DT, m - t); app.tick(d); t += d; }
        await settle();
        frames.set(`eject-t${ms(m)}-120x40`, shot(app));
      }
    });
  }

  // the menu and the help box
  for (const p of await driftman9000PanelShots({ seed, dirs, shot })) {
    frames.set(p.cols === 120 ? 'menu-grid-120x40' : 'menu-list-80x24', p.menu);
    frames.set(`help-${size(p.cols, p.rows)}`, p.help);
  }

  // the morph: the text captures' six moments, then the colours settling
  const moments = [...MORPH_INSERT, ...MORPH_LATER.map(([, m]) => m)];
  for (const m of await driftman9000MorphShots({ seed, dirs, moments, shot })) {
    const later = MORPH_LATER.find(([, x]) => x === m.sec);
    frames.set(later ? `morph-${later[0]}-t${ms(m.sec)}-120x40` : `morph-insert-t${ms(m.sec)}-120x40`, m.shot);
  }

  // each vision 20 s into its play, both sizes
  for (const id of ['rosette', 'cortex', 'bloomfall']) {
    for (const [cols, rows] of CART_SIZES) {
      const [s] = await sceneShots({ seed, cols, rows, dirs, sceneId: id, times: [20], cartId: DRIFTMAN_ID, has: (c) => c.id === DRIFTMAN_ID && !c.locked, shot });
      frames.set(`${id}-${size(cols, rows)}`, s.text);
    }
  }
  const want = ansiSpecs().map((s) => s.name);
  const missing = want.filter((n) => !frames.has(n));
  if (missing.length) throw new Error('capture-ansi: no frame for ' + missing.join(', '));
  return new Map(want.map((n) => [n, frames.get(n)]));
}

export async function runCaptureAnsi({ outDir, seed = 1, dirs = DIRS }) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const [name, frame] of await collectAnsiFrames({ seed, dirs })) {
    const f = path.join(outDir, `${name}.ansi`);
    fs.writeFileSync(f, frameToAnsiFile(frame));
    written.push(f);
  }
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--out');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = i >= 0 ? path.resolve(process.argv[i + 1]) : path.join(here, '..', 'captures-ansi');
  const files = await runCaptureAnsi({ outDir: out });
  const bytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
  console.log(`wrote ${files.length} .ansi files (${bytes} bytes) to ${out}`);
  process.exit(0);
}
