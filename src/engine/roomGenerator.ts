import type { RoomInstance, RoomParams, PoolSizeBand } from '../types/room';
import type { EnemyInstance } from '../types/enemy';
import type { SuitId } from '../types/suits';
import type { Rng } from './rng';
import { generateWeightedDeck } from './deckGenerator';
import { uniformPick, pickDistinct } from './weightedPick';
import { ENEMY_DEFS } from '../config/enemies';
import {
  ON_SUIT_RATIO,
  BOON_SUIT_RATIO,
  GUARD_SUIT_RATIO,
  WEAKEN_SUIT_RATIO,
  POISON_SUIT_RATIO,
  STRENGTH_SUIT_RATIO,
  PLAYER_HAND_SIZE,
  ROOM_POOL_SIZE_SMALL,
  ROOM_POOL_SIZE_LARGE,
  ROOM_MIN_ENEMIES,
  ROOM_MAX_ENEMIES,
  THREAT_SUITS,
  THREAT_SUIT_COUNT_BY_SIZE_BAND,
} from '../config/constants';

let roomCounter = 0;

/**
 * Picks 1-3 enemies eligible for `floor` (design doc 4.7's floor-gating
 * knob). Duplicates are allowed by design -- two Wolf-kin can appear in the
 * same room, each independently targetable via their own instanceId.
 * Selection among eligible defs is uniform; weighting the roll toward
 * higher-minFloor defs as the floor climbs is a documented open tuning
 * knob, not implemented yet (see PROTOTYPE_STATUS.md).
 */
function pickEnemies(floor: number, roomId: string, rng: Rng): EnemyInstance[] {
  const eligible = ENEMY_DEFS.filter((d) => d.minFloor <= floor);
  const pool = eligible.length > 0 ? eligible : ENEMY_DEFS;
  const count = rng.int(ROOM_MIN_ENEMIES, ROOM_MAX_ENEMIES);

  const enemies: EnemyInstance[] = [];
  for (let i = 0; i < count; i++) {
    const def = uniformPick(rng, pool);
    enemies.push({
      instanceId: `${roomId}-enemy-${i}`,
      defId: def.id,
      name: def.name,
      hp: def.hpMax,
      hpMax: def.hpMax,
      guard: 0,
      patternIndex: 0,
      statuses: {},
    });
  }
  return enemies;
}

/**
 * Picks the threat suits woven into this room's pool -- a property of the
 * room's own "type" (currently just its size band, see design doc 4.8),
 * deliberately independent of which enemies pickEnemies happened to roll.
 * Enemies and pool piles are separate axes of room generation; a pile in
 * any of these suits can be claimed against any alive enemy.
 */
function pickThreatSuits(sizeBand: PoolSizeBand, rng: Rng): SuitId[] {
  return pickDistinct(rng, THREAT_SUITS, THREAT_SUIT_COUNT_BY_SIZE_BAND[sizeBand]);
}

export function generateRoom(rng: Rng, floor: number): RoomInstance {
  const id = `room-${roomCounter++}`;
  const enemies = pickEnemies(floor, id, rng);

  const sizeBand: PoolSizeBand = uniformPick(rng, ['small', 'large']);
  const [min, max] =
    sizeBand === 'small' ? ROOM_POOL_SIZE_SMALL : ROOM_POOL_SIZE_LARGE;
  const poolSize = rng.int(min, max);

  const threatSuits = pickThreatSuits(sizeBand, rng);
  // Door color correlation uses one of the room's own threat suits as a
  // stand-in for "what this room is mainly about" -- flavor only, combat
  // itself doesn't read this field.
  const primarySuit = uniformPick(rng, threatSuits);

  const params: RoomParams = {
    poolSize,
    sizeBand,
    threatSuits,
    primarySuit,
    playerHandSize: PLAYER_HAND_SIZE,
    onSuitRatio: ON_SUIT_RATIO,
    boonRatio: BOON_SUIT_RATIO,
    guardRatio: GUARD_SUIT_RATIO,
    weakenRatio: WEAKEN_SUIT_RATIO,
    poisonRatio: POISON_SUIT_RATIO,
    strengthRatio: STRENGTH_SUIT_RATIO,
  };

  const pool = generateWeightedDeck(
    params.poolSize,
    `${id}-pool`,
    {
      onSuitTargets: threatSuits,
      onSuitRatio: params.onSuitRatio,
      boonRatio: params.boonRatio,
      guardRatio: params.guardRatio,
      weakenRatio: params.weakenRatio,
      poisonRatio: params.poisonRatio,
      strengthRatio: params.strengthRatio,
    },
    rng,
  );

  return { id, params, enemies, pool };
}
