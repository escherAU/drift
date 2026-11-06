// DRIFT-2 slice 2: the four new high-contrast scenes (wire, tunnel, blocktype, maze) and the
// playlist / capture / app checks (K) for both new sets. The shared suite already runs every
// scene through determinism, sizes, allow-list, buffer reuse, "colour index 0 only" and the
// 60 s flash check; this file pins what is specific to each scene.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLAYLISTS, findScene, allSceneIds } from '../src/scenes/index.js';
import { renderScene, createCellComposer } from '../src/cells.js';
import { createApp, parseOptions } from '../src/app.js';
import { runCaptureModes } from '../tools/capture.mjs';
import wire, { phaseAt, PHASE_SECONDS } from '../src/scenes/wire.js';
import tunnel, { TUNNEL_GLYPHS } from '../src/scenes/tunnel.js';
import blocktype, { BLOCK_WORDS, SLOT_SECONDS, TRANSITION_SECONDS, wordIndexAt } from '../src/scenes/blocktype.js';
import { FONT, GLYPH_W, GLYPH_H } from '../src/scenes/blockfont.js';
import maze, { generateMaze } from '../src/scenes/maze.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';
import { frameLines } from './helpers-help.js';

const FPS = 18;
const litN = (f) => f.glyphs.reduce((n, v) => n + (v !== 32 ? 1 : 0), 0);

