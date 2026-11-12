// DRIFT-7 C6: every key label a cartridge words for the help panel is 23 characters or fewer, so the tight panel (41x11)
// shows each whole. Generalises Night Drive's E7 b check (tests/night-drive-shell-edges-b.test.js) to every install cartridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverCartridges, INSTALL_DIR } from '../src/cartridge/loader.js';

export const LABEL_MAX = 23;
const found = discoverCartridges({ dirs: [{ dir: INSTALL_DIR, trusted: true }] });
const withSkin = found.cartridges.filter((c) => c.skin && c.skin.wording && c.skin.wording.keys);

test('install cartridges: discovery has no errors and more than one cartridge words its keys', () => {
  assert.deepEqual(found.errors, []);
  assert.ok(withSkin.length >= 3, withSkin.map((c) => c.id).join());
});

// Delza (shipped in DRIFT-4, byte-for-byte pinned by tools/render-hash.mjs and the shell captures) words four keys
// past 23. Pinned here, exactly, so the list can neither grow nor go stale; no other cartridge is exempt.
export const KNOWN_LONG = Object.freeze({
  delza: { menu: 'open the journal, or choose', 'menu-prev': 'journal: previous chapter', close: 'close the journal or page', pause: 'rest (pause) or carry on' },
});

for (const cart of withSkin) {
  test(`install/${cart.id}: every wording.keys label is ${LABEL_MAX} characters or fewer${KNOWN_LONG[cart.id] ? ' (except the pinned list)' : ''}`, () => {
    const long = Object.fromEntries(Object.entries(cart.skin.wording.keys).filter(([, label]) => [...label].length > LABEL_MAX));
    assert.deepEqual(long, KNOWN_LONG[cart.id] ?? {});
  });
}

test('key-label check bites: a 24-character label is caught (control)', () => {
  const labels = { ok: 'x'.repeat(23), bad: 'x'.repeat(24) };
  assert.deepEqual(Object.entries(labels).filter(([, l]) => [...l].length > LABEL_MAX).map(([k]) => k), ['bad']);
});

test('the skin file on disk is the one loaded (the check reads what the shell reads)', () => {
  for (const cart of withSkin) {
    const raw = JSON.parse(fs.readFileSync(path.join(INSTALL_DIR, cart.id, 'skin.json'), 'utf8'));
    assert.deepEqual(cart.skin.wording.keys, raw.wording.keys, cart.id);
  }
});
