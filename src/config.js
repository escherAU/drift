// Tiny JSON config: remembers the last colour. Never throws, never writes
// anywhere except the one path it is given.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PRESETS, DEFAULT_PRESET } from './color.js';

export const DEFAULT_CONFIG = Object.freeze({ colour: DEFAULT_PRESET });

export function defaultConfigPath(env = process.env) {
  if (env.DRIFT_CONFIG) return env.DRIFT_CONFIG;
  const base = env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'drift', 'config.json');
}

export function loadConfig(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const ok = typeof raw.colour === 'string' && PRESETS.some((p) => p.id === raw.colour);
      return { colour: ok ? raw.colour : DEFAULT_CONFIG.colour };
    }
  } catch { /* missing, unreadable or corrupt: use defaults */ }
  return { ...DEFAULT_CONFIG };
}

// Returns true when written, false on any failure.
export function saveConfig(file, cfg) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ colour: cfg.colour }, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}
