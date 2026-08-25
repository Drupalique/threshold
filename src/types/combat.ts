import type { SuitId } from './suits';
import type { Card } from './cards';
import type { EnemyInstance } from './enemy';
import type { RoomParams } from './room';
import type { StatusBag } from './status';

export type CombatActor = 'player' | 'enemy';
export type CombatStatus = 'active' | 'room-cleared' | 'player-dead';

// 'room' | 'player' | an EnemyInstance.instanceId -- who played a given
// table card. Determines whose own-turn-start wipe removes it (see
// combatEngine's wipeOwnerTable); nothing else ever removes a table card.
export type TableOwnerId = 'room' | 'player' | string;

/**
 * One suited card sitting on the shared table, tagged with who played it.
 * Replaces the old shared `pool: Card[]` entirely -- a play never removes
 * anything from the table any more (see combatEngine's performPlay), so the
 * table only ever grows within a round and only ever shrinks via an owner's
 * own-turn-start wipe. Quake cards never appear here -- same as the old
 * pool, only creature-suited cards land on the table.
 */
export interface TableCard {
  id: string;
  suit: SuitId;
  ownerId: TableOwnerId;
}

export interface LogEntry {
  id: string;
  turn: number;
  actor: CombatActor | 'system';
  type: string;
  message: string;
  playerHP: number;
  playerHPMax: number;
  playerGuard: number;
}

export interface CombatState {
  table: TableCard[];
  playerHand: Card[];
  drawPile: Card[];
  discardPile: Card[];
  roomParams: RoomParams;
  enemies: EnemyInstance[];
  activeEnemyIndex: number;
  playerHP: number;
  playerHPMax: number;
  // Persists like HP/statuses until it actually absorbs damage -- no more
  // forced reset at enemy-phase-end (that was decay-rhythm-driven reasoning
  // that no longer applies once decay itself is gone).
  playerGuard: number;
  playerStatuses: StatusBag;
  turnNumber: number;
  activeTurn: CombatActor;
  playsRemaining: number;
  unlimitedPlaysThisTurn: boolean;
  log: LogEntry[];
  status: CombatStatus;
}

/**
 * The one and only "do something with cards" action -- for both the player
 * (dispatched from the UI) and, internally, every enemy (never
 * UI-dispatched; chosen by engine/enemyAI.ts and applied the same way).
 * Replaces the old separate claim/feed actions: a play that currently
 * multiplies against zero matching table cards is legal and simply banks
 * those cards for a future compounding play, which is exactly what "feed"
 * used to do -- there's no longer a separate no-effect action for it.
 */
export interface PlaySetAction {
  type: 'PLAY_SET';
  suit: SuitId;
  handCardIds: string[];
  // Required when the suit's category is threat/weaken/poison (see
  // requiresEnemyTarget); omitted for boon/guard/strength, which always
  // self-target the acting entity.
  targetInstanceId?: string;
}

export interface PlayerPassAction {
  type: 'PLAYER_PASS';
}

export interface PlayerPlayQuakeAction {
  type: 'PLAYER_PLAY_QUAKE';
  cardId: string;
}

export interface EnemyTurnAction {
  type: 'ENEMY_TURN';
}

export type CombatAction =
  | PlaySetAction
  | PlayerPassAction
  | PlayerPlayQuakeAction
  | EnemyTurnAction;
