import type { SuitId } from './suits';
import type { Card } from './cards';
import type { RoomParams } from './room';

export type CombatActor = 'player' | 'room';

export type CombatStatus = 'active' | 'room-cleared' | 'player-dead';

export interface LogEntry {
  id: string;
  turn: number;
  actor: CombatActor | 'system';
  type: string;
  message: string;
  // Snapshot of the meters immediately after this entry's effects were
  // applied, so the log reads as a status trail rather than just events.
  playerHP: number;
  playerHPMax: number;
  playerGuard: number;
  roomThreat: number;
  roomThreatMax: number;
  // Only set on 'claim' entries. The claimed cards are gone from the live
  // hand/pool arrays by the time this entry exists (performClaim removes
  // them in the same update), so the UI can't recover "what was claimed"
  // from current state -- these snapshots are the only record of it, used
  // to briefly reveal/highlight a room claim before it fades.
  claimSuit?: SuitId;
  claimedHandCards?: Card[];
  claimedPoolCards?: Card[];
}

export interface CombatState {
  pool: Card[];
  playerHand: Card[];
  roomHand: Card[];
  // Kept around (rather than just the initial deals) so a hand can be
  // regenerated with the same weighting if HAND_REDRAW_EACH_TURN is on.
  roomParams: RoomParams;
  playerHP: number;
  playerHPMax: number;
  // Absorbs incoming Player HP loss (room threat claims and decay alike)
  // until it expires at the end of the room's next turn -- a Ward claim is
  // the player's exclusive defensive tool; the room can't generate its own.
  playerGuard: number;
  roomThreat: number;
  roomThreatMax: number;
  turnNumber: number;
  activeTurn: CombatActor;
  decayCounters: Partial<Record<SuitId, number>>;
  blockedSuits: Partial<Record<SuitId, number>>;
  log: LogEntry[];
  status: CombatStatus;
}

export interface PlayerClaimAction {
  type: 'PLAYER_CLAIM';
  suit: SuitId;
  handCardIds: string[];
}

export interface PlayerPassAction {
  type: 'PLAYER_PASS';
}

export interface RoomTurnAction {
  type: 'ROOM_TURN';
}

export type CombatAction = PlayerClaimAction | PlayerPassAction | RoomTurnAction;
