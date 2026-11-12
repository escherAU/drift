// DRIFT-7 C16: CORTEX (cartridges/driftman-9000/scenes/cortex.js): four panes of glass over the skin background, a braille icosahedron, a scrolling
// thought trace, a ring of 24 numerals and typed captions, parallax, hairline connectors with an ion pulse and a moving focus edge. The rest between the
// loud visions: under 5 % of the cells change in a frame. This file holds what is structural and fast: purity, layout at every size, parallax, the glass,
// each pane's own rule, the connectors, colour (red-safe, safeHue image, contrast), glyphs, sizes, change per frame, the look, the manifest and the loop
// order. The flash meter, 256 colours, CPU, bytes and the phase test are in driftman-9000-cortex-flash.test.js; the dissolves in
// driftman-9000-dissolve.test.js. Every measured bound is written next to the number it was set from ("measured").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { luminanceOf, glyphCoverage } from './helpers-flash.js';
import { RGB_CELL } from '../src/renderer.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { safeHue, safeHueExact, HUE_COLS, L_ROWS } from '../src/pixels.js';
import cortex, * as cx from '../cartridges/driftman-9000/scenes/cortex.js';
import rosette from '../cartridges/driftman-9000/scenes/rosette.js';
import bloomfall from '../cartridges/driftman-9000/scenes/bloomfall.js';

const { MIN_W, MIN_H, MESSAGE, BG, PANE_BG, EDGE, EDGE_FOCUS, LINK, CAPTIONS } = cx;
const FPS = 18;
const SENTINEL = 0x1ffffff;
const BANNED = ['∫', '≡', '◍', '◎', '◐', '◑', '◒', '◓', '◢', '◣'].map((c) => c.codePointAt(0));
function buffers(w, h) {
  const n = w * h;
  return { glyphs: new Uint16Array(n).fill(0x7e), colours: new Uint8Array(n).fill(7), fg: new Uint32Array(n).fill(SENTINEL), bg: new Uint32Array(n).fill(SENTINEL) };
}
function draw(scene, t, w, h, seed = 1, t0 = 0, params = null) {
  const p = params || buffers(w, h);
  p.seed = seed; p.t0 = t0;
  scene(t, w, h, p);
  return p;
}
const snap = (p) => ({ g: p.glyphs.slice(), fg: p.fg.slice(), bg: p.bg.slice() });
const SIZES = [[60, 20], [61, 21], [78, 24], [80, 24], [88, 39], [100, 30], [120, 40], [176, 58], [240, 67], [400, 120]];
const ALL_SIZES_SMALL = [[60, 20], [80, 24], [120, 40], [240, 67]];

// the image of safeHue: every colour it can return, at any lightness row
const IMAGE = new Set();
for (let r = 0; r < L_ROWS; r++) for (let h = 0; h < HUE_COLS; h++) IMAGE.add(safeHueExact(h, r / (L_ROWS - 1)));
const CONSTANTS = new Set([BG, PANE_BG, EDGE, EDGE_FOCUS, LINK, 0x5a6a94]);
const layouts = new Map();
const layoutOf = (w, h) => { const k = w + 'x' + h; let L = layouts.get(k); if (!L) { L = cx.computeLayout(w, h); layouts.set(k, L); } return L; };
const contentOf = (w, h, i) => layoutOf(w, h).content[i];
// the pane whose glass covers the cell at T (the rows of a pane ripple, so this goes row by row), or -1
const paneAt = (w, h, T, x, y) => {
  const L = layoutOf(w, h);
  for (let i = 0; i < 4; i++) {
    const P = L.panes[i], row = y - P.y;
    if (row < 0 || row >= P.h) continue;
    const px = P.x + cx.paneRowOffset(i, row, P.h, T);
    if (x >= px && x < px + P.w) return i;
  }
  return -1;
};

// ---- 1. pure in (seed, t - t0)

test('cortex purity: the same (seed, t - t0) gives the same frame at any t0 and after calls for other sizes, seeds and times; another seed and another time differ', () => {
  const a = snap(draw(cortex, 12.5, 100, 30, 1, 0));
  const eq = (b) => assert.deepEqual([...b.fg], [...a.fg]) || assert.deepEqual([...b.bg], [...a.bg]) || assert.deepEqual([...b.g], [...a.g]);
  eq(snap(draw(cortex, 12.5, 100, 30, 1, 0)));
  eq(snap(draw(cortex, 22.5, 100, 30, 1, 10)));
  draw(cortex, 3, 120, 40, 7, 0); draw(cortex, 99, 80, 24, 2, 0); draw(cortex, 4, 61, 21, 1, 0); draw(cortex, 400, 100, 30, 1, 0);
  eq(snap(draw(cortex, 12.5, 100, 30, 1, 0)));
  const same = (b) => b.fg.every((v, i) => v === a.fg[i]) && b.bg.every((v, i) => v === a.bg[i]) && b.g.every((v, i) => v === a.g[i]);
  assert.ok(!same(snap(draw(cortex, 12.5, 100, 30, 2, 0))), 'another seed differs');
  assert.ok(!same(snap(draw(cortex, 14.5, 100, 30, 1, 0))), 'another time differs');
  assert.deepEqual([...snap(draw(cortex, 3, 100, 30, 1, 10)).fg], [...snap(draw(cortex, 0, 100, 30, 1, 0)).fg], 't before t0 is scene time 0');
});

test('cortex purity: going backwards in time gives the frames it gave going forwards (captions, ring and pulses are functions of the clock, not state)', () => {
  const fwd = [];
  for (let k = 0; k <= 40; k++) fwd.push(snap(draw(cortex, k * 3.1, 100, 30, 5)));
  for (let k = 40; k >= 0; k--) {
    const b = snap(draw(cortex, k * 3.1, 100, 30, 5));
    assert.deepEqual([...b.fg], [...fwd[k].fg], `t=${k * 3.1}`);
    assert.deepEqual([...b.g], [...fwd[k].g]);
    assert.deepEqual([...b.bg], [...fwd[k].bg]);
  }
});

// ---- 2. the layout at every size

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('cortex layout: at every size the four panes, at their furthest parallax in either direction, are on the screen, never overlap, leave at least 4 columns or 2 rows for a connector, and have room for their content', () => {
  for (const [w, h] of SIZES) {
    const L = cx.computeLayout(w, h);
    assert.equal(L.panes.length, 4);
    for (let i = 0; i < 4; i++) {
      const p = L.panes[i];
      for (const dx of [-2, 0, 2]) {
        const r = { x: p.x + dx, y: p.y, w: p.w, h: p.h };
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h, `${w}x${h} pane ${p.id} at dx ${dx}: ${JSON.stringify(r)}`);
      }
    }
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      for (const di of [-2, 2]) for (const dj of [-2, 2]) {
        const a = { ...L.panes[i], x: L.panes[i].x + di }, b = { ...L.panes[j], x: L.panes[j].x + dj };
        assert.ok(!overlap(a, b), `${w}x${h}: panes ${a.id} and ${b.id} overlap at ${di},${dj}`);
      }
    }
    const [A, B, C, D] = L.panes;
    // A-B and C-D side by side, A-C and B-D one above the other: the gaps are the connectors' room (parallax takes 4 columns of an 8 column gap)
    assert.ok(B.x - (A.x + A.w) - 4 >= 4, `${w}x${h}: A-B gap`); assert.ok(D.x - (C.x + C.w) - 4 >= 4, `${w}x${h}: C-D gap`);
    assert.ok(C.y - (A.y + A.h) >= 3 && D.y - (B.y + B.h) >= 3, `${w}x${h}: vertical gaps`);
    const [kA, kB, kC, kD] = L.content;
    assert.ok(kA.w >= 12 && kA.h >= 4, `${w}x${h}: A content ${kA.w}x${kA.h}`);
    assert.ok(kB.w >= 12 && kB.h >= 4, `${w}x${h}: B content`);
    assert.ok(kC.w >= 13 && kC.h >= 3, `${w}x${h}: C content ${kC.w}x${kC.h}`);
    assert.ok(kD.h >= 3, `${w}x${h}: D content rows ${kD.h}`);
    // the glass covers its content however far it has slid: the content keeps INSET columns clear of the border on each side
    for (let i = 0; i < 4; i++) { const P = L.panes[i], k = L.content[i]; assert.ok(k.x - (P.x + 1) >= 2 && (P.x + P.w - 1) - (k.x + k.w) >= 2 && k.y === P.y + 1 && k.h === P.h - 2, `${w}x${h}: content ${i}`); }
    assert.ok(w <= cx.MAX_W || (A.x >= (w - cx.MAX_W) / 2 - 1), `${w}x${h}: composition is centred`);
    const c = cx.cacheFor(w, h);
    for (const wr of c.wraps) assert.ok(wr.lines <= kD.h, `${w}x${h}: a caption wraps to ${wr.lines} lines in ${kD.h} rows`);
    // the captions fit the text width after wrapping
    for (const s of CAPTIONS) {
      const words = s.split(' ');
      for (const word of words) assert.ok(word.length <= L.textW, `${w}x${h}: ${word} in ${L.textW}`);
    }
  }
});

