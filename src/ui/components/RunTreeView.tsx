import { useLayoutEffect, useMemo, useRef } from 'react';
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

function buildHierData(tree: RunTree, path: string): HierData {
  const node = tree.nodes[path];
  return {
    path,
    children: node.doors?.map((d) => buildHierData(tree, d.childPath)),
  };
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
function computeLayout(tree: RunTree, rootPath: string): Layout | null {
  const rootNode = tree.nodes[rootPath];
  if (!rootNode) return null;

  const root = hierarchy(buildHierData(tree, rootPath), (d) => d.children);
  const layout = d3TreeLayout<HierData>().nodeSize([LEAF_SPACING, LEVEL_SPACING]);
  layout(root);

  const descendants = root.descendants() as HierarchyPointNode<HierData>[];
  const minX = Math.min(...descendants.map((d) => d.x));
  const maxX = Math.max(...descendants.map((d) => d.x));
  const maxLevel = root.height; // every leaf sits at the same depth (perfect binary tree)

  const toScreenX = (x: number) => x - minX + LABEL_GUTTER + PADDING;
  const toScreenY = (depth: number) => (maxLevel - depth) * LEVEL_SPACING + PADDING;

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
    width: maxX - minX + LABEL_GUTTER + PADDING * 2,
    height: maxLevel * LEVEL_SPACING + PADDING * 2,
  };
}

export interface RunTreeViewProps {
  tree: RunTree;
  /** Path of the node to root this view's subtree at -- '' for the whole run tree. */
  rootPath: string;
  /** When set, highlights this path's ancestor chain (and itself) as "where the player is", and is what the view centers on. Omit to center on rootPath instead (e.g. an unresolved door preview). */
  currentPath?: string;
  className?: string;
}

export function RunTreeView({ tree, rootPath, currentPath, className }: RunTreeViewProps) {
  const layout = useMemo(() => computeLayout(tree, rootPath), [tree, rootPath]);
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
    <div ref={scrollRef} className={['run-tree-view', className].filter(Boolean).join(' ')}>
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
          const classes = [
            'run-tree-node',
            `run-tree-node--${node.room.kind}`,
            onPath ? 'run-tree-node--on-path' : '',
            isCurrent ? 'run-tree-node--current' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div
              key={n.path}
              className={classes}
              style={{ left: n.x, top: n.y }}
              title={summary.detail.join('\n')}
            />
          );
        })}
      </div>
    </div>
  );
}
