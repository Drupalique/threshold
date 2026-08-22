import { useRun } from '../../state/runContextObject';
import { DoorCard } from '../components/DoorCard';
import { TurnLogFeed } from '../components/TurnLogFeed';

export function DoorChoiceScreen() {
  const { state, chooseDoor } = useRun();
  return (
    <div className="door-choice-screen">
      <h2>Room {state.depth} cleared -- choose a door</h2>
      <div className="door-choices">
        {state.currentDoors!.map((door) => (
          <DoorCard key={door.id} door={door} onChoose={() => chooseDoor(door.id)} />
        ))}
      </div>
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
