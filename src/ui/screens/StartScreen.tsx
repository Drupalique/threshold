import { useRun } from '../../state/runContextObject';

export function StartScreen() {
  const { startRun } = useRun();
  return (
    <div className="start-screen">
      <h1>THRESHOLD</h1>
      <p className="tagline">A descent through one-way doors and dueling hands.</p>
      <button type="button" className="primary-button" onClick={startRun}>
        Begin Descent
      </button>
    </div>
  );
}
