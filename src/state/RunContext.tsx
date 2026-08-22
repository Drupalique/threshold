import { useReducer, type ReactNode } from 'react';
import type { RunState } from '../types/run';
import type { CombatAction } from '../types/combat';
import {
  createNewRun,
  startFirstRoom,
  applyCombatAction,
  resolveCombatEnd,
  chooseDoor,
} from '../engine/runEngine';
import { RunContext, type RunContextValue } from './runContextObject';

type RunReducerAction =
  | { type: 'START_RUN' }
  | { type: 'COMBAT'; action: CombatAction }
  | { type: 'RESOLVE_COMBAT_END' }
  | { type: 'CHOOSE_DOOR'; doorId: string }
  | { type: 'RESTART' };

function makeSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

function reducer(state: RunState, action: RunReducerAction): RunState {
  switch (action.type) {
    case 'START_RUN':
      return startFirstRoom(state);
    case 'COMBAT':
      return applyCombatAction(state, action.action);
    case 'RESOLVE_COMBAT_END':
      return resolveCombatEnd(state);
    case 'CHOOSE_DOOR':
      return chooseDoor(state, action.doorId);
    case 'RESTART':
      return createNewRun(makeSeed());
    default:
      return state;
  }
}

export function RunProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => createNewRun(makeSeed()));

  const value: RunContextValue = {
    state,
    startRun: () => dispatch({ type: 'START_RUN' }),
    dispatchCombat: (action) => dispatch({ type: 'COMBAT', action }),
    resolveCombatEnd: () => dispatch({ type: 'RESOLVE_COMBAT_END' }),
    chooseDoor: (doorId) => dispatch({ type: 'CHOOSE_DOOR', doorId }),
    restart: () => dispatch({ type: 'RESTART' }),
  };

  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}
