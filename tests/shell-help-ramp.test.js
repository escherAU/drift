// DRIFT-7 C10: the help panel (h) of a running cartridge ramps in and out over MENU_RAMP_SECONDS (0.25 s) as a dissolve, the way the menu
// does, instead of cutting in. The panel is drawn into a copy of the frame and its cells flip in by the same linear per-cell thresholds
// (dissolveFrames); closing is the reverse and keeps the panel on the cells that have not flipped yet. The ramp clock is real seconds (not
// scaled by the runtime speed) and runs while the scene is frozen behind the open panel. Before this change the panel covered about 55% of
// an 80x24 screen in one frame (L3 of the flash meter, and a key frame over the 40% ceiling on a lit full-colour scene).
// A real shell on a full-colour fixture (every cell lit, fg/bg on four cells in five) built in memory; nothing is written under cartridges/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShell } from '../src/shell/shell.js';
import { MENU_RAMP_SECONDS } from '../src/shell/runtime.js';
import { driftmanSkin } from '../src/shell/driftman.js';
import { RGB_CELL, makeGlow, makePlain, sameCell } from './helpers-fullcolour.js';
import { FLASH_FRACTION } from './helpers-flash.js';
import { shownMeter } from './helpers-flash-modes.js';
import { boot, grab, DT, ESC, SIX } from './helpers-night-drive-shell.js';
import { mkShell, runCartridge } from './helpers-shell.js';

const SKIN = { ...driftmanSkin, frame: { ...driftmanSkin.frame, show: 'never' } };
const SPEEDS = [1, 2, 3, 4];
const FPS = 18;
const HARD_CEILING = 0.4;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

async function running(cols, rows, { plain = false, speed = 4, cmode = 'truecolor' } = {}) {
  const scene = plain ? makePlain() : makeGlow();
  const progs = [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: [scene.id], sceneSeconds: 20 }];
  const manifest = { id: 'fx', title: 'Fixture', blurb: 'b', facts: [], programs: progs, start: 'main', scenes: [], labelHue: '#7FB069' };
  const cart = { id: 'fx', title: 'Fixture', manifest, locked: false, runtime: 'cartridge', label: ['+----+', '| FX |', '+----+'], labelInk: null, skin: SKIN, boot: null, trusted: true };
  const scenes = [{ id: scene.id, kind: 'cells', family: 'cells', scene }];
  const sh = createShell({
    cols, rows, cartridges: [cart], seed: 1, cmode, loadScenes: async () => ({ scenes, errors: [] }),
    host: { persist() {}, quit() {}, leaveToClassic() {} },
    consts: { SPEEDS, DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 },
    start: { cartridge: 'fx', skipBoot: true },
  });
  await flush();
  sh.tick(0.05); await flush(); sh.tick(0.05);
  assert.equal(sh.state().screen, 'running');
  for (let k = SPEEDS.length; k > speed; k--) sh.key('-'); // the runtime starts at 4x
  return sh;
}
const copyOf = (f) => ({ glyphs: f.glyphs.slice(), shades: f.shades.slice(), fg: f.fg ? f.fg.slice() : null, bg: f.bg ? f.bg.slice() : null, palette: f.palette, cols: f.cols, rows: f.rows });
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const moved = (a, b) => { let n = 0; for (let i = 0; i < a.glyphs.length; i++) if (a.glyphs[i] !== b.glyphs[i] || a.shades[i] !== b.shades[i]) n++; return n / a.glyphs.length; };

// scene frame, the fully open panel, and the same panel arrived at by one big step (the old hard cut)
async function references(cols, rows, opts) {
  const sh = await running(cols, rows, opts);
  const scene = copyOf(sh.frame());
  sh.key('h'); sh.tick(0.6);
  const panel = copyOf(sh.frame());
  const cut = await running(cols, rows, opts);
  cut.frame(); cut.key('h'); cut.tick(0.3); // one step longer than the ramp: p = 1 at once, the old behaviour
  return { scene, panel, hard: copyOf(cut.frame()) };
}

