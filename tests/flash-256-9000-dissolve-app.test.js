// DRIFT-8 r2: driftman-9000-dissolve-app.test.js again, in 256 colours (the app is built without COLORTERM, so it writes xterm-256 indexes, which the terminal reader
// decodes). A separate file so that the two modes run side by side (node runs test files in parallel). See helpers-flash-modes.js.
process.env.DRIFT_FLASH_MODE = '256';
await import('./driftman-9000-dissolve-app.test.js');
