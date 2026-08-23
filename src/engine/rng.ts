export interface Rng {
  next(): number; // float in [0, 1)
  int(min: number, max: number): number; // inclusive both ends
  pickIndex(weights: number[]): number;
  // Exposes the internal 32-bit generator state so callers that can't stay
  // resident in one process (e.g. a CLI driven one command per invocation --
  // see scripts/playtest.ts) can persist and resume a run's exact random
  // sequence across process boundaries via createRngFromState.
  getState(): number;
}

// mulberry32 -- small, fast, deterministic PRNG so runs are reproducible from a seed.
function fromState(state: number): Rng {
  function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min: number, max: number): number {
    return min + Math.floor(next() * (max - min + 1));
  }

  function pickIndex(weights: number[]): number {
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  return { next, int, pickIndex, getState: () => state };
}

export function createRng(seed: number): Rng {
  return fromState(seed >>> 0);
}

export function createRngFromState(state: number): Rng {
  return fromState(state);
}