test('cortex layout: the composition is at most 132 x 44 cells, centred (so a bigger screen costs no more cells to change), and grows with the screen below that', () => {
  const small = cx.computeLayout(80, 24), mid = cx.computeLayout(120, 40), big = cx.computeLayout(240, 67), huge = cx.computeLayout(400, 120);
  assert.equal(big.panes[0].w, huge.panes[0].w); assert.equal(big.panes[2].h, huge.panes[2].h);
  assert.ok(mid.panes[0].w > small.panes[0].w && mid.panes[3].w > small.panes[3].w);
  const right = (L) => L.panes[1].x + L.panes[1].w, left = (L) => L.panes[0].x;
  assert.ok(Math.abs(left(big) - (240 - right(big))) <= 1, 'centred at 240x67');
  assert.ok(Math.abs(left(huge) - (400 - right(huge))) <= 1, 'centred at 400x120');
});

test('cortex ring cells: 24 distinct cells inside the pane at every size, in order round the ellipse starting at the top, the same every time', () => {
  for (const [w, h] of SIZES) {
    const L = cx.computeLayout(w, h), iw = L.content[2].w, ih = L.content[2].h;
    assert.equal(L.ring.length, 24);
    const seen = new Set();
    for (const [x, y] of L.ring) { assert.ok(x >= 0 && x < iw && y >= 0 && y < ih, `${w}x${h}: ${x},${y} outside ${iw}x${ih}`); seen.add(y * iw + x); }
    assert.equal(seen.size, 24, `${w}x${h}: 24 distinct cells`);
    assert.deepEqual(cx.computeLayout(w, h).ring, L.ring);
    assert.ok(L.ring[0][1] <= 1, `${w}x${h}: slot 0 is at the top`);
    // clockwise: slot 6 is on the right half, slot 12 at the bottom, slot 18 on the left half
    assert.ok(L.ring[6][0] > iw / 2 && L.ring[18][0] < iw / 2 && L.ring[12][1] >= ih - 2, `${w}x${h}: clockwise`);
  }
  // a control that the distinctness check bites: the raw rounded ellipse collides in a tiny interior
  const raw = new Set();
  for (let i = 0; i < 24; i++) { const th = (Math.PI * 2 * i) / 24; raw.add(Math.round(1 + 1 * Math.sin(th)) * 17 + Math.round(8 + 7 * Math.cos(th))); }
  assert.ok(raw.size < 24, 'the unnudged ellipse in a 17x3 interior has collisions');
});

// ---- 3. parallax

test('cortex parallax: x_p = x0 + round(2 sin(0.05 t + phase_p)); each pane reaches both ends (-2 and +2) over 126 s and never goes past them; the phases differ', () => {
  assert.equal(cx.PARALLAX_AMP, 2); assert.equal(cx.PARALLAX_RATE, 0.05);
  assert.equal(new Set(cx.PARALLAX_PHASE).size, 4);
  for (let i = 0; i < 4; i++) {
    let lo = 9, hi = -9;
    for (let t = 0; t <= 126; t += 0.25) {
      const o = cx.offsetOf(i, t);
      assert.equal(o, Math.round(2 * Math.sin(0.05 * t + cx.PARALLAX_PHASE[i])));
      assert.ok(Math.abs(cx.parallaxExact(i, t)) <= 2 + 1e-12);
      lo = Math.min(lo, o); hi = Math.max(hi, o);
    }
    assert.equal(lo, -2); assert.equal(hi, 2);
  }
});

test('cortex parallax as drawn: row r of a pane (0 = its top border) starts at its base x plus its offset RIPPLE r/(h-1) seconds late; the corners and sides are where that puts them; the content does not move', () => {
  const w = 120, h = 40, L = cx.computeLayout(w, h);
  for (const T of [0, 9, 20, 33, 47, 61, 80, 101, 124, 17.1, 17.3, 17.5]) {
    const p = draw(cortex, T, w, h, 1);
    for (let i = 0; i < 4; i++) {
      const P = L.panes[i];
      for (let row = 0; row < P.h; row++) {
        const x = P.x + cx.offsetOf(i, T - (cx.RIPPLE * row) / (P.h - 1));
        assert.equal(cx.paneRowX(w, h, i, row, T), x);
        const left = p.glyphs[(P.y + row) * w + x], right = p.glyphs[(P.y + row) * w + x + P.w - 1];
        if (row === 0) { assert.equal(left, 0x256d, `T=${T} pane ${i} top left`); assert.equal(right, 0x256e); }
        else if (row === P.h - 1) { assert.equal(left, 0x2570, `T=${T} pane ${i} bottom left`); assert.equal(right, 0x256f); }
        else { assert.equal(left, 0x2502, `T=${T} pane ${i} row ${row} left side`); assert.equal(right, 0x2502); }
      }
    }
  }
  assert.equal(cx.RIPPLE, 0.6);
});

test('cortex parallax ripple: a one-column step runs down the glass top to bottom over 0.6 s (two straight pieces, never more than one column apart), and no frame changes more than a few rows of a pane', () => {
  const w = 120, h = 40, L = cx.computeLayout(w, h);
  let steps = 0;
  for (let i = 0; i < 4; i++) {
    const P = L.panes[i];
    for (let T = 1; T < 126; T += 1 / 18) {
      const offs = [];
      for (let row = 0; row < P.h; row++) offs.push(cx.paneRowOffset(i, row, P.h, T));
      let changes = 0;
      for (let row = 1; row < P.h; row++) if (offs[row] !== offs[row - 1]) { changes++; assert.ok(Math.abs(offs[row] - offs[row - 1]) <= 1); }
      assert.ok(changes <= 1, `pane ${i} T=${T}: ${changes} breaks`);
      if (changes === 1) { steps++; assert.ok(offs[0] !== offs[P.h - 1], 'the top has moved and the bottom has not yet'); }
    }
    // a step takes RIPPLE seconds from top to bottom
    for (let T = 0; T < 125.7; T += 0.01) {
      const a = cx.offsetOf(i, T), b = cx.offsetOf(i, T + 0.01);
      if (a !== b) { assert.equal(cx.paneRowOffset(i, 0, P.h, T + 0.01), b); assert.equal(cx.paneRowOffset(i, P.h - 1, P.h, T + 0.01), a); assert.equal(cx.paneRowOffset(i, P.h - 1, P.h, T + 0.01 + cx.RIPPLE), b); }
    }
  }
  assert.ok(steps > 100, `${steps} frames caught mid-ripple`);
});

// ---- 4. the glass: full-colour #0E1426 inside the panes only

test('cortex glass: every cell inside a pane has the background #0E1426 (full colour), every cell outside has the skin background #05060C, in every frame; pane borders are the edge colour or the focus edge colour', () => {
  assert.equal(PANE_BG, 0x0e1426); assert.equal(EDGE, 0x4a6ab0); assert.equal(BG, 0x05060c);
  for (const [w, h] of ALL_SIZES_SMALL) {
    const p = buffers(w, h);
    for (const T of [0, 1.7, 5, 9.2, 17, 29.5, 63, 90.3]) {
      draw(cortex, T, w, h, 1, 0, p);
      let inside = 0, outside = 0;
      const Lw = layoutOf(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        assert.equal(p.colours[i], RGB_CELL);
        const pane = paneAt(w, h, T, x, y);
        if (pane >= 0) {
          inside++;
          assert.equal(p.bg[i], PANE_BG, `${w}x${h} T=${T} (${x},${y}) inside pane ${pane}`);
          const P = Lw.panes[pane], px = P.x + cx.paneRowOffset(pane, y - P.y, P.h, T);
          const onBorder = x === px || x === px + P.w - 1 || y === P.y || y === P.y + P.h - 1;
          if (onBorder) assert.ok(p.fg[i] === EDGE || p.fg[i] === EDGE_FOCUS, `border colour ${p.fg[i].toString(16)}`);
        } else {
          outside++;
          assert.equal(p.bg[i], BG, `${w}x${h} T=${T} (${x},${y}) outside the panes`);
        }
      }
      assert.ok(inside > 0.15 * w * h && outside > 0.2 * w * h, `${w}x${h}: ${inside} inside, ${outside} outside`);
    }
  }
});

