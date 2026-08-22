import type { SuitId } from '../types/suits';
import type { Card } from '../types/cards';
import type { Rng } from './rng';
import { weightedPick, uniformPick } from './weightedPick';
import { BOON_SUIT, GUARD_SUIT } from '../config/constants';

export interface DeckParams {
  // The threat suits eligible for the "on-suit" bucket -- a property of the
  // room (RoomParams.threatSuits), not of any particular enemy. Pool and
  // hand generation pass the same list, since piles aren't enemy-owned (see
  // design doc 4.8): whatever suits are live in the pool are exactly what
  // the player's hand should be weighted toward.
  onSuitTargets: SuitId[];
  onSuitRatio: number;
  boonRatio: number;
  guardRatio: number;
}

type CardCategory = 'on-suit' | 'boon' | 'guard';

/**
 * Builds a weighted-random deck of `count` cards. Used identically for the
 * shared pool and the player's hand -- see design doc 4.1/4.3 on why the
 * on-suit/off-suit ratio is the key tuning knob. Any ratio remainder folds
 * back into the on-suit bucket rather than a separate "off-suit" category --
 * with the room's pool built entirely from its own threat suits plus
 * boon/guard, there is no other suit an "off-suit" card could belong to.
 */
export function generateWeightedDeck(
  count: number,
  idPrefix: string,
  params: DeckParams,
  rng: Rng,
): Card[] {
  const remainder = Math.max(
    0,
    1 - params.onSuitRatio - params.boonRatio - params.guardRatio,
  );
  const onSuitWeight = params.onSuitRatio + remainder;

  const entries: { weight: number; value: CardCategory }[] = [
    { weight: onSuitWeight, value: 'on-suit' },
    { weight: params.boonRatio, value: 'boon' },
    { weight: params.guardRatio, value: 'guard' },
  ];

  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    const category = weightedPick(rng, entries);
    const id = `${idPrefix}-${i}`;
    switch (category) {
      case 'on-suit': {
        const suit = uniformPick(rng, params.onSuitTargets);
        cards.push({ id, kind: 'creature', suit });
        break;
      }
      case 'boon':
        cards.push({ id, kind: 'creature', suit: BOON_SUIT });
        break;
      case 'guard':
        cards.push({ id, kind: 'creature', suit: GUARD_SUIT });
        break;
    }
  }
  return cards;
}
