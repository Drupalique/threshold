import { describe, it, expect } from 'vitest';
import { createNewRun, startFirstRoom, resolveCombatEnd, chooseReward, chooseDoor } from '../runEngine';
import type { RunState } from '../../types/run';

function clearCurrentRoom(run: RunState): RunState {
  return { ...run, combat: { ...run.combat!, enemies: [], status: 'room-cleared' } };
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

    run = chooseDoor(run, run.currentDoors![0].id);
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

  it('skips the reward step entirely when the cleared room was the run\'s last one', () => {
    let run = createNewRun(2);
    run = startFirstRoom(run);
    run = { ...run, depth: run.maxDepth - 1 };
    run = resolveCombatEnd(clearCurrentRoom(run));

    expect(run.phase).toBe('run-complete');
    expect(run.rewardOptions).toBeNull();
  });
});
