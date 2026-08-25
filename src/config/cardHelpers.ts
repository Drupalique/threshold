import type { SuitId } from '../types/suits';
import type { CreatureCard } from '../types/cards';

/** Generates `count` copies of a suit as directly-authored CreatureCards -- shared by STARTER_DECK and every EnemyDef.deck. */
export function cardCopies(suit: SuitId, count: number, idPrefix: string): CreatureCard[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${idPrefix}-${suit}-${i}`,
    kind: 'creature' as const,
    suit,
  }));
}
