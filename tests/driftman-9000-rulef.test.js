// DRIFT-7 stage F, item 1: RULE F on the real Driftman 9000. A panel over a full-colour vision (the menu's tiles or list with its prompt row and
// countdown, the chrome border that comes with the menu, the help box) must be made of PALETTE cells (shade < 255, never a full-colour cell of the
// vision behind it), and its text must reach 4.5:1 against the skin's background #05060C.
// "colour < 255" is the renderer's own test: RGB_CELL is shade 255 (src/renderer.js); a palette cell resolves through the skin palette (24 entries), so a
// panel cell is one whose shade is below it. Contrast is the WCAG relative-luminance ratio of the palette's foreground RGB for that shade on #05060C.
// The cells a panel owns come from the shell's own draw functions (helpers-driftman-panels.js), and the shell's frame must equal that picture on them.
//   (1) menu with the countdown running over the Rosette, at 1x, 2x and 4x (the vision's clock reaches 20 s inside the 15 s countdown from 2x on; 1x is
//       checked as far as its clock goes) at 120x40 and 80x24 (grid and list) and the 100x30 (two tiles a row) and 240x67 layouts: every frame of the countdown
//   (2) the menu reopened over each vision at about 20 s of its play (no countdown), the help box over each vision at the same moment
//   (3) controls: a planted full-colour cell in the tiles, the prompt row, the countdown or the help box is found; a planted dim-blue letter is found
//   (4) the loader still refuses an rgb cartridge whose skin has no palette.bg (the real manifest and skin, a copy in a trusted root)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';
import { tmpRoot } from './helpers-cartridge.js';
import {
  arrive9000, stepFrames, stepSeconds, pickVision, menuReplica, helpReplica, rgbCellsIn, mismatchesIn, textContrast, lowContrast, copyOf,
  VISIONS, SKIN, FPS, RGB_CELL, BG, contrast,
} from './helpers-driftman-panels.js';

const SIZES = [[120, 40], [80, 24], [100, 30], [240, 67]];
const TABLE = [];
const worst = (rows) => Math.min(...rows.map((r) => r.ratio));
const rowText = (rep, cols) => {
  const byRow = new Map();
  for (const i of rep.cells) { const y = Math.floor(i / cols); byRow.set(y, (byRow.get(y) || '') + String.fromCharCode(rep.f.glyphs[i])); }
  return [...byRow.values()].join('\n');
};

// Check one frame of the menu / help against its replica. `stats` collects what was seen.
function checkMenu(sh, f, stats, label, index = 0) {
  const st = sh.state();
  const rt = sh.runtime();
  const countdown = rt.autoLeft === null ? null : Math.ceil(rt.autoLeft);
  const rep = menuReplica(f.cols, f.rows, { index, playingId: st.sceneId, countdown });
  const bad = mismatchesIn(f, rep);
  assert.deepEqual(bad.slice(0, 5), [], `${label}: the shell's menu is the replica on every menu cell (${bad.length} differ)`);
  assert.deepEqual(rgbCellsIn(f, rep).slice(0, 5), [], `${label}: a menu cell is a full-colour cell`);
  const tc = textContrast(f, rep);
  assert.deepEqual(lowContrast(tc), [], `${label}: menu text under 4.5:1`);
  stats.frames++; stats.cells += rep.cells.length; stats.minRatio = Math.min(stats.minRatio, worst(tc));
  if (countdown !== null) stats.countdowns.add(countdown);
  return rep;
}
function checkHelp(sh, f, stats, label) {
  const st = sh.state();
  const rep = helpReplica(f.cols, f.rows, { sceneId: st.sceneId, ui: f.palette.ui });
  const bad = mismatchesIn(f, rep);
  assert.deepEqual(bad.slice(0, 5), [], `${label}: the shell's help box is the replica on every box cell (${bad.length} differ)`);
  assert.deepEqual(rgbCellsIn(f, rep).slice(0, 5), [], `${label}: a help cell is a full-colour cell`);
  const tc = textContrast(f, rep);
  assert.deepEqual(lowContrast(tc), [], `${label}: help text under 4.5:1`);
  stats.frames++; stats.cells += rep.cells.length; stats.minRatio = Math.min(stats.minRatio, worst(tc));
  return rep;
}
const newStats = () => ({ frames: 0, cells: 0, minRatio: Infinity, countdowns: new Set(), scenesSeen: new Set() });

