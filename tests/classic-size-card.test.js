// DRIFT-12 part A: Classic has a minimum window of 40 columns x 10 rows. Below 40 columns OR below 10 rows Classic shows the "make the window bigger" card (the shell's
// too-small card, src/shell/ui.js drawTooSmall, with Classic's words) instead of the art, in every mode. These tests drive the REAL app on a fake terminal and read the
// bytes it writes back through the independent terminal reader; the card is restated by hand in tests/helpers-size-card.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startCard, expectedCardText, isCardSize, colourPairs, twoToneOf, assertScreenIsFrame, assertWritesInside, inkOf, MODES, CMODES, CARD_WORDS } from './helpers-size-card.js';

const CARD_SIZES = [[3, 2], [10, 4], [39, 10], [40, 9]];
const ART_SIZES = [[40, 10], [41, 11]];
const showsCard = (h) => h.text() === expectedCardText(h.size.cols, h.size.rows);

test('1 the card: at 3x2, 10x4, 39x10 and 40x9 every mode shows the card and nothing else, in both colour modes (the exact words)', async () => {
  for (const cmode of CMODES) for (const startMode of MODES) for (const [cols, rows] of CARD_SIZES) {
    const label = `${startMode} ${cmode} ${cols}x${rows}`;
    const h = await startCard({ cols, rows, startMode, cmode });
    try {
      h.advance(1.5);
      assert.equal(h.text(), expectedCardText(cols, rows), `${label}: the card`);
      assert.ok(inkOf(h.screen) > 0, `${label}: the card has words`);
      assertScreenIsFrame(h, assert, label);
      assert.deepEqual(h.proc.exits, [], `${label}: no exit`);
    } finally { h.close(); }
  }
});

test('1 the words: the card says the minimum in one line where it fits, and 10x4 wraps it into four whole-word lines', async () => {
  const h = await startCard({ cols: 39, rows: 10, startMode: 'calm' });
  try {
    h.advance(0.5);
    const lines = h.text().split('\n').filter((l) => l.trim() !== '');
    assert.deepEqual(lines.map((l) => l.trim()), [CARD_WORDS]);
    assert.equal(CARD_WORDS, 'Make the window bigger to see drift.');
    assert.equal(h.text().split('\n')[4].trim(), CARD_WORDS, 'on the middle row of 10');
    h.resize(10, 4);
    assert.deepEqual(h.text().split('\n').map((l) => l.trim()), ['Make the', 'window', 'bigger to', 'see drift']); // the full stop falls in the bottom-right cell, which the renderer never draws
  } finally { h.close(); }
});

test('1 the art: at 40x10 and 41x11 every mode shows the art (not the card), in both colour modes', async () => {
  for (const cmode of CMODES) for (const startMode of MODES) for (const [cols, rows] of ART_SIZES) {
    const label = `${startMode} ${cmode} ${cols}x${rows}`;
    const h = await startCard({ cols, rows, startMode, cmode });
    try {
      h.advance(2);
      assert.notEqual(h.text(), expectedCardText(cols, rows), `${label}: not the card`);
      assert.ok(!h.text().includes('window'), `${label}: no card words`);
      assert.ok(inkOf(h.screen) > 0, `${label}: something is drawn`);
      assertScreenIsFrame(h, assert, label);
    } finally { h.close(); }
  }
});

test('1 high contrast: the card is strictly two-tone (one pair of colours on every cell), the same two colours the art has, and i inverts it', async () => {
  for (const cmode of CMODES) for (const invert of [false, true]) for (const [cols, rows] of CARD_SIZES) {
    const label = `contrast${invert ? ' inverted' : ''} ${cmode} ${cols}x${rows}`;
    const h = await startCard({ cols, rows, startMode: 'contrast', cmode, invert });
    const art = await startCard({ cols: 80, rows: 24, startMode: 'contrast', cmode, invert });
    try {
      h.advance(1);
      art.advance(1);
      const want = twoToneOf(cmode, invert);
      assert.deepEqual([...colourPairs(h.screen)], [`${want.fg}/${want.bg}`], `${label}: one pair, ${JSON.stringify(want)}`);
      assert.deepEqual([...colourPairs(art.screen)], [...colourPairs(h.screen)], `${label}: the art's two colours`);
      // i flips the polarity (after the 3 s guard has been waited out in the inverted start; the first flip from a normal start is at once)
      h.advance(4);
      h.key('i');
      h.advance(0.2);
      const flip = twoToneOf(cmode, !invert);
      assert.equal(h.text(), expectedCardText(cols, rows), `${label}: still the card after i`);
      assert.deepEqual([...colourPairs(h.screen)], [`${flip.fg}/${flip.bg}`], `${label}: inverted by i`);
    } finally { h.close(); art.close(); }
  }
});

