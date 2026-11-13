// DRIFT-8 C6: tools/tty-probe.mjs, the probe the owner runs in a real terminal. Its whole body is run(), driven here on a fake terminal and node's mock
// timers (no wall time): the frames are all-cells-changing and wrapped in the synchronised-output markers, the once-a-second lines carry all seven
// fields, the flood phase writes exactly 5 frames back to back, the restore is the last write, the q timing is printed, and a stream that never
// calls back still ends (and restores, as far as the stream lets it) instead of hanging the probe.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { run, makeFrames, FLOOD_FRAMES, RING } from '../tools/tty-probe.mjs';
import { ENTER, LEAVE } from '../src/term.js';
import { SYNC_BEGIN, SYNC_END } from '../src/renderer.js';
import { fakeStdin, fakeStdout, stuckStdout, fakeProc } from './helpers.js';

const CELL = /\x1b\[38;2;(\d+);(\d+);(\d+);48;2;(\d+);(\d+);(\d+)m(.)/g;
const cellsOf = (frame) => [...frame.matchAll(CELL)].map((m) => m.slice(1, 8));
const hist = () => ({ enable() {}, disable() {}, reset() {}, percentile: (p) => p * 20000, max: 7e6 });
const isFrame = (w) => w.startsWith(SYNC_BEGIN);

// Run the probe to its end. pressAt: [ms after the start, key]; releaseAfterQ: the stream calls the restore write back this long after the q (stuckStdout).
async function drive({ stdout, seconds = 3, fps = 18, cols = 24, rows = 6, press = null, releaseAfter = null, deadlineMs = 4000, defaultPrint = false, limit = 120000, onStep = null } = {}) {
  let ms = 5000;
  const t0 = ms;
  const now = () => ms;
  const stdin = fakeStdin(), proc = fakeProc();
  const stamped = []; // the ms of every write
  const orig = stdout.write;
  stdout.write = (s, cb) => { stamped.push(ms); return orig(s, cb); };
  const printed = [];
  mock.timers.enable({ apis: ['setTimeout'] });
  let result = null;
  try {
    run({
      stdout, stdin, proc, now, seconds, fps, cols, rows, loopDelay: hist, deadlineMs,
      ...(defaultPrint ? {} : { print: (l) => printed.push(l) }),
    }).then((r) => { result = r; });
    let pressedAt = null;
    for (let i = 0; i < limit && !result; i++) {
      ms += 1;
      mock.timers.tick(1);
      if (press && ms - t0 === press[0]) { stdin.emit('data', press[1]); pressedAt = ms; }
      if (releaseAfter !== null && pressedAt !== null && ms - pressedAt === releaseAfter) stdout.release();
      if (onStep) onStep(ms - t0, { stdin, proc, stdout });
      if (i % 20 === 0) await Promise.resolve();
    }
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.ok(result, 'the probe ended (it did not hang)');
    return { result, printed, stdout, stdin, proc, stamped, ms: ms - t0 };
  } finally { mock.timers.reset(); }
}

const lastSix = (printed) => printed.slice(-6);

test('tty-probe: every cell of every frame changes (truecolor fg and bg in each cell, a different glyph), at the usual sizes', () => {
  for (const [cols, rows] of [[24, 6], [80, 24], [120, 40]]) {
    const frame = makeFrames(cols, rows);
    let prev = cellsOf(frame(0));
    assert.equal(prev.length, cols * rows, `${cols}x${rows}: every cell is in the frame`);
    for (let k = 1; k < 12; k++) {
      const cur = cellsOf(frame(k));
      let unchanged = 0;
      for (let i = 0; i < cur.length; i++) {
        for (let j = 0; j < 6; j++) if (cur[i][j] === prev[i][j]) unchanged++;
        if (cur[i][6] === prev[i][6]) unchanged++;
      }
      assert.equal(unchanged, 0, `${cols}x${rows} frame ${k}: ${unchanged} colour channels or glyphs did not move`);
      prev = cur;
    }
  }
});

test('tty-probe: a 280x70 frame is 600 to 900 KB (the size per frame the probe reports)', () => {
  const bytes = Buffer.byteLength(makeFrames(280, 70)(0));
  assert.ok(bytes > 600000 && bytes < 900000, `frameBytes ${bytes}`);
});

test('tty-probe: the frames it writes are those frames, each wrapped in the synchronised-output markers, between ENTER and LEAVE; the restore is the last write', async () => {
  const d = await drive({ stdout: fakeStdout() });
  const w = d.stdout.writes;
  const frames = w.filter(isFrame);
  assert.ok(frames.length >= 3 * 18 - 2, `about 3 s of frames at 18 fps (${frames.length})`);
  const want = makeFrames(24, 6);
  frames.forEach((f, i) => assert.equal(f, want(i % RING), `write ${i} is frame ${i % RING} of the ring`));
  for (const f of frames) assert.ok(f.startsWith(SYNC_BEGIN) && f.endsWith(SYNC_END) && f.length > SYNC_BEGIN.length + SYNC_END.length, 'wrapped');
  assert.equal(w[0], ENTER);
  assert.equal(w[w.length - 1], LEAVE, 'the restore sequence is the last write');
  assert.equal(w.filter((x) => x === LEAVE).length, 2, 'once after the run and once after the flood');
  assert.equal(w.filter((x) => !isFrame(x) && x !== ENTER && x !== LEAVE).length, 0, 'nothing but frames, ENTER and LEAVE is written');
  assert.equal(d.stdin.rawCalls[d.stdin.rawCalls.length - 1], false, 'raw mode is off at the end');
  assert.equal(d.stdin.paused, true);
  // consecutive frames: every cell changed
  const cells = frames.map(cellsOf);
  for (let i = 1; i < cells.length; i++) {
    let same = 0;
    for (let c = 0; c < cells[i].length; c++) for (let j = 0; j < 7; j++) if (cells[i][c][j] === cells[i - 1][c][j]) same++;
    assert.equal(same, 0, `frame ${i} differs from frame ${i - 1} in every cell`);
  }
});

test('tty-probe: one line a second with all seven fields, then the six PROBE summary lines in the stated form', async () => {
  const d = await drive({ stdout: fakeStdout(), seconds: 4 });
  const perSecond = d.printed.filter((l) => /^\[ *\d+ s\]/.test(l));
  assert.equal(perSecond.length, 4, perSecond.join('\n'));
  const LINE = /^\[ *(\d+) s\] bytes=(\d+) writeFalse=(\d+) needDrainTicks=(\d+) maxWritableLength=(\d+) loopDelayMs p50=([\d.]+) p99=([\d.]+) max=([\d.]+)$/;
  perSecond.forEach((l, i) => {
    const m = LINE.exec(l);
    assert.ok(m, `all seven fields: ${l}`);
    assert.equal(Number(m[1]), i + 1);
    assert.ok(Number(m[2]) > 0, 'bytes were written in that second');
  });
  const s = lastSix(d.printed);
  assert.match(s[0], /^PROBE size=24x6 frameBytes=\d+$/);
  assert.match(s[1], /^PROBE seconds=\d+\.\d frames=\d+ bytes=\d+$/);
  assert.match(s[2], /^PROBE writeFalse=\d+ needDrainTicks=\d+ maxWritableLength=\d+$/);
  assert.match(s[3], /^PROBE loopDelayMs p50=[\d.]+ p99=[\d.]+ max=[\d.]+$/);
  assert.match(s[4], /^PROBE quitMs=\d+$/);
  assert.match(s[5], /^PROBE flood5 quitMs=\d+ restored=yes$/);
  // the numbers are the run's: the frame count and the bytes are those of the frames written (a frame's size moves a little with its digits)
  const written = d.stdout.writes.filter(isFrame);
  const [, fb] = /frameBytes=(\d+)/.exec(s[0]);
  const [, frames, bytes] = /seconds=[\d.]+ frames=(\d+) bytes=(\d+)/.exec(s[1]);
  assert.equal(Number(frames), written.length);
  assert.equal(Number(bytes), written.reduce((n, w) => n + Buffer.byteLength(w), 0));
  assert.equal(Number(fb), Buffer.byteLength(written[0]), 'frameBytes is the size of one frame');
  assert.deepEqual(d.result.summary, s);
});

test('tty-probe: the flood writes exactly 5 frames back to back (the same millisecond, nothing between them), then the restore', async () => {
  const d = await drive({ stdout: fakeStdout() });
  const w = d.stdout.writes;
  const iLeave = w.indexOf(LEAVE);
  assert.ok(iLeave > 0);
  const tail = w.slice(iLeave);
  assert.equal(tail.length, 1 + 1 + FLOOD_FRAMES + 1, 'LEAVE, ENTER, 5 frames, LEAVE');
  assert.equal(FLOOD_FRAMES, 5);
  assert.equal(tail[0], LEAVE);
  assert.equal(tail[1], ENTER);
  assert.ok(tail.slice(2, 7).every(isFrame), 'five frames');
  assert.equal(tail[7], LEAVE);
  const at = d.stamped.slice(iLeave);
  assert.ok(at.slice(1).every((t) => t === at[1]), `no time passes between the enter, the five frames and the restore: ${at.join(',')}`);
  // frames of the flood are new frames, each different from the one before
  assert.equal(new Set(tail.slice(2, 7)).size, 5);
});

test('tty-probe: q is timed from the key to the moment the restore write is confirmed (150 ms here), Ctrl+C the same, and the flood quit after it', async () => {
  for (const key of ['q', 'Q', '\x03']) {
    const d = await drive({ stdout: stuckStdout({ columns: 24, rows: 6, highWaterMark: 1e12 }), press: [1234, key], releaseAfter: 150, seconds: 30 });
    const s = lastSix(d.printed);
    assert.equal(s[4], 'PROBE quitMs=150', `${JSON.stringify(key)}: ${s[4]}`);
    assert.match(s[5], /^PROBE flood5 quitMs=\d+ restored=(yes|no)$/);
    assert.ok(d.printed.some((l) => l === 'NOTE quitMs is timed from a key'));
    assert.match(s[1], /^PROBE seconds=1\.2 /, 'the run stopped at the key (1.2 s)');
    assert.equal(d.stdout.writes[d.stdout.writes.length - 1], LEAVE);
  }
});

test('tty-probe: with no key, the run ends at --seconds and the quit is timed from the end of the run', async () => {
  const d = await drive({ stdout: fakeStdout(), seconds: 2 });
  assert.ok(d.printed.includes('NOTE quitMs is timed from the end of the run'));
  assert.ok(d.ms >= 2000 && d.ms < 2200, `ended at ${d.ms} ms`);
  assert.equal(lastSix(d.printed)[4], 'PROBE quitMs=0');
});

test('tty-probe: a stream that never calls back still ends: the restore is the last write, the flood says restored=no, and the probe says it was not confirmed', async () => {
  const d = await drive({ stdout: stuckStdout({ columns: 24, rows: 6 }), press: [500, 'q'], deadlineMs: 2000, seconds: 30 });
  assert.equal(d.stdout.writes[d.stdout.writes.length - 1], LEAVE, 'the restore sequence was written last');
  assert.equal(d.stdin.rawCalls[d.stdin.rawCalls.length - 1], false);
  const s = lastSix(d.printed);
  assert.equal(s[4], 'PROBE quitMs=2000', 'the wait, not a measurement');
  assert.match(s[5], /^PROBE flood5 quitMs=2000 restored=no$/);
  assert.ok(d.printed.some((l) => l.startsWith('NOTE the restore write was not confirmed within 2000 ms')));
  assert.ok(d.ms < 500 + 2000 + 2000 + 100, `it ended by its own deadlines (${d.ms} ms)`);
  // the stall shows in the counters: write() returned false, needDrain ticks were counted, the queue was seen
  assert.match(s[2], /^PROBE writeFalse=[1-9]\d* needDrainTicks=[1-9]\d* maxWritableLength=[1-9]\d*$/);
});

test('tty-probe: SIGTERM, SIGINT and an uncaught error restore the terminal and end the probe (143, 130, 1)', async () => {
  for (const [ev, code, arg] of [['SIGTERM', 143], ['SIGINT', 130], ['uncaughtException', 1, new Error('probe boom')]]) {
    const d = await drive({ stdout: fakeStdout(), seconds: 30, onStep: (t, h) => { if (t === 700) h.proc.emit(ev, arg); } });
    assert.equal(d.result.code, code, ev);
    assert.equal(d.stdout.writes[d.stdout.writes.length - 1], LEAVE, `${ev}: the terminal is restored`);
    assert.equal(d.stdin.rawCalls[d.stdin.rawCalls.length - 1], false);
    assert.equal(d.proc.listenerCount(ev), 0, 'the guards are removed');
    assert.equal(lastSix(d.printed).length, 6);
    if (arg) assert.ok(d.printed.some((l) => l.includes('probe boom')));
  }
});

test('tty-probe: with the default print the lines come after the terminal is restored (never inside the alternate screen)', async () => {
  const d = await drive({ stdout: fakeStdout(), seconds: 2, defaultPrint: true });
  const w = d.stdout.writes;
  const lastLeave = w.lastIndexOf(LEAVE);
  const after = w.slice(lastLeave + 1);
  assert.ok(after.length >= 2 + 6, `${after.length} lines after the last restore`);
  assert.ok(after.every((x) => x.endsWith('\n')));
  assert.ok(after.some((x) => /^PROBE flood5 quitMs=\d+ restored=yes\n$/.test(x)));
});
