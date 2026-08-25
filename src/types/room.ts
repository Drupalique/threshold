import type { SuitId } from './suits';
import type { EnemyInstance } from './enemy';

export type PoolSizeBand = 'small' | 'large';

export interface RoomParams {
  // Sized for ONE round's neutral table deal (see combatEngine's
  // dealRoomTable), not a whole fight -- unlike the old poolSize, which sized
  // a pool meant to last until the room cleared.
  tableDealSize: number;
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

export interface RoomInstance {
  id: string;
  params: RoomParams;
  enemies: EnemyInstance[];
}
