import type { CombatState } from './combat';
import type { BranchRoot, Door } from './door';
import type { Card } from './cards';
import type { Rng } from '../engine/rng';

export type RunPhase =
  | 'start'
  | 'combat'
  | 'reward'
  | 'door-choice'
  | 'run-complete'
  | 'run-over';

export interface RunState {
  seed: number;
  rng: Rng;
  depth: number;
  maxDepth: number;
  playerHP: number;
  playerHPMax: number;
  phase: RunPhase;
  // The player's persistent, run-level deck (design doc's persistent-deck
  // system) -- grown by chooseReward after every cleared room, reshuffled
  // fresh into CombatState.drawPile/discardPile at the start of every room
  // (see runEngine.initCombat call sites). This is the only thing that
  // carries a player's hand contents across rooms; RoomInstance no longer
  // deals a hand of its own.
  deck: Card[];
  // Set by resolveCombatEnd's room-cleared branch, consumed by chooseReward.
  // Null outside the 'reward' phase.
  rewardOptions: Card[] | null;
  branchRoots: Record<string, BranchRoot>;
  currentBranchRootId: string | null;
  currentDoors: Door[] | null;
  combat: CombatState | null;
}
