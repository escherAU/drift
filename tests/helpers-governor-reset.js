// DRIFT-13 correction 2: the text edits that put the governor's old reset ordering back into a COPY of src/governor.js (tests/governor-reset-states.test.js applies them to a temporary file,
// tests/governor-reset-app.test.js to a temporary copy of src/). Each pair is [from, to]; `from` must occur exactly once in the shipped file (the callers assert it).
export const OLD_ORDERING = [
  ["let mode = 'hard', paintNo = 0, stamp = 0;", "let mode = 'hard', stale = null, paintNo = 0, stamp = 0;"],
  ["if (mode === 'hard') return; // hard dominates any later request before its paint", "if (mode === 'hard') { stale = opts.other ? 'other' : 'soft'; return; } // hard dominates any later request before its paint"],
  ["      mode = 'steady'; // the paint consumes the hard state", "      mode = stale || 'steady'; stale = null; // the paint consumes the hard state"],
];
export const NO_HARD_DOMINANCE = [["if (mode === 'hard') return; // hard dominates any later request before its paint", "if (mode === 'hard') mode = 'steady';"]];
export const NO_OTHER_DOMINANCE = [['if (RANK[want] > RANK[mode]) mode = want;', "if (RANK[want] > RANK[mode] || (want === 'soft' && mode === 'other')) mode = want;"]];
export const NO_BACK_DOMINANCE = [['if (RANK[want] > RANK[mode]) mode = want;', "if (RANK[want] > RANK[mode] || (want === 'other' && mode === 'back')) mode = want;"]];
export const BACK_COUNTS_ONCE = [["const twice = mode === 'back';", 'const twice = false;']];
export const NO_CONSUME = [["      mode = 'steady'; // the paint consumes the soft, other or back state", '']];
