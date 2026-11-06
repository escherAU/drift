import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCapture, CAPTURE_NAMES } from '../tools/capture.mjs';
import { runMeasure } from '../tools/measure.mjs';
import { measureCalm } from '../tools/calm.mjs';
import { SCENES } from '../src/scenes/index.js';

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
      for (const sec of [0, 5, 10, 20]) assert.ok(t.includes(`=== t=${sec}s ${w}x${h}`), `${name} t=${sec}`);
      // 4 frames of h rows each plus 4 header lines
      assert.equal(t.replace(/\n$/, '').split('\n').length, 4 * (h + 1));
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
  const frames = (name) => fs.readFileSync(path.join(d1, `${name}-120x40.txt`), 'utf8').split(/=== t=\d+s [^\n]*\n/).slice(1);
  const x = frames('crossfade'), a = frames('squiggle'), b = frames('sunburst');
  assert.equal(x[0], a[0], 't=0 equals scene A');
  assert.equal(x[3], b[3], 't=20 equals scene B');
  assert.notEqual(x[1], a[1]);
  assert.notEqual(x[1], b[1]);
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
