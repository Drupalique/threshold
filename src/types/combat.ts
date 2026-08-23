import type { SuitId } from './suits';
import type { Card } from './cards';
import type { EnemyInstance } from './enemy';
import type { RoomParams } from './room';
import type { StatusBag } from './status';

export type CombatActor = 'player' | 'enemy';

export type CombatStatus = 'active' | 'room-cleared' | 'player-dead';

export interface LogEntry {
  id: string;
  turn: number;
  actor: CombatActor | 'system';
  type: string;
  message: string;
  // Snapshot of the player's meters immediately after this entry's effects
  // were applied, so the log reads as a status trail. Enemy HP is not
  // snapshotted per-entry -- the enemy panel reads live state instead (see
  // PROTOTYPE_STATUS.md: enemy HP updates instantly rather than drip-
  // animating like the player HP bar does).
  playerHP: number;
  playerHPMax: number;
  playerGuard: number;
}

export interface CombatState {
  pool: Card[];
  playerHand: Card[];
  roomParams: RoomParams;
  // Alive enemies only, in stable turn order. A defeated enemy is removed
  // immediately (see combatEngine's performClaim), never left at 0 HP.
  enemies: EnemyInstance[];
  // Which enemies[] index acts next during an 'enemy' phase. Reset to 0
  // whenever the phase ends and control returns to the player.
  activeEnemyIndex: number;
  playerHP: number;
  playerHPMax: number;
  // Absorbs incoming Player HP loss until the current enemy phase finishes
  // (see endTurn's guard-fade handling) -- the player's exclusive
  // defensive tool, banked via the Ward suit.
  playerGuard: number;
  // Weaken/Strength/Poison stacks the player currently holds (see
  // engine/statusEffects.ts) -- decays by 1 stack at the end of every
  // player turn, whether or not a given stack was used.
  playerStatuses: StatusBag;
  turnNumber: number;
  activeTurn: CombatActor;
  // How many more set-claims the player may make before this turn passes to
  // the enemy phase. Reset to PLAYS_PER_TURN_BASE (the hook point for future
  // temporary buffs/debuffs or relics that adjust it) whenever a fresh
  // player turn begins; ignored while unlimitedPlaysThisTurn is set.
  playsRemaining: number;
  // Set for the rest of the current player turn by playing a Quake card
  // (see types/cards.ts) -- claims stop consuming playsRemaining until the
  // turn actually ends via Pass.
  unlimitedPlaysThisTurn: boolean;
  // Keyed by suit -- pool sets are suit-level, not owned by any one enemy.
  decayCounters: Partial<Record<SuitId, number>>;
  blockedSuits: Partial<Record<SuitId, number>>;
  log: LogEntry[];
  status: CombatStatus;
}

export interface PlayerClaimAction {
  type: 'PLAYER_CLAIM';
  suit: SuitId;
  // Which alive enemy to direct a threat claim's damage at, chosen freely by
  // the player -- threat-suit pool cards aren't owned by any one enemy, so
  // any enemy is a legal target regardless of suit. Required for threat
  // suits; omit for boon/guard suits, which have no target at all.
  targetInstanceId?: string;
  handCardIds: string[];
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
  | PlayerClaimAction
  | PlayerPassAction
  | PlayerPlayQuakeAction
  | EnemyTurnAction;
