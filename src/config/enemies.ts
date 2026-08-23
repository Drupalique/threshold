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
    // Strength stacks decay 1/turn (see engine/statusEffects.ts), so the 3
    // stacks banked here have faded to 2 by the time the cycle's first
    // attack lands and 0 by the second -- one boosted hit (4 -> 6) per
    // cycle, not two. First demonstration enemy for the Strength status.
    pattern: [
      { type: 'attack', magnitude: 4 },
      { type: 'corrupt', corruptEffect: 'force-discard' },
      { type: 'attack', magnitude: 4 },
      { type: 'strength', magnitude: 3 },
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
    // 3 Weaken stacks x WEAKEN_PCT_PER_STACK (0.1) = 30%, same reduction the
    // old flat-fraction debuff dealt -- converted to stacks, not rebalanced.
    // First demonstration enemy for the "feed" intent (MECHANIC_BRAINSTORM.md):
    // a patient, control-flavored enemy fattening the Ward pile it doesn't
    // own and can't itself claim, banking on the pile decaying later to
    // shield itself (and any packmate) for free -- reusing Finding 4's
    // decay-benefits-more-bodies asymmetry as deliberate enemy behavior
    // rather than a passive stat quirk.
    pattern: [
      { type: 'debuff', magnitude: 3 },
      { type: 'attack', magnitude: 4 },
      { type: 'heal', magnitude: 4 },
      { type: 'feed', feedSuit: 'ward', magnitude: 2 },
    ],
  },
  {
    id: 'spider-broodmother',
    name: 'Spider Broodmother',
    hpMax: 22,
    minFloor: 3,
    // First demonstration enemy for the Poison status -- one of its two
    // attacks is a venom bite instead, applying 4 Poison stacks (4 damage
    // next turn, decaying) rather than an immediate flat hit.
    pattern: [
      { type: 'corrupt', corruptEffect: 'add-cards' },
      { type: 'attack', magnitude: 6 },
      { type: 'poison', magnitude: 4 },
      { type: 'guard', magnitude: 6 },
    ],
  },
];

export function enemyDefById(id: string): EnemyDef {
  const def = ENEMY_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown enemy def: ${id}`);
  return def;
}
