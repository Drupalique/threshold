import type { Rng } from './rng';

export interface WeightedEntry<T> {
  weight: number;
  value: T;
}

export function weightedPick<T>(rng: Rng, entries: WeightedEntry<T>[]): T {
  const live = entries.filter((e) => e.weight > 0);
  const idx = rng.pickIndex(live.map((e) => e.weight));
  return live[idx].value;
}

export function uniformPick<T>(rng: Rng, values: T[]): T {
  return values[rng.int(0, values.length - 1)];
}
