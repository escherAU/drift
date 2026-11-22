#!/usr/bin/env node
// DRIFT-9 part 3 (c): the flash arm table. One row per flash arm: which test asserts it, on which clock, in which colour mode(s), at which size(s), speed(s),
// frame rate and seeds. Zero dependencies; read-only (it only reads tests/*.test.js).
//
//   node tools/flash-table.mjs            print the table (Markdown, one row per arm)
//   node tools/flash-table.mjs --check    exit 1 if a row names a file or a test title that is not in tests/
//
// The columns come from an explicit manifest (MANIFEST below), because a test's size, seed and speed lists are spread over loops and helper constants that no
// parser can read reliably. What cannot go stale is the link to the test: for every row the tool opens the file, finds the line that declares the test whose
// title contains `match` (a literal piece of the title, taken from the test's own `test(...)` line) and prints file:line. tests/tools-flash-table.test.js fails when
// a row names a file or a title that is not there, and when a test file that runs a flash arm on a clock (it calls clockArm) has no row at all.
//
// Columns: clock grid = the exact timer every arm used before DRIFT-9 (an arm that replays frames without a timer is grid too); q156 = a timer that fires on the next
// multiple of 15.625 ms (the Windows tick); jitter = seeded 0 to 16 ms late, never early (seed 3 in every arm that names it); none = the test has no clock
// (it reads fixed frames or a function of time). "default" in a column = the test file does not name a value there; the default is the helper's. fps is the rate
// the arm paints at (the meter always reads the viewer's 18 Hz grid).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TESTS_DIR = path.join(HERE, '..', 'tests');

const QJ = 'q156, jitter';
const TC = 'truecolor';
const C256 = '256';
const BOTH = 'truecolor, 256';
const SIX = '120x40, 80x24, 240x67, 88x39, 176x58, 78x24';

