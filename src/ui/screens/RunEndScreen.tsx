import { useRun } from '../../state/runContextObject';
import { TurnLogFeed } from '../components/TurnLogFeed';

export function RunEndScreen() {
  const { state, restart } = useRun();
  const won = state.phase === 'run-complete';
  return (
    <div className={`run-end-screen ${won ? 'run-end-screen--win' : 'run-end-screen--loss'}`}>
      <h2>{won ? `Run Complete -- ${state.depth}/${state.maxDepth} rooms cleared` : `You Fell -- Room ${state.depth} of ${state.maxDepth}`}</h2>
      <p>
        Final HP: {Math.max(0, Math.round(state.playerHP))} / {state.playerHPMax}
      </p>
      {state.combat && <TurnLogFeed log={state.combat.log} maxEntries={10} />}
      <button type="button" className="primary-button" onClick={restart}>
        New Run
      </button>
    </div>
  );
}
