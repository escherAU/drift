// DRIFT-4: the cartridge captures (tools/capture.mjs runCaptureCartridges). Its own names list and its own
// test; the K3 mode-capture test in tools.test.js pins a different list and is not touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCaptureCartridges, cartridgeCaptureNames, nightDriveCaptureNames, CART_MOMENTS, EJECT_MOMENTS, MODE_CAPTURE_NAMES, CAPTURE_NAMES, FIGHT_MOMENTS, CUTSCENE_MOMENTS, HINT_MOMENT } from '../tools/capture.mjs';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { INSERT_END } from '../src/shell/insert.js';
import { EJECT_FADE_SECONDS, EJECT_ANIM_SECONDS } from '../src/shell/shell.js';
import { makeRoot } from './helpers-shell.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'drift-tools-cart-'));
const blocks = (text) => text.split(/=== [^\n]*\n/).slice(1);
// Night Drive's own set (cart-night-drive-*), written out by hand: 8 tracks x (2, 20, 40 s + the later moments) x 2 sizes, then the
// tape-deck menu, the help panel and the console takeover at both sizes. The later moments are where each story moves.
const ND_IDS = ['onramp', 'skyline', 'sundown', 'coast', 'redlight', 'diner', 'caller', 'overdrive'];
// redlight: 9 = the wiper mid-stroke, 11 = just before the next sweep, 61 = the rain near the lamp is green, 62 = the buildings have begun to slide
const ND_LATER = { sundown: [75], redlight: [9, 11, 61, 62], diner: [25], caller: [29, 70], overdrive: [64] };
const ND_TAGS = ['', '-80x24'];
const ndSecs = (id) => [...(id === 'diner' || id === 'onramp' ? [2, 21, 40] : [2, 20, 40]), ...(ND_LATER[id] || [])]; // the diner's (and the on-ramp's at 80x24) 2 s and 20 s pictures are identical, so their middle moment is 21 s
const ND_WANT = [];
for (const tag of ND_TAGS) {
  for (const id of ND_IDS) for (const sec of ndSecs(id)) ND_WANT.push(`cart-night-drive-scene-${id}${tag}-t${sec}.txt`);
  for (const what of ['menu', 'help', 'console']) ND_WANT.push(`cart-night-drive-${what}-${tag ? '80x24' : '120x40'}.txt`);
}
const CAPTURE_TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'capture.mjs');
// the size a capture file is drawn at, from its name
const sizeOf = (name) => { const m = /(\d+)x(\d+)(?:-t\d+)?\.txt$/.exec(name); return m ? [+m[1], +m[2]] : [120, 40]; };