// ---- 5. pane A: the icosahedron

test('cortex icosahedron: 12 vertices on the unit sphere, 30 edges of equal length, 5 edges at every vertex, 20 triangular faces', () => {
  assert.equal(cx.ICO_V.length, 12); assert.equal(cx.ICO_E.length, 30);
  for (const v of cx.ICO_V) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-12);
  const len = (e) => Math.hypot(...cx.ICO_V[e[0]].map((c, k) => c - cx.ICO_V[e[1]][k]));
  for (const e of cx.ICO_E) assert.ok(Math.abs(len(e) - len(cx.ICO_E[0])) < 1e-12);
  const deg = new Array(12).fill(0);
  for (const [a, b] of cx.ICO_E) { deg[a]++; deg[b]++; }
  assert.deepEqual(deg, new Array(12).fill(5));
  const adj = new Set(cx.ICO_E.map(([a, b]) => `${a}-${b}`));
  let faces = 0;
  for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) for (let c = b + 1; c < 12; c++) if (adj.has(`${a}-${b}`) && adj.has(`${b}-${c}`) && adj.has(`${a}-${c}`)) faces++;
  assert.equal(faces, 20);
});

test('cortex icosahedron: it turns 0.3 rad/s about the vertical axis (a quarter of a turn in 5.24 s), with the fixed tilt kept, whatever the seed', () => {
  assert.equal(cx.ICO_RATE, 0.3);
  const a = new Float64Array(36), b = new Float64Array(36);
  const untilt = (o, i) => { const ct = Math.cos(cx.ICO_TILT), st = Math.sin(cx.ICO_TILT); const y = o[3 * i + 1], z = o[3 * i + 2]; return [o[3 * i], ct * y + st * z, -st * y + ct * z]; };
  for (const seed of [1, 2, 9]) {
    for (const T of [0, 3.3, 41]) {
      cx.rotateIcosa(seed, T, a); cx.rotateIcosa(seed, T + 1, b);
      for (let i = 0; i < 12; i++) {
        const p = untilt(a, i), q = untilt(b, i);
        const d = Math.atan2(q[2], q[0]) - Math.atan2(p[2], p[0]);
        const wrapped = ((d % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        assert.ok(Math.abs(wrapped - -0.3) < 1e-9 || Math.abs(wrapped - 0.3) < 1e-9, `seed ${seed} T ${T} v${i}: ${wrapped}`);
        assert.ok(Math.abs(p[1] - cx.ICO_V[i][1]) < 1e-12, 'the vertical axis is the axis');
        assert.ok(Math.abs(Math.hypot(a[3 * i], a[3 * i + 1], a[3 * i + 2]) - 1) < 1e-12);
      }
    }
  }
  // the sign is one and the same for every vertex
  cx.rotateIcosa(1, 0, a); cx.rotateIcosa(1, 1, b);
  const ds = [];
  for (let i = 0; i < 12; i++) { const p = untilt(a, i), q = untilt(b, i); ds.push(Math.sign(Math.atan2(q[2], q[0]) - Math.atan2(p[2], p[0]))); }
  assert.ok(ds.every((s) => s === ds[0]));
});

test('cortex icosahedron: one hue per edge (30 distinct hues, at least 9 degrees apart), drifting 4 degrees a second in 3 degree steps', () => {
  const hs = [];
  for (let e = 0; e < 30; e++) hs.push(((cx.edgeHue(1, e, 0) % 360) + 360) % 360);
  const sorted = hs.slice().sort((a, b) => a - b);
  let gap = 360 + sorted[0] - sorted[29];
  for (let i = 1; i < 30; i++) gap = Math.min(gap, sorted[i] - sorted[i - 1]);
  assert.ok(gap >= 9, `closest two hues ${gap}`);
  // drifting 4 degrees a second, in steps of 3: over 30 s it moves 120 degrees (within one step)
  for (let e = 0; e < 30; e += 7) { assert.ok(Math.abs(cx.edgeHue(3, e, 30) - cx.edgeHue(3, e, 0) - 120) <= 3 + 1e-9); assert.equal(cx.edgeHue(3, e, 4.2) % 3, 0); }
  assert.equal(cx.ICO_HUE_RATE, 4);
});

test('cortex icosahedron as drawn: braille only inside pane A, many different colours at once (one hue per edge), and the figure moves from frame to frame', () => {
  const w = 120, h = 40, L = cx.computeLayout(w, h);
  for (const T of [2, 11.7, 30]) {
    const p = draw(cortex, T, w, h, 1), r = contentOf(w, h, 0);
    const colours = new Set();
    let braille = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * w + x, g = p.glyphs[i];
      assert.ok(g === 32 || (g >= 0x2801 && g <= 0x28ff), `pane A holds ${g.toString(16)}`);
      if (g !== 32) { braille++; colours.add(p.fg[i]); assert.ok(IMAGE.has(p.fg[i])); }
    }
    assert.ok(braille > 80, `${braille} braille cells`);
    assert.ok(colours.size >= 12, `${colours.size} colours`);
  }
  const a = draw(cortex, 4, w, h, 1), s = snap(a), b = draw(cortex, 4 + 1 / FPS, w, h, 1);
  let diff = 0;
  for (let i = 0; i < w * h; i++) if (b.glyphs[i] !== s.g[i]) diff++;
  assert.ok(diff > 3, `${diff} cells changed in one frame`);
  void L;
});

test('cortex icosahedron steps: it turns in steps of 1/6 s (0.05 rad), 6 steps make exactly 0.3 rad, and a step never falls in the same frame as a step of the thought trace (one every half second), at any of 8 clock phases over 60 s', () => {
  assert.equal(cx.ICO_STEPS, 6);
  const a = new Float64Array(36), b = new Float64Array(36);
  cx.rotateIcosa(1, 5.0 + 0.001, a); cx.rotateIcosa(1, 5.0 + 0.001 + 1 / 6, b);
  const ang = (o, i) => Math.atan2(o[3 * i + 2] * Math.cos(cx.ICO_TILT) - o[3 * i + 1] * Math.sin(cx.ICO_TILT), o[3 * i]);
  let d = ang(b, 0) - ang(a, 0); d = ((d + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  assert.ok(Math.abs(Math.abs(d) - 0.05) < 1e-9, `one step is ${d}`);
  let icoSteps = 0, traceSteps = 0;
  for (const ph of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
    for (let k = 1; k <= 60 * 18; k++) {
      const T0 = (k - 1 + ph) / 18, T1 = (k + ph) / 18;
      const ico = cx.icoStep(T1) !== cx.icoStep(T0), tr = cx.traceScroll(T1) !== cx.traceScroll(T0);
      if (ico) icoSteps++; if (tr) traceSteps++;
      assert.ok(!(ico && tr), `phase ${ph} frame ${k}: both step`);
    }
  }
  assert.ok(icoSteps >= 8 * 60 * 6 - 8 && icoSteps <= 8 * 60 * 6 + 8, `${icoSteps} figure steps`);
  assert.ok(traceSteps >= 8 * 60 * 2 - 8 && traceSteps <= 8 * 60 * 2 + 8, `${traceSteps} trace steps`);
});

// ---- 6. pane B: the thought trace

test('cortex trace: a sum of sines and seeded noise within -1..1 that is not flat, differs by seed, and scrolls 2 dots a second (floor(2 T) dots)', () => {
  assert.equal(cx.TRACE_SPEED, 2);
  for (const T of [0, 0.49, 0.5, 0.99, 1, 2.5, 10]) assert.equal(cx.traceScroll(T), Math.floor(2 * T));
  let lo = 9, hi = -9, sum = 0, n = 0;
  for (let u = 0; u < 3000; u++) { const v = cx.traceValue(1, u); assert.ok(v >= -1 && v <= 1); lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; n++; }
  assert.ok(lo < -0.5 && hi > 0.5, `${lo} ${hi}`);
  assert.ok(Math.abs(sum / n) < 0.2, `mean ${sum / n}`);
  let same = 0;
  for (let u = 0; u < 200; u++) if (cx.traceValue(1, u) === cx.traceValue(2, u)) same++;
  assert.ok(same < 5);
  let maxStep = 0;
  for (let u = 1; u < 3000; u++) maxStep = Math.max(maxStep, Math.abs(cx.traceValue(1, u) - cx.traceValue(1, u - 1)));
  assert.ok(maxStep < 0.35, `a smooth line: biggest step ${maxStep}`);
});

test('cortex trace as drawn: one second later the line is the same line one cell column (2 dots) to the left; it fills most of the pane width; braille only', () => {
  const w = 120, h = 40;
  for (const T of [3, 17.25, 40]) {
    const p = draw(cortex, T, w, h, 1), s = snap(p), q = draw(cortex, T + 1, w, h, 1);
    const r = contentOf(w, h, 1), iw = r.w;
    let match = 0, cells = 0, ink = 0;
    for (let y = 0; y < r.h; y++) for (let x = 1; x < iw - 1; x++) {
      const a = s.g[(r.y + y) * w + r.x + x + 1], b = q.glyphs[(r.y + y) * w + r.x + x];
      assert.ok(a === 32 || (a >= 0x2801 && a <= 0x28ff));
      if (a !== 32 || b !== 32) { cells++; if (a === b) match++; }
      if (a !== 32) ink++;
    }
    assert.ok(cells > 40 && match === cells, `T=${T}: ${match} of ${cells} cells moved exactly one column`);
    assert.ok(ink >= iw - 4, `${ink} inked cells in ${iw} columns`);
  }
});

// ---- 7. pane C: the ring of 24 numerals

const ringDigits = (p, w, h, T) => {
  const L = layoutOf(w, h), r = L.content[2], out = [];
  for (const [x, y] of L.ring) out.push(p.glyphs[(r.y + y) * w + r.x + x]);
  return out;
};

test('cortex ring: 24 numerals (digits only) in pane C at all times, nothing else in the pane interior', () => {
  for (const [w, h] of ALL_SIZES_SMALL) {
    for (const T of [0, 0.3, 4.4, 12.1, 50]) {
      const p = draw(cortex, T, w, h, 1), L = layoutOf(w, h), r = L.content[2];
      const ring = new Set(L.ring.map(([x, y]) => `${x},${y}`));
      let digits = 0;
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const g = p.glyphs[(r.y + y) * w + r.x + x];
        if (ring.has(`${x},${y}`)) { assert.ok(g >= 48 && g <= 57, `${w}x${h} T=${T} slot cell ${x},${y} holds ${g}`); digits++; } else assert.equal(g, 32);
      }
      assert.equal(digits, 24);
    }
  }
});

test('cortex ring: exactly one numeral re-rolls every 0.5 s (30 s, three sizes, three seeds), the slot goes round the ring in order, and a re-roll always changes the digit', () => {
  assert.equal(cx.ROLL, 0.5); assert.equal(cx.RING_N, 24);
  for (const [w, h] of [[120, 40], [80, 24], [240, 67]]) {
    for (const seed of [1, 2, 3]) {
      for (let n = 0; n < 60; n++) {
        const tEv = (n + 1) * 0.5;
        const before = ringDigits(draw(cortex, tEv - 0.03, w, h, seed), w, h, tEv - 0.03), after = ringDigits(draw(cortex, tEv + 0.03, w, h, seed), w, h, tEv + 0.03);
        const changed = [];
        for (let s = 0; s < 24; s++) if (before[s] !== after[s]) changed.push(s);
        assert.deepEqual(changed, [n % 24], `${w}x${h} seed ${seed} event ${n}`);
      }
      // no other time changes anything: two frames inside one half second give the same numerals
      for (const T0 of [0.1, 3.7, 20.2]) assert.deepEqual(ringDigits(draw(cortex, T0, w, h, seed), w, h, T0), ringDigits(draw(cortex, T0 + 0.25, w, h, seed), w, h, T0 + 0.25));
    }
  }
  assert.equal(cx.rollsDone(0.49), 0); assert.equal(cx.rollsDone(0.5), 1); assert.equal(cx.rollsDone(12), 24);
});

test('cortex ring values: seeded, all digits appear, rolls re-draw each slot every 12 s, the lit age counts from the roll', () => {
  const seen = new Set();
  for (let s = 0; s < 24; s++) for (let T = 0; T < 60; T += 0.5) seen.add(cx.ringValue(1, s, T));
  assert.equal(seen.size, 10);
  let diffSeeds = 0;
  for (let s = 0; s < 24; s++) if (cx.ringValue(1, s, 0) !== cx.ringValue(2, s, 0)) diffSeeds++;
  assert.ok(diffSeeds > 12);
  assert.equal(cx.rollsOfSlot(0, 0.49), 0); assert.equal(cx.rollsOfSlot(0, 0.5), 1); assert.equal(cx.rollsOfSlot(0, 12.5), 2); assert.equal(cx.rollsOfSlot(23, 12), 1);
  assert.ok(Math.abs(cx.rollAge(0, 0.5) - 0) < 1e-9 && Math.abs(cx.rollAge(0, 1.7) - 1.2) < 1e-9);
  assert.ok(cx.rollAge(5, 1.0) > 1e8, 'slot 5 has not rolled yet');
});

// ---- 8. pane D: the captions

test('cortex captions: exactly the five strings of the design, typed at 24 characters a second, held 4 s, erased at 48 a second, then 0.5 s of rest', () => {
  assert.deepEqual([...CAPTIONS], ['COMPOSING A COLOUR NO ONE HAS NAMED', 'RECALLING 0.318 OF A DREAM', 'FOLDING LIGHT ALONG ITS LONGEST AXIS', 'COUNTING THE STARS AGAIN. SAME NUMBER.', 'LISTENING. NOTHING YET. LISTENING.']);
  assert.equal(cx.TYPE_CPS, 24); assert.equal(cx.HOLD, 4); assert.equal(cx.ERASE_CPS, 48); assert.equal(cx.REST, 0.5);
  const o = { index: 0, text: '', n: 0, phase: '', start: 0 };
  for (const seed of [1, 2, 3, 77]) {
    for (let r = 0; r < 4; r++) {
      let t0 = r * cx.ROUND_SECONDS;
      for (const idx of cx.captionOrder(seed, r)) {
        const s = CAPTIONS[idx], dt = s.length / 24, de = s.length / 48;
        cx.captionState(seed, t0 + 0.001, o); assert.equal(o.index, idx); assert.equal(o.phase, 'type'); assert.equal(o.n, 0);
        cx.captionState(seed, t0 + 0.5, o); assert.equal(o.n, 12, `24 characters a second: 12 after 0.5 s (${s})`);
        cx.captionState(seed, t0 + 1.0, o); assert.equal(o.n, Math.min(s.length, 24));
        cx.captionState(seed, t0 + dt + 0.01, o); assert.equal(o.phase, 'hold'); assert.equal(o.n, s.length);
        cx.captionState(seed, t0 + dt + 3.99, o); assert.equal(o.phase, 'hold'); assert.equal(o.n, s.length, 'held a full 4 s');
        cx.captionState(seed, t0 + dt + 4.05, o); assert.equal(o.phase, 'erase'); assert.ok(o.n < s.length);
        cx.captionState(seed, t0 + dt + 4 + de * 0.5, o); assert.ok(Math.abs(o.n - s.length / 2) <= 1.5, `erase is 48 a second: ${o.n} of ${s.length}`);
        cx.captionState(seed, t0 + dt + 4 + de + 0.01, o); assert.equal(o.phase, 'rest'); assert.equal(o.n, 0);
        cx.captionState(seed, t0 + dt + 4 + de + 0.49, o); assert.equal(o.phase, 'rest');
        t0 += dt + 4 + de + 0.5;
      }
      assert.ok(Math.abs(t0 - (r + 1) * cx.ROUND_SECONDS) < 1e-9);
    }
  }
});

test('cortex captions order: a seeded shuffle, each of the five once per round, never the same caption twice in a row, different for different seeds, the same for the same seed', () => {
  const orders = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    let prevLast = -1;
    for (let r = 0; r < 200; r++) {
      const o = cx.captionOrder(seed, r);
      assert.deepEqual([...o].sort(), [0, 1, 2, 3, 4], `seed ${seed} round ${r}`);
      assert.notEqual(o[0], prevLast, `seed ${seed} round ${r}: ${o[0]} twice in a row`);
      prevLast = o[4];
      if (r === 0) orders.add(o.join(''));
    }
    assert.deepEqual([...cx.captionOrder(seed, 3)], [...cx.captionOrder(seed, 3)]);
  }
  assert.ok(orders.size >= 5, `${orders.size} different first rounds over 8 seeds`);
  let differ = 0;
  for (let r = 0; r < 100; r++) if (cx.captionOrder(1, r).join('') !== cx.captionOrder(1, r + 1).join('')) differ++;
  assert.ok(differ > 80, 'the order changes round to round');
  // all five orders of the first positions occur
  const first = new Set();
  for (let seed = 1; seed < 60; seed++) first.add(cx.captionOrder(seed, 0)[0]);
  assert.equal(first.size, 5);
});

// what pane D shows, lines joined with a space, and the cursor if it is there
function captionText(p, w, h, T) {
  const r = contentOf(w, h, 3), lines = [];
  let cursor = false;
  for (let y = 0; y < r.h; y++) {
    let line = '';
    for (let x = 0; x < r.w; x++) {
      const g = p.glyphs[(r.y + y) * w + r.x + x];
      if (g === 0x258c) { cursor = true; continue; }
      line += g === 32 ? ' ' : String.fromCodePoint(g);
    }
    if (line.trim() !== '') lines.push(line.trim());
  }
  return { text: lines.join(' '), lines, cursor };
}

test('cortex captions as drawn: pane D shows only a leading part of one of the five strings (wrapped at the pane width, never cut in a word), growing at 24 a second, in full during the hold, with the cursor after it', () => {
  for (const [w, h] of [[120, 40], [80, 24], [60, 20], [240, 67]]) {
    const o = { index: 0, text: '', n: 0, phase: '', start: 0 };
    const full = new Set();
    for (let T = 0; T < 2 * cx.ROUND_SECONDS; T += 0.173) {
      const p = draw(cortex, T, w, h, 1), got = captionText(p, w, h, T);
      cx.captionState(1, T, o);
      assert.equal(got.text, o.text.slice(0, o.n).trim(), `${w}x${h} T=${T.toFixed(2)} ${o.phase} n=${o.n}`);
      assert.ok(got.cursor, 'the cursor is always there');
      if (o.phase === 'hold') full.add(got.text);
      for (const line of got.lines) assert.ok(line.length <= layoutOf(w, h).textW, `${w}x${h}: line of ${line.length}`);
    }
    assert.deepEqual([...full].sort(), [...CAPTIONS].sort(), `${w}x${h}: every caption shows in full`);
  }
});

test('cortex captions as drawn: 24 characters a second on the screen itself (12 after 0.5 s, 24 after 1 s of a long caption)', () => {
  const w = 120, h = 40, o = { index: 0, text: '', n: 0, phase: '', start: 0 };
  const seed = 1, ord = cx.captionOrder(seed, 0);
  let t0 = 0;
  for (const idx of ord) {
    const s = CAPTIONS[idx];
    const at = (dt) => captionText(draw(cortex, t0 + dt, w, h, seed), w, h, t0 + dt).text.length;
    assert.ok(Math.abs(at(0.5) - 12) <= 1, `${s}: ${at(0.5)} after 0.5 s`);
    assert.ok(Math.abs(at(1.0) - Math.min(24, s.length)) <= 1);
    t0 += cx.captionSeconds(s);
  }
  void o;
});

// ---- 9. connectors, the ion pulse and the focus edge

test('cortex pulse: one every 3 s, running 2.4 s along one connector, the four connectors in turn, fading in and out (amplitude 0 at both ends, 1 in the middle)', () => {
  assert.equal(cx.PULSE_PERIOD, 3);
  const o = { k: 0, conn: 0, p: 0, amp: 0 };
  for (let k = 0; k < 12; k++) {
    cx.pulseState(3 * k + 0.001, o); assert.equal(o.k, k); assert.equal(o.conn, k % 4); assert.ok(o.p >= 0 && o.p < 0.01 && o.amp < 0.01);
    cx.pulseState(3 * k + 1.2, o); assert.ok(Math.abs(o.p - 0.5) < 1e-9 && Math.abs(o.amp - 1) < 1e-9);
    cx.pulseState(3 * k + 2.39, o); assert.ok(o.p > 0.99 && o.amp < 0.01);
    cx.pulseState(3 * k + 2.7, o); assert.equal(o.p, -1); assert.equal(o.amp, 0);
  }
  let prev = -1;
  for (let T = 0; T < 3; T += 0.01) { cx.pulseState(T, o); if (o.p >= 0) { assert.ok(o.p >= prev); prev = o.p; } }
});

test('cortex pulse as drawn: a single ion head (a diamond) on one connector at a time, one new pulse every 3 s, the head moves along its connector from end to end, on a different connector each time', () => {
  const w = 120, h = 40, heads = [];
  const L = cx.computeLayout(w, h);
  for (let k = 0; k < 8; k++) {
    const series = [];
    for (let T = 3 * k; T < 3 * k + 3; T += 1 / FPS) {
      const p = draw(cortex, T, w, h, 1);
      const cells = [];
      for (let i = 0; i < w * h; i++) if (p.glyphs[i] === 0x25c6) cells.push(i);
      assert.ok(cells.length <= 1, `T=${T}: ${cells.length} heads`);
      if (cells.length === 1) {
        const i = cells[0], x = i % w, y = Math.floor(i / w);
        assert.ok(IMAGE.has(p.fg[i]), 'ion colour through safeHue');
        assert.ok(paneAt(w, h, T, x, y) < 0, 'the head is on a connector, not on a pane');
        series.push([T, x, y]);
      }
    }
    assert.ok(series.length >= 0.6 * 2.4 * FPS, `pulse ${k}: ${series.length} frames with a head`);
    assert.ok(series[0][0] - 3 * k < 0.6 && 3 * k + 2.4 - series[series.length - 1][0] < 0.6, 'a pulse starts with its period and ends before the next');
    // monotone along the connector (Manhattan distance from the first cell never shrinks by much)
    const d = (a, b) => Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    let far = 0;
    for (const s of series) { const dd = d(series[0], s); assert.ok(dd >= far - 1, `pulse ${k}: the head goes back`); far = Math.max(far, dd); }
    assert.ok(far >= 3, `pulse ${k} travelled ${far} cells`);
    heads.push(series[0]);
  }
  // connectors differ: a pulse of 4 later starts at the same place as pulse k (within the parallax)
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(heads[k][1] - heads[k + 4][1]) <= 5 && Math.abs(heads[k][2] - heads[k + 4][2]) <= 2, `pulse ${k + 4} is on pulse ${k}'s connector`);
  const starts = new Set(heads.slice(0, 4).map((s) => `${Math.round(s[1] / 6)},${s[2]}`));
  assert.ok(starts.size >= 3, 'four connectors, four different places');
  void L;
});

