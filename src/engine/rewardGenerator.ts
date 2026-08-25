import type { SuitId } from '../types/suits';
import type { Card } from '../types/cards';
import type { Rng } from './rng';
import { uniformPick, weightedPick } from './weightedPick';
import {
  THREAT_SUITS,
  BOON_SUIT,
  GUARD_SUIT,
  WEAKEN_SUIT,
  POISON_SUIT,
  STRENGTH_SUIT,
  QUAKE_REWARD_RATIO,
  REWARD_OPTION_COUNT,
} from '../config/constants';

// Every suit the reward screen can offer -- unlike a room's pool/hand (which
// are constrained to the room's own threatSuits), a reward is a deck-
// building choice across the whole game, so all suits are always in play.
const REWARD_SUITS: SuitId[] = [...THREAT_SUITS, BOON_SUIT, GUARD_SUIT, WEAKEN_SUIT, POISON_SUIT, STRENGTH_SUIT];

type RewardCategory = 'suit' | 'quake';

/**
 * MVP reward shape: a uniform pick across every non-Quake suit per slot,
 * Quake folded in at a low weight -- no removal/upgrade options yet. `depth`
 * only feeds the returned ids' uniqueness, not the odds; every slot draws
 * from the same full suit pool regardless of depth.
 */
export function generateRewardOptions(depth: number, rng: Rng): Card[] {
  const options: Card[] = [];
  for (let i = 0; i < REWARD_OPTION_COUNT; i++) {
    const id = `reward-d${depth}-${i}`;
    const category = weightedPick<RewardCategory>(rng, [
      { weight: 1 - QUAKE_REWARD_RATIO, value: 'suit' },
      { weight: QUAKE_REWARD_RATIO, value: 'quake' },
    ]);
    if (category === 'quake') {
      options.push({ id, kind: 'quake' });
    } else {
      options.push({ id, kind: 'creature', suit: uniformPick(rng, REWARD_SUITS) });
    }
  }
  return options;
}
