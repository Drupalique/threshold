import type { SuitId } from './suits';
import type { Card } from './cards';
import type { EnemyInstance } from './enemy';

export type PoolSizeBand = 'small' | 'large';

export interface RoomParams {
  poolSize: number;
  sizeBand: PoolSizeBand;
  // Which threat suits this room's pool draws from -- a property of the
  // room itself (see roomGenerator's pickThreatSuits), independent of which
  // specific enemies happen to be present. A pile in any of these suits can
  // be claimed against any alive enemy, not just one that happens to "match."
  threatSuits: SuitId[];
  // One of threatSuits, picked for door color-tag correlation
  // (doorGenerator.ts) only -- combat itself never reads this field.
  primarySuit: SuitId;
  playerHandSize: number;
  onSuitRatio: number;
  boonRatio: number;
  guardRatio: number;
}

export interface RoomInstance {
  id: string;
  params: RoomParams;
  enemies: EnemyInstance[];
  pool: Card[];
  playerHandDeal: Card[];
}