test('the ramp is MENU_RAMP_SECONDS: the key frame is the scene, then the panel flips in cell by cell and is whole after 0.25 s', async () => {
  assert.equal(MENU_RAMP_SECONDS, 0.25);
  const { scene, panel, hard } = await references(80, 24);
  assert.deepEqual([...panel.glyphs], [...hard.glyphs], 'the finished ramp is the hard-cut panel (glyphs)');
  assert.deepEqual([...panel.shades], [...hard.shades], 'the finished ramp is the hard-cut panel (shades)');
  assert.ok(moved(scene, panel) > 0.3, `the panel is big (${pct(moved(scene, panel))})`);
  const sh = await running(80, 24);
  sh.frame();
  sh.key('h');
  const key = copyOf(sh.frame());
  assert.equal(moved(key, scene), 0, 'the frame that carries the key is still the scene');
  let prev = 0;
  const seen = [];
  for (let k = 1; k <= 5; k++) {
    sh.tick(DT);
    const f = sh.frame();
    const share = moved(f, scene) / Math.max(1e-9, moved(panel, scene));
    seen.push(share);
    assert.ok(share >= prev - 1e-9, `the panel only grows while opening (${pct(prev)} -> ${pct(share)})`);
    prev = share;
  }
  assert.ok(seen[0] > 0 && seen[0] < 0.5, `the first step is a part of the panel (${pct(seen[0])})`);
  assert.ok(seen[3] > 0.9 && seen[3] < 1, `after four 1/18 s steps (0.222 s) most of it is there (${pct(seen[3])})`);
  assert.ok(Math.abs(seen[4] - 1) < 1e-9, `after five (0.278 s) all of it (${pct(seen[4])})`);
});

test('every ramp frame is made of whole cells of the scene or of the panel (glyph, shade and, for a full-colour cell, fg and bg), opening and closing', async () => {
  for (const [cols, rows] of [[80, 24], [41, 11]]) {
    const { scene, panel } = await references(cols, rows);
    const sh = await running(cols, rows);
    sh.frame(); sh.key('h');
    let panelCells = 0, sceneCells = 0;
    for (let phase = 0; phase < 2; phase++) {
      for (let k = 0; k < 7; k++) {
        const f = sh.frame();
        for (let i = 0; i < f.glyphs.length; i++) {
          const a = sameCell(f, scene, i), b = sameCell(f, panel, i);
          assert.ok(a || b, `${cols}x${rows} phase ${phase} frame ${k} cell ${i} is neither the scene's nor the panel's`);
          if (f.shades[i] !== RGB_CELL && !a) panelCells++;
          if (a) sceneCells++;
        }
        sh.tick(DT);
      }
      sh.key('h');
    }
    assert.ok(panelCells > 0 && sceneCells > 0);
  }
});

test('closing is the reverse: the panel stays on the cells not yet flipped back, the share only shrinks, and the last frame is the scene', async () => {
  const { scene, panel } = await references(80, 24);
  const sh = await running(80, 24);
  sh.frame(); sh.key('h'); sh.tick(1); sh.frame();
  sh.key('h');
  const total = moved(panel, scene);
  let prev = 1;
  const shares = [];
  for (let k = 0; k < 7; k++) {
    const f = copyOf(sh.frame());
    const share = moved(f, scene) / total;
    shares.push(share);
    assert.ok(share <= prev + 1e-9, `only shrinks (${pct(prev)} -> ${pct(share)})`);
    prev = share;
    sh.tick(DT);
  }
  assert.ok(shares[0] > 0.99, `the key frame still shows the whole panel (${pct(shares[0])})`);
  assert.ok(shares[1] > 0.3 && shares[1] < 0.95, `the first step leaves most of the panel (${pct(shares[1])})`);
  assert.ok(shares[3] > 0 && shares[3] < 0.3, `the panel is still partly there at 0.17 s (${pct(shares[3])})`);
  assert.equal(shares[6], 0, 'and gone after 0.33 s');
  const end = sh.frame();
  assert.equal(moved(end, scene), 0);
  assert.equal(sh.state().help, false);
});