// ---- (1) the menu with the countdown running over the Rosette

for (const [cols, rows] of SIZES) {
  test(`rule F ${cols}x${rows}: the menu over the Rosette with the countdown running (1x, 2x, 4x): every cell of the tiles/list, the prompt row, the countdown and the border is a palette cell with text at 4.5:1`, async () => {
    for (const speed of [1, 2, 4]) {
      const sh = await arrive9000(cols, rows, { speed });
      const rt = sh.runtime();
      const stats = newStats();
      let t20 = false, sawCountdownText = false;
      const label = `${cols}x${rows} ${speed}x`;
      // the menu ramps in over a quarter second: judge from the first whole menu on
      stepFrames(sh, 6);
      for (let k = 0; k < 15 * FPS + 4 && sh.state().menu && sh.state().sceneId === 'rosette'; k++) {
        const f = sh.frame();
        if (rt.autoLeft !== null && k % 2 === 0) {
          const rep = checkMenu(sh, f, stats, `${label} frame ${k}`);
          if (rowText(rep, cols).includes('starts by itself in')) sawCountdownText = true;
          if (rt.state().t >= 19.5 && rt.state().t <= 21) t20 = true;
        }
        sh.tick(1 / FPS);
      }
      assert.ok(stats.frames >= 100, `${label}: the countdown ran long enough to check (${stats.frames} frames)`);
      assert.ok(stats.countdowns.size >= 10, `${label}: many different countdown numbers were drawn and checked (${[...stats.countdowns].join(',')})`);
      assert.ok(sawCountdownText, `${label}: the countdown text is in the checked cells`);
      if (speed >= 2) assert.ok(t20, `${label}: the Rosette's clock was checked at about 20 s with the countdown running`);
      TABLE.push(`menu countdown  ${label.padEnd(10)} ${String(stats.frames).padStart(4)} frames, ${String(stats.cells).padStart(7)} cell checks, min text contrast ${stats.minRatio.toFixed(2)}:1, rosette t to ${rt.state().t.toFixed(1)} s${t20 ? ' (20 s seen)' : ''}`);
    }
  });
}

// ---- (2) menu reopened and help, over each vision at about 20 s of its play

async function overVision(cols, rows, id, speed) {
  const sh = await arrive9000(cols, rows, { speed });
  const rt = sh.runtime();
  if (id !== 'rosette') pickVision(sh, id);
  else sh.key('esc');
  stepSeconds(sh, 0.6);
  const from = rt.state().t;
  while (rt.state().t < from + 20) stepFrames(sh, 9);
  assert.equal(sh.state().sceneId, id, `${id}: still the vision after 20 s of it`);
  assert.equal(sh.state().menu, false);
  const menuStats = newStats(), helpStats = newStats();
  const label = `${cols}x${rows} ${speed}x ${id}`;
  sh.key('enter'); // opens the menu (no countdown: a key cancelled it)
  stepFrames(sh, 6); // the ramp
  stepFrames(sh, 18, (f, k) => { if (k % 2 === 0) { const rep = checkMenu(sh, f, menuStats, `${label} menu frame ${k}`, VISIONS.indexOf(id)); assert.equal(rowText(rep, cols).includes('starts by itself'), false); } });
  sh.key('esc');
  stepSeconds(sh, 0.6);
  assert.equal(sh.state().menu, false);
  sh.key('h');
  stepFrames(sh, 6); // the ramp
  assert.equal(sh.state().help, true);
  stepFrames(sh, 18, (f, k) => { if (k % 2 === 0) checkHelp(sh, f, helpStats, `${label} help frame ${k}`); });
  sh.key('esc');
  stepSeconds(sh, 0.6);
  assert.equal(sh.state().help, false);
  return { menuStats, helpStats, label };
}

