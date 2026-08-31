import type { CombatState } from './combat';
import type { Door } from './door';
import type { Card } from './cards';
import type { Rng } from '../engine/rng';
import type { RunTree } from './runTree';

export type RunPhase =
  | 'start'
  | 'combat'
  | 'rest'
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
  // The entire run's precomputed branching structure (see types/runTree.ts,
  // engine/runTree.ts's buildRunTree) -- built once from the seed at
  // createNewRun and held for the run's whole lifetime, not just the path
  // actually taken, so dev tooling can show the whole tree at once.
  runTree: RunTree;
  // Path (into runTree.nodes) of the room currently being played.
  currentPath: string;
  currentDoors: Door[] | null;
  combat: CombatState | null;
}
