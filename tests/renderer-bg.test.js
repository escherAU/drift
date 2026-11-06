// DRIFT-2: renderer support for palettes that carry a background (high contrast).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from '../src/renderer.js';
import { makePalette, makeMultiPalette, makeTwoTone, CHAOS_PALETTES } from '../src/color.js';

const W = 8, H = 3;
const frame = (palette, fill = 32, shades = 0) => ({
  cols: W, rows: H, palette,
  glyphs: new Uint16Array(W * H).fill(fill),
  shades: new Uint8Array(W * H).fill(shades),
});
const calm = makePalette([200, 100, 50], 'truecolor');
const dark = makeTwoTone(false, 'truecolor');
const light = makeTwoTone(true, 'truecolor');

test('bg: a full repaint is base + CLEAR then every cell, spaces included (all but the bottom-right)', () => {
  const r = createRenderer();
  const out = r.render(frame(dark));
  assert.ok(out.startsWith(dark.base + '\x1b[2J'), JSON.stringify(out.slice(0, 40)));
  const rest = out.slice((dark.base + '\x1b[2J').length);
  assert.equal(rest.split(' ').length - 1, W * H - 1, 'every cell but the last is written, as a space');
  assert.ok(rest.includes(dark.sgr[0]), 'the SGR (with bg) is emitted');
});

test('bg: spaces are painted in the bg palette (calm arm does not paint them)', () => {
  const r1 = createRenderer();
  assert.ok(r1.render(frame(dark)).includes(' '), 'bg palette writes spaces');
  const r2 = createRenderer();
  assert.ok(!r2.render(frame(calm)).replace('\x1b[2J', '').includes(' '), 'calm writes no spaces on a blank frame');
});

test('bg: the two-tone SGR carries both foreground and background; inverted swaps them', () => {
  assert.match(dark.sgr[0], /38;2;255;255;255/);
  assert.match(dark.sgr[0], /48;2;0;0;0/);
  assert.match(light.sgr[0], /38;2;0;0;0/);
  assert.match(light.sgr[0], /48;2;255;255;255/);
  assert.equal(dark.sgr.length, 1, 'a single entry');
  assert.equal(dark.bg, true);
});

test('bg: every non-empty diff frame starts with palette.base; an unchanged frame is empty', () => {
  const r = createRenderer();
  r.render(frame(dark));
  assert.equal(r.render(frame(dark)), '');
  const f = frame(dark);
  f.glyphs[5] = 0x2588;
  const out = r.render(f);
  assert.ok(out.startsWith(dark.base), JSON.stringify(out));
});

test('bg: leaving a bg palette sends ESC[0m before the next full repaint (calm-only output sends none: both arms)', () => {
  const r = createRenderer();
  r.render(frame(dark));
  r.invalidate();
  const out = r.render(frame(calm, 0x2588, 3));
  assert.ok(out.startsWith('\x1b[0m\x1b[2J'), JSON.stringify(out.slice(0, 20)));
  // the reset is sent once only
  r.invalidate();
  assert.ok(!r.render(frame(calm, 0x2588, 3)).includes('\x1b[0m'));
  // calm only: never
  const c = createRenderer();
  let all = c.render(frame(calm, 0x2588, 2));
  c.invalidate();
  all += c.render(frame(calm, 0x2588, 4));
  assert.ok(!all.includes('\x1b[0m'), 'no reset in calm-only output');
});

test('bg: changing between two bg palettes (invert) repaints with the new base', () => {
  const r = createRenderer();
  r.render(frame(dark));
  r.invalidate();
  const out = r.render(frame(light));
  assert.ok(out.startsWith(light.base + '\x1b[2J'));
  assert.ok(!out.startsWith('\x1b[0m'), 'still on a bg palette: no reset');
});

test('multi palette: 8 hues x 4 brightness = 32 entries plus UI entries; four named palettes', () => {
  assert.deepEqual(CHAOS_PALETTES.map((p) => p.id), ['neon', 'candy', 'ocean', 'fire']);
  for (const p of CHAOS_PALETTES) {
    const pal = makeMultiPalette(p.id, 'truecolor');
    assert.ok(pal.sgr.length >= 35, `${p.id} ${pal.sgr.length}`);
    assert.equal(pal.bg, undefined);
    assert.equal(new Set(pal.sgr.slice(0, 32)).size, 32, 'all 32 entries differ');
    assert.ok(pal.ui && pal.ui.text >= 32 && pal.ui.dim >= 32 && pal.ui.head >= 32);
  }
  assert.notEqual(makeMultiPalette('neon', 'truecolor').key, makeMultiPalette('candy', 'truecolor').key);
  assert.match(makeMultiPalette('fire', '256').sgr[0], /38;5;\d+m/);
});

test('two-tone in 256-colour mode is still strictly black and white', () => {
  const d = makeTwoTone(false, '256');
  assert.match(d.sgr[0], /38;5;231/);
  assert.match(d.sgr[0], /48;5;16/);
});
