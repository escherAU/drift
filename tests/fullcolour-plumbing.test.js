// DRIFT-7 C3b: fg/bg (full-colour cells) travel through every place the engine copies a frame. One test per copy site, each
// with a fixture of one full-colour scene (glow, rgb: true) and one palette scene (plain), so a copy that forgets fg/bg shows
// up as a cell that kept its shade 255 but lost its colours. The copy sites:
//   cells.js    composer dissolve, drawInto/renderScene (pre-fill + buffers), c.fg / c.bg
//   runtime.js  dissolveFrames (three branches), the xfade snapshot, the `last` copy, the menu overlay copy
//   shell.js    keepForHandover, the library hand-over loop, the object frame() returns
//   boot.js     dissolveRects
//   ui.js       newFrame
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCellComposer, renderScene } from '../src/cells.js';
import { dissolveFrames, createCartridgeRuntime } from '../src/shell/runtime.js';
import { newFrame, dissolveThresholds } from '../src/shell/ui.js';
import { dissolveRects } from '../src/shell/boot.js';
import { createShell } from '../src/shell/shell.js';
import { driftmanSkin } from '../src/shell/driftman.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { FLASH_FRACTION } from './helpers-flash.js';
import {
  RGB_CELL, GLOW_GLYPH, PLAIN_GLYPH, GLOW_PAL_SHADE, PLAIN_SHADE, glowFg, glowBg,
  makeGlow, makePlain, sceneFrame, sameCell, pickCounts,
} from './helpers-fullcolour.js';

const W = 40, H = 12, N = W * H;
const FPS = 18;
// the console's own skin without the frame, so the only cells that are not the scene are the ones a test is looking at
const SKIN = { ...driftmanSkin, frame: { ...driftmanSkin.frame, show: 'never' } };

// ---- ui.js newFrame

test('FC1 newFrame always allocates fg and bg (Uint32Array, one per cell)', () => {
  for (const [c, r] of [[40, 12], [1, 1], [0, 0], [80, 24]]) {
    const f = newFrame(c, r);
    assert.ok(f.fg instanceof Uint32Array && f.bg instanceof Uint32Array, `${c}x${r}`);
    assert.equal(f.fg.length, c * r);
    assert.equal(f.bg.length, c * r);
  }
});

// ---- cells.js: renderScene, the composer's buffers, the pre-fill

test('FC2 renderScene hands a full-colour scene fg/bg buffers and pre-fills its colours with RGB_CELL; a palette scene gets no pre-fill', () => {
  const g = sceneFrame(makeGlow(), W, H);
  assert.ok(g.fg instanceof Uint32Array && g.bg instanceof Uint32Array);
  assert.equal(g.fg.length, N);
  for (let i = 0; i < N; i++) {
    if (i % 5 === 3) { assert.equal(g.shades[i], GLOW_PAL_SHADE); continue; }
    assert.equal(g.shades[i], RGB_CELL, `cell ${i}`);
    assert.equal(g.fg[i], glowFg(i));
    assert.equal(g.bg[i], glowBg(i));
  }
  // a palette scene that writes only glyphs: its colours are exactly what the buffer held (0), never 255
  const lazy = (t, w, h, p) => { p.glyphs.fill(65); };
  lazy.id = 'lazy'; lazy.kind = 'cells';
  const l = renderScene(lazy, 0, W, H, 1);
  assert.equal(l.colours.indexOf(RGB_CELL), -1);
  // and the buffers a caller passes in are used (no allocation) for all four
  const gl = new Uint16Array(N), co = new Uint8Array(N), fg = new Uint32Array(N), bg = new Uint32Array(N);
  const r = renderScene(makeGlow(), 0, W, H, 1, gl, co, fg, bg);
  assert.equal(r.glyphs, gl); assert.equal(r.colours, co); assert.equal(r.fg, fg); assert.equal(r.bg, bg);
});

