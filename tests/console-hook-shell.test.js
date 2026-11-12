// DRIFT-7 C11: the console hook, shell side. The console is split into a BODY (which the hook replaces) and an OVERLAY (the screen text
// and the LEDs, which the shell still draws on top). On insert, step 5 calls the hook INSTEAD of the band sweep, if its module had loaded
// when step 5 began (decided once); boot calls it with the rest of the morph; eject plays the insert backwards. All cartridges are
// temp-folder install-folder fixtures through the real loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScenes as realLoadScenes, discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';
import {
  consoleGrid, consoleBodyGrid, consoleOverlayGrid, miniGrid, miniBodyGrid, miniOverlayGrid, consoleStyle, gridRows, drawShelf, shelfLayout, screenRect,
  CONSOLE_W, CONSOLE_H, MINI_W, MINI_H,
} from '../src/shell/library.js';
import { drawInsert, INSERT_END, INSERT_CLICK_END, INSERT_MORPH, insertMorph } from '../src/shell/insert.js';
import { drawBoot, bootMorph, bootPhases, BAR_END } from '../src/shell/boot.js';
import { driftmanSkin } from '../src/shell/driftman.js';
import { libraryPalette } from '../src/shell/shell.js';
import { newFrame, ramp } from '../src/shell/ui.js';
import { RGB_CELL, PALETTE_BG } from '../src/renderer.js';
import {
  insertedShell, gatedLoader, recorderHookSource, calmHookSource, harshHookSource, writeConsoleCart, runFlow, flush, DT, SPEEDS, copyOf, SIZES,
} from './helpers-console-hook.js';
import { tmpRoot } from './helpers-cartridge.js';

const skin = driftmanSkin;
const recorder = recorderHookSource();

// ---- the split

const SEL = { id: 'a', title: 'Alpha', code: 'DM-09', blurb: 'A blurb for the screen', facts: ['Genre: test'], locked: false, label: [], tint: 20 };
const UI = { text: 15, dim: 19, head: 15, accent: 16 };
const STYLES = [{}, { led: 'on', ledShade: 16, openShade: 18, shade: 7 }, { box: '+-+|+-+|', shade: 9, led: 'solid', link: true }];
const same = (a, b) => a.g.every((v, i) => v === b.g[i]) && a.s.every((v, i) => v === b.s[i]);

test('S1 split: body and overlay share no cell, and together they are the console (full and mini, three styles)', () => {
  for (const st0 of STYLES) {
    const st = consoleStyle(skin, st0);
    const o = { st, ui: UI, n: 5, index: 2 };
    const whole = consoleGrid(SEL, o), body = consoleBodyGrid(o), over = consoleOverlayGrid(SEL, o);
    for (let i = 0; i < whole.g.length; i++) {
      assert.ok(body.g[i] === 32 || over.g[i] === 32, `cell ${i} is in both layers`);
      const want = over.g[i] !== 32 ? over : body;
      assert.equal(whole.g[i], want.g[i], `glyph ${i}`);
      assert.equal(whole.s[i], want.g[i] === 32 ? 0 : want.s[i], `shade ${i}`);
    }
    const mw = miniGrid({ st, ui: UI }), mb = miniBodyGrid({ st, ui: UI }), mo = miniOverlayGrid({ st, ui: UI });
    for (let i = 0; i < mw.g.length; i++) {
      assert.ok(mb.g[i] === 32 || mo.g[i] === 32, `mini cell ${i} is in both layers`);
      const want = mo.g[i] !== 32 ? mo : mb;
      assert.equal(mw.g[i], want.g[i]);
      assert.equal(mw.s[i], want.g[i] === 32 ? 0 : want.s[i]);
    }
  }
});

