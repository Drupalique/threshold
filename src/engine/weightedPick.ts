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

/** Picks `count` distinct values from `values` (order not preserved), without replacement. */
export function pickDistinct<T>(rng: Rng, values: T[], count: number): T[] {
  const remaining = [...values];
  const picked: T[] = [];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const idx = rng.int(0, remaining.length - 1);
    picked.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return picked;
}
