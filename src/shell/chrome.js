// The frame a skin draws around the running cartridge (DRIFT-4). A stub: simple but correct. Pure.
//
//   drawChrome(frame, skin)
//
// Draws skin.frame.glyphs (8 characters: tl t tr r br b bl l) as a one-cell border around the whole
// frame, with skin.frame.title in the top edge, in palette index skin.frame.colour (or ui.dim).
// Whether it is drawn at all (skin.frame.show: never | menu | always) is the caller's decision.
// Only the border cells are written.
import { drawBox, put, lenOf, uiOf } from './ui.js';

export function drawChrome(frame, skin) {
  if (frame.cols < 4 || frame.rows < 3) return;
  const fr = skin.frame || {};
  const ui = uiOf(skin);
  const shade = fr.colour !== undefined ? fr.colour : ui.dim;
  drawBox(frame, 0, 0, frame.cols, frame.rows, fr.glyphs, shade);
  if (fr.title) {
    const room = frame.cols - 6;
    if (room > 0) {
      // the title sits in a gap of the edge: its padding spaces are blanks, not the border showing through
      const s = ' ' + [...fr.title].slice(0, Math.max(0, room - 2)).join('') + ' ';
      let k = 0;
      for (const ch of s) { if (k >= room) break; put(frame, 2 + k, 0, ch.codePointAt(0), ui.head); k++; }
    }
  }
}

export { lenOf };
