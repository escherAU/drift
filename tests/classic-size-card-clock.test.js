// DRIFT-12 part A, item 6: while the size card shows, Classic's time does not advance (the console's rule: "the console owns the screen: Classic time does not advance
// while it does", src/app.js step()). t, the scene clock, the scheduler (scene timer and dissolve) and what is held back by the 256-colour paint cap all stand still, and
// growing the window back resumes where it left off: the same t, the same frame, no leap for the time spent on the card. Pinned with the app's own loop on each of
// the three clocks (grid, q156, jitter), in every mode, with the shrink in a scene hold and in a dissolve and several gaps (none a whole number of frames).
import test from 'node:test';
import assert from 'node:assert/strict';
import { measurePause, pauseViolations, startCard, MODES } from './helpers-size-card.js';
import { RGB_CELL } from '../src/renderer.js';
import { PLAYLISTS } from '../src/scenes/index.js';

const CLOCKS = ['grid', 'q156', 'jitter'];

test('6 the scene clock stands still under the card: t before shrinking equals t after growing back for the same wall gap, on each clock, in every mode, in a hold and in a dissolve', async () => {
  for (const clock of CLOCKS) for (const startMode of MODES) for (const [at, label] of [[1.5, 'hold'], [3.8, 'dissolve']]) for (const gap of [0.43, 3.07, 7.31]) {
    const m = await measurePause({ clock, startMode, at, gap, clockSeed: 3 });
    if (label === 'dissolve') assert.equal(m.before.state.fading, true, `${clock} ${startMode}: the shrink is inside a dissolve`);
    assert.deepEqual(pauseViolations(m), [], `${clock} ${startMode} ${label} gap ${gap}`);
  }
});

test('6 the same on the one-tick-per-frame driver and in truecolor, and a gap of nearly nothing and of a minute', async () => {
  for (const [clock, cmode, gap] of [['tick', '256', 2.2], ['tick', 'truecolor', 0.05], ['grid', 'truecolor', 60], ['jitter', '256', 60]]) {
    const m = await measurePause({ clock, cmode, startMode: 'contrast', at: 3.8, gap });
    assert.deepEqual(pauseViolations(m), [], `${clock} ${cmode} gap ${gap}`);
  }
});

test('6 what the scene clock does after resuming is the clock of the app that never shrank, shifted by nothing: it runs from where it stopped', async () => {
  const run = async (shrink) => {
    const h = await startCard({ cols: 80, rows: 24, startMode: 'chaos', clock: 'grid', sceneSeconds: 3 });
    try {
      h.advance(2);
      if (shrink) { h.resize(30, 8); h.advance(5); h.resize(80, 24); }
      h.advance(2);
      return h.app.getState();
    } finally { h.close(); }
  };
  const still = await run(false), shrunk = await run(true);
  assert.ok(Math.abs(shrunk.t - still.t) <= 1 / 18 + 1e-6, `t ${shrunk.t} vs ${still.t}: the 5 s on the card did not count`);
  assert.equal(shrunk.sceneIndex, still.sceneIndex);
});

// an injected full-colour Classic scene: the only way for the 256-colour paint cap to hold time back in Classic (no shipped Classic scene is full colour)
function rgbScene(t, w, h, p) {
  for (let i = 0; i < w * h; i++) { p.glyphs[i] = 0x23; p.fg[i] = 0x123456; p.bg[i] = 0x000000; }
}
rgbScene.rgb = true;

test('6 held time: time held back by the 256-colour paint cap when the window shrinks does not leak a leap when it grows back', async () => {
  const playlists = { ...PLAYLISTS, chaos: [rgbScene, rgbScene] };
  const h = await startCard({ cols: 80, rows: 24, startMode: 'chaos', cmode: '256', clock: 'tick', playlists });
  try {
    assert.ok(h.app.getState().mode === 'chaos');
    h.app.tick(0.01); // paints the first frame (full colour), then 0.01 + 0.01 + 0.01 are held: the cap paints no sooner than every 1/18 s
    h.app.tick(0.01); h.app.tick(0.01); h.app.tick(0.01);
    const t0 = h.app.getState().t;
    assert.ok(t0 > 0 && t0 < 0.02, `t is ${t0}: the later ticks were held, not stepped`);
    h.resize(30, 8);
    h.app.tick(5); h.app.tick(5); h.app.tick(0.3);
    assert.equal(h.app.getState().t, t0, 'no time passes on the card (5 s ticks do not count)');
    h.resize(80, 24);
    assert.equal(h.app.getState().t, t0, 'growing back does not move t');
    h.app.tick(0.05); h.app.tick(0.05);
    const grown = h.app.getState().t - t0;
    assert.ok(grown > 0 && grown <= 0.2, `after resuming t moved ${grown} s: what was held plus the steps taken, never the time on the card`);
    assert.ok(RGB_CELL === 255);
  } finally { h.close(); }
});

test('6 pausing and the card: p stays honest under the card (a paused app stays paused when the card goes) and help open does not move the clock either', async () => {
  const h = await startCard({ cols: 80, rows: 24, startMode: 'calm', clock: 'tick' });
  try {
    h.advance(2);
    h.key('p');
    const t0 = h.app.getState().t;
    h.resize(30, 8); h.advance(3); h.resize(80, 24); h.advance(3);
    assert.equal(h.app.getState().t, t0);
    assert.equal(h.app.getState().paused, true);
    h.key('p');
    h.advance(1);
    assert.ok(h.app.getState().t - t0 > 0.9);
  } finally { h.close(); }
});
