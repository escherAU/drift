// DRIFT-9 part 3 (b): flash-menu-cortex-rosette-clock.test.js again, in 256 colours (the app told it has no truecolor, so it draws 256-colour output; the screen is read back by the independent
// terminal reader). A separate file so that the two modes run side by side (node runs test files in parallel). See helpers-flash-modes.js.
process.env.DRIFT_FLASH_MODE = '256';
await import('./flash-menu-cortex-rosette-clock.test.js');