// file (without .test.js), match (a literal piece of the test title), what, clock, modes, sizes, speeds, fps, seeds
export const MANIFEST = [
  // ---- shell flows (step rule, ramps and the meter)
  ['shell-flash', 'library, cursor moves, Enter, insert, boot and the first 10 s of running', 'plain flow: library, insert, boot, running', 'grid', TC, 'per-size loop', '1x', '18', 'default'],
  ['shell-flash', 'clock, 80x24: library, locked dip, insert, boot, running, menu and eject', 'clock arm: whole flow, step rule + ramps + five 1x rules', QJ, TC, '80x24', '1x', '18', 'clock seeds 1, 3'],
  ['shell-flash', 'flash clock control (', 'control: white/black strobe must fail L1 and L3', QJ, TC, '80x24', '1x', '18', 'clock seeds 1, 3'],
  ['shell-flash-sizes', 'stays at or under 30% a frame outside the key press', 'plain flow at a grid of sizes', 'grid', TC, 'size grid in file', '1x', '18', 'default'],
  ['shell-flash-sizes', 'clock, 88x39: slides both ways, insert, boot, menu and eject of Delza', 'clock arm', QJ, TC, '88x39', '1x', '18', 'clock seeds 1, 3'],
  ['shell-flash-sizes', 'flash clock control (', 'control: strobe must fail', QJ, TC, '88x39', '1x', '18', 'clock seeds 1, 3'],
  ['shell-flash-skinned', 'skinned cartridge with a console block at ink 3: library, insert, boot, running, eject, library', 'plain flow, skinned cartridge, four phases', 'grid', TC, 'per-size loop', '1x', '18', 'default'],
  ['shell-flash-skinned', 'clock, 120x40, skinned cartridge with a console block at ink 3', 'clock arm', QJ, TC, '120x40', '1x', '18', 'clock seeds 1, 3'],
  ['shell-flash-skinned', 'flash clock control (', 'control: strobe must fail', QJ, TC, '120x40', '1x', '18', 'clock seeds 1, 3'],
  ['shell-insert-dissolve', 'clock, 41x11, night-drive: the key frame and every step after it', 'clock arm: insert key frame + steps + five 1x rules', QJ, TC, '41x11', '1x', '18', 'clock seeds 1, 3'],
  ['shell-insert-dissolve', 'insert clock control (', 'control: strobe must fail', QJ, TC, '41x11', '1x', '18', 'clock seeds 1, 3'],
  ['shell-eject-fade', 'flash meter over the whole eject at 1x and 4x on a lit full-colour fixture at six sizes', 'plain: whole eject', 'grid', BOTH, SIX, '1x, 4x', '18', 'default'],
  ['shell-eject-fade', 'flash meter over the whole eject on the ', 'clock arm: whole eject', 'q156', TC, '78x24', '1x', '18', 'clock seed 1'],
  ['shell-help-ramp', 'flash meter over h open, 1 s, h close at 1x and 4x runtime speed, six sizes', 'plain: help ramp', 'grid', BOTH, 'six sizes', '1x, 4x', '18', 'default'],
  ['shell-help-ramp', 'flash meter over h open, 1 s, h close at 4x on the ', 'clock arm: help ramp', QJ, TC, '80x24', '4x', '18', 'clock seeds 1, 3'],
  // ---- shelf
  ['shell-shelf-move', 'a held-key walk (30 ms repeats after 0.3 s, 3 s) and a burst of five pass L1, L2, L3 and R at 1x', 'plain: held key and burst, foil on/off', 'grid', TC, SIX, '1x', '18', 'default'],
  ['shell-shelf-move', 'random walks (bursts of 1-12 presses at 30-100 ms, pauses of 0.15-2 s)', 'plain: random walks', 'grid', TC, SIX, '1x', '18', 'walk seeds in file'],
  ['shell-shelf-move', 'shelf control: a press every 0.5 s with the old hard slides (scrub off) FAILS', 'control: scrub off must fail', 'grid', TC, SIX, '1x', '18', 'default'],
  ['shell-shelf-move', 'a held key on the foil shelf at 88x39 passes the five 1x rules', 'clock arm: held key, foil shelf', QJ, TC, '88x39', '1x', '18', 'clock seeds 1, 3'],
  ['shelf-clocks', 'shelf real app: ', 'real app, held key and taps 0.3, 0.44, 0.48, 0.7 s (14 taps)', 'grid, q156, jitter', BOTH, '40x10, 81x24, 79x25, 89x40', '1x', '18', 'app seed 1-3, clock seed per case'],
  ['shelf-gate-mutant', 'shelf gate mutant: with the answers', 'mutation: the answers\' gate removed must read L2 over 25 %', 'grid, q156, jitter', C256, '40x10, 81x24', '1x', '18', 'tap 0.44 s'],
  // ---- foil, console hook, 9000 console and panels
  ['foil-flash', '30 s of the shimmer at rest passes L1','plain: shimmer at rest, shelf walk, insert + boot + eject (also run 256 via flash-256-foil)', 'grid', BOTH, SIX, '1x, 4x', '18', 'default'],
  ['foil-flash', 'clock: insert + boot and eject of a foil cartridge at 88x39', 'clock arm', QJ, TC, '88x39', '1x', '18', 'clock seeds 1, 3'],
  ['console-hook-flash', 'the calm and the harsh hook, over the whole insert + boot and the whole eject', 'plain: calm and harsh hook, strobe control (also 256 via flash-256-console-hook)', 'grid', BOTH, SIX, '1x, 4x', '18', 'default'],
  ['console-hook-flash', 'clock: the calm hook over the whole insert + boot and the whole eject at 80x24', 'clock arm', QJ, TC, '80x24', '1x', '18', 'clock seeds 1, 3'],
  ['driftman-9000-console-flash', 'insert + boot (1x and 4x) and eject, at four clock phases', 'plain: insert, boot, eject (also 256 via flash-256-9000-console)', 'grid', BOTH, SIX, '1x, 4x', '18', 'default'],
  ['driftman-9000-console-flash', 'clock: insert + boot and eject at 80x24 pass the five 1x rules', 'clock arm', QJ, TC, '80x24', 'flow\'s own', '18', 'clock seeds 1, 3'],
  ['driftman-9000-panels-flash', 'menu open/close and help open/close over Rosette, Cortex and Bloomfall at 1x and 4x', 'plain: menu and help panels (also 256 via flash-256-9000-panels)', 'grid', BOTH, 'size loop in file', '1x, 4x', '18', 'default'],
  ['driftman-9000-panels-flash', 'clock: menu and help open/close over Bloomfall at 4x, 78x24', 'clock arm', QJ, TC, '78x24', '4x', '18', 'clock seeds 1, 3'],
  // ---- the visions, solo
  ['driftman-9000-rosette-flash', 'solo for ', 'plain: Rosette solo, replayed', 'grid', BOTH, 'size loop in file', '1x, 4x', '18', 'default + extra phases/seeds'],
  ['driftman-9000-rosette-flash', 'clock: solo on 256-colour output, 80x24, passes the five 1x rules', 'clock arm: Rosette', QJ, C256, '80x24', 'default', '18', 'clock seeds 1, 3'],
  ['driftman-9000-rosette-range', 'rosette per-pixel brightness range over a whole 4x run, ', 'plain: per-pixel range tripwire', 'grid', BOTH, '61x21, 80x24, 120x40, 280x70', '4x', '18', '1, 2, 3, 7'],
  ['driftman-9000-rosette-range', 'on the ${clock.mode} clock, ${mode}: at most', 'clock arm: range tripwire', QJ, BOTH, '80x24', '4x', '18', '1 (clock seeds 1, 3)'],
  ['driftman-9000-bloomfall-flash', 'solo for ', 'plain: Bloomfall solo, replayed', 'grid', BOTH, 'size loop in file', '1x, 4x', '18', 'default + extra phases/seeds'],
  ['driftman-9000-bloomfall-flash', 'clock: solo at 4x on 256-colour output, 80x24, passes the five 1x rules', 'clock arm: Bloomfall', QJ, C256, '80x24', '4x', '18', 'clock seeds 1, 3'],
  ['driftman-9000-cortex-flash', 'solo for ', 'plain: Cortex solo, replayed', 'grid', BOTH, 'size loop in file', '1x, 4x', '18', 'default + extra phases/seeds'],
  ['driftman-9000-cortex-flash', 'clock: solo at 4x on 256-colour output, 80x24, passes the five 1x rules', 'clock arm: Cortex', QJ, C256, '80x24', '4x', '18', 'clock seeds 1, 3'],
  ['driftman-9000-huefield-flash', 'the field alone at L 0.22, 0.45 and 0.66 passes every rule', 'plain: huefield alone', 'none', BOTH, 'size loop in file', 'the field is read at time t (no clock)', '18', 'n/a'],
  ['driftman-9000-huefield-flash', 'clock, 80x24 256 colours: the field alone at L 0.66 for 12 s', 'clock arm: huefield alone', QJ, C256, '80x24', 'n/a', '18', 'clock seeds 1, 3'],
  ['driftman-9000-huefield-flash', 'flash clock control (', 'control: stepped lightness must fail L1 and L2', QJ, C256, '80x24', 'n/a', '18', 'clock seeds 1, 3'],
  // ---- the 9000's dissolves
  ['driftman-9000-dissolve', 'every ordered pair, 5 sizes, shell speeds 1x', 'plain: every ordered pair, replayed', 'grid', TC, '5 sizes in file', '1x, 4x', '18', 'seed 1'],
  ['driftman-9000-dissolve', 'every ordered pair on 256-colour output', 'plain: every ordered pair, 256', 'grid', C256, '120x40, 80x24, 61x21', '1x, 4x', '18', 'seed 1'],
  ['driftman-9000-dissolve', 'clock: bloomfall>rosette at 80x24', 'clock arm: bloomfall>rosette', QJ, BOTH, '80x24', '1x (truecolor, 256), 4x (256)', '18', 'clock seeds 1, 3'],
  ['driftman-9000-dissolve-app', 'dissolves in the app at 4x: 80x24, all 16 seeds', 'real app: 80x24 (256 via flash-256-9000-dissolve-app)', 'grid', BOTH, '80x24', '4x', '18', '1-16'],
  ['driftman-9000-dissolve-app', 'dissolves in the app at 4x: 120x40, ', 'real app: 120x40', 'grid', BOTH, '120x40', '4x', '18', '1, 12, 16'],
  ['driftman-9000-dissolve-app', 'dissolves in the app at 4x: 61x21, ', 'real app: 61x21', 'grid', BOTH, '61x21', '4x', '18', '1, 8, 12, 16, 2, 3, 5, 7'],
  ['driftman-9000-dissolve-app', 'dissolves in the app at 1x (the other arm)', 'real app at 1x', 'grid', BOTH, '80x24', '1x', '18', '1, 12'],
  ['driftman-9000-dissolve-app', 'on the real app', 'clock arm: real app, every dissolve window', QJ, 'truecolor (256 via flash-256-9000-dissolve-app)', '80x24', '4x', '18', '8 (clock seeds 1, 3)'],
  ['driftman-9000-dissolve-app-paths', 'dissolve then 4x: + four times inside Bloomfall>Rosette at 1x', 'path (a): speed pressed inside a dissolve; 220 s run, NO clock arm (cost cap)', 'grid', BOTH, '80x24', '1x then 4x', '18', '8, 12, 16'],
  ['driftman-9000-dissolve-app-paths', 'space at 4x: the skip key in Bloomfall', 'path (b): space at 4x', 'grid', BOTH, '80x24', '4x', '18', '8, 12, 16'],
  ['driftman-9000-dissolve-app-paths', 'menu jump at 4x: bloomfall>cortex, rosette>bloomfall and cortex>rosette', 'path (c): menu jump at 4x', 'grid', BOTH, '80x24', '4x', '18', '8, 12, 16'],
  ['driftman-9000-dissolve-app-paths', 'space at 4x on the ', 'clock arm, path (b)', QJ, BOTH, '80x24', '4x', '18', '8 (clock seeds 1, 3)'],
  ['driftman-9000-dissolve-app-paths', 'menu jump at 4x on the ', 'clock arm, path (c): bloomfall>cortex only', QJ, BOTH, '80x24', '4x', '18', '8 (clock seeds 1, 3)'],
  ['driftman-9000-dissolve-app-paths', 'clock arm control (', 'control: real-time dissolve removed must fail L2', QJ, C256, '80x24', '4x', '18', '8 (clock seeds 1, 3)'],
  ['flash-menu-cortex-rosette-clock', 'real 4x, ', 'menu Cortex into Rosette, 4x, picks at 18.5, 24, 30 s', 'q156', BOTH, '80x24', '4x', '18', '1-16'],
  ['flash-menu-cortex-rosette-clock', '1x, ', 'menu Cortex into Rosette, 1x, picks 62, 67.5, 73.5 s into Cortex', 'q156', BOTH, '80x24', '1x', '18', '1-16'],
  ['flash-menu-cortex-rosette-clock', 'control${MODE_NOTE}: a tree with the program-switch dissolve taken out','control: hard-cut jump must fail L3 (open 24 s at 4x, 67.5 s at 1x)', 'q156', BOTH, '80x24', '4x, 1x', '18', '1, 2'],
  ['flash-256-menu-cortex-rosette-clock', 'DRIFT_FLASH_MODE = ', 'wrapper: the same file in 256 colours (sets DRIFT_FLASH_MODE=256 and imports it)', 'q156', C256, '80x24', '4x, 1x', '18', '1-16'],
  // ---- fps range, the floor and the 256-colour cap
  ['flash-256-fps', 'at --fps 30, real 4x, 80x24, seeds 1-16', '--fps 30 real app', 'grid', C256, '80x24', '4x', '30', '1-16'],
  ['flash-256-fps', 'at --fps 24, real 4x, 80x24', '--fps 24 real app', 'grid', C256, '80x24', '4x', '24', '2, 3, 5, 6, 14, 1'],
  ['flash-256-fps', 'at --fps 30, real 4x, 120x40', '--fps 30, 120x40', 'grid', C256, '120x40', '4x', '30', '2, 6, 14'],
  ['flash-256-fps', 'at --fps 30, real 4x, 61x21', '--fps 30, 61x21', 'grid', C256, '61x21', '4x', '30', '2, 3, 5, 6'],
  ['flash-256-fps', 'at --fps 30, 1x, 80x24', '--fps 30 at 1x', 'grid', C256, '80x24', '1x', '30', '2, 6'],
  ['flash-256-fps', 'at --fps 24, 1x, 80x24', '--fps 24 at 1x', 'grid', C256, '80x24', '1x', '24', '2'],
  ['flash-256-fps', 'truecolor at --fps 30, real 4x, 80x24', 'truecolor --fps 30', 'grid', TC, '80x24', '4x', '30', '1, 2, 6, 14'],
  ['flash-256-fps', 'at the floor (MIN_FPS), real 4x, ', 'floor arms on the exact grid (MIN_FPS = 8)', 'grid', C256, '61x21, 78x24, 120x40', '4x', '8', '61x21: 1-8; 78x24, 120x40: 1-3'],
  ['flash-256-fps', 'at the floor (MIN_FPS) on the ', 'floor arms on the clocks: q156 61x21 1-8, 78x24 1-3, 120x40 1-3; jitter 61x21 seed 4 only (15 % cost cap)', QJ, C256, '61x21, 78x24, 120x40', '4x', '8', 'q156: 1-8 / 1-3 / 1-3; jitter: 4'],
  ['flash-256-fps', 'at --fps 30 on the ', 'clock arm at --fps 30', QJ, C256, '80x24', '4x', '30', '6 (clock seeds 1, 3)'],
  ['flash-256-fps', 'control: --fps ${MIN_FPS - 1}', 'control: fps 7 on q156 must fail L3', 'q156', C256, '61x21', '4x', '7', '6'],
  ['flash-256-fps', 'control on the ', 'control: cap taken out must fail rule C at --fps 30', QJ, C256, '80x24', '4x', '30', '2, 6, 14'],
  ['fps-cap', 'the app\'s own loop on the ', 'paint-rate arms on a clock (cap holds at 18 in 256; not capped in truecolor)', QJ, BOTH, 'default', 'default', '30', 'clock seeds 1, 3'],
  // ---- Night Drive (judged by its own step rules; the five-rule meter reads over 25 % in some cases, see the README)
  ['night-drive-flash', 'flash (a) overdrive: all 90 s through the composer at 1x and 4x', 'group (a): overdrive, strict 30 % step rule', 'grid', 'palette', 'per-size loop', '1x, 4x', 'default', 'default'],
  ['night-drive-flash', 'flash (b) dissolves: every consecutive pair of the tape', 'group (b): every dissolve pair, 30 %', 'grid', 'palette', '120x40, 80x24, 41x11', '1x, 4x', 'default', 'default'],
  ['night-drive-flash', 'flash (c) ramps: in every scene alone', 'group (c): one shade step per frame', 'grid', 'palette', '120x40, 80x24', '1x', 'default', 'default'],
  ['night-drive-flash', 'flash (d) bright solid coverage', 'group (d): at most 25 % bright solid blocks', 'grid', 'palette', 'default', '1x', 'default', 'default'],
  ['night-drive-flash', 'flash (e) shell steps ', 'group (e): shell steps (insert, boot, menu, running, eject)', 'grid', TC, 'size loop in file', '1x', '18', 'default'],
  ['night-drive-flash', 'flash (a) overdrive on the ', 'clock arm (a)', QJ, 'palette', '60x18', '4x', 'default', 'clock seeds 1, 3'],
  ['night-drive-flash', 'flash (b) dissolve ', 'clock arm (b): sundown>coast 41x11, redlight>diner 80x24', QJ, 'palette', '41x11, 80x24', '4x', 'default', 'clock seeds 1, 3'],
  ['night-drive-flash', 'flash (c)+(d) overdrive on the ', 'clock arm (c)+(d)', QJ, 'palette', '80x24', '1x', 'default', 'clock seeds 1, 3'],
  ['night-drive-flash', 'flash (e) shell steps on the ', 'clock arm (e): steps and the five 1x rules', QJ, TC, '79x25', '1x', '18', 'clock seeds 1, 3'],
  ['night-drive-flash', 'flash (e) clock control (', 'control: strobe must fail L1 and L3', QJ, TC, '79x25', '1x', '18', 'clock seeds 1, 3'],
  // ---- the colour rule and the meter itself (no clock)
  ['flash-colour-rosette', 'real 1x, 2x and 4x with the colour clock', 'Rosette at real 1x, 2x, 4x (colour clock)', 'none', BOTH, '61x21, 80x24, 120x40, 280x70', '1x, 2x, 4x', '18', '1, 2, 3, 7'],
  ['flash-colour-visions', 'real 1x, 2x and 4x at 61x21, 80x24 and 120x40 with the colour clock', 'Bloomfall, Cortex, huefield (colour clock)', 'none', BOTH, '61x21, 80x24, 120x40, 280x70', '1x, 2x, 4x', '18', '2, 3, 7 (and default)'],
  ['flash-colour', 'the equal-brightness pair with delta a = delta b = 0.09', 'must-fail controls for rule C', 'none', BOTH, 'four sizes in file', 'n/a', '18, 24', 'n/a'],
  // ---- Classic high contrast (the Life scene) on the real app (DRIFT-10)
  ['life-flash', 'life 1x grid, ${mode}, ${cols}x${rows}, seeds 1 to 8', 'Classic contrast, Life scene, real app, whole 30 s scene', 'grid', BOTH, '80x24, 120x40, 40x10, 41x11, 78x24, 79x25, 88x39, 89x40; 20x6 and 10x4 are the size card since DRIFT-12', '1x', '18', '1-8'],
  ['life-flash', 'life 1x grid, inverted, ${mode}', 'Classic contrast, Life scene, inverted (black on white)', 'grid', BOTH, '80x24, 120x40', '1x', '18', '1-8'],
  ['life-flash', '--fps 8, 12, 24 and 30, seeds 2, 4, 8', 'Classic contrast, Life scene, at four frame rates (meter at the same rate)', 'grid', C256, '80x24', '1x', '8, 12, 24, 30', '2, 4, 8'],
  ['life-flash', '256 colours, 80x24, seeds 1, 2, 3, 4, 8', 'clock arm: Life, 1x', QJ, C256, '80x24', '1x', '18', 'app seeds 1, 2, 3, 4, 8 (clock seed = app seed)'],
  ['life-flash', 'truecolor, 120x40, seed 2', 'clock arm: Life, 1x', QJ, TC, '120x40', '1x', '18', 'app seed 2'],
  ['life-flash-speed', 'life ${speed} grid, ${mode}, ${cols}x${rows}, seeds 1 to 8', 'Classic contrast, Life scene, real + keys, 30 real seconds of Life', 'grid', BOTH, '80x24, 120x40', '2x, 4x', '18', '1-8'],
  ['life-flash-speed', 'life 4x grid, ${mode}, ${cols}x${rows} (a layout breakpoint size)', 'Life at 4x at the layout breakpoint sizes', 'grid', BOTH, '40x10, 78x24, 88x39', '4x', '18', '1-4'],
  ['life-flash-speed', 'with a scene length of 30 s', 'Life at 4x, scene length 30 s (7.5 real seconds of Life; the shipped default is 180 s)', 'grid', C256, '80x24', '4x', '18', '1-8'],
  ['life-flash-speed', 'life 4x clock arm, ${clock}, 256 colours, 80x24, seeds 2, 4, 8', 'clock arm: Life, 4x', QJ, C256, '80x24', '4x', '18', 'app seeds 2, 4, 8 (clock seed = app seed)'],
  ['life-flash-speed', 'life 2x clock arm, ${clock}, 256 colours, 80x24, seed 2', 'clock arm: Life, 2x', QJ, C256, '80x24', '2x', '18', 'app seed 2'],
  ['life-flash-speed', 'life 4x clock arm, ${clock}, truecolor, 120x40, seed 2', 'clock arm: Life, 4x', QJ, TC, '120x40', '4x', '18', 'app seed 2'],
  ['life-flash-controls', 'the old Life fails seed 2 at ${speed} on the ${clock} clock', 'control: the old Life must fail (seed 2, three clocks, 1x and 4x)', 'grid, q156, jitter', C256, '80x24', '1x, 4x', '18', '2'],
  ['life-flash-controls', 'the old Life fails the 1x matrix', 'control: the old Life must fail the matrix', 'grid', C256, '80x24, 40x10, 78x24, 88x39, 120x40', '1x', '18', '1-8'],
  ['life-flash-controls', 'the flip gap removed (FLIP_GAP 0)', 'control: mutant, no flip gap', 'grid', C256, '80x24', '1x', '18', '1-8'],
  ['life-flash-controls', 'the speed lever removed from the scene', 'control: mutant, no realClock', 'grid', C256, '80x24', '1x, 4x', '18', '2, 4, 8'],
  // DRIFT-10 correction round 1: the low frame rates on small boards, the per-painted-frame cap, the slower speeds
  ['life-flash-fps', 'life ${speed} grid, --fps ${fps}, ${mode}, the six small sizes', 'Classic contrast, Life scene at the low frame rates on small boards, whole 30 s scene', 'grid', BOTH, '10x4, 13x4, 15x5, 20x6, 25x5, 80x24 (the first five are the size card since DRIFT-12)', '1x, 4x', '8, 10, 12, 15', '1-8'],
  ['life-flash-fps', 'life 1x clock arm, ${clock}, --fps ${fps}, the six small sizes', 'clock arm: Life at the low frame rates on small boards', QJ, BOTH, '10x4, 13x4, 15x5, 20x6, 25x5, 80x24 (the first five are the size card since DRIFT-12)', '1x', '8, 10, 12, 15', 'app seeds 2 (256 colours), 5 (truecolor); clock seed = app seed'],
  ['life-flash-speed', 'life slower speeds slow it', 'Life at 0.5x and 0.25x: moves about half and a quarter as often as at 1x, the five rules pass', 'grid', C256, '80x24', '0.5x, 0.25x (1x as the reference)', '18', '1-3'],
  ['life-flash-controls', 'the first fix (a share per step only, 33f8142) failed L3', 'DRIFT-12: the first DRIFT-10 fix can no longer fail the low-fps runs: those boards are the size card (asserted), and it passes at 40x10', 'grid, q156', C256, '13x4, 15x5, 25x5 (grid fps 8); 10x4, 20x6 (q156 fps 10); 10x4 (q156 fps 12); 15x5 (q156 fps 15): the size card; 40x10: passes', '1x', '8, 10, 12, 15', '2 (card); 1-8 (40x10)'],
  ['life-flash-controls', 'the per-frame cap taken out', 'DRIFT-12: mutant, no per-frame cap: the size card at the old boards (asserted), passes at 40x10', 'grid, q156', C256, 'as the control above', '1x', '8, 10, 12, 15', '2 (card); 1-8 (40x10)'],
  ['life-flash-controls', 'the min(speed, 1) taken out of the app', 'control: mutant, the real-time clock at full pace at slower speeds', 'grid', C256, '80x24', '1x, 0.5x, 0.25x', '18', '2'],
  // DRIFT-11: Classic high contrast, wire and blocktype (src/scenes/follow.js), the five rules on the real app (helpers-wb-flash.js: each run is the whole 30 real seconds of the scene)
  ['wire-blocktype-flash', '${scene} ${speed} grid, ${mode}, ${cols}x${rows}, seeds 1 to 8', 'Classic contrast, wire and blocktype, real app, whole 30 s scene', 'grid', BOTH, '80x24, 120x40', '1x, 2x, 4x', '18', '1-8'],
  ['wire-blocktype-flash', '${scene} clock arm, ${clock}, 1x 256 colours 80x24 seeds 1 to 4 and 4x seed 5', 'clock arm: wire and blocktype, 1x and 4x, 80x24 and 120x40', QJ, BOTH, '80x24, 120x40', '1x, 4x', '18', 'app seeds 1-5 and 2 (clock seed = app seed)'],
  ['wire-blocktype-flash-sizes', '${scene} 1x grid, ${mode}, the layout breakpoint sizes and the small boards, seeds 1 to 8', 'wire and blocktype at the layout breakpoints and on the small boards', 'grid', BOTH, '40x10, 41x11, 78x24, 79x25, 88x39, 89x40, 10x4, 13x4, 15x5, 20x6, 25x5 (the last five are the size card since DRIFT-12)', '1x', '18', '1-8'],
  ['wire-blocktype-flash-sizes', '${scene} 1x grid, inverted, ${mode}, 80x24 and 120x40', 'wire and blocktype, inverted (black on white)', 'grid', BOTH, '80x24, 120x40', '1x', '18', '1-8'],
  ['wire-blocktype-flash-sizes', '${scene} at the shipped scene length (180 s)', 'wire and blocktype held for the shipped 180 s scene length', 'grid', C256, '80x24', '1x', '18', '1'],
  ['wire-blocktype-flash-sizes', '${scene} clock arm, ${clock}, 1x: 41x11 seed 2, 79x25 seed 3, 10x4 seed 5, 20x6 seed 6', 'clock arm: wire and blocktype at breakpoint and small sizes', QJ, BOTH, '41x11, 79x25, 10x4, 20x6 (the last two are the size card since DRIFT-12)', '1x', '18', 'app seeds 2, 3, 5, 6 (clock seed = app seed)'],
  ['wire-flash-fps', 'wire ${speed} grid, --fps ${fps}, ${mode}, the six sizes, seeds 1 to 8', 'wire at --fps 8, 10, 12, 15, 18, 30 on the small boards: the full cross', 'grid', BOTH, '10x4, 13x4, 15x5, 20x6, 25x5, 80x24 (the first five are the size card since DRIFT-12)', '1x, 4x', '8, 10, 12, 15, 18, 30', '1-8'],
  ['wire-flash-fps', 'wire clock arm, ${clock}, --fps ${fps}, the six sizes', 'clock arm: wire, every clock x every fps x every small board', QJ, BOTH, '10x4, 13x4, 15x5, 20x6, 25x5, 80x24 (the first five are the size card since DRIFT-12)', '1x, 4x', '8, 10, 12, 15, 18, 30', 'app seeds 2 (256, 1x), 5 (truecolor, 4x); clock seed = app seed'],
  ['blocktype-flash-fps', 'blocktype ${speed} grid, --fps ${fps}, ${mode}, the six sizes, seeds 1 to 8', 'blocktype at --fps 8, 10, 12, 15, 18, 30 on the small boards: the full cross', 'grid', BOTH, '10x4, 13x4, 15x5, 20x6, 25x5, 80x24 (the first five are the size card since DRIFT-12)', '1x, 4x', '8, 10, 12, 15, 18, 30', '1-8'],
  ['blocktype-flash-fps', 'blocktype clock arm, ${clock}, --fps ${fps}, the six sizes', 'clock arm: blocktype, every clock x every fps x every small board', QJ, BOTH, '10x4, 13x4, 15x5, 20x6, 25x5, 80x24 (the first five are the size card since DRIFT-12)', '1x, 4x', '8, 10, 12, 15, 18, 30', 'app seeds 2 (256, 1x), 5 (truecolor, 4x); clock seed = app seed'],
  ['wire-blocktype-cycle', 'whole cycle grid, ${mode}, ten sizes, seeds 1 to 3', 'the whole high-contrast cycle (all five scenes and the four dissolves, 170 s), real app', 'grid', BOTH, '80x24, 120x40, 60x16, 100x30, 78x24, 79x25, 89x40, 88x39, 41x11, 40x10', '1x', '18', '1-3'],
  ['wire-blocktype-cycle', 'whole cycle grid, --fps 8, ${mode}, 80x24, 41x11 and 120x40', 'the whole high-contrast cycle at --fps 8', 'grid', BOTH, '80x24, 41x11, 120x40', '1x', '8', '1-3'],
  ['wire-blocktype-cycle', 'whole cycle clock arm, ${clock}, 80x24 seeds 1 to 3, 41x11 seed 2, 80x24 --fps 8 seed 1', 'clock arm: the whole high-contrast cycle', QJ, C256, '80x24, 41x11', '1x', '18, 8', 'app seeds 1-3, 2, 1 (clock seed = app seed)'],
  ['wire-blocktype-flash-controls', 'the old wire and blocktype (7c2f34c) fail the five rules in the real app', 'control: the old wire and blocktype must fail (numbers pinned)', 'grid, q156, jitter', C256, '80x24', '1x, 2x, 4x', '18', '1'],
  ['wire-blocktype-flash-controls', 'the old wire and blocktype also fail on the small boards at --fps 8', 'control: the old looks fail the low-fps run', 'grid', C256, '20x6', '1x', '8', '1-3'],
  ['wire-blocktype-flash-controls', 'wire mutant: the beat AND the per-cell gap removed', 'control: mutant, no beat and no gap', 'grid', C256, '80x24', '1x', '18', '1-3'],
  ['wire-blocktype-flash-controls', 'wire mutant: the per-frame cap removed', 'control: mutant, no per-frame cap (wire)', 'grid, q156', C256, '10x4, 13x4, 15x5', '1x', '8, 10', '1-8'],
  ['wire-blocktype-flash-controls', 'blocktype mutant: the wave ripples with the front again', 'control: mutant, wave moves (blocktype)', 'grid', C256, '80x24, 120x40, 20x6', '1x', '18', '1-3'],
  ['wire-blocktype-flash-controls', 'mutant: the picture strobes', 'control: strobe mutant on both scenes must fail L1, L2, L3', 'grid', C256, '80x24', '1x', '18', '1'],
  // DRIFT-12 part A: Classic's size card (below 40x10), the real app, resized across the threshold (helpers-size-card-flash.js: the window is a fixed canvas, a resize resets nothing)
  ['classic-size-card-flash', '7a parked on the card, grid, contrast normal and inverted', 'the size card parked for 12 s, contrast normal and inverted', 'grid', BOTH, '39x10, 40x9, 10x4', '1x', '18', '1-3'],
  ['classic-size-card-flash', '7a parked on the card, grid, calm, chaos and experimental', 'the size card parked for 12 s, calm, chaos and experimental', 'grid', BOTH, '39x10, 40x9', '1x', '18', '1'],
  ['classic-size-card-flash', '7b crossing the threshold once, grid, contrast normal and inverted', 'art to card (3 s) to art, contrast normal and inverted', 'grid', BOTH, '40x10 to 39x10, 40x10 to 40x9', '1x', '18', '1-3'],
  ['classic-size-card-flash', '7b crossing the threshold once, grid, calm, chaos and experimental', 'art to card (3 s) to art, calm, chaos, experimental (no worse than the art alone)', 'grid', BOTH, '40x10 to 39x10, 40x10 to 40x9', '1x', '18', '1-3'],
  ['classic-size-card-flash', '7b2 one swap a second for 3 s', 'one resize a second across the threshold for 3 s, contrast normal and inverted', 'grid', BOTH, '40x10 to 39x10', '1x', '18', '1-3'],
  ['classic-size-card-flash', '7 clock arm, q156 and jitter', 'clock arm: the card parked and one crossing, contrast', QJ, BOTH, '39x10, 40x10 to 39x10', '1x', '18', 'app seed 2 (clock seed = app seed)'],
  ['classic-size-card-flash', '7c MEASURED: four swaps a second', 'MEASURED, NOT PASSED: four resizes a second across the threshold for 3 s fails L2 (pinned as failing)', 'grid', C256, '40x10 to 39x10', '1x', '18', '1-3'],
  // DRIFT-12 part B: Classic high contrast, the tunnel scene and the whole cycle at 1x, 2x and 4x, the real app (helpers-wb-flash.js: each run is the whole 30 real seconds of the scene; the cycle is 170 s)
  ['tunnel-flash', 'tunnel ${speed} grid, ${mode}, ${cols}x${rows}, seeds 1 to 8', 'Classic contrast, tunnel, real + keys, whole 30 s scene', 'grid', BOTH, '80x24, 120x40', '1x, 2x, 4x', '18', '1-8'],
  ['tunnel-flash', 'tunnel clock arm, ${clock}, 256 colours 80x24', 'clock arm: tunnel, 80x24 and 120x40; cost line: 12 runs = 12.3 % of the file\'s grid frames (limit 15 %)', QJ, BOTH, '80x24, 120x40', '1x, 4x', '18', 'app seeds 1-5 and 2 (clock seed = app seed)'],
  ['tunnel-flash-sizes', 'tunnel ${speed} grid, ${mode}, the six layout breakpoint sizes, seeds 1 to 8', 'tunnel at the layout breakpoints (40x10 up)', 'grid', BOTH, '40x10, 41x11, 78x24, 79x25, 88x39, 89x40', '1x, 2x, 4x', '18', '1-8'],
  ['tunnel-flash-sizes', 'tunnel ${speed} grid, inverted, ${mode}, 80x24 and 120x40, seeds 1 to 8', 'tunnel, inverted (black on white)', 'grid', BOTH, '80x24, 120x40', '1x, 2x, 4x', '18', '1-8'],
  ['tunnel-flash-sizes', 'tunnel at the shipped scene length (180 s)', 'tunnel held for the shipped 180 s scene length, 1x and 4x', 'grid', C256, '80x24', '1x, 4x', '18', '1'],
  ['tunnel-flash-sizes', 'tunnel clock arm, ${clock}: the six breakpoint sizes', 'clock arm: tunnel at the breakpoint sizes and inverted; cost line: 16 runs = 4.1 % of the file\'s grid frames (limit 15 %)', QJ, BOTH, '40x10, 41x11, 78x24, 79x25, 88x39, 89x40, 80x24 and 120x40 inverted', '1x, 2x, 4x', '18', 'app seeds 1-8 (clock seed = app seed)'],
  ['tunnel-flash-fps', 'tunnel ${speed} grid, --fps ${fps}, ${MODE}, the eight sizes, seeds 1 to 8', 'tunnel at --fps 8, 10, 12, 15, 18, 24, 30: the full cross, truecolor', 'grid', TC, '40x10, 41x11, 78x24, 79x25, 88x39, 89x40, 80x24, 120x40', '1x, 4x', '8, 10, 12, 15, 18, 24, 30', '1-8'],
  ['tunnel-flash-fps', 'tunnel clock arm, ${clock}, --fps ${fps}, ${MODE}, the eight sizes', 'clock arm: tunnel, every clock x every fps x every size; cost line: 112 runs = 12.7 % of the file\'s grid frames (limit 15 %)', QJ, TC, '40x10, 41x11, 78x24, 79x25, 88x39, 89x40, 80x24, 120x40', '4x', '8, 10, 12, 15, 18, 24, 30', 'app seed 5 (clock seed = app seed)'],
  ['tunnel-flash-fps-256', 'tunnel ${speed} grid, --fps ${fps}, ${MODE}, the eight sizes, seeds 1 to 8', 'tunnel at --fps 8, 10, 12, 15, 18, 24, 30: the full cross, 256 colours', 'grid', C256, '40x10, 41x11, 78x24, 79x25, 88x39, 89x40, 80x24, 120x40', '1x, 4x', '8, 10, 12, 15, 18, 24, 30', '1-8'],
  ['tunnel-flash-fps-256', 'tunnel clock arm, ${clock}, --fps ${fps}, ${MODE}, the eight sizes', 'clock arm: tunnel, every clock x every fps x every size; cost line: 112 runs = 12.5 % of the file\'s grid frames (limit 15 %)', QJ, C256, '40x10, 41x11, 78x24, 79x25, 88x39, 89x40, 80x24, 120x40', '2x', '8, 10, 12, 15, 18, 24, 30', 'app seed 2 (clock seed = app seed)'],
  ['tunnel-cycle', 'whole cycle ${speed} grid, ${mode}, eight sizes, seeds 1 to 3', 'the whole high-contrast cycle (five scenes, four dissolves, 170 s) at 1x, 2x, 4x, real app', 'grid', BOTH, '40x10, 41x11, 78x24, 79x25, 88x39, 89x40, 80x24, 120x40', '1x, 2x, 4x', '18', '1-3'],
  ['tunnel-cycle', 'whole cycle ${speed} grid, inverted, ${mode}, 80x24 and 120x40, seed 1', 'the whole cycle, inverted', 'grid', BOTH, '80x24, 120x40', '1x, 2x, 4x', '18', '1'],
  ['tunnel-cycle', 'whole cycle ${speed} grid, --fps 8, 10, 12, 15, 24 and 30', 'the whole cycle at six frame rates on three sizes', 'grid', BOTH, '40x10, 80x24, 120x40', '1x, 2x, 4x', '8, 10, 12, 15, 24, 30', '1-2'],
  ['tunnel-cycle', 'whole cycle at the shipped scene length (180 s)', 'the whole cycle at the shipped 180 s scene length (16 560 frames), 1x and 4x', 'grid', C256, '80x24', '1x, 4x', '18', '1'],
  ['tunnel-cycle', '${scene} alone at ${speed}', 'every other scene of the mode alone at 2x and 4x (life, tunnel, maze)', 'grid', BOTH, '80x24, 40x10', '2x, 4x', '18', '1-3'],
  ['tunnel-cycle', 'whole cycle clock arm, ${clock}: 80x24 1x seeds 1 to 3', 'clock arm: the whole cycle at 1x, 2x, 4x and --fps 8; cost line: 18 runs = 7.4 % of the file\'s grid frames (limit 15 %)', QJ, BOTH, '80x24, 41x11, 40x10', '1x, 2x, 4x', '18, 8', 'app seeds 1-6, 2, 3, 1 (clock seed = app seed)'],
  ['tunnel-flash-controls', 'the old tunnel (1cb2b62) fails the five rules in the real app', 'control: the old tunnel must fail at 2x and 4x (numbers pinned)', 'grid, q156, jitter', C256, '80x24, 40x10', '1x, 2x, 4x', '18', '1'],
  ['tunnel-flash-controls', 'the whole cycle as it was at 1cb2b62', 'control: the whole cycle as it was must fail at 2x and 4x (numbers pinned)', 'grid', C256, '80x24', '1x, 2x, 4x', '18', '1'],
  ['tunnel-flash-controls', 'mutant: realClock removed from the tunnel', 'control: mutant, no realClock on the tunnel', 'grid', C256, '80x24', '1x, 2x, 4x', '18', '1-3'],
  ['tunnel-flash-controls', 'mutant: the old flow (FLY 0.9', 'control: mutant, the old flow on the q156 clock at --fps 10', 'q156', C256, '40x10, 41x11', '1x, 4x', '10', '1-8'],
  ['tunnel-flash-controls', 'the real-time clock alone is not enough', 'control: the old flow and turn on the real-time clock fail L3 on q156 at --fps 10', 'q156', C256, '40x10, 41x11', '1x', '10', '1-8'],
  ['tunnel-flash-controls', 'mutant: ${name}: the whole cycle reads L2 over the limit', 'control: mutants of the dissolve mechanisms (no cross-fade scaling, no realTimeIds, neither): the whole cycle fails L2', 'grid', C256, '41x11, 40x10, 79x25', '2x, 4x', '18', '1-3'],
  ['tunnel-flash-controls', 'mutant: the contrast composer does not step the maze from the real-time clock: the maze at 4x', 'control: mutant, no realTimeIds (the maze at 4x, L3 on q156)', 'q156', C256, '41x11', '4x', '18', '1-8'],
  ['tunnel-flash-controls', 'tunnel mutant: the picture strobes', 'control: strobe mutant must fail L1, L2, L3', 'grid', C256, '80x24', '1x', '18', '1'],
  ['classic-dissolve-real-time', 'contrast: the first dissolve lasts 2 real seconds', 'Classic contrast dissolves last 2 real seconds at 1x, 2x, 4x and at --fps 8 and 30; calm and chaos unchanged', 'grid', C256, '80x24', '1x, 2x, 4x', '8, 18, 30', '1'],
  ['classic-dissolve-real-time', 'experimental dissolves as before', 'experimental dissolves as before (36 frames at 1x, 9 at 4x) while contrast at 4x lasts 36: only contrast changed', 'grid', C256, '80x24', '1x, 4x', '18', '1'],
  ['tunnel-cycle-edge', 'seed 7 at --fps 30, 1x', 'the whole cycle passes AT the L2 limit (exactly 25.00 %, 14 of 56 cells), wire to maze dissolve, no margin', 'grid', C256, '40x10', '1x', '30', '7'],
  ['tunnel-cycle-edge', 'seed 8 at --fps 24, 4x', 'the whole cycle passes AT the L2 limit (exactly 25.00 %, 14 of 56 cells), Life to tunnel dissolve, no margin', 'grid', C256, '40x10', '4x', '24', '8'],
];

