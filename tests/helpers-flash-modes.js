// DRIFT-8 C2: the colour mode a flash test runs in. The flow tests that watch the shell (foil, console hook, the 9000's console and panels) are written once and run
// twice: in truecolor, and again in 256 colours by a one-line wrapper (tests/flash-256-*.test.js) that sets DRIFT_FLASH_MODE=256 and imports the same file. In
// 256 colours the shell is built with cmode '256' (its palettes, and what the scenes see in params.cmode) and every frame goes through the reducer that shows
// the meter exactly the colours renderRgb emits in that mode (makeReducer256, pinned to the renderer by flash-reducer256.test.js).
import { createFlashMeter } from './helpers-flash.js';
import { makeReducer256 } from './helpers-flash-controls.js';

export const FLASH_MODE = process.env.DRIFT_FLASH_MODE === '256' ? '256' : 'truecolor';
export const MODE_NOTE = FLASH_MODE === '256' ? ' [256 colours]' : '';

// A flash meter fed the way a terminal in `mode` would show the shell's frames. push(frame, palette?) takes the shell's own frame.
export function shownMeter(cols, rows, fps, mode = FLASH_MODE) {
  const meter = createFlashMeter(cols, rows, fps);
  const reduce = mode === '256' ? makeReducer256(cols, rows) : null;
  const none = new Uint32Array(cols * rows); // a palette-only frame carries no fg/bg arrays: every cell is a palette cell, so these are never read
  return {
    mode, meter,
    push(frame, palette) {
      if (reduce) {
        const r = reduce(frame.fg && frame.bg ? frame : { ...frame, fg: none, bg: none }, palette || frame.palette);
        meter.push(r.frame, r.palette);
      } else meter.push(frame, palette);
    },
    report: () => meter.report(),
    cellY: (i) => meter.cellY(i),
  };
}
