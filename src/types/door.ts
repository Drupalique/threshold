import type { RoomInstance } from './room';
import type { PoolSizeBand } from './room';

export type DoorColor = 'red' | 'blue';
export type DoorTexture = 'smooth' | 'jagged';

export interface DoorTags {
  size: PoolSizeBand;
  color: DoorColor;
  texture: DoorTexture;
}

/**
 * A branch root only ever has depth 1 in the prototype, but doors reference
 * it by id (never embed a RoomInstance directly) so a future multi-depth
 * subtree/convergent-node system can be added without touching this shape.
 */
export interface BranchRoot {
  id: string;
  depth: 1;
  room: RoomInstance;
}

export interface Door {
  id: string;
  tags: DoorTags;
  branchRootId: string;
}
