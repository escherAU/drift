// DRIFT-5: Night Drive's text colours and its 256-colour fallback.
//
// The design (plans/drift/DRIFT-5-night-drive-design.md section 1b) lets TEXT use only the ui colours (TEXT 48, DIM 49), shade-3 hues, or
// cyan.2, sun.2, mint.2 and ice.2. mag.2 (4.2:1) and violet.2 (3.5:1) fail 4.5:1 on the background and are for pictures only.
//   (1) text scan   every scene, five sizes, speed 2, the whole hold, through the real cell composer: every cell whose glyph is [0-9A-Za-z]
//                   is drawn in an allowed text colour; onramp, redlight, diner and caller each show text (so the scan can see it);
//                   controls: a planted 'A' in mag.2, violet.2 and sun.1 fails the same checker.
//   (2) ui colours  the skin's palette.ui colours are allowed and reach 4.5:1 on #0D0820 in truecolor and in the 256-colour fallback;
//                   control: mag.2 and violet.2 do not.
//   (3) 256 colour  makeSkinPalette(skin, '256'): the background escape, no fixed colour falls onto the background, FAR and NEAR are distinct
//                   from it and each other and keep a visible contrast, each family's four shades are four distinct rising indexes;
//                   scan: no lit cell of any scene maps to the background index; control: a NEAR of #121212 fails the same check.
// NOTE (not a failure): the diner's LUMA'S sign is built from line-drawing glyphs and three of its cells flicker through mag.2 and mag.1 by
// design; the diner test below asserts those flicker cells are non-alphanumeric, so they are pictures under the rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createCellComposer } from '../src/cells.js';
import { INSTALL_DIR } from '../src/cartridge/loader.js';
import { makeSkinPalette } from '../src/cartridge/palette.js';
import { rgbTo256, parseHex } from '../src/color.js';

const ND = path.join(INSTALL_DIR, 'night-drive');
const SKIN = JSON.parse(fs.readFileSync(path.join(ND, 'skin.json'), 'utf8'));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ND, 'manifest.json'), 'utf8'));
const TAPE = MANIFEST.programs.find((p) => p.id === MANIFEST.start);
const holdOf = (id) => (TAPE.seconds && TAPE.seconds[id]) ?? TAPE.sceneSeconds;
const SCENE_IDS = TAPE.scenes;
const SCENES = {};
for (const id of SCENE_IDS) SCENES[id] = (await import(`../cartridges/night-drive/scenes/${id}.js`)).default;

const FPS = 18;
const NAMES = ['sun', 'tang', 'coral', 'mag', 'violet', 'cyan', 'mint', 'ice'];
const nameOf = (i) => (i < 16 ? `hue${i}` : i < 48 ? `${NAMES[(i - 16) >> 2]}.${(i - 16) & 3}` : ['text', 'dim', 'far', 'near'][i - 48] || `#${i}`);
const MAG2 = 30, VIOLET2 = 34, SUN1 = 17;
// the design's rule: ui colours, every shade-3 hue, and shade 2 of cyan, sun, mint, ice
const ALLOWED_TEXT = new Set([48, 49, 19, 23, 27, 31, 35, 39, 43, 47, 38, 18, 42, 46]);
const isText = (g) => (g >= 48 && g <= 57) || (g >= 65 && g <= 90) || (g >= 97 && g <= 122);

// Plays a scene alone through the cell composer at speed x for `seconds`; calls each(glyphs, shades) for every frame.
function playScene(scene, w, h, speed, seconds, each) {
  const cc = createCellComposer({ scenes: [scene], cols: w, rows: h, seed: 1 });
  cc.resize(w, h); cc.reset(0);
  const total = Math.ceil((seconds * FPS) / speed);
  for (let k = 0; k <= total; k++) {
    const f = cc.frame({ a: 0, b: 0, p: 0 }, (k * speed) / FPS);
    each(f.glyphs, f.shades);
  }
}

// The text checker: how many alphanumeric cells, in which colours, and which of those colours the rule forbids.
function textScan(scene, sizes, speed, seconds, watch = []) {
  const byColour = new Map(), watched = new Map(watch.map((c) => [c, new Set()]));
  let total = 0;
  for (const [w, h] of sizes) {
    playScene(scene, w, h, speed, seconds, (g, s) => {
      for (let i = 0; i < g.length; i++) {
        const gi = g[i];
        if (gi === 32) continue;
        const wset = watched.get(s[i]);
        if (wset) wset.add(gi);
        if (isText(gi)) { total++; byColour.set(s[i], (byColour.get(s[i]) || 0) + 1); }
      }
    });
  }
  const bad = [...byColour.keys()].filter((c) => !ALLOWED_TEXT.has(c));
  return { total, byColour, bad, watched };
}
const describe = (m) => [...m.entries()].map(([c, n]) => `${nameOf(c)}:${n}`).join(' ');