test('cortex connectors: hairlines (dashes and rounded corners) join the panes in a ring A, B, D, C, outside every pane, in the link colour; each pane has two', () => {
  const w = 120, h = 40;
  for (const T of [0, 17, 40]) {
    const p = draw(cortex, T, w, h, 1);
    const glyphs = new Set();
    let n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (paneAt(w, h, T, x, y) >= 0) continue;
      const i = y * w + x, g = p.glyphs[i];
      if (g === 32) { assert.equal(p.bg[i], BG); continue; }
      n++; glyphs.add(g);
      assert.ok([0x254c, 0x254e, 0x256d, 0x256e, 0x2570, 0x256f, 0x25c6].includes(g), `outside the panes: ${g.toString(16)}`);
      if (g !== 0x25c6) assert.ok(p.fg[i] === LINK || IMAGE.has(p.fg[i]), 'link colour (or the pulse in ion)');
    }
    assert.ok(n >= 25, `${n} connector cells`);
    assert.ok(glyphs.has(0x254c) && glyphs.has(0x254e), 'dashes both ways');
    // every pane touches connector cells on at least two sides' worth of cells next to its border
    for (let i = 0; i < 4; i++) {
      const P = layoutOf(w, h).panes[i];
      let touching = 0;
      for (let y = P.y - 1; y <= P.y + P.h; y++) for (let x = P.x - 3; x <= P.x + P.w + 3; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h || paneAt(w, h, T, x, y) >= 0) continue;
        const g = p.glyphs[y * w + x];
        if (g !== 32 && Math.abs(x - (P.x + P.w / 2)) < P.w / 2 + 4) touching++;
      }
      assert.ok(touching >= 2, `pane ${i} touches ${touching} connector cells`);
    }
  }
});