for (const [cols, rows] of SIZES) {
  test(`rule F ${cols}x${rows}: the menu (reopened) and the help box over Rosette, Cortex and Bloomfall at about 20 s of each, at 1x and 4x: palette cells only, text at 4.5:1`, async () => {
    for (const id of VISIONS) {
      for (const speed of [1, 4]) {
        const r = await overVision(cols, rows, id, speed);
        assert.ok(r.menuStats.frames >= 9 && r.helpStats.frames >= 9, r.label);
        TABLE.push(`menu+help       ${r.label.padEnd(24)} menu ${r.menuStats.frames} frames min ${r.menuStats.minRatio.toFixed(2)}:1, help ${r.helpStats.frames} frames min ${r.helpStats.minRatio.toFixed(2)}:1`);
      }
    }
  });
}

// ---- (3) controls: the checkers must find what they exist to find

test('rule F controls: a full-colour cell planted in a tile, the prompt row, the countdown or the help box is found; a dim-blue letter is found; a changed glyph is found', async () => {
  const sh = await arrive9000(120, 40);
  stepFrames(sh, 8);
  const f = copyOf(sh.frame());
  const rt = sh.runtime();
  const rep = menuReplica(120, 40, { index: 0, playingId: 'rosette', countdown: Math.ceil(rt.autoLeft) });
  assert.deepEqual(rgbCellsIn(f, rep), [], 'clean frame: no full-colour cell');
  assert.deepEqual(mismatchesIn(f, rep), [], 'clean frame: equals the replica');
  assert.deepEqual(lowContrast(textContrast(f, rep)), [], 'clean frame: text passes');
  // where things are, read from the replica's own text rows
  const inRow = (pred) => rep.cells.filter((i) => pred(String.fromCharCode(rep.f.glyphs[i]), Math.floor(i / 120)));
  const letters = inRow((ch) => /[A-Z]/.test(ch));
  assert.ok(letters.length > 10);
  const choose = rep.cells.find((i) => rep.f.glyphs[i] === 67 && rep.f.glyphs[i + 1] === 104 && rep.f.glyphs[i + 2] === 111); // "Cho" of "Choose a vision"
  assert.ok(choose !== undefined, 'the prompt is in the menu cells');
  const promptRow = Math.floor(choose / 120);
  const countdownCell = rep.cells.find((i) => String.fromCharCode(rep.f.glyphs[i]) === 's' && Math.floor(i / 120) === promptRow && i > promptRow * 120 + 60);
  assert.ok(countdownCell !== undefined, 'the countdown "s" is in the prompt row at the right');
  const tileCell = rep.cells.find((i) => Math.floor(i / 120) > promptRow + 2 && rep.f.glyphs[i] === 32);
  assert.ok(tileCell !== undefined, 'a blank cell inside a tile');
  const prompt = rep.cells.find((i) => Math.floor(i / 120) === promptRow && rep.f.glyphs[i] === 67); // the "C" of "Choose"
  assert.ok(prompt !== undefined);
  for (const [what, cell] of [['tile interior', tileCell], ['prompt row', prompt], ['countdown', countdownCell]]) {
    const g = copyOf(f);
    g.shades[cell] = RGB_CELL;
    assert.deepEqual(rgbCellsIn(g, rep), [cell], `a full-colour cell in the ${what} is found`);
    assert.ok(mismatchesIn(g, rep).includes(cell), `and it no longer equals the replica`);
  }
  const g = copyOf(f);
  g.shades[letters[0]] = 18; // the frame colour #4A6AB0... see below: index 18 is #2A3A66, a letter in it is nearly invisible
  const lows = lowContrast(textContrast(g, rep));
  assert.equal(lows.length, 1, 'a letter in palette colour 18 is flagged');
  assert.ok(lows[0].ratio < 4.5, `ratio ${lows[0].ratio.toFixed(2)}`);
  const h = copyOf(f);
  h.glyphs[letters[0]] = 33;
  assert.deepEqual(mismatchesIn(h, rep), [letters[0]], 'a changed glyph is found');

  // help
  stepFrames(sh, 1);
  sh.key('esc'); stepSeconds(sh, 0.6); sh.key('h'); stepSeconds(sh, 0.6);
  const hf = copyOf(sh.frame());
  const hrep = helpReplica(120, 40, { sceneId: sh.state().sceneId, ui: hf.palette.ui });
  assert.deepEqual(rgbCellsIn(hf, hrep), []);
  assert.deepEqual(mismatchesIn(hf, hrep), []);
  const hcell = hrep.cells.find((i) => hrep.f.glyphs[i] === 32 && hrep.f.shades[i] === 0);
  const hg = copyOf(hf); hg.shades[hcell] = RGB_CELL;
  assert.deepEqual(rgbCellsIn(hg, hrep), [hcell], 'a full-colour cell in the help box is found');
  assert.ok(hrep.rect.width >= 40 && hrep.rect.height >= 15, JSON.stringify(hrep.rect));
});

