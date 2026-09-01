import { useRun } from '../../state/runContextObject';

/**
 * A relic-offer stop -- one-click-commits pattern shared with
 * RewardScreen/RestScreen: click a relic to take it (chooseRelic), or Pass
 * to leave with nothing (skipShrine). See types/room.ts's ShrineRoomInstance
 * for why the options themselves are generated live (runEngine.ts's
 * chooseDoor) instead of being fixed by the run tree like a rest room is.
 */
export function ShrineScreen() {
  const { state, chooseRelic, skipShrine } = useRun();
  const options = state.shrineOptions ?? [];

  return (
    <div className="shrine-screen">
      <h2>Room {state.depth + 1} -- a shrine offers a relic</h2>
      <div className="shrine-choices">
        {options.map((relic) => (
          <div key={relic.id} className="shrine-choice" onClick={() => chooseRelic(relic.id)}>
            <h3>{relic.name}</h3>
            <p>{relic.description}</p>
          </div>
        ))}
      </div>
      <button type="button" className="shrine-pass-button" onClick={skipShrine}>
        Pass
      </button>
    </div>
  );
}
