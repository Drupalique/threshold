import type { SuitId } from '../types/suits';
import type { CreatureCard } from '../types/cards';
import type { SpecialCardDef } from '../types/specialCards';

/** Generates `count` copies of a suit as directly-authored CreatureCards -- shared by STARTER_DECK and every EnemyDef.deck. */
export function cardCopies(suit: SuitId, count: number, idPrefix: string): CreatureCard[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${idPrefix}-${suit}-${i}`,
    kind: 'creature' as const,
    suit,
  }));
}

/** A single specialId-tagged creature card -- same shape as cardCopies' output, but carrying a rider (see config/specialCards.ts). Used to swap one generic copy out of an authored deck for a named signature card. */
export function specialCard(def: SpecialCardDef, idPrefix: string): CreatureCard {
  return { id: `${idPrefix}-${def.id}`, kind: 'creature', suit: def.suit, specialId: def.id };
}
