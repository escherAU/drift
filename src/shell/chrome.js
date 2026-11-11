// The frame a skin draws around the running cartridge (DRIFT-4). A stub: simple but correct. Pure.
//
//   drawChrome(frame, skin)
//
// Draws skin.frame.glyphs (8 characters: tl t tr r br b bl l) as a one-cell border around the whole
// frame, with skin.frame.title in the top edge, in palette index skin.frame.colour (or ui.dim).
// Whether it is drawn at all (skin.frame.show: never | menu | always) is the caller's decision.
// Only the border cells are written.
import { drawBox, putText, lenOf } from './ui.js';

export function drawChrome(frame, skin) {
  if (frame.cols < 4 || frame.rows < 3) return;
  const fr = skin.frame || {};
  const shade = fr.colour !== undefined ? fr.colour : skin.palette.ui.dim;
  drawBox(frame, 0, 0, frame.cols, frame.rows, fr.glyphs, shade);
  if (fr.title) {
    const room = frame.cols - 6;
    if (room > 0) putText(frame, 2, 0, ' ' + [...fr.title].slice(0, Math.max(0, room - 2)).join('') + ' ', skin.palette.ui.head, room);
  }
}

export { lenOf };
