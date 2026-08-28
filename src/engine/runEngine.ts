import type { RunState } from '../types/run';
import type { BranchRoot } from '../types/door';
import type { CombatAction } from '../types/combat';
import { createRng } from './rng';
import { generateRoom } from './roomGenerator';
import { generateDoorPair } from './doorGenerator';
import { initCombat, applyCombatAction as combatApplyAction } from './combatEngine';
import { generateRewardOptions } from './rewardGenerator';
import { PLAYER_HP_MAX, REST_HEAL_PCT, RUN_MAX_DEPTH, STARTER_DECK } from '../config/constants';

export function createNewRun(seed: number): RunState {
  return {
    seed,
    rng: createRng(seed),
    depth: 0,
    maxDepth: RUN_MAX_DEPTH,
    playerHP: PLAYER_HP_MAX,
    playerHPMax: PLAYER_HP_MAX,
    phase: 'start',
    deck: [...STARTER_DECK],
    rewardOptions: null,
    branchRoots: {},
    currentBranchRootId: null,
    currentDoors: null,
    combat: null,
  };
}

export function startFirstRoom(run: RunState): RunState {
  const room = generateRoom(run.rng, run.depth + 1);
  const branchRoot: BranchRoot = { id: `branch-${room.id}`, depth: 1, room };
  const combat = initCombat(room, run.rng, run.playerHP, run.playerHPMax, run.deck);
  return {
    ...run,
    phase: 'combat',
    branchRoots: { [branchRoot.id]: branchRoot },
    currentBranchRootId: branchRoot.id,
    combat,
  };
}

/**
 * Applies a combat action but deliberately does NOT transition the run
 * phase away from 'combat' even when the action ends the round (death or
 * clear) -- the caller (CombatScreen) stays mounted for a beat so the meter
 * bars can animate to their final value, same as any other turn, instead of
 * cutting straight to the door-choice/run-end screen. Call resolveCombatEnd
 * afterward (typically after a short delay) to actually advance the phase.
 */
export function applyCombatAction(run: RunState, action: CombatAction): RunState {
  if (!run.combat || run.phase !== 'combat') return run;
  const nextCombat = combatApplyAction(run.combat, action, run.rng);
  return { ...run, combat: nextCombat, playerHP: nextCombat.playerHP };
}

/**
 * Advances the run phase once `run.combat.status` is no longer 'active'. A
 * cleared room goes to the 'reward' phase (chooseReward below advances it to
 * door-choice from there) rather than straight to door generation -- unless
 * this was the run's last room, in which case there's nothing left to
 * reward for.
 */
export function resolveCombatEnd(run: RunState): RunState {
  if (!run.combat || run.phase !== 'combat' || run.combat.status === 'active') return run;

  if (run.combat.status === 'player-dead') {
    return { ...run, phase: 'run-over' };
  }

  // room-cleared
  const newDepth = run.depth + 1;

  if (newDepth >= run.maxDepth) {
    return { ...run, depth: newDepth, phase: 'run-complete' };
  }

  const rewardOptions = generateRewardOptions(newDepth, run.rng);
  return { ...run, depth: newDepth, phase: 'reward', rewardOptions };
}

/** Shared tail for both chooseReward and (in principle) any other reward-phase exit -- generates the next door pair. */
function proceedToDoors(run: RunState): RunState {
  const { doors, branchRoots } = generateDoorPair(run.rng, run.depth + 1);
  const branchRootMap = { ...run.branchRoots };
  if (run.currentBranchRootId) delete branchRootMap[run.currentBranchRootId];
  for (const br of branchRoots) branchRootMap[br.id] = br;

  return {
    ...run,
    phase: 'door-choice',
    branchRoots: branchRootMap,
    currentDoors: doors,
    currentBranchRootId: null,
  };
}

/** Appends the chosen reward card to the persistent deck, then proceeds to door generation. */
export function chooseReward(run: RunState, cardId: string): RunState {
  if (run.phase !== 'reward' || !run.rewardOptions) return run;
  const chosen = run.rewardOptions.find((c) => c.id === cardId);
  if (!chosen) return run;

  return proceedToDoors({ ...run, deck: [...run.deck, chosen], rewardOptions: null });
}

/**
 * Leaves the deck untouched and proceeds to door generation -- the general
 * "I'm done here" exit from the reward phase. Deliberately screen-level
 * rather than a per-option decline: today's reward phase is a single
 * pick-one-of-N card offer, but it's designed to stay correct once the
 * phase can offer other optional things later (see GAME_DESIGN.md's
 * proposed-features section) -- passing always just
 * means "proceed with whatever I've already taken," never a specific
 * card's own opt-out.
 */
export function skipReward(run: RunState): RunState {
  if (run.phase !== 'reward') return run;
  return proceedToDoors({ ...run, rewardOptions: null });
}

export function chooseDoor(run: RunState, doorId: string): RunState {
  if (run.phase !== 'door-choice' || !run.currentDoors) return run;
  const chosen = run.currentDoors.find((d) => d.id === doorId);
  if (!chosen) return run;
  const branchRoot = run.branchRoots[chosen.branchRootId];
  if (!branchRoot) return run;

  // Only the chosen branch root survives -- the unchosen door and its
  // subtree are discarded, making "no backtracking, no preview" structural.
  const branchRootMap: Record<string, BranchRoot> = { [branchRoot.id]: branchRoot };
  const base = {
    ...run,
    branchRoots: branchRootMap,
    currentBranchRootId: branchRoot.id,
    currentDoors: null,
  };

  if (branchRoot.room.kind === 'rest') {
    return { ...base, phase: 'rest' as const, combat: null };
  }

  const combat = initCombat(branchRoot.room, run.rng, run.playerHP, run.playerHPMax, run.deck);
  return { ...base, phase: 'combat' as const, combat };
}

/**
 * Shared tail for both rest options -- a rest room never grants a card
 * reward (unlike clearing a combat room), so this advances depth and goes
 * straight to door generation, skipping the 'reward' phase entirely. Also
 * guards the (currently unreachable, since REST_ROOM_RATIO's roll is
 * skipped once floor >= RUN_MAX_DEPTH) case of a rest room landing on the
 * run's last room, same defensive shape as resolveCombatEnd.
 */
function finishRestRoom(run: RunState): RunState {
  const newDepth = run.depth + 1;
  if (newDepth >= run.maxDepth) {
    return { ...run, depth: newDepth, phase: 'run-complete' };
  }
  return proceedToDoors({ ...run, depth: newDepth });
}

/** Restores REST_HEAL_PCT of playerHPMax (rounded, capped at max) and leaves the rest room. Exclusive with restRemoveCard -- see RestScreen.tsx. */
export function restHeal(run: RunState): RunState {
  if (run.phase !== 'rest') return run;
  const healAmount = Math.round(run.playerHPMax * REST_HEAL_PCT);
  const playerHP = Math.min(run.playerHPMax, run.playerHP + healAmount);
  return finishRestRoom({ ...run, playerHP });
}

/** Permanently removes one card (by its unique id) from the persistent deck and leaves the rest room. Exclusive with restHeal -- see RestScreen.tsx. */
export function restRemoveCard(run: RunState, cardId: string): RunState {
  if (run.phase !== 'rest') return run;
  if (!run.deck.some((c) => c.id === cardId)) return run;
  const deck = run.deck.filter((c) => c.id !== cardId);
  return finishRestRoom({ ...run, deck });
}
