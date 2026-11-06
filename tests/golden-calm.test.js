// DRIFT-2 golden: calm mode must stay byte-identical to v1 (commit 35a63a0).
// (1) The whole stdout stream of the app over 200 frames (fake clock and streams,
//     a cross-fade, a `c` press and a live resize) is hashed.
// (2) The existing calm capture files are pinned by sha256 (line endings normalised
//     to LF so a CRLF checkout hashes the same).
// This file must not change during DRIFT-2.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { fakeStdin, fakeStdout, fakeProc, fakeStderr } from './helpers.js';

const sha = (s) => crypto.createHash('sha256').update(s).update('').digest('hex');

function runGolden() {
  const stdin = fakeStdin(), stdout = fakeStdout({ columns: 80, rows: 24 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-golden-'));
  const app = createApp({
    stdin, stdout, stderr: fakeStderr(), proc: fakeProc(), env: { COLORTERM: 'truecolor' },
    configPath: path.join(dir, 'drift', 'config.json'),
    autoLoop: false, seed: 1, sceneSeconds: 4, fadeSeconds: 3,
  });
  app.start();
  for (let f = 0; f < 200; f++) {
    if (f === 40) stdin.emit('data', 'c');
    if (f === 100) { stdout.columns = 100; stdout.rows = 30; stdout.emit('resize'); }
    app.tick(1 / 18);
  }
  const fadedAt = app.getState();
  app.quit(0);
  fs.rmSync(dir, { recursive: true, force: true });
  return { stream: stdout.writes.join('\u0000'), state: fadedAt };
}

test('golden calm: the full stdout stream over 200 frames (cross-fade, c, resize) is byte-identical to v1', () => {
  const a = runGolden();
  const b = runGolden();
  assert.equal(sha(a.stream), sha(b.stream), 'deterministic across two runs');
  assert.equal(a.state.sceneIndex >= 1, true, 'a cross-fade completed');
  assert.equal(a.state.colour, 'amber');
  assert.equal(a.stream.length, GOLDEN_LENGTH, 'stream length');
  assert.equal(sha(a.stream), GOLDEN_SHA, 'stream sha256');
});

const here = path.dirname(fileURLToPath(import.meta.url));
const CAP_DIR = path.join(here, '..', 'captures');

test('golden calm: existing calm capture files match their v1 sha256', () => {
  for (const [name, want] of Object.entries(CAPTURE_SHAS)) {
    const raw = fs.readFileSync(path.join(CAP_DIR, name), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(sha(raw), want, name);
  }
  assert.equal(Object.keys(CAPTURE_SHAS).length, 24);
});

const GOLDEN_LENGTH = 283620;
const GOLDEN_SHA = '7e95e9626329c08afe7125814e68da6b08059774655865708ca78f1b59e98f68';
const CAPTURE_SHAS = {
  'crossfade-120x40.txt': '4f05d5bf9a15386046aef7c3436a5e2477b038784670c8cca617aa25b57852ee',
  'crossfade-240x67.txt': '1e7e9f753fab1f605761706d8aec8eef0201e00411138ffd5bd721140a46bdfb',
  'plasma-120x40.txt': 'b1b5e5c72f411fd749554a3a801e0f74476d89f8ab68d1cd39b985242747652f',
  'plasma-240x67.txt': '06ab2268bf952dc01c6bd36694b955dbbf8cd52ba3b67e5d907d0661c94e754b',
  'rain-120x40.txt': '2b0f4c42b02e7ec3256b612b715ff95db04565f11f16024a196184e710765455',
  'rain-240x67.txt': 'eb68a727e1305b9b7d669bb0d8f8addceb3b497d60018eb0a376dea6a017cfff',
  'ripples-120x40.txt': '60724515a699566cbef6ebfa30c420c6af22725f90dfe7233f5ae9523cd297a8',
  'ripples-240x67.txt': '35643d80ea5263ecac66f8223bb3843c98ed2ab8af72fb0645289ce32bf6e2b9',
  'squiggle-120x40.txt': '33f5f1452264ddf5ad6b6b24fff4194e22e994f5e8b18b949a8543f3498f51f8',
  'squiggle-240x67.txt': 'f656f167ea8a05f1af61f1dd72b432b886addb59cefe041bb953269d9425deee',
  'sunburst-120x40.txt': '7afa39d8d27ccb44bbb703a13a328dffd84f3c6ca9b3f9fc1ed1ebcf49864a92',
  'sunburst-240x67.txt': '3ea9e0b1bbaa1e1249b4577b2f5f993e5394be09e89de3ba216bcf2b880d63c9',
  'crossfade-120x40.ansi': '958e8c20cb7a87ffe72fe5a696c5d9b3b65f2f9059362981413411ea21bed692',
  'crossfade-240x67.ansi': '4d1ccd5a9c31ddac0b97f6fbdb2b72f1c54e59d7c20d04d1d78595948d684a8b',
  'plasma-120x40.ansi': '9a548ee61529504347d156093b3bf6d3c00e43a064dfaba79b68df9bbd0609e7',
  'plasma-240x67.ansi': '0324140f0cd799bf971061a578f5bb9e3fe0a39738808bdf1b9c4a6a063c866a',
  'rain-120x40.ansi': 'a87403dc19f8f40c0a7dcaea5124de0f8d31c04649a4536f4cd1caf515cbb0eb',
  'rain-240x67.ansi': '506376fdf631ec7e0282e36f07583cf942227623661251a87e47391019b044cd',
  'ripples-120x40.ansi': 'aaf67936545bf248bfa677cb49fc189b4d93349d81f04efc36427d4de1bd2f12',
  'ripples-240x67.ansi': '85f7cf376b8fba4fc95fd5725d26aecc56c775524ddcf37da613f6cb3057b38f',
  'squiggle-120x40.ansi': 'b7cdbb671634e43d41ef87a6d240ff443f63f7008ad1aeaac2c950924f8ba4d2',
  'squiggle-240x67.ansi': '423723e71064d68cfe89c5e57bc6e4b4a0b3d3e507da58b6f07fd264d2b16b25',
  'sunburst-120x40.ansi': '04cc318f436bd1948dbe57c0f263e1c5a81488984ed7653a683ecd01aeaa8771',
  'sunburst-240x67.ansi': 'b1de1b12b8d767f74e2ef097314d7edb8a8e08f8b82a7449855fd9d05a601b0e',
};