const SIZES = [[120, 40], [80, 24], [100, 32], [240, 67], [60, 18]];

// ---- (1) text scan

const MEASURED_TEXT = {}; // scene -> scan, kept for the diner assertion and the TABLE
for (const id of SCENE_IDS) {
  test(`skin contrast (1) text: ${id} draws every letter and digit in an allowed text colour (five sizes, speed 2, ${holdOf(id)} s)`, () => {
    const r = textScan(SCENES[id], SIZES, 2, holdOf(id), id === 'diner' ? [29, 30] : []);
    MEASURED_TEXT[id] = r;
    console.log(`TABLE skin text ${id}: ${r.total} text cells; ${describe(r.byColour) || 'none'}`);
    assert.deepEqual(r.bad.map(nameOf), [], `${id}: text in a colour the rule forbids`);
  });
}

test('skin contrast (1) text: onramp, redlight, diner and caller each show text (so the scan proves it sees text); skyline, sundown, coast and overdrive draw none', () => {
  for (const id of ['onramp', 'redlight', 'diner', 'caller']) assert.ok(MEASURED_TEXT[id].total > 0, `${id} shows text cells`);
  // the other arm: the four picture scenes carry no letters or digits at all, so they cannot break the rule
  for (const id of ['skyline', 'sundown', 'coast', 'overdrive']) assert.equal(MEASURED_TEXT[id].total, 0, `${id} draws no letters or digits`);
});

test('skin contrast (1) text: the diner\'s sign cells that flicker through mag.2 and mag.1 are line-drawing glyphs, not letters or digits (pictures under the rule)', () => {
  const w = MEASURED_TEXT.diner.watched;
  const glyphs = new Set([...w.get(29), ...w.get(30)]);
  assert.ok(glyphs.size > 0, 'something is drawn in mag.1 or mag.2 in the diner (the sign flicker)');
  assert.deepEqual([...glyphs].filter(isText).map((g) => String.fromCharCode(g)), [], 'none of them is alphanumeric');
});

test('skin contrast (1) text controls: a planted scene writing \'A\' in mag.2, in violet.2 or in sun.1 fails the same checker; an \'A\' in text colour (48) passes; a non-letter in mag.2 passes', () => {
  const planted = (glyph, colour) => {
    const f = (t, w, h, p) => { p.glyphs.fill(32); p.colours.fill(0); p.glyphs[5] = glyph; p.colours[5] = colour; };
    f.id = 'planted'; f.kind = 'cells';
    return f;
  };
  const A = 65;
  for (const [colour, label] of [[MAG2, 'mag.2'], [VIOLET2, 'violet.2'], [SUN1, 'sun.1']]) {
    const r = textScan(planted(A, colour), [[40, 12]], 1, 2);
    assert.ok(r.total > 0, `${label}: the planted A is seen`);
    assert.deepEqual(r.bad, [colour], `${label}: flagged`);
  }
  assert.deepEqual(textScan(planted(A, 48), [[40, 12]], 1, 2).bad, [], 'A in text colour passes');
  assert.deepEqual(textScan(planted(0x2503, MAG2), [[40, 12]], 1, 2).bad, [], 'a line-drawing glyph in mag.2 is a picture and passes');
  assert.deepEqual(textScan(planted(0x38, MAG2), [[40, 12]], 1, 2).bad, [MAG2], 'a digit in mag.2 is flagged');
});

// ---- (2) the skin's ui colours

const BG = parseHex(SKIN.palette.bg);
const COLOURS = SKIN.palette.colours.map(parseHex); // palette index 16 + k
const rgbOfIndex = (i) => COLOURS[i - 16];
const lum = (rgb) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};
const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
const CUBE = [0, 95, 135, 175, 215, 255];
const xterm = (n) => (n >= 232 ? [8 + 10 * (n - 232), 8 + 10 * (n - 232), 8 + 10 * (n - 232)] : [CUBE[Math.floor((n - 16) / 36)], CUBE[Math.floor((n - 16) / 6) % 6], CUBE[(n - 16) % 6]]);
const BG256 = rgbTo256(BG);
const WCAG = 4.5;
const UI_MEASURED = { text: [16.19, 16.15], dim: [4.86, 5.45], head: [12.89, 10.85], accent: [6.32, 7.02] }; // [truecolor, 256]