test('S1 split: the overlay is exactly the screen text (rows 4-12, columns 4-47) and the LED row (row 3, columns 53-77); the mini overlay is its LED row (row 2)', () => {
  const st = consoleStyle(skin, { led: 'on', ledShade: 16 });
  const over = consoleOverlayGrid(SEL, { st, ui: UI, n: 5 });
  const cells = [];
  for (let y = 0; y < over.h; y++) for (let x = 0; x < over.w; x++) if (over.g[y * over.w + x] !== 32) cells.push([x, y]);
  assert.ok(cells.length > 40);
  for (const [x, y] of cells) {
    const screen = y >= 4 && y <= 12 && x >= 4 && x <= 47;
    const led = y === 3 && x >= 53 && x <= 77;
    assert.ok(screen || led, `overlay cell (${x}, ${y}) is neither screen text nor an LED`);
  }
  assert.ok(cells.some(([x, y]) => y === 3 && x === 53), 'the PWR LED is at column 53 of row 3');
  assert.ok(cells.some(([, y]) => y >= 4), 'screen text is there');
  const mo = miniOverlayGrid({ st, ui: UI });
  const mc = [];
  for (let y = 0; y < mo.h; y++) for (let x = 0; x < mo.w; x++) if (mo.g[y * mo.w + x] !== 32) mc.push([x, y]);
  assert.equal(mc.length, 9, 'two LED glyphs and the PWR and CART letters');
  for (const [x, y] of mc) assert.ok(y === 2 && x >= 2 && x <= 14, `mini overlay cell (${x}, ${y})`);
  // geometry: the screen rect is local (3, 4) 46 x 9 at the full console, null at the mini console, which has no screen
  const L = shelfLayout(120, 40, 'full');
  assert.deepEqual(screenRect(120, 40), { x: L.consoleX + 3, y: L.consoleTop + 4, w: 46, h: 9 });
  assert.equal(CONSOLE_W, 84); assert.equal(CONSOLE_H, 18); assert.equal(MINI_W, 38); assert.equal(MINI_H, 4);
});

// ---- helpers for the wiring tests

function itemOf(cols, rows) {
  const lib = libraryPalette([{ manifest: { labelHue: '#7FB069' } }], 'truecolor');
  const entry = { id: 'fx', title: 'Fx', code: 'DM-09', blurb: 'b', facts: [], locked: false, label: ['+----+', '| FX |', '+----+'], ink: null, tint: lib.tints[0] };
  return { cartridge: entry, view: { cartridges: [entry], index: 0, prev: 0, slide: 1, type: 1, idle: 0, dip: 0, message: '' }, cartSkin: null, classic: false };
}

// A hook wrapper that fails the test when the wrapped hook changes anything outside ctx.rect (the pre-call frame is the reference)
function fence(inner, found) {
  return {
    id: 'fence',
    drawConsole(f, c) {
      const before = { g: f.glyphs.slice(), s: f.shades.slice(), fg: f.fg.slice(), bg: f.bg.slice() };
      inner.drawConsole(f, c);
      const r = c.rect;
      let outside = 0, inside = 0;
      for (let y = 0; y < f.rows; y++) {
        for (let x = 0; x < f.cols; x++) {
          const i = y * f.cols + x;
          const changed = f.glyphs[i] !== before.g[i] || f.shades[i] !== before.s[i] || f.fg[i] !== before.fg[i] || f.bg[i] !== before.bg[i];
          if (!changed) continue;
          if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) inside++; else outside++;
        }
      }
      found.push({ phase: c.phase, p: c.p, tier: c.tier, outside, inside });
    },
  };
}
const trespasser = {
  id: 'trespasser',
  drawConsole(f, c) { const i = (c.rect.y - 1) * f.cols + c.rect.x + 3; f.glyphs[i] = 90; f.shades[i] = RGB_CELL; f.fg[i] = 0xFFFFFF; f.bg[i] = 0; },
};

// a fixture hook as a live object (the same source the shell loads, through the real loader), for the draw-level tests
async function liveHook(source) {
  const root = tmpRoot('drift-hook-live-');
  writeConsoleCart(root, 'live', { source });
  const d = discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
  const r = await realLoadScenes(d.cartridges[0]);
  assert.deepEqual(r.errors, []);
  return r.console;
}

// ---- 4. writes only inside the rect

