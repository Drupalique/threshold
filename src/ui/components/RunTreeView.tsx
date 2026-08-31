import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { hierarchy, tree as d3TreeLayout, type HierarchyPointNode } from 'd3-hierarchy';
import { linkVertical } from 'd3-shape';
import type { RunTree } from '../../types/runTree';
import { summarizeRoom } from '../roomSummary';

// Every node renders as a small color-coded dot (combat vs rest, see
// styles.css) -- room contents (enemy names, threat suits) live in the
// hover tooltip only, not inline, so a subtree with hundreds of nodes at
// floor 10 stays legible as a shape rather than a wall of text.
const LEAF_SPACING = 14; // horizontal gap between sibling leaves
const LEVEL_SPACING = 34; // vertical gap between floors
const LABEL_GUTTER = 24; // left margin reserved for "F3" row labels
const PADDING = 10;

interface HierData {
  path: string;
  children?: HierData[];
}

/** `remainingDepth` counts floors still to descend -- undefined means unlimited (today's full-reveal previews), 0 stops at this node (no children emitted, even if the room actually has doors). */
function buildHierData(tree: RunTree, path: string, remainingDepth?: number): HierData {
  const node = tree.nodes[path];
  const children =
    remainingDepth === 0
      ? undefined
      : node.doors?.map((d) => buildHierData(tree, d.childPath, remainingDepth === undefined ? undefined : remainingDepth - 1));
  return { path, children };
}

interface LayoutNode {
  path: string;
  x: number;
  y: number;
}
interface Layout {
  nodes: LayoutNode[];
  edgePaths: string[];
  rowLabels: { floor: number; y: number }[];
  positions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
}

/**
 * Vertical tree, root at the bottom, growing upward as floor increases --
 * d3-hierarchy's tree() does the actual Reingold-Tilford-style layout math
 * (siblings evenly spaced, parents centered over their children); we just
 * invert its top-down `y` into a bottom-up screen `y` and hand the same
 * point pairs to d3-shape's linkVertical() for the connecting curves. No
 * DOM measurement anywhere -- d3.tree()'s `nodeSize` mode gives fixed
 * per-level/per-leaf spacing regardless of how big the subtree is, so
 * layout is pure arithmetic from the tree data alone.
 */
function computeLayout(tree: RunTree, rootPath: string, maxDepth?: number, scale = 1): Layout | null {
  const rootNode = tree.nodes[rootPath];
  if (!rootNode) return null;

  const leafSpacing = LEAF_SPACING * scale;
  const levelSpacing = LEVEL_SPACING * scale;
  const labelGutter = LABEL_GUTTER * scale;
  const padding = PADDING * scale;

  const root = hierarchy(buildHierData(tree, rootPath, maxDepth), (d) => d.children);
  const layout = d3TreeLayout<HierData>().nodeSize([leafSpacing, levelSpacing]);
  layout(root);

  const descendants = root.descendants() as HierarchyPointNode<HierData>[];
  const minX = Math.min(...descendants.map((d) => d.x));
  const maxX = Math.max(...descendants.map((d) => d.x));
  const maxLevel = root.height; // every leaf sits at the same depth (perfect binary tree)

  const toScreenX = (x: number) => x - minX + labelGutter + padding;
  const toScreenY = (depth: number) => (maxLevel - depth) * levelSpacing + padding;

  const positions: Record<string, { x: number; y: number }> = {};
  const nodes: LayoutNode[] = descendants.map((d) => {
    const p = { x: toScreenX(d.x), y: toScreenY(d.depth) };
    positions[d.data.path] = p;
    return { path: d.data.path, ...p };
  });

  const linkGen = linkVertical<
    { source: { x: number; y: number }; target: { x: number; y: number } },
    { x: number; y: number }
  >()
    .x((p) => p.x)
    .y((p) => p.y);

  const edgePaths = root
    .links()
    .map((link) => linkGen({ source: positions[link.source.data.path], target: positions[link.target.data.path] }))
    .filter((d): d is string => d !== null);

  const rowLabels = Array.from({ length: maxLevel + 1 }, (_, level) => ({
    floor: rootNode.floor + level,
    y: toScreenY(level),
  }));

  return {
    nodes,
    edgePaths,
    rowLabels,
    positions,
    width: maxX - minX + labelGutter + padding * 2,
    height: maxLevel * levelSpacing + padding * 2,
  };
}

