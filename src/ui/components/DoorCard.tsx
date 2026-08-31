import type { Door } from '../../types/door';
import type { RunTree } from '../../types/runTree';
import { DOOR_COLOR_HEX } from '../doorColors';
import { RunTreeView } from './RunTreeView';

interface DoorCardProps {
  door: Door;
  tree: RunTree;
  onChoose: () => void;
}

/**
 * Not a single <button> (unlike before) -- it now embeds RunTreeView, whose
 * nodes are their own hoverable/titled elements, so nesting the whole card
 * in one interactive element would be invalid HTML (same constraint noted
 * in EnemyPanel.tsx). The tag header is flavor/eventual-abstraction-target
 * (see GAME_DESIGN.md); the tree preview below it is today's full reveal --
 * the entire remaining run down this door, spoiled on purpose.
 */
export function DoorCard({ door, tree, onChoose }: DoorCardProps) {
  return (
    <div className="door-card">
      <div className="door-card-visual" style={{ background: DOOR_COLOR_HEX[door.tags.color] }} />
      <div className="door-card-tags">
        <div>Size: {door.tags.size}</div>
        <div>Color: {door.tags.color}</div>
      </div>
      <RunTreeView tree={tree} rootPath={door.childPath} className="door-card-tree" />
      <button type="button" className="door-card-choose" onClick={onChoose}>
        Choose this door
      </button>
    </div>
  );
}
