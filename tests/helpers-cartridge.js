// Fixture builders for the cartridge suites (DRIFT-4). Everything is built in code inside fs.mkdtemp
// folders, so no banned glyph, CRLF file or scene code is committed as a fixture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const made = [];
export function tmpRoot(prefix = 'drift-cart-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}
process.on('exit', () => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp folder */ } } });

// A plain ASCII label that is inside the 24x10 limit.
export const LABEL = ['+----------------------+', '|        FIXTURE       |', '+----------------------+'].join('\n') + '\n';

// Write files into <root>/<id>/. A value that is an object is written as JSON; a string as is.
export function writeCart(root, id, files) {
  const dir = path.join(root, id);
  for (const [rel, v] of Object.entries(files)) {
    const f = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  }
  return dir;
}

// A valid data-only manifest (one builtin experimental scene, one dissolve program).
export function dataManifest(id, over = {}) {
  return {
    format: 1, id, title: 'Data ' + id, version: '1.0.0', author: 'Test', blurb: 'A data-only test cartridge.',
    runtime: 'cartridge',
    scenes: [{ id: 'sandbox', kind: 'builtin', ref: 'sand' }],
    programs: [{ id: 'main', title: 'Main', transition: 'dissolve', scenes: ['sandbox'] }],
    start: 'main',
    ...over,
  };
}

export function lockedManifest(id, over = {}) {
  return { format: 1, id, title: 'Locked ' + id, version: '0.1.0', author: 'Test', blurb: 'Locked test cartridge.', locked: true, code: 'TS-01', facts: ['Status: soon'], ...over };
}

// ---- scene sources for the trusted fixture cartridge (self-contained: no imports)

function fieldSource(id, kx, ky, vt, vu) {
  return [
    'function ' + id.replace(/-/g, '_') + '(t, w, h, params) {',
    '  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;',
    '  const n = W * H;',
    '  const o = params && params.out;',
    '  const out = o instanceof Uint8Array && o.length === n ? o : new Uint8Array(n);',
    '  const T = Number.isFinite(t) ? t : 0;',
    '  const ph = (params && Number.isFinite(params.seed) ? params.seed | 0 : 1) * 0.7;',
    '  for (let y = 0; y < H; y++) {',
    '    for (let x = 0; x < W; x++) {',
    '      const v = 0.5 + 0.2 * Math.sin(x * ' + kx + ' + T * ' + vt + ' + ph) * Math.cos(y * ' + ky + ' - T * ' + vu + ' + ph);',
    '      out[y * W + x] = Math.round(v * 255);',
    '    }',
    '  }',
    '  return out;',
    '}',
    id.replace(/-/g, '_') + ".id = '" + id + "';",
    'export default ' + id.replace(/-/g, '_') + ';',
    '',
  ].join('\n');
}

const CELLS_SOURCE = [
  "const SET = ' .:-=+*#';",
  'function tide(t, w, h, params) {',
  '  const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;',
  '  const g = params.glyphs, c = params.colours;',
  '  const T = Number.isFinite(t) ? t : 0;',
  '  const ph = (Number.isFinite(params.seed) ? params.seed | 0 : 1) * 1.3;',
  '  for (let y = 0; y < H; y++) {',
  '    for (let x = 0; x < W; x++) {',
  '      const v = 0.5 + 0.5 * Math.sin(x * 0.2 + y * 0.35 + T * 0.25 + ph);',
  '      const k = Math.floor(v * 7.999);',
  '      g[y * W + x] = SET.charCodeAt(k);',
  '      c[y * W + x] = k === 0 ? 0 : 6 + (k >> 1);',
  '    }',
  '  }',
  '}',
  "tide.id = 'tide';",
  "tide.kind = 'cells';",
  'export default tide;',
  '',
].join('\n');

const SIM_SOURCE = [
  'function rnd(s) {',
  '  let a = (s.rs = (s.rs + 0x6d2b79f5) | 0);',
  '  let t = Math.imul(a ^ (a >>> 15), 1 | a);',
  '  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;',
  '  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;',
  '}',
  'const drops = {',
  "  id: 'drops',",
  "  kind: 'sim',",
  '  init(w, h, seed) {',
  '    const W = w > 0 ? Math.floor(w) : 0, H = h > 0 ? Math.floor(h) : 0;',
  '    const s = { w: W, h: H, rs: (seed | 0) ^ 0x5bd1e995, d: [] };',
  '    const n = W > 0 && H > 0 ? Math.max(1, Math.floor((W * H) / 60)) : 0;',
  '    for (let i = 0; i < n; i++) s.d.push({ x: Math.floor(rnd(s) * W), y: rnd(s) * H, v: 2 + rnd(s) * 4 });',
  '    return s;',
  '  },',
  '  step(s) {',
  '    for (const d of s.d) { d.y += d.v / 30; if (d.y >= s.h) d.y -= s.h; }',
  '  },',
  '  draw(s, p) {',
  '    p.glyphs.fill(32);',
  '    p.colours.fill(0);',
  '    for (const d of s.d) {',
  '      const row = Math.floor(d.y);',
  '      if (row >= 0 && row < s.h && d.x < s.w) { p.glyphs[row * s.w + d.x] = 124; p.colours[row * s.w + d.x] = 8 + (d.x % 5); }',
  '    }',
  '  },',
  '};',
  'export default drops;',
  '',
].join('\n');

export const NOTE_TEXT = ['title: Fixture note', '---', 'Hello from the fixture', 'cartridge, built in a temp folder', '', 'Second card', 'the end', ''].join('\n');

// A trusted cartridge that exercises every scene kind: two field scenes, a cells scene, a sim, a text
// scene, an experimental builtin and a calm builtin. Returns the folder.
export function makeFixtureCartridge(root, id = 'fixture') {
  return writeCart(root, id, {
    'manifest.json': {
      format: 1, id, title: 'Fixture', version: '1.0.0', author: 'Test', blurb: 'Every scene kind, for the checks.',
      runtime: 'cartridge', labelHue: '#7FB069',
      scenes: [
        { id: 'haze', kind: 'field', title: 'Haze' },
        { id: 'swell', kind: 'field', title: 'Swell' },
        { id: 'tide', kind: 'cells', title: 'Tide' },
        { id: 'drops', kind: 'sim', title: 'Drops' },
        { id: 'note', kind: 'text', title: 'Note' },
        { id: 'sandbox', kind: 'builtin', ref: 'sand' },
        { id: 'plasma-ref', kind: 'builtin', ref: 'plasma' },
      ],
      programs: [
        { id: 'mix', title: 'Mix', transition: 'dissolve', scenes: ['tide', 'drops', 'note', 'sandbox'], sceneSeconds: 30 },
        { id: 'calm', title: 'Calm', transition: 'crossfade', scenes: ['haze', 'swell', 'plasma-ref'], sceneSeconds: 40, fadeSeconds: 10 },
      ],
      start: 'mix',
      menu: [{ label: 'Mix', program: 'mix' }, { label: 'Calm', program: 'calm' }, { label: 'Eject', action: 'eject' }],
    },
    'label.txt': LABEL,
    'skin.json': { palette: { hue: '#7FB069', colours: ['#FF6B6B', '#4ECDC4'], bg: '#0B140C', ui: { accent: 17 } } },
    'scenes/haze.js': fieldSource('haze', 0.16, 0.3, 0.2, 0.15),
    'scenes/swell.js': fieldSource('swell', 0.09, 0.22, 0.12, 0.18),
    'scenes/tide.js': CELLS_SOURCE,
    'scenes/drops.js': SIM_SOURCE,
    'scenes/note.txt': NOTE_TEXT,
  });
}
