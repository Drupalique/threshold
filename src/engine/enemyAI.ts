import type { Rng } from './rng';
import type { EnemyInstance } from '../types/enemy';
import type { TableCard } from '../types/combat';
import type { SuitId, SuitCategory } from '../types/suits';
import { SUIT_DEFINITIONS, ENEMY_LOW_HP_HEAL_GUARD_THRESHOLD_PCT } from '../config/constants';
import { countTableSetSize } from './tableState';
import { weightedPick } from './weightedPick';

export interface EnemyPlayChoice {
  suit: SuitId;
  handCardIds: string[];
}

const LOW_HP_HEAL_GUARD_BOOST = 3.0;

// SuitCategory is 'threat'|'boon'|'guard'|StatusId (see types/suits.ts) --
// no suit's category is (or is planned to be) vulnerable/regen/haste/slow
// today, only weaken/poison/strength have a status-suit, but the Record
// still needs every StatusId covered to typecheck. Unreachable in practice.
const CATEGORY_WEIGHT: Record<SuitCategory, number> = {
  threat: 2.0,
  weaken: 1.5,
  poison: 1.5,
  guard: 1.2,
  boon: 1.0,
  strength: 0.8,
  vulnerable: 1.0,
  regen: 1.0,
  haste: 1.0,
  slow: 1.0,
};

const suitCategory = (suit: SuitId): SuitCategory => SUIT_DEFINITIONS.find((s) => s.id === suit)!.category;

/**
 * Picks exactly one play for `enemy` from its current hand, given the
 * table's current state -- called once per iteration of ENEMY_PLAYS_PER_TURN
 * inside resolveEnemyTurn, with `table` re-read fresh each call so a play
 * earlier in the same enemy's turn is already reflected (same self-
 * compounding rule as the player). Deliberately a flat heuristic, not a
 * search -- first-cut AI, not balance-tested.
 *
 * Strategy: score every suit the enemy holds >=1 hand card of by
 * (count-of-that-suit-in-hand x (current-table-count-for-that-suit +
 * count-of-that-suit-in-hand)) x a per-category weight, then weighted-pick
 * among the scores (not argmax) so
 * enemies aren't 100% predictable turn to turn even on a fixed seed. A play
 * always commits ALL of the enemy's current hand cards of the chosen suit
 * (no subset optimization) -- there's no UI to drive a partial commit for an
 * enemy, and "should I hold some back" is exactly the kind of deep-AI
 * complexity this first pass isn't attempting.
 *
 * Low-HP self-preservation: below ENEMY_LOW_HP_HEAL_GUARD_THRESHOLD_PCT of
 * hpMax, boon/guard candidates get a further weight boost on top of their
 * base category weight, so a hurting enemy is meaningfully (not absolutely)
 * more likely to patch itself up than press an attack -- a small heal off an
 * otherwise-empty table can still lose out to a big available attack.
 */
export function chooseEnemyPlay(enemy: EnemyInstance, table: TableCard[], rng: Rng): EnemyPlayChoice | null {
  const bySuit = new Map<SuitId, string[]>();
  for (const card of enemy.hand) {
    if (!bySuit.has(card.suit)) bySuit.set(card.suit, []);
    bySuit.get(card.suit)!.push(card.id);
  }
  if (bySuit.size === 0) return null;

  const isLowHP = enemy.hp / enemy.hpMax <= ENEMY_LOW_HP_HEAL_GUARD_THRESHOLD_PCT;

  const entries = Array.from(bySuit.entries()).map(([suit, handCardIds]) => {
    const category = suitCategory(suit);
    const magnitude = handCardIds.length * (countTableSetSize(table, suit) + handCardIds.length);
    let weight = CATEGORY_WEIGHT[category] * (magnitude + 1);
    if (isLowHP && (category === 'boon' || category === 'guard')) weight *= LOW_HP_HEAL_GUARD_BOOST;
    return { weight, value: { suit, handCardIds } };
  });

  return weightedPick(rng, entries);
}
