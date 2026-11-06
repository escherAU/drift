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

// Returns true when written, false on any failure.
export function saveConfig(file, cfg) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(validateConfig(cfg), null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}
