// DRIFT-7 C13: the Driftman 9000's console hook (cartridges/driftman-9000/console.js). The contract (what the shell relies on), purity,
// the trust wall and the hook in a real shell. The look is in driftman-9000-console-rest.test.js (rest frame, size classes) and
// driftman-9000-console-morph.test.js (shed, unfold, light, cell budget); the flash meter and CPU budget are in driftman-9000-console-flash.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverCartridges, loadScenes, INSTALL_DIR } from '../src/cartridge/loader.js';
import { checkConsoleExport, smokeConsole } from '../src/cartridge/consolehook.js';
import { validateManifest } from '../src/cartridge/schema.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { newFrame } from '../src/shell/ui.js';
import { shelfLayout } from '../src/shell/library.js';
import { sizeTier } from '../src/shell/ui.js';
import { tmpRoot } from './helpers-cartridge.js';
import {
  hook, FULL, MINI, MARGIN, PALETTE_BG, RGB_CELL, DT, flush, drawHook, localCells, snapshot, copyFrame, shell9000, screenOf,
} from './helpers-driftman-console.js';

const DIR = path.join(INSTALL_DIR, 'driftman-9000');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const PHASES = ['insert', 'boot', 'eject'];
const PS = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1];
const TS = [0, 0.37, 1.2, 1.5, 3.4, 59.9];

// ---- 1. the contract

test('9000 console: the manifest declares console "code", and the loader accepts the export and its smoke render', async () => {
  const m = readJson('manifest.json');
  assert.equal(m.console, 'code');
  assert.equal(checkConsoleExport({ default: hook }), null);
  assert.equal(hook.id, 'driftman-9000');
  assert.equal(smokeConsole(hook), null);
  const d = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
  assert.deepEqual(d.errors, []);
  const cart = d.cartridges.find((c) => c.id === 'driftman-9000');
  assert.ok(cart.consoleFile, 'the loader found console.js');
  const r = await loadScenes(cart);
  assert.deepEqual(r.errors, []);
  assert.ok(r.console && typeof r.console.drawConsole === 'function', 'the loaded scenes carry the console hook');
});

test('9000 console: every phase, size and morph value writes only inside its rect, draws only valid cells, and the mini case (screen null) works', () => {
  let calls = 0;
  for (const size of [FULL, MINI]) {
    for (const phase of PHASES) {
      for (const p of PS) {
        for (const t of TS) {
          const rect = { x: MARGIN, y: MARGIN, w: size.w, h: size.h };
          const f = newFrame(size.w + 2 * MARGIN, size.h + 2 * MARGIN);
          // a sentinel everywhere: any write outside the rect shows as a change
          f.glyphs.fill(0x41); f.shades.fill(7); f.fg.fill(0x123456); f.bg.fill(0x654321);
          const before = snapshot(f);
          const screen = size.tier === 'full' ? screenOf('full', MARGIN, MARGIN) : null;
          hook.drawConsole(f, { phase, p, t, rect: { ...rect }, screen, tier: size.tier });
          calls++;
          for (let y = 0; y < f.rows; y++) {
            for (let x = 0; x < f.cols; x++) {
              const i = y * f.cols + x;
              const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
              if (inside) {
                const g = f.glyphs[i], s = f.shades[i];
                assert.ok(isAllowedGlyph(g), `${size.tier} ${phase} p${p} t${t}: U+${g.toString(16)} at ${x},${y}`);
                assert.ok(s === 0 || s === RGB_CELL, `${size.tier} ${phase} p${p}: shade ${s}`);
                if (g === 32) assert.equal(s === 0 || f.fg[i] <= 0xFFFFFF, true);
                if (s === RGB_CELL) {
                  assert.ok(f.fg[i] <= 0xFFFFFF, 'fg in range');
                  assert.ok(f.bg[i] <= 0xFFFFFF || f.bg[i] === PALETTE_BG, 'bg in range');
                }
              } else {
                assert.ok(f.glyphs[i] === before.glyphs[i] && f.shades[i] === before.shades[i] && f.fg[i] === before.fg[i] && f.bg[i] === before.bg[i],
                  `${size.tier} ${phase} p${p} t${t}: wrote outside the rect at ${x},${y}`);
              }
            }
          }
        }
      }
    }
  }
  assert.equal(calls, 2 * 3 * PS.length * TS.length);
});

