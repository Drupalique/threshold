import { createContext, useContext } from 'react';
import type { RunState } from '../types/run';
import type { CombatAction } from '../types/combat';

export interface RunContextValue {
  state: RunState;
  startRun: () => void;
  dispatchCombat: (action: CombatAction) => void;
  resolveCombatEnd: () => void;
  chooseDoor: (doorId: string) => void;
  restart: () => void;
}

export const RunContext = createContext<RunContextValue | null>(null);

export function useRun(): RunContextValue {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error('useRun must be used within a RunProvider');
  return ctx;
}
