import type { DoorTags } from './door';
import type { RoomInstance } from './room';

/** One of a node's two door options -- points at the deterministic child node it leads to. */
export interface TreeDoorRef {
  tags: DoorTags;
  childPath: string;
}

/**
 * One room in the fully precomputed run tree (engine/runTree.ts). `path` is
 * `''` for the floor-1 root, else a string of '0'/'1' characters, one per
 * door transition taken from the root -- the same path a RunState's
 * `currentPath` advances along as doors are chosen. `doors` is null once
 * `floor === maxDepth` (the guaranteed boss floor never offers a door).
 */
export interface RunTreeNode {
  path: string;
  floor: number;
  room: RoomInstance;
  doors: [TreeDoorRef, TreeDoorRef] | null;
}

/**
 * The entire run's branching structure, built once from the seed
 * (buildRunTree) and held for the run's whole lifetime -- every node this
 * run could ever reach, not just the path actually taken, so dev tooling
 * can show the whole thing at once (see ui/screens/RunTreeScreen.tsx).
 */
export interface RunTree {
  seed: number;
  maxDepth: number;
  nodes: Record<string, RunTreeNode>;
}