test('9000 console: a rect of 0 size, a tiny one, one half off the frame, and odd arguments never throw and never write outside the rect or the frame', () => {
  const rects = [
    { x: 2, y: 2, w: 0, h: 0 }, { x: 2, y: 2, w: 1, h: 1 }, { x: 0, y: 0, w: 3, h: 2 }, { x: 5, y: 5, w: 12, h: 3 }, { x: 5, y: 5, w: 83, h: 17 },
    { x: -10, y: -3, w: 84, h: 18 }, { x: 50, y: 10, w: 84, h: 18 }, { x: 2, y: 2, w: -4, h: 5 }, { x: 2, y: 2, w: 84, h: 0 },
  ];
  for (const tier of ['full', 'mini']) {
    for (const rect of rects) {
      for (const [phase, p, t] of [['insert', 0.3, 1.2], ['boot', 1, 3], ['eject', 0.55, 1.5], ['insert', 0, 1.0]]) {
        const f = newFrame(60, 30);
        f.glyphs.fill(0x41); f.shades.fill(7); f.fg.fill(0x123456); f.bg.fill(0x654321);
        const before = snapshot(f);
        const screen = tier === 'full' ? { x: rect.x + 3, y: rect.y + 4, w: 46, h: 9 } : null;
        assert.doesNotThrow(() => hook.drawConsole(f, { phase, p, t, rect: { ...rect }, screen, tier }), JSON.stringify([tier, rect, phase]));
        assert.equal(f.glyphs.length, 60 * 30);
        for (let y = 0; y < f.rows; y++) {
          for (let x = 0; x < f.cols; x++) {
            const i = y * f.cols + x;
            if (x >= rect.x && x < rect.x + Math.max(0, rect.w) && y >= rect.y && y < rect.y + Math.max(0, rect.h)) continue;
            assert.ok(f.glyphs[i] === before.glyphs[i] && f.shades[i] === before.shades[i], `${tier} ${JSON.stringify(rect)} wrote outside at ${x},${y}`);
          }
        }
      }
    }
  }
  // odd values: NaN, Infinity, out-of-range p, a missing phase, a tiny frame
  const f = newFrame(90, 30);
  for (const [p, t] of [[NaN, NaN], [-1, -5], [9, 1e9], [Infinity, Infinity], [undefined, undefined]]) {
    assert.doesNotThrow(() => hook.drawConsole(f, { phase: 'weird', p, t, rect: { x: 3, y: 3, w: 84, h: 18 }, screen: null, tier: 'full' }));
    assert.doesNotThrow(() => hook.drawConsole(f, { phase: 'boot', p, t, rect: { x: 3, y: 3, w: 38, h: 4 }, screen: null, tier: 'mini' }));
  }
  assert.doesNotThrow(() => hook.drawConsole(newFrame(0, 0), { phase: 'insert', p: 0.5, t: 1.2, rect: { x: 0, y: 0, w: 84, h: 18 }, screen: null, tier: 'full' }));
});

// ---- 2. determinism and purity in time

test('9000 console: the same arguments draw the same cells, and a call in between (another time, another phase) changes nothing: pure in t and p', () => {
  for (const size of [FULL, MINI]) {
    for (const [phase, p, t] of [['insert', 0.3, 1.2], ['insert', 0.55, 1.5], ['boot', 0.8, 0.3], ['boot', 1, 3.4], ['eject', 0.2, 1.1]]) {
      const a = snapshot(drawHook(size, phase, p, t).f);
      drawHook(size, 'boot', 1, 17.77);
      drawHook(size, 'insert', 0.1, 1.05);
      drawHook(size, phase, p, t + 5);
      const b = snapshot(drawHook(size, phase, p, t).f);
      assert.deepEqual([...b.glyphs], [...a.glyphs]);
      assert.deepEqual([...b.shades], [...a.shades]);
      assert.deepEqual([...b.fg], [...a.fg]);
      assert.deepEqual([...b.bg], [...a.bg]);
    }
  }
});

// ---- 3. no banned glyph, even in comments; the trust wall (both arms)

test('9000 console: the console files hold none of the banned glyphs, even in comments, and only allowed imports', () => {
  const BANNED = ['∫', '≡', '◍', '◎', '◐', '◑', '◒', '◓', '◢', '◣'];
  const files = ['console.js', ...fs.readdirSync(path.join(DIR, 'lib')).map((f) => 'lib/' + f)];
  for (const file of files) {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');
    for (const g of BANNED) assert.ok(!src.includes(g), `${file} holds ${g}`);
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      assert.match(m[1], /^(\.\/(lib\/)?[a-z0-9-]+\.js|(\.\.\/){2,3}src\/pixels\.js)$/, `${file} imports ${m[1]}`);
    }
  }
});

