import { describe, it, expect } from 'vitest';
import { createRng } from '../rng';
import { generateDoorPair } from '../doorGenerator';

describe('door generation', () => {
  it('produces 2 doors each referencing a distinct branch root by id (never embedding room data)', () => {
    const rng = createRng(42);
    const { doors, branchRoots } = generateDoorPair(rng, 5);
    expect(doors.length).toBe(2);
    expect(branchRoots.length).toBe(2);
    for (const door of doors) {
      expect(typeof door.branchRootId).toBe('string');
      const match = branchRoots.find((b) => b.id === door.branchRootId);
      expect(match).toBeDefined();
      expect(match!.depth).toBe(1);
      expect(match!.room.params.tableDealSize).toBeGreaterThan(0);
    }
  });

  it('tag correlation rate is roughly DOOR_CORRELATION_RATE over many rolls', () => {
    const rng = createRng(123);
    let matches = 0;
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const { doors, branchRoots } = generateDoorPair(rng, 5);
      for (const door of doors) {
        const room = branchRoots.find((b) => b.id === door.branchRootId)!.room;
        total++;
        if (door.tags.size === room.params.sizeBand) matches++;
      }
    }
    const rate = matches / total;
    expect(rate).toBeGreaterThan(0.6);
    expect(rate).toBeLessThan(0.9);
  });
});
