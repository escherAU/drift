// Text scenes (DRIFT-4): a cut scene made of cards of text, as a plain data file.
//
//   title: The Glade
//   ---
//   First card, first line
//   first card, second line
//
//   Second card
//
// Line 1 is `title: X`, line 2 is `---`, then cards separated by blank lines. A card types out at
// 24 characters a second, holds 4 s, fades over 1 s (ramp levels 15 down to 2), rests 0.5 s, and the
// next card follows; after the last card the scene loops. It is a 'cells' scene that uses colours
// 0-15 only, is pure in t - t0 (t when the composer gives no t0), and ignores the seed.
import { LIMITS, firstBadGlyph } from './schema.js';

export const TYPE_CPS = 24;
export const HOLD_SECONDS = 4;
export const FADE_SECONDS = 1;
export const REST_SECONDS = 0.5;
const TOP_LEVEL = 15, BOTTOM_LEVEL = 2;

const fail = (reason) => ({ ok: false, reason });
const hex4 = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

// -> { ok: true, title, cards: string[][] } or { ok: false, reason }
export function parseTextScene(text) {
  if (typeof text !== 'string') return fail('file is not text');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > LIMITS.textBytes) return fail(`text scene is ${bytes} bytes, max ${LIMITS.textBytes}`);
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = s.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  const m = /^title:[ ]*(.+)$/.exec(lines[0] || '');
  if (!m) return fail("line 1 must be 'title: <name>'");
  const title = m[1];
  if ([...title].length > LIMITS.sceneTitle) return fail(`title is ${[...title].length} characters, max ${LIMITS.sceneTitle}`);
  if (lines[1] !== '---') return fail("line 2 must be '---'");
  const cards = [];
  let cur = [];
  for (let i = 2; i <= lines.length; i++) {
    const l = i < lines.length ? lines[i] : '';
    if (l === '') {
      if (cur.length) { cards.push(cur); cur = []; }
      continue;
    }
    const bad = firstBadGlyph(l);
    if (bad !== null) return fail(`line ${i + 1} has ${hex4(bad)}, which is not an allowed glyph`);
    const n = [...l].length;
    if (n > LIMITS.textChars) return fail(`line ${i + 1} is ${n} characters, max ${LIMITS.textChars}`);
    cur.push(l);
    if (cur.length > LIMITS.textLines) return fail(`card ${cards.length + 1} has more than ${LIMITS.textLines} lines`);
  }
  if (cards.length === 0) return fail('the text scene has no cards');
  if (cards.length > LIMITS.textCards) return fail(`the text scene has ${cards.length} cards, max ${LIMITS.textCards}`);
  return { ok: true, title, cards };
}

// parsed: the result of parseTextScene. Returns a 'cells' scene function.
export function makeTextScene(parsed, { id = 'text' } = {}) {
  const cards = parsed.cards.map((lines) => {
    const rows = lines.map((l) => Array.from(l, (ch) => ch.codePointAt(0)));
    const chars = rows.reduce((n, r) => n + r.length, 0);
    return { rows, chars, typeEnd: chars / TYPE_CPS, holdEnd: chars / TYPE_CPS + HOLD_SECONDS, fadeEnd: chars / TYPE_CPS + HOLD_SECONDS + FADE_SECONDS, total: chars / TYPE_CPS + HOLD_SECONDS + FADE_SECONDS + REST_SECONDS };
  });
  const cycle = cards.reduce((n, c) => n + c.total, 0);

  function scene(t, w, h, params) {
    const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;
    const g = params.glyphs, c = params.colours;
    g.fill(32);
    c.fill(0);
    if (W === 0 || H === 0) return;
    const t0 = params && Number.isFinite(params.t0) ? params.t0 : 0;
    let local = (Number.isFinite(t) ? t : 0) - t0;
    if (!(local > 0)) local = 0;
    local %= cycle;
    let card = cards[0];
    for (const k of cards) {
      if (local < k.total) { card = k; break; }
      local -= k.total;
    }
    if (local >= card.fadeEnd) return; // resting between cards
    let level = TOP_LEVEL;
    let shown = card.chars;
    if (local < card.typeEnd) shown = Math.floor(local * TYPE_CPS);
    else if (local >= card.holdEnd) level = TOP_LEVEL - Math.round((TOP_LEVEL - BOTTOM_LEVEL) * ((local - card.holdEnd) / FADE_SECONDS));
    const n = card.rows.length;
    const top = Math.max(0, Math.floor((H - n) / 2));
    let count = 0;
    for (let r = 0; r < n; r++) {
      const row = card.rows[r];
      const y = top + r;
      const left = Math.floor((W - row.length) / 2);
      for (let i = 0; i < row.length; i++) {
        if (count++ >= shown) return;
        const x = left + i;
        if (y >= H || x < 0 || x >= W || row[i] === 32) continue;
        g[y * W + x] = row[i];
        c[y * W + x] = level;
      }
    }
  }
  scene.id = id;
  scene.kind = 'cells';
  scene.title = parsed.title;
  scene.cycleSeconds = cycle;
  return scene;
}
