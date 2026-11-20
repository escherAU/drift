// DRIFT-9 S2: what every file's new clock arms share. An arm runs one flow of the file, on its worst known case, on the q156 clock or the jitter clock (tests/helpers-clock.js)
// and is judged by the five rules at the viewer's 1x (L1, L2, L3, R and the colour rule C) at their own limits: nothing is loosened for a clock.
// The cost is held by COUNT, not by time: clockArm() counts the frames the meters read while an arm runs (meterStats in helpers-flash.js), and a last test in the file asserts that
// the arms read at most CLOCK_ARM_SHARE (15 %) of the frames the file's other arms read.
import assert from 'node:assert/strict';
import { meterStats, failedRules, ruleOf, X1_RULE_IDS } from './helpers-flash.js';

export const CLOCK_ARM_SHARE = 0.15;
const arm = { frames: 0, runs: 0 };

export async function clockArm(fn) {
  const before = meterStats.frames;
  try { return await fn(); } finally { arm.frames += meterStats.frames - before; arm.runs++; }
}

// every X1 rule at its limit; the message carries each failing rule's number
export function judgeX1(rep, label) {
  const bad = failedRules(rep, { only: X1_RULE_IDS });
  const nums = X1_RULE_IDS.map((id) => `${id} ${(ruleOf(rep, id).worstFraction * 100).toFixed(2)}`).join(' ');
  assert.deepEqual(bad, [], `${label}: ${nums}`);
}

export function assertArmCost(label, share = CLOCK_ARM_SHARE) {
  const other = meterStats.frames - arm.frames;
  assert.ok(arm.runs > 0 && arm.frames > 0, `${label}: the clock arms ran and metered frames (${arm.frames} frames in ${arm.runs} runs)`);
  assert.ok(arm.frames <= share * other, `${label}: the clock arms read ${arm.frames} frames, ${((arm.frames / other) * 100).toFixed(1)} % of the ${other} the file's other arms read (limit ${share * 100} %)`);
  console.log(`CLOCK ARM COST ${label}: ${arm.frames} frames in ${arm.runs} runs = ${((arm.frames / other) * 100).toFixed(1)} % of ${other}`);
}
