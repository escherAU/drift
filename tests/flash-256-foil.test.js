// DRIFT-8 C2: foil-flash.test.js again, in 256 colours (the shell built with cmode '256', every frame shown to the meter through the 256-colour reducer).
// A separate file so that the two modes run side by side (node runs test files in parallel). See helpers-flash-modes.js.
process.env.DRIFT_FLASH_MODE = '256';
await import('./foil-flash.test.js');
