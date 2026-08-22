import type { SuitId } from '../types/suits';
import type { Card } from '../types/cards';
import type { CombatState } from '../types/combat';
import { MIN_POOL_SET_SIZE } from '../config/constants';

export interface RoomClaimChoice {
  suit: SuitId;
  handCardIds: string[];
}

function groupHandBySuit(hand: Card[]): Partial<Record<SuitId, Card[]>> {
  const groups: Partial<Record<SuitId, Card[]>> = {};
  for (const card of hand) {
    if (card.kind !== 'creature') continue;
    (groups[card.suit] ??= []).push(card);
  }
  return groups;
}

function countPoolSuit(pool: Card[], suit: SuitId): number {
  return pool.filter((c) => c.kind === 'creature' && c.suit === suit).length;
}

/**
 * Deliberately dumb, deterministic room heuristic (design doc 4.3): claim
 * the largest available matching set immediately, with no lookahead, no
 * bluffing, and no holding cards back. Since claiming a set only requires
 * >=1 matching card (magnitude scales with cards committed), there is never
 * a reason to withhold a matching card -- always play all of them.
 */
export function roomAIChooseClaim(state: CombatState): RoomClaimChoice | null {
  const handBySuit = groupHandBySuit(state.roomHand);
  const candidates: { suit: SuitId; handCardIds: string[]; poolSetSize: number; magnitude: number }[] = [];

  for (const suit of Object.keys(handBySuit) as SuitId[]) {
    if ((state.blockedSuits[suit] ?? 0) > 0) continue;
    const poolSetSize = countPoolSuit(state.pool, suit);
    if (poolSetSize < MIN_POOL_SET_SIZE) continue;
    const handCardIds = handBySuit[suit]!.map((c) => c.id);
    candidates.push({
      suit,
      handCardIds,
      poolSetSize,
      magnitude: poolSetSize * handCardIds.length,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.poolSetSize !== a.poolSetSize) return b.poolSetSize - a.poolSetSize;
    if (b.magnitude !== a.magnitude) return b.magnitude - a.magnitude;
    return a.suit.localeCompare(b.suit);
  });

  const best = candidates[0];
  return { suit: best.suit, handCardIds: best.handCardIds };
}