const rd = (file) => fs.readFileSync(path.join(TESTS_DIR, `${file}.test.js`), 'utf8').split(/\r?\n/);

// where in the file the row's test is declared: the first line that holds `match` and a test( or it( call; 0 when there is none (the caller reports it)
export function locate(file, match) {
  let lines;
  try { lines = rd(file); } catch { return { exists: false, line: 0 }; }
  let n = lines.findIndex((l) => l.includes(match) && /\b(test|it)\(/.test(l));
  // a wrapper file (flash-256-*) declares no test of its own: it sets the mode and imports the real file, so its row matches the line that does that
  if (n < 0 && !lines.some((l) => /\b(test|it)\(/.test(l))) n = lines.findIndex((l) => l.includes(match));
  return { exists: true, line: n + 1 };
}

// rows whose file or title is not there
export function problems(manifest = MANIFEST) {
  const out = [];
  for (const [file, match] of manifest) {
    const at = locate(file, match);
    if (!at.exists) out.push(`${file}: no tests/${file}.test.js`);
    else if (!at.line) out.push(`${file}: no test( line containing ${JSON.stringify(match)}`);
  }
  return out;
}

// every test file that runs an arm on a clock (calls clockArm) must have at least one row
export function unlistedClockFiles(manifest = MANIFEST) {
  const listed = new Set(manifest.map((r) => r[0]));
  return fs.readdirSync(TESTS_DIR).filter((f) => f.endsWith('.test.js')).map((f) => f.slice(0, -'.test.js'.length))
    .filter((f) => !listed.has(f) && /\bclockArm\(/.test(fs.readFileSync(path.join(TESTS_DIR, `${f}.test.js`), 'utf8')));
}

export function renderTable(manifest = MANIFEST) {
  const head = ['arm (file:line, what)', 'clock', 'colour', 'sizes', 'speeds', 'fps', 'seeds'];
  const rows = manifest.map(([file, match, what, clock, modes, sizes, speeds, fps, seeds]) => {
    const at = locate(file, match);
    const where = at.exists ? (at.line ? `${file}.test.js:${at.line}` : `${file}.test.js`) : `${file} (MISSING)`;
    return [`${where} - ${what}`, clock, modes, sizes, speeds, fps, seeds];
  });
  const line = (r) => `| ${r.join(' | ')} |`;
  const byClock = {};
  for (const r of manifest) byClock[r[3]] = (byClock[r[3]] || 0) + 1;
  return [
    line(head), line(head.map(() => '---')), ...rows.map(line), '',
    `${manifest.length} arms in ${new Set(manifest.map((r) => r[0])).size} test files. By clock: ${Object.entries(byClock).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bad = [...problems(), ...unlistedClockFiles().map((f) => `${f}: runs a clock arm but has no row`)];
  if (process.argv.includes('--check')) {
    for (const b of bad) console.error(b);
    console.log(bad.length ? `flash-table: ${bad.length} problem(s)` : 'flash-table: manifest matches the tests');
    process.exit(bad.length ? 1 : 0);
  }
  console.log(renderTable());
  if (bad.length) { for (const b of bad) console.error(`WARNING ${b}`); process.exit(1); }
}
