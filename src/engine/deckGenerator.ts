import type { SuitId } from '../types/suits';
import type { Card } from '../types/cards';
import type { Rng } from './rng';
import { weightedPick, uniformPick } from './weightedPick';
import { BOON_SUIT, GUARD_SUIT, SURPRISE_EFFECT_TYPES } from '../config/constants';

export interface DeckParams {
  dominantSuit: SuitId;
  offSuitPool: SuitId[]; // other threat suits (excludes dominant and boon)
  onSuitRatio: number;
  boonRatio: number;
  guardRatio: number;
  surpriseRatio: number; // pass 0 for hands -- surprise cards are pool-only
}

type CardCategory = 'on-suit' | 'boon' | 'guard' | 'surprise' | 'off-suit';

/**
 * Builds a weighted-random deck of `count` cards. Used identically for the
 * shared pool and for each hand (toggling surpriseRatio) -- see design doc
 * 4.1/4.3 on why the on-suit/off-suit ratio is the key tuning knob.
 */
export function generateWeightedDeck(
  count: number,
  idPrefix: string,
  params: DeckParams,
  rng: Rng,
): Card[] {
  const remainder = Math.max(
    0,
    1 - params.onSuitRatio - params.boonRatio - params.guardRatio - params.surpriseRatio,
  );

  const entries: { weight: number; value: CardCategory }[] = [
    { weight: params.onSuitRatio, value: 'on-suit' },
    { weight: params.boonRatio, value: 'boon' },
    { weight: params.guardRatio, value: 'guard' },
    { weight: params.surpriseRatio, value: 'surprise' },
    { weight: remainder, value: 'off-suit' },
  ];

  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    const category = weightedPick(rng, entries);
    const id = `${idPrefix}-${i}`;
    switch (category) {
      case 'on-suit':
        cards.push({ id, kind: 'creature', suit: params.dominantSuit });
        break;
      case 'boon':
        cards.push({ id, kind: 'creature', suit: BOON_SUIT });
        break;
      case 'guard':
        cards.push({ id, kind: 'creature', suit: GUARD_SUIT });
        break;
      case 'off-suit': {
        const suit =
          params.offSuitPool.length > 0
            ? uniformPick(rng, params.offSuitPool)
            : params.dominantSuit;
        cards.push({ id, kind: 'creature', suit });
        break;
      }
      case 'surprise':
        cards.push({
          id,
          kind: 'surprise',
          effect: uniformPick(rng, SURPRISE_EFFECT_TYPES),
        });
        break;
    }
  }
  return cards;
}
