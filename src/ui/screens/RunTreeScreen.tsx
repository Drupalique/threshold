import { useRun } from '../../state/runContextObject';
import { RunTreeView } from '../components/RunTreeView';

/**
 * Dev-only view of the entire run tree (see engine/runTree.ts's
 * buildRunTree) -- every room this seed could ever produce, not just the
 * path taken, with the current location highlighted. Available from the
 * 'start' phase onward since the tree is built once, up front, in
 * createNewRun.
 */
export function RunTreeScreen() {
  const { state } = useRun();
  return (
    <div className="run-tree-screen">
      <div className="run-tree-screen-header">
        <h2>Run tree -- seed {state.seed}</h2>
        <div className="run-tree-legend">
          <span className="run-tree-legend-item">
            <span className="run-tree-swatch run-tree-swatch--combat" /> Combat
          </span>
          <span className="run-tree-legend-item">
            <span className="run-tree-swatch run-tree-swatch--rest" /> Rest
          </span>
          <span className="run-tree-legend-item">
            <span className="run-tree-swatch run-tree-swatch--current" /> Current path
          </span>
        </div>
      </div>
      <RunTreeView tree={state.runTree} rootPath="" currentPath={state.currentPath} className="run-tree-view--full" />
    </div>
  );
}
