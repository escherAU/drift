import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCapture, CAPTURE_NAMES } from '../tools/capture.mjs';
import { runMeasure } from '../tools/measure.mjs';
import { measureCalm, measureFade } from '../tools/calm.mjs';
import { DEFAULT_FADE_SECONDS } from '../src/app.js';
import { SCENES } from '../src/scenes/index.js';
import { createComposer } from '../src/compose.js';
import { frameToText } from '../src/renderer.js';

const SIZES = [[120, 40], [240, 67]];

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-tools-')); }

test('K1 capture writes .txt (chars only) and .ansi for 5 scenes + crossfade at both sizes', () => {
  const dir = tmp();
  const files = runCapture({ outDir: dir });
  assert.deepEqual(CAPTURE_NAMES, ['squiggle', 'sunburst', 'plasma', 'ripples', 'rain', 'crossfade']);
  for (const name of CAPTURE_NAMES) {
    for (const [w, h] of SIZES) {
      const txt = path.join(dir, `${name}-${w}x${h}.txt`);
      const ans = path.join(dir, `${name}-${w}x${h}.ansi`);
      assert.ok(fs.existsSync(txt), txt);
      assert.ok(fs.existsSync(ans), ans);
      const t = fs.readFileSync(txt, 'utf8');
      assert.ok(!t.includes('\x1b'), 'txt has no escapes');
      const secs = name === 'crossfade' ? [0, 0.25, 0.5, 0.75, 1].map((f) => f * DEFAULT_FADE_SECONDS) : [0, 5, 10, 20];
      for (const sec of secs) assert.ok(t.includes(`=== t=${sec}s ${w}x${h}`), `${name} t=${sec}`);
      // one block of h rows plus a header line per frame
      assert.equal(t.replace(/\n$/, '').split('\n').length, secs.length * (h + 1));
      const a = fs.readFileSync(ans, 'utf8');
      assert.ok(a.includes('\x1b[38;2;'), 'ansi has truecolor');
    }
  }
  assert.equal(files.length, 24);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('K1 capture is deterministic (second run is byte-identical) and the crossfade ends on scene B', () => {
  const d1 = tmp(), d2 = tmp();
  runCapture({ outDir: d1 });
  runCapture({ outDir: d2 });
  for (const f of fs.readdirSync(d1)) {
    assert.equal(fs.readFileSync(path.join(d1, f), 'utf8'), fs.readFileSync(path.join(d2, f), 'utf8'), f);
  }
  const frames = (name) => fs.readFileSync(path.join(d1, `${name}-120x40.txt`), 'utf8').split(/=== t=[\d.]+s [^\n]*\n/).slice(1);
  const x = frames('crossfade'), a = frames('squiggle'), b = frames('sunburst');
  assert.equal(x[0], a[0], 't=0 equals scene A');
  assert.equal(x.length, 5, 'five fade points: progress 0, 0.25, 0.5, 0.75, 1');
  const pure = (id, t) => frameToText({ cols: 120, rows: 40, glyphs: createComposer({ scenes: SCENES, cols: 120, rows: 40, seed: 1 }).frame({ a: id, b: id, p: 0 }, t).glyphs.slice() }) + '\n';
  assert.equal(x[4], pure(1, DEFAULT_FADE_SECONDS), 'progress 1 equals pure scene B at the same time');
  assert.notEqual(x[2], pure(0, DEFAULT_FADE_SECONDS / 2), 'mid-fade is not pure A');
  assert.notEqual(x[2], pure(1, DEFAULT_FADE_SECONDS / 2), 'mid-fade is not pure B');
  // control: different scenes differ
  assert.notEqual(a[2], b[2]);
  fs.rmSync(d1, { recursive: true, force: true });
  fs.rmSync(d2, { recursive: true, force: true });
});

test('K2 measure smoke: the real app loop runs 2.5 s at 80x24 against a counting fake TTY', async () => {
  const r = await runMeasure({ seconds: 2.5, cols: 80, rows: 24, scene: 'mix', quiet: true });
  assert.ok(r.frames >= 20 && r.frames <= 60, `frames ${r.frames}`);
  assert.ok(r.bytes > 1000, `bytes ${r.bytes}`);
  assert.ok(r.samples.length >= 2, `samples ${r.samples.length}`);
  for (const s of r.samples) { assert.ok(s.rssMB > 5 && s.rssMB < 400); assert.ok(s.cpuCore >= 0); }
  assert.ok(r.summary.cpuCoreMean >= 0 && r.summary.cpuCoreMean < 1);
  assert.equal(r.summary.cores, os.cpus().length);
  assert.ok(Math.abs(r.summary.cpuMachineMean - r.summary.cpuCoreMean / r.summary.cores) < 1e-9);
  assert.equal(r.firstWrite, '\x1b[?1049h\x1b[?25l', 'went through the real terminal-enter path');
  assert.equal(r.lastWrite, '\x1b[?25h\x1b[?1049l\x1b[0m', 'and the real leave path');
});

// ---- calmness ceilings (set after tuning, with margin; see tools/calm.mjs)
const CEIL = {
  squiggle: { mean: 0.02, max: 0.04, abs: 0.3 },
  sunburst: { mean: 0.06, max: 0.09, abs: 1.1 },
  plasma: { mean: 0.05, max: 0.09, abs: 0.7 },
  ripples: { mean: 0.06, max: 0.11, abs: 1.2 },
  rain: { mean: 0.03, max: 0.04, abs: 0.4 },
};

for (const [i, scene] of SCENES.entries()) {
  test(`calm: ${scene.id} stays under its calmness ceiling (and a 50x-fast control exceeds it)`, () => {
    const c = measureCalm({ sceneIndex: i, cols: 120, rows: 40, seconds: 30, fps: 18, seeds: [1, 2] });
    const lim = CEIL[scene.id];
    assert.ok(c.meanFrac <= lim.mean, `${scene.id} mean fraction ${c.meanFrac.toFixed(4)} > ${lim.mean}`);
    assert.ok(c.maxFrac <= lim.max, `${scene.id} max fraction ${c.maxFrac.toFixed(4)} > ${lim.max}`);
    assert.ok(c.meanAbs <= lim.abs, `${scene.id} mean abs ${c.meanAbs.toFixed(3)} > ${lim.abs}`);
    const fast = measureCalm({ sceneIndex: i, cols: 120, rows: 40, seconds: 10, fps: 18, seeds: [1], timeScale: 50 });
    assert.ok(fast.meanFrac > lim.mean || fast.meanAbs > lim.abs, `${scene.id}: control must exceed the ceiling`);
  });
}

// ---- fade calmness at the SHIPPED default (the cross-fade was the busiest thing on screen at 5 s)
// Sweep: seeds 1-3 x start times 8/40/100 s x the five adjacent pairs x both sizes.
// Measured worst case over the sweep: 7.10% of cells changing in one frame (120x40, seed 1,
// t0 = 40 s, plasma > ripples; 240x67 worst is 6.83%). The ceiling is 7.5%, just above that.
const FADE_CEIL = 0.075;
const FADE_SEEDS = [1, 2, 3];
const FADE_STARTS = [8, 40, 100];
// 1 s control: every pair must be clearly busier than the shipped fade. Pairs 0-2 (squiggle>sunburst,
// sunburst>plasma, plasma>ripples) exceed the ceiling outright; the two rain pairs are naturally calmer
// (control peak 3-11%), so for them the honest assertion is a factor over the shipped sweep peak (>= 1.2).
const CONTROL_FACTOR = 1.2;

test('shipped default fade is 15 s and the tools use that same constant', () => {
  assert.equal(DEFAULT_FADE_SECONDS, 15);
});

for (const [cols, rows] of SIZES) {
  test(`calm fade: all five pairs, seeds 1-3 x starts 8/40/100 s, stay under 7.5% of cells per frame at ${cols}x${rows}; 1 s control is busier on every pair`, () => {
    for (let a = 0; a < SCENES.length; a++) {
      const b = (a + 1) % SCENES.length;
      const name = `${SCENES[a].id} > ${SCENES[b].id}`;
      let worst = 0;
      for (const seed of FADE_SEEDS) {
        for (const t0 of FADE_STARTS) {
          const c = measureFade({ a, b, cols, rows, seed, t0 });
          worst = Math.max(worst, c.maxFrac);
          assert.ok(c.maxFrac < FADE_CEIL, `${name} seed ${seed} t0 ${t0} peak ${(c.maxFrac * 100).toFixed(2)}% >= 7.5%`);
        }
      }
      const fast = measureFade({ a, b, cols, rows, fadeSec: 1 });
      if (a <= 2) {
        assert.ok(fast.maxFrac > FADE_CEIL, `control: 1 s fade ${name} peak ${(fast.maxFrac * 100).toFixed(2)}% must exceed ceiling`);
      }
      assert.ok(fast.maxFrac > worst * CONTROL_FACTOR, `control: 1 s fade ${name} peak ${(fast.maxFrac * 100).toFixed(2)}% must exceed ${CONTROL_FACTOR}x the shipped sweep peak ${(worst * 100).toFixed(2)}%`);
    }
  });
}

// ---- DRIFT-2: captures of the non-calm modes (the calm K1 tests above are unchanged)
import { runCaptureModes, MODE_CAPTURE_NAMES } from '../tools/capture.mjs';
import { measureTargets } from '../tools/measure.mjs';
import { KEYMAP, rowFor } from '../src/keymap.js';
import { isAllowedGlyph } from '../src/glyphs.js';
import { PLAYLISTS } from '../src/scenes/index.js';
import { MODES } from '../src/modes.js';

test('K3 mode captures: <mode>-<scene>-1/-2, help-<mode>, dissolve-<mode>, plain text at 120x40; calm files are not touched', () => {
  const dir = tmp();
  const files = runCaptureModes({ outDir: dir });
  const want = [];
  for (const mode of MODES) {
    want.push(`help-${mode}.txt`);
    if (mode === 'calm') continue;
    want.push(`dissolve-${mode}.txt`);
    for (const s of PLAYLISTS[mode]) want.push(`${mode}-${s.id}-1.txt`, `${mode}-${s.id}-2.txt`);
  }
  assert.deepEqual(MODE_CAPTURE_NAMES.slice().sort(), want.slice().sort());
  assert.deepEqual(fs.readdirSync(dir).sort(), want.slice().sort());
  assert.equal(files.length, want.length);
  for (const f of want) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!t.includes('\x1b'), `${f}: plain text`);
    const body = t.split(/=== [^\n]*\n/).slice(1);
    const frames = f.startsWith('dissolve-') ? 5 : 1;
    assert.equal(body.length, frames, f);
    for (const b of body) {
      const lines = b.replace(/\n$/, '').split('\n');
      assert.equal(lines.length, 40, f);
      for (const l of lines) {
        assert.equal(l.length, 120, f);
        for (const ch of l) assert.ok(isAllowedGlyph(ch.codePointAt(0)), `${f} U+${ch.codePointAt(0).toString(16)}`);
      }
    }
  }
  for (const mode of MODES.filter((m) => m !== 'calm')) {
    for (const s of PLAYLISTS[mode]) {
      const a = fs.readFileSync(path.join(dir, `${mode}-${s.id}-1.txt`), 'utf8');
      const b = fs.readFileSync(path.join(dir, `${mode}-${s.id}-2.txt`), 'utf8');
      assert.notEqual(a, b, `${mode}-${s.id}: the two frames are at different times`);
    }
    const d = fs.readFileSync(path.join(dir, `dissolve-${mode}.txt`), 'utf8').split(/=== [^\n]*\n/).slice(1);
    assert.notEqual(d[0], d[4], `dissolve-${mode}: first and last frames differ`);
    assert.notEqual(d[2], d[0]); assert.notEqual(d[2], d[4]);
  }
  for (const mode of MODES) {
    const h = fs.readFileSync(path.join(dir, `help-${mode}.txt`), 'utf8');
    for (const e of KEYMAP) assert.equal(h.split(rowFor(e, mode).text).length - 1, 1, `help-${mode}: ${e.id}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('K3 mode captures are deterministic (second run is byte-identical)', () => {
  const d1 = tmp(), d2 = tmp();
  runCaptureModes({ outDir: d1 });
  runCaptureModes({ outDir: d2 });
  for (const f of fs.readdirSync(d1)) assert.equal(fs.readFileSync(path.join(d1, f), 'utf8'), fs.readFileSync(path.join(d2, f), 'utf8'), f);
  fs.rmSync(d1, { recursive: true, force: true });
  fs.rmSync(d2, { recursive: true, force: true });
});

test('K5 measure: targets cover every scene of every mode (and mix), each with its mode', () => {
  const t = measureTargets();
  const ids = t.map((x) => x.scene);
  for (const m of MODES) for (const s of PLAYLISTS[m]) assert.ok(t.some((x) => x.scene === s.id && x.mode === m), `${m}/${s.id}`);
  assert.ok(ids.includes('mix'));
});

test('K5 measure: a non-calm scene runs in its own mode and reports bytes per second', async () => {
  for (const [scene, mode] of [['glyphrain', 'chaos'], ['life', 'contrast'], ['bounce', 'experimental']]) {
    const r = await runMeasure({ seconds: 1.5, cols: 80, rows: 24, scene, quiet: true });
    assert.equal(r.mode, mode);
    assert.ok(r.frames > 5, `${scene} frames ${r.frames}`);
    assert.ok(r.summary.bytesPerSec > 0 && Number.isFinite(r.summary.bytesPerSec));
  }
  const m = await runMeasure({ seconds: 1.5, cols: 80, rows: 24, scene: 'mix', mode: 'chaos', quiet: true });
  assert.equal(m.mode, 'chaos', 'a start mode can be given');
});

test('K5 measure: the header still says what it does not measure', () => {
  const src = fs.readFileSync(new URL('../tools/measure.mjs', import.meta.url), 'utf8');
  assert.match(src, /Excludes:[\s\S]*NOT measured/);
});
