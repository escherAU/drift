// DRIFT-7 stage F, item 6: the README's Driftman 9000 section and the paragraphs around it say what the folders hold, read off the folders so they cannot go stale.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';

// line endings normalised: a git archive export on Windows carries CRLF (the repository's text=auto), and the needles below span lines
const README = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ANSI_DIR = new URL('../captures-ansi/', import.meta.url);
const section = (text) => {
  const a = text.indexOf('### Driftman 9000, the full-colour cartridge');
  assert.ok(a >= 0, 'the README has a Driftman 9000 section');
  return text.slice(a, text.indexOf('### Where cartridges are read from', a));
};
const lacks = (text, needle) => !text.includes(needle);

test('README Driftman 9000 section: the three visions, the program, the console, the keys, how to try it and the caveats are all there', () => {
  const s = section(README);
  for (const need of ['**Rosette**', '**Cortex**', '**Bloomfall**', 'The transmission', 'THE THREE VISIONS', 'No new keys', 'To try it', 'Caveats',
    'Not seen on a real screen', 'A 256-colour terminal is degraded, not identical', '`arrows · Enter wakes · e folds · h keys`', '2.0 s', '200 degrees a second (the design had 90)',
    'lightness\n  0.70 in truecolor and the fill\'s lightness on 256 colours', '4.7 % at the median', '10 to 14 % at the peak', 'Cortex\'s content is fixed while its glass slides',
    'Delza\'s four key labels exceed 23 characters', 'Spindle, Silk Wake, Reverie, Filigree, Tidefield and The Archive', '`shelf: "last"`']) {
    assert.ok(s.includes(need), `the section says: ${need}`);
  }
  // control: the check notices a missing caveat
  assert.ok(lacks(section(README.replace('Not seen on a real screen', 'x')), 'Not seen on a real screen'));
});

test('README Driftman 9000 section: the commands to try it use a real id, a real flag and a shelf position that is right', () => {
  const s = section(README);
  const cmds = [...s.matchAll(/^node bin\\drift\.js (.*?)\s{2,}#/gm)].map((m) => m[1]);
  assert.deepEqual(cmds, ['--cartridge driftman-9000', '--library']);
  const found = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
  assert.ok(found.cartridges.some((c) => c.id === 'driftman-9000' && !c.locked), 'the id is an unlocked install cartridge');
  const shelf = found.cartridges.map((c) => c.id).sort((a, b) => (a === 'classic' ? -1 : b === 'classic' ? 1 : 0));
  assert.equal(shelf.indexOf('driftman-9000'), 3, 'three right arrows from Classic reach it (the README says three)');
  assert.match(s, /right arrow three times/);
  assert.match(s, /Classic, Arcade, Delza, then the Driftman 9000/);
  assert.deepEqual(shelf.slice(0, 4), ['classic', 'arcade', 'delza', 'driftman-9000']);
});

test('README capture paragraphs: the .ansi count, size and names, and the ten text files, are what the folders hold; the viewing command names a real file', () => {
  const files = fs.readdirSync(ANSI_DIR).filter((f) => f.endsWith('.ansi'));
  const bytes = files.reduce((n, f) => n + fs.statSync(new URL(f, ANSI_DIR)).size, 0);
  assert.equal(files.length, 32);
  assert.ok(README.includes(`# ${files.length} full-frame truecolor .ansi files of the Driftman 9000 (${bytes.toLocaleString('en-US')} bytes)`), `says ${files.length} files and ${bytes.toLocaleString('en-US')} bytes`);
  const text = fs.readdirSync(new URL('../captures/', import.meta.url)).filter((f) => f.startsWith('cart-driftman-9000-'));
  assert.equal(text.length, 10);
  assert.ok(README.includes('adds ten text files, `cart-driftman-9000-*.txt`'), 'says ten text files');
  const viewed = /cat captures-ansi\/(\S+\.ansi)/.exec(README);
  assert.ok(viewed && files.includes(viewed[1]), `the cat command names a real file (${viewed && viewed[1]})`);
  // the groups the README names (its list elides a shared prefix or size, so each group is named by its first file)
  for (const group of ['library-driftman-9000-selected-120x40', 'label-24x10', 'insert-t400', 'morph-insert-t1000', 'morph-boot-t1700', 'morph-rest-t2000', 'boot-t2500', 'console-rest-120x40',
    'menu-grid-120x40', 'menu-list-80x24', 'help-120x40', 'help-80x24', 'rosette', 'cortex', 'bloomfall', 'eject-t727']) {
    assert.ok(README.includes('`' + group + '`') || README.includes('`' + group + ','), `the README names ${group}`);
    assert.ok(files.some((f) => f.startsWith(group)), `${group} is a real file`);
  }
  assert.ok(README.includes('captures-ansi/*.ansi -text'), 'says they are tracked');
});

test('README suite paragraph names every driftman-9000 test file, the new real-process and ansi tests, and their helpers', () => {
  const i = README.indexOf('The suite is');
  const p = README.slice(i, README.indexOf('Test hooks', i));
  const tests = fs.readdirSync(new URL('../tests/', import.meta.url));
  const names = tests.filter((f) => /^driftman-9000-.*\.test\.js$/.test(f)).map((f) => f.replace(/\.test\.js$/, ''));
  assert.ok(names.length >= 16, names.join());
  const short = (n) => n.replace(/^driftman-9000-/, '');
  const missing = names.filter((n) => !(p.includes('`' + n + '`') || p.includes('`-' + short(n) + '`')));
  assert.deepEqual(missing, [], 'driftman-9000 test files missing from the README');
  for (const n of ['capture-ansi', 'real-process-9000', 'helpers-driftman-console', 'helpers-driftman-panels', 'helpers-ansi', 'helpers-real-process']) {
    assert.ok(tests.some((f) => f.startsWith(n)), `${n} exists`);
    assert.ok(p.includes('`' + n + '`'), `${n} is named`);
  }
  assert.ok(!p.replace('`driftman-9000-rulef`', '').includes('`driftman-9000-rulef`'), 'control: a list without a file is noticed');
});