test('FC3 the composer exposes c.fg / c.bg and a full-colour scene draws straight into them (pre-fill included); buffers are pooled', () => {
  const rec = [];
  const cc = createCellComposer({ scenes: [makeGlow(rec), makePlain()], cols: W, rows: H });
  assert.ok(cc.fg instanceof Uint32Array && cc.bg instanceof Uint32Array);
  assert.equal(cc.fg.length, N);
  const fg0 = cc.fg, bg0 = cc.bg;
  let f = cc.frame({ a: 0, b: 0, p: 0 }, 0);
  assert.equal(f, cc);
  const ref = sceneFrame(makeGlow(), W, H);
  for (let i = 0; i < N; i++) assert.ok(sameCell(f, ref, i), `cell ${i}`);
  // pooled: the scene is handed the composer's own buffers on every frame, and they never change identity
  for (let k = 1; k < 4; k++) f = cc.frame({ a: 0, b: 0, p: 0 }, k / FPS);
  assert.equal(cc.fg, fg0); assert.equal(cc.bg, bg0);
  assert.ok(rec.length >= 4);
  for (const r of rec) { assert.equal(r.fg, fg0); assert.equal(r.bg, bg0); assert.equal(r.c, cc.shades); }
  // a palette scene afterwards: no 255 anywhere (no pre-fill leaks across scenes)
  f = cc.frame({ a: 1, b: 1, p: 0 }, 1);
  assert.equal(f.shades.indexOf(RGB_CELL), -1);
  // and when a palette-only composer dissolves, its output carries no 255 either
  const pc = createCellComposer({ scenes: [makePlain(), makePlain()], cols: W, rows: H });
  assert.equal(pc.frame({ a: 0, b: 1, p: 0.5 }, 0).shades.indexOf(RGB_CELL), -1);
});

test('FC4 composer dissolve: every cell is a whole cell of A or of B; 255 cells keep fg/bg exactly; palette cells keep their value (both directions)', () => {
  const A = sceneFrame(makeGlow(), W, H), B = sceneFrame(makePlain(), W, H);
  for (const [order, from, to] of [[[makeGlow(), makePlain()], A, B], [[makePlain(), makeGlow()], B, A]]) {
    const cc = createCellComposer({ scenes: order, cols: W, rows: H });
    for (const p of [0.05, 0.3, 0.5, 0.8, 0.97]) {
      const f = cc.frame({ a: 0, b: 1, p }, 0);
      const k = pickCounts(f, from, to);
      assert.equal(k.bad, -1, `p=${p}: cell ${k.bad} is neither A's nor B's whole cell`);
      assert.ok(k.a > 0 && k.b > 0, `p=${p}: both sides present (a=${k.a} b=${k.b})`);
    }
    // the palette cells inside the glow scene (index 7) survive on the A side with their shade
    const f = cc.frame({ a: 0, b: 1, p: 0.5 }, 0);
    let palCells = 0;
    for (let i = 0; i < N; i++) if (f.glyphs[i] === GLOW_GLYPH && f.shades[i] === GLOW_PAL_SHADE) palCells++;
    assert.ok(palCells > 0, 'palette cells of the glow scene still there');
  }
});

test('FC5 phase test: the composer dissolve at speeds 1-4 and four clock phases is whole-cell, one-way and under the flash fraction', () => {
  const A = sceneFrame(makeGlow(), W, H), B = sceneFrame(makePlain(), W, H);
  const DISSOLVE = 2;
  for (const speed of [1, 2, 3, 4]) {
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      const step = speed / FPS;
      const cc = createCellComposer({ scenes: [makeGlow(), makePlain()], cols: W, rows: H });
      const flipped = new Uint8Array(N);
      let prev = null, worst = 0, last = null;
      for (let t = phase * step, k = 0; ; t += step, k++) {
        const p = Math.min(1, (k * step + phase * step) / DISSOLVE);
        const f = cc.frame({ a: 0, b: 1, p }, t);
        const c = pickCounts(f, A, B);
        assert.equal(c.bad, -1, `speed ${speed} phase ${phase} p=${p.toFixed(3)}: cell ${c.bad} is a mix`);
        let changed = 0;
        for (let i = 0; i < N; i++) {
          const isB = sameCell(f, B, i);
          if (flipped[i] && !isB) assert.fail(`speed ${speed} phase ${phase}: cell ${i} went back to A`);
          if (isB) flipped[i] = 1;
          if (prev && prev[i] !== (isB ? 1 : 0)) changed++;
        }
        if (prev) worst = Math.max(worst, changed / N);
        prev = Uint8Array.from({ length: N }, (_, i) => (sameCell(f, B, i) ? 1 : 0));
        last = c;
        if (p >= 1) break;
      }
      assert.ok(worst < FLASH_FRACTION, `speed ${speed} phase ${phase}: worst share ${worst}`);
      assert.equal(last.b, N, 'ends fully on B');
    }
  }
});

// ---- runtime.js: dissolveFrames

function frameOf(scene) {
  const f = newFrame(W, H);
  const s = sceneFrame(scene, W, H);
  f.glyphs.set(s.glyphs); f.shades.set(s.shades); f.fg.set(s.fg); f.bg.set(s.bg);
  return f;
}

