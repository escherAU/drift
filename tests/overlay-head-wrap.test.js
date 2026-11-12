// DRIFT-7 C7: a help head line wider than the box wraps at its double-space gap onto two rows, never cut.
// layoutFor(info, rows, cols): cols defaults to Infinity (no wrapping), so every older caller is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFor, panelSize, drawHelp } from '../src/overlay.js';
import { helpFrame, frameLines } from './helpers-help.js';

const UI = { text: 15, dim: 7, head: 14 };
const info = (extra = {}) => ({ mode: 'calm', modeName: 'calm', sceneName: 'testscene', ui: UI, ...extra });
const HEAD = 'DRIFT  keys';
const MODE = 'mode: calm    scene: testscene';
const inner = (cols) => cols - 2 - 4;
const texts = (lay) => lay.lines.map((l) => l.text);

test('layoutFor with cols (C7): a wide terminal is unchanged, with or without the cols argument', () => {
  for (const rows of [Infinity, 30, 24, 23, 20, 12]) {
    const base = layoutFor(info(), rows);
    assert.deepEqual(layoutFor(info(), rows, 200), base, `${rows} rows, 200 cols`);
    assert.deepEqual(layoutFor(info(), rows, Infinity), base, `${rows} rows, Infinity cols`);
  }
  assert.deepEqual(panelSize(info(), 24, 200), panelSize(info(), 24));
});

test('layoutFor with cols (C7): a merged head wider than the box inner width goes onto more rows, whole, in order', () => {
  const merged = `${HEAD}  ${MODE}`;
  assert.ok(merged.length > inner(40), 'control: the merged head does not fit 40 columns');
  const wide = layoutFor(info(), 24, 200);
  assert.equal(texts(wide)[0], merged, 'control: wide gives the merged single row');
  const lay = layoutFor(info(), 24, 40);
  const t = texts(lay);
  assert.ok(lay.lines.length > wide.lines.length, 'more rows than the unwrapped layout');
  assert.ok(!t.includes(merged), 'no single row carries the whole merged head');
  assert.ok(t[0].startsWith(HEAD), 'the title starts the first row');
  assert.ok(t.join('\n').includes('mode: calm'), 'the mode is on a row, whole');
  assert.ok(t.join('\n').includes('scene: testscene'), 'the scene is on a row, whole');
  for (const l of lay.lines.slice(0, 3)) assert.ok(l.text.length <= inner(40), `head row fits: '${l.text}'`);
});

test('layoutFor with cols (C7): a title and a mode line that are each too wide split at their own gaps', () => {
  const lay = layoutFor(info({ title: 'OWNER\'S MANUAL · keys', modeLine: 'tape: Night Drive    track: Midnight On-Ramp' }), 11, 41);
  const t = texts(lay);
  assert.deepEqual(t.slice(0, 3), ['OWNER\'S MANUAL · keys', 'tape: Night Drive', 'track: Midnight On-Ramp']);
  assert.ok(t.every((x) => x.length <= inner(41)), 'every head row fits');
});

test('layoutFor with cols (C7): a head with no double-space gap that is still too wide stays one row (clipped by the draw, as before) and nothing throws', () => {
  const long = 'one-unbroken-title-that-is-far-too-wide-for-the-box';
  const lay = layoutFor(info({ title: long, modeLine: '' }), 23, 30);
  assert.equal(texts(lay)[0], long, 'kept whole in the layout');
  const f = helpFrame('calm', 30, 23, { title: long, modeLine: '' });
  const lines = frameLines(f);
  assert.ok(lines.some((l) => l.includes('one-unbroken-title-that')), 'drawn clipped, the start shows');
  assert.ok(!lines.some((l) => l.includes(long)), 'and it is clipped');
});

test('layoutFor with cols (C7): tiny sizes never throw, for every row and column count', () => {
  for (let cols = 0; cols <= 12; cols++) {
    for (let rows = 0; rows <= 12; rows++) {
      assert.doesNotThrow(() => layoutFor(info(), rows, cols), `${cols}x${rows}`);
      assert.doesNotThrow(() => panelSize(info(), rows, cols), `${cols}x${rows}`);
      assert.doesNotThrow(() => drawHelp(new Uint16Array(Math.max(1, cols * rows)).fill(32), new Uint8Array(Math.max(1, cols * rows)), cols, rows, info()), `${cols}x${rows}`);
    }
  }
});

test('Classic help (C7): where the title and mode line do not fit one row, the whole head text is on the screen, nothing cut', () => {
  const head = 'DRIFT  keys';
  const scene = 'a-long-scene-name';
  for (const [cols, rows] of [[40, 24], [36, 24], [40, 23], [36, 23]]) {
    const f = helpFrame('calm', cols, rows, { sceneName: scene });
    const text = frameLines(f).map((l) => l.replace(/[│┌┐└┘─]/g, ' ').replace(/\s+/g, ' ').trim()).join('\n');
    assert.ok(text.includes('DRIFT'), `${cols}x${rows}: title`);
    assert.ok(text.includes('keys'), `${cols}x${rows}: keys`);
    assert.ok(text.includes('mode: calm'), `${cols}x${rows}: mode`);
    assert.ok(text.includes(`scene: ${scene}`), `${cols}x${rows}: the whole scene name`);
  }
  assert.ok(`${head}  mode: calm    scene: ${scene}`.length > inner(36), "control: the head is wider than the narrowest box");
  assert.ok(`mode: calm    scene: ${scene}`.length > inner(40), "control: even the mode line alone is wider than the 40 column box");
});
