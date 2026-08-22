import type { BranchRoot, Door, DoorColor, DoorTexture } from '../types/door';
import type { PoolSizeBand } from '../types/room';
import type { Rng } from './rng';
import { generateRoom } from './roomGenerator';
import { uniformPick } from './weightedPick';
import { enemyDefById } from '../config/enemies';
import { SUIT_COLOR_FAMILY, DOOR_CORRELATION_RATE } from '../config/constants';

let doorCounter = 0;

function flipSize(size: PoolSizeBand): PoolSizeBand {
  return size === 'small' ? 'large' : 'small';
}
function flipColor(color: DoorColor): DoorColor {
  return color === 'red' ? 'blue' : 'red';
}
function flipTexture(texture: DoorTexture): DoorTexture {
  return texture === 'smooth' ? 'jagged' : 'smooth';
}

/**
 * Generates both candidate next rooms up front and wraps each in a
 * BranchRoot that the returned Door references by id -- doors never embed
 * room data inline, per the design doc's 5.3 data-model requirement, so a
 * future multi-depth/convergent-node system can be layered on without a
 * rewrite (see types/door.ts).
 *
 * Each tag axis is rolled independently against DOOR_CORRELATION_RATE: a
 * real probabilistic roll against the generated room, not flavor text.
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
    // "Jagged" now reads as "a pool-manipulating enemy lurks here" -- the
    // Corrupt intent's flavor took over the role the old random surprise
    // card used to play for this tag.
    const trueTexture: DoorTexture = room.enemies.some((e) =>
      enemyDefById(e.defId).pattern.some((step) => step.type === 'corrupt'),
    )
      ? 'jagged'
      : 'smooth';

    const size = rng.next() < DOOR_CORRELATION_RATE ? trueSize : flipSize(trueSize);
    const color = rng.next() < DOOR_CORRELATION_RATE ? trueColor : flipColor(trueColor);
    const texture = rng.next() < DOOR_CORRELATION_RATE ? trueTexture : flipTexture(trueTexture);

    doors.push({
      id: `door-${doorCounter++}`,
      tags: { size, color, texture },
      branchRootId: branchRoot.id,
    });
    branchRoots.push(branchRoot);
  }

  return { doors, branchRoots };
}
