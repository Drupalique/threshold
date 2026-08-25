import type { RoomInstance, RoomParams, PoolSizeBand } from '../types/room';
import type { EnemyInstance } from '../types/enemy';
import type { SuitId } from '../types/suits';
import type { Rng } from './rng';
import { uniformPick, pickDistinct, weightedPick } from './weightedPick';
import { ENEMY_DEFS } from '../config/enemies';
import {
  ON_SUIT_RATIO,
  BOON_SUIT_RATIO,
  GUARD_SUIT_RATIO,
  WEAKEN_SUIT_RATIO,
  POISON_SUIT_RATIO,
  STRENGTH_SUIT_RATIO,
  PLAYER_HAND_SIZE,
  ROOM_TABLE_DEAL_SMALL,
  ROOM_TABLE_DEAL_LARGE,
  ROOM_DEAL_FREQUENCY_PROFILES,
  ROOM_MIN_ENEMIES,
  ROOM_MAX_ENEMIES,
  ENEMY_COUNT_WEIGHTS_EARLY,
  ENEMY_COUNT_WEIGHTS_LATE,
  RUN_MAX_DEPTH,
  THREAT_SUITS,
  THREAT_SUIT_COUNT_BY_SIZE_BAND,
} from '../config/constants';

let roomCounter = 0;

/**
 * How many enemies this room gets, weighted by floor -- previously a flat
 * uniform roll across ROOM_MIN/MAX_ENEMIES regardless of depth, which batch
 * playtesting found made 3-enemy rooms (a ~10% clear rate) exactly as likely
 * on floor 1 as floor 9. Linearly blends ENEMY_COUNT_WEIGHTS_EARLY (floor 1)
 * toward ENEMY_COUNT_WEIGHTS_LATE (floor RUN_MAX_DEPTH) so 3-enemy rooms are
 * rare early and common late, instead of equally likely everywhere.
 */
function pickEnemyCount(floor: number, rng: Rng): number {
  const range = ROOM_MAX_ENEMIES - ROOM_MIN_ENEMIES + 1;
  const t =
    RUN_MAX_DEPTH > 1
      ? Math.min(1, Math.max(0, (floor - 1) / (RUN_MAX_DEPTH - 1)))
      : 1;
  const entries = Array.from({ length: range }, (_, i) => ({
    weight:
      ENEMY_COUNT_WEIGHTS_EARLY[i] +
      (ENEMY_COUNT_WEIGHTS_LATE[i] - ENEMY_COUNT_WEIGHTS_EARLY[i]) * t,
    value: ROOM_MIN_ENEMIES + i,
  }));
  return weightedPick(rng, entries);
}

/**
 * Picks enemies eligible for `floor`, with count scaled by depth (see
 * pickEnemyCount). Duplicates are allowed by design -- two Wolf-kin can
 * appear in the same room, each independently targetable via their own
 * instanceId, each with its own independent hand/deck cycle (dealt in
 * combatEngine's initCombat, not here -- see hand/drawPile/discardPile's
 * empty placeholders below). Selection among eligible defs is uniform;
 * weighting the roll toward higher-minFloor defs as the floor climbs is a
 * documented open tuning knob, not implemented yet.
 *
 * Rooms are generated speculatively for both doors in a pair (only one is
 * ever chosen) -- leaving hand/deck empty here, same as the player's own
 * deck sitting un-shuffled/un-dealt until initCombat touches it, avoids
 * spending RNG draws on a room that might be discarded.
 */
function pickEnemies(floor: number, roomId: string, rng: Rng): EnemyInstance[] {
  const eligible = ENEMY_DEFS.filter((d) => d.minFloor <= floor);
  const pool = eligible.length > 0 ? eligible : ENEMY_DEFS;
  const count = pickEnemyCount(floor, rng);

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
      statuses: {},
      hand: [],
      drawPile: [],
      discardPile: [],
    });
  }
  return enemies;
}

/**
 * Picks the threat suits woven into this room's table -- a property of the
 * room's own "type" (currently just its size band), deliberately
 * independent of which enemies pickEnemies happened to roll.
 */
function pickThreatSuits(sizeBand: PoolSizeBand, rng: Rng): SuitId[] {
  return pickDistinct(rng, THREAT_SUITS, THREAT_SUIT_COUNT_BY_SIZE_BAND[sizeBand]);
}

export function generateRoom(rng: Rng, floor: number): RoomInstance {
  const id = `room-${roomCounter++}`;
  const enemies = pickEnemies(floor, id, rng);

  const sizeBand: PoolSizeBand = uniformPick(rng, ['small', 'large']);
  const [min, max] =
    sizeBand === 'small' ? ROOM_TABLE_DEAL_SMALL : ROOM_TABLE_DEAL_LARGE;
  const tableDealSize = rng.int(min, max);
  // Independent of sizeBand -- a room's deal frequency is its own knob, not
  // derived from how big each batch is.
  const dealsPerRound = uniformPick(rng, ROOM_DEAL_FREQUENCY_PROFILES);

  const threatSuits = pickThreatSuits(sizeBand, rng);
  // Door color correlation uses one of the room's own threat suits as a
  // stand-in for "what this room is mainly about" -- flavor only, combat
  // itself doesn't read this field.
  const primarySuit = uniformPick(rng, threatSuits);

  const params: RoomParams = {
    tableDealSize,
    dealsPerRound,
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

  return { id, params, enemies };
}