test('cortex focus: the focus edge moves to the next pane of the ring (A, B, D, C) every 8 s', () => {
  assert.equal(cx.FOCUS_PERIOD, 8);
  const o = { f: 0, pane: 0, tau: 0, prev: -1 };
  const order = [];
  for (let n = 0; n < 9; n++) { cx.focusState(8 * n + 0.01, o); order.push(o.pane); assert.ok(Math.abs(o.tau - 0.01) < 1e-9); assert.equal(o.prev, n === 0 ? -1 : [0, 1, 3, 2][(n + 3) & 3]); }
  assert.deepEqual(order, [0, 1, 3, 2, 0, 1, 3, 2, 0]);
  cx.focusState(7.99, o); assert.equal(o.pane, 0);
});

// the border cells of pane i at T that are lit (focus colour)
const litBorder = (p, w, h, T, i) => {
  const P = layoutOf(w, h).panes[i];
  let lit = 0, total = 0;
  for (let row = 0; row < P.h; row++) {
    const x0 = P.x + cx.paneRowOffset(i, row, P.h, T);
    for (let x = x0; x < x0 + P.w; x++) {
      if (!(x === x0 || x === x0 + P.w - 1 || row === 0 || row === P.h - 1)) continue;
      total++; if (p.fg[(P.y + row) * w + x] === EDGE_FOCUS) lit++;
    }
  }
  return { lit, total };
};