test('key frame: the first step after h changes 40% or less of the cells at seven sizes, on a lit full-colour scene', async () => {
  const lines = [];
  for (const [cols, rows] of [[120, 40], [80, 24], [240, 67], [88, 39], [78, 24], [41, 11], [40, 10]]) {
    const sh = await running(cols, rows);
    const before = copyOf(sh.frame());
    sh.key('h');
    sh.tick(DT);
    const share = moved(sh.frame(), before);
    lines.push(`${cols}x${rows} ${pct(share)}`);
    assert.ok(share > 0 && share <= HARD_CEILING, `${cols}x${rows}: key frame ${pct(share)}`);
    // the hard cut it replaces
    const cut = await running(cols, rows);
    const b2 = copyOf(cut.frame()); cut.key('h'); cut.tick(0.3);
    const hard = moved(cut.frame(), b2);
    lines[lines.length - 1] += ` (hard cut ${pct(hard)})`;
    if (cols * rows <= 80 * 24 + 1) assert.ok(hard > HARD_CEILING, `${cols}x${rows}: the control (hard cut) is over the 40% ceiling (${pct(hard)})`);
  }
  console.log(`TABLE help ramp key frame, lit full-colour fixture: ${lines.join(', ')}`);
});

// The flash meter over: the scene, h (the panel ramps in), 1 s of rest, h (the panel ramps out), 1 s of rest.
// `hard` is the control: the same sequence with the ramp stepped over in one tick (the old hard cut).
async function meterRun(cols, rows, speed, hard, mode = 'truecolor') {
  const sh = await running(cols, rows, { speed, cmode: mode });
  const meter = shownMeter(cols, rows, FPS, mode);
  for (let k = 0; k < 6; k++) { meter.push(sh.frame()); sh.tick(1 / FPS); }
  for (let pass = 0; pass < 2; pass++) {
    sh.key('h');
    meter.push(sh.frame());
    sh.tick(hard ? 0.3 : 1 / FPS); meter.push(sh.frame());
    for (let k = 0; k < FPS + 2; k++) { sh.tick(1 / FPS); meter.push(sh.frame()); }
  }
  return meter.report();
}
const METER_SIZES = [[120, 40], [80, 24], [240, 67], [88, 39], [78, 24], [40, 10]];
const p = (r) => pct(r.worstFraction);
const bad = (rep, tag) => {
  const out = [];
  for (const [name, r] of [['l1.x1', rep.l1.x1], ['l1.x4', rep.l1.x4], ['l2.x1', rep.l2.x1], ['l2.x4', rep.l2.x4], ['l3', rep.l3], ['r.x1', rep.r.x1], ['r.x4', rep.r.x4]]) if (!r.pass) out.push(`${tag} ${name} ${p(r)}`);
  return out;
};

// DRIFT-8 C2: run in truecolor and again in 256 colours (the shell built with cmode '256', each frame shown to the meter through the 256-colour reducer); the meter reads the cell and the pixel grid
for (const mode of ['truecolor', '256']) {
test('flash meter over h open, 1 s, h close at 1x and 4x runtime speed, six sizes: L1, L2, L3 and R pass; the hard cut fails L3' + (mode === '256' ? ' [256 colours]' : ''), async () => {
  const lines = [], failed = [], controlPasses = [];
  for (const [cols, rows] of METER_SIZES) {
    for (const speed of [1, 4]) {
      const rep = await meterRun(cols, rows, speed, false, mode);
      const ctl = await meterRun(cols, rows, speed, true, mode);
      lines.push(`${cols}x${rows} ${speed}x: L1 ${p(rep.l1.x1)}/${p(rep.l1.x4)}, L2 ${p(rep.l2.x1)}/${p(rep.l2.x4)}, L3 ${p(rep.l3)}, R ${p(rep.r.x1)}/${p(rep.r.x4)}  | hard cut: L2 ${p(ctl.l2.x1)}/${p(ctl.l2.x4)}, L3 ${p(ctl.l3)}`);
      failed.push(...bad(rep, `${cols}x${rows} ${speed}x`));
      if (ctl.l3.pass) controlPasses.push(`${cols}x${rows} ${speed}x ${p(ctl.l3)}`);
      assert.ok(rep.l3.worstFraction <= FLASH_FRACTION);
    }
  }
  console.log([`TABLE help ramp flash meter (${mode}; x1/x4 windows; worse of the cell and the pixel grid)`, ...lines.map((l) => '  ' + l)].join('\n'));
  assert.deepEqual(failed, []);
  // the control: the old hard cut breaks L3 wherever the panel covers more than about a third of the screen (the three small layouts);
  // on the large ones the box is a small part of the screen and the cut passed by itself
  const stillPass = controlPasses.filter((x) => /^(80x24|78x24|40x10) /.test(x));
  assert.deepEqual(stillPass, [], 'the hard cut fails L3 at 80x24, 78x24 and 40x10');
});
}