test('1 other modes: the card is in the mode\'s own UI colour, and a mode change (m) while the card shows keeps the card', async () => {
  for (const cmode of CMODES) {
    const h = await startCard({ cols: 30, rows: 8, startMode: 'calm', cmode });
    try {
      h.advance(0.5);
      assert.ok(showsCard(h));
      for (const k of ['m', 'm', 'm', 'm']) {
        h.key(k); h.advance(4);
        assert.ok(showsCard(h), `${cmode}: card after m (${h.app.getState().mode})`);
        assertScreenIsFrame(h, assert, `${cmode} ${h.app.getState().mode}`);
      }
    } finally { h.close(); }
  }
});

test('1 help: the card wins over the help panel below the minimum; the help state is kept and shows when the window is big enough', async () => {
  for (const startMode of MODES) {
    const h = await startCard({ cols: 39, rows: 10, startMode });
    try {
      h.advance(0.5);
      h.key('h'); h.advance(0.5);
      assert.ok(showsCard(h), `${startMode}: card with help requested`);
      assert.equal(h.app.getState().help, true);
      h.resize(80, 30);
      assert.ok(h.text().includes('DRIFT'), `${startMode}: help panel after growing`);
      assert.ok(!h.text().includes('window bigger'));
      h.resize(80, 9);
      assert.ok(showsCard(h), `${startMode}: card again at 80x9 with help open`);
      h.key('h'); h.advance(0.2);
      h.resize(80, 24);
      assert.ok(!h.text().includes('DRIFT  keys'), `${startMode}: help closed while the card showed stays closed`);
    } finally { h.close(); }
  }
});

test('2 boundary pair: 39x10 is the card and 40x10 is the art; 40x9 is the card and 40x10 is the art; 40x10 is the art in every mode (both arms pinned)', async () => {
  for (const cmode of CMODES) for (const startMode of MODES) {
    for (const [small, big] of [[[39, 10], [40, 10]], [[40, 9], [40, 10]]]) {
      const label = `${startMode} ${cmode} ${small.join('x')} -> ${big.join('x')}`;
      const h = await startCard({ cols: small[0], rows: small[1], startMode, cmode });
      try {
        h.advance(1);
        assert.equal(h.text(), expectedCardText(...small), `${label}: card at ${small.join('x')}`);
        h.resize(...big);
        assert.notEqual(h.text(), expectedCardText(...big), `${label}: not the card at ${big.join('x')}`);
        assert.ok(inkOf(h.screen) > 0 && !h.text().includes('window bigger'), `${label}: art at ${big.join('x')}`);
        h.resize(...small);
        assert.equal(h.text(), expectedCardText(...small), `${label}: card again at ${small.join('x')}`);
      } finally { h.close(); }
    }
  }
});

test('3 degenerate sizes: 1x1, one column wide, very tall and narrow, very wide and short: the card or nothing, never a throw, never a write outside cols x rows', async () => {
  for (const cmode of CMODES) for (const startMode of MODES) for (const [cols, rows] of [[1, 1], [1, 24], [5, 200], [400, 3], [2, 40], [80, 1]]) {
    const label = `${startMode} ${cmode} ${cols}x${rows}`;
    const h = await startCard({ cols, rows, startMode, cmode });
    try {
      assert.doesNotThrow(() => { h.advance(1); h.key('h'); h.advance(0.3); h.key('h'); h.key('m'); h.advance(0.3); }, label);
      assert.deepEqual(h.proc.exits, [], `${label}: no exit (no crash)`);
      assert.equal(h.screen.overflow, 0, `${label}: nothing written past the last column`);
      assertWritesInside(h.writesAll, cols, rows, assert, label);
      const want = expectedCardText(cols, rows).split('\n');
      const got = h.text().split('\n');
      // the card, cut at the window's edges (a mode change may have recoloured it, never reworded it)
      assert.deepEqual(got, want, `${label}: the card`);
    } finally { h.close(); }
  }
});

test('3 a terminal that reports no size (columns 0, rows 0) is the 80x24 default: the art, not the card', async () => {
  const h = await startCard({ cols: 80, rows: 24, reported: { cols: 0, rows: 0 }, startMode: 'calm' });
  try {
    h.advance(1);
    assert.deepEqual([h.app.getState().cols, h.app.getState().rows], [80, 24]);
    assert.ok(!h.text().includes('window bigger') && inkOf(h.screen) > 0);
  } finally { h.close(); }
});

