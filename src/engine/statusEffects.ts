import type { StatusBag, StatusId } from '../types/status';

/**
 * Unified status-effect framework: Weaken, Strength, and Poison are all just
 * stack counts on a holder (the player or an EnemyInstance), applied and
 * decayed by the exact same functions regardless of who holds them -- an
 * enemy's own attack is boosted by its Strength and cut by its own Weaken
 * the same way a player's threat claim is.
 */

export function stacksOf(bag: StatusBag, id: StatusId): number {
  return bag[id] ?? 0;
}

export function addStacks(bag: StatusBag, id: StatusId, amount: number): StatusBag {
  if (amount === 0) return bag;
  return { ...bag, [id]: stacksOf(bag, id) + amount };
}

/**
 * Runs once at the true end of a holder's own turn (the player's turn, or a
 * single enemy's dispatched action) -- never per sub-action, matching the
 * existing decayCounters/blockedSuits phase-boundary discipline (see
 * combatEngine's endTurn docstring: a status tallied twice in one action
 * would silently expire early, the same bug class as the historical
 * blocked-suit fix). Poison deals its current stack count as damage the
 * instant before it decays; Weaken and Strength have no on-tick effect and
 * simply lose a stack. Every status here decays by exactly 1 stack per
 * holder turn; a stack that reaches 0 is dropped from the bag entirely.
 */
export function tickStatuses(bag: StatusBag): { statuses: StatusBag; poisonDamage: number } {
  const poisonDamage = stacksOf(bag, 'poison');
  const statuses: StatusBag = {};
  for (const id of Object.keys(bag) as StatusId[]) {
    const remaining = (bag[id] ?? 0) - 1;
    if (remaining > 0) statuses[id] = remaining;
  }
  return { statuses, poisonDamage };
}

/** Strength adds flat bonus damage per Strength stack to an outgoing attack's base, before any hand-card multiplier. */
export function withStrength(base: number, statuses: StatusBag): number {
  return base + stacksOf(statuses, 'strength');
}

/** Knocks a percentage off an outgoing magnitude per Weaken stack held by the entity DEALING it, capped at 100%. */
export function withWeaken(magnitude: number, statuses: StatusBag, pctPerStack: number): number {
  const stacks = stacksOf(statuses, 'weaken');
  if (stacks === 0) return magnitude;
  const reduced = magnitude * Math.max(0, 1 - stacks * pctPerStack);
  return Math.max(0, Math.round(reduced));
}
