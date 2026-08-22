import type { EnemyDef } from '../types/enemy';

/**
 * Static enemy roster (design doc 4.6 -> the "room as telegraphed pattern"
 * direction, generalized to per-enemy authored kits -- see
 * threshold-prototype-design.md Section 4.7, then decoupled from suits
 * entirely in 4.8). Each def's `pattern` is a fixed, repeating cycle:
 * deliberately memorizable, not a random table. `minFloor` gates a def into
 * `roomGenerator`'s eligible pool once `run.depth + 1 >= minFloor` -- this is
 * the "harder enemies show up as floors increase" knob. Enemies carry no
 * suit of their own (see types/enemy.ts); magnitudes are first-cut numbers,
 * not tuned.
 */
export const ENEMY_DEFS: EnemyDef[] = [
  {
    id: 'wolf-kin',
    name: 'Wolf-kin',
    hpMax: 14,
    minFloor: 1,
    pattern: [
      { type: 'attack', magnitude: 4 },
      { type: 'corrupt', corruptEffect: 'force-discard' },
      { type: 'attack', magnitude: 4 },
      { type: 'guard', magnitude: 5 },
    ],
  },
  {
    id: 'ember-wretch',
    name: 'Ember Wretch',
    hpMax: 16,
    minFloor: 1,
    pattern: [
      { type: 'attack', magnitude: 3 },
      { type: 'corrupt', corruptEffect: 'block-suit' },
      { type: 'attack', magnitude: 5 },
    ],
  },
  {
    id: 'rot-husk',
    name: 'Rot Husk',
    hpMax: 18,
    minFloor: 2,
    pattern: [
      { type: 'debuff', magnitude: 0.3 },
      { type: 'attack', magnitude: 4 },
      { type: 'heal', magnitude: 4 },
    ],
  },
  {
    id: 'spider-broodmother',
    name: 'Spider Broodmother',
    hpMax: 22,
    minFloor: 3,
    pattern: [
      { type: 'corrupt', corruptEffect: 'add-cards' },
      { type: 'attack', magnitude: 6 },
      { type: 'attack', magnitude: 6 },
      { type: 'guard', magnitude: 6 },
    ],
  },
];

export function enemyDefById(id: string): EnemyDef {
  const def = ENEMY_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown enemy def: ${id}`);
  return def;
}