test('S4 the hook writes only inside rect at every phase and p, at both tiers; a trespasser is caught by the same fence (control); the shell\'s overlay cells stay the shell\'s', async () => {
  const calm = await liveHook(calmHookSource());
  const harsh = await liveHook(harshHookSource());
  for (const [cols, rows, tier] of [[120, 40, 'full'], [240, 67, 'full'], [80, 24, 'mini']]) {
    for (const phase of ['insert', 'boot', 'eject']) {
      for (const p of [0, 0.25, 0.55, 0.8, 1]) {
        for (const [name, hook, expectOutside] of [['calm', calm, false], ['harsh', harsh, false], ['trespasser', trespasser, true]]) {
          const found = [];
          const f = newFrame(cols, rows);
          const item = itemOf(cols, rows);
          drawInsert(f, { item, t: phase === 'boot' ? INSERT_END : 1.25, hook: fence(hook, found), phase, hookP: p, hookT: 0.2 }, skin);
          assert.equal(found.length, 1, `${name} ${phase} p ${p} ${cols}x${rows}: the hook was called once`);
          assert.equal(found[0].tier, tier);
          assert.equal(found[0].p, p);
          assert.equal(found[0].phase, phase);
          if (expectOutside) assert.ok(found[0].outside > 0, `${name}: the fence sees the trespass`);
          else { assert.equal(found[0].outside, 0, `${name} ${phase} p ${p} ${cols}x${rows}: wrote outside rect`); assert.ok(found[0].inside > 100, `${name}: it drew inside`); }
        }
      }
    }
  }
});

test('S4 the screen text and the LEDs are the shell\'s: an aggressive hook that fills its whole rect with full-colour cells leaves every overlay cell as the overlay drew it', async () => {
  const fill = { id: 'fill', drawConsole(f, c) { const r = c.rect; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const i = y * f.cols + x; f.glyphs[i] = 0x2588; f.shades[i] = RGB_CELL; f.fg[i] = 0x336699; f.bg[i] = 0x112233; } } };
  const lib = libraryPalette([{ manifest: { labelHue: '#7FB069' } }], 'truecolor');
  const entry = { id: 'fx', title: 'Fx', code: 'DM-09', blurb: 'The blurb', facts: ['Genre: test'], locked: false, label: [], ink: null, tint: lib.tints[0] };
  for (const [cols, rows] of [[120, 40], [80, 24]]) {
    const f = newFrame(cols, rows);
    const view = { cartridges: [entry], index: 0, prev: 0, slide: 1, type: 1, idle: 0, dip: 0, message: '', tier: undefined };
    const L = drawShelf(f, view, skin, { hook: { hook: fill, phase: 'insert', p: 0.3, t: 1.2 }, body: { led: 'on', ledShade: 16, openShade: 18 } });
    const st = consoleStyle(skin, { led: 'on', ledShade: 16, openShade: 18 });
    const full = L.full;
    const over = full ? consoleOverlayGrid(entry, { st, ui: skin.palette.ui, n: 1, type: 1 }) : miniOverlayGrid({ st, ui: skin.palette.ui });
    const cx = full ? L.consoleX : L.miniX, cy = full ? L.consoleTop : L.miniTop;
    let n = 0;
    for (let y = 0; y < over.h; y++) {
      for (let x = 0; x < over.w; x++) {
        const o = y * over.w + x;
        if (over.g[o] === 32) continue;
        const i = (cy + y) * cols + cx + x;
        n++;
        assert.equal(f.glyphs[i], over.g[o], `overlay glyph at ${x},${y}`);
        assert.equal(f.shades[i], over.s[o], `overlay shade at ${x},${y} is a palette shade, not 255`);
      }
    }
    assert.ok(n > 8, `${cols}x${rows}: ${n} overlay cells checked`);
    // and the body really is the hook's: a cell of the rect away from the overlay is a full-colour cell
    assert.equal(f.shades[(cy + CONSOLE_H - 1 - (full ? 0 : 14)) * cols + cx + 1], RGB_CELL);
  }
});

// ---- 5. insert: used when loaded in time, decided once

const noHookLoader = async (cart) => { const r = await realLoadScenes(cart); const { console: _c, ...rest } = r; return rest; };

async function insertRun(over = {}, runOpts = {}) {
  const { sh } = insertedShell(120, 40, { source: recorder, ...over });
  await over.afterCreate?.(sh);
  return { sh, rec: runFlow(sh, { done: (s) => s.state().screen === 'running' || s.state().screen === 'error', ...runOpts }) };
}
const callsOf = (rec) => rec.flatMap((x) => x.calls);
const LAY = shelfLayout(120, 40, 'full');

