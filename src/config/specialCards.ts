import type { SuitId } from '../types/suits';
import type { SpecialCardDef, RiderEffect } from '../types/specialCards';
import type { CreatureCard } from '../types/cards';
import { STATUS_DEFS } from '../types/status';

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

// Status-rider amount -- every suit's second named special (below) grants or
// inflicts this many stacks of a status the suit doesn't already own as its
// base category effect. Same tier as AOE_RIDER_AMOUNT: a side-effect on a
// different resource, not the suit's own headline number.
const STATUS_RIDER_AMOUNT = 2;

// Per-card-in-the-set rider amount (types/specialCards.ts's bonus-per-card)
// -- kept to 1 since it's multiplied by the suit's whole table-set size at
// resolution (combatEngine's tableCountAfterPlay), not a flat add like
// RIDER_AMOUNT; a late claim into a big set already does the scaling work.
const PER_CARD_RIDER_AMOUNT = 1;

// Draw/discard/bonus-plays rider amounts -- first-cut single-stack numbers,
// same "one tunable knob" reasoning as RIDER_AMOUNT above.
const DRAW_RIDER_AMOUNT = 1;
const DISCARD_RIDER_AMOUNT = 1;
const BONUS_PLAYS_RIDER_AMOUNT = 1;

// Skews which SPECIAL_CARD_DEFS entry a reward/shop "special" slot actually
// lands on (see rewardGenerator.ts's two weightedPick(rng, SPECIAL_CARD_DEFS
// .map(...)) call sites) -- an absent `rarity` on a def reads as 'common',
// so every special added before rarity existed keeps its original odds
// unchanged. 'rare' is deliberately well below 1 rather than near-zero: the
// four new bonus-per-card/bonus-plays specials below are strong, not
// run-defining, and the reward pool is already small enough (SPECIAL_
// CARD_DEFS has under 20 entries) that a token weight would make them feel
// like dead weight in the pool instead of a genuine rare find.
export const RARITY_WEIGHT: Record<'common' | 'rare', number> = {
  common: 1,
  rare: 0.3,
};

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

  // Every other suit's second named special -- same reward/shop-pool-only
  // deal as Cinder Storm above, but using the new bonus-status rider
  // (types/specialCards.ts) instead of a bigger damage/guard number, so
  // deck-building has a real second axis (which status you're stacking, not
  // just how hard you hit). threat suits inflict a debuff on the same
  // target their claim already hits; boon/guard/strength suits grant a buff
  // to whoever played the card, same reach as their own bonus-guard cousins.
  {
    id: 'bloodfang',
    suit: 'wolf',
    name: 'Bloodfang',
    description: `Also inflicts ${STATUS_RIDER_AMOUNT} ${STATUS_DEFS.vulnerable.name} on the target.`,
    rider: { kind: 'bonus-status', statusId: 'vulnerable', amount: STATUS_RIDER_AMOUNT },
  },
  {
    id: 'creeping-rot',
    suit: 'rot',
    name: 'Creeping Rot',
    description: `Also inflicts ${STATUS_RIDER_AMOUNT} ${STATUS_DEFS.slow.name} on the target.`,
    rider: { kind: 'bonus-status', statusId: 'slow', amount: STATUS_RIDER_AMOUNT },
  },
  {
    id: 'widowbite',
    suit: 'spider',
    name: 'Widowbite',
    description: `Also inflicts ${STATUS_RIDER_AMOUNT} ${STATUS_DEFS.poison.name} on the target.`,
    rider: { kind: 'bonus-status', statusId: 'poison', amount: STATUS_RIDER_AMOUNT },
  },
  {
    id: 'zealous-grace',
    suit: 'grace',
    name: 'Zealous Grace',
    description: `Also grants yourself ${STATUS_RIDER_AMOUNT} ${STATUS_DEFS.haste.name}.`,
    rider: { kind: 'bonus-status', statusId: 'haste', amount: STATUS_RIDER_AMOUNT },
  },
  {
    id: 'aegis-bloom',
    suit: 'ward',
    name: 'Aegis Bloom',
    description: `Also grants yourself ${STATUS_RIDER_AMOUNT} ${STATUS_DEFS.regen.name}.`,
    rider: { kind: 'bonus-status', statusId: 'regen', amount: STATUS_RIDER_AMOUNT },
  },
  {
    id: 'grasping-curse',
    suit: 'hex',
    name: 'Grasping Curse',
    description: `Also inflicts ${STATUS_RIDER_AMOUNT} ${STATUS_DEFS.vulnerable.name} on the target.`,
    rider: { kind: 'bonus-status', statusId: 'vulnerable', amount: STATUS_RIDER_AMOUNT },
  },
  {
    id: 'creeping-blight',
    suit: 'venom',
    name: 'Creeping Blight',
    description: `Also inflicts ${STATUS_RIDER_AMOUNT} ${STATUS_DEFS.slow.name} on the target.`,
    rider: { kind: 'bonus-status', statusId: 'slow', amount: STATUS_RIDER_AMOUNT },
  },
  {
    id: 'second-wind',
    suit: 'vigor',
    name: 'Second Wind',
    description: `Also grants yourself ${STATUS_RIDER_AMOUNT} ${STATUS_DEFS.regen.name}.`,
    rider: { kind: 'bonus-status', statusId: 'regen', amount: STATUS_RIDER_AMOUNT },
  },

  // A third special for 8 of the 9 suits (Venom keeps its 2), one pair per
  // new mechanic, all reward/shop-pool only like every special above it.
  // bonus-per-card is deliberately 'rare' (RARITY_WEIGHT) -- unlike every
  // other rider here, its payout scales with the suit's whole table-set
  // size at resolution, not a flat number, so it can swing far harder than
  // a common special in a late, big claim.
  {
    id: 'direwolf-alpha',
    suit: 'wolf',
    name: 'Direwolf Alpha',
    description: `Also deals ${PER_CARD_RIDER_AMOUNT} damage per card in the set to the target.`,
    rider: { kind: 'bonus-per-card', amount: PER_CARD_RIDER_AMOUNT },
    rarity: 'rare',
  },
  {
    id: 'bulwark-colossus',
    suit: 'ward',
    name: 'Bulwark Colossus',
    description: `Also grants ${PER_CARD_RIDER_AMOUNT} Guard per card in the set.`,
    rider: { kind: 'bonus-per-card', amount: PER_CARD_RIDER_AMOUNT },
    rarity: 'rare',
  },
  // draw -- always benefits whoever played the card, any suit category.
  {
    id: 'fortunes-grace',
    suit: 'grace',
    name: "Fortune's Grace",
    description: `Also draws ${DRAW_RIDER_AMOUNT} card.`,
    rider: { kind: 'draw', amount: DRAW_RIDER_AMOUNT },
  },
  {
    id: 'carrion-feast',
    suit: 'rot',
    name: 'Carrion Feast',
    description: `Also draws ${DRAW_RIDER_AMOUNT} card.`,
    rider: { kind: 'draw', amount: DRAW_RIDER_AMOUNT },
  },
  // discard -- only paired with threat/weaken/poison suits (same reasoning
  // as bonus-damage), so the opponent is always well-defined: the play's
  // own target for a player actor, the player for an enemy actor.
  {
    id: 'silk-ambush',
    suit: 'spider',
    name: 'Silk Ambush',
    description: `Also forces the target to discard ${DISCARD_RIDER_AMOUNT} card.`,
    rider: { kind: 'discard', amount: DISCARD_RIDER_AMOUNT },
  },
  {
    id: 'mind-rot',
    suit: 'hex',
    name: 'Mind Rot',
    description: `Also forces the target to discard ${DISCARD_RIDER_AMOUNT} card.`,
    rider: { kind: 'discard', amount: DISCARD_RIDER_AMOUNT },
  },
  // bonus-plays -- Quake's rider-sized cousin: a suited card that also tops
  // up state.playsRemaining, instead of Quake's dedicated free-action slot.
  // Rare for the same reason Quake itself is gated low (QUAKE_REWARD_RATIO)
  // -- extra plays are one of the strongest things a card can grant.
  {
    id: 'flash-ignition',
    suit: 'ember',
    name: 'Flash Ignition',
    description: `Also grants ${BONUS_PLAYS_RIDER_AMOUNT} bonus play this turn.`,
    rider: { kind: 'bonus-plays', amount: BONUS_PLAYS_RIDER_AMOUNT },
    rarity: 'rare',
  },
  {
    id: 'overdrive',
    suit: 'vigor',
    name: 'Overdrive',
    description: `Also grants ${BONUS_PLAYS_RIDER_AMOUNT} bonus play this turn.`,
    rider: { kind: 'bonus-plays', amount: BONUS_PLAYS_RIDER_AMOUNT },
    rarity: 'rare',
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

/** The rider a given creature card fires when played from a hand, if any: its named special's rider if tagged, otherwise undefined -- a plain card is nothing but its suit's base multiplicative points, no rider at all. */
export function riderForCard(card: Pick<CreatureCard, 'specialId'>): RiderEffect | undefined {
  return card.specialId ? specialCardById(card.specialId).rider : undefined;
}

export function riderDescription(rider: RiderEffect): string {
  if (rider.kind === 'bonus-damage') return `Also deals ${rider.amount} damage to the target.`;
  if (rider.kind === 'bonus-damage-aoe') return `Also deals ${rider.amount} damage to every alive enemy.`;
  if (rider.kind === 'bonus-status') return `Also applies ${rider.amount} ${STATUS_DEFS[rider.statusId].name}.`;
  if (rider.kind === 'bonus-per-card') return `Also adds ${rider.amount} per card in the set.`;
  if (rider.kind === 'draw') return `Also draws ${rider.amount} card${rider.amount === 1 ? '' : 's'}.`;
  if (rider.kind === 'discard') return `Also forces the target to discard ${rider.amount} card${rider.amount === 1 ? '' : 's'}.`;
  if (rider.kind === 'bonus-plays') return `Also grants ${rider.amount} bonus play${rider.amount === 1 ? '' : 's'}.`;
  return `Also grants ${rider.amount} Guard.`;
}
