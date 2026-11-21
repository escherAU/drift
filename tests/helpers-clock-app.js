// DRIFT-9 item 4: the clock arms of the files that drive the shell app through c.app.tick(dt) (mkShell, tests/helpers-shell.js) and judged each painted step by the changed-cell rule.
// The arm runs the file's own flow with its own recorder and its own step rule (the 30 % rule, the 40 % ceiling and the brightness ramps, at the limits they always had), but on a
// harness whose app is stepped by a clock (tests/helpers-clock.js createRun: the loop tick of 1 / fps is replaced by the clock's real step, any other tick passes through), and ALSO
// reads every screen the file's recorder reads through the flash meter on the viewer's 18 Hz grid and judges it by the five 1x rules (L1, L2, L3, R, C) at their own limits.
// Nothing is loosened: the step rule is the old one on the clock's real steps (longer or shorter than 1 / 18 s), and the five rules are the ones every other clock arm uses.
// The meter is built and judged by the file and handed in, so this helper never builds one.
import { createRun } from './helpers-clock.js';

export const FPS_APP = 18;
// every frame the file's other arms paint (each file's own recorder adds one per frame it reads); the cost test holds the clock arms to a share of it, by count (tests/helpers-clock-arms.js)
export const tickStats = { frames: 0 };
const BLOCK = 0x2588;

// a frame of the app as a full-colour white or black screen: what the control feeds the meter instead of the real screen on every other paint
function strobeFrame(cols, rows, on) {
  const n = cols * rows, v = on ? 0xffffff : 0x000000;
  return { cols, rows, glyphs: new Uint32Array(n).fill(BLOCK), fg: new Uint32Array(n).fill(v), bg: new Uint32Array(n).fill(v) };
}

// c: the mkShell harness; clock: 'grid' | 'q156' | 'jitter' or { mode, seed }; meter: the file's own meter for cols x rows at 18 fps; strobe: the control, a white/black screen on alternate reads in place of the real one.
// Returns { c, run, report }: c is the harness with app and tick stepped by the clock (every flow of the file's runs on it unchanged, its recorder included) and app.screenshot() feeding
// the meter; report() is the meter's report. Do not use c.goto on it (it closes over the grid's tick): press the arrow keys and play.
export function clockedShell(c, { clock, meter, cols, rows, strobe = false, fps = FPS_APP }) {
  const run = createRun({ clock, fps });
  const m = run.meter(meter);
  let reads = 0;
  const stepped = run.sh(c.app);
  const app = new Proxy(stepped, {
    get(target, p) {
      if (p === 'screenshot') {
        return () => {
          const s = c.app.screenshot();
          if (s) m.push(strobe ? strobeFrame(cols, rows, reads++ % 2 === 0) : s);
          return s;
        };
      }
      const v = target[p];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const c2 = { ...c, app };
  // the same tick as mkShell's, on the stepped app
  c2.tick = (seconds, step = 1 / fps) => { if (seconds <= 0) { app.tick(0); return; } for (let t = 0; t < seconds - 1e-9; t += step) app.tick(Math.min(step, seconds - t)); };
  c2.text = () => { throw new Error('c.text() reads the screen outside the clock: not used by a clock arm'); };
  return { c: c2, run, report: () => meter.report() };
}