test('cortex focus as drawn: once the 1 s sweep is done exactly one pane has its whole border lit and the other three none; the new pane sweeps on and the old one sweeps off together, a cell at a time', () => {
  for (const [w, h] of [[120, 40], [80, 24], [240, 67]]) {
    for (let n = 0; n < 9; n++) {
      const T = 8 * n + 3, pane = [0, 1, 3, 2][n & 3];
      const p = draw(cortex, T, w, h, 1);
      for (let i = 0; i < 4; i++) { const b = litBorder(p, w, h, T, i); assert.equal(b.lit, i === pane ? b.total : 0, `${w}x${h} T=${T} pane ${i}`); }
    }
    // mid-sweep: about half of each border is lit
    for (const n of [1, 2, 5]) {
      const T = 8 * n + 0.5, now = [0, 1, 3, 2][n & 3], was = [0, 1, 3, 2][(n + 3) & 3];
      const p = draw(cortex, T, w, h, 1);
      const a = litBorder(p, w, h, T, now), b = litBorder(p, w, h, T, was);
      assert.ok(Math.abs(a.lit / a.total - 0.5) < 0.1, `${w}x${h}: new edge ${a.lit}/${a.total}`);
      assert.ok(Math.abs(b.lit / b.total - 0.5) < 0.1, `${w}x${h}: old edge ${b.lit}/${b.total}`);
    }
    // each border cell steps once: over the sweep no cell changes colour twice, and no frame changes more than a twelfth of the two borders
    const r0 = layoutOf(w, h).panes[1], np = 2 * (r0.w - 1) + 2 * (r0.h - 1);
    let prev = snap(draw(cortex, 8 - 1 / FPS, w, h, 1)), worstFrame = 0;
    const flips = new Map();
    for (let k = 0; k <= 30; k++) {
      const T = 8 - 1 / FPS + k / FPS, q = draw(cortex, T, w, h, 1);
      let ch = 0;
      for (let i = 0; i < w * h; i++) if (q.fg[i] !== prev.fg[i] && (q.fg[i] === EDGE_FOCUS || q.fg[i] === EDGE) && (prev.fg[i] === EDGE_FOCUS || prev.fg[i] === EDGE)) { ch++; flips.set(i, (flips.get(i) || 0) + 1); }
      worstFrame = Math.max(worstFrame, ch);
      prev = snap(q);
    }
    assert.ok([...flips.values()].every((v) => v === 1), 'every border cell steps exactly once');
    assert.ok(worstFrame <= Math.ceil((2 * np) / FPS) + 6, `${w}x${h}: ${worstFrame} border cells in one frame (borders of ${np} cells)`);
  }
});

// ---- 10. colour: the safeHue image, red-safe, contrast

const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const redShare = (c) => { const r = lin((c >> 16) & 255), g = lin((c >> 8) & 255), b = lin(c & 255); return r / (r + g + b); };

test('cortex colour: every colour on screen is a safeHue colour or one of the five named constants (glass, skin, edge, focus edge, link), and none has a linear red share of 0.75 or more', () => {
  let worst = 0, foreign = 0, cells = 0;
  for (const [w, h] of [[120, 40], [240, 67], [60, 20], [88, 39]]) {
    for (const seed of [1, 2, 3]) {
      const p = buffers(w, h);
      for (let t = 0; t < 140; t += 0.77) {
        draw(cortex, t, w, h, seed, 0, p);
        for (let i = 0; i < w * h; i++) {
          cells++;
          worst = Math.max(worst, redShare(p.fg[i]), redShare(p.bg[i]));
          if (!(IMAGE.has(p.fg[i]) || CONSTANTS.has(p.fg[i])) || !(IMAGE.has(p.bg[i]) || CONSTANTS.has(p.bg[i]))) foreign++;
        }
      }
    }
  }
  console.log(`RED worst linear red share ${worst.toFixed(4)} (limit under 0.75); ${foreign} of ${cells} cells held a colour outside the safeHue image and the constants`);
  assert.ok(worst < 0.75, `${worst}`);
  assert.equal(foreign, 0);
  for (const c of CONSTANTS) assert.ok(redShare(c) < 0.75);
});

test('cortex colour control: the edge hues through plain OKLCH (no safeHue) at the icosahedron lightness do reach a saturated red', () => {
  let bad = 0;
  for (let e = 0; e < 30; e++) {
    const hDeg = cx.edgeHue(1, e, 0), a = 0.2 * Math.cos((hDeg * Math.PI) / 180), b = 0.2 * Math.sin((hDeg * Math.PI) / 180), L = 0.62;
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const R = Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), G = Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), B = Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
    if (R / (R + G + B) >= 0.75) bad++;
  }
  assert.ok(bad > 0, 'some edge hue is red in plain OKLCH');
});

const contrast = (fg, bg) => (luminanceOf(fg) + 0.05) / (luminanceOf(bg) + 0.05);

test('cortex contrast: every text cell (letters, digits, punctuation and the cursor) has at least 4.5:1 against the glass #0E1426, in every frame over 130 s at four sizes (the ring numerals lit or not, a caption typed or held)', () => {
  let worst = 99, cells = 0;
  for (const [w, h] of ALL_SIZES_SMALL) {
    const p = buffers(w, h);
    for (let t = 0; t < 130; t += 0.41) {
      draw(cortex, t, w, h, 1, 0, p);
      for (let i = 0; i < w * h; i++) {
        const g = p.glyphs[i];
        if (!((g >= 33 && g < 127) || g === 0x258c)) continue;
        cells++;
        assert.equal(p.bg[i], PANE_BG, 'text only on glass');
        const c = contrast(p.fg[i], PANE_BG);
        worst = Math.min(worst, c);
        assert.ok(c >= 4.5, `${w}x${h} t=${t.toFixed(2)} cell ${i}: contrast ${c.toFixed(2)}`);
      }
    }
  }
  console.log(`CONTRAST worst text against the glass ${worst.toFixed(2)}:1 over ${cells} text cells (limit 4.5)`);
  assert.ok(worst >= 4.5);
});