test('FC6 dissolveFrames: p<=0 copies A (fg/bg too) into a separate out; p>=1 copies B; in between each cell is A or B whole (out separate from A, and out === A)', () => {
  const thr = dissolveThresholds(N);
  const rgb = frameOf(makeGlow()), pal = frameOf(makePlain());
  // p <= 0, out is not A: out becomes A including its colours
  let out = newFrame(W, H);
  dissolveFrames(rgb, pal, 0, thr, out);
  for (let i = 0; i < N; i++) assert.ok(sameCell(out, rgb, i), `p=0 cell ${i}`);
  // p >= 1: out becomes B (B is the full-colour frame this time)
  out = newFrame(W, H);
  dissolveFrames(pal, rgb, 1, thr, out);
  for (let i = 0; i < N; i++) assert.ok(sameCell(out, rgb, i), `p=1 cell ${i}`);
  // in between, out separate from A
  out = newFrame(W, H);
  dissolveFrames(rgb, pal, 0.5, thr, out);
  let k = pickCounts(out, rgb, pal);
  assert.equal(k.bad, -1); assert.ok(k.a > 0 && k.b > 0);
  // in between, with B the full-colour frame
  out = newFrame(W, H);
  dissolveFrames(pal, rgb, 0.5, thr, out);
  k = pickCounts(out, pal, rgb);
  assert.equal(k.bad, -1); assert.ok(k.a > 0 && k.b > 0);
  // out === A (the shell's boot and the menu use this form): A's own cells keep their colours, B's are copied in
  const a = frameOf(makeGlow());
  dissolveFrames(a, pal, 0.5, thr, a);
  k = pickCounts(a, rgb, pal);
  assert.equal(k.bad, -1); assert.ok(k.a > 0 && k.b > 0);
  const b = frameOf(makePlain());
  dissolveFrames(b, rgb, 0.5, thr, b);
  k = pickCounts(b, pal, rgb);
  assert.equal(k.bad, -1); assert.ok(k.a > 0 && k.b > 0);
});

test('FC7 dissolveFrames stays tolerant of a plain palette frame (no fg/bg anywhere)', () => {
  const mk = (g, s) => ({ glyphs: new Uint16Array(N).fill(g), shades: new Uint8Array(N).fill(s), cols: W, rows: H });
  const A = mk(65, 1), B = mk(66, 2), out = mk(0, 0);
  dissolveFrames(A, B, 0.5, dissolveThresholds(N), out);
  assert.ok(out.glyphs.includes(65) && out.glyphs.includes(66));
  assert.equal(out.fg, undefined);
});

// ---- runtime.js: xfade, last, menu overlay (a real runtime on hand-made scenes)

const SPEEDS = [1];
function mkRuntime(first, second) {
  const progs = [
    { id: 'a', title: 'A', transition: 'dissolve', scenes: [first.id], sceneSeconds: 20 },
    { id: 'b', title: 'B', transition: 'dissolve', scenes: [second.id], sceneSeconds: 20 },
  ];
  const cart = { id: 'fx', manifest: { programs: progs, start: 'a', scenes: [] } };
  const scenes = [first, second].map((s) => ({ id: s.id, kind: 'cells', family: 'cells', scene: s }));
  const palette = makeSkinPalette(SKIN, 'truecolor', 'fx');
  return createCartridgeRuntime(cart, scenes, palette, { cols: W, rows: H, seed: 1, skin: SKIN, SPEEDS, DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 });
}
// one scene needs a distinct id from the other
const named = (s, id) => { s.id = id; return s; };

test('FC8 xfade after a program switch (full-colour A): the snapshot keeps fg/bg, so cells still on A are exact; at p=0 the frame IS A', () => {
  const glow = makeGlow(), plain = named(makePlain(), 'plain');
  const rt = mkRuntime(glow, plain);
  const out = newFrame(W, H);
  rt.frame(out); // the glow frame becomes `last`
  const A = frameOf(makeGlow()), B = frameOf(makePlain());
  rt.actions.menuEnter(); // opens the menu
  rt.actions.menuNext(); // -> program b
  rt.actions.menuEnter(); // closes it and switches: xfade from the glow frame
  rt.frame(out);
  for (let i = 0; i < N; i++) assert.ok(sameCell(out, A, i), `xfade t=0, cell ${i}`);
  rt.advance(0.5);
  rt.frame(out);
  const k = pickCounts(out, A, B);
  assert.equal(k.bad, -1, `cell ${k.bad}`);
  assert.ok(k.a > 0 && k.b > 0, `a=${k.a} b=${k.b}`);
});