/** A node rendered as its own clickable choice (see ui/components/DoorTreeChoice.tsx) -- distinct from currentPath/dimPath, which are informational only. */
export interface RunTreeSelectableNode {
  path: string;
  /** Tints the node to match its door tag; falls back to the ordinary kind color when omitted. */
  color?: string;
  onSelect: () => void;
}

export interface RunTreeViewProps {
  tree: RunTree;
  /** Path of the node to root this view's subtree at -- '' for the whole run tree. */
  rootPath: string;
  /** When set, highlights this path's ancestor chain (and itself) as "where the player is", and is what the view centers on. Omit to center on rootPath instead (e.g. an unresolved door preview). */
  currentPath?: string;
  /** Renders this single node greyed out -- "already resolved," distinct from currentPath's "player is here now" glow. Typically rootPath itself, for a just-cleared room shown as the base of its remaining subtree. */
  dimPath?: string;
  /** How many floors below rootPath to render -- undefined renders the whole remaining subtree (today's full-reveal door/dev previews). */
  maxDepth?: number;
  /** Nodes that render as an enlarged, clickable choice -- e.g. the two doors leading out of dimPath. */
  selectableNodes?: RunTreeSelectableNode[];
  /** Uniformly scales node size, spacing, and label text -- 1 (default) matches the dev tab/door-card previews; a decision-focused view (e.g. DoorTreeChoice) can size up since its depth is capped and doesn't need to stay compact. */
  scale?: number;
  className?: string;
}

export function RunTreeView({
  tree,
  rootPath,
  currentPath,
  dimPath,
  maxDepth,
  selectableNodes,
  scale = 1,
  className,
}: RunTreeViewProps) {
  const layout = useMemo(() => computeLayout(tree, rootPath, maxDepth, scale), [tree, rootPath, maxDepth, scale]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Center the viewport on wherever's most relevant -- the current room if
  // we're tracking one, otherwise rootPath itself (always at the bottom of
  // the canvas) -- rather than defaulting to scrollTop/Left 0, which would
  // often land somewhere arbitrary on a wide/tall tree.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !layout) return;
    const target = (currentPath !== undefined && layout.positions[currentPath]) || layout.positions[rootPath];
    if (!target) return;
    el.scrollTop = Math.max(0, target.y - el.clientHeight / 2);
    el.scrollLeft = Math.max(0, target.x - el.clientWidth / 2);
  }, [layout, currentPath, rootPath]);

  if (!layout) return null;

  return (
    <div
      ref={scrollRef}
      className={['run-tree-view', className].filter(Boolean).join(' ')}
      style={{ '--rt-scale': scale } as CSSProperties}
    >
      <div className="run-tree-canvas" style={{ width: layout.width, height: layout.height }}>
        <svg className="run-tree-edges" width={layout.width} height={layout.height}>
          {layout.edgePaths.map((d, i) => (
            <path key={i} d={d} className="run-tree-edge" />
          ))}
        </svg>
        {layout.rowLabels.map((row) => (
          <div key={row.floor} className="run-tree-row-label" style={{ top: row.y }}>
            F{row.floor}
          </div>
        ))}
        {layout.nodes.map((n) => {
          const node = tree.nodes[n.path];
          const summary = summarizeRoom(node.room);
          const isCurrent = currentPath === n.path;
          const onPath = currentPath !== undefined && currentPath.startsWith(n.path);
          const isDimmed = dimPath === n.path;
          const selectable = selectableNodes?.find((s) => s.path === n.path);
          const classes = [
            'run-tree-node',
            `run-tree-node--${node.room.kind}`,
            onPath ? 'run-tree-node--on-path' : '',
            isCurrent ? 'run-tree-node--current' : '',
            isDimmed ? 'run-tree-node--dimmed' : '',
            selectable ? 'run-tree-node--selectable' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div
              key={n.path}
              className={classes}
              style={{ left: n.x, top: n.y, ...(selectable?.color ? { background: selectable.color } : {}) }}
              title={summary.detail.join('\n')}
              onClick={selectable?.onSelect}
            />
          );
        })}
      </div>
    </div>
  );
}
