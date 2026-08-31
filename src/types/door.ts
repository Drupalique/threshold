import type { PoolSizeBand } from './room';

export type DoorColor = 'red' | 'blue';

export interface DoorTags {
  size: PoolSizeBand;
  color: DoorColor;
}

/** References the run tree node (RunTree.nodes[childPath], see types/runTree.ts) this door leads to. */
export interface Door {
  id: string;
  tags: DoorTags;
  childPath: string;
}