test('S5 insert: loaded in time -> the hook is called once per frame from t = 1.0 (p = 0.55 * ramp over step 5), never before; the standard band sweep is not drawn', async () => {
  const { sh } = insertedShell(120, 40, { source: recorder });
  await flush();
  const rec = runFlow(sh, { done: (s) => s.state().screen === 'boot' });
  const calls = callsOf(rec);
  assert.ok(calls.length >= 8, `${calls.length} insert calls`);
  rec.forEach((x) => { if (x.clock < INSERT_CLICK_END - 1e-9) assert.equal(x.calls.length, 0, `no call at ${x.clock}`); else assert.equal(x.calls.length, 1, `one call at ${x.clock}`); });
  let prev = -1;
  for (const [k, c] of calls.entries()) {
    assert.equal(c.phase, 'insert');
    assert.equal(c.tier, 'full');
    assert.deepEqual(c.rect, { x: LAY.consoleX, y: LAY.consoleTop, w: 84, h: 18 });
    assert.deepEqual(c.screen, { x: c.rect.x + 3, y: c.rect.y + 4, w: 46, h: 9 });
    assert.ok(Math.abs(c.p - INSERT_MORPH * ramp(c.t, 1.0, 1.5)) < 1e-12, `call ${k}: p ${c.p} at t ${c.t}`);
    assert.ok(c.p >= prev, 'p never decreases');
    prev = c.p;
  }
  assert.ok(calls[0].p < 1e-9, 'the first call is at p = 0');
  assert.ok(calls[calls.length - 1].p < INSERT_MORPH && calls[calls.length - 1].p > 0.45);
  assert.equal(insertMorph(1.5), INSERT_MORPH);
  // the rect is where the shell draws the console: its screen is the boot's screen rectangle
  assert.deepEqual(calls[0].screen, screenRect(120, 40));
  // the standard sweep leaves no trace: the cells in the rect are the hook's full-colour cells, not palette shades, in the console's body rows
  const last = rec[rec.length - 1].f;
  const r = calls[0].rect;
  let rgb = 0;
  for (let x = 0; x < r.w; x++) if (last.shades[(r.y + 17) * 120 + r.x + x] === RGB_CELL) rgb++;
  assert.ok(rgb > 40, `the bottom row of the console is the hook's (${rgb} full-colour cells)`);
});

test('S5 insert: NOT loaded at the first frame with t >= 1.0 -> the standard sweep for the whole insert (and the boot), byte-identical to a cartridge without a hook; a late load never switches', async () => {
  // reference: the same cartridge, loader returns no hook at all
  const ref = insertedShell(120, 40, { source: recorder, loadScenes: noHookLoader });
  await flush();
  const refRec = runFlow(ref.sh, { done: (s) => s.state().screen === 'running' });
  assert.equal(callsOf(refRec).length, 0);
  // late: held back by a gate, resolved after the first frame with t >= 1.0 has been drawn
  let open; const gate = new Promise((r) => { open = r; });
  const late = insertedShell(120, 40, { source: recorder, loadScenes: gatedLoader(gate) });
  await flush();
  const calls = [];
  globalThis.__driftHookCalls = calls;
  const seen = [];
  let opened = false;
  for (let k = 0; late.sh.state().screen !== 'running' && k < 400; k++) {
    calls.length = 0;
    const f = late.sh.frame();
    seen.push({ screen: late.sh.state().screen, f: copyOf(f), n: calls.length, k });
    if (!opened && k >= Math.ceil(1.0 / DT)) { opened = true; open(); await flush(); } // the load lands just after the t = 1.0 frame
    late.sh.tick(DT);
    if (late.sh.state().screen === 'boot' && !opened) { opened = true; open(); await flush(); }
  }
  globalThis.__driftHookCalls = null;
  assert.equal(late.sh.state().screen, 'running');
  assert.equal(seen.reduce((a, x) => a + x.n, 0), 0, 'the hook was never called, in the insert or the boot');
  // compare the insert and boot frames with the reference, frame by frame (the boot waits for the load, so compare the common prefix of insert frames and the boot start)
  const n = seen.findIndex((x) => x.screen === 'boot') + 6;
  for (let k = 0; k < n; k++) {
    assert.deepEqual([...seen[k].f.glyphs], [...refRec[k].f.glyphs], `frame ${k} glyphs`);
    assert.deepEqual([...seen[k].f.shades], [...refRec[k].f.shades], `frame ${k} shades`);
    assert.equal(seen[k].f.fg, null, `frame ${k} carries no full-colour cells`);
  }
});

