import { describe, it, expect } from 'vitest';
import { buildRunTree } from '../runTree';
import { createNewRun, startFirstRoom, resolveCombatEnd, skipReward } from '../runEngine';
import type { RunState } from '../../types/run';
import { RUN_MAX_DEPTH } from '../../config/constants';

function clearCurrentRoom(run: RunState): RunState {
  return { ...run, combat: { ...run.combat!, enemies: [], status: 'room-cleared' } };
}

describe('run tree determinism', () => {
  it('building the same seed twice yields structurally identical trees, ids included', () => {
    const a = buildRunTree(777);
    const b = buildRunTree(777);
    expect(a).toEqual(b);
  });

  it('different seeds produce different trees', () => {
    const a = buildRunTree(1);
    const b = buildRunTree(2);
    expect(a).not.toEqual(b);
  });

  it('the doors offered after clearing a room are unaffected by how much unrelated RNG (combat) was consumed clearing it', () => {
    const seed = 555;
    const tree = buildRunTree(seed);

    function afterClearingFirstRoom(rngBurn: number): RunState {
      let run = createNewRun(seed);
      run = startFirstRoom(run);
      // Simulate combat consuming a different amount of RNG on the way to
      // clearing the room -- the whole point of the fix is that this can't
      // change which rooms/doors show up next.
      for (let i = 0; i < rngBurn; i++) run.rng.next();
      run = resolveCombatEnd(clearCurrentRoom(run));
      run = skipReward(run);
      return run;
    }

    const light = afterClearingFirstRoom(0);
    const heavy = afterClearingFirstRoom(500);

    expect(light.currentDoors).toEqual(heavy.currentDoors);
    expect(light.currentDoors![0].childPath).toBe(tree.nodes[''].doors![0].childPath);
    expect(light.currentDoors![0].tags).toEqual(tree.nodes[''].doors![0].tags);
    expect(light.currentDoors![1].childPath).toBe(tree.nodes[''].doors![1].childPath);
    expect(light.currentDoors![1].tags).toEqual(tree.nodes[''].doors![1].tags);
  });
});

describe('run tree structure', () => {
  it('tag correlation rate is roughly DOOR_CORRELATION_RATE over the whole tree, for combat rooms', () => {
    const tree = buildRunTree(123);
    let matches = 0;
    let total = 0;
    for (const node of Object.values(tree.nodes)) {
      if (!node.doors) continue;
      for (const doorRef of node.doors) {
        const childRoom = tree.nodes[doorRef.childPath].room;
        if (childRoom.kind !== 'combat') continue;
        total++;
        if (doorRef.tags.size === childRoom.params.sizeBand) matches++;
      }
    }
    const rate = matches / total;
    expect(rate).toBeGreaterThan(0.6);
    expect(rate).toBeLessThan(0.9);
  });

  it('rest rooms can appear before RUN_MAX_DEPTH, but never at or after it', () => {
    let sawRest = false;
    for (let seed = 1; seed <= 20; seed++) {
      const tree = buildRunTree(seed);
      for (const node of Object.values(tree.nodes)) {
        if (node.floor < RUN_MAX_DEPTH && node.room.kind === 'rest') sawRest = true;
        if (node.floor >= RUN_MAX_DEPTH) expect(node.room.kind).toBe('combat');
      }
    }
    expect(sawRest).toBe(true);
  });

  it('every non-terminal node has exactly two doors, and the terminal (floor === maxDepth) nodes have none', () => {
    const tree = buildRunTree(42);
    for (const node of Object.values(tree.nodes)) {
      if (node.floor === tree.maxDepth) {
        expect(node.doors).toBeNull();
      } else {
        expect(node.doors).not.toBeNull();
        expect(node.doors!.length).toBe(2);
        expect(node.doors![0].childPath).toBe(node.path + '0');
        expect(node.doors![1].childPath).toBe(node.path + '1');
      }
    }
    // Perfect binary tree: floor 1 root + floors 2..10 doubling = 2^10 - 1 nodes.
    expect(Object.keys(tree.nodes).length).toBe(2 ** tree.maxDepth - 1);
  });
});
