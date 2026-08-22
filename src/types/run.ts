import type { CombatState } from './combat';
import type { BranchRoot, Door } from './door';
import type { Rng } from '../engine/rng';

export type RunPhase =
  | 'start'
  | 'combat'
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
  branchRoots: Record<string, BranchRoot>;
  currentBranchRootId: string | null;
  currentDoors: Door[] | null;
  combat: CombatState | null;
}