test('rule F: every colour a panel uses for text on the real palette, with its ratio on #05060C (the table)', async () => {
  const sh = await arrive9000(120, 40);
  const f = sh.frame();
  const lines = [];
  for (const [role, idx] of Object.entries(f.palette.ui)) {
    const r = contrast(f.palette.fgRgb[idx], BG);
    lines.push(`ui.${role} (palette ${idx}, #${(f.palette.fgRgb[idx] >>> 0).toString(16).padStart(6, '0')}) ${r.toFixed(2)}:1`);
    assert.ok(r >= 4.5, `ui.${role} ${r.toFixed(2)}:1`);
  }
  assert.equal(SKIN.palette.bg.toUpperCase(), '#05060C');
  TABLE.push('panel text colours  ' + lines.join('; '));
  // the control: a colour that is not allowed fails the same bound
  assert.ok(contrast(f.palette.fgRgb[18], BG) < 4.5, 'palette 18 (#2A3A66) is under 4.5:1');
});

// ---- (4) the loader and the missing background

test('rule F loader: the real 9000 with its skin loads; the same cartridge with no palette.bg in its skin, or no skin at all, is refused with the reason (an rgb cartridge needs the bg)', () => {
  const root = tmpRoot('drift-rulef-');
  const dir = path.join(root, 'driftman-9000');
  fs.cpSync(path.join(INSTALL_DIR, 'driftman-9000'), dir, { recursive: true });
  const load = () => discoverCartridges({ dirs: [{ dir: root, trusted: true }] });
  let r = load();
  assert.deepEqual(r.errors, [], 'with its bg it loads');
  assert.equal(r.cartridges.length, 1);
  const skin = JSON.parse(fs.readFileSync(path.join(dir, 'skin.json'), 'utf8'));
  assert.ok(skin.palette.bg);
  delete skin.palette.bg;
  fs.writeFileSync(path.join(dir, 'skin.json'), JSON.stringify(skin, null, 2));
  r = load();
  assert.equal(r.cartridges.length, 0, 'no palette.bg: not loaded');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /rgb|full-colour/i);
  assert.match(r.errors[0].reason, /palette\.bg/);
  fs.rmSync(path.join(dir, 'skin.json'));
  r = load();
  assert.equal(r.cartridges.length, 0, 'no skin at all: not loaded');
  assert.match(r.errors[0].reason, /palette\.bg/);
  TABLE.push('loader           no palette.bg -> ' + load().errors[0].reason);
});

test('rule F TABLE: every measured value', () => {
  console.log(['TABLE rule F (palette cells, text >= 4.5:1 on #05060C)', ...TABLE.map((l) => '  ' + l)].join('\n'));
  assert.ok(TABLE.length > 0);
});
