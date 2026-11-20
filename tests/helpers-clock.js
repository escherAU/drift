// DRIFT-9: the clocks the flash arms run on. Every flash arm before this ran on a GRID: a timer fired exactly when asked, so the app painted at exact multiples of
// 1/fps. A real machine does not: Windows fires a timer on its 15.625 ms tick, and any machine is late by a few milliseconds. The viewer, meanwhile, sees the screen
// on a fixed 18 Hz grid of their own (the meter's 1 s window is a real second). This file gives the arms three clocks and the one sampler:
//   grid    a timer fires exactly when asked (what every arm did before; keys land on frame boundaries)
//   q156    the fire time is rounded UP to the next multiple of 15.625 ms (the Windows tick)
//   jitter  late by a seeded random 0..16 ms, never early
// createClock(...) is the clock itself: now(), timer ({ set, clear }, handed to createApp as `timer`), advanceTo(ms), runUntil(ms, { keys, onSample, sampleHz }) which
// processes timers, keys and the viewer's samples in time order (at a tie: keys, then timers, then the sample), and ticks(fps, seconds), the fire times the app's own
// loop would get (the same schedule arithmetic as src/app.js loop(), the same random draws as the seam would see).
// createRun(...) is the same clock for the arms that drive the shell directly (sh.frame() / sh.tick(dt)): run.sh(sh) turns the arm's tick(1 / fps) into the clock's
// real step (dt = min(0.25, t_k - t_{k-1})), run.meter(m) keeps the meter on the 18 Hz viewer grid (a sample reads the last frame painted), run.t() is the shell's wall
// time in seconds and run.sceneIndex(k) is the frame index a pure replay of the scene should show at sample k. Without a clock it is the identity (the old behaviour).
export const QUANTUM_MS = 15.625;
export const JITTER_MS = 16;
export const VIEWER_HZ = 18;
export const CLOCK_MODES = ['grid', 'q156', 'jitter'];
const EPS = 1e-6; // ms

