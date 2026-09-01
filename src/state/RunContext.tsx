import { useReducer, type ReactNode } from 'react';
import type { RunState } from '../types/run';
import type { CombatAction } from '../types/combat';
import {
  createNewRun,
  startFirstRoom,
  applyCombatAction,
  resolveCombatEnd,
  chooseReward,
  skipReward,
  restHeal,
  restRemoveCard,
  chooseRelic,
  skipShrine,
  buyShopOption,
  leaveShop,
  chooseDoor,
} from '../engine/runEngine';
import { RunContext, type RunContextValue } from './runContextObject';

type RunReducerAction =
  | { type: 'START_RUN' }
  | { type: 'COMBAT'; action: CombatAction }
  | { type: 'RESOLVE_COMBAT_END' }
  | { type: 'CHOOSE_REWARD'; cardId: string }
  | { type: 'SKIP_REWARD' }
  | { type: 'REST_HEAL' }
  | { type: 'REST_REMOVE_CARD'; cardId: string }
  | { type: 'CHOOSE_RELIC'; relicId: string }
  | { type: 'SKIP_SHRINE' }
  | { type: 'BUY_SHOP_OPTION'; optionId: string }
  | { type: 'LEAVE_SHOP' }
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
    case 'CHOOSE_REWARD':
      return chooseReward(state, action.cardId);
    case 'SKIP_REWARD':
      return skipReward(state);
    case 'REST_HEAL':
      return restHeal(state);
    case 'REST_REMOVE_CARD':
      return restRemoveCard(state, action.cardId);
    case 'CHOOSE_RELIC':
      return chooseRelic(state, action.relicId);
    case 'SKIP_SHRINE':
      return skipShrine(state);
    case 'BUY_SHOP_OPTION':
      return buyShopOption(state, action.optionId);
    case 'LEAVE_SHOP':
      return leaveShop(state);
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
    chooseReward: (cardId) => dispatch({ type: 'CHOOSE_REWARD', cardId }),
    skipReward: () => dispatch({ type: 'SKIP_REWARD' }),
    restHeal: () => dispatch({ type: 'REST_HEAL' }),
    restRemoveCard: (cardId) => dispatch({ type: 'REST_REMOVE_CARD', cardId }),
    chooseRelic: (relicId) => dispatch({ type: 'CHOOSE_RELIC', relicId }),
    skipShrine: () => dispatch({ type: 'SKIP_SHRINE' }),
    buyShopOption: (optionId) => dispatch({ type: 'BUY_SHOP_OPTION', optionId }),
    leaveShop: () => dispatch({ type: 'LEAVE_SHOP' }),
    chooseDoor: (doorId) => dispatch({ type: 'CHOOSE_DOOR', doorId }),
    restart: () => dispatch({ type: 'RESTART' }),
  };

  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}
