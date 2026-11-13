// DRIFT-8 C3 (T3.2, T3.3): the colour clock's checks must bite. Each mutant is a one-line breakage applied to a temp copy of the engine and the 9000
// (src/, cartridges/driftman-9000/, the colour-clock helper and its pins), and a probe (node, in the copy) runs the same checks the real tests run
// (tests/helpers-colour-clock.js) and prints which of them fail. The real tree is never touched. A control (no edit) must fail none.
//   tc at the scaled rate (dt x speed)         -> the clock-rate check and the hue-rate check fail     (T3.1, T3.5)
//   global tc (not scene-local)                -> the 1x byte-identity check fails                       (T3.3)
//   each hue site on scene time again          -> the hue-rate check fails, site by site                  (T3.5)
//   motion on colour time                      -> the motion check fails                                   (T3.5)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COPY = [['src', 'src'], ['cartridges/driftman-9000', 'cartridges/driftman-9000']];
const FILES = ['tests/helpers-colour-clock.js', 'tests/fixtures/colour-clock-pins.json', 'package.json'];
const lf = (s) => s.replace(/\r\n/g, '\n');

// [label, file, find, replace, the checks that must fail]
const MUTANTS = [
  ['tc at the scaled rate (dt x speed)', 'src/shell/runtime.js', 'tc += dt * Math.min(SPEEDS[speedIdx], 1);', 'tc += d;', ['rates', 'hue']],
  ['the runtime hands the composer t as the colour clock', 'src/shell/runtime.js', 'cellComp.frame(mapped, t, tc)', 'cellComp.frame(mapped, t, t)', ['hue']],
  ['global tc: tc0 is 0 for every scene (the colour clock is not scene-local)', 'src/cells.js', 'params.tc0 = TC === null ? undefined : (sinceC[idx] === null ? TC : sinceC[idx]);', 'params.tc0 = TC === null ? undefined : 0;', ['pins']],
  ['the composer drops tc', 'src/cells.js', "params.tc = TC === null ? undefined : TC;", 'params.tc = undefined;', ['hue']],
  ['Rosette: the hue rate on scene time', 'cartridges/driftman-9000/scenes/rosette.js', 'hueT = 200 + HUE_RATE * TC', 'hueT = 200 + HUE_RATE * T', ['hue']],
  ['Rosette: the colour the pattern carries on scene time (120 f)', 'cartridges/driftman-9000/scenes/rosette.js', 'split = TC !== T', 'split = false', ['hue']],
  ['Rosette: the contours on colour time (motion on the wrong clock)', 'cartridges/driftman-9000/scenes/rosette.js', 'const rot = 0.05 * T,', 'const rot = 0.05 * TC,', ['motion']],
  ['Bloomfall: the field hue on scene time', 'cartridges/driftman-9000/scenes/bloomfall.js', 'hueAt(px + 0.5, yf, TC, seed)', 'hueAt(px + 0.5, yf, T, seed)', ['hue']],
  ['Bloomfall: the bloom turn on scene time', 'cartridges/driftman-9000/scenes/bloomfall.js', 'hueTurn = b.turn * (TC - b.start)', 'hueTurn = b.turn * tau', ['hue']],
  ['Cortex: the edge hue on scene time', 'cartridges/driftman-9000/scenes/cortex.js', 'safeHue(edgeHue(seed, e, TC), L)', 'safeHue(edgeHue(seed, e, T), L)', ['hue']],
  ['Cortex: the icosahedron turns on colour time', 'cartridges/driftman-9000/scenes/cortex.js', 'rotateIcosa(seed, T, c.proj);', 'rotateIcosa(seed, TC, c.proj);', ['motion']],
];

const PROBE = `
const h = await import('./tests/helpers-colour-clock.js');
const kit = await h.loadKit();
const out = { rates: h.checkClockRates(kit), pins: h.checkPins(kit), hue: h.checkHueRates(kit).failures, motion: h.checkMotionOnSceneTime(kit) };
console.log('PROBE ' + JSON.stringify(out));
`;

function copyProject(mutant) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-ccmut-'));
  for (const [from, to] of COPY) fs.cpSync(path.join(ROOT, from), path.join(dir, to), { recursive: true });
  for (const f of FILES) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)); }
  fs.writeFileSync(path.join(dir, 'probe.mjs'), PROBE);
  if (mutant) {
    const [label, file, find, repl] = mutant;
    const p = path.join(dir, file);
    const src = lf(fs.readFileSync(p, 'utf8'));
    if (!src.includes(find)) throw new Error(`mutant "${label}": the find string is not in ${file}`);
    fs.writeFileSync(p, src.replace(find, repl));
  }
  return dir;
}

function probe(dir) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // this file runs inside a test worker; the child must be a run of its own
    const child = spawn(process.execPath, ['probe.mjs'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 170000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = out.split('\n').find((l) => l.startsWith('PROBE '));
      resolve({ code, out, result: line ? JSON.parse(line.slice(6)) : null });
    });
  });
}

test('T3.2 control: the unmutated copy passes every colour-clock check (so a failure below is the mutant\'s)', async () => {
  const dir = copyProject(null);
  try {
    const r = await probe(dir);
    assert.ok(r.result, r.out.slice(-1500));
    assert.deepEqual(r.result, { rates: [], pins: [], hue: [], motion: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const m of MUTANTS) {
  test(`T3.2 mutant: ${m[0]} fails ${m[4].join(' and ')}`, async () => {
    const dir = copyProject(m);
    try {
      const r = await probe(dir);
      assert.ok(r.result, r.out.slice(-1500));
      for (const key of m[4]) assert.ok(r.result[key].length > 0, `the ${key} check passed on the mutant "${m[0]}": ${JSON.stringify(r.result)}`);
      console.log(`MUTANT ${m[0]}: ${m[4].map((k) => `${k} -> ${r.result[k][0]}`).join(' | ')}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
