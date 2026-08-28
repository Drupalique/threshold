import { describe, it, expect } from 'vitest';
import { createRng } from '../rng';
import { generateDoorPair } from '../doorGenerator';
import { RUN_MAX_DEPTH } from '../../config/constants';

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
      if (match!.room.kind === 'combat') {
        expect(match!.room.params.tableDealSize).toBeGreaterThan(0);
      }
    }
  });

  it('tag correlation rate is roughly DOOR_CORRELATION_RATE over many rolls, for combat rooms', () => {
    const rng = createRng(123);
    let matches = 0;
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const { doors, branchRoots } = generateDoorPair(rng, 5);
      for (const door of doors) {
        const room = branchRoots.find((b) => b.id === door.branchRootId)!.room;
        // A rest room's tags are deliberately uncorrelated noise (see
        // doorGenerator.ts's trueTagsForRoom) -- only combat rooms should
        // track DOOR_CORRELATION_RATE.
        if (room.kind !== 'combat') continue;
        total++;
        if (door.tags.size === room.params.sizeBand) matches++;
      }
    }
    const rate = matches / total;
    expect(rate).toBeGreaterThan(0.6);
    expect(rate).toBeLessThan(0.9);
  });

  it('can produce rest rooms below the final floor, but never on or past RUN_MAX_DEPTH', () => {
    const rng = createRng(1);
    let sawRest = false;
    for (let floor = 2; floor < RUN_MAX_DEPTH; floor++) {
      const { branchRoots } = generateDoorPair(rng, floor);
      for (const br of branchRoots) {
        if (br.room.kind === 'rest') sawRest = true;
      }
    }
    expect(sawRest).toBe(true);

    for (let seed = 1; seed <= 50; seed++) {
      const finalRng = createRng(seed);
      const { branchRoots } = generateDoorPair(finalRng, RUN_MAX_DEPTH);
      for (const br of branchRoots) {
        expect(br.room.kind).toBe('combat');
      }
    }
  });
});
