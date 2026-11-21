// DRIFT-12 part A, item 7: the size card and the five flash rules (L1, L2, L3, R, C at the viewer's own second) on the REAL app, the bytes read back through the terminal reader and
// read at the viewer's 18 Hz grid (tests/helpers-size-card-flash.js; how a resize is read is set out at the top of that file).
//   (a) parked on the card for 12 s, in every mode, both colour modes, seeds 1 to 3
//   (b) the window crossing the threshold once, art to card to art with a 3 s gap (40x10 to 39x10 and 40x10 to 40x9, one cell of the window), in every mode
//   (b2) one swap a second for 3 s (every seed passes)
//   (c) the hardest case, four swaps a second for 3 s: MEASURED, NOT PASSED (see the last tests): the rules are not loosened and nothing was added to hold the screen still
// The first arms run on the exact grid; the q156 and jitter clock arms are a share of those (counted, CLOCK_ARM_SHARE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCardFlash, cardNums, cardFailed, cardLine, swapEvents } from './helpers-size-card-flash.js';
import { failedRules, X1_RULE_IDS } from './helpers-flash.js';
import { clockArm, judgeX1, assertArmCost } from './helpers-clock-arms.js';
import { CMODES } from './helpers-size-card.js';

const SEEDS = [1, 2, 3];
const judged = (rep, label) => assert.deepEqual(failedRules(rep, { only: X1_RULE_IDS }), [], `${label}: ${cardLine(rep)}`);
// the five rules for each way of showing contrast: normal and inverted
const CONTRAST = [{ startMode: 'contrast', invert: false }, { startMode: 'contrast', invert: true }];
const OTHERS = [{ startMode: 'calm' }, { startMode: 'chaos' }, { startMode: 'experimental' }];

test('7a parked on the card, grid, contrast normal and inverted, both colour modes, 39x10, 40x9 and 10x4, seeds 1 to 3: the five rules pass', async () => {
  for (const cmode of CMODES) for (const m of CONTRAST) for (const [cols, rows] of [[39, 10], [40, 9], [10, 4]]) for (const seed of SEEDS) {
    const r = await runCardFlash({ ...m, cmode, seed, cols, rows, seconds: 12 });
    judged(r.rep, `7a ${m.startMode}${m.invert ? ' inverted' : ''} ${cmode} ${cols}x${rows} seed ${seed}`);
    const n = cardNums(r.rep);
    assert.equal(n['l1.x1'] + n['l2.x1'] + n.l3, 0, `a static card does not change at all (${cardLine(r.rep)})`);
  }
});

test('7a parked on the card, grid, calm, chaos and experimental, both colour modes, 39x10 and 40x9, seed 1: the five rules pass', async () => {
  for (const cmode of CMODES) for (const m of OTHERS) for (const [cols, rows] of [[39, 10], [40, 9]]) {
    const r = await runCardFlash({ ...m, cmode, seed: 1, cols, rows, seconds: 12 });
    judged(r.rep, `7a ${m.startMode} ${cmode} ${cols}x${rows}`);
  }
});

const CROSSINGS = [{ from: [40, 10], card: [39, 10], label: '40x10 to 39x10' }, { from: [40, 10], card: [40, 9], label: '40x10 to 40x9' }];
const crossing = (c) => [{ at: 4, size: c.card }, { at: 7, size: c.from }];

test('7b crossing the threshold once, grid, contrast normal and inverted, both colour modes, art to card (3 s) to art, seeds 1 to 3: the five rules pass', async () => {
  for (const cmode of CMODES) for (const m of CONTRAST) for (const c of CROSSINGS) for (const seed of SEEDS) {
    const r = await runCardFlash({ ...m, cmode, seed, cols: c.from[0], rows: c.from[1], seconds: 12, events: crossing(c) });
    assert.equal(r.swaps, 2);
    judged(r.rep, `7b ${m.startMode}${m.invert ? ' inverted' : ''} ${cmode} ${c.label} seed ${seed}`);
  }
});

// Classic's chaos mode is not held to the five rules by any test and its ART alone reads R over the limit (37.50 % at seed 1 at 40x10 by 12 s, with no resize at all: README, "What the
// five rules do not cover"). So here a rule may be over its limit only where the art alone, run for the same 12 s with no resize, is over it too, and then never by more than the art alone.
test('7b crossing the threshold once, grid, calm, chaos and experimental, both colour modes, art to card (3 s) to art, seeds 1 to 3: the card adds nothing the art did not have (every rule passes or reads no worse than the art alone)', async () => {
  for (const cmode of CMODES) for (const m of OTHERS) for (const c of CROSSINGS) for (const seed of SEEDS) {
    const label = `7b ${m.startMode} ${cmode} ${c.label} seed ${seed}`;
    const r = await runCardFlash({ ...m, cmode, seed, cols: c.from[0], rows: c.from[1], seconds: 12, events: crossing(c) });
    const art = await runCardFlash({ ...m, cmode, seed, cols: c.from[0], rows: c.from[1], seconds: 12 });
    const n = cardNums(r.rep), a = cardNums(art.rep);
    for (const id of cardFailed(r.rep)) {
      assert.ok(cardFailed(art.rep).includes(id), `${label}: ${id} fails only with the card: ${cardLine(r.rep)} (art alone ${cardLine(art.rep)})`);
      assert.ok(n[id] <= a[id] + 1e-9, `${label}: ${id} reads ${n[id]} with the card, ${a[id]} on the art alone`);
    }
    for (const id of ['l1.x1', 'l2.x1', 'l3']) assert.ok(n[id] < 25 || id === 'l3' && n[id] < 30, `${label}: ${id} passes: ${cardLine(r.rep)}`);
  }
});

