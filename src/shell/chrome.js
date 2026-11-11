// The frame a skin draws around the running cartridge (DRIFT-4). Pure.
//
//   drawChrome(frame, skin)
//
// Draws skin.frame.glyphs (8 characters: tl t tr r br b bl l; the default box when absent) as a one-cell border
// around the whole frame, in palette index skin.frame.colour (or the dim UI shade). skin.frame.title is set in the
// top edge in the head shade with a space on each side; only when the top glyph is '═' or '━' it is set between
// caps, '╡ TITLE ╞' (the same rule as the menu's list frame, see ui.js titleCapsOf). A bottom-edge ornament can be
// added through chromeOrnament(skin). Whether the chrome is drawn at all (skin.frame.show: never | menu | always)
// is the caller's decision. The boot's last zoom frame IS this border. Only the border cells are written.
import { drawBox, putEdgeTitle, put, lenOf, uiOf } from './ui.js';

// The ornament set into the bottom edge, centred (skin.frame.ornament, a short text such as 'Ψ · Δ · Ξ'); empty without one.
export function chromeOrnament(skin) {
  return (skin && skin.frame && skin.frame.ornament) || '';
}

// Text centred in the bottom edge of the frame with a space on each side, clipped to the edge.
export function drawEdgeOrnament(frame, text, shade) {
  const room = frame.cols - 6;
  const t = [...String(text || '')].slice(0, Math.max(0, room - 2)).join('');
  if (room <= 2 || t === '') return;
  const s = ' ' + t + ' ';
  const x = Math.floor((frame.cols - lenOf(s)) / 2);
  // every cell of ' text ' is written: the padding spaces and any spaces in the text are blanks, not the border
  let k = 0;
  for (const ch of s) put(frame, x + k++, frame.rows - 1, ch.codePointAt(0), shade);
}

export function drawChrome(frame, skin) {
  if (frame.cols < 4 || frame.rows < 3) return;
  const fr = skin.frame || {};
  const ui = uiOf(skin);
  const shade = fr.colour !== undefined ? fr.colour : ui.dim;
  drawBox(frame, 0, 0, frame.cols, frame.rows, fr.glyphs, shade);
  if (fr.title) putEdgeTitle(frame, 0, 0, frame.cols, fr.title, fr.glyphs, shade, ui.head);
  const ornament = chromeOrnament(skin);
  if (ornament) drawEdgeOrnament(frame, ornament, shade);
}

export { lenOf };
