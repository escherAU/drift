// DRIFT-7 step 0: the renderer's 256-colour lookup is red-safe. A source whose linear red share r/(r+g+b) is under
// 0.8 (safeHue keeps 0.75 or less) never lands on a colour 16-255 whose share is 0.8 or more (the WCAG saturated-red
// threshold); a source that really is saturated red may still land on a red (no over-exclusion).
import test from 'node:test';
import assert from 'node:assert/strict';
import { nearest256 } from '../src/renderer.js';
import { rgbOf256, runControl, strobe, redPulse, safeKaleidoscope, CONTROL_COLS, CONTROL_ROWS } from './helpers-flash-controls.js';

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function share(rgb) {
  const r = lin((rgb >> 16) & 255), g = lin((rgb >> 8) & 255), b = lin(rgb & 255);
  const s = r + g + b;
  return s === 0 ? 0 : r / s;
}
const e = (q) => (q << 3) | (q >> 2);
const keyRgb = (k) => (e((k >> 10) & 31) << 16) | (e((k >> 5) & 31) << 8) | e(k & 31);

test('red-safe 256: across the whole 15-bit table no source under 0.8 red share maps to a candidate at 0.8 or more', () => {
  let low = 0, high = 0, bad = 0, firstBad = null;
  for (let k = 0; k < 32768; k++) {
    const src = keyRgb(k);
    const idx = nearest256(src);
    assert.ok(idx >= 16 && idx <= 255);
    if (share(src) < 0.8) {
      low++;
      if (share(rgbOf256(idx)) >= 0.8) { bad++; firstBad ??= src.toString(16); }
    } else high++;
  }
  assert.equal(bad, 0, `first offender #${firstBad}`);
  assert.ok(low > 30000 && high > 100, `both arms populated (${low} low, ${high} high)`);
});

test('red-safe 256 (arm 2): a source that really is saturated red may still map to a red', () => {
  for (const src of [0xff0000, 0xd00000, 0x900000, 0xe03030, 0xff2000]) {
    assert.ok(share(src) >= 0.8, `fixture #${src.toString(16)} is saturated red`);
    assert.ok(share(rgbOf256(nearest256(src))) >= 0.8, `#${src.toString(16)} keeps a red`);
  }
  let reds = 0;
  for (let k = 0; k < 32768; k++) if (share(keyRgb(k)) >= 0.8 && share(rgbOf256(nearest256(keyRgb(k)))) >= 0.8) reds++;
  assert.ok(reds > 100, 'most saturated-red sources still land on a red');
});

test('red-safe 256: neutrals are untouched (black, white, mid grey, a cyan keep their nearest colour)', () => {
  assert.equal(nearest256(0x000000), 16);
  assert.equal(nearest256(0xffffff), 231);
  assert.equal(nearest256(0x808080), 102);
  assert.equal(rgbOf256(nearest256(0x3fe8ff)), 0xafd7ff);
});

const failedRules = (rep) => ['l1.x1', 'l1.x4', 'l2.x1', 'l2.x4', 'l3', 'r.x1', 'r.x4'].filter((r) => { const [a, b] = r.split('.'); return !(b ? rep[a][b] : rep[a]).pass; });

test('red-safe 256: the safeHue kaleidoscope passes every rule at 1x and 4x on 256 colours, at three sizes', () => {
  for (const [cols, rows] of [[CONTROL_COLS, CONTROL_ROWS], [80, 24], [240, 67]]) {
    const rep = runControl(safeKaleidoscope(cols, rows), { cols, rows, reduce256: true, seconds: 20 });
    console.log(`# 256 safeHue ${cols}x${rows}: r.x1=${(rep.r.x1.worstFraction * 100).toFixed(1)}% r.x4=${(rep.r.x4.worstFraction * 100).toFixed(1)}% fails: ${failedRules(rep).join(',') || 'none'}`);
    assert.deepEqual(failedRules(rep), [], `${cols}x${rows}`);
  }
});

test('red-safe 256 (both arms of the controls): strobe still fails L1/L2, the red pulse still fails R, on 256 colours', () => {
  const s = runControl(strobe(CONTROL_COLS, CONTROL_ROWS), { reduce256: true });
  const sf = failedRules(s);
  for (const r of ['l1.x1', 'l1.x4', 'l2.x1', 'l2.x4']) assert.ok(sf.includes(r), `strobe fails ${r}`);
  assert.ok(!sf.includes('r.x1'), 'strobe is not a red failure');
  const p = runControl(redPulse(CONTROL_COLS, CONTROL_ROWS), { reduce256: true });
  const pf = failedRules(p);
  assert.ok(pf.includes('r.x1') && pf.includes('r.x4'), `red pulse fails R at both speeds: ${pf}`);
});
