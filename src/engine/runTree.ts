import type { DoorColor, DoorTags } from '../types/door';
import type { PoolSizeBand, RoomInstance } from '../types/room';
import type { RunTree, RunTreeNode, TreeDoorRef } from '../types/runTree';
import type { Rng } from './rng';
import { createNodeRng } from './rng';
import { generateRoom, generateRestRoom, generateShrineRoom } from './roomGenerator';
import { uniformPick, weightedPick } from './weightedPick';
import {
  SUIT_COLOR_FAMILY,
  DOOR_CORRELATION_RATE,
  REST_ROOM_RATIO,
  SHRINE_ROOM_RATIO,
  RUN_MAX_DEPTH,
} from '../config/constants';

function flipSize(size: PoolSizeBand): PoolSizeBand {
  return size === 'small' ? 'large' : 'small';
}
function flipColor(color: DoorColor): DoorColor {
  return color === 'red' ? 'blue' : 'red';
}

/**
 * The "true" size/color a door's tags are rolled against (see buildNode
 * below). A rest room has no table/threat-suit identity to correlate
 * against, so its tags are pure uncorrelated noise -- the same fallback an
 * untyped-suit combat room's color already gets -- rather than a reliable
 * "this door is safe" tell. Distinguishing rest from combat at the door
 * screen is a possible follow-up, not implemented here.
 */
function trueTagsForRoom(room: RoomInstance, rng: Rng): DoorTags {
  if (room.kind === 'rest' || room.kind === 'shrine') {
    return { size: uniformPick(rng, ['small', 'large']), color: uniformPick(rng, ['red', 'blue']) };
  }
  return {
    size: room.params.sizeBand,
    color: SUIT_COLOR_FAMILY[room.params.primarySuit] ?? uniformPick(rng, ['red', 'blue']),
  };
}

/**
 * Builds the entire run tree from the seed, eagerly -- every node this run
 * could ever reach, not just the path actually taken. With the default
 * maxDepth (RUN_MAX_DEPTH = 10) that's a perfect binary tree of 1023 nodes
 * (floor 1 root, doubling through floors 2..10), cheap to build up front.
 *
 * Each node's own randomness comes from `createNodeRng(seed, path)` -- a
 * deterministic stream keyed only by the node's location in the tree, never
 * the shared sequential `run.rng` combat/rewards consume. That's the whole
 * point: the tree a seed produces can't be perturbed by how a fight played
 * out on the way to it. Room ids are path-derived for the same reason (see
 * roomGenerator.ts) -- two builds of the same seed are fully identical, ids
 * included, not just structurally consistent within one build.
 */
export function buildRunTree(seed: number, maxDepth: number = RUN_MAX_DEPTH): RunTree {
  const nodes: Record<string, RunTreeNode> = {};

  function buildDoors(parentPath: string, parentFloor: number): [TreeDoorRef, TreeDoorRef] {
    const childFloor = parentFloor + 1;
    const refs: TreeDoorRef[] = [];

    for (const branch of ['0', '1'] as const) {
      const childPath = parentPath + branch;
      const nodeRng = createNodeRng(seed, childPath);

      // The elite floor (childFloor >= RUN_MAX_DEPTH) is always the
      // guaranteed solo boss fight -- never a rest/shrine room, so the roll
      // is skipped entirely once childFloor reaches the run's last room.
      type RoomKind = 'rest' | 'shrine' | 'combat';
      const roomKind: RoomKind =
        childFloor < maxDepth
          ? weightedPick<RoomKind>(nodeRng, [
              { weight: REST_ROOM_RATIO, value: 'rest' },
              { weight: SHRINE_ROOM_RATIO, value: 'shrine' },
              { weight: 1 - REST_ROOM_RATIO - SHRINE_ROOM_RATIO, value: 'combat' },
            ])
          : 'combat';
      const room: RoomInstance =
        roomKind === 'rest'
          ? generateRestRoom(childPath)
          : roomKind === 'shrine'
            ? generateShrineRoom(childPath)
            : generateRoom(nodeRng, childFloor, childPath);

      const trueTags = trueTagsForRoom(room, nodeRng);
      const tags: DoorTags = {
        size: nodeRng.next() < DOOR_CORRELATION_RATE ? trueTags.size : flipSize(trueTags.size),
        color: nodeRng.next() < DOOR_CORRELATION_RATE ? trueTags.color : flipColor(trueTags.color),
      };
      refs.push({ tags, childPath });

      nodes[childPath] = {
        path: childPath,
        floor: childFloor,
        room,
        doors: childFloor < maxDepth ? buildDoors(childPath, childFloor) : null,
      };
    }

    return refs as [TreeDoorRef, TreeDoorRef];
  }

  const rootRng = createNodeRng(seed, '');
  const rootRoom = generateRoom(rootRng, 1, 'root');
  nodes[''] = {
    path: '',
    floor: 1,
    room: rootRoom,
    doors: maxDepth > 1 ? buildDoors('', 1) : null,
  };

  return { seed, maxDepth, nodes };
}
