import { useState } from 'react';
import { useRun } from '../../state/runContextObject';
import { DoorCard } from '../components/DoorCard';
import { DoorTreeChoice } from '../components/DoorTreeChoice';
import { TurnLogFeed } from '../components/TurnLogFeed';

type Layout = 'tree' | 'cards';

export function DoorChoiceScreen() {
  const { state, chooseDoor } = useRun();
  // 'tree' (one combined graph, depth-limited) is the layout under trial;
  // 'cards' is the original per-door full-subtree preview (DoorCard.tsx),
  // kept selectable rather than removed.
  const [layout, setLayout] = useState<Layout>('tree');

  return (
    <div className="door-choice-screen">
      <h2>Room {state.depth} cleared -- choose a door</h2>
      <div className="door-choice-layout-toggle">
        <button
          type="button"
          className={layout === 'tree' ? 'door-choice-layout-button door-choice-layout-button--active' : 'door-choice-layout-button'}
          onClick={() => setLayout('tree')}
        >
          Tree
        </button>
        <button
          type="button"
          className={layout === 'cards' ? 'door-choice-layout-button door-choice-layout-button--active' : 'door-choice-layout-button'}
          onClick={() => setLayout('cards')}
        >
          Cards
        </button>
      </div>
      {layout === 'tree' ? (
        <DoorTreeChoice
          tree={state.runTree}
          completedPath={state.currentPath}
          doors={state.currentDoors!}
          onChoose={chooseDoor}
        />
      ) : (
        <div className="door-choices">
          {state.currentDoors!.map((door) => (
            <DoorCard key={door.id} door={door} tree={state.runTree} onChoose={() => chooseDoor(door.id)} />
          ))}
        </div>
      )}
      {/* The just-cleared room's combat state is still sitting in run.combat
          at this point -- chooseDoor doesn't replace it until a door is
          actually picked -- so its full log is available to review here,
          giving the player time to read it before committing to a door. */}
      {state.combat && (
        <div className="door-choice-log">
          <TurnLogFeed log={state.combat.log} />
        </div>
      )}
    </div>
  );
}
