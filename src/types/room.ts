import type { SuitId } from './suits';
import type { Card } from './cards';

export type PoolSizeBand = 'small' | 'large';

export interface RoomParams {
  poolSize: number;
  sizeBand: PoolSizeBand;
  dominantSuit: SuitId;
  threatValue: number;
  playerHandSize: number;
  roomHandSize: number;
  onSuitRatio: number;
  boonRatio: number;
  guardRatio: number;
  surpriseRatio: number;
}

export interface RoomInstance {
  id: string;
  params: RoomParams;
  pool: Card[];
  playerHandDeal: Card[];
  roomHandDeal: Card[];
}
