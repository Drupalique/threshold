import { useRun } from '../../state/runContextObject';
import { DoorCard } from '../components/DoorCard';

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
    </div>
  );
}
