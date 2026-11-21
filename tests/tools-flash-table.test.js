// DRIFT-9 part 3 (c): tools/flash-table.mjs lists every flash arm by test file and title. It cannot go stale: every row must name a test file that exists and a title
// that is declared in it, and every test file that runs an arm on a clock (calls clockArm) must have a row. Controls: a manifest with a missing file and one with a
// title that is not there are both reported, so the check can fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MANIFEST, problems, unlistedClockFiles, renderTable, locate } from '../tools/flash-table.mjs';

test('flash-table: every manifest row names a test file that exists and a test title declared in it', () => {
  assert.ok(MANIFEST.length >= 60, `the manifest has ${MANIFEST.length} rows`);
  assert.deepEqual(problems(), []);
});

test('flash-table: every row has the nine fields and a clock that is grid, q156, jitter, none or a list of them', () => {
  for (const r of MANIFEST) {
    assert.equal(r.length, 9, `${r[0]}: ${r[2]}`);
    for (const f of r) assert.equal(typeof f, 'string');
    for (const c of r[3].split(',').map((x) => x.trim())) assert.ok(['grid', 'q156', 'jitter', 'none'].includes(c), `${r[0]}: clock ${c}`);
  }
});

test('flash-table: every test file that runs a clock arm (calls clockArm) has a row', () => {
  assert.deepEqual(unlistedClockFiles(), []);
});

test('flash-table: the three clocks and the 8 fps floor arms are in the table', () => {
  const clocks = new Set(MANIFEST.flatMap((r) => r[3].split(',').map((x) => x.trim())));
  for (const c of ['grid', 'q156', 'jitter', 'none']) assert.ok(clocks.has(c), c);
  assert.ok(MANIFEST.some((r) => r[0] === 'flash-256-fps' && r[7] === '8'), 'the floor arms');
  assert.ok(MANIFEST.some((r) => r[0] === 'shelf-clocks'), 'the shelf on the real app');
  assert.ok(MANIFEST.some((r) => r[0] === 'flash-menu-cortex-rosette-clock'), 'the menu Cortex into Rosette arms');
});

test('flash-table control: a row that names a file that is not there, or a title that is not in its file, is reported', () => {
  const row = (file, match) => [file, match, 'x', 'grid', 'truecolor', '80x24', '1x', '18', '1'];
  assert.deepEqual(problems([row('no-such-file', 'x')]), ['no-such-file: no tests/no-such-file.test.js']);
  const bad = problems([row('shell-flash', 'this title is in no test of shell-flash')]);
  assert.equal(bad.length, 1);
  assert.match(bad[0], /shell-flash: no test\( line containing/);
  assert.equal(locate('shell-flash', 'this title is in no test of shell-flash').line, 0);
  // a title that belongs to another file is not in this one
  assert.equal(problems([row('shell-flash', 'the first frame after Enter changes')]).length, 1);
  // a clock-arm file left out of the manifest is reported
  assert.ok(unlistedClockFiles(MANIFEST.filter((r) => r[0] !== 'foil-flash')).includes('foil-flash'));
});

test('flash-table: the tool prints one table row per manifest row, and --check exits 0 on the real tree', () => {
  const text = renderTable();
  const rows = text.split('\n').filter((l) => l.startsWith('| '));
  assert.equal(rows.length, MANIFEST.length + 2, 'header, divider and one row per arm');
  assert.ok(!text.includes('MISSING'));
  for (const l of rows) assert.equal(l.split(' | ').length, 7, l);
  const tool = fileURLToPath(new URL('../tools/flash-table.mjs', import.meta.url));
  const out = execFileSync(process.execPath, [tool, '--check'], { encoding: 'utf8' });
  assert.match(out, /manifest matches the tests/);
});