test('4 resize sequences: 80x24 -> 39x10 -> 80x24, 40x10 -> 40x9 -> 40x10 and a staircase: each step is exactly the card or the art, no stale cell, and the art after resuming equals the art before shrinking', async () => {
  const seqs = [
    [[80, 24], [39, 10], [80, 24]],
    [[40, 10], [40, 9], [40, 10]],
    [[80, 24], [60, 16], [40, 10], [39, 10], [30, 8], [39, 10], [40, 10], [80, 24]],
  ];
  for (const cmode of CMODES) for (const startMode of MODES) for (const seq of seqs) {
    const label = `${startMode} ${cmode} ${seq.map((s) => s.join('x')).join(' > ')}`;
    const h = await startCard({ cols: seq[0][0], rows: seq[0][1], startMode, cmode });
    try {
      h.advance(2.2);
      let lastArt = null;
      for (let k = 0; k < seq.length; k++) {
        const [cols, rows] = seq[k];
        if (k > 0) h.resize(cols, rows);
        const step = `${label} @${k} ${cols}x${rows}`;
        assert.equal(h.size.cols, cols);
        if (isCardSize(cols, rows)) {
          assert.equal(h.text(), expectedCardText(cols, rows), `${step}: the card`);
        } else {
          assert.ok(!h.text().includes('window bigger') && inkOf(h.screen) > 0, `${step}: the art`);
          const prev = seq[k - 1];
          if (k > 0 && prev && isCardSize(...prev)) { // coming back from the card to the size the art last had: the very same art
            if (lastArt && lastArt.cols === cols && lastArt.rows === rows) assert.equal(h.text(), lastArt.text, `${step}: the art after resuming equals the art before shrinking`);
          }
          lastArt = { cols, rows, text: h.text() };
        }
        assertScreenIsFrame(h, assert, step);
        assert.deepEqual(h.proc.exits, [], `${step}: no exit`);
        h.advance(k % 2 ? 0.7 : 0.1);
        if (!isCardSize(cols, rows)) lastArt = { cols, rows, text: h.text() };
        assertScreenIsFrame(h, assert, `${step} after time`);
      }
    } finally { h.close(); }
  }
});

test('4 a resize to the same card size, or from one card size to another, repaints the card at once (a full repaint, no old words left)', async () => {
  const h = await startCard({ cols: 30, rows: 8, startMode: 'calm' });
  try {
    h.advance(0.5);
    for (const [c, r] of [[30, 8], [20, 6], [10, 4], [38, 9], [12, 3]]) {
      h.resize(c, r);
      assert.equal(h.text(), expectedCardText(c, r), `${c}x${r}`);
      assertScreenIsFrame(h, assert, `${c}x${r}`);
    }
  } finally { h.close(); }
});

test('5 start small: an app created at 20x6 shows the card, then grown to 80x24 shows clean art', async () => {
  for (const cmode of CMODES) for (const startMode of MODES) {
    const label = `${startMode} ${cmode}`;
    const h = await startCard({ cols: 20, rows: 6, startMode, cmode });
    try {
      h.advance(1);
      assert.equal(h.text(), expectedCardText(20, 6), `${label}: the card at the start`);
      h.resize(80, 24);
      assert.ok(!h.text().includes('window bigger') && inkOf(h.screen) > 0, `${label}: art`);
      assertScreenIsFrame(h, assert, `${label}: grown`);
      h.advance(1);
      assertScreenIsFrame(h, assert, `${label}: grown, a second later`);
      assert.deepEqual([h.app.getState().cols, h.app.getState().rows], [80, 24]);
      assert.deepEqual(h.proc.exits, []);
    } finally { h.close(); }
  }
});

test('5 start small with the app\'s own loop on each clock: the card, then the art after growing', async () => {
  for (const clock of ['grid', 'q156', 'jitter']) {
    const h = await startCard({ cols: 39, rows: 10, startMode: 'contrast', clock });
    try {
      h.advance(1);
      assert.equal(h.text(), expectedCardText(39, 10), clock);
      h.resize(40, 10);
      h.advance(1);
      assert.ok(!h.text().includes('window bigger') && inkOf(h.screen) > 0, clock);
      assertScreenIsFrame(h, assert, clock);
    } finally { h.close(); }
  }
});

// ---- 12: the card does no per-frame scene work

function counted(list, counter) {
  const wrap = (scene) => new Proxy(scene, {
    apply(target, self, args) { counter.n++; return Reflect.apply(target, self, args); },
    get(target, p) {
      const v = target[p];
      if (typeof v === 'function' && (p === 'draw' || p === 'step' || p === 'init')) return (...args) => { counter.n++; return v.apply(target, args); };
      return v;
    },
  });
  return list.map(wrap);
}

test('12 cost: parked on the card the scenes are never called (no composer frame, no scene step) and nothing is written after the card is drawn; they run again at once on the art', async () => {
  const { PLAYLISTS } = await import('../src/scenes/index.js');
  for (const startMode of MODES) {
    const counter = { n: 0 };
    const playlists = Object.fromEntries(Object.entries(PLAYLISTS).map(([k, v]) => [k, counted(v, counter)]));
    const h = await startCard({ cols: 39, rows: 10, startMode, playlists });
    try {
      h.advance(0.3);
      const before = counter.n, writes = h.writesAll.length;
      h.advance(20);
      assert.equal(counter.n, before, `${startMode}: no scene call in 20 s on the card (${counter.n - before})`);
      assert.equal(counter.n, 0, `${startMode}: the scenes were never called at this size`);
      assert.equal(h.writesAll.length, writes, `${startMode}: no write while parked on the card`);
      h.resize(80, 24);
      h.advance(1);
      assert.ok(counter.n > 0, `${startMode}: the scenes run on the art`);
    } finally { h.close(); }
  }
});
