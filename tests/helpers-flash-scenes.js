// DRIFT-8 C4: one solo run of a vision through the real cell composer and the flash meter, at the speed the speed key gives it.
//
// A real-speed run is frame k at scene time t = start + k * speed / 18, pushed to the meter at 18 fps (the viewer sees 18 frames a second whatever the key says).
// clock: true drives the colour clock as src/shell/runtime.js does (frameAtSpeed); clock: false is how the 4x replays drove it before C4 (no tc: the scene reads its colour
// off the scene clock), kept as the control that the clock is doing the work.
import { createFlashMeter } from './helpers-flash.js';
import { flashRig, frameAtSpeed } from './helpers-flash-controls.js';

export const FPS = 18;

export function runScene(scene, [cols, rows], { speed = 1, mode = 'truecolor', seed = 1, seconds = 66, clock = true, start = 0 } = {}) {
  const rig = flashRig([scene], cols, rows, { seed, mode });
  const meter = createFlashMeter(cols, rows, FPS);
  const N = Math.round((seconds * FPS) / speed);
  const st = { a: 0, b: 0, p: 0 };
  for (let k = 0; k < N; k++) {
    const t = start + (k * speed) / FPS;
    const s = rig.show(clock ? frameAtSpeed(rig.cc, st, t, speed) : rig.cc.frame(st, t));
    meter.push(s.frame, s.palette);
  }
  return meter.report();
}
