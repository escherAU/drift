// A level shimmer: many small things that each change now and then, planned so that no tick has more than a few of them changing.
//
// Time is cut into ticks of 0.06 s. A frame at 18 fps is 0.0556 s, so one frame never spans two ticks; at 4x it spans four. A thing has a
// period of P ticks and a phase, and changes on the ticks where (tick + phase) is a multiple of P. plan() gives each thing the period
// (from a short list) and the phase that keep the busiest tick as quiet as it can be: the things are placed one after another on a table
// as long as the common multiple of the periods, each at the phase that adds to the lightest ticks. The result is a pure function of the
// arguments, so a scene can cache it by (size, seed).
import { rand } from '../../../src/scenes/util.js';

export const TICK = 0.06;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export const lcm = (a, b) => (a / gcd(a, b)) * b;

// The tick a time falls in (never negative).
export function tickAt(T) {
  return T > 0 ? Math.floor(T / TICK + 1e-9) : 0;
}

// How many times a thing with (period P, phase) has changed by tick u: changes happen on ticks mP - phase for m = 1, 2, ...
export function changesAt(u, phase, P) {
  return Math.floor((u + phase) / P);
}

// n things; periods is the list a thing's period is drawn from (in ticks); salt keeps two plans in one scene apart.
// Returns { P: Uint8Array, phase: Uint16Array, busiest, length } where busiest is the most changes any one tick has.
export function plan(n, periods, seed, salt) {
  const length = periods.reduce(lcm, 1);
  const load = new Uint16Array(length);
  const P = new Uint8Array(n), phase = new Uint16Array(n);
  let busiest = 0;
  for (let i = 0; i < n; i++) {
    const p = periods[Math.floor(rand(seed + salt, i, 0) * periods.length) % periods.length];
    P[i] = p;
    let best = 0, bestMax = Infinity, bestSum = Infinity;
    for (let f = 0; f < p; f++) {
      let mx = 0, sum = 0;
      for (let s = (p - f) % p; s < length; s += p) { const v = load[s]; if (v > mx) mx = v; sum += v; }
      if (mx < bestMax || (mx === bestMax && sum < bestSum)) { best = f; bestMax = mx; bestSum = sum; }
    }
    phase[i] = best;
    for (let s = (p - best) % p; s < length; s += p) { load[s]++; if (load[s] > busiest) busiest = load[s]; }
  }
  return { P, phase, busiest, length };
}
