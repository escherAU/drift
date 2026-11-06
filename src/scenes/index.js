import squiggle from './squiggle.js';
import sunburst from './sunburst.js';
import plasma from './plasma.js';
import ripples from './ripples.js';
import rain from './rain.js';

// Order is the play order; the scheduler wraps after the last.
export const SCENES = [squiggle, sunburst, plasma, ripples, rain];
export const SCENE_IDS = SCENES.map((s) => s.id);
