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
const METER_FILES = new Set(['flash-colour-docs.test.js', 'helpers-flash.js', 'helpers-flash-controls.js', 'helpers-flash-modes.js', 'helpers-flash-halves.js', 'helpers-flash-colour.js', 'helpers-flash-scenes.js', 'helpers-flash-app.js', 'helpers-life-app.js', 'helpers-governor-app.js', 'helpers-size-card-flash.js']); // helpers-governor-app.js is a thin runner over runLife (the spy tree and the Desmond cases; the tests that use it judge the shared list); helpers-flash-app.js only builds the meter's input from the running app; the tests that use it judge the shared list
const USES_METER = /createFlashMeter|shownMeter|runControl\(|runAt\(|runScene\(|runAppDissolves\(|runLife\(|runCardFlash\(/;
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

// ---- DRIFT-12: the tunnel and the whole cycle at 1x, 2x and 4x: the README says what is asserted, names the files and their clock-arm cost lines, and no longer says they fail

test('DRIFT-12 the flash audit sees the new tunnel files (they run the meter and judge the shared rule list)', () => {
  const users = FILES.filter(([n, t]) => !METER_FILES.has(n) && USES_METER.test(t)).map(([n]) => n);
  for (const need of ['tunnel-flash.test.js', 'tunnel-flash-sizes.test.js', 'tunnel-flash-fps.test.js', 'tunnel-flash-fps-256.test.js', 'tunnel-cycle.test.js', 'tunnel-flash-controls.test.js', 'tunnel-look.test.js', 'classic-dissolve-real-time.test.js', 'tunnel-cycle-edge.test.js']) {
    assert.ok(users.includes(need) || FILES.some(([n, t]) => n === need && JUDGES_SHARED_LIST.test(t)), `the audit sees ${need}`);
  }
  assert.deepEqual(auditFlashFiles(FILES), []);
});

test('DRIFT-12 README: Classic high contrast tunnel and the whole cycle are asserted at 1x, 2x and 4x, the files and each file\'s clock-arm cost line are named, and the old "tunnel fails at speed" sentences are gone', () => {
  const t = flat(README);
  for (const need of [
    '**Classic high contrast at 1x, 2x and 4x: tunnel and the whole cycle pass the five rules at the listed sizes and rates (asserted since DRIFT-12; not at every reachable size or frame rate, see "Not covered" above and the measured failures there).**',
    'at 1x, 2x and 4x (Life since DRIFT-10, wire and blocktype since DRIFT-11, tunnel and the whole cycle at speed since DRIFT-12',
    '`tunnel-flash` 12.3 % (12 runs), `tunnel-flash-sizes` 4.1 % (16 runs), `tunnel-flash-fps` 12.7 % and `tunnel-flash-fps-256` 12.5 % (112 runs each), `tunnel-cycle` 7.4 % (18 runs)',
    '`tunnel-look`', '`classic-dissolve-real-time`', '`tunnel-flash-controls`', '`--tree before12`',
    'the old flow left L3 at 34.25 % at 10 fps on the q156 clock on 40x10', 'There is no follower, no per-cell hold and no per-frame cap in the tunnel',
    '12 tunnel cases moved, nothing else',
  ]) assert.ok(t.includes(need), `the README says: ${need}`);
  for (const gone of ['tunnel and the whole cycle FAIL', 'and except at speed: that claim is for 1x', 'does NOT meet the rules, because tunnel fails there', 'it is NOT held at 2x and 4x as a whole']) {
    assert.ok(!t.includes(gone), `the README no longer says: ${gone}`);
  }
  // every file it names exists and ends with its own clock-arm cost assertion, which holds the arms to 15 % of the file's grid frames
  for (const [file, label] of [['tunnel-flash', 'tunnel-flash'], ['tunnel-flash-sizes', 'tunnel-flash-sizes'], ['tunnel-flash-fps', 'tunnel-flash-fps'], ['tunnel-flash-fps-256', 'tunnel-flash-fps-256'], ['tunnel-cycle', 'tunnel-cycle']]) {
    const text = read(`./${file}.test.js`);
    assert.ok(text.includes(`assertArmCost('${label}')`), `${file} asserts its clock-arm cost`);
    assert.ok(text.includes('clock' + 'Arm(() =>') || text.includes('clock' + 'Arm(async'), `${file} runs clock arms`);
  }
  // control: the check notices a README without the section
  assert.ok(!flat(README.replace('**Classic high contrast at 1x, 2x and 4x: tunnel and the whole cycle pass the five rules at the listed sizes and rates (asserted since DRIFT-12; not at every reachable size or frame rate, see "Not covered" above and the measured failures there).**', 'x')).includes('**Classic high contrast at 1x, 2x and 4x: tunnel and the whole cycle pass the five rules at the listed sizes and rates (asserted since DRIFT-12; not at every reachable size or frame rate, see "Not covered" above and the measured failures there).**'));
});

// ---- DRIFT-12 correction round 1: the conclusion is narrowed to the listed sizes and rates, Desmond's measured failures are written down as not asserted, and the size card's pause is "the same picture"

test('DRIFT-12 README: the claim is "at the listed sizes and rates", the measured failures (Desmond Hale, by hand, not asserted) and DRIFT-13 are written down, and no sentence says every size', () => {
  const t = flat(README);
  for (const need of [
    'pass the five rules at the listed sizes and rates (asserted since DRIFT-12; not at every reachable size or frame rate',
    'at 1x, 2x and 4x at the listed sizes and rates only',
    '**measured by hand, not asserted**',
    '42x12 at `--fps` 26 reads L2 26.79 % and at `--fps` 27 reads 28.57 % (26.79 % in truecolor at 26)',
    '45x12 at `--fps` 21 reads L2 26.67 %',
    '41x12 at `--fps` 9 reads L3 30.28 % (seed 5, the Life to tunnel dissolve)',
    '1.5x, which is not an asserted speed, 42x12 reads L2 26.79 % at `--fps` 21 (q156), 23 and 25 (grid)',
    '**pre-dates DRIFT-12**', 'the wire to maze dissolve at about 95 s (seed 6)', 'reads exactly 25.00 %', 'share a 56-cell field', 'The follow-up is DRIFT-13',
    '`tunnel-cycle-edge`',
  ]) assert.ok(t.includes(need), `the README says: ${need}`);
  for (const gone of ['every reachable size pass', 'at every size and every frame rate', 'Nothing fails after.']) assert.ok(!t.includes(gone), `the README no longer says: ${gone}`);
  // control: the check notices a README without the failures
  assert.ok(!flat(README.replace('**measured by hand, not asserted**', 'x')).includes('**measured by hand, not asserted**'));
});

test('DRIFT-12 README: after growing back the size card shows "the very same picture" (glyphs), not "the very frame" or bytes; the tests compare glyphs (screen.text()), and the console card keeps its byte-for-byte claim', () => {
  const t = flat(README);
  assert.ok(t.includes('it shows the very same picture it had (the glyphs, which is what the tests compare; the stored colour of a blank cell can differ)'));
  assert.ok(!t.includes('it shows the very frame it had'));
  assert.ok(read('./helpers-size-card.js').includes('text: () => screen.text()'), 'the harness text() is the screen glyphs, not the bytes');
  for (const file of ['classic-size-card.test.js', 'helpers-size-card.js']) {
    assert.ok(!/resum[^\n]*byte|byte[^\n]*resum/i.test(read(`./${file}`)), `${file} does not claim bytes after resuming`);
  }
  assert.ok(read('./classic-size-card-docs.test.js').includes('byte-for-byte what they were'), 'the console card claim is untouched');
});

