import type { Door } from '../../types/door';
import type { RunTree } from '../../types/runTree';
import { RunTreeView } from './RunTreeView';

interface DoorCardProps {
  door: Door;
  tree: RunTree;
  onChoose: () => void;
}

const COLOR_HEX: Record<string, string> = { red: '#c0392b', blue: '#2471a3' };

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
      <div className="door-card-visual" style={{ background: COLOR_HEX[door.tags.color] }} />
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