test('S5 insert: the decision is made at the first frame with t >= 1.0 even when the frame step jumps over 1.0; a loader that resolves between 0.9 s and 1.2 s', async () => {
  // A: resolves at 0.9 s (before step 5) -> used
  for (const jump of [false, true]) {
    let open; const gate = new Promise((r) => { open = r; });
    const { sh } = insertedShell(120, 40, { source: recorder, loadScenes: gatedLoader(gate) });
    await flush();
    const calls = []; globalThis.__driftHookCalls = calls;
    sh.frame(); sh.tick(0.9); sh.frame();
    assert.equal(calls.length, 0);
    open(); await flush(); // resolved between 0.9 s and 1.2 s
    sh.tick(jump ? 0.3 : 0.1); // jump: the next frame is at 1.2 s, the first with t >= 1.0
    sh.frame();
    assert.equal(calls.length, 1, `jump ${jump}: used from the first frame at or past 1.0`);
    assert.ok(Math.abs(calls[0].t - (jump ? 1.2 : 1.0)) < 1e-9);
    assert.ok(Math.abs(calls[0].p - INSERT_MORPH * ramp(calls[0].t, 1, 1.5)) < 1e-12);
    for (let k = 0; k < 20; k++) { sh.tick(DT); sh.frame(); }
    assert.ok(calls.length >= 3, 'and for every frame after');
    globalThis.__driftHookCalls = null;
  }
  // B: the first frame at or past 1.0 is drawn before the load resolves (a step that jumps from 0.9 to 1.2 draws it at 1.2) -> not used, ever
  let open; const gate = new Promise((r) => { open = r; });
  const { sh } = insertedShell(120, 40, { source: recorder, loadScenes: gatedLoader(gate) });
  await flush();
  const calls = []; globalThis.__driftHookCalls = calls;
  sh.frame(); sh.tick(0.9); sh.frame(); sh.tick(0.3); sh.frame(); // t = 1.2 drawn: undecided -> decided "not loaded"
  open(); await flush(); // resolves at 1.2 s, mid-sweep
  for (let k = 0; k < 8; k++) { sh.tick(DT); sh.frame(); } // 1.27 ... 1.7: the rest of the sweep, the boot's start
  assert.equal(calls.length, 0, 'a load that lands mid-sweep does not switch the console');
  assert.equal(sh.state().screen, 'boot');
  globalThis.__driftHookCalls = null;
});

test('S5 a failed hook never reaches the console: its load error shows the error card and the hook is not called by the insert (decided "not loaded")', async () => {
  const bad = 'export default { id: "bad", drawConsole() { throw new Error("nope"); } };\n';
  const { sh } = insertedShell(120, 40, { source: bad });
  await flush();
  const rec = runFlow(sh, { done: (s) => s.state().screen === 'error' });
  assert.equal(sh.state().screen, 'error');
  assert.equal(callsOf(rec).length, 0);
});

// ---- 6. the seam, boot, remap, hand-over

test('S6 p is one continuous non-decreasing ramp: insert 0 to 0.55, boot 0.55 to 1 over the boot\'s on phase, then 1; continuous at the seam', async () => {
  assert.equal(insertMorph(1.5), bootMorph(0, null), 'p at insert t = 1.5 equals p at boot bt = 0');
  assert.equal(bootMorph(0, null), INSERT_MORPH);
  const on = bootPhases(null).on;
  assert.ok(Math.abs(on - 0.4) < 1e-9);
  assert.equal(bootMorph(on, null), 1);
  assert.equal(bootMorph(on + 3, null), 1);
  let prev = -1;
  for (let t = 0; t <= 1.5 + 1e-9; t += 0.001) { const p = insertMorph(t); assert.ok(p >= prev); prev = p; }
  for (let t = 0; t <= 5.8; t += 0.001) { const p = bootMorph(t, null); assert.ok(p >= prev - 1e-12, `boot ${t}`); prev = p; }
  const { sh } = insertedShell(120, 40, { source: recorder });
  await flush();
  const rec = runFlow(sh, { done: (s) => s.state().screen === 'running' });
  const calls = callsOf(rec);
  const phases = calls.map((c) => c.phase);
  assert.deepEqual([...new Set(phases)], ['insert', 'boot']);
  assert.equal(phases.indexOf('boot') > 0, true);
  let last = -1;
  for (const c of calls) { assert.ok(c.p >= last, `p ${c.p} after ${last}`); assert.ok(c.p >= 0 && c.p <= 1); last = c.p; }
  const ins = calls.filter((c) => c.phase === 'insert'), boot = calls.filter((c) => c.phase === 'boot');
  assert.ok(boot[0].p - ins[ins.length - 1].p <= INSERT_MORPH * DT / 0.5 + 1e-9, 'no jump at the seam beyond one frame step');
  assert.equal(boot[0].p, INSERT_MORPH, 'the first boot call is at p = 0.55');
  for (const c of boot) {
    if (c.t >= on - 1e-9) assert.equal(c.p, 1, `boot t ${c.t}: p is 1 from the end of the on phase (steps 8 and 9 and on)`);
    else assert.ok(c.p >= INSERT_MORPH && c.p < 1, `boot t ${c.t}: p ${c.p} is mid-morph in steps 6 and 7`);
    assert.ok(Math.abs(c.t - Math.min(c.t, 5.8)) < 1e-9);
  }
  assert.ok(boot.some((c) => c.t > 3.4 && c.t < BAR_END + 0.5), 'the hook is called through step 9 (the progress bar)');
});