test('1x to 4x runtime speed and four clock phases: the ramp is real time, so every speed draws the same frames; and the scene stays frozen while the panel is open', async () => {
  const ref = new Map();
  for (const speed of [1, 2, 3, 4]) {
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      const sh = await running(40, 12, { speed });
      sh.tick(phase / FPS); sh.frame();
      const t0 = sh.runtime().state().t;
      sh.key('h');
      const frames = [];
      for (let k = 0; k < 8; k++) { frames.push(copyOf(sh.frame())); sh.tick(DT * 0.5 + (phase / FPS) * 0.1); }
      sh.tick(3);
      assert.equal(sh.runtime().state().t, t0, `speed ${speed}x phase ${phase}: the scene did not move while the panel was open`);
      assert.equal(sh.runtime().helpP, 1);
      const sig = frames.map((f) => [...f.glyphs].join(',') + '|' + [...f.shades].join(',')).join('#');
      if (!ref.has(phase)) ref.set(phase, sig);
      assert.equal(sig, ref.get(phase), `speed ${speed}x phase ${phase}: the same frames as 1x`);
    }
  }
});

test('opened and closed mid-ramp: no jump (the key frame equals the frame before it), the ramp reverses from where it is, and no cell flips more than once each way', async () => {
  const { scene, panel } = await references(80, 24);
  const sh = await running(80, 24);
  sh.frame();
  const differs = [];
  for (let i = 0; i < scene.glyphs.length; i++) if (!sameCell(scene, panel, i)) differs.push(i);
  const flips = new Map(differs.map((i) => [i, 0]));
  let last = copyOf(sh.frame());
  const look = () => {
    const f = copyOf(sh.frame());
    for (const i of differs) {
      const a = sameCell(f, scene, i), b = sameCell(f, panel, i);
      assert.ok(a || b, `cell ${i} is whole`);
      if (sameCell(f, last, i) === false) flips.set(i, flips.get(i) + 1);
    }
    last = f;
    return f;
  };
  sh.key('h'); look();
  sh.tick(DT); look(); sh.tick(DT); look(); // p = 0.44
  const peak = copyOf(sh.frame());
  sh.key('h'); // reverse mid-ramp
  const turn = copyOf(sh.frame());
  assert.deepEqual([...turn.glyphs], [...peak.glyphs], 'no jump at the turn (glyphs)');
  assert.deepEqual([...turn.shades], [...peak.shades], 'no jump at the turn (shades)');
  look();
  for (let k = 0; k < 10; k++) { sh.tick(DT); look(); }
  assert.equal(moved(last, scene), 0, 'back to the scene');
  let atPeak = 0, flipped = 0, over = 0;
  for (const i of differs) {
    if (sameCell(peak, panel, i)) atPeak++;
    const n = flips.get(i);
    if (n > 0) flipped++;
    if (n > 2) over++;
    if (!sameCell(peak, panel, i)) assert.equal(n, 0, `cell ${i} had not flipped by the turn, so it never moves`);
    else assert.equal(n, 2, `cell ${i} flipped in once and back once`);
  }
  assert.equal(over, 0);
  assert.equal(flipped, atPeak);
  assert.ok(atPeak > 0 && atPeak < differs.length);
  // and the other way: close, then open again part-way, then close for good
  const sh2 = await running(40, 12);
  sh2.frame(); sh2.key('h'); sh2.tick(1); sh2.frame();
  sh2.key('h'); sh2.tick(DT);
  const mid = copyOf(sh2.frame());
  sh2.key('h');
  const again = copyOf(sh2.frame());
  assert.deepEqual([...again.glyphs], [...mid.glyphs], 'no jump when the panel is re-opened mid-close');
  assert.equal(sh2.state().help, true);
  sh2.tick(1);
  assert.equal(sh2.runtime().helpP, 1);
});

