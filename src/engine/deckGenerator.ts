import type { SuitId } from '../types/suits';
import type { Card } from '../types/cards';
import type { Rng } from './rng';
import { weightedPick, uniformPick } from './weightedPick';
import { BOON_SUIT, GUARD_SUIT, WEAKEN_SUIT, POISON_SUIT, STRENGTH_SUIT } from '../config/constants';

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
  // Status suits (Hex/Venom/Vigor) -- optional, defaulting to 0, so callers
  // that don't care about them (e.g. surpriseEffects's add-cards, which only
  // ever wants on-suit) don't have to spell out three zeroes.
  weakenRatio?: number;
  poisonRatio?: number;
  strengthRatio?: number;
}

type CardCategory = 'on-suit' | 'boon' | 'guard' | 'weaken' | 'poison' | 'strength';

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
  const weakenRatio = params.weakenRatio ?? 0;
  const poisonRatio = params.poisonRatio ?? 0;
  const strengthRatio = params.strengthRatio ?? 0;
  const remainder = Math.max(
    0,
    1 -
      params.onSuitRatio -
      params.boonRatio -
      params.guardRatio -
      weakenRatio -
      poisonRatio -
      strengthRatio,
  );
  const onSuitWeight = params.onSuitRatio + remainder;

  const entries: { weight: number; value: CardCategory }[] = [
    { weight: onSuitWeight, value: 'on-suit' },
    { weight: params.boonRatio, value: 'boon' },
    { weight: params.guardRatio, value: 'guard' },
    { weight: weakenRatio, value: 'weaken' },
    { weight: poisonRatio, value: 'poison' },
    { weight: strengthRatio, value: 'strength' },
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
      case 'weaken':
        cards.push({ id, kind: 'creature', suit: WEAKEN_SUIT });
        break;
      case 'poison':
        cards.push({ id, kind: 'creature', suit: POISON_SUIT });
        break;
      case 'strength':
        cards.push({ id, kind: 'creature', suit: STRENGTH_SUIT });
        break;
    }
  }
  return cards;
}
