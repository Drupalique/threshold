import type { SuitId } from './suits';

export interface CreatureCard {
  id: string;
  kind: 'creature';
  suit: SuitId;
  // References a SpecialCardDef (src/config/specialCards.ts) -- absent means
  // a plain, fungible copy of the suit, which fires no rider at all: just
  // its suit's base multiplicative points, same as any other copy in the
  // set. Only a specialId'd card fires a rider effect when it's part of the
  // hand cards actually committed to a play (see combatEngine.ts's
  // applyRiders / config/specialCards.ts's riderForCard). Never present on a
  // table card -- riders only apply from the hand at play time, not from
  // cards sitting on the table.
  specialId?: string;
}

// The Earthquake round's namesake special card (design request: "a special
// card that grants unlimited plays that turn" -- now a flat QUAKE_BONUS_PLAYS
// grant into the numeric plays pool rather than true-unlimited plays, see
// combatEngine's PLAYER_PLAY_QUAKE). Suitless and never enters the pool --
// it's a one-off hand card the player plays directly, not something claimed
// against a pool set, so it carries no suit and matches no set.
export interface QuakeCard {
  id: string;
  kind: 'quake';
}

// The Cleave setup card (MECHANIC_BRAINSTORM.md's AOE tier 2): playing it
// doesn't resolve a set itself, it just flags the next threat play this
// turn to resolve against every alive enemy (see combatEngine's
// PLAYER_PLAY_CLEAVE / cleaveActive). Suitless and never enters the pool,
// same reasoning as QuakeCard above.
export interface CleaveCard {
  id: string;
  kind: 'cleave';
}

export type Card = CreatureCard | QuakeCard | CleaveCard;

// The pool never contains Quake cards (see QuakeCard's doc comment) but its
// type is still the shared Card union, so every pool-suit lookup needs this
// narrowing guard to satisfy the compiler.
export function isCreatureCard(card: Card): card is CreatureCard {
  return card.kind === 'creature';
}