test('S6 boot remap: full-colour cells (shade 255) survive the library -> boot palette remap, palette cells are still remapped (drawBoot with a shifting consoleMap)', async () => {
  const mixed = {
    id: 'mixed',
    drawConsole(f, c) {
      const r = c.rect;
      for (let x = 0; x < r.w; x++) {
        const a = (r.y + 17) * f.cols + r.x + x; // bottom row: even columns full colour, odd columns a palette cell (shade 3)
        f.glyphs[a] = 0x2580;
        if (x % 2 === 0) { f.shades[a] = RGB_CELL; f.fg[a] = 0x123456; f.bg[a] = x % 4 === 0 ? PALETTE_BG : 0x654321; } else f.shades[a] = 3;
      }
    },
  };
  const item = itemOf(120, 40);
  const f = newFrame(120, 40);
  drawBoot(f, { skin: null, t: 1.0, item, title: 'Fx', hook: mixed, consoleMap: (s) => s + 40 }, skin);
  const L = shelfLayout(120, 40, 'full');
  const y = L.consoleTop + 17;
  let rgb = 0, pal = 0;
  for (let x = 0; x < 84; x++) {
    const i = y * 120 + L.consoleX + x;
    if (x % 2 === 0) {
      assert.equal(f.shades[i], RGB_CELL, `col ${x} stays a full-colour cell`);
      assert.equal(f.fg[i], 0x123456);
      assert.equal(f.bg[i], x % 4 === 0 ? PALETTE_BG : 0x654321, 'PALETTE_BG is kept as PALETTE_BG');
      rgb++;
    } else { assert.equal(f.shades[i], 43, `col ${x}: the palette shade 3 is remapped to 43`); pal++; }
  }
  assert.equal(rgb, 42); assert.equal(pal, 42);
});

test('S6 hand-over: through the real shell, the boot frames keep the hook\'s full-colour cells (shade 255, its fg/bg, PALETTE_BG) in the merged boot palette', async () => {
  const { sh } = insertedShell(120, 40, { source: calmHookSource() });
  await flush();
  const lib = libraryPalette([{ manifest: { labelHue: '#7FB069' } }], 'truecolor').pal.key;
  const rec = runFlow(sh, { done: (s) => s.state().screen === 'running' });
  const insertLast = rec.filter((x) => x.screen === 'insert').pop().f;
  assert.equal(insertLast.palette.key, lib, 'the insert is in the library palette');
  const boots = rec.filter((x) => x.screen === 'boot' && x.clock >= 1.5 + 0.6 && x.clock <= 1.5 + 2.2);
  assert.ok(boots.length > 10);
  for (const b of boots) {
    assert.ok(b.f.palette.key.startsWith('boot:'), 'the boot is in the merged palette: ' + b.f.palette.key);
    assert.ok(b.f.fg && b.f.bg, 'fg/bg ride along');
    let rgb = 0, pbg = 0;
    for (let i = 0; i < b.f.shades.length; i++) {
      if (b.f.shades[i] !== RGB_CELL) continue;
      rgb++;
      assert.ok(b.f.fg[i] <= 0xFFFFFF);
      assert.ok(b.f.bg[i] <= 0xFFFFFF || b.f.bg[i] === PALETTE_BG);
      if (b.f.bg[i] === PALETTE_BG) pbg++;
    }
    assert.ok(rgb > 300, `${rgb} full-colour cells at ${b.clock}`);
    assert.ok(pbg > 300, `${pbg} cells keep PALETTE_BG at ${b.clock}`);
  }
  // the console body in the boot frame is the hook's p = 1 picture, outside the screen, the slot rows and the LEDs
  const hook = await liveHook(calmHookSource());
  const L = shelfLayout(120, 40, 'full');
  const ref = newFrame(120, 40);
  hook.drawConsole(ref, { phase: 'boot', p: 1, t: 1, rect: { x: L.consoleX, y: L.consoleTop, w: 84, h: 18 }, screen: screenRect(120, 40), tier: 'full' });
  const b = boots[Math.floor(boots.length / 2)].f;
  let compared = 0;
  const R = screenRect(120, 40);
  for (let y = 2; y < 18; y++) {
    for (let x = 0; x < 84; x++) {
      const fx = L.consoleX + x, fy = L.consoleTop + y;
      if (fx >= R.x - 1 && fx < R.x + R.w + 1 && fy >= R.y - 1 && fy < R.y + R.h + 1) continue;
      if (y === 3 && x >= 53) continue; // the LEDs
      const i = fy * 120 + fx;
      if (ref.shades[i] !== RGB_CELL) continue;
      compared++;
      assert.equal(b.shades[i], RGB_CELL, `(${x},${y})`);
      assert.equal(b.glyphs[i], ref.glyphs[i]);
      assert.equal(b.fg[i], ref.fg[i]);
      assert.equal(b.bg[i], ref.bg[i]);
    }
  }
  assert.ok(compared > 200, `${compared} body cells compared`);
});