test('cortex contrast control: a text colour at lightness 0.5 (the icosahedron\'s dimmest) is under 4.5:1, and the edge and link colours are not text', () => {
  assert.ok(contrast(safeHue(205, 0.5), PANE_BG) < 4.5);
  assert.ok(contrast(safeHue(205, 0.8), PANE_BG) > 4.5);
  assert.ok(contrast(EDGE, PANE_BG) < 4.5 && contrast(LINK, PANE_BG) < 4.5);
});

// ---- 11. glyphs

test('cortex glyphs: only spaces, braille, digits, capital letters and . , the rounded box corners, light lines, the two dashes, the diamond and the cursor are drawn; every one allowed, none banned', () => {
  const seen = new Set();
  for (const [w, h] of [[60, 20], [120, 40], [240, 67]]) {
    const p = buffers(w, h);
    for (let t = 0; t < 140; t += 0.31) { draw(cortex, t, w, h, 1, 0, p); for (let i = 0; i < w * h; i++) seen.add(p.glyphs[i]); }
  }
  const okSet = new Set([32, 0x256d, 0x256e, 0x2570, 0x256f, 0x2500, 0x2502, 0x254c, 0x254e, 0x25c6, 0x258c, 0x2e]);
  for (const g of seen) {
    assert.ok(isAllowedGlyph(g), `${g.toString(16)}`);
    assert.ok(!BANNED.includes(g));
    assert.ok(okSet.has(g) || (g >= 0x2801 && g <= 0x28ff) || (g >= 48 && g <= 57) || (g >= 65 && g <= 90), `unexpected glyph ${g.toString(16)}`);
  }
  for (const g of okSet) assert.ok(seen.has(g), `${String.fromCodePoint(g)} is drawn`);
  const src = fs.readFileSync(new URL('../cartridges/driftman-9000/scenes/cortex.js', import.meta.url), 'utf8');
  for (const b of ['∫', '≡', '◍', '◎', '◐', '◑', '◒', '◓', '◢', '◣']) assert.ok(!src.includes(b), `${b} in the source`);
});

// ---- 12. sizes

test('cortex sizes: 0x0, 1x1, 59x19, 60x20, 61x21, ten real sizes and 400x120 never throw and every cell is written (sentinels all gone)', () => {
  for (const [w, h] of [[0, 0], [1, 1], [0, 30], [30, 0], [59, 19], [60, 19], [59, 20], [2, 200], ...SIZES]) {
    for (const t of [0, 7.3, 31, 59.9, 126]) {
      const p = draw(cortex, t, w, h, 1);
      assert.equal(p.glyphs.length, w * h);
      for (let i = 0; i < w * h; i++) {
        assert.ok(isAllowedGlyph(p.glyphs[i]), `${w}x${h} cell ${i} glyph ${p.glyphs[i]}`);
        assert.ok(p.fg[i] <= 0xffffff && p.bg[i] <= 0xffffff, `${w}x${h} t=${t}: cell ${i} was not written`);
        if (w >= MIN_W && h >= MIN_H) assert.equal(p.colours[i], RGB_CELL);
      }
    }
  }
});

test('cortex sizes: 60x20 is the first size with the picture, 59x19, 60x19 and 59x20 the dim centred message "This vision needs 60 x 20." (the size branch bites both ways)', () => {
  assert.equal(MESSAGE, 'This vision needs 60 x 20.'); assert.equal(MIN_W, 60); assert.equal(MIN_H, 20);
  const msg = (w, h) => { const p = draw(cortex, 5, w, h); return p.glyphs.some((g) => g === 0x54) && p.glyphs.every((g) => g === 32 || (g >= 33 && g < 127)); };
  assert.equal(msg(59, 19), true); assert.equal(msg(60, 19), true); assert.equal(msg(59, 20), true); assert.equal(msg(100, 19), true);
  assert.equal(msg(60, 20), false); assert.equal(msg(61, 21), false); assert.equal(msg(120, 40), false);
  for (const [w, h] of [[59, 19], [40, 12], [100, 19]]) {
    const p = draw(cortex, 5, w, h);
    const row = Math.floor(h / 2), line = String.fromCodePoint(...p.glyphs.slice(row * w, (row + 1) * w));
    const x = line.indexOf(MESSAGE);
    if (w >= MESSAGE.length) { assert.ok(x >= 0, `${w}x${h}`); assert.ok(Math.abs(x - (w - x - MESSAGE.length)) <= 1, 'centred'); assert.ok(luminanceOf(p.fg[row * w + x]) < luminanceOf(0x8a9bc4), 'dim'); }
    for (let i = 0; i < w * h; i++) if (Math.floor(i / w) !== row) assert.equal(p.glyphs[i], 32);
  }
});

test('cortex sizes (mutation check): at every size the four panes are all there, each with its own content, and the pulse and ring fit', () => {
  for (const [w, h] of SIZES) {
    const T = 3.0, p = draw(cortex, T, w, h, 1);
    const R = layoutOf(w, h).content;
    const count = (r, f) => { let n = 0; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (f(p.glyphs[y * w + x])) n++; return n; };
    assert.ok(count(R[0], (g) => g >= 0x2801 && g <= 0x28ff) > 20, `${w}x${h}: pane A has its figure`);
    assert.ok(count(R[1], (g) => g >= 0x2801 && g <= 0x28ff) > 8, `${w}x${h}: pane B has its trace`);
    assert.equal(count(R[2], (g) => g >= 48 && g <= 57), 24, `${w}x${h}: pane C has 24 numerals`);
    assert.ok(count(R[3], (g) => g === 0x258c) === 1 && count(R[3], (g) => g >= 65 && g <= 90) > 3, `${w}x${h}: pane D has its caption`);
  }
});

// ---- 13. the cache

test('cortex cache: built per size and kept (same buffers for the same size, no allocation per frame), rebuilt on a resize; frames never change what it holds', () => {
  const c0 = cx.cacheFor(120, 40);
  assert.equal(cx.cacheFor(120, 40), c0);
  const a = c0.icoBits, b = c0.trBits, pathX = c0.pathX, panes = JSON.stringify(c0.layout.panes);
  for (let k = 0; k < 30; k++) draw(cortex, k * 0.9, 120, 40, 1);
  assert.equal(cx.cacheFor(120, 40), c0); assert.equal(c0.icoBits, a); assert.equal(c0.trBits, b); assert.equal(c0.pathX, pathX);
  assert.equal(JSON.stringify(c0.layout.panes), panes);
  assert.ok(c0.icoBits.every((v) => v === 0) && c0.trBits.every((v) => v === 0), 'the dot buffers are clean after a frame');
  const c1 = cx.cacheFor(80, 24);
  assert.notEqual(c1, c0);
  assert.notEqual(cx.cacheFor(120, 40), c0, 'and the old size is rebuilt, not kept');
});

// ---- 14. change per frame: under 5 %

test('cortex change: under 5 % of the cells change between consecutive frames at 18 fps over 60 s, at 120x40, 240x67, 80x24 and 60x20 (seeds 1 to 3); the scene is never still', () => {
  const lines = [];
  for (const [w, h] of [[120, 40], [240, 67], [80, 24], [60, 20]]) {
    for (const seed of [1, 2, 3]) {
      const p = buffers(w, h), n = w * h;
      let prev = null, min = 1, max = 0, sum = 0, frames = 0;
      for (let k = 0; k <= 60 * FPS; k++) {
        draw(cortex, k / FPS, w, h, seed, 0, p);
        if (prev) {
          let ch = 0;
          for (let i = 0; i < n; i++) if (p.glyphs[i] !== prev.g[i] || p.fg[i] !== prev.fg[i] || p.bg[i] !== prev.bg[i]) ch++;
          min = Math.min(min, ch / n); max = Math.max(max, ch / n); sum += ch / n; frames++;
        }
        prev = snap(p);
      }
      lines.push(`${w}x${h} seed ${seed}: min ${(min * 100).toFixed(2)} % mean ${(100 * sum / frames).toFixed(2)} % max ${(max * 100).toFixed(2)} %`);
      assert.ok(max < 0.05, `${w}x${h} seed ${seed}: ${(max * 100).toFixed(2)} % changed in the worst frame`);
      assert.ok(sum / frames > 0.003, `${w}x${h} seed ${seed}: mean ${(100 * sum / frames).toFixed(3)} % is a still picture`);
    }
  }
  console.log('CHANGE per frame:\n  ' + lines.join('\n  '));
});

