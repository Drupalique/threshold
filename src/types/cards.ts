import type { SuitId } from './suits';

export interface CreatureCard {
  id: string;
  kind: 'creature';
  suit: SuitId;
}

// The Earthquake round's namesake special card (design request: "a special
// card that grants unlimited plays that turn"). Suitless and never enters
// the pool -- it's a one-off hand card the player plays directly (see
// combatEngine's PLAYER_PLAY_QUAKE), not something claimed against a pool
// set, so it carries no suit and matches no set.
export interface QuakeCard {
  id: string;
  kind: 'quake';
}

export type Card = CreatureCard | QuakeCard;

// The pool never contains Quake cards (see QuakeCard's doc comment) but its
// type is still the shared Card union, so every pool-suit lookup needs this
// narrowing guard to satisfy the compiler.
export function isCreatureCard(card: Card): card is CreatureCard {
  return card.kind === 'creature';
}
