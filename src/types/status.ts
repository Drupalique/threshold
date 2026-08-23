export type StatusId = 'weaken' | 'strength' | 'poison';

export type StatusCategory = 'buff' | 'debuff';

export interface StatusDef {
  id: StatusId;
  name: string;
  category: StatusCategory;
}

/**
 * Every buff/debuff in the game is a stack count on a holder (the player or
 * an enemy instance) that decays by exactly 1 at the end of the holder's own
 * turn -- see engine/statusEffects.ts for the shared apply/decay logic used
 * identically by player claims and enemy actions. Weaken and Strength only
 * modify a future magnitude calculation; Poison additionally deals its
 * stack count as damage to its own holder the instant before it decays.
 */
export const STATUS_DEFS: Record<StatusId, StatusDef> = {
  weaken: { id: 'weaken', name: 'Weaken', category: 'debuff' },
  strength: { id: 'strength', name: 'Strength', category: 'buff' },
  poison: { id: 'poison', name: 'Poison', category: 'debuff' },
};

/** Stack counts keyed by status -- shared shape for the player and every enemy instance. An absent key means 0 stacks. */
export type StatusBag = Partial<Record<StatusId, number>>;