test('skin contrast (2) ui: text, dim, head and accent are allowed text colours and reach 4.5:1 on #0D0820 in truecolor and in the 256-colour fallback', () => {
  assert.equal(BG256, 233, 'the 256-colour background is xterm 233');
  assert.deepEqual(xterm(233), [18, 18, 18]);
  const rows = [];
  for (const [role, idx] of Object.entries(SKIN.palette.ui)) {
    assert.ok(ALLOWED_TEXT.has(idx), `ui.${role} (${idx} ${nameOf(idx)}) is an allowed text colour`);
    const rgb = rgbOfIndex(idx);
    const t = ratio(rgb, BG), f = ratio(xterm(rgbTo256(rgb)), xterm(BG256));
    rows.push(`${role} ${idx} ${nameOf(idx)}: truecolor ${t.toFixed(2)}, 256 (xterm ${rgbTo256(rgb)}) ${f.toFixed(2)}`);
    assert.ok(t >= WCAG, `ui.${role}: truecolor ${t.toFixed(2)} >= ${WCAG}`);
    assert.ok(f >= WCAG, `ui.${role}: 256-colour ${f.toFixed(2)} >= ${WCAG}`);
    const [mt, mf] = UI_MEASURED[role];
    assert.ok(Math.abs(t - mt) < 0.05 && Math.abs(f - mf) < 0.05, `ui.${role} still reads ${mt} / ${mf} (read ${t.toFixed(2)} / ${f.toFixed(2)})`);
  }
  console.log(`TABLE skin ui contrast\n  ${rows.join('\n  ')}`);
  assert.deepEqual(Object.keys(SKIN.palette.ui).sort(), ['accent', 'dim', 'head', 'text']);
});

test('skin contrast (2) ui control: mag.2 and violet.2 are below 4.5:1 in truecolor (the reason the rule exists) and are not allowed text colours', () => {
  const m = ratio(rgbOfIndex(MAG2), BG), v = ratio(rgbOfIndex(VIOLET2), BG);
  console.log(`TABLE skin pictures-only: mag.2 ${m.toFixed(2)}, violet.2 ${v.toFixed(2)}`);
  assert.ok(m < WCAG && Math.abs(m - 4.22) < 0.05, `mag.2 ${m.toFixed(2)}`);
  assert.ok(v < WCAG && Math.abs(v - 3.46) < 0.05, `violet.2 ${v.toFixed(2)}`);
  assert.ok(!ALLOWED_TEXT.has(MAG2) && !ALLOWED_TEXT.has(VIOLET2));
  // and the allowed set really is the rule: all of it reaches 4.5:1 in truecolor
  for (const idx of ALLOWED_TEXT) assert.ok(ratio(rgbOfIndex(idx), BG) >= WCAG, `${nameOf(idx)} ${ratio(rgbOfIndex(idx), BG).toFixed(2)}`);
});

// ---- (3) the 256-colour fallback

const fgOf = (sgr) => +/38;5;(\d+)/.exec(sgr)[1];
const bgOfSgr = (sgr) => +/48;5;(\d+)/.exec(sgr)[1];

// The 256 palette checks as a function so a control can feed it a worse skin; returns a list of problems.
function check256(skin) {
  const p = makeSkinPalette(skin, '256', 'night-drive');
  const problems = [];
  const bg = bgOfSgr(p.base);
  if (bg !== 233) problems.push(`background ${bg}, not 233`);
  p.sgr.forEach((s, i) => { if (!s.endsWith(p.base)) problems.push(`entry ${i} does not end with the background escape`); });
  const idx = p.sgr.map(fgOf);
  const rgbs = idx.map(xterm);
  for (let i = 16; i <= 51; i++) if (idx[i] === bg) problems.push(`${nameOf(i)} maps onto the background (${bg})`);
  const far = idx[50], near = idx[51];
  if (far === near) problems.push('FAR and NEAR map to the same index');
  const bgRgb = xterm(bg);
  const rNear = ratio(rgbs[51], bgRgb), rFar = ratio(rgbs[50], bgRgb);
  if (rNear < 1.2) problems.push(`NEAR contrast ${rNear.toFixed(2)} < 1.2`);
  if (rFar < 1.5) problems.push(`FAR contrast ${rFar.toFixed(2)} < 1.5`);
  const fam = [];
  NAMES.forEach((n, k) => {
    const four = [0, 1, 2, 3].map((j) => idx[16 + 4 * k + j]);
    fam.push(`${n} ${four.join(',')}`);
    if (new Set(four).size !== 4) problems.push(`${n}: shades share a 256 index (${four.join(',')})`);
    const L = four.map((n2) => lum(xterm(n2)));
    for (let j = 1; j < 4; j++) if (!(L[j] > L[j - 1])) problems.push(`${n}: shade ${j} is not brighter than shade ${j - 1} (${four.join(',')})`);
  });
  return { problems, idx, bg, rNear, rFar, far, near, fam, p };
}

