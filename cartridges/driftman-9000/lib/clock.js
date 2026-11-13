// Scene-local time. The cell composer hands a scene the program's clock (t) and, in params.t0, the clock value when the
// scene became active; a scene that runs a story (the fight, the cut scene) counts from its own start. Without t0 (the
// shared test renderer) the clock is used as it is. Never negative, never NaN.
export function sceneTime(t, params) {
  const T = Number.isFinite(t) ? t : 0;
  const t0 = params && Number.isFinite(params.t0) ? params.t0 : 0;
  return Math.max(0, T - t0);
}

// Scene-local COLOUR time (DRIFT-8 C3). The runtime keeps a second clock, tc, that runs at min(speed, 1) of real time (it never runs
// faster than the wall clock, so a hue that drifts with it turns at its 1x rate at every speed). The cell composer hands a scene
// params.tc and params.tc0 (the tc when the scene became active), exactly as it hands t and t0, so a vision entered mid-program
// starts its colour clock at 0 in its own frame. Every GLOBAL hue drift reads this; motion (geometry, positions, rotation) reads
// sceneTime. Without a tc (the shared test renderer, a caller that predates the colour clock) it is the scene time, which is what
// tc is at 1x. Never negative, never NaN.
export function colourTime(t, params) {
  if (!(params && Number.isFinite(params.tc))) return sceneTime(t, params);
  const tc0 = Number.isFinite(params.tc0) ? params.tc0 : 0;
  return Math.max(0, params.tc - tc0);
}

// Seed to an integer, default 1.
export function seedOf(params) {
  return params && Number.isFinite(params.seed) ? params.seed | 0 : 1;
}
