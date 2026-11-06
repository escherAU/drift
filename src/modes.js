// The four modes, in `m` cycle order. Calm is the default and is exactly drift v1.
export const MODES = ['calm', 'chaos', 'contrast', 'experimental'];
export const DEFAULT_MODE = 'calm';
export const MODE_LABELS = {
  calm: 'calm',
  chaos: 'chaos',
  contrast: 'high contrast',
  experimental: 'experimental',
};

export function isMode(m) { return MODES.includes(m); }
export function nextMode(m) { return MODES[(MODES.indexOf(m) + 1) % MODES.length]; }
