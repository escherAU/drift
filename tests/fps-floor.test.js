// DRIFT-9 item 2: --fps has a floor of 5 (MIN_FPS in src/app.js). The loop clamps one step to 0.25 s, so any rate under 4 fps (a frame longer than 250 ms) loses real time;
// 3 and 4 read the same on the flash meter for that reason, and 4 still fails L3 at 61x21. These tests pin the floor in parseOptions and help, and that at the floor
// the scene clock runs at real speed on the q156 and jitter clocks (tests/helpers-clock.js), with a control at fps 3 (createApp takes fps directly, so the app sees it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, parseOptions, helpText, MIN_FPS } from '../src/app.js';
import { fakeStdin, fakeStdout, fakeStderr, fakeProc } from './helpers.js';
import { createClock } from './helpers-clock.js';

test('MIN_FPS is 5; --fps and DRIFT_FPS below it read 5, above 30 read 30; help says 5-30', () => {
  assert.equal(MIN_FPS, 5);
  for (const v of ['0', '1', '3', '4', '-2']) assert.equal(parseOptions(['--fps', v], {}).fps, 5, `--fps ${v}`);
  assert.equal(parseOptions([], { DRIFT_FPS: '2' }).fps, 5);
  assert.equal(parseOptions(['--fps', '5'], {}).fps, 5);
  assert.equal(parseOptions(['--fps', '6'], {}).fps, 6);
  assert.equal(parseOptions(['--fps', '31'], {}).fps, 30);
  assert.match(helpText(), /frames per second, 5-30 \(default 18\)/);
});

// scene time (getState().t, speed 1) after `secs` of the clock, for an app asked for `fps` on a clock
function sceneTime({ mode, fps, secs = 20, seed = 1 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-fps-floor-'));
  try {
    const clock = createClock({ mode, seed });
    const app = createApp({ stdin: fakeStdin(), stdout: fakeStdout({ columns: 40, rows: 12 }), stderr: fakeStderr(), proc: fakeProc(), env: { COLORTERM: 'truecolor' },
      configPath: path.join(dir, 'config.json'), dirs: [], autoLoop: true, seed: 1, fps, now: clock.now, timer: clock.timer });
    app.start();
    clock.advanceTo(secs * 1000);
    const t = app.getState().t;
    app.quit(0);
    return t;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

for (const mode of ['q156', 'jitter']) {
  test(`time check, ${mode} clock: at --fps 5 (the floor) the scene time after 20 s is 20 s within one frame; the control at fps 3 reads about 0.75 of real time`, () => {
    const t5 = sceneTime({ mode, fps: MIN_FPS });
    const t3 = sceneTime({ mode, fps: 3 });
    console.log(`TIME CHECK ${mode}: fps 5 -> ${t5.toFixed(3)} s of 20 s, fps 3 -> ${t3.toFixed(3)} s (${(t3 / 20).toFixed(3)} of real)`);
    assert.ok(Math.abs(t5 - 20) <= 1 / MIN_FPS, `fps 5: ${t5} s after 20 s`);
    assert.ok(t3 / 20 > 0.7 && t3 / 20 < 0.8, `control fps 3 should read about 0.75: ${t3 / 20}`);
    assert.ok(Math.abs(t3 - 20) > 1 / 3, 'the control is outside the one-frame window, so the check can tell');
  });
}
