import type { Door } from '../../types/door';
import type { RunTree } from '../../types/runTree';
import { DOOR_TREE_VIEW_MAX_DEPTH, DOOR_TREE_VIEW_SCALE } from '../../config/constants';
import { DOOR_COLOR_HEX } from '../doorColors';
import { RunTreeView, type RunTreeSelectableNode } from './RunTreeView';

interface DoorTreeChoiceProps {
  tree: RunTree;
  /** The just-cleared room -- rendered greyed out as the graph's root, both doors branching up from it. */
  completedPath: string;
  doors: Door[];
  onChoose: (doorId: string) => void;
}

/**
 * Alternative to DoorCard's two-separate-previews layout (see
 * DoorChoiceScreen.tsx's layout toggle): one RunTreeView rooted at the just-
 * cleared room, both doors' subtrees drawn as a single connected graph
 * instead of two side-by-side spoilers, truncated at DOOR_TREE_VIEW_MAX_DEPTH
 * floors so it stays legible regardless of how deep into the run this is.
 * The door nodes themselves (immediate children of completedPath) are the
 * click targets; the swatch buttons below are a same-effect, easier-to-hit
 * alternative for the same click.
 */
export function DoorTreeChoice({ tree, completedPath, doors, onChoose }: DoorTreeChoiceProps) {
  const selectableNodes: RunTreeSelectableNode[] = doors.map((door) => ({
    path: door.childPath,
    color: DOOR_COLOR_HEX[door.tags.color],
    onSelect: () => onChoose(door.id),
  }));

  return (
    <div className="door-tree-choice">
      <RunTreeView
        tree={tree}
        rootPath={completedPath}
        dimPath={completedPath}
        maxDepth={DOOR_TREE_VIEW_MAX_DEPTH}
        selectableNodes={selectableNodes}
        scale={DOOR_TREE_VIEW_SCALE}
        className="door-tree-choice-view"
      />
      <div className="door-tree-choice-options">
        {doors.map((door) => (
          <button
            key={door.id}
            type="button"
            className="door-tree-choice-option"
            style={{ borderColor: DOOR_COLOR_HEX[door.tags.color] }}
            onClick={() => onChoose(door.id)}
          >
            <span className="door-tree-choice-swatch" style={{ background: DOOR_COLOR_HEX[door.tags.color] }} />
            Size: {door.tags.size}, Color: {door.tags.color}
          </button>
        ))}
      </div>
    </div>
  );
}
