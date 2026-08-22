export interface Rng {
  next(): number; // float in [0, 1)
  int(min: number, max: number): number; // inclusive both ends
  pickIndex(weights: number[]): number;
}

// mulberry32 -- small, fast, deterministic PRNG so runs are reproducible from a seed.
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

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

  return { next, int, pickIndex };
}
