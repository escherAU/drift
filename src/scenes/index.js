import squiggle from './squiggle.js';
import sunburst from './sunburst.js';
import plasma from './plasma.js';
import ripples from './ripples.js';
import rain from './rain.js';
import glyphrain from './glyphrain.js';
import life from './life.js';
import bounce from './bounce.js';
import swarm from './swarm.js';
import glitch from './glitch.js';
import fireworks from './fireworks.js';
import vortex from './vortex.js';
import { MODES } from '../modes.js';

// Order is the play order; the scheduler wraps after the last.
export const SCENES = [squiggle, sunburst, plasma, ripples, rain];
export const SCENE_IDS = SCENES.map((s) => s.id);

// One playlist per mode. Calm is exactly the v1 list. Later slices add scenes to the
// other three; the shared non-calm test suite picks them up from here automatically.
export const PLAYLISTS = {
  calm: SCENES,
  chaos: [glyphrain, swarm, glitch, fireworks, vortex],
  contrast: [life],
  experimental: [bounce],
};

export function allSceneIds() {
  return MODES.flatMap((m) => PLAYLISTS[m].map((s) => s.id));
}

// Find a scene by id in any playlist: { mode, index } or null.
export function findScene(name, playlists = PLAYLISTS) {
  const id = String(name).toLowerCase();
  for (const mode of MODES) {
    const index = playlists[mode].findIndex((s) => s.id === id);
    if (index >= 0) return { mode, index };
  }
  return null;
}
