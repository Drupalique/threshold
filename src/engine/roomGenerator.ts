import type { RoomInstance, RoomParams, PoolSizeBand } from '../types/room';
import type { Rng } from './rng';
import { generateWeightedDeck } from './deckGenerator';
import { uniformPick } from './weightedPick';
import {
  THREAT_SUITS,
  ON_SUIT_RATIO,
  BOON_SUIT_RATIO,
  GUARD_SUIT_RATIO,
  SURPRISE_CARD_RATIO,
  ROOM_THREAT_BASE,
  PLAYER_HAND_SIZE,
  ROOM_HAND_SIZE,
  ROOM_POOL_SIZE_SMALL,
  ROOM_POOL_SIZE_LARGE,
} from '../config/constants';

let roomCounter = 0;

export function generateRoom(rng: Rng): RoomInstance {
  const dominantSuit = uniformPick(rng, THREAT_SUITS);
  const offSuitPool = THREAT_SUITS.filter((s) => s !== dominantSuit);

  const sizeBand: PoolSizeBand = uniformPick(rng, ['small', 'large']);
  const [min, max] =
    sizeBand === 'small' ? ROOM_POOL_SIZE_SMALL : ROOM_POOL_SIZE_LARGE;
  const poolSize = rng.int(min, max);

  const params: RoomParams = {
    poolSize,
    sizeBand,
    dominantSuit,
    threatValue: ROOM_THREAT_BASE,
    playerHandSize: PLAYER_HAND_SIZE,
    roomHandSize: ROOM_HAND_SIZE,
    onSuitRatio: ON_SUIT_RATIO,
    boonRatio: BOON_SUIT_RATIO,
    guardRatio: GUARD_SUIT_RATIO,
    surpriseRatio: SURPRISE_CARD_RATIO,
  };

  const id = `room-${roomCounter++}`;

  const pool = generateWeightedDeck(params.poolSize, `${id}-pool`, {
    dominantSuit,
    offSuitPool,
    onSuitRatio: params.onSuitRatio,
    boonRatio: params.boonRatio,
    guardRatio: params.guardRatio,
    surpriseRatio: params.surpriseRatio,
  }, rng);

  const playerHandDeal = generateWeightedDeck(params.playerHandSize, `${id}-phand`, {
    dominantSuit,
    offSuitPool,
    onSuitRatio: params.onSuitRatio,
    boonRatio: params.boonRatio,
    guardRatio: params.guardRatio,
    surpriseRatio: 0,
  }, rng);

  const roomHandDeal = generateWeightedDeck(params.roomHandSize, `${id}-rhand`, {
    dominantSuit,
    offSuitPool,
    onSuitRatio: params.onSuitRatio,
    boonRatio: params.boonRatio,
    guardRatio: params.guardRatio,
    surpriseRatio: 0,
  }, rng);

  return { id, params, pool, playerHandDeal, roomHandDeal };
}
