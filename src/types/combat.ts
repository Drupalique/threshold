import type { SuitId } from './suits';
import type { Card } from './cards';
import type { EnemyInstance } from './enemy';
import type { RoomParams } from './room';
import type { StatusBag } from './status';
import type { RelicDef } from './relics';
import type { PotionDef } from './potions';

export type CombatActor = 'player' | 'enemy';
export type CombatStatus = 'active' | 'room-cleared' | 'player-dead';

// 'room' | 'player' | an EnemyInstance.instanceId -- who played a given
// table card. For 'player' and an enemy instanceId, this determines whose
// own-turn-start wipe removes it (see combatEngine's wipeOwnerTable). For
// 'room', ownership instead determines when a play "claims" it -- the
// moment any combatant reads that card's suit's table count, it's removed
// (see tableState's claimRoomCards) -- so a room card can sit on the table
// across many rounds, growing that suit's stockpile, until someone
// actually plays into it.
export type TableOwnerId = 'room' | 'player' | string;

/**
 * One suited card sitting on the shared table, tagged with who played it.
 * Replaces the old shared `pool: Card[]` entirely -- a play never removes a
 * player's or an enemy's own contribution from the table (see
 * combatEngine's performPlay), so those only ever grow within a round and
 * only ever shrink via their owner's own-turn-start wipe. The room's own
 * cards are the exception: they persist and accumulate across rounds too,
 * but shrink the moment a play claims them (see claimRoomCards). Quake
 * cards never appear here -- same as the old pool, only creature-suited
 * cards land on the table.
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
  // A plain StS-style energy pool for the player's own turn: seeded from
  // PLAYS_PER_TURN_BASE, spent 1-per-play, and freely raised (e.g. Quake's
  // QUAKE_BONUS_PLAYS) or lowered by any future effect -- no separate
  // "unlimited" bypass flag alongside it.
  playsRemaining: number;
  log: LogEntry[];
  status: CombatStatus;
  // Copied in once from RunState.relics at initCombat -- see
  // combatEngine.ts's applyRelics, which reads this directly rather than
  // taking relics as a separate performPlay parameter.
  relics: RelicDef[];
  // Copied in once from RunState.potions at initCombat, then mutated as the
  // player consumes potions mid-combat (see applyCombatAction's
  // USE_FREE_CLAIM_POTION/USE_SALT_POTION branches) -- runEngine.ts's own
  // applyCombatAction wrapper syncs the result back into RunState.potions
  // the same way it already does for playerHP.
  potions: PotionDef[];
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

// Both potion actions are free, like PlayerPlayQuakeAction -- no play spent,
// turn doesn't end -- and act directly on the table via claimRoomCards
// rather than through a hand card (see combatEngine.ts's
// resolveFreeClaimEffect/resolveSaltEffect). targetInstanceId follows the
// same rule PlaySetAction's does: required when the suit's category is
// threat/weaken/poison, omitted otherwise.
export interface UseFreeClaimPotionAction {
  type: 'USE_FREE_CLAIM_POTION';
  suit: SuitId;
  targetInstanceId?: string;
}

export interface UseSaltPotionAction {
  type: 'USE_SALT_POTION';
  suit: SuitId;
}

export type CombatAction =
  | PlaySetAction
  | PlayerPassAction
  | PlayerPlayQuakeAction
  | EnemyTurnAction
  | UseFreeClaimPotionAction
  | UseSaltPotionAction;
