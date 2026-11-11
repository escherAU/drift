// Scene-local time. The cell composer hands a scene the program's clock (t) and, in params.t0, the clock value when the
// scene became active; a scene that runs a story (the fight, the cut scene) counts from its own start. Without t0 (the
// shared test renderer) the clock is used as it is. Never negative, never NaN.
export function sceneTime(t, params) {
  const T = Number.isFinite(t) ? t : 0;
  const t0 = params && Number.isFinite(params.t0) ? params.t0 : 0;
  return Math.max(0, T - t0);
}

// Seed to an integer, default 1.
export function seedOf(params) {
  return params && Number.isFinite(params.seed) ? params.seed | 0 : 1;
}