// ---- 7. eject plays the insert backwards

test('S7 eject: the hook is called after the 0.3 s fade, phase "eject", p falling from 0.55 to 0 with t falling from 1.5 to 1.0; and not at all when the insert used the standard console', async () => {
  const { sh } = insertedShell(120, 40, { source: recorder });
  await flush();
  runFlow(sh, { done: (s) => s.state().screen === 'running' });
  sh.key('e');
  assert.equal(sh.state().screen, 'eject');
  const rec = runFlow(sh, { done: (s) => s.state().screen === 'library' });
  const calls = callsOf(rec);
  assert.ok(calls.length >= 6);
  rec.forEach((x) => { if (x.clock < 0.3 - 1e-9) assert.equal(x.calls.length, 0, `no hook call during the 0.3 s fade (${x.clock})`); });
  let prev = Infinity;
  for (const c of calls) {
    assert.equal(c.phase, 'eject');
    assert.ok(c.p <= prev + 1e-12 && c.p <= INSERT_MORPH + 1e-12, `p ${c.p} folds back from 0.55`);
    assert.ok(Math.abs(c.p - INSERT_MORPH * ramp(c.t, 1.0, 1.5)) < 1e-12);
    prev = c.p;
  }
  assert.ok(calls[0].p > 0.4 && calls[0].p <= 0.55);
  assert.ok(calls[calls.length - 1].p < 0.1);
  // the standard-console insert: no hook on the eject either
  let open; const gate = new Promise((r) => { open = r; });
  const late = insertedShell(120, 40, { source: recorder, loadScenes: gatedLoader(gate) });
  await flush();
  late.sh.frame(); late.sh.tick(1.2); late.sh.frame(); open(); await flush();
  runFlow(late.sh, { done: (s) => s.state().screen === 'running' });
  late.sh.key('e');
  const rec2 = runFlow(late.sh, { done: (s) => s.state().screen === 'library' });
  assert.equal(callsOf(rec2).length, 0);
});

// ---- 8. cartridges without the field draw as they did

test('S8 the shipped cartridges (Night Drive, Delza, Classic, ...) have no console field and the loader returns no console key for them', async () => {
  const d = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
  assert.deepEqual(d.errors, []);
  assert.ok(d.cartridges.length >= 4);
  for (const c of d.cartridges) {
    if (c.id === 'driftman-9000') { // the one shipped cartridge with a console hook (DRIFT-7 C13; its own tests are in driftman-9000-console.test.js)
      assert.equal(c.manifest.console, 'code');
      assert.ok(c.consoleFile);
      continue;
    }
    assert.equal(c.manifest.console, undefined, c.id);
    assert.equal(c.consoleFile, undefined, c.id);
    if (c.locked || c.runtime === 'classic') continue;
    const r = await realLoadScenes(c);
    assert.deepEqual(Object.keys(r).sort(), ['errors', 'scenes'], c.id);
  }
});

