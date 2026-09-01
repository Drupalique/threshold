import type { RunState } from '../types/run';
import type { Door } from '../types/door';
import type { CombatRoomInstance } from '../types/room';
import type { CombatAction } from '../types/combat';
import { createRng } from './rng';
import { buildRunTree } from './runTree';
import { initCombat, applyCombatAction as combatApplyAction } from './combatEngine';
import { generateRewardOptions, generateShrineOptions } from './rewardGenerator';
import { PLAYER_HP_MAX, REST_HEAL_PCT, RUN_MAX_DEPTH, STARTER_DECK } from '../config/constants';

export function createNewRun(seed: number): RunState {
  return {
    seed,
    rng: createRng(seed),
    runTree: buildRunTree(seed, RUN_MAX_DEPTH),
    currentPath: '',
    depth: 0,
    maxDepth: RUN_MAX_DEPTH,
    playerHP: PLAYER_HP_MAX,
    playerHPMax: PLAYER_HP_MAX,
    phase: 'start',
    deck: [...STARTER_DECK],
    relics: [],
    potions: [],
    rewardOptions: null,
    shrineOptions: null,
    currentDoors: null,
    combat: null,
  };
}

export function startFirstRoom(run: RunState): RunState {
  const node = run.runTree.nodes[run.currentPath];
  // The floor-1 root is always a combat room (see runTree.ts's buildRunTree
  // -- the very first room has no door choice, so it can never roll rest).
  const combat = initCombat(node.room as CombatRoomInstance, run.rng, run.playerHP, run.playerHPMax, run.deck, run.relics, run.potions);
  return { ...run, phase: 'combat', combat };
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
  return { ...run, combat: nextCombat, playerHP: nextCombat.playerHP, potions: nextCombat.potions };
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

  const rewardOptions = generateRewardOptions(newDepth, run.rng, run.relics, run.potions);
  return { ...run, depth: newDepth, phase: 'reward', rewardOptions };
}

/**
 * Shared tail for both chooseReward and (in principle) any other
 * reward-phase exit -- surfaces the current tree node's precomputed door
 * pair (see runTree.ts's buildRunTree) rather than generating one live, so
 * the doors on offer are exactly what the seed already fixed for this path.
 */
function proceedToDoors(run: RunState): RunState {
  const node = run.runTree.nodes[run.currentPath];
  const doorRefs = node.doors!;
  const doors: Door[] = doorRefs.map((d) => ({
    id: `door-${d.childPath}`,
    tags: d.tags,
    childPath: d.childPath,
  }));

  return { ...run, phase: 'door-choice', currentDoors: doors };
}

/** Appends the chosen reward option to the persistent deck or held relics (per its optionType), then proceeds to door generation. */
export function chooseReward(run: RunState, optionId: string): RunState {
  if (run.phase !== 'reward' || !run.rewardOptions) return run;
  const chosen = run.rewardOptions.find((o) => o.id === optionId);
  if (!chosen) return run;

  const next =
    chosen.optionType === 'card'
      ? { ...run, deck: [...run.deck, chosen.card] }
      : chosen.optionType === 'relic'
        ? { ...run, relics: [...run.relics, chosen.relic] }
        : { ...run, potions: [...run.potions, chosen.potion] };
  return proceedToDoors({ ...next, rewardOptions: null });
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
  const node = run.runTree.nodes[chosen.childPath];
  if (!node) return run;

  // The unchosen door's subtree is never played, but -- unlike before --
  // it isn't discarded from state either: the whole tree was precomputed
  // up front (buildRunTree) and stays there for the run's lifetime so dev
  // tooling can show it (see ui/screens/RunTreeScreen.tsx). "No
  // backtracking" is enforced at the play level (currentPath only ever
  // advances), not by deleting data.
  const base = { ...run, currentPath: chosen.childPath, currentDoors: null };

  if (node.room.kind === 'rest') {
    return { ...base, phase: 'rest' as const, combat: null };
  }

  if (node.room.kind === 'shrine') {
    // Generated live off run.rng, not precomputed in the tree -- see
    // types/room.ts's ShrineRoomInstance for why (it must exclude relics
    // the player already holds by the time they arrive).
    const shrineOptions = generateShrineOptions(run.rng, run.relics);
    return { ...base, phase: 'shrine' as const, combat: null, shrineOptions };
  }

  const combat = initCombat(node.room, run.rng, run.playerHP, run.playerHPMax, run.deck, run.relics, run.potions);
  return { ...base, phase: 'combat' as const, combat };
}

/**
 * Shared tail for both rest and shrine rooms -- neither grants a card
 * reward (unlike clearing a combat room), so this advances depth and goes
 * straight to door generation, skipping the 'reward' phase entirely. Also
 * guards the (currently unreachable, since REST_ROOM_RATIO/SHRINE_ROOM_RATIO's
 * roll is skipped once floor >= RUN_MAX_DEPTH) case of a side room landing on
 * the run's last room, same defensive shape as resolveCombatEnd.
 */
function finishSideRoom(run: RunState): RunState {
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
  return finishSideRoom({ ...run, playerHP });
}

/** Permanently removes one card (by its unique id) from the persistent deck and leaves the rest room. Exclusive with restHeal -- see RestScreen.tsx. */
export function restRemoveCard(run: RunState, cardId: string): RunState {
  if (run.phase !== 'rest') return run;
  if (!run.deck.some((c) => c.id === cardId)) return run;
  const deck = run.deck.filter((c) => c.id !== cardId);
  return finishSideRoom({ ...run, deck });
}

/** Adds the chosen relic (by id) to the persistent held-relics list and leaves the shrine. Exclusive with skipShrine -- see ShrineScreen.tsx. */
export function chooseRelic(run: RunState, relicId: string): RunState {
  if (run.phase !== 'shrine' || !run.shrineOptions) return run;
  const chosen = run.shrineOptions.find((r) => r.id === relicId);
  if (!chosen) return run;
  return finishSideRoom({ ...run, relics: [...run.relics, chosen], shrineOptions: null });
}

/** Leaves the shrine with no relic taken -- the general "I'm done here" exit, same shape as skipReward. */
export function skipShrine(run: RunState): RunState {
  if (run.phase !== 'shrine') return run;
  return finishSideRoom({ ...run, shrineOptions: null });
}