test('9000 console trust: the install folder loads console.js; a copy in the user folder (data only) is refused for its code, and nothing of it loads', async () => {
  const root = tmpRoot();
  fs.cpSync(DIR, path.join(root, 'driftman-9000'), { recursive: true });
  const user = discoverCartridges({ dirs: [{ dir: root, trusted: false }] });
  assert.equal(user.cartridges.length, 0);
  assert.equal(user.errors.length, 1, JSON.stringify(user.errors));
  assert.match(user.errors[0].reason, /code|console|rgb|full-colour/i);
  // the install arm: the same files in a trusted folder are found with their console.js (a temp copy cannot reach ../../src, so the code is loaded from the real install folder)
  const inst = discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
  assert.deepEqual(inst.errors, []);
  assert.ok(inst.cartridges[0].consoleFile);
  const real = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.find((c) => c.id === 'driftman-9000');
  const r = await loadScenes(real);
  assert.deepEqual(r.errors, []);
  assert.ok(r.console);
  const m = validateManifest(readJson('manifest.json'), { trusted: false });
  assert.equal(m.ok, false);
  assert.match(m.reason, /code runs only from the install folder/, m.reason);
});

// ---- 4. in a real shell

async function runWithLog(cols, rows) {
  const log = [];
  const d = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
  const { createShell } = await import('../src/shell/shell.js');
  const real = loadScenes;
  const sh = createShell({
    cols, rows, cartridges: d.cartridges, seed: 1, cmode: 'truecolor', host: { persist() {}, quit() {}, leaveToClassic() {} },
    consts: { SPEEDS: [1, 2, 3, 4], DISSOLVE_SECONDS: 2, DEFAULT_FADE_SECONDS: 15 },
    start: { cartridge: 'driftman-9000' },
    loadScenes: async (cart) => {
      const r = await real(cart);
      if (!r.console) return r;
      const inner = r.console;
      return { ...r, console: { id: inner.id, drawConsole(f, c) { log.push({ phase: c.phase, p: c.p, t: c.t, tier: c.tier, screen: c.screen ? { ...c.screen } : null, rect: { ...c.rect } }); return inner.drawConsole(f, c); } } };
    },
  });
  await flush();
  const seen = [];
  for (let k = 0; k < 400 && sh.state().screen !== 'running'; k++) { sh.frame(); seen.push(sh.state().screen); sh.tick(DT); }
  for (let k = 0; k < 20; k++) { sh.frame(); sh.tick(DT); }
  const afterRun = log.length;
  sh.key('e');
  for (let k = 0; k < 400 && sh.state().screen === 'eject'; k++) { sh.frame(); sh.tick(DT); }
  for (let k = 0; k < 6; k++) { sh.frame(); sh.tick(DT); }
  return { log, sh, afterRun, seen };
}

for (const [cols, rows, tier] of [[120, 40, 'full'], [80, 24, 'mini']]) {
  test(`9000 console in the shell at ${cols}x${rows}: the shell calls the hook in insert, boot and eject only, with a ${tier} rect${tier === 'mini' ? ' and screen null' : ' and the 46 x 9 screen at (3, 4)'}; p never falls during insert + boot`, async () => {
    const { log, afterRun } = await runWithLog(cols, rows);
    assert.ok(log.length > 40, 'calls: ' + log.length);
    const phases = new Set(log.map((c) => c.phase));
    assert.deepEqual([...phases].sort(), ['boot', 'eject', 'insert']);
    for (const c of log) {
      assert.equal(c.tier, tier);
      assert.equal(c.rect.w, tier === 'full' ? 84 : 38);
      assert.equal(c.rect.h, tier === 'full' ? 18 : 4);
      if (tier === 'full') assert.deepEqual(c.screen, { x: c.rect.x + 3, y: c.rect.y + 4, w: 46, h: 9 });
      else assert.equal(c.screen, null);
    }
    // the insert + boot calls (before the first eject call) have p rising from 0 to 1
    const first = log.findIndex((c) => c.phase === 'eject');
    const up = log.slice(0, first);
    assert.ok(Math.abs(up[0].p) < 1e-9, 'p starts at 0: ' + up[0].p);
    assert.equal(up[up.length - 1].p, 1);
    for (let k = 1; k < up.length; k++) assert.ok(up[k].p >= up[k - 1].p - 1e-12, `p fell at call ${k}`);
    assert.equal(afterRun, first, 'no call while it runs');
  });
}
