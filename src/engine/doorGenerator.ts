import type { BranchRoot, Door, DoorColor } from '../types/door';
import type { PoolSizeBand } from '../types/room';
import type { Rng } from './rng';
import { generateRoom } from './roomGenerator';
import { uniformPick } from './weightedPick';
import { SUIT_COLOR_FAMILY, DOOR_CORRELATION_RATE } from '../config/constants';

let doorCounter = 0;

function flipSize(size: PoolSizeBand): PoolSizeBand {
  return size === 'small' ? 'large' : 'small';
}
function flipColor(color: DoorColor): DoorColor {
  return color === 'red' ? 'blue' : 'red';
}

/**
 * Generates both candidate next rooms up front and wraps each in a
 * BranchRoot that the returned Door references by id -- doors never embed
 * room data inline, so a future multi-depth/convergent-node system can be
 * layered on without a rewrite (see types/door.ts).
 *
 * Each tag axis is rolled independently against DOOR_CORRELATION_RATE: a
 * real probabilistic roll against the generated room, not flavor text. The
 * old "texture" (smooth/jagged) axis was keyed off the enemy pattern's
 * Corrupt step, which the Earthquake-style rewrite removed entirely --
 * dropped rather than reinvented for a suit-play kit that doesn't have an
 * obvious analog.
 */
export function generateDoorPair(rng: Rng, floor: number): { doors: Door[]; branchRoots: BranchRoot[] } {
  const doors: Door[] = [];
  const branchRoots: BranchRoot[] = [];

  for (let i = 0; i < 2; i++) {
    const room = generateRoom(rng, floor);
    const branchRoot: BranchRoot = { id: `branch-${room.id}`, depth: 1, room };

    const trueSize: PoolSizeBand = room.params.sizeBand;
    const trueColor: DoorColor =
      SUIT_COLOR_FAMILY[room.params.primarySuit] ?? uniformPick(rng, ['red', 'blue']);

    const size = rng.next() < DOOR_CORRELATION_RATE ? trueSize : flipSize(trueSize);
    const color = rng.next() < DOOR_CORRELATION_RATE ? trueColor : flipColor(trueColor);

    doors.push({
      id: `door-${doorCounter++}`,
      tags: { size, color },
      branchRootId: branchRoot.id,
    });
    branchRoots.push(branchRoot);
  }

  return { doors, branchRoots };
}
