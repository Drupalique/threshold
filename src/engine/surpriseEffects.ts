import type { SuitId } from '../types/suits';
import type { Card } from '../types/cards';
import type { RoomParams } from '../types/room';
import type { Rng } from './rng';
import { uniformPick } from './weightedPick';
import { generateWeightedDeck } from './deckGenerator';
import { SURPRISE_ADD_CARDS_COUNT, THREAT_SUITS } from '../config/constants';

export function resolveAddCards(
  pool: Card[],
  params: RoomParams,
  rng: Rng,
  idPrefix: string,
): Card[] {
  const offSuitPool = THREAT_SUITS.filter((s) => s !== params.dominantSuit);
  const added = generateWeightedDeck(
    SURPRISE_ADD_CARDS_COUNT,
    idPrefix,
    {
      dominantSuit: params.dominantSuit,
      offSuitPool,
      onSuitRatio: params.onSuitRatio,
      boonRatio: params.boonRatio,
      guardRatio: params.guardRatio,
      surpriseRatio: 0,
    },
    rng,
  );
  return [...pool, ...added];
}

export function resolveBlockSuit(pool: Card[], rng: Rng): SuitId | null {
  const creatureSuits = Array.from(
    new Set(
      pool
        .filter((c): c is Extract<Card, { kind: 'creature' }> => c.kind === 'creature')
        .map((c) => c.suit),
    ),
  );
  if (creatureSuits.length === 0) return null;
  return uniformPick(rng, creatureSuits);
}

export interface ForceDiscardResult {
  actor: 'player' | 'room';
  playerHand: Card[];
  roomHand: Card[];
  discardedCardId: string | null;
}

export function resolveForceDiscard(
  playerHand: Card[],
  roomHand: Card[],
  rng: Rng,
): ForceDiscardResult {
  const actor: 'player' | 'room' = rng.next() < 0.5 ? 'player' : 'room';
  const hand = actor === 'player' ? playerHand : roomHand;
  if (hand.length === 0) {
    return { actor, playerHand, roomHand, discardedCardId: null };
  }
  const idx = rng.int(0, hand.length - 1);
  const discardedCardId = hand[idx].id;
  const newHand = hand.filter((_, i) => i !== idx);
  return {
    actor,
    playerHand: actor === 'player' ? newHand : playerHand,
    roomHand: actor === 'room' ? newHand : roomHand,
    discardedCardId,
  };
}
