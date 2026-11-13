// DRIFT-8 C4 (T4.7, T4.8): rule C is written down as what it is, and no flash test leaves it out.
//   T4.7  the README and the meter's header call rule C a HOUSE RULE beyond WCAG and list its three blind spots; the README says the owner's "1.5 cycles/s" benchmark was a misreading
//   T4.8  RULE_IDS includes C and every rule resolves on a real report (both grids); every test that runs the flash meter judges the shared rule list (a grep over the tests folder);
//         the render-hash and the captures are checked by hand in the commit (tools/render-hash.mjs --check, tools/capture.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RULE_IDS, X1_RULE_IDS, ruleOf, failedRules, createFlashMeter } from './helpers-flash.js';
import { runControl } from './helpers-flash-controls.js';
import { colourPair } from './helpers-flash-colour.js';
import { TEAL, AMBER } from './helpers-flash-halves.js';

// line endings normalised: a git archive export on Windows carries CRLF, and the needles below span lines
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const README = read('../README.md');
const METER = read('./helpers-flash.js');
const CONTROLS_TEST = read('./flash-colour.test.js');
const flat = (t) => t.replace(/\n\s*(\/\/)?\s*/g, ' ');

const section = (text) => {
  const a = text.indexOf('**Colour flicker, rule C: a HOUSE RULE, beyond WCAG.**');
  assert.ok(a >= 0, 'the README has the rule C paragraph');
  return flat(text.slice(a, text.indexOf("- Delza's four key labels", a)));
};

test('T4.7 README: rule C is a HOUSE RULE beyond WCAG, with its three blind spots and the misread benchmark', () => {
  const s = section(README);
  for (const need of [
    'HOUSE RULE, beyond WCAG', 'OKLab', 'four axes', '(a + b) / sqrt 2', '0.10', '7 swings in a second', '25 %', 'colour clock', 'never loosened', 'not a promise of comfort',
    '**Blind spots:**',
    '(1) a colour-only change that stays under the swing on every axis passes, which includes grey and teal at equal lightness, up to about the chroma of `safeHue`',
    '(2) a pattern that moves fast while each pixel changes slowly passes',
    '(3) the consequence of what it does see: fast rotation of fine colour detail FAILS',
    'hue 0.15 cycles a second and rotation 0.08 turns a second', '"1.5 cycles a second" was a misreading', 'the probe\'s hue rate was 0.15',
  ]) assert.ok(s.includes(need), `the README says: ${need}`);
  // control: the check notices a missing blind spot
  assert.ok(!section(README.replace('(2) a pattern that moves fast while each pixel changes slowly passes', 'x')).includes('(2) a pattern that moves fast'));
});

test('T4.7 code: the meter\'s header and the controls\' header call rule C a HOUSE RULE beyond WCAG and list the same three blind spots, and say the benchmark was a misreading', () => {
  const head = flat(METER.slice(METER.indexOf('// Rule C, colour flicker'), METER.indexOf('export const COLOUR_SWING')));
  for (const need of ['HOUSE RULE, beyond WCAG', 'FOUR axes', 'BLIND SPOTS', '(1) a change of colour that stays under the swing on every axis', 'grey <-> teal at equal lightness', '(2) a pattern that moves fast while each pixel changes slowly passes',
    '(3) the consequence: fine colour detail rotated fast FAILS', 'hue 0.15 cycles/s, rotation 0.08 turns/s', 'never loosened']) {
    assert.ok(head.includes(need), `helpers-flash.js says: ${need}`);
  }
  const t = flat(CONTROLS_TEST);
  assert.ok(t.includes('HOUSE RULE beyond WCAG'), 'the controls file says it too');
  assert.ok(t.includes('The owner\'s remembered benchmark "1.5 cycles a second" is a misreading: the hue rate of the probe was 0.15'), 'and that 1.5 was a misreading of 0.15');
});

// ---- T4.8

