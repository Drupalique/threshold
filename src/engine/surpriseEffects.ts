import type { SuitId } from '../types/suits';
import type { Card } from '../types/cards';
import { isCreatureCard } from '../types/cards';
import type { Rng } from './rng';
import { uniformPick } from './weightedPick';
import { generateWeightedDeck } from './deckGenerator';
import { SURPRISE_ADD_CARDS_COUNT } from '../config/constants';

/**
 * Resolution logic for the Corrupt intent's three effects. Originally a
 * random one-off "surprise card" revealed from the pool (see design doc
 * 4.1); now these are called deliberately by combatEngine when an enemy's
 * telegraphed Corrupt step resolves (design doc 4.6/4.7) -- the vocabulary
 * didn't change, only who triggers it and when.
 */

export function resolveAddCards(
  pool: Card[],
  threatSuits: SuitId[],
  rng: Rng,
  idPrefix: string,
): Card[] {
  if (threatSuits.length === 0) return pool;
  const added = generateWeightedDeck(
    SURPRISE_ADD_CARDS_COUNT,
    idPrefix,
    { onSuitTargets: threatSuits, onSuitRatio: 1, boonRatio: 0, guardRatio: 0 },
    rng,
  );
  return [...pool, ...added];
}

export function resolveBlockSuit(pool: Card[], rng: Rng): SuitId | null {
  const creatureSuits = Array.from(new Set(pool.filter(isCreatureCard).map((c) => c.suit)));
  if (creatureSuits.length === 0) return null;
  return uniformPick(rng, creatureSuits);
}

export interface ForceDiscardResult {
  playerHand: Card[];
  // The card itself, not just its id -- the caller (combatEngine) routes it
  // into CombatState.discardPile rather than letting it vanish (persistent-
  // deck design: a force-discard is recoverable via the next reshuffle, not
  // a permanent exhaust -- see PERSISTENT_DECK_PLAN.md open question 4).
  discardedCard: Card | null;
}

export function resolveForceDiscard(playerHand: Card[], rng: Rng): ForceDiscardResult {
  if (playerHand.length === 0) {
    return { playerHand, discardedCard: null };
  }
  const idx = rng.int(0, playerHand.length - 1);
  const discardedCard = playerHand[idx];
  return { playerHand: playerHand.filter((_, i) => i !== idx), discardedCard };
}
