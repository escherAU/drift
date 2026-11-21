// DRIFT-12 part A, item 7: the flash meter watching Classic's size card in the REAL app (tests/helpers-size-card.js startCard), with window resizes in the run.
//
// How a resize is read (what the existing meter and tests do about a resize, found for this ticket): nothing before this did. createFlashMeter(cols, rows, fps) is fixed to one
// size and throws on a frame of another; no flash arm resizes the window (the resize tests in app.test.js, golden-calm.test.js and modes-app.test.js only check that the
// app redraws); and the meter has no "reflow" reset. So this helper makes the choice and states it: the viewer's window is a fixed CANVAS (the size the run starts at, or `canvas`);
// a window smaller than the canvas is drawn in the canvas's top-left corner and every cell outside the window is the terminal's own blank (the default colours), so a resize is a
// change of the screen and the viewer's baseline is NOT reset: nothing is forgiven for being "a resize". Frames are read on the viewer's 18 Hz grid, one per 1 / fps of the clock.
import { createFlashMeter, failedRules, ruleOf, X1_RULE_IDS } from './helpers-flash.js';
import { rgbOf } from './helpers-flash-app.js';
import { startCard } from './helpers-size-card.js';

export const CARD_FPS = 18;
const DEF_FG = 0xcccccc, DEF_BG = 0x0c0c0c;

// events: [{ at: seconds, size: [cols, rows] }] in order; each lands on the frame boundary at or after `at`, before that frame's step. canvas: [cols, rows] (default the start size).
// Returns { rep, frames, h-free facts }. `root`: a copy of the tree (the mutants).
export async function runCardFlash({
  cols = 40, rows = 10, startMode = 'contrast', cmode = '256', seed = 1, clock = 'grid', clockSeed = seed, invert = false, seconds = 10, events = [], canvas = null,
  fps = CARD_FPS, root = null, sceneSeconds = 180,
} = {}) {
  const [CW, CH] = canvas || [cols, rows];
  const h = await startCard({ cols, rows, startMode, cmode, seed, clock, clockSeed, invert, fps, root, sceneSeconds });
  try {
    const meter = createFlashMeter(CW, CH, fps);
    const total = Math.round(seconds * fps);
    const ev = events.slice().sort((a, b) => a.at - b.at);
    let ei = 0, swaps = 0;
    const n = CW * CH;
    for (let k = 0; k < total && !h.proc.exits.length; k++) {
      while (ei < ev.length && ev[ei].at <= k / fps + 1e-9) { h.resize(ev[ei].size[0], ev[ei].size[1]); ei++; swaps++; }
      if (h.clock) h.clock.advanceTo(((k + 1) * 1000) / fps); else h.app.tick(1 / fps);
      h.flush();
      const { cols: wc, rows: wr } = h.size;
      if (wc > CW || wr > CH) throw new Error(`the window ${wc}x${wr} is bigger than the canvas ${CW}x${CH}`);
      const f = { cols: CW, rows: CH, glyphs: new Uint32Array(n).fill(32), fg: new Uint32Array(n).fill(DEF_FG), bg: new Uint32Array(n).fill(DEF_BG) };
      for (let y = 0; y < wr; y++) {
        for (let x = 0; x < wc; x++) {
          const j = y * CW + x, s = y * wc + x;
          f.glyphs[j] = h.screen.glyphs[s]; f.fg[j] = rgbOf(h.screen.fg[s], DEF_FG); f.bg[j] = rgbOf(h.screen.bg[s], DEF_BG);
        }
      }
      meter.push(f, undefined);
    }
    return { rep: meter.report(), frames: total, swaps, exits: h.proc.exits.slice(), state: h.app.getState() };
  } finally { h.close(); }
}

// the five rules' worst readings in per cent (the viewer's own second) and which fail
export function cardNums(rep) {
  const out = {};
  for (const id of X1_RULE_IDS) out[id] = ruleOf(rep, id).worstFraction * 100;
  return out;
}
export const cardFailed = (rep) => failedRules(rep, { only: X1_RULE_IDS });
export const cardLine = (rep) => X1_RULE_IDS.map((id) => `${id} ${(ruleOf(rep, id).worstFraction * 100).toFixed(2)}/${(ruleOf(rep, id).limit * 100).toFixed(0)}`).join(' ');

// a window dragged back and forth: from `from` until `until`, a resize every `every` seconds, alternating a (first) and b
export function swapEvents(a, b, every, from, until) {
  const ev = [];
  let toA = true;
  for (let t = from; t < until - 1e-9; t += every) { ev.push({ at: t, size: toA ? a : b }); toA = !toA; }
  return ev;
}
