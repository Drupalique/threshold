import type { SuitId, SuitCategory } from '../types/suits';
import type { SpecialCardDef, RiderEffect } from '../types/specialCards';
import type { CreatureCard } from '../types/cards';

/**
 * One named special card per suit (v1 scope) -- each is an ordinary suited
 * creature card (it joins that suit's table set and multiplier exactly like
 * any other copy) that additionally fires a fixed rider effect when it's
 * part of a resolving play (see types/specialCards.ts, combatEngine.ts's
 * applyRiders). Distributed across the starter deck, the enemy roster, and
 * the reward pool -- see constants.ts's STARTER_DECK, enemies.ts, and
 * rewardGenerator.ts. First-cut names/values, not balance-tested.
 */
// Flat rider amount shared by every special card for now -- one tunable knob
// while this mechanic is still being playtested, rather than nine
// independently-authored numbers.
const RIDER_AMOUNT = 3;

// Splash-rider amount (MECHANIC_BRAINSTORM.md's AOE tier 1) -- deliberately
// smaller than RIDER_AMOUNT since it hits every alive enemy, not just one.
const AOE_RIDER_AMOUNT = 2;

export const SPECIAL_CARD_DEFS: SpecialCardDef[] = [
  {
    id: 'alpha-wolf',
    suit: 'wolf',
    name: 'Alpha Wolf',
    description: `Also deals ${RIDER_AMOUNT} damage to the target.`,
    rider: { kind: 'bonus-damage', amount: RIDER_AMOUNT },
  },
  {
    id: 'wildfire',
    suit: 'ember',
    name: 'Wildfire',
    description: `Also deals ${RIDER_AMOUNT} damage to the target.`,
    rider: { kind: 'bonus-damage', amount: RIDER_AMOUNT },
  },
  {
    id: 'rot-colossus',
    suit: 'rot',
    name: 'Rot Colossus',
    description: `Also grants ${RIDER_AMOUNT} Guard.`,
    rider: { kind: 'bonus-guard', amount: RIDER_AMOUNT },
  },
  {
    id: 'broodcaller',
    suit: 'spider',
    name: 'Broodcaller',
    description: `Also deals ${RIDER_AMOUNT} damage to the target.`,
    rider: { kind: 'bonus-damage', amount: RIDER_AMOUNT },
  },
  {
    id: 'blessed-grace',
    suit: 'grace',
    name: 'Blessed Grace',
    description: `Also grants ${RIDER_AMOUNT} Guard.`,
    rider: { kind: 'bonus-guard', amount: RIDER_AMOUNT },
  },
  {
    id: 'bastion-heart',
    suit: 'ward',
    name: 'Bastion Heart',
    description: `Also grants ${RIDER_AMOUNT} Guard.`,
    rider: { kind: 'bonus-guard', amount: RIDER_AMOUNT },
  },
  {
    id: 'withering-hex',
    suit: 'hex',
    name: 'Withering Hex',
    description: `Also deals ${RIDER_AMOUNT} damage to the target.`,
    rider: { kind: 'bonus-damage', amount: RIDER_AMOUNT },
  },
  {
    id: 'widows-kiss',
    suit: 'venom',
    name: "Widow's Kiss",
    description: `Also deals ${RIDER_AMOUNT} damage to the target.`,
    rider: { kind: 'bonus-damage', amount: RIDER_AMOUNT },
  },
  {
    id: 'battle-fury',
    suit: 'vigor',
    name: 'Battle Fury',
    description: `Also grants ${RIDER_AMOUNT} Guard.`,
    rider: { kind: 'bonus-guard', amount: RIDER_AMOUNT },
  },
  // A second Ember special (MECHANIC_BRAINSTORM.md's AOE tier 1, "splash
  // rider") -- specialCardsBySuit already returns an array per suit, so a
  // suit can carry more than one named special; this one is reward/shop-
  // pool only (not in STARTER_DECK, unlike every suit's first special).
  {
    id: 'cinder-storm',
    suit: 'ember',
    name: 'Cinder Storm',
    description: `Also deals ${AOE_RIDER_AMOUNT} damage to every alive enemy.`,
    rider: { kind: 'bonus-damage-aoe', amount: AOE_RIDER_AMOUNT },
  },
];

export function specialCardById(id: string): SpecialCardDef {
  const def = SPECIAL_CARD_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown special card def: ${id}`);
  return def;
}

export function specialCardsBySuit(suit: SuitId): SpecialCardDef[] {
  return SPECIAL_CARD_DEFS.filter((d) => d.suit === suit);
}

// --- Basic (non-named) riders --------------------------------------------
// Every plain suited copy now carries a small rider too, not just the one
// named special per suit -- deliberately smaller than RIDER_AMOUNT so a
// signature card still reads as a step up rather than just a name swap.
export const BASIC_RIDER_AMOUNT = 1;

// Same threat/weaken/poison-vs-boon/guard/strength split SPECIAL_CARD_DEFS
// already follows by hand above: categories that resolve against a target
// get a damage rider, self-targeting categories get a guard rider.
function riderKindForCategory(category: SuitCategory): RiderEffect['kind'] {
  return category === 'threat' || category === 'weaken' || category === 'poison'
    ? 'bonus-damage'
    : 'bonus-guard';
}

export function basicRiderForCategory(category: SuitCategory): RiderEffect {
  return { kind: riderKindForCategory(category), amount: BASIC_RIDER_AMOUNT };
}

/** The rider a given creature card actually fires when played from a hand: its named special's rider if tagged, otherwise its suit's baseline basic rider. Callers already have the suit's category on hand (from SUIT_DEFINITIONS) rather than re-deriving it here, to avoid a config/constants import cycle. */
export function riderForCard(card: Pick<CreatureCard, 'specialId'>, category: SuitCategory): RiderEffect {
  return card.specialId ? specialCardById(card.specialId).rider : basicRiderForCategory(category);
}

export function riderDescription(rider: RiderEffect): string {
  if (rider.kind === 'bonus-damage') return `Also deals ${rider.amount} damage to the target.`;
  if (rider.kind === 'bonus-damage-aoe') return `Also deals ${rider.amount} damage to every alive enemy.`;
  return `Also grants ${rider.amount} Guard.`;
}
