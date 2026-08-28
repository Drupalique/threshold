import type { BranchRoot, Door, DoorColor, DoorTags } from '../types/door';
import type { PoolSizeBand, RoomInstance } from '../types/room';
import type { Rng } from './rng';
import { generateRoom, generateRestRoom } from './roomGenerator';
import { uniformPick } from './weightedPick';
import { SUIT_COLOR_FAMILY, DOOR_CORRELATION_RATE, REST_ROOM_RATIO, RUN_MAX_DEPTH } from '../config/constants';

let doorCounter = 0;

function flipSize(size: PoolSizeBand): PoolSizeBand {
  return size === 'small' ? 'large' : 'small';
}
function flipColor(color: DoorColor): DoorColor {
  return color === 'red' ? 'blue' : 'red';
}

/**
 * The "true" size/color a door's tags are rolled against (see
 * generateDoorPair below). A rest room has no table/threat-suit identity to
 * correlate against, so its tags are pure uncorrelated noise -- the same
 * fallback an untyped-suit combat room's color already gets -- rather than
 * a reliable "this door is safe" tell. Distinguishing rest from combat at
 * the door screen is a possible follow-up, not implemented here.
 */
function trueTagsForRoom(room: RoomInstance, rng: Rng): DoorTags {
  if (room.kind === 'rest') {
    return { size: uniformPick(rng, ['small', 'large']), color: uniformPick(rng, ['red', 'blue']) };
  }
  return {
    size: room.params.sizeBand,
    color: SUIT_COLOR_FAMILY[room.params.primarySuit] ?? uniformPick(rng, ['red', 'blue']),
  };
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
    // The elite floor (floor >= RUN_MAX_DEPTH) is always the guaranteed
    // solo boss fight (config/enemies.ts's isElite, roomGenerator's
    // pickEnemies) -- never a rest room, so the roll is skipped entirely
    // once floor reaches the run's last room.
    const room: RoomInstance =
      floor < RUN_MAX_DEPTH && rng.next() < REST_ROOM_RATIO ? generateRestRoom() : generateRoom(rng, floor);
    const branchRoot: BranchRoot = { id: `branch-${room.id}`, depth: 1, room };

    const trueTags = trueTagsForRoom(room, rng);
    const size = rng.next() < DOOR_CORRELATION_RATE ? trueTags.size : flipSize(trueTags.size);
    const color = rng.next() < DOOR_CORRELATION_RATE ? trueTags.color : flipColor(trueTags.color);

    doors.push({
      id: `door-${doorCounter++}`,
      tags: { size, color },
      branchRootId: branchRoot.id,
    });
    branchRoots.push(branchRoot);
  }

  return { doors, branchRoots };
}