test('FC9 the `last` copy keeps fg/bg: switching away twice dissolves from the second program\'s full-colour frame', () => {
  const glow = makeGlow(), plain = named(makePlain(), 'plain');
  const rt = mkRuntime(plain, glow); // start on plain, switch to glow, then back
  const out = newFrame(W, H);
  rt.frame(out);
  rt.actions.menuEnter(); rt.actions.menuNext(); rt.actions.menuEnter(); // -> glow, xfade from plain
  rt.advance(3); // the xfade is over (2 s)
  rt.frame(out);
  const A = frameOf(makeGlow()), B = frameOf(makePlain());
  for (let i = 0; i < N; i++) assert.ok(sameCell(out, A, i), `settled on glow, cell ${i}`);
  rt.actions.menuEnter(); rt.actions.menuPrev(); rt.actions.menuEnter(); // -> back to plain, xfade from the glow frame held in `last`
  rt.frame(out);
  for (let i = 0; i < N; i++) assert.ok(sameCell(out, A, i), `xfade from glow, cell ${i}`);
  rt.advance(0.5);
  rt.frame(out);
  const k = pickCounts(out, A, B);
  assert.equal(k.bad, -1, `cell ${k.bad}`);
  assert.ok(k.a > 0 && k.b > 0);
});

test('FC10 the menu ramp copy: mid-ramp, cells that stay full-colour keep their fg/bg exactly', () => {
  const rt = mkRuntime(makeGlow(), named(makePlain(), 'plain'));
  const out = newFrame(W, H);
  rt.frame(out);
  const A = frameOf(makeGlow());
  rt.open();
  rt.advance(0.1); // menu.p = 0.4: neither closed nor open
  rt.frame(out);
  let rgbCells = 0, overlayCells = 0;
  for (let i = 0; i < N; i++) {
    if (out.shades[i] === RGB_CELL) {
      rgbCells++;
      assert.equal(out.glyphs[i], GLOW_GLYPH, `cell ${i}`);
      assert.equal(out.fg[i], A.fg[i], `fg of cell ${i}`);
      assert.equal(out.bg[i], A.bg[i], `bg of cell ${i}`);
    }
    if (!sameCell(out, A, i)) overlayCells++;
  }
  assert.ok(rgbCells > 0, 'some cells are still full-colour mid-ramp');
  assert.ok(overlayCells > 0, 'the menu has started to draw');
  // fully open: the overlay draws over out directly; 255 cells outside it still exact
  rt.advance(1);
  rt.frame(out);
  for (let i = 0; i < N; i++) if (out.shades[i] === RGB_CELL) assert.equal(out.fg[i], A.fg[i], `open: fg of cell ${i}`);
});

// ---- boot.js: dissolveRects

test('FC11 boot dissolveRects copies fg/bg with the shade (per-cell pick, 255 cells exact)', () => {
  const rgb = frameOf(makeGlow()), pal = frameOf(makePlain());
  const copyInto = (src) => (X) => { X.glyphs.set(src.glyphs); X.shades.set(src.shades); X.fg.set(src.fg); X.bg.set(src.bg); };
  for (const [fromF, toF] of [[rgb, pal], [pal, rgb]]) {
    const f = newFrame(W, H);
    dissolveRects(f, copyInto(fromF), copyInto(toF), 0.5);
    const k = pickCounts(f, fromF, toF);
    assert.equal(k.bad, -1, `cell ${k.bad}`);
    assert.ok(k.a > 0 && k.b > 0);
  }
});

// ---- shell.js: frame(), keepForHandover, the library hand-over loop (a real shell, injected scenes)

function mkShell(scenesList, over = {}) {
  const progs = scenesList.length === 1
    ? [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: [scenesList[0].id], sceneSeconds: 20 }]
    : [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: scenesList.map((s) => s.id), sceneSeconds: 20 }];
  const manifest = { id: 'fx', title: 'Fixture', blurb: 'b', facts: [], programs: progs, start: 'main', scenes: [], labelHue: '#7FB069' };
  const cart = { id: 'fx', title: 'Fixture', manifest, locked: false, runtime: 'cartridge', label: ['+----+', '| FX |', '+----+'], labelInk: null, skin: SKIN, boot: null, trusted: true };
  const scenes = scenesList.map((s) => ({ id: s.id, kind: 'cells', family: 'cells', scene: s }));
  const calls = { persisted: [] };
  const sh = createShell({
    cols: W, rows: H, cartridges: [cart], seed: 1, cmode: 'truecolor', loadScenes: async () => ({ scenes, errors: [] }),
    host: { persist: (p) => calls.persisted.push(p), quit() {}, leaveToClassic() {} },
    consts: { SPEEDS, DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 },
    start: { cartridge: 'fx', skipBoot: true },
    ...over,
  });
  return sh;
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

