// DRIFT-7 C0: the real renderer's output is pinned. tools/render-hash.mjs feeds createRenderer with fixed,
// seeded frames (install cartridge scenes and dissolves, Classic in every mode, the real app on a fake
// terminal) and hashes every byte it emits; tests/fixtures/render-hash.json holds the hashes recorded before
// the full-colour work began. A failure names each differing case and says whether the Node version differs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAll, compare, readFixture, totalOf } from '../tools/render-hash.mjs';

const current = await computeAll();
const fixture = readFixture();

test('render-hash: every case matches the pinned fixture', () => {
  const r = compare(fixture, current);
  assert.ok(r.ok, '\n' + r.message);
  assert.equal(current.total, fixture.total);
});

test('render-hash: the fixture is well formed (head, node version, case count, total)', () => {
  assert.match(fixture.head, /^[0-9a-f]{40}$/);
  assert.match(fixture.node, /^v\d+\.\d+\.\d+/);
  assert.equal(fixture.count, fixture.cases.length);
  assert.equal(new Set(fixture.cases.map((c) => c.name)).size, fixture.cases.length, 'case names are unique');
  assert.equal(totalOf(fixture.cases), fixture.total, 'the recorded total is the hash of the recorded cases');
  for (const g of ['cart/', 'dissolve/', 'calm/', 'chaos/', 'contrast/normal/', 'contrast/inverted/', 'experimental/', 'app/']) {
    assert.ok(fixture.cases.some((c) => c.name.startsWith(g)), `has ${g} cases`);
  }
});

test('render-hash control: a flipped hash is reported by name, and a node change is called out', () => {
  const bad = JSON.parse(JSON.stringify(fixture));
  const victim = bad.cases[Math.floor(bad.cases.length / 2)];
  victim.hash = victim.hash.replace(/^./, (c) => (c === '0' ? '1' : '0'));
  bad.total = totalOf(bad.cases);
  const r = compare(bad, current);
  assert.equal(r.ok, false);
  assert.deepEqual(r.differing, [victim.name]);
  assert.ok(r.message.includes(victim.name));
  assert.ok(r.message.includes('same as the recorded one'), 'same node: says it is a code change');
  const r2 = compare(bad, current, 'v0.0.1');
  assert.equal(r2.nodeDiffers, true);
  assert.ok(r2.message.includes('Node version differs'), 'different node: says so');
  // a missing and an extra case are named too
  const lost = JSON.parse(JSON.stringify(fixture));
  const gone = lost.cases.pop();
  lost.cases.push({ name: 'zz/not-a-case', hash: '0'.repeat(64) });
  const r3 = compare(lost, current);
  assert.deepEqual(r3.missing, ['zz/not-a-case']);
  assert.deepEqual(r3.extra, [gone.name]);
});

test('render-hash: a second run in the same process gives identical hashes (no hidden state)', async () => {
  const again = await computeAll();
  assert.equal(again.total, current.total);
});