test('skin contrast (3) 256-colour: the background escape ends every entry, no fixed colour maps onto it, FAR is 237 and NEAR 235 with a visible contrast, and each family has four distinct rising indexes', () => {
  const r = check256(SKIN);
  console.log(`TABLE skin 256: bg ${r.bg}, FAR ${r.far} (${r.rFar.toFixed(2)}), NEAR ${r.near} (${r.rNear.toFixed(2)})\n  ${r.fam.join('\n  ')}`);
  assert.deepEqual(r.problems, []);
  assert.equal(r.bg, 233);
  assert.equal(r.p.base, '\x1b[48;5;233m');
  assert.equal(r.far, 237, 'FAR maps to 237');
  assert.equal(r.near, 235, 'NEAR maps to 235');
  assert.notEqual(r.far, r.bg); assert.notEqual(r.near, r.bg); assert.notEqual(r.far, r.near);
  assert.ok(r.rNear >= 1.2 && Math.abs(r.rNear - 1.24) < 0.03, `NEAR ${r.rNear.toFixed(2)}`);
  assert.ok(r.rFar >= 1.5 && Math.abs(r.rFar - 1.65) < 0.03, `FAR ${r.rFar.toFixed(2)}`);
  const want = {
    sun: [58, 101, 179, 221], tang: [58, 94, 167, 209], coral: [52, 89, 167, 203], mag: [53, 90, 169, 206],
    violet: [238, 60, 98, 99], cyan: [23, 30, 38, 45], mint: [23, 29, 78, 85], ice: [59, 245, 251, 255],
  };
  NAMES.forEach((n, k) => assert.deepEqual([0, 1, 2, 3].map((j) => r.idx[16 + 4 * k + j]), want[n], `${n} maps as measured`));
  // the truecolor palette is the other arm: its backgrounds are 24-bit, not 256
  const t = makeSkinPalette(SKIN, 'truecolor', 'night-drive');
  assert.ok(t.base.includes('48;2;13;8;32'));
});

test('skin contrast (3) 256-colour control: a skin whose NEAR is #121212 (xterm 233, the background) fails the same checks', () => {
  const worse = JSON.parse(JSON.stringify(SKIN));
  assert.equal(worse.palette.colours[35], '#1A1240');
  worse.palette.colours[35] = '#121212';
  const r = check256(worse);
  assert.ok(r.problems.some((p) => p.startsWith('NEAR maps onto the background') || p.startsWith('near maps onto the background')), r.problems.join(' | '));
  assert.ok(r.problems.some((p) => p.includes('NEAR contrast')), r.problems.join(' | '));
  assert.equal(r.near, 233);
  assert.deepEqual(check256(SKIN).problems, [], 'and the shipped skin is clean under the same check');
});

test('skin contrast (3) 256-colour scan: no lit cell of any scene maps to the background index (233), at 120x40 and 80x24, speed 3, the whole hold', () => {
  const r = check256(SKIN);
  assert.equal(r.bg, 233);
  let lit = 0;
  const hit = [];
  for (const id of SCENE_IDS) {
    let litHere = 0;
    for (const [w, h] of [[120, 40], [80, 24]]) {
      playScene(SCENES[id], w, h, 3, holdOf(id), (g, s) => {
        for (let i = 0; i < g.length; i++) {
          if (g[i] === 32) continue;
          litHere++;
          const n = r.idx[s[i]];
          if (n === undefined || n === r.bg) { if (hit.length < 5) hit.push(`${id} ${w}x${h} colour ${s[i]} -> ${n}`); }
        }
      });
    }
    assert.ok(litHere > 0, `${id} lights cells (the scan sees them)`);
    lit += litHere;
  }
  console.log(`TABLE skin 256 scan: ${lit} lit cells, none on 233`);
  assert.deepEqual(hit, []);
});