// 8-neighbour connected components of the lit cells
function components(f) {
  const { cols: W, rows: H, glyphs } = f;
  const seen = new Uint8Array(W * H);
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    if (glyphs[i] === 32 || seen[i]) continue;
    n++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop(), x = j % W, y = (j / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const k = yy * W + xx;
        if (glyphs[k] !== 32 && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
  }
  return n;
}
const bbox = (f) => {
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let i = 0; i < f.glyphs.length; i++) if (f.glyphs[i] !== 32) {
    const x = i % f.cols, y = (i / f.cols) | 0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
};
const hist = (f) => { const m = new Map(); for (const v of f.glyphs) m.set(v, (m.get(v) || 0) + 1); return m; };
const histDist = (a, b) => { let d = 0; for (const k of new Set([...a.keys(), ...b.keys()])) d += Math.abs((a.get(k) || 0) - (b.get(k) || 0)); return d; };

test('contrast set: the playlist holds life, tunnel, wire, maze, blocktype in that order', () => {
  assert.deepEqual(PLAYLISTS.contrast.map((s) => s.id), ['life', 'tunnel', 'wire', 'maze', 'blocktype']);
});

// ---------------------------------------------------------------- G: wire
test('G wire: the frame is non-empty, rotates (t vs t+0.3 differ) and uses only braille dots', () => {
  for (const t of [1.5, 5, 14, 20]) {
    const f = renderScene(wire, t, 120, 40, 1);
    assert.ok(litN(f) > 40, `lit ${litN(f)} at ${t}`);
    for (const g of f.glyphs) assert.ok(g === 32 || (g > 0x2800 && g <= 0x28ff), `U+${g.toString(16)}`);
    const g = renderScene(wire, t + 0.3, 120, 40, 1);
    assert.notDeepEqual(Array.from(f.glyphs), Array.from(g.glyphs), `frames at ${t} and ${t + 0.3} differ`);
  }
});

test('G wire connectedness: the cube is ONE 8-neighbour component at every t of its phase (its 12 edges meet at the corners); the torus is at most 2 (its rings cross)', () => {
  for (const t of [1.5, 2, 3.7, 6, 8.4, 11]) {
    assert.equal(phaseAt(t), 'cube');
    assert.equal(components(renderScene(wire, t, 120, 40, 1)), 1, `cube t=${t}`);
  }
  for (const t of [PHASE_SECONDS + 1.5, PHASE_SECONDS + 4, PHASE_SECONDS + 7.3, PHASE_SECONDS + 10]) {
    assert.equal(phaseAt(t), 'torus');
    const n = components(renderScene(wire, t, 120, 40, 1));
    assert.ok(n >= 1 && n <= 2, `torus t=${t}: ${n} components`);
  }
});

test('G wire fits: 120x40 (not clipped: a margin on every side), 30x10 and 3x2 never throw and stay in range, both phases', () => {
  for (const t of [3, 6, 15, 18, 21]) {
    const f = renderScene(wire, t, 120, 40, 1);
    const b = bbox(f);
    assert.ok(b.x0 >= 1 && b.y0 >= 1 && b.x1 <= 118 && b.y1 <= 38, `${t}: ${JSON.stringify(b)} touches the edge`);
    for (const [w, h] of [[30, 10], [3, 2], [1, 1], [0, 0], [240, 67]]) {
      const g = renderScene(wire, t, w, h, 1);
      assert.equal(g.glyphs.length, w * h);
      for (const v of g.glyphs) assert.ok(v === 32 || (v > 0x2800 && v <= 0x28ff));
    }
  }
  assert.ok(litN(renderScene(wire, 3, 30, 10, 1)) > 5, 'a small screen still shows the shape');
});

test('G wire aspect: a cell is 1:2, and braille dots make a square grid; the cube is about as wide as it is tall (dots) on average', () => {
  let sum = 0, n = 0;
  for (let t = 1; t <= 11; t += 0.5) {
    const b = bbox(renderScene(wire, t, 120, 40, 1));
    sum += ((b.x1 - b.x0 + 1) * 2) / ((b.y1 - b.y0 + 1) * 4);
    n++;
  }
  const mean = sum / n;
  assert.ok(mean > 0.75 && mean < 1.35, `mean width/height in dots ${mean.toFixed(2)}`);
});

test('G wire phases: a cube phase and a torus phase both occur within 60 s, with different glyph histograms; the switch is not a whole-screen flash', () => {
  const seen = new Set();
  for (let t = 0; t < 60; t += 1) seen.add(phaseAt(t));
  assert.deepEqual([...seen].sort(), ['cube', 'torus']);
  assert.equal(phaseAt(0), 'cube');
  const cube = hist(renderScene(wire, 6, 120, 40, 1)), torus = hist(renderScene(wire, PHASE_SECONDS + 6, 120, 40, 1));
  assert.ok(histDist(cube, torus) > 100, `histograms differ by ${histDist(cube, torus)}`);
  assert.ok(litN(renderScene(wire, PHASE_SECONDS + 6, 120, 40, 1)) > litN(renderScene(wire, 6, 120, 40, 1)), 'torus has more lines than the cube');
  // across each switch the shape shrinks and grows, so no frame loses or gains a quarter of the screen
  for (const T0 of [PHASE_SECONDS, 2 * PHASE_SECONDS, 3 * PHASE_SECONDS]) {
    let prev = null;
    for (let k = -FPS; k <= FPS; k++) {
      const g = renderScene(wire, T0 + k / FPS, 120, 40, 1).glyphs;
      if (prev) { let sw = 0; for (let i = 0; i < g.length; i++) if ((g[i] !== 32) !== (prev[i] !== 32)) sw++; assert.ok(sw / g.length < 0.25, `switch at ${T0}`); }
      prev = g.slice();
    }
  }
  for (const t of [0, 5, 13, 30]) assert.ok(renderScene(wire, t, 120, 40, 1).colours.every((v) => v === 0));
});

// ---------------------------------------------------------------- H: tunnel
test('H tunnel: only space and full/half blocks (no shades), at several sizes and times', () => {
  assert.deepEqual([...TUNNEL_GLYPHS].sort(), [32, 0x2580, 0x2584, 0x2588]);
  for (const [w, h] of [[120, 40], [240, 67], [30, 10], [3, 2], [1, 1]]) for (const t of [0, 2.2, 9, 31]) {
    for (const g of renderScene(tunnel, t, w, h, 1).glyphs) assert.ok(TUNNEL_GLYPHS.includes(g), `U+${g.toString(16)}`);
  }
  for (const shade of [0x2591, 0x2592, 0x2593]) assert.ok(!TUNNEL_GLYPHS.includes(shade));
});

test('H tunnel: lit fraction stays between 20% and 80% at several t and sizes', () => {
  for (const [w, h] of [[120, 40], [240, 67], [80, 24]]) for (const t of [0, 1.3, 4, 9, 20.7, 45]) {
    const f = renderScene(tunnel, t, w, h, 1);
    const frac = litN(f) / f.glyphs.length;
    assert.ok(frac > 0.2 && frac < 0.8, `${w}x${h} t=${t}: ${(frac * 100).toFixed(1)}%`);
  }
});

test('H tunnel: smooth motion: consecutive 1/18 s frames differ in under 25% of cells (and it does move)', () => {
  for (const [w, h] of [[120, 40], [240, 67]]) {
    let worst = 0, total = 0, n = 0;
    let prev = renderScene(tunnel, 0, w, h, 1).glyphs.slice();
    for (let k = 1; k <= 18 * 20; k++) {
      const g = renderScene(tunnel, k / FPS, w, h, 1).glyphs;
      let d = 0;
      for (let i = 0; i < g.length; i++) if (g[i] !== prev[i]) d++;
      worst = Math.max(worst, d / g.length); total += d / g.length; n++;
      prev = g.slice();
    }
    assert.ok(worst < 0.25, `${w}x${h}: worst ${(worst * 100).toFixed(1)}%`);
    assert.ok(total / n > 0.01, `${w}x${h}: mean change ${(100 * total / n).toFixed(2)}% (it must move)`);
  }
});

// ---------------------------------------------------------------- I: blocktype
test('I blockfont: every letter of every word has a glyph of 5 columns by 7 rows (5+ rows tall), made of # and space only', () => {
  assert.ok(GLYPH_H >= 5 && GLYPH_W >= 3);
  assert.ok(BLOCK_WORDS.length >= 8 && BLOCK_WORDS.includes('DRIFT') && BLOCK_WORDS.includes('HELLO'));
  for (const w of BLOCK_WORDS) {
    assert.match(w, /^[A-Z]+$/);
    for (const ch of w) {
      const g = FONT[ch];
      assert.ok(g, `font lacks ${ch} (word ${w})`);
      assert.equal(g.length, GLYPH_H, ch);
      for (const row of g) { assert.equal(row.length, GLYPH_W, ch); assert.match(row, /^[# ]+$/, ch); }
      assert.ok(g.join('').includes('#'), ch);
    }
  }
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') assert.ok(FONT[ch], `font lacks ${ch}`);
  // a letter must differ from every other letter
  const keys = Object.keys(FONT);
  assert.equal(new Set(keys.map((k) => FONT[k].join('|'))).size, keys.length, 'two letters share a bitmap');
});

test('I blocktype: every non-space glyph is one of the half and full blocks, at all times and sizes', () => {
  for (const [w, h] of [[120, 40], [240, 67], [30, 10], [3, 2]]) for (const t of [0, 2, 4.1, 4.5, 5, 9.7, 23]) {
    for (const g of renderScene(blocktype, t, w, h, 1).glyphs) assert.ok(g === 32 || g === 0x2580 || g === 0x2584 || g === 0x2588, `U+${g.toString(16)}`);
  }
});

// Rebuild the text rows of a word from the FONT alone (scale s, parity p = pixel rows of padding above)
function expectedRows(word, s, parity) {
  const px = [];
  for (let r = 0; r < GLYPH_H; r++) {
    let line = '';
    for (const ch of word) line += FONT[ch][r].replace(/#/g, '1').replace(/ /g, '0') + '0';
    line = line.slice(0, -1);
    const wide = line.split('').map((c) => c.repeat(s)).join('');
    for (let k = 0; k < s; k++) px.push(wide);
  }
  if (parity) px.unshift('0'.repeat(px[0].length));
  if (px.length % 2) px.push('0'.repeat(px[0].length));
  const out = [];
  for (let r = 0; r < px.length; r += 2) {
    let line = '';
    for (let x = 0; x < px[0].length; x++) {
      const a = px[r][x] === '1', b = px[r + 1][x] === '1';
      line += a && b ? '█' : a ? '▀' : b ? '▄' : ' ';
    }
    out.push(line);
  }
  return out;
}
function findWord(f, word) {
  const lines = frameLines(f);
  for (let s = 1; s <= 14; s++) for (const parity of [0, 1]) {
    const exp = expectedRows(word, s, parity);
    for (let y = 0; y + exp.length <= lines.length; y++) {
      const x = lines[y].indexOf(exp[0]);
      if (x < 0) continue;
      if (exp.every((e, k) => lines[y + k].substr(x, e.length) === e)) return { s, parity, x, y, rows: exp.length };
    }
  }
  return null;
}

test('I blocktype: at a pinned t a whole word is legible (its font bitmap appears contiguously in the frame); mid-transition it is not', () => {
  // seed 1: the word of slot k is BLOCK_WORDS[(k + 1) % n]; find the slot that spells DRIFT
  const n = BLOCK_WORDS.length, want = BLOCK_WORDS.indexOf('DRIFT');
  const k = [...Array(n).keys()].find((i) => wordIndexAt(i * SLOT_SECONDS, 1) === want);
  assert.notEqual(k, undefined);
  const tHold = k * SLOT_SECONDS + 1.5;
  const hit = findWord(renderScene(blocktype, tHold, 120, 40, 1), 'DRIFT');
  assert.ok(hit, 'DRIFT bitmap found at the hold');
  assert.ok(hit.rows >= 5, 'letters span 5+ half-block rows at least');
  assert.ok(hit.s >= 2, 'big: scale ' + hit.s);
  // the same slot at the middle of its transition: the word is no longer whole on screen
  const tMid = (k + 1) * SLOT_SECONDS - TRANSITION_SECONDS / 2;
  assert.equal(findWord(renderScene(blocktype, tMid, 120, 40, 1), 'DRIFT'), null, 'broken up mid transition');
  // pinned: HELLO is legible at the hold of its slot too, and at a bigger screen
  const kh = [...Array(n).keys()].find((i) => wordIndexAt(i * SLOT_SECONDS, 1) === BLOCK_WORDS.indexOf('HELLO'));
  assert.ok(findWord(renderScene(blocktype, kh * SLOT_SECONDS + 1.5, 240, 67, 1), 'HELLO'));
  assert.ok(findWord(renderScene(blocktype, kh * SLOT_SECONDS + 1.5, 120, 40, 1), 'HELLO'));
  // negative control: the matcher does not find a word that is not there
  assert.equal(findWord(renderScene(blocktype, tHold, 120, 40, 1), 'GLOW'), null);
});

test('I blocktype: all three transitions occur (wipe, scroll, wave) and a different seed spells different words', () => {
  const kinds = new Set();
  for (let k = 0; k < 6; k++) {
    const a = renderScene(blocktype, (k + 1) * SLOT_SECONDS - TRANSITION_SECONDS / 2, 120, 40, 1);
    const b = renderScene(blocktype, k * SLOT_SECONDS + 1, 120, 40, 1);
    assert.notDeepEqual(Array.from(a.glyphs), Array.from(b.glyphs));
    kinds.add(k % 3);
  }
  assert.equal(kinds.size, 3);
  assert.notEqual(wordIndexAt(10, 1), wordIndexAt(10, 2));
});

// ---------------------------------------------------------------- J: maze
function bfsCount(m) {
  const adj = Array.from({ length: m.n }, () => []);
  for (const [a, b] of m.edges) { adj[a].push(b); adj[b].push(a); }
  const seen = new Uint8Array(m.n);
  const stack = [0];
  seen[0] = 1;
  let c = 0;
  while (stack.length) { const v = stack.pop(); c++; for (const u of adj[v]) if (!seen[u]) { seen[u] = 1; stack.push(u); } }
  return c;
}

test('J maze generator: a spanning tree (BFS reaches all w*h cells, exactly cells-1 edges, all edges between neighbours, no repeats)', () => {
  for (const [cw, ch, seed] of [[10, 8, 1], [59, 19, 1], [119, 33, 4], [1, 1, 1], [1, 9, 2], [9, 1, 3], [2, 2, 5]]) {
    const m = generateMaze(cw, ch, seed);
    assert.equal(m.n, cw * ch);
    assert.equal(m.edges.length, cw * ch - 1, `${cw}x${ch} edges`);
    assert.equal(bfsCount(m), cw * ch, `${cw}x${ch} reachable from cell 0`);
    const seen = new Set();
    for (const [a, b] of m.edges) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      assert.ok(hi - lo === 1 && Math.floor(lo / cw) === Math.floor(hi / cw) || hi - lo === cw, `edge ${a}-${b} joins non-neighbours`);
      assert.ok(!seen.has(lo + ',' + hi)); seen.add(lo + ',' + hi);
    }
    assert.equal(m.order.length, cw * ch);
    assert.equal(new Set(m.order).size, cw * ch, 'every cell carved once');
    assert.equal(m.order[0], 0);
  }
  assert.equal(generateMaze(0, 5, 1).n, 0);
});

test('J maze generator: same seed -> same maze; different seed -> different maze', () => {
  const a = generateMaze(30, 12, 7), b = generateMaze(30, 12, 7), c = generateMaze(30, 12, 8);
  assert.deepEqual(a.edges, b.edges);
  assert.deepEqual(a.order, b.order);
  assert.notDeepEqual(a.edges, c.edges);
});

function until(s, pred, max = 30 * 120) {
  let i = 0;
  while (!pred(s) && i++ < max) maze.step(s);
  assert.ok(pred(s), `condition not reached within ${max} steps (phase ${s.phase})`);
}
function drawMaze(s) {
  const p = { glyphs: new Uint16Array(s.w * s.h), colours: new Uint8Array(s.w * s.h) };
  maze.draw(s, p);
  return { ...p, cols: s.w, rows: s.h };
}

test('J maze: drawn progressively (lit cells at the start < mid-carve < complete), then solved, held and regenerated as a different maze', () => {
  const s = maze.init(120, 40, 1);
  maze.step(s);
  const start = litN(drawMaze(s));
  until(s, (st) => st.carved >= st.maze.n / 2);
  const mid = litN(drawMaze(s));
  until(s, (st) => st.phase !== 'carve');
  const done = litN(drawMaze(s));
  assert.ok(start > 0 && start < mid && mid < done, `lit ${start} < ${mid} < ${done}`);
  assert.ok(done > 120 * 40 * 0.15 && done < 120 * 40 * 0.8, `complete maze fills ${done} cells`);

  // at completion every drawn glyph is a box-drawing or block glyph
  until(s, (st) => st.phase === 'hold');
  const f1 = drawMaze(s);
  const kinds = new Set();
  for (const g of f1.glyphs) { if (g !== 32) { assert.ok(g >= 0x2500 && g <= 0x259f, `U+${g.toString(16)} is not box-drawing or a block`); kinds.add(g); } }
  assert.ok([...kinds].filter((g) => g < 0x2580).length >= 4, 'several box-drawing shapes');

  // the solution: a path of cells from the first to the last, each step a real passage, drawn in solid blocks
  assert.equal(s.path[0], 0);
  assert.equal(s.path.at(-1), s.maze.n - 1);
  const edge = new Set(s.maze.edges.map(([a, b]) => Math.min(a, b) + ',' + Math.max(a, b)));
  for (let i = 1; i < s.path.length; i++) assert.ok(edge.has(Math.min(s.path[i - 1], s.path[i]) + ',' + Math.max(s.path[i - 1], s.path[i])), `path step ${i}`);
  assert.equal(f1.glyphs.reduce((n, g) => n + (g === 0x2588 ? 1 : 0), 0), 2 * s.path.length - 1, 'one block per path cell and per passage between them');

  // held: nothing moves
  for (let i = 0; i < 10; i++) maze.step(s);
  assert.deepEqual(Array.from(drawMaze(s).glyphs), Array.from(f1.glyphs));

  // regenerates: a different maze, and a different complete frame
  const edges0 = JSON.stringify(s.maze.edges), cycle0 = s.cycle;
  until(s, (st) => st.cycle === cycle0 + 1 && st.phase === 'hold');
  assert.notEqual(JSON.stringify(s.maze.edges), edges0, 'the next cycle is a different maze');
  assert.notDeepEqual(Array.from(drawMaze(s).glyphs), Array.from(f1.glyphs));
  assert.equal(bfsCount(s.maze), s.maze.n);
});

test('J maze: the erase between mazes is gradual (no frame changes more than 15% of the cells) and the whole 60 s run keeps going', () => {
  const s = maze.init(120, 40, 2);
  let prev = null, worst = 0, phases = new Set();
  for (let k = 0; k < 30 * 60; k++) {
    maze.step(s);
    phases.add(s.phase);
    if (k % 2 === 1) { // 15 fps-ish samples
      const g = drawMaze(s).glyphs;
      if (prev) { let d = 0; for (let i = 0; i < g.length; i++) if ((g[i] !== 32) !== (prev[i] !== 32)) d++; worst = Math.max(worst, d / g.length); }
      prev = g.slice();
    }
  }
  assert.deepEqual([...phases].sort(), ['carve', 'erase', 'hold', 'solve']);
  assert.ok(worst < 0.15, `worst ${(worst * 100).toFixed(1)}% of cells changed lit state in one frame`);
  assert.ok(s.cycle >= 2);
});

// ---------------------------------------------------------------- K: playlists, capture, app
const NEW = { chaos: ['swarm', 'glitch', 'fireworks', 'vortex'], contrast: ['tunnel', 'wire', 'maze', 'blocktype'] };

test('K playlists: at least 5 chaos and 5 contrast scenes, ids unique, findScene returns each new scene mode and index', () => {
  assert.ok(PLAYLISTS.chaos.length >= 5 && PLAYLISTS.contrast.length >= 5);
  assert.equal(new Set(allSceneIds()).size, allSceneIds().length);
  for (const [mode, ids] of Object.entries(NEW)) for (const id of ids) {
    const index = PLAYLISTS[mode].findIndex((s) => s.id === id);
    assert.ok(index > 0, id);
    assert.deepEqual(findScene(id), { mode, index });
    assert.deepEqual(findScene(id.toUpperCase()), { mode, index });
  }
});

test('K capture: runCaptureModes writes <mode>-<scene>-1.txt and -2.txt for every new scene at 120x40 with something drawn', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-cap2-'));
  runCaptureModes({ outDir: dir });
  for (const [mode, ids] of Object.entries(NEW)) for (const id of ids) {
    const texts = [1, 2].map((k) => fs.readFileSync(path.join(dir, `${mode}-${id}-${k}.txt`), 'utf8'));
    for (const t of texts) {
      const body = t.split('\n').slice(1);
      assert.equal(body.filter((l) => l.length === 120).length, 40, id);
      assert.ok(body.join('').replace(/ /g, '').length > 40, `${id}: not empty`);
    }
    assert.notEqual(texts[0], texts[1], id);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function mkApp(mode, startScene) {
  const stdin = fakeStdin(), stdout = fakeStdout({ columns: 120, rows: 40 }), stderr = fakeStderr(), proc = fakeProc();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-k-'));
  const app = createApp({
    stdin, stdout, stderr, proc, env: { COLORTERM: 'truecolor' }, configPath: path.join(dir, 'drift', 'config.json'),
    autoLoop: false, seed: 1, sceneSeconds: 1000, fadeSeconds: 4, startMode: mode, startScene,
  });
  return { app, stdin, stdout, stderr, proc, done: () => { app.quit(0); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('K app: space cycles through every scene of the chaos and contrast playlists, in order, wraps, and never throws', () => {
  for (const mode of ['chaos', 'contrast']) {
    const c = mkApp(mode, 0);
    c.app.start();
    const ids = PLAYLISTS[mode].map((s) => s.id), got = [c.app.getState().sceneId];
    for (let i = 0; i < ids.length; i++) {
      c.stdin.emit('data', ' ');
      for (let k = 0; k < 40; k++) c.app.tick(0.1);
      got.push(c.app.getState().sceneId);
    }
    assert.deepEqual(got, [...ids, ids[0]], mode);
    assert.equal(c.stderr.writes ? c.stderr.writes.join('') : '', '', 'no error output');
    c.done();
  }
});

test('K app: --scene <new id> starts in that scene and mode; h shows the scene name in the help panel', () => {
  for (const [mode, ids] of Object.entries(NEW)) for (const id of ids) {
    const o = parseOptions(['--scene', id], {});
    assert.equal(o.startMode, mode, id);
    assert.equal(o.startScene, PLAYLISTS[mode].findIndex((s) => s.id === id), id);
    const c = mkApp(mode, o.startScene);
    c.app.start();
    c.app.tick(0.2);
    assert.equal(c.app.getState().sceneId, id);
    c.stdin.emit('data', 'h');
    c.app.tick(0);
    assert.match(frameLines(c.app.screenshot()).join('\n'), new RegExp(`scene: ${id}`), id);
    c.done();
  }
  const help = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(help, /allSceneIds\(\)\.join/, '--help lists every scene id from the playlists');
});

test('K dissolve: the dissolve between every adjacent pair of new scenes stays under a quarter of the screen per frame', () => {
  for (const mode of ['chaos', 'contrast']) {
    const list = PLAYLISTS[mode];
    for (let i = 0; i < list.length; i++) {
      const cc = createCellComposer({ scenes: [list[i], list[(i + 1) % list.length]], cols: 120, rows: 40, seed: 1 });
      for (let k = 0; k < 3 * FPS; k++) cc.frame({ a: 0, b: 0, p: 0 }, k / FPS);
      let prev = null, worst = 0;
      for (let k = 0; k <= 2 * FPS; k++) {
        const g = cc.frame({ a: 0, b: 1, p: k / (2 * FPS) }, 3 + k / FPS).glyphs;
        if (prev) { let d = 0; for (let j = 0; j < g.length; j++) if ((g[j] !== 32) !== (prev[j] !== 32)) d++; worst = Math.max(worst, d / g.length); }
        prev = g.slice();
      }
      assert.ok(worst < 0.25, `${list[i].id} -> ${list[(i + 1) % list.length].id}: ${(worst * 100).toFixed(1)}%`);
    }
  }
});