test('T4.8 RULE_IDS: rule C is in the shared list, resolves on a real report and on both grids, and failedRules names it', () => {
  assert.deepEqual(RULE_IDS, ['l1.x1', 'l1.x4', 'l2.x1', 'l2.x4', 'l3', 'r.x1', 'r.x4', 'c']);
  assert.deepEqual(X1_RULE_IDS, ['l1.x1', 'l2.x1', 'l3', 'r.x1', 'c']);
  const rep = runControl(colourPair(61, 21, { c1: TEAL, c2: AMBER, hz: 4 }), { cols: 61, rows: 21, seconds: 4 });
  for (const sub of [rep, rep.cell, rep.pixel]) for (const id of RULE_IDS) assert.equal(typeof ruleOf(sub, id).worstFraction, 'number', id);
  assert.deepEqual(failedRules(rep), ['c']);
  assert.deepEqual(failedRules(rep, { not: ['c'] }), []);
  assert.deepEqual(failedRules(rep, { only: ['l1.x1'] }), []);
  const empty = createFlashMeter(8, 4, 18).report();
  assert.deepEqual(failedRules(empty), []);
  assert.equal(empty.c.worstFraction, 0);
});

// every file under tests/ that runs the flash meter and is not the meter's own: it must judge the shared list (failedRules, RULE_IDS, X1_RULE_IDS or the shelf's passes1x, which is made of
// X1_RULE_IDS) or read rule C by name, and it must not carry a hand-typed rule list of its own (which would silently leave rule C out the next time a rule is added)
// (this file is exempt: its control text below is deliberately a flash test that does not read rule C)
const METER_FILES = new Set(['flash-colour-docs.test.js', 'helpers-flash.js', 'helpers-flash-controls.js', 'helpers-flash-modes.js', 'helpers-flash-halves.js', 'helpers-flash-colour.js', 'helpers-flash-scenes.js', 'helpers-flash-app.js']); // helpers-flash-app.js only builds the meter's input from the running app; the tests that use it judge the shared list
const USES_METER = /createFlashMeter|shownMeter|runControl\(|runAt\(|runScene\(|runAppDissolves\(/;
// rep.pass is the aggregate of every rule including C, so a test that judges rep.pass reads rule C too
const JUDGES_SHARED_LIST = /failedRules|RULE_IDS|X1_RULE_IDS|passes1x|\.c\.pass|\brep\.c\b|\brep\.pass\b|assertMeterPasses/;
export function auditFlashFiles(files) {
  const bad = [];
  for (const [name, text] of files) {
    if (METER_FILES.has(name) || !USES_METER.test(text)) continue;
    if (!JUDGES_SHARED_LIST.test(text)) bad.push(`${name}: runs the flash meter but judges no shared rule list, not the aggregate pass, and never reads rule C`);
  }
  return bad;
}
const dir = new URL('./', import.meta.url);
const FILES = fs.readdirSync(dir).filter((n) => n.endsWith('.js')).map((n) => [n, fs.readFileSync(new URL(n, dir), 'utf8')]);

test('T4.8 every test that runs the flash meter judges the shared rule list (none that never reads rule C)', () => {
  const users = FILES.filter(([n, t]) => !METER_FILES.has(n) && USES_METER.test(t)).map(([n]) => n);
  for (const need of ['driftman-9000-rosette-flash.test.js', 'driftman-9000-bloomfall-flash.test.js', 'driftman-9000-cortex-flash.test.js', 'driftman-9000-huefield-flash.test.js', 'driftman-9000-dissolve.test.js', 'driftman-9000-dissolve-app.test.js', 'driftman-9000-dissolve-app-mutation.test.js',
    'driftman-9000-panels-flash.test.js', 'driftman-9000-console-flash.test.js', 'console-hook-flash.test.js', 'foil-flash.test.js', 'shell-eject-fade.test.js', 'shell-help-ramp.test.js', 'shell-shelf-move.test.js',
    'helpers-scene-checks.js', 'flash-meter.test.js', 'flash-halves.test.js', 'renderer-256-redsafe.test.js']) {
    assert.ok(users.includes(need), `the audit sees ${need} (it uses the meter)`);
  }
  assert.deepEqual(auditFlashFiles(FILES), []);
});

test('T4.8 control: the audit notices a flash test that judges a hand-typed list of the old seven rules and never reads rule C', () => {
  const old = "import { createFlashMeter } from './helpers-flash.js';\nconst RULES = [['l1.x1', (r) => r.l1.x1], ['l1.x4', (r) => r.l1.x4], ['l3', (r) => r.l3], ['r.x4', (r) => r.r.x4]];\nconst rep = meter.report();\nfor (const [n, get] of RULES) assert.ok(get(rep).pass);";
  assert.equal(auditFlashFiles([['old.test.js', old]]).length, 1);
  assert.deepEqual(auditFlashFiles([['ok.test.js', "import { createFlashMeter, failedRules } from './helpers-flash.js';\nassert.deepEqual(failedRules(rep), []);"]]), []);
  assert.deepEqual(auditFlashFiles([['agg.test.js', "import { createFlashMeter } from './helpers-flash.js';\nconst rep = meter.report(); assert.ok(rep.pass);"]]), [], 'the aggregate pass includes rule C');
  assert.equal(auditFlashFiles([['skips.test.js', "import { createFlashMeter } from './helpers-flash.js';\nconst rep = meter.report(); assert.ok(rep.l1.x1.pass && rep.l3.pass);"]]).length, 1);
  assert.deepEqual(auditFlashFiles([['unrelated.test.js', "assert.ok(true)"]]), []);
});

test('T4.8 control: the aggregate pass really includes rule C (a colour-only fault fails rep.pass and nothing else)', () => {
  const rep = runControl(colourPair(61, 21, { c1: TEAL, c2: AMBER, hz: 4 }), { cols: 61, rows: 21, seconds: 4 });
  assert.equal(rep.pass, false);
  assert.deepEqual(failedRules(rep, { not: ['c'] }), []);
});

// ---- DRIFT-8 r2: the README says how the dissolves are checked, and the files it names are the ones that do it

test('r2 README: the dissolve claims name the app-driven arm (seeds 1 to 16, real 4x, both colour modes) and the replay test, and those files exist and say so', () => {
  const flatR = flat(README);
  for (const need of [
    'The dissolves are judged on the running app itself, not on a replay of two scenes',
    '`tests/driftman-9000-dissolve-app.test.js`', 'presses `+` four times for the real 4x', 'at 80x24 for all 16 seeds (seeds 1 to 16), in truecolor and in 256 colours',
    '`tests/flash-256-9000-dissolve-app.test.js`', 'a dissolve lasts its 2 seconds of real time',
    '`tests/driftman-9000-dissolve.test.js` runs every ordered pair from a fresh composer at seed 1',
  ]) assert.ok(flatR.includes(need), `the README says: ${need}`);
  const app = read('./driftman-9000-dissolve-app.test.js'), wrap = read('./flash-256-9000-dissolve-app.test.js');
  assert.ok(/const SEEDS_16 = Array\.from\(\{ length: 16 \}, \(_, i\) => i \+ 1\)/.test(app), 'the app arm runs seeds 1 to 16');
  assert.ok(app.includes("sweep('APP DISSOLVE 4x 80x24', SEEDS_16, 80, 24, 4)"), 'at 80x24 and 4x');
  assert.ok(app.includes('PLAN_4X') && app.includes('FLASH_MODE'), 'with the + key presses, in the mode the file is run in');
  assert.ok(wrap.includes("process.env.DRIFT_FLASH_MODE = '256'") && wrap.includes("import('./driftman-9000-dissolve-app.test.js')"), 'and the 256 file runs the same file in 256 colours');
  // control: the check notices a README that no longer names the arm
  assert.ok(!flat(README.replace('`tests/driftman-9000-dissolve-app.test.js`', 'x')).includes('`tests/driftman-9000-dissolve-app.test.js`'));
});