test('cartridge captures: the names list is the files written - library at 120x40 and 80x24 per cartridge, 240x67, the list tier, insert/boot at the moments, the Classic help', async () => {
  const dir = tmp();
  try {
    const files = await runCaptureCartridges({ outDir: dir });
    const carts = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges;
    assert.ok(carts.some((c) => c.id === 'classic') && carts.some((c) => c.locked), 'install has classic and locked cartridges');
    const want = ['cart-library-240x67.txt', 'cart-library-list-60x14.txt', 'cart-help-classic-120x40.txt'];
    for (const c of carts) {
      for (const sz of ['120x40', '80x24']) want.push(`cart-library-${c.id}-${sz}.txt`);
      if (c.locked) continue;
      for (const m of CART_MOMENTS) {
        const ms = Math.round(m * 1000);
        const kind = m < INSERT_END ? 'insert' : 'boot';
        want.push(`cart-${kind}-${c.id}-t${ms}.txt`, `cart-${kind}-${c.id}-80x24-t${ms}.txt`);
      }
      // a cartridge that runs in the shell (Delza) also gets eject files at both sizes; Classic has none
      if (c.runtime !== 'classic') for (const m of EJECT_MOMENTS) { const ms = Math.round(m * 1000); want.push(`cart-eject-${c.id}-t${ms}.txt`, `cart-eject-${c.id}-80x24-t${ms}.txt`); }
    }
    // Delza's own set (cart-delza-*): written out by hand, not read from the tool's list
    const ms = (s) => Math.round(s * 1000);
    want.push('cart-delza-library-240x67.txt', `cart-delza-boot-hint-t${ms(HINT_MOMENT)}.txt`,
      'cart-delza-journal-120x40.txt', 'cart-delza-journal-80x24.txt', 'cart-delza-help-120x40.txt', 'cart-delza-help-80x24.txt');
    for (const id of ['thornwell', 'tallow', 'cinderhorn', 'reach', 'highcandle', 'lampwarden']) for (const sec of [2, 20, 40]) want.push(`cart-delza-scene-${id}-t${sec}.txt`);
    for (const m of FIGHT_MOMENTS) want.push(`cart-delza-fight-t${ms(m)}.txt`);
    for (const m of CUTSCENE_MOMENTS) want.push(`cart-delza-cutscene-t${ms(m)}.txt`);
    want.push(...ND_WANT);
    assert.equal(FIGHT_MOMENTS.length, 5);
    assert.equal(CUTSCENE_MOMENTS.length, 4);
    assert.deepEqual(cartridgeCaptureNames().sort(), want.slice().sort());
    assert.deepEqual(fs.readdirSync(dir).sort(), want.slice().sort());
    assert.equal(files.length, want.length);
    // the moments the task names: about 0.4, 0.9, 1.25, 1.6, 2.5, 3.4, 4.2, 5.0, 5.6 s from Enter (3.4, not 3.6: Classic's bar is whole there)
    assert.deepEqual(CART_MOMENTS, [0.4, 0.9, 1.25, 1.6, 2.5, 3.4, 4.2, 5.0, 5.6]);
    assert.ok(CART_MOMENTS.some((m) => m < INSERT_END) && CART_MOMENTS.some((m) => m >= INSERT_END), 'insert before 1.5 s, boot after');
    for (const f of want) {
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.ok(t.length > 500, `${f}: not empty`);
      assert.ok(!t.includes('\x1b'), `${f}: plain text`);
      const body = blocks(t);
      assert.equal(body.length, 1, `${f}: one frame`);
      const [cols, rows] = sizeOf(f);
      const lines = body[0].replace(/\n$/, '').split('\n');
      assert.equal(lines.length, rows, f);
      for (const l of lines) {
        assert.equal([...l].length, cols, f);
        for (const ch of l) assert.ok(isAllowedGlyph(ch.codePointAt(0)), `${f} U+${ch.codePointAt(0).toString(16)}`);
      }
      assert.ok(body[0].trim().length > 0, `${f}: something is drawn`);
    }
    // each cartridge has its own library page at each size; the animations move; the names do not collide with K3's lists
    for (const sz of ['120x40', '80x24']) {
      const libs = carts.map((c) => fs.readFileSync(path.join(dir, `cart-library-${c.id}-${sz}.txt`), 'utf8'));
      assert.equal(new Set(libs).size, libs.length, `${sz}: library pages differ per cartridge`);
    }
    for (const c of carts.filter((x) => !x.locked)) {
      for (const tag of ['', '-80x24']) {
        const seq = (kind) => CART_MOMENTS.filter((m) => (m < INSERT_END) === (kind === 'insert'))
          .map((m) => fs.readFileSync(path.join(dir, `cart-${kind}-${c.id}${tag}-t${Math.round(m * 1000)}.txt`), 'utf8'));
        assert.equal(new Set(seq('insert')).size, 3, `insert${tag}: three distinct frames`);
        assert.ok(new Set(seq('boot')).size >= 5, `boot${tag}: the frames change over time`);
      }
    }
    const others = [...CAPTURE_NAMES, ...MODE_CAPTURE_NAMES];
    for (const n of want) assert.ok(!others.includes(n), n);
    // locked cartridges have no insert, boot or eject file
    for (const c of carts.filter((x) => x.locked)) assert.ok(!fs.readdirSync(dir).some((f) => /^cart-(insert|boot|eject)-/.test(f) && f.includes(`-${c.id}-`)));
    // the extra-large and list files really are those tiers
    assert.ok(fs.readFileSync(path.join(dir, 'cart-library-list-60x14.txt'), 'utf8').includes('CARTRIDGES'));
    assert.ok(/ DM-0\d/.test(fs.readFileSync(path.join(dir, 'cart-library-240x67.txt'), 'utf8')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cartridge captures: the Classic help is the Classic help panel with the l row, drawn by the real app after the console hands back', async () => {
  const dir = tmp();
  try {
    await runCaptureCartridges({ outDir: dir });
    const help = fs.readFileSync(path.join(dir, 'cart-help-classic-120x40.txt'), 'utf8').split('\n');
    const calm = fs.readFileSync(new URL('../captures/help-calm.txt', import.meta.url), 'utf8').split('\n');
    assert.ok(help.join('\n').includes('l             cartridge library'));
    // the panel (rows 4-34, columns 38-80) is the same panel; only the scene behind it differs
    for (let r = 4; r <= 34; r++) assert.equal([...help[r]].slice(38, 81).join(''), [...calm[r]].slice(38, 81).join(''), `row ${r}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const HINT_TEXT = 'e ejects · h shows the keys';
const BAR_WHOLE = /\[█*[▉▊▋▌▍▎▏]? *\]/; // filled cells, at most one partial cell, then empty: no hole in the bar

test('cartridge captures: every insert/boot file shows the plain bar (the first-insert hint is spent first); only cart-delza-boot-hint carries it; Classic\'s bar is whole at 3.4 s', async () => {
  const dir = tmp();
  try {
    await runCaptureCartridges({ outDir: dir });
    const files = fs.readdirSync(dir);
    for (const f of files.filter((n) => /^cart-(insert|boot)-/.test(n))) assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes(HINT_TEXT), `${f}: no hint`);
    const hint = fs.readFileSync(path.join(dir, `cart-delza-boot-hint-t${Math.round(HINT_MOMENT * 1000)}.txt`), 'utf8');
    assert.ok(hint.includes(HINT_TEXT), 'the hint capture has the hint');
    // the same moment without the hint is the plain boot file, and differs from it
    const plain = fs.readFileSync(path.join(dir, `cart-boot-delza-t${Math.round(HINT_MOMENT * 1000)}.txt`), 'utf8');
    assert.notEqual(blocks(hint)[0], blocks(plain)[0]);
    assert.deepEqual(files.filter((n) => fs.readFileSync(path.join(dir, n), 'utf8').includes(HINT_TEXT)), [`cart-delza-boot-hint-t${Math.round(HINT_MOMENT * 1000)}.txt`], 'exactly one file shows the hint');
    // Classic: the bar is whole at 3.4 s, in both sizes (control: the line the old 3.6 s capture held fails the pattern)
    for (const n of ['cart-boot-classic-t3400.txt', 'cart-boot-classic-80x24-t3400.txt']) {
      const bar = fs.readFileSync(path.join(dir, n), 'utf8').split('\n').find((l) => /\[[█▉▊▋▌▍▎▏ ]+\]/.test(l));
      assert.ok(bar && BAR_WHOLE.test(bar), `${n}: a whole bar, got ${bar}`);
    }
    assert.ok(!BAR_WHOLE.test('│ ║│ [███████████████████████████████████ ████] │║'), 'control: a bar with a hole is rejected');
    assert.ok(!files.some((n) => n.includes('t3600')), 'no 3.6 s files are left');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cartridge captures: Delza\'s set shows what it says - the Journal, the help words, every scene moving over 2, 20 and 40 s, five different fight frames, four different cut-scene text states', async () => {
  const dir = tmp();
  try {
    await runCaptureCartridges({ outDir: dir });
    const read = (n) => fs.readFileSync(path.join(dir, n), 'utf8');
    for (const sz of ['120x40', '80x24']) {
      const j = read(`cart-delza-journal-${sz}.txt`);
      assert.ok(j.includes('THE WAYFARER\'S JOURNAL') && j.includes('THORNWELL') && j.includes('LAMPWARDEN'), `journal ${sz}`);
      assert.ok(read(`cart-delza-help-${sz}.txt`).includes('JOURNAL · how to travel'), `help ${sz}: Delza's own words`);
    }
    assert.ok(/ DM-01/.test(read('cart-delza-library-240x67.txt')) || read('cart-delza-library-240x67.txt').includes('DELZA'), 'the XL library has Delza on it');
    const bodies = new Map();
    for (const id of ['thornwell', 'tallow', 'cinderhorn', 'reach', 'highcandle', 'lampwarden']) {
      const three = [2, 20, 40].map((s) => blocks(read(`cart-delza-scene-${id}-t${s}.txt`))[0]);
      assert.equal(new Set(three).size, 3, `${id}: the three moments differ`);
      for (const b of three) { assert.ok(b.includes('\n') && b.replace(/[\s░▒▓█·]/g, '').length > 0, `${id}: more than a wash of shade`); bodies.set(b, id); }
    }
    assert.equal(bodies.size, 18, 'no two scene captures are the same picture');
    const fight = FIGHT_MOMENTS.map((m) => blocks(read(`cart-delza-fight-t${Math.round(m * 1000)}.txt`))[0]);
    assert.equal(new Set(fight).size, 5, 'five different fight frames');
    assert.ok(fight.every((b) => b.includes('Swing lantern') && b.includes('ORRIN') && b.includes('CINDERHORN')), 'the command box and both health bars in every frame');
    assert.ok(fight[2].includes('12'), 'the frame just after the lantern lands shows the damage number');
    const cut = CUTSCENE_MOMENTS.map((m) => blocks(read(`cart-delza-cutscene-t${Math.round(m * 1000)}.txt`))[0]);
    assert.equal(new Set(cut).size, 4, 'four different cut-scene frames');
    assert.ok(cut[0].includes('MAREN') && cut[0].includes('You came') && !cut[0].includes('Lowmarrow?'), 'line 1 is half typed');
    assert.ok(cut[1].includes('Moonwax Key'), 'line 3 is whole');
    assert.ok(cut[2].includes('PIM'), 'Pim speaks');
    assert.ok(cut[3].includes('Highcandle was whole'), 'the last line is whole');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// the cart-* files of a captures folder, and whether they are exactly the files the tool writes
const cartFiles = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith('cart-')).sort();
const folderMatches = (dir) => { try { assert.deepEqual(cartFiles(dir), cartridgeCaptureNames().sort()); return true; } catch { return false; } };

test('the committed captures folder holds exactly the cartridge files the tool writes (nothing stale, nothing missing)', () => {
  const have = cartFiles(new URL('../captures/', import.meta.url));
  assert.deepEqual(have, cartridgeCaptureNames().sort());
});

test('the exact-match check bites both ways on Night Drive\'s files: a missing one fails, a stale extra one fails (negative controls on a temp copy)', () => {
  const dir = tmp();
  try {
    const src = new URL('../captures/', import.meta.url);
    for (const f of cartFiles(src)) fs.copyFileSync(new URL(f, src), path.join(dir, f));
    assert.ok(folderMatches(dir), 'control: the untouched copy matches');
    const some = 'cart-night-drive-scene-caller-t29.txt';
    assert.ok(fs.existsSync(path.join(dir, some)));
    fs.rmSync(path.join(dir, some));
    assert.ok(!folderMatches(dir), 'a missing Night Drive file fails');
    fs.copyFileSync(new URL(some, src), path.join(dir, some));
    assert.ok(folderMatches(dir), 'restored: matches again');
    fs.writeFileSync(path.join(dir, 'cart-night-drive-scene-caller-t31.txt'), 'x');
    assert.ok(!folderMatches(dir), 'a stale extra Night Drive file fails');
    fs.rmSync(path.join(dir, 'cart-night-drive-scene-caller-t31.txt'));
    fs.writeFileSync(path.join(dir, 'cart-night-drive-console-100x30.txt'), 'x');
    assert.ok(!folderMatches(dir), 'a stale extra Night Drive size fails');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('nightDriveCaptureNames: the hand-written list, exported like Delza\'s; in cartridgeCaptureNames only when Night Drive is installed, unlocked and runs in the shell', () => {
  assert.deepEqual(nightDriveCaptureNames().sort(), ND_WANT.slice().sort());
  assert.equal(ND_WANT.length, 2 * (8 * 3 + 9 + 3), 'per size: 24 + 9 later moments + menu, help, console');
  const all = cartridgeCaptureNames();
  for (const n of ND_WANT) assert.ok(all.includes(n), n);
  // a root without Night Drive (the fixture root) has none of its files
  const root = makeRoot();
  try {
    assert.ok(!cartridgeCaptureNames({ dirs: [{ dir: root, trusted: true }] }).some((n) => n.startsWith('cart-night-drive')), 'no Night Drive files without the cartridge');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cartridge captures: Night Drive\'s set shows what it says - every track moving, the later story moments, the tape-deck menu, the reskinned help, the console takeover', async () => {
  const dir = tmp();
  try {
    await runCaptureCartridges({ outDir: dir });
    const read = (n) => fs.readFileSync(path.join(dir, n), 'utf8');
    const body = (n) => blocks(read(n))[0];
    const nd = JSON.parse(fs.readFileSync(new URL('../cartridges/night-drive/manifest.json', import.meta.url), 'utf8'));
    const skin = JSON.parse(fs.readFileSync(new URL('../cartridges/night-drive/skin.json', import.meta.url), 'utf8'));
    // (b) every scene moment is its own picture, at both sizes, and none is blank or a wash of one shade
    const seen = new Map();
    for (const tag of ND_TAGS) {
      for (const id of ND_IDS) {
        const secs = ndSecs(id);
        const bodies = secs.map((s) => body(`cart-night-drive-scene-${id}${tag}-t${s}.txt`));
        assert.equal(new Set(bodies).size, secs.length, `${id}${tag}: the moments differ`);
        bodies.forEach((b, k) => {
          assert.ok(new Set(b.replace(/\s/g, '')).size >= 5, `${id}${tag} t${secs[k]}: more than a wash of one shade`);
          assert.ok(!seen.has(b), `${id}${tag} t${secs[k]} is the same picture as ${seen.get(b)}`);
          seen.set(b, `${id}${tag} t${secs[k]}`);
        });
      }
    }
    assert.equal(seen.size, 2 * (8 * 3 + 9), 'no two scene captures are the same picture');
    for (const id of ND_IDS) for (const sec of ndSecs(id)) {
      assert.notEqual(body(`cart-night-drive-scene-${id}-t${sec}.txt`), body(`cart-night-drive-scene-${id}-80x24-t${sec}.txt`), `${id} t${sec}: 80x24 is not the 120x40 picture`);
    }
    // (c) the story moments
    for (const tag of ND_TAGS) {
      // the card is the box drawn with the skin's frame glyphs; the radio dial below it has its own ▼ (the tuning needle), which is not the arrow
      const card = (n) => { const rows = body(n).split('\n'); return rows.slice(rows.findIndex((r) => r.includes('┏')), rows.findIndex((r) => r.includes('┗')) + 1).join('\n'); };
      const c29 = card(`cart-night-drive-scene-caller${tag}-t29.txt`), c70 = card(`cart-night-drive-scene-caller${tag}-t70.txt`);
      assert.ok(c29.includes('CALLER') && c29.includes('Danny') && c29.includes('▼'), `caller${tag} t29: Danny's card whole, with the arrow`);
      assert.ok(c70.replace(/\s+/g, ' ').includes('The tape clicks over') && !c70.includes('▼'), `caller${tag} t70: the narrator card, no arrow`);
      assert.ok(body(`cart-night-drive-scene-caller${tag}-t70.txt`).includes('▼'), `caller${tag} t70: the dial needle is still drawn, so the card box is what has no arrow`);
      assert.notEqual(body(`cart-night-drive-scene-redlight${tag}-t62.txt`), body(`cart-night-drive-scene-redlight${tag}-t2.txt`), `redlight${tag}: t62 is not t2`);
    }
    // Red Light's wiper and green moments (owner change request): t9 mid-stroke, t11 just before the next sweep, t61 with the rain near the lamp green.
    // The seconds are worked out here from the wiper's exported constants, not read from the tool.
    {
      const rl = await import('../cartridges/night-drive/scenes/redlight.js');
      const rainLib = await import('../cartridges/night-drive/lib/rain.js');
      const down = await import('../cartridges/night-drive/lib/downpour.js');
      const dash = await import('../cartridges/night-drive/lib/dash.js');
      const phase = (t) => (t * 30) % rainLib.CYCLE;
      const [tMid, tBefore, tGreen] = ND_LATER.redlight;
      const p1 = phase(tMid) - rainLib.SWEEP_AT;
      assert.ok(p1 >= 6 && p1 <= 12, `t${tMid} is ${p1} steps into the sweep, on its way up (the blade is mid-stroke)`);
      const p0 = rainLib.SWEEP_AT - phase(tBefore);
      assert.ok(p0 >= 1 && p0 <= 6, `t${tBefore} is ${p0} steps before the next sweep`);
      assert.ok(tGreen * 30 >= down.RAIN_GREEN_BY && (tGreen - 1) * 30 < down.RAIN_GREEN_BY, `t${tGreen} is the first whole second after the rain near the lamp is all green (step ${down.RAIN_GREEN_BY})`);
      const RAIN = new Set(['╲', '*', '×', '·', '°', "'", ',']);
      for (const [tag, w, h] of [['', 120, 40], ['-80x24', 80, 24]]) {
        const g = rl.geometry(w, h);
        const rows = (t) => body(`cart-night-drive-scene-redlight${tag}-t${t}.txt`).split('\n');
        const cellsOf = (pred) => { const out = []; for (let y = g.gTop; y < g.hoodTop; y++) for (let x = 0; x < w; x++) if (dash.onGlass(g, x, y) && pred(x, y)) out.push([x, y]); return out; };
        const share = (r, cells) => cells.filter(([x, y]) => RAIN.has([...r[y]][x])).length / cells.length;
        const armGlyph = (s) => (s > 0.5 ? '╱' : s >= -0.5 ? '│' : '\\');
        // mid-stroke: the arm is where the step says (a step either side allowed), the swath behind it is clear, spray is in the air
        const mid = rows(tMid), s9 = [30 * tMid - 1, 30 * tMid, 30 * tMid + 1].map((n) => rainLib.slopeAt(g, n));
        const cur = s9[1];
        const armOk = s9.some((s) => [...mid[g.py - 3]][g.px + Math.round(s * 3)] === armGlyph(s));
        assert.ok(armOk, `redlight${tag} t${tMid}: the arm is on its way up (${cur.toFixed(2)} columns a row)`);
        assert.notEqual([...mid[g.py - 3]][g.px + Math.round(g.sRest * 3)], '╱', `redlight${tag} t${tMid}: the arm has left its rest position`);
        const swath = cellsOf((x, y) => rainLib.inBand(g, x, y, Math.max(...s9) + 0.5, g.sRest - 0.3) && !dash.inZone(g, x, y));
        const others = cellsOf((x, y) => !rainLib.inBand(g, x, y, Math.min(...s9) - 0.3, g.sRest + 0.5) && !dash.inZone(g, x, y));
        assert.ok(swath.length > 100 && others.length > 100, `redlight${tag}: ${swath.length} swath cells, ${others.length} others`);
        assert.ok(share(mid, others) >= 0.1, `redlight${tag} t${tMid}: the glass outside the swath is wet (${(100 * share(mid, others)).toFixed(0)}%)`);
        assert.ok(share(mid, swath) <= 0.2 * share(mid, others), `redlight${tag} t${tMid}: the swath behind the blade is clear (${(100 * share(mid, swath)).toFixed(1)}% against ${(100 * share(mid, others)).toFixed(1)}%)`);
        assert.ok(mid.join('').split('').filter((ch) => ch === '*' || ch === '×').length >= 3, `redlight${tag} t${tMid}: spray in the air`);
        // just before the next sweep: the arm is parked, the same swath is full of rain
        const before = rows(tBefore);
        for (let r = 1; r <= 4; r++) assert.equal([...before[g.py - r]][g.px + Math.round(g.sRest * r)], '╱', `redlight${tag} t${tBefore}: the arm is parked (row ${r})`);
        assert.ok(share(before, swath) >= 0.1 && share(before, swath) >= 3 * share(mid, swath), `redlight${tag} t${tBefore}: the swath is wet again (${(100 * share(before, swath)).toFixed(0)}%)`);
        // the green moment: the rain near the lamp is back (it goes dark while the light changes) and far rain is there too
        const near = cellsOf((x, y) => down.tintLevel(g, x, y) > 0 && !dash.inZone(g, x, y)), far = cellsOf((x, y) => down.tintLevel(g, x, y) === 0);
        const green = rows(tGreen);
        assert.ok(share(green, near) >= 0.05 && share(green, far) >= 0.1, `redlight${tag} t${tGreen}: rain near the lamp ${(100 * share(green, near)).toFixed(1)}% and far ${(100 * share(green, far)).toFixed(1)}%`);
        assert.ok(near.length > 150, `redlight${tag}: ${near.length} cells of glass near the lamp`);
      }
    }
    // the diner capture sits at the bottom of a dip: the flicker schedule (seed 1) says so
    const diner = await import('../cartridges/night-drive/scenes/diner.js');
    assert.equal(diner.flickerShade(ND_LATER.diner[0], 1), 1, 'the diner moment is mid-dip');
    // the tape-deck menu: title, prompt, all nine entries, the * on the playing track and the cursor on another
    assert.equal(nd.menu.length, 9);
    for (const sz of ['120x40', '80x24']) {
      const m = body(`cart-night-drive-menu-${sz}.txt`);
      assert.ok(m.includes(skin.menu.title) && m.includes(skin.menu.prompt), `menu ${sz}: title and prompt`);
      for (const e of nd.menu) assert.ok(m.includes(e.label), `menu ${sz}: ${e.label}`);
      const rows = m.split('\n');
      const playing = rows.find((r) => r.includes(nd.menu[0].label)), cursor = rows.find((r) => r.includes(nd.menu[1].label));
      assert.ok(playing.includes('*') && !playing.includes(skin.menu.cursor), `menu ${sz}: the * is on the playing track`);
      assert.ok(cursor.includes(skin.menu.cursor) && !cursor.includes('*'), `menu ${sz}: the cursor is on another track`);
      // the help panel in the skin's own words
      assert.ok(body(`cart-night-drive-help-${sz}.txt`).includes(skin.help.title), `help ${sz}: ${skin.help.title}`);
    }
    // the console takeover, by glyph: the skin's frame, grille, stripe and title (the compact 80x24 console has no stripe bar)
    for (const sz of ['120x40', '80x24']) {
      const k = body(`cart-night-drive-console-${sz}.txt`);
      for (const ch of new Set([...skin.console.frame])) assert.ok(k.includes(ch), `console ${sz}: the skin's frame glyph ${ch}`);
      assert.ok(k.includes(skin.console.grille.repeat(3)), `console ${sz}: the grille`);
      assert.ok(k.includes(skin.frame.title), `console ${sz}: the title text`);
      if (sz === '120x40') assert.ok(k.includes(skin.console.stripe), `console ${sz}: the equaliser stripe`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cartridge captures: a cartridge that runs in the shell also gets eject files at the matching fractions of the 1.6 s eject animation, after its 0.3 s fade to blank (fixture root)', async () => {
  const dir = tmp();
  const root = makeRoot();
  try {
    const dirs = [{ dir: root, trusted: true }];
    const files = await runCaptureCartridges({ outDir: dir, dirs });
    const names = new Set(fs.readdirSync(dir));
    assert.deepEqual([...names].sort(), cartridgeCaptureNames({ dirs }).sort());
    assert.equal(files.length, names.size);
    assert.deepEqual(EJECT_MOMENTS.map((m) => Math.round(((m - EJECT_FADE_SECONDS) / EJECT_ANIM_SECONDS) * 1000)), CART_MOMENTS.filter((m) => m < INSERT_END).map((m) => Math.round((m / INSERT_END) * 1000)), 'the same fractions');
    const eject = [...names].filter((n) => n.startsWith('cart-eject-'));
    assert.equal(eject.length, EJECT_MOMENTS.length * 2, 'three per size for the fixture; none for Classic');
    assert.ok(!eject.some((n) => n.includes('classic')), 'Classic has no eject');
    const ej = EJECT_MOMENTS.map((m) => fs.readFileSync(path.join(dir, `cart-eject-fixture-t${Math.round(m * 1000)}.txt`), 'utf8'));
    assert.equal(new Set(ej).size, ej.length, 'the eject frames differ');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
});

test('cartridge captures are deterministic (second run is byte-identical)', async () => {
  const d1 = tmp(), d2 = tmp();
  try {
    await runCaptureCartridges({ outDir: d1 });
    await runCaptureCartridges({ outDir: d2 });
    const names = fs.readdirSync(d1).sort();
    assert.deepEqual(names, fs.readdirSync(d2).sort());
    for (const f of names) assert.equal(fs.readFileSync(path.join(d1, f), 'utf8'), fs.readFileSync(path.join(d2, f), 'utf8'), f);
  } finally {
    fs.rmSync(d1, { recursive: true, force: true });
    fs.rmSync(d2, { recursive: true, force: true });
  }
});

test('capture.mjs --cartridges writes only the cartridge files (a cheap run) and says how many', () => {
  const dir = tmp();
  try {
    const r = spawnSync(process.execPath, [CAPTURE_TOOL, '--cartridges', '--out', dir], { encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /wrote \d+ cartridge files/);
    assert.deepEqual(fs.readdirSync(dir).sort(), cartridgeCaptureNames().sort());
    assert.ok(fs.readdirSync(dir).every((f) => f.startsWith('cart-')), 'nothing but cart-* files');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- tools/measure.mjs console options (DRIFT-4)
import { runMeasure, cartridgeTargets } from '../tools/measure.mjs';
import { tmpRoot, makeFixtureCartridge } from './helpers-cartridge.js';

const fixtureDirs = () => { const root = tmpRoot('drift-measure-fx-'); makeFixtureCartridge(root, 'fixture'); return [{ dir: root, trusted: true }]; };

test('measure --library: a resting library draws only its small idle movements; arrow presses every cycle redraw it; the start-up load is reported', async () => {
  const idle = await runMeasure({ seconds: 2.2, cols: 80, rows: 24, library: true, quiet: true });
  const cyc = await runMeasure({ seconds: 4.2, cols: 80, rows: 24, library: true, cycle: 1.3, quiet: true }); // a shelf step takes 1.2 s now, so one press per 1.3 s (three of them) rather than every 0.5 s
  assert.ok(idle.frames >= 1 && idle.frames <= 14, `idle library frames ${idle.frames} (of about 40 ticks)`);
  assert.ok(cyc.frames > idle.frames + 5, `cycling library redraws: ${cyc.frames} vs ${idle.frames}`);
  assert.ok(Number.isFinite(idle.loadMs) && idle.loadMs >= 0);
  assert.equal(idle.samples.length >= 2, true);
});

test('measure --cartridge: sampling starts after the cartridge runs; --program and --scene are honoured; bad ones are errors (both arms)', async () => {
  const dirs = fixtureDirs();
  const r = await runMeasure({ seconds: 2.2, cols: 80, rows: 24, cartridge: { id: 'fixture', program: 'mix', scene: 'drops' }, dirs, quiet: true });
  assert.ok(r.frames > 5, `frames ${r.frames}`);
  assert.ok(r.bytes > 500);
  assert.ok(Number.isFinite(r.loadMs) && r.loadMs >= 0 && r.loadMs < 5000, `load_ms ${r.loadMs}`);
  assert.equal(r.firstWrite, '\x1b[?1049h\x1b[?25l', 'through the real terminal-enter path');
  await runMeasure({ seconds: 1.2, cols: 80, rows: 24, cartridge: { id: 'fixture', program: 'calm' }, dirs, quiet: true }); // a program switch, then the start scene
  await assert.rejects(runMeasure({ seconds: 1, cols: 80, rows: 24, cartridge: { id: 'fixture', program: 'nope' }, dirs, quiet: true }), /no program 'nope'/);
  await assert.rejects(runMeasure({ seconds: 1, cols: 80, rows: 24, cartridge: { id: 'fixture', program: 'mix', scene: 'haze' }, dirs, quiet: true }), /does not hold scene 'haze'/);
  await assert.rejects(runMeasure({ seconds: 1, cols: 80, rows: 24, cartridge: { id: 'nope' }, dirs, quiet: true }), /no cartridge called 'nope'/);
  await assert.rejects(runMeasure({ seconds: 1, cols: 80, rows: 24, cartridge: { id: 'classic' }, dirs: [{ dir: INSTALL_DIR, trusted: true }], quiet: true }), /Classic: use --scene/);
  await assert.rejects(runMeasure({ seconds: 1, cols: 80, rows: 24, cartridge: { id: 'arcade' }, dirs: [{ dir: INSTALL_DIR, trusted: true }], quiet: true }), /it is locked/);
});

test('measure --cartridge all: one target per unlocked scene (each with a program that holds it); the install has Delza\'s scenes', () => {
  const t = cartridgeTargets(fixtureDirs());
  assert.deepEqual(t.map((x) => x.scene).sort(), ['drops', 'haze', 'note', 'plasma-ref', 'sandbox', 'swell', 'tide']);
  assert.deepEqual(t.find((x) => x.scene === 'haze'), { cartridge: 'fixture', program: 'calm', scene: 'haze' });
  assert.deepEqual(t.find((x) => x.scene === 'tide'), { cartridge: 'fixture', program: 'mix', scene: 'tide' });
  const delza = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.find((c) => c.id === 'delza');
  const nd = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.find((c) => c.id === 'night-drive');
  const dm = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] }).cartridges.find((c) => c.id === 'driftman-9000');
  assert.deepEqual(cartridgeTargets(), [
    ...delza.manifest.scenes.map((s) => ({ cartridge: 'delza', program: 'tale', scene: s.id })),
    ...dm.manifest.scenes.map((s) => ({ cartridge: 'driftman-9000', program: 'transmission', scene: s.id })),
    ...nd.manifest.scenes.map((s) => ({ cartridge: 'night-drive', program: 'tape', scene: s.id })),
  ], 'the install holds three real cartridges: Delza (her tale), the Driftman 9000 (its transmission) and Night Drive (its tape), one target per scene');
});