test('cortex change control: the Rosette changes far more than 5 % of its cells per frame (so the counter above can fail)', () => {
  const w = 120, h = 40, n = w * h, p = buffers(w, h);
  let prev = null, max = 0;
  for (let k = 0; k <= 30; k++) {
    draw(rosette, k / FPS, w, h, 1, 0, p);
    if (prev) { let ch = 0; for (let i = 0; i < n; i++) if (p.glyphs[i] !== prev.g[i] || p.fg[i] !== prev.fg[i] || p.bg[i] !== prev.bg[i]) ch++; max = Math.max(max, ch / n); }
    prev = snap(p);
  }
  assert.ok(max > 0.5, `${max}`);
});

// ---- 15. the look

const cellY = (p, i) => { const g = p.glyphs[i], c = glyphCoverage(g); return luminanceOf(p.bg[i]) * (1 - c) + luminanceOf(p.fg[i]) * c; };
export const meanLuminance = (scene, w, h, seed, times) => {
  let sum = 0;
  for (const t of times) { const p = draw(scene, t, w, h, seed); for (let i = 0; i < w * h; i++) sum += cellY(p, i); }
  return sum / (times.length * w * h);
};

test('cortex look: very dark overall (mean cell luminance under 0.04, measured 0.008 to 0.03), the glass is a real share of the screen (20 to 60 % at 120x40), the figure is bright (some cells over L 0.6) and every pane animates', () => {
  const lines = [];
  for (const [w, h] of [[120, 40], [240, 67], [60, 20]]) {
    const mean = meanLuminance(cortex, w, h, 1, [3, 10, 20, 35, 50, 77]);
    const p = draw(cortex, 12, w, h, 1);
    let glass = 0, bright = 0;
    for (let i = 0; i < w * h; i++) { if (p.bg[i] === PANE_BG) glass++; if (luminanceOf(p.fg[i]) > 0.6 ** 3 && p.glyphs[i] !== 32) bright++; }
    lines.push(`${w}x${h}: mean luminance ${mean.toFixed(4)}, glass ${(100 * glass / (w * h)).toFixed(1)} %, bright ink cells ${bright}`);
    assert.ok(mean < 0.04 && mean > 0.003, `${w}x${h}: mean ${mean}`);
    assert.ok(bright > 10, `${w}x${h}: ${bright}`);
    if (w === 120) assert.ok(glass > 0.2 * w * h && glass < 0.6 * w * h, `${glass}`);
  }
  for (const [w, h] of [[120, 40], [80, 24]]) {
    const a = draw(cortex, 20, w, h, 1), s = snap(a), b = draw(cortex, 22, w, h, 1);
    const R = layoutOf(w, h).content;
    for (let i = 0; i < 4; i++) {
      let ch = 0;
      for (let y = R[i].y; y < R[i].y + R[i].h; y++) for (let x = R[i].x; x < R[i].x + R[i].w; x++) if (b.glyphs[y * w + x] !== s.g[y * w + x] || b.fg[y * w + x] !== s.fg[y * w + x]) ch++;
      assert.ok(ch > 0 || i === 3 || i === 2, `${w}x${h}: pane ${i} did not move in 2 s`);
    }
  }
  console.log('LOOK:\n  ' + lines.join('\n  '));
});

test('cortex constants: the shipped scene is id cortex, kind cells, rgb; the colours are the design\'s', () => {
  assert.equal(cortex.id, 'cortex'); assert.equal(cortex.kind, 'cells'); assert.equal(cortex.rgb, true);
  assert.equal(PANE_BG, 0x0e1426); assert.equal(EDGE, 0x4a6ab0);
});

// ---- 16. the manifest and the loop order

const man = JSON.parse(fs.readFileSync(new URL('../cartridges/driftman-9000/manifest.json', import.meta.url), 'utf8'));

test('cortex manifest: the scene is in the 9000 manifest as a full-colour cells scene, between Rosette and Bloomfall in the scenes, the menu and the program, with the designer\'s label, note and text', () => {
  assert.deepEqual(man.scenes.map((x) => x.id), ['rosette', 'cortex', 'bloomfall']);
  assert.deepEqual(man.scenes[1], { id: 'cortex', kind: 'cells', title: 'Cortex', rgb: true });
  assert.deepEqual(man.programs[0].scenes, ['rosette', 'cortex', 'bloomfall']);
  assert.equal(man.programs[0].id, 'transmission'); assert.equal(man.programs[0].sceneSeconds, 60);
  assert.deepEqual(man.menu.map((m) => m.label), ['ROSETTE', 'CORTEX', 'BLOOMFALL']);
  assert.deepEqual(man.menu[1], { label: 'CORTEX', program: 'transmission', scene: 'cortex', note: 'thinking', desc: 'The machine thinks aloud on floating panes of glass.' });
  assert.ok(man.menu[1].note.length <= 16 && man.menu[1].label.length <= 23);
  assert.equal(man.facts[0], '3 visions · about 3 min · full colour');
});

// The loop-order rule (design section 5): no two lit-to-dark changes within 60 s of each other. A scene is lit when its mean cell luminance is at
// least LIT_MEAN, measured here on the shipped scenes at three sizes.
const LIT_MEAN = 0.12;
const MEANS = {};
for (const [id, scene] of [['rosette', rosette], ['cortex', cortex], ['bloomfall', bloomfall]]) MEANS[id] = [[120, 40], [80, 24], [240, 67]].map(([w, h]) => meanLuminance(scene, w, h, 1, [4, 20, 41, 66, 95]));
const isLit = (id, sz) => MEANS[id][sz] >= LIT_MEAN;
const litToDark = (order, seconds, litOf, loops = 3) => {
  const times = [];
  const total = order.length * seconds;
  for (let loop = 0; loop < loops; loop++) for (let k = 0; k < order.length; k++) {
    const from = order[k], to = order[(k + 1) % order.length];
    if (litOf(from) && !litOf(to)) times.push(loop * total + (k + 1) * seconds);
  }
  return times;
};
const minGap = (times) => { let g = Infinity; for (let i = 1; i < times.length; i++) g = Math.min(g, times[i] - times[i - 1]); return g; };

test('cortex loop order: measured mean luminance puts Rosette lit and Cortex and Bloomfall dark, and in the shipped program (Rosette, Cortex, Bloomfall; 60 s each; looped) no two lit-to-dark changes come within 60 s of each other', () => {
  console.log(`LOOP mean luminance per scene at 120x40 / 80x24 / 240x67: ${Object.entries(MEANS).map(([k, v]) => `${k} ${v.map((x) => x.toFixed(4)).join('/')}`).join(', ')} (lit from ${LIT_MEAN})`);
  for (let sz = 0; sz < 3; sz++) {
    assert.equal(isLit('rosette', sz), true, `rosette is lit at size ${sz}: ${MEANS.rosette[sz]}`);
    assert.equal(isLit('cortex', sz), false, `cortex is dark: ${MEANS.cortex[sz]}`);
    assert.equal(isLit('bloomfall', sz), false, `bloomfall is dark: ${MEANS.bloomfall[sz]}`);
    assert.ok(MEANS.rosette[sz] > 3 * MEANS.bloomfall[sz] && MEANS.bloomfall[sz] > MEANS.cortex[sz] * 0.9, 'the gaps are wide');
    const order = man.programs[0].scenes, secs = man.programs[0].sceneSeconds;
    const times = litToDark(order, secs, (id) => isLit(id, sz));
    assert.ok(times.length >= 3, `one lit-to-dark change per loop: ${times}`);
    assert.ok(minGap(times) >= 60, `lit-to-dark changes at ${times} s`);
    // and Cortex really is a rest: the change after Rosette is the only one, and Cortex sits right after it
    assert.equal(order[order.indexOf('rosette') + 1], 'cortex');
    assert.equal(order[order.indexOf('cortex') + 1], 'bloomfall');
  }
});

test('cortex loop order control: a program that goes lit, dark, lit, dark in 25 s scenes breaks the rule (lit-to-dark changes 50 s apart), so the check can fail', () => {
  const times = litToDark(['rosette', 'cortex', 'rosette', 'cortex'], 25, (id) => isLit(id, 0));
  assert.ok(times.length >= 4 && minGap(times) < 60, `${times}`);
  assert.equal(minGap(times), 50);
});
