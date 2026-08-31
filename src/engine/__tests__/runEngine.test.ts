import { describe, it, expect } from 'vitest';
import {
  createNewRun,
  startFirstRoom,
  resolveCombatEnd,
  chooseReward,
  skipReward,
  chooseDoor,
  restHeal,
  restRemoveCard,
} from '../runEngine';
import type { RunState } from '../../types/run';
import type { RestRoomInstance } from '../../types/room';

function clearCurrentRoom(run: RunState): RunState {
  return { ...run, combat: { ...run.combat!, enemies: [], status: 'room-cleared' } };
}

/**
 * Forces the run into the 'rest' phase deterministically, bypassing
 * runTree's RNG-dependent REST_ROOM_RATIO roll -- these tests care about
 * restHeal/restRemoveCard's own behavior, not whether a given seed happens
 * to roll a rest room. Injects a synthetic rest-room node into the run's
 * (already-built) tree under a path that can't collide with a real one.
 */
function enterRestRoom(run: RunState): RunState {
  const restRoom: RestRoomInstance = { kind: 'rest', id: 'test-rest-room' };
  const childPath = 'test-rest-room';
  const doorId = 'door-test-rest-room';
  const withDoor: RunState = {
    ...run,
    phase: 'door-choice',
    runTree: {
      ...run.runTree,
      nodes: {
        ...run.runTree.nodes,
        [childPath]: {
          path: childPath,
          floor: run.depth + 2,
          room: restRoom,
          // Rest rooms aren't terminal (unless on the final floor, not the
          // case here) -- finishRestRoom always proceeds to another door
          // pair afterward, so this synthetic node needs one too. Nothing
          // in these tests advances past it, so the target paths don't need
          // to resolve to real nodes.
          doors: [
            { tags: { size: 'small', color: 'red' }, childPath: `${childPath}0` },
            { tags: { size: 'large', color: 'blue' }, childPath: `${childPath}1` },
          ],
        },
      },
    },
    currentDoors: [{ id: doorId, tags: { size: 'small', color: 'red' }, childPath }],
  };
  return chooseDoor(withDoor, doorId);
}

describe('reward flow', () => {
  it('offers deterministic options for a given seed, and the chosen card lands in the deck and the next room\'s draw', () => {
    let run = createNewRun(99);
    run = startFirstRoom(run);
    run = resolveCombatEnd(clearCurrentRoom(run));

    expect(run.phase).toBe('reward');
    expect(run.rewardOptions).not.toBeNull();
    expect(run.rewardOptions!.length).toBe(3);

    // Determinism: the same seed run through the same sequence of calls
    // yields the same reward options.
    let run2 = createNewRun(99);
    run2 = startFirstRoom(run2);
    run2 = resolveCombatEnd(clearCurrentRoom(run2));
    expect(run2.rewardOptions!.map((c) => c.id)).toEqual(run.rewardOptions!.map((c) => c.id));

    const chosenId = run.rewardOptions![0].id;
    const deckSizeBefore = run.deck.length;
    run = chooseReward(run, chosenId);

    expect(run.phase).toBe('door-choice');
    expect(run.rewardOptions).toBeNull();
    expect(run.deck.length).toBe(deckSizeBefore + 1);
    expect(run.deck.some((c) => c.id === chosenId)).toBe(true);

    // A door can now lead to a rest room (REST_ROOM_RATIO) instead of
    // combat -- pick whichever candidate is a combat room, since that's
    // what this test is actually exercising.
    const combatDoor = run.currentDoors!.find(
      (d) => run.runTree.nodes[d.childPath].room.kind === 'combat',
    )!;
    run = chooseDoor(run, combatDoor.id);
    const allIdsInNextRoom = new Set([
      ...run.combat!.playerHand.map((c) => c.id),
      ...run.combat!.drawPile.map((c) => c.id),
      ...run.combat!.discardPile.map((c) => c.id),
    ]);
    expect(allIdsInNextRoom.has(chosenId)).toBe(true);
  });

  it('rejects choosing an id that was not offered, leaving the run in the reward phase', () => {
    let run = createNewRun(5);
    run = startFirstRoom(run);
    run = resolveCombatEnd(clearCurrentRoom(run));
    const deckSizeBefore = run.deck.length;

    const rejected = chooseReward(run, 'not-a-real-option');
    expect(rejected).toBe(run);
    expect(rejected.deck.length).toBe(deckSizeBefore);
  });

  it('lets the player pass on every offered reward, leaving the deck untouched and still proceeding to door-choice', () => {
    let run = createNewRun(7);
    run = startFirstRoom(run);
    run = resolveCombatEnd(clearCurrentRoom(run));
    const deckSizeBefore = run.deck.length;

    run = skipReward(run);

    expect(run.phase).toBe('door-choice');
    expect(run.rewardOptions).toBeNull();
    expect(run.deck.length).toBe(deckSizeBefore);
    expect(run.currentDoors).not.toBeNull();
  });

  it('ignores skipReward outside the reward phase', () => {
    const run = createNewRun(7);
    expect(skipReward(run)).toBe(run);
  });

  it('skips the reward step entirely when the cleared room was the run\'s last one', () => {
    let run = createNewRun(2);
    run = startFirstRoom(run);
    run = { ...run, depth: run.maxDepth - 1 };
    run = resolveCombatEnd(clearCurrentRoom(run));

    expect(run.phase).toBe('run-complete');
    expect(run.rewardOptions).toBeNull();
  });
});

describe('rest rooms', () => {
  it('choosing a door into a rest room sets phase to rest with no combat state', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterRestRoom(run);

    expect(run.phase).toBe('rest');
    expect(run.combat).toBeNull();
  });

  it('restHeal restores REST_HEAL_PCT of max HP, capped at max, and proceeds straight to door-choice with no reward phase', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterRestRoom(run);
    run = { ...run, playerHP: 10 };
    const depthBefore = run.depth;

    run = restHeal(run);

    // REST_HEAL_PCT is 0.3 of PLAYER_HP_MAX (30) = 9, rounded.
    expect(run.playerHP).toBe(19);
    expect(run.phase).toBe('door-choice');
    expect(run.rewardOptions).toBeNull();
    expect(run.depth).toBe(depthBefore + 1);
  });

  it('restHeal never overheals past playerHPMax', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterRestRoom(run);
    run = { ...run, playerHP: 25 };

    run = restHeal(run);

    expect(run.playerHP).toBe(run.playerHPMax);
  });

  it('restRemoveCard removes exactly the targeted card and proceeds to door-choice', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterRestRoom(run);
    const targetId = run.deck[0].id;
    const deckSizeBefore = run.deck.length;

    run = restRemoveCard(run, targetId);

    expect(run.deck.length).toBe(deckSizeBefore - 1);
    expect(run.deck.some((c) => c.id === targetId)).toBe(false);
    expect(run.phase).toBe('door-choice');
  });

  it('restRemoveCard rejects an id not in the deck, leaving the run in the rest phase', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterRestRoom(run);

    const rejected = restRemoveCard(run, 'not-a-real-card');
    expect(rejected).toBe(run);
    expect(rejected.phase).toBe('rest');
  });

  it('restHeal and restRemoveCard are both no-ops outside the rest phase', () => {
    const run = createNewRun(3);
    expect(restHeal(run)).toBe(run);
    expect(restRemoveCard(run, 'anything')).toBe(run);
  });
});
