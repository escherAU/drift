// Tiny JSON config: remembers the colour, the last-used mode, the chaos palette and the
// high-contrast polarity. Never throws, never writes anywhere except the one path it is
// given. Each field is validated on its own with its own fallback, so one bad field never
// costs the others; a v1 file ({"colour": ...}) loads as calm.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PRESETS, DEFAULT_PRESET, CHAOS_PALETTES, DEFAULT_CHAOS_PALETTE } from './color.js';
import { MODES, DEFAULT_MODE } from './modes.js';

export const DEFAULT_CONFIG = Object.freeze({
  colour: DEFAULT_PRESET,
  mode: DEFAULT_MODE,
  chaosPalette: DEFAULT_CHAOS_PALETTE,
  invert: false,
});

export function defaultConfigPath(env = process.env) {
  if (env.DRIFT_CONFIG) return env.DRIFT_CONFIG;
  const base = env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'drift', 'config.json');
}

// Any object in, a complete valid config out.
export function validateConfig(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    colour: typeof r.colour === 'string' && PRESETS.some((p) => p.id === r.colour) ? r.colour : DEFAULT_CONFIG.colour,
    mode: typeof r.mode === 'string' && MODES.includes(r.mode) ? r.mode : DEFAULT_CONFIG.mode,
    chaosPalette: typeof r.chaosPalette === 'string' && CHAOS_PALETTES.some((p) => p.id === r.chaosPalette) ? r.chaosPalette : DEFAULT_CONFIG.chaosPalette,
    invert: r.invert === true,
  };
}

export function loadConfig(file) {
  try {
    return validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch { /* missing, unreadable or corrupt: use defaults */ }
  return { ...DEFAULT_CONFIG };
}

// Write text to the file atomically: a temp file in the SAME directory, then a rename over the
// target (a rename inside one directory is atomic on Windows and POSIX; a reader sees the old
// file or the new one, never half of it). Returns true when written, false on any failure.
function writeAtomic(file, text) {
  const tmp = path.join(path.dirname(file), '.' + path.basename(file) + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, text);
    let err = null;
    for (let i = 0; i < 4; i++) { // Windows can refuse a rename for a moment while another window reads the target
      try { fs.renameSync(tmp, file); err = null; break; } catch (e) { err = e; }
    }
    if (err) throw err;
    return true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    return false;
  }
}

// Returns true when written, false on any failure.
export function saveConfig(file, cfg) {
  try {
    return writeAtomic(file, JSON.stringify(validateConfig(cfg), null, 2) + '\n');
  } catch {
    return false;
  }
}

// Read the file again NOW, change only the fields in the patch (an invalid value is ignored, so the
// field keeps what the file had), write atomically. This is what the app calls on a keypress, so two
// windows sharing one file never roll each other's fields back. Never throws.
export function updateConfig(file, patch) {
  try {
    const cur = loadConfig(file);
    const p = patch && typeof patch === 'object' ? patch : {};
    const check = validateConfig({ ...DEFAULT_CONFIG, ...p });
    const next = { ...cur };
    for (const k of Object.keys(DEFAULT_CONFIG)) {
      if (!(k in p)) continue;
      const valid = k === 'invert' ? typeof p[k] === 'boolean' : check[k] === p[k];
      if (valid) next[k] = p[k];
    }
    return saveConfig(file, next);
  } catch {
    return false;
  }
}
