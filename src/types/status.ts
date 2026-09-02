export type StatusId = 'weaken' | 'strength' | 'poison' | 'vulnerable' | 'regen' | 'haste' | 'slow';

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
 * identically by player claims and enemy actions. Weaken and Vulnerable only
 * modify a future magnitude calculation (Weaken cuts the dealer's own
 * outgoing damage, Vulnerable inflates whatever the holder receives);
 * Strength adds flat bonus damage the same way; Poison and Regen additionally
 * deal/heal their stack count against their own holder's HP the instant
 * before they decay; Haste and Slow adjust the holder's own next
 * `playsRemaining` allotment by +1/-1 per stack instead of touching a play's
 * magnitude at all.
 */
export const STATUS_DEFS: Record<StatusId, StatusDef> = {
  weaken: { id: 'weaken', name: 'Weaken', category: 'debuff' },
  strength: { id: 'strength', name: 'Strength', category: 'buff' },
  poison: { id: 'poison', name: 'Poison', category: 'debuff' },
  vulnerable: { id: 'vulnerable', name: 'Vulnerable', category: 'debuff' },
  regen: { id: 'regen', name: 'Regen', category: 'buff' },
  haste: { id: 'haste', name: 'Haste', category: 'buff' },
  slow: { id: 'slow', name: 'Slow', category: 'debuff' },
};

/** Stack counts keyed by status -- shared shape for the player and every enemy instance. An absent key means 0 stacks. */
export type StatusBag = Partial<Record<StatusId, number>>;