test('7b2 one swap a second for 3 s across the threshold, grid, contrast normal and inverted, both colour modes, seeds 1 to 3: the five rules pass', async () => {
  for (const cmode of CMODES) for (const m of CONTRAST) for (const seed of SEEDS) {
    const r = await runCardFlash({ ...m, cmode, seed, cols: 40, rows: 10, seconds: 10, events: swapEvents([39, 10], [40, 10], 1, 4, 7) });
    assert.equal(r.swaps, 3);
    judged(r.rep, `7b2 ${m.startMode}${m.invert ? ' inverted' : ''} ${cmode} seed ${seed}`);
  }
});

test('7 clock arm, q156 and jitter, 256 colours and truecolor: parked on the card and one crossing (seed 2 is the worst seed of the grid arms)', async () => {
  for (const clock of ['q156', 'jitter']) {
    await clockArm(async () => {
      for (const [cmode, invert, seed] of [['256', true, 2], ['truecolor', false, 2]]) {
        const park = await runCardFlash({ startMode: 'contrast', invert, cmode, seed, clock, cols: 39, rows: 10, seconds: 8 });
        judgeX1(park.rep, `7 parked ${clock} ${cmode}${invert ? ' inverted' : ''} seed ${seed}`);
        const cross = await runCardFlash({ startMode: 'contrast', invert, cmode, seed, clock, cols: 40, rows: 10, seconds: 10, events: crossing(CROSSINGS[0]) });
        judgeX1(cross.rep, `7 crossing ${clock} ${cmode}${invert ? ' inverted' : ''} seed ${seed}`);
      }
    });
  }
});

// ---- (c) MEASURED, NOT PASSED. Four swaps a second for 3 s (a resize every 0.25 s) is a person dragging the window edge across the threshold and back as fast as a hand goes.
// The screen then swaps between the card and the art 8 times a second, and the rules fail on L2 (and on q156, seed 2, L3): measured below. The same 4-a-second swapping between two
// ART sizes (40x10 and 41x10, no card involved) fails harder, so the card is not the cause: resizing the Classic art reseeds it every time. Nothing was loosened and no debounce was
// added (a decision for the owner, in the report). These tests pin the measurement so that a later fix is noticed.

test('7c MEASURED: four swaps a second for 3 s across the threshold: L2 fails on every seed (L1, R and C stay at 0), grid, contrast, 256 colours', async () => {
  for (const seed of SEEDS) {
    const r = await runCardFlash({ startMode: 'contrast', cmode: '256', seed, cols: 40, rows: 10, seconds: 10, events: swapEvents([39, 10], [40, 10], 0.25, 4, 7) });
    assert.equal(r.swaps, 12);
    const n = cardNums(r.rep);
    console.log(`7c MEASURED seed ${seed}: ${cardLine(r.rep)}`);
    assert.deepEqual(cardFailed(r.rep).filter((id) => id !== 'l2.x1'), [], `seed ${seed}: only L2 fails (L3 stays under its limit on the grid) ${cardLine(r.rep)}`);
    assert.ok(n['l2.x1'] > 25, `seed ${seed}: L2 over its limit: ${n['l2.x1']}`);
    assert.equal(n['l1.x1'] + n['r.x1'] + n.c, 0);
  }
});

test('7c MEASURED control: the same four swaps a second between two ART sizes (40x10 and 41x10, no card) fails too: the failure is the resize, not the card', async () => {
  for (const seed of [1, 2]) {
    const r = await runCardFlash({ startMode: 'contrast', cmode: '256', seed, cols: 40, rows: 10, canvas: [41, 10], seconds: 10, events: swapEvents([41, 10], [40, 10], 0.25, 4, 7) });
    console.log(`7c MEASURED art-to-art seed ${seed}: ${cardLine(r.rep)}`);
    assert.ok(cardFailed(r.rep).length > 0, `seed ${seed}: art to art fails too ${cardLine(r.rep)}`);
  }
});

test('7 the clock arms read a small share of the frames the grid arms read (counted, under 15 %)', () => {
  assertArmCost('classic-size-card-flash');
});