test('control characters and a resize while the panel is ramping do not throw, and the ramp still finishes', async () => {
  const sh = await running(80, 24);
  sh.frame(); sh.key('h');
  for (const ch of ['\x01', '\x02', '\x04', '\x05', '\x07', '\x08', '\x0b', '\x0c', '\x1a', '\x1b[A', '\x7f', '\t']) {
    assert.doesNotThrow(() => { sh.key(ch); sh.tick(0.02); sh.frame(); }, JSON.stringify(ch));
  }
  assert.doesNotThrow(() => { sh.tick(0.05); sh.resize(60, 16); const f = sh.frame(); assert.equal(f.glyphs.length, 60 * 16); });
  assert.doesNotThrow(() => { sh.tick(0.05); sh.resize(240, 67); const f = sh.frame(); assert.equal(f.glyphs.length, 240 * 67); });
  assert.doesNotThrow(() => { sh.tick(0.05); sh.resize(8, 3); sh.frame(); });
  sh.resize(80, 24);
  sh.tick(1);
  assert.equal(sh.runtime().helpP, 1);
  sh.key('h'); sh.tick(0.1);
  assert.doesNotThrow(() => { sh.resize(40, 12); sh.frame(); });
  sh.tick(1); sh.frame();
  assert.equal(sh.runtime().helpP, 0);
  assert.equal(sh.state().help, false);
});

test('a palette-only scene: the ramp finishes and the last frame is the old hard-cut panel cell for cell; every ramp frame is the scene or the panel', async () => {
  const { scene, panel, hard } = await references(80, 24, { plain: true });
  assert.equal(panel.fg, null, 'a palette-only frame carries no fg/bg');
  assert.deepEqual([...panel.glyphs], [...hard.glyphs]);
  assert.deepEqual([...panel.shades], [...hard.shades]);
  const sh = await running(80, 24, { plain: true });
  sh.frame(); sh.key('h');
  for (let k = 0; k < 7; k++) {
    const f = sh.frame();
    for (let i = 0; i < f.glyphs.length; i++) assert.ok(sameCell(f, scene, i) || sameCell(f, panel, i), `frame ${k} cell ${i}`);
    sh.tick(DT);
  }
  const done = sh.frame();
  assert.deepEqual([...done.glyphs], [...hard.glyphs]);
  assert.deepEqual([...done.shades], [...hard.shades]);
});

test('Night Drive (a palette cartridge): the ramp finishes and the final help frame equals the hard cut cell for cell; the key frame is small', async () => {
  for (const [cols, rows] of [[120, 40], [80, 24]]) {
    const a = await boot(cols, rows);
    a.key(ESC); a.tick(2);
    const b = await boot(cols, rows);
    b.key(ESC); b.tick(2);
    const before = grab(a);
    a.key('h'); a.tick(DT);
    const first = grab(a);
    let changed = 0;
    for (let i = 0; i < before.g.length; i++) if (before.g[i] !== first.g[i] || before.s[i] !== first.s[i]) changed++;
    assert.ok(changed / before.g.length <= HARD_CEILING, `${cols}x${rows}: key frame ${pct(changed / before.g.length)}`);
    a.tick(0.6);
    b.key('h'); b.tick(0.3); b.tick(0.3); // one 0.3 s step is p = 1 at once: the hard cut
    const fa = grab(a), fb = grab(b);
    assert.deepEqual([...fa.g], [...fb.g], `${cols}x${rows} glyphs`);
    assert.deepEqual([...fa.s], [...fb.s], `${cols}x${rows} shades`);
    a.key('h'); a.tick(0.6);
    assert.equal(a.sh().help, false);
    a.done(); b.done();
  }
});

test('Classic (drawn by the app, not the shell) keeps its hard cut: the panel is on screen at the key press itself', async () => {
  const c = mkShell({ startScreen: { screen: 'library' } });
  c.app.start();
  c.tick(0.3);
  c.key('\r');
  c.tick(6);
  assert.equal(c.sh(), null, 'Classic is running');
  c.key('h');
  c.tick(0);
  assert.match(c.text(), /l\s+cartridge library/);
  c.done();
  void runCartridge; void SIX;
});
