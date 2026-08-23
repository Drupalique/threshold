import { RunProvider } from './state/RunContext';
import { useRun } from './state/runContextObject';
import { StartScreen } from './ui/screens/StartScreen';
import { CombatScreen } from './ui/screens/CombatScreen';
import { RewardScreen } from './ui/screens/RewardScreen';
import { DoorChoiceScreen } from './ui/screens/DoorChoiceScreen';
import { RunEndScreen } from './ui/screens/RunEndScreen';
import './ui/styles.css';

function Router() {
  const { state } = useRun();
  switch (state.phase) {
    case 'start':
      return <StartScreen />;
    case 'combat':
      return <CombatScreen />;
    case 'reward':
      return <RewardScreen />;
    case 'door-choice':
      return <DoorChoiceScreen />;
    case 'run-complete':
    case 'run-over':
      return <RunEndScreen />;
  }
}

function App() {
  return (
    <RunProvider>
      <div className="app-shell">
        <Router />
      </div>
    </RunProvider>
  );
}

export default App;