async function running(scenesList, over) {
  const sh = mkShell(scenesList, over);
  await flush();
  sh.tick(0.05);
  await flush();
  sh.tick(0.05);
  assert.equal(sh.state().screen, 'running');
  return sh;
}

test('FC12 shell.frame() attaches fg/bg only when a 255 cell is present (both arms), as the very buffers the renderer will read', async () => {
  const rgbSh = await running([makeGlow()]);
  const f = rgbSh.frame();
  assert.ok(f.fg instanceof Uint32Array && f.bg instanceof Uint32Array);
  const A = frameOf(makeGlow());
  for (let i = 0; i < N; i++) {
    assert.equal(f.shades[i] === RGB_CELL, A.shades[i] === RGB_CELL, `cell ${i}`);
    if (f.shades[i] === RGB_CELL) { assert.equal(f.fg[i], A.fg[i]); assert.equal(f.bg[i], A.bg[i]); }
  }
  const palSh = await running([named(makePlain(), 'plain')]);
  const g = palSh.frame();
  assert.equal(g.shades.indexOf(RGB_CELL), -1);
  assert.equal(g.fg, undefined);
  assert.equal('fg' in g, false, 'no fg key at all on a palette-only frame');
  assert.equal('bg' in g, false);
  assert.equal('mode' in g, false);
  // the library frame (no cartridge) is palette-only too
  const lib = createShell({ cols: W, rows: H, cartridges: [], host: { persist() {}, quit() {}, leaveToClassic() {} }, consts: { SPEEDS, DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 } });
  assert.equal('fg' in lib.frame(), false);
});

test('FC13 the boot dissolve (runtime frame into the boot screen) keeps fg/bg on every frame', async () => {
  const sh = mkShell([makeGlow()], { start: { cartridge: 'fx' } }); // not skipped: insert, boot, then running
  await flush();
  const A = frameOf(makeGlow());
  let mixed = 0;
  for (let k = 0; k < 400 && sh.state().screen !== 'running'; k++) {
    sh.tick(1 / FPS);
    if (k % 20 === 0) await flush();
    const f = sh.frame();
    if (sh.state().screen !== 'boot' || !f.fg) continue;
    let rgb = 0, other = 0;
    for (let i = 0; i < N; i++) {
      if (f.shades[i] === RGB_CELL) { rgb++; assert.equal(f.fg[i], A.fg[i], `boot frame ${k} fg of cell ${i}`); assert.equal(f.bg[i], A.bg[i]); } else if (f.glyphs[i] !== 32) other++;
    }
    if (rgb > 0 && other > 0) mixed++;
  }
  assert.ok(mixed > 0, 'saw boot frames with both the console and full-colour cells');
});

test('FC14 keepForHandover and the library hand-over loop keep fg/bg (eject frame -> library first frame)', async () => {
  const seam = (f) => {
    for (let i = 0; i < f.glyphs.length; i++) { f.glyphs[i] = 88; f.shades[i] = RGB_CELL; f.fg[i] = glowFg(i); f.bg[i] = glowBg(i); }
  };
  const sh = await running([makeGlow()], { drawInsert: seam });
  sh.actions.eject();
  assert.equal(sh.state().screen, 'eject');
  const e = sh.frame(); // draws the (seam) eject frame and keeps it for the hand-over
  assert.ok(e.fg, 'eject frame carries fg');
  e.fg.fill(0); e.bg.fill(0); // the live buffers go stale (the library draws over the same frame); only the kept copy still has the colours
  for (let k = 0; k < 40 && sh.state().screen === 'eject'; k++) { sh.tick(0.05); }
  assert.equal(sh.state().screen, 'library');
  const lib = sh.frame(); // first library frame: handT = 0, so every cell still comes from the kept frame
  assert.ok(lib.fg, 'library frame took the kept frame\'s colours');
  let kept = 0;
  for (let i = 0; i < N - 1; i++) {
    if (lib.shades[i] !== RGB_CELL) continue;
    kept++;
    assert.equal(lib.fg[i], glowFg(i), `fg of cell ${i}`);
    assert.equal(lib.bg[i], glowBg(i), `bg of cell ${i}`);
  }
  assert.ok(kept > N / 2, `most cells came from the kept frame (${kept})`);
});
