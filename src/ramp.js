// Density ramp and band hysteresis.
//
// Intensity (0..255) maps to one of BANDS glyphs ( " ·:░▒▓█" ) and, separately,
// to one of LEVELS colour-brightness steps. Both mappings are monotonic. The
// Hysteresis helper keeps a per-cell state so a value jittering a little
// around a boundary does not flip the glyph every frame.

export const RAMP_CHARS = ' ·:░▒▓█';
export const BANDS = RAMP_CHARS.length; // 7
export const LEVELS = 16;

export const RAMP_CODES = Uint16Array.from([...RAMP_CHARS].map((c) => c.codePointAt(0)));

export function bandOf(v) {
  const b = Math.floor((v * BANDS) / 256);
  return b < 0 ? 0 : b >= BANDS ? BANDS - 1 : b;
}

export function levelOf(v) {
  const l = Math.floor((v * LEVELS) / 256);
  return l < 0 ? 0 : l >= LEVELS ? LEVELS - 1 : l;
}

// Per-cell banding with a dead zone of `margin` intensity units either side
// of each boundary. The first update after creation (or reset) is stateless.
export function createHysteresis(size, levels, margin) {
  const state = new Uint8Array(size);
  const edge = new Float64Array(levels + 1);
  for (let k = 0; k <= levels; k++) edge[k] = (k * 256) / levels;
  edge[0] = -Infinity;
  edge[levels] = Infinity;
  const toBand = (v) => {
    const b = Math.floor((v * levels) / 256);
    return b < 0 ? 0 : b >= levels ? levels - 1 : b;
  };
  let primed = false;
  return {
    state,
    levels,
    reset() { primed = false; },
    update(field) {
      const n = Math.min(size, field.length);
      if (!primed) {
        for (let i = 0; i < n; i++) state[i] = toBand(field[i]);
        primed = true;
        return state;
      }
      for (let i = 0; i < n; i++) {
        const v = field[i];
        const b = state[i];
        if (v >= edge[b + 1] + margin) state[i] = toBand(v - margin);
        else if (v < edge[b] - margin) state[i] = toBand(v + margin);
      }
      return state;
    },
  };
}