test('S8 drawInsert with a hook but before step 5 (t < 1.0) is exactly the no-hook picture; a null hook is the no-hook picture at every t', async () => {
  const hook = await liveHook(calmHookSource());
  for (const [cols, rows] of [[120, 40], [80, 24], [41, 11]]) {
    const item = itemOf(cols, rows);
    for (let t = 0; t <= INSERT_END + 1e-9; t += 0.075) {
      const a = newFrame(cols, rows), b = newFrame(cols, rows), c = newFrame(cols, rows);
      drawInsert(a, { item, t }, skin);
      drawInsert(b, { item, t, hook: null }, skin);
      drawInsert(c, { item, t, hook }, skin);
      assert.deepEqual([...b.glyphs], [...a.glyphs]);
      assert.deepEqual([...b.shades], [...a.shades]);
      if (t < INSERT_CLICK_END) { assert.deepEqual([...c.glyphs], [...a.glyphs], `t ${t}`); assert.deepEqual([...c.shades], [...a.shades], `t ${t}`); }
    }
  }
});

test('S8 the hook is never called at the list and tiny tiers (no console art there)', async () => {
  for (const [cols, rows] of [[41, 11], [30, 10], [4, 2]]) {
    const { sh } = insertedShell(cols, rows, { source: recorder });
    await flush();
    const rec = runFlow(sh, { done: (s) => s.state().screen === 'running' || s.state().screen === 'error' });
    assert.equal(callsOf(rec).length, 0, `${cols}x${rows}`);
  }
});

// ---- 9. clock steps 1x-4x by four phases; both tiers

test('S9 the insert/boot ramp at clock speeds 1x to 4x, four clock phases each: p never decreases, stays in [0, 1], the decision holds, and it ends in the boot at p = 1', async () => {
  for (const speed of SPEEDS) {
    for (const ph of [0, 0.25, 0.5, 0.75]) {
      const { sh } = insertedShell(120, 40, { source: recorder });
      await flush();
      const rec = runFlow(sh, { dt: DT * speed, first: ph * DT * speed, done: (s) => s.state().screen === 'running' });
      const calls = callsOf(rec);
      assert.ok(calls.length >= 3, `speed ${speed} phase ${ph}: ${calls.length} calls`);
      let last = -1;
      for (const c of calls) { assert.ok(c.p >= last - 1e-12 && c.p >= 0 && c.p <= 1, `speed ${speed} phase ${ph}: p ${c.p} after ${last}`); last = c.p; }
      assert.equal(calls[calls.length - 1].p, 1);
      const firstInsert = calls.find((c) => c.phase === 'insert');
      if (firstInsert) assert.ok(firstInsert.t >= 1.0 - 1e-9, 'never before 1.0 s');
      // once the hook starts it is drawn in every following insert/boot frame (no switching back to the standard console)
      const k0 = rec.findIndex((x) => x.calls.length);
      for (const x of rec.slice(k0)) if (x.screen === 'insert' || x.screen === 'boot') assert.equal(x.calls.length, 1, `speed ${speed} phase ${ph}: a frame at ${x.clock.toFixed(3)} without the hook`);
    }
  }
});

test('S9 size coverage: the hook is called at every tier - full (88x39, 120x40, 176x58, 240x67) with tier "full", compact (78x24, 80x24) with tier "mini"', async () => {
  for (const [cols, rows] of SIZES) {
    const { sh } = insertedShell(cols, rows, { source: recorder });
    await flush();
    const rec = runFlow(sh, { done: (s) => s.state().screen === 'running' });
    const calls = callsOf(rec);
    const full = cols >= 88 && rows >= 39;
    assert.ok(calls.length > 20, `${cols}x${rows}: ${calls.length} calls`);
    for (const c of calls) {
      assert.equal(c.tier, full ? 'full' : 'mini', `${cols}x${rows}`);
      assert.deepEqual([c.rect.w, c.rect.h], full ? [84, 18] : [38, 4]);
      assert.equal(c.screen === null, !full);
    }
    const lit = rec.filter((x) => x.screen === 'insert' && x.calls.length).pop().f;
    let rgb = 0;
    for (let i = 0; i < lit.shades.length; i++) if (lit.shades[i] === RGB_CELL) rgb++;
    assert.ok(rgb > (full ? 300 : 40), `${cols}x${rows}: ${rgb} full-colour cells on screen`);
  }
});