// xorshift32, seeded; the same stream every time for a seed, a different one for another seed
function makeRand(seed) {
  let s = (Math.imul(Math.round(Number(seed) || 0) + 1, 2654435761) >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// the time a timer asked for `delay` ms at `now` fires on this clock (a node timer's delay is at least 1 ms)
function makeFire(mode, seed, quantumMs, jitterMs) {
  if (!CLOCK_MODES.includes(mode)) throw new Error(`unknown clock mode ${JSON.stringify(mode)} (grid, q156 or jitter)`);
  const rand = makeRand(seed);
  return (now, delay) => {
    const d = Math.max(1, Number(delay) || 1);
    if (mode === 'grid') return now + d;
    if (mode === 'q156') return Math.ceil((now + d) / quantumMs - 1e-9) * quantumMs;
    return now + d + rand() * jitterMs;
  };
}

// the app's own loop schedule (src/app.js): a first timer of 1 ms, then after every loop a timer for max(1, nextAt - now) with nextAt += 1000 / fps
function makeTickSim(mode, seed, fps, quantumMs, jitterMs) {
  const fire = makeFire(mode, seed, quantumMs, jitterMs);
  const every = 1000 / fps;
  let started = false, n = 0, nextAt = 0;
  return {
    next() {
      if (!started) { started = true; n = fire(0, 1); return n; }
      nextAt += every;
      if (nextAt < n) nextAt = n + every;
      n = fire(n, Math.max(1, nextAt - n));
      return n;
    },
  };
}

export function createClock({ mode = 'grid', seed = 1, quantumMs = QUANTUM_MS, jitterMs = JITTER_MS } = {}) {
  const fire = makeFire(mode, seed, quantumMs, jitterMs);
  let now = 0, id = 0;
  const timers = [];
  const sets = []; // every set: { at, delay, due }, for the pins
  const timer = {
    set(fn, delay) {
      const due = fire(now, delay);
      const t = { id: ++id, due, fn, unref() { return t; }, ref() { return t; } };
      timers.push(t);
      sets.push({ at: now, delay: Math.max(1, Number(delay) || 1), due });
      return t;
    },
    clear(h) { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
  };
  const earliest = () => { let b = null; for (const t of timers) if (!b || t.due < b.due || (t.due === b.due && t.id < b.id)) b = t; return b; };
  function advanceTo(ms) {
    for (;;) {
      const t = earliest();
      if (!t || t.due > ms + EPS) break;
      timers.splice(timers.indexOf(t), 1);
      now = Math.max(now, t.due);
      t.fn();
    }
    now = Math.max(now, ms);
  }
  async function runUntil(endMs, { keys = [], onSample = null, sampleHz = VIEWER_HZ } = {}) {
    const ks = keys.slice().sort((a, b) => a.at - b.at);
    let ki = 0, j = Math.max(0, Math.ceil((now * sampleHz) / 1000 - 1e-9));
    for (;;) {
      const t = earliest();
      const tAt = t ? t.due : Infinity, kAt = ki < ks.length ? ks[ki].at : Infinity, sAt = (j * 1000) / sampleHz;
      const next = Math.min(tAt, kAt, sAt);
      if (next > endMs + EPS) break;
      if (kAt <= next + EPS) { now = Math.max(now, kAt); ks[ki++].fn(); }
      else if (tAt <= next + EPS) { timers.splice(timers.indexOf(t), 1); now = Math.max(now, t.due); t.fn(); }
      else {
        now = Math.max(now, sAt);
        if (onSample) await onSample({ k: j, t: sAt });
        if (j % 8 === 0) await new Promise((r) => setImmediate(r)); // the cartridge's scenes load on a promise
        j++;
      }
    }
    now = Math.max(now, endMs);
  }
  // the fire times (ms) a loop would get from this clock for `seconds`: a fresh stream of the same seed, so it equals what the seam produced from a fresh clock
  function ticks(fps, seconds) {
    const sim = makeTickSim(mode, seed, fps, quantumMs, jitterMs), out = [];
    for (;;) { const t = sim.next(); if (t > seconds * 1000 + EPS) break; out.push(t); }
    return out;
  }
  return { mode, seed, now: () => now, timer, sets, advanceTo, runUntil, ticks, pending: () => timers.length };
}

// ---- the shell-direct arms
const frameCopy = (f) => { const o = {}; for (const k of Object.keys(f)) { const v = f[k]; o[k] = ArrayBuffer.isView(v) ? v.slice() : v; } return o; };

// clock: a mode name ('grid', 'q156', 'jitter'), a { mode, seed } object, or falsy for the identity (every old arm). fps: the rate the arm asks for (its DT = 1 / fps);
// sampleHz: the viewer's grid (default 18, and the arms' own fps where they read faster).
export function createRun({ clock = null, seed = 1, fps = VIEWER_HZ, sampleHz = VIEWER_HZ, quantumMs = QUANTUM_MS, jitterMs = JITTER_MS } = {}) {
  const spec = typeof clock === 'string' ? { mode: clock, seed } : clock ? { seed, ...clock } : null;
  const DT = 1 / fps, frameMs = 1000 / fps;
  const sim = spec ? makeTickSim(spec.mode, spec.seed, fps, quantumMs, jitterMs) : null;
  const T = [0]; // T[0] = 0 (the origin; the loop's own 1 ms first tick is not a frame), then the loop's fire times
  if (sim) sim.next();
  const timeAt = (i) => { while (T.length <= i) T.push(sim.next()); return T[i]; };
  let ts = 0, ptr = 0; // wall seconds of the shell; pointer into the timeline
  let sampled = 0, paints = 0, si = 0;
  const isLoopTick = (dt) => Math.abs(dt - DT) < 1e-12;
  const tickDt = () => { // the next loop step: from the shell's wall time to the next fire time
    const wall = ts * 1000;
    while (timeAt(ptr) <= wall + EPS) ptr++;
    let dt = Math.min(0.25, (timeAt(ptr) - wall) / 1000);
    if (Math.abs(dt - DT) < 1e-9) dt = DT; // the grid's steps are exactly 1 / fps
    return dt;
  };
  const run = {
    active: !!spec, mode: spec ? spec.mode : null,
    dt: () => DT,
    t: () => ts,
    get sampled() { return sampled; },
    get paints() { return paints; },
    // the shell with tick(1 / fps) replaced by the clock's own step (any other tick passes through) and the wall time tracked
    sh(sh) {
      return new Proxy(sh, {
        get(target, p) {
          if (p === 'tick') {
            return (dt) => {
              const d = spec && isLoopTick(dt) ? tickDt() : dt;
              ts += d;
              return target.tick(d);
            };
          }
          const v = target[p];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
    // the meter, fed on the viewer's grid: push(frame) is a paint at the shell's wall time; every viewer sample at or before it reads the last frame painted
    meter(m) {
      if (!spec) return new Proxy(m, { get(target, p) { if (p === 'push') return (f, pal) => { paints++; sampled++; return target.push(f, pal); }; const v = target[p]; return typeof v === 'function' ? v.bind(target) : v; } });
      // each meter keeps its own place on the grid: its first sample is the first one at or after the shell's wall time when it was made
      let sampleIdx = Math.ceil(ts * sampleHz - 1e-9), held = null;
      return new Proxy(m, {
        get(target, p) {
          if (p === 'push') {
            return (f, pal) => {
              paints++;
              const wall = ts * 1000;
              for (;;) {
                const sAt = (sampleIdx * 1000) / sampleHz;
                if (sAt > wall + EPS) break;
                const exact = Math.abs(sAt - wall) <= EPS || !held;
                target.push(exact ? f : held.f, exact ? pal : held.pal);
                sampled++; sampleIdx++;
              }
              held = { f: frameCopy(f), pal };
            };
          }
          const v = target[p];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
    // for a pure replay of a scene at frame index k (one sample each): the frame index it shows at sample k, the last paint at or before the sample (k exactly on a grid)
    sceneIndex(k) {
      if (!spec) return k;
      const s = (k * 1000) / sampleHz;
      if (timeAt(si) > s + EPS) si = 0;
      while (timeAt(si + 1) <= s + EPS) si++;
      const idx = timeAt(si) / frameMs;
      return Math.abs(idx - Math.round(idx)) < 1e-9 ? Math.round(idx) : idx;
    },
    // the iterations of a fixed-length arm: k = 0 .. seconds * fps - 1 as before without a clock; on a clock, until `seconds` of the shell's wall time have passed
    *steps(seconds) {
      if (!spec) { const n = Math.round(seconds * fps); for (let k = 0; k < n; k++) yield k; return; }
      const t0 = ts;
      for (let k = 0; ts - t0 < seconds - 1e-9; k++) yield k;
    },
    timeline: (n) => { timeAt(n); return T.slice(0, n + 1); },
  };
  return run;
}
