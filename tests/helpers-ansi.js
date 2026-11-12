// An independent reader for the terminal bytes Drift writes (DRIFT-7 stage F). It knows nothing about the renderer: it is a small terminal that reads
// text and escape sequences and keeps a grid of cells (glyph, foreground, background), so a test can ask "what is on the screen" of a byte stream, either a
// live process's stdout or a captured .ansi file, and compare it with the frame the renderer was given.
//
// Understood: printable characters (written at the cursor, cursor moves right, never wraps: a write past the last column is counted in `overflow`),
// CSI r;c H / f (move), CSI 2 J (clear the screen to the current background), CSI ... m (SGR: 0, 38;2;r;g;b, 48;2;r;g;b, 38;5;n, 48;5;n, 39, 49, the
// 16 basic colours; bold and the rest are ignored), and the private modes (CSI ? ... h / l) which are skipped. Anything else is listed in `unknown`.
// Colours are 0xRRGGBB for truecolor, 0x1000000 | n for xterm-256 index n, 0x2000000 | code for a basic colour, -1 for the terminal's default.
export const COLOUR_256 = 0x1000000, COLOUR_BASIC = 0x2000000, DEFAULT = -1;

export function createScreen(cols, rows) {
  const n = cols * rows;
  const glyphs = new Uint16Array(n).fill(32), fg = new Int32Array(n).fill(DEFAULT), bg = new Int32Array(n).fill(DEFAULT);
  const s = { cols, rows, glyphs, fg, bg, x: 0, y: 0, overflow: 0, unknown: [], writes: 0, clears: 0, cursorHidden: false, altScreen: false };
  let curFg = DEFAULT, curBg = DEFAULT, pending = '';

  function sgr(params) {
    const p = params === '' ? [0] : params.split(';').map((v) => (v === '' ? 0 : Number(v)));
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === 0) { curFg = DEFAULT; curBg = DEFAULT; } else if (c === 38 || c === 48) {
        let v = DEFAULT;
        if (p[i + 1] === 2) { v = ((p[i + 2] & 255) << 16) | ((p[i + 3] & 255) << 8) | (p[i + 4] & 255); i += 4; } else if (p[i + 1] === 5) { v = COLOUR_256 | (p[i + 2] & 255); i += 2; } else s.unknown.push(`SGR ${params}`);
        if (c === 38) curFg = v; else curBg = v;
      } else if (c === 39) curFg = DEFAULT; else if (c === 49) curBg = DEFAULT;
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) curFg = COLOUR_BASIC | c;
      else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107)) curBg = COLOUR_BASIC | c;
      // 1, 2, 22 and the other attributes do not change a colour
    }
  }

  function csi(params, final) {
    if (params.startsWith('?')) { // private modes
      const on = final === 'h';
      for (const m of params.slice(1).split(';')) {
        if (m === '25') s.cursorHidden = !on;
        else if (m === '1049') s.altScreen = on;
      }
      return;
    }
    switch (final) {
      case 'm': sgr(params); break;
      case 'H': case 'f': {
        const [r, c] = params === '' ? [1, 1] : params.split(';').map((v) => (v === '' ? 1 : Number(v)));
        s.y = Math.max(0, Math.min(rows - 1, (r || 1) - 1)); s.x = Math.max(0, Math.min(cols - 1, ((c === undefined ? 1 : c) || 1) - 1));
        break;
      }
      case 'J':
        if (params === '2' || params === '') { glyphs.fill(32); fg.fill(DEFAULT); bg.fill(curBg); s.clears++; } else s.unknown.push(`CSI ${params}J`);
        break;
      default: s.unknown.push(`CSI ${params}${final}`);
    }
  }

  s.feed = (str) => {
    const text = pending + str;
    pending = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\x1b') {
        if (i + 1 >= text.length) { pending = text.slice(i); break; }
        if (text[i + 1] !== '[') { i++; continue; }
        let j = i + 2;
        while (j < text.length && ((text.charCodeAt(j) >= 0x30 && text.charCodeAt(j) <= 0x3F))) j++;
        if (j >= text.length) { pending = text.slice(i); break; }
        csi(text.slice(i + 2, j), text[j]);
        i = j;
        continue;
      }
      const code = text.charCodeAt(i);
      if (code === 10) { s.y = Math.min(rows - 1, s.y + 1); s.x = 0; continue; }
      if (code === 13) { s.x = 0; continue; }
      if (code < 32) continue;
      if (s.x >= cols || s.y >= rows) { s.overflow++; continue; }
      const k = s.y * cols + s.x;
      glyphs[k] = code; fg[k] = curFg; bg[k] = curBg; s.writes++;
      s.x++;
    }
  };
  s.row = (y) => { let t = ''; for (let x = 0; x < cols; x++) t += String.fromCharCode(glyphs[y * cols + x]); return t; };
  s.text = () => { const out = []; for (let y = 0; y < rows; y++) out.push(s.row(y)); return out.join('\n'); };
  return s;
}

// Read a whole byte stream (a string) into a fresh screen of cols x rows.
export function readAnsi(str, cols, rows) {
  const s = createScreen(cols, rows);
  s.feed(str);
  return s;
}

// Remove the escape sequences from a stream: its characters in the order they were written.
export const stripSgr = (str) => str.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
