import type { SuitId } from './suits';
import type { EnemyInstance } from './enemy';

export type PoolSizeBand = 'small' | 'large';

// An inclusive [min, max] range an Rng.int roll is drawn from. min === max
// means a fixed value every time; min < max means it varies per roll.
export interface IntRange {
  min: number;
  max: number;
}

export interface RoomParams {
  // Sized for ONE table-deal batch (see tableState's dealRoomTable), not a
  // whole fight -- unlike the old poolSize, which sized a pool meant to last
  // until the room cleared. How many such batches land in a single round is
  // dealsPerRound, below -- a room can deal more than one of these per round.
  tableDealSize: number;
  // How many tableDealSize batches the room deals each round -- re-rolled
  // fresh every round from this room's own [min, max] (see tableState's
  // dealRoomTableForRound). {min:1,max:1} is a steady one-a-turn room,
  // {min:2,max:2} a steady two-a-turn room, {min:1,max:3} an erratic room
  // that deals somewhere between 1 and 3 batches each round.
  dealsPerRound: IntRange;
  sizeBand: PoolSizeBand;
  // Which threat suits this room's table draws from -- a property of the
  // room itself (see roomGenerator's pickThreatSuits), independent of which
  // specific enemies happen to be present.
  threatSuits: SuitId[];
  // One of threatSuits, picked for door color-tag correlation
  // (doorGenerator.ts) only -- combat itself never reads this field.
  primarySuit: SuitId;
  playerHandSize: number;
  onSuitRatio: number;
  boonRatio: number;
  guardRatio: number;
  weakenRatio: number;
  poisonRatio: number;
  strengthRatio: number;
}

export interface CombatRoomInstance {
  kind: 'combat';
  id: string;
  params: RoomParams;
  enemies: EnemyInstance[];
}

/**
 * A campfire/fairy's-cave style rest stop -- no table, no enemies, no
 * params. Resolved directly by runEngine's restHeal/restRemoveCard, not by
 * combatEngine at all; see doorGenerator.ts's REST_ROOM_RATIO roll and
 * runEngine.ts's chooseDoor for how a door ends up pointing at one of these
 * instead of a CombatRoomInstance.
 */
export interface RestRoomInstance {
  kind: 'rest';
  id: string;
}

/**
 * A relic-offering stop, resolved by runEngine's chooseRelic/skipShrine
 * rather than combatEngine.ts -- see doorGenerator.ts/runTree.ts's
 * SHRINE_ROOM_RATIO roll. Unlike CombatRoomInstance/RestRoomInstance, its
 * offer isn't precomputed here: which relics it offers must exclude
 * whatever the player already holds by the time they arrive, and the run
 * tree is built once at run start before any relics exist. So its content
 * is generated live off run.rng in chooseDoor, the same way reward options
 * already are, instead of being fixed by the tree's own seed.
 */
export interface ShrineRoomInstance {
  kind: 'shrine';
  id: string;
}

export type RoomInstance = CombatRoomInstance | RestRoomInstance | ShrineRoomInstance;
