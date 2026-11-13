// DRIFT-8 C1: the Rosette's per-pixel brightness range, as each colour mode really shows it, over a whole 4x run.
//
// The flash meter averages the two half-block pixels of a cell, so a one-pixel contour moves a cell by half of its own step. This test
// looks at the pixels themselves: every pixel (top = fg, bottom = bg of its cell; the Rosette draws space or upper-half-block cells),
// as the mode shows it (truecolor: the renderer drops the two low bits of each channel, v & 0xFCFCFC; 256: the frame after
// makeReducer256, the renderer's own nearest256), relative luminance Y. Two numbers over the whole run (every frame at 4x, so the
// hue wheel and the fold melts both go past every pixel): the range of Y over all pixels and frames, and the worst range of one pixel.
// The tripwire is 0.07 for both. Measured (see the log line this test prints): truecolor 0.0585, 256 colours 0.0665.
// The Rosette draws its contour at safeHue row 44 (L 0.70) in truecolor and at fill lightness on 256 colours (params.cmode, set by
// the cell composer); a contour at 0.72 in truecolor (0.0814) or at 0.70 on 256 colours (0.1333) is over the line, and the controls
// below show that this measurement sees both.
import test from 'node:test';
import assert from 'node:assert/strict';
import { relY } from '../src/pixels.js';
import { makeRosette } from '../cartridges/driftman-9000/scenes/rosette.js';
import rosette from '../cartridges/driftman-9000/scenes/rosette.js';
import { flashRig } from './helpers-flash-controls.js';

const FPS = 18;
export const TRIPWIRE = 0.07;
const FRAMES = 40 * FPS; // 40 s of wall time at 4x = 160 s of scene time: more than two 60 s fold cycles

// { all: range of Y over every pixel and frame, pixel: worst range of any one pixel } for the scene in the mode, at 4x.
function measure(scene, cols, rows, mode, seed, { frames = FRAMES, speed = 4 } = {}) {
  const rig = flashRig([scene], cols, rows, { seed, mode });
  const n = cols * rows;
  const lo = new Float64Array(2 * n).fill(9), hi = new Float64Array(2 * n).fill(-9);
  let gmin = 9, gmax = -9;
  for (let k = 0; k < frames; k++) {
    const f = rig.show(rig.cc.frame({ a: 0, b: 0, p: 0 }, (speed * k) / FPS)).frame;
    for (let i = 0; i < n - 1; i++) { // the renderer never draws the bottom-right cell
      const top = mode === '256' ? f.fg[i] : f.fg[i] & 0xfcfcfc, bot = mode === '256' ? f.bg[i] : f.bg[i] & 0xfcfcfc;
      const yt = relY(top), yb = relY(bot);
      if (yt < lo[2 * i]) lo[2 * i] = yt; if (yt > hi[2 * i]) hi[2 * i] = yt;
      if (yb < lo[2 * i + 1]) lo[2 * i + 1] = yb; if (yb > hi[2 * i + 1]) hi[2 * i + 1] = yb;
      if (yt < gmin) gmin = yt; if (yt > gmax) gmax = yt; if (yb < gmin) gmin = yb; if (yb > gmax) gmax = yb;
    }
  }
  let pixel = 0;
  for (let j = 0; j < 2 * (n - 1); j++) if (hi[j] - lo[j] > pixel) pixel = hi[j] - lo[j];
  return { all: gmax - gmin, pixel };
}

const SIZES = [[61, 21, [1, 2, 3, 7]], [80, 24, [1, 2, 3, 7]], [120, 40, [1, 2, 3, 7]], [280, 70, [1, 2, 3, 7]]];

for (const mode of ['truecolor', '256']) {
  test(`T1.1 rosette per-pixel brightness range over a whole 4x run, ${mode}: at most ${TRIPWIRE} at 61x21, 80x24, 120x40 and 280x70 (seeds 1, 2, 3, 7)`, () => {
    const lines = [];
    let worst = 0;
    for (const [cols, rows, seeds] of SIZES) {
      for (const seed of seeds) {
        const m = measure(rosette, cols, rows, mode, seed);
        worst = Math.max(worst, m.all, m.pixel);
        lines.push(`${mode} ${cols}x${rows} seed ${seed}: range over all pixels ${m.all.toFixed(4)}, worst single pixel ${m.pixel.toFixed(4)}`);
        assert.ok(m.all <= TRIPWIRE && m.pixel <= TRIPWIRE, `${lines[lines.length - 1]} (tripwire ${TRIPWIRE})`);
      }
    }
    console.log(`RANGE (4x, ${FRAMES} frames, worst ${worst.toFixed(4)})\n  ${lines.join('\n  ')}`);
  });
}

test('T1.1 controls: the same measurement sees a truecolor contour at 0.72 (0.0814) and a 256-colour contour at 0.70 (0.1333)', () => {
  const tc72 = measure(makeRosette(0.72, 180, 0.72), 120, 40, 'truecolor', 1, { frames: 360 });
  assert.ok(tc72.all > TRIPWIRE, `truecolor contour 0.72: ${tc72.all}`);
  const c70 = measure(makeRosette(0.70, 180, 0.70), 120, 40, '256', 1, { frames: 360 });
  assert.ok(c70.all > TRIPWIRE, `256 contour 0.70: ${c70.all}`);
  console.log(`RANGE controls: truecolor 0.72 ${tc72.all.toFixed(4)}; 256 at 0.70 ${c70.all.toFixed(4)}`);
});
