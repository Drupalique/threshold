import { useState } from 'react';
import { RunProvider } from './state/RunContext';
import { useRun } from './state/runContextObject';
import { StartScreen } from './ui/screens/StartScreen';
import { CombatScreen } from './ui/screens/CombatScreen';
import { RestScreen } from './ui/screens/RestScreen';
import { RewardScreen } from './ui/screens/RewardScreen';
import { DoorChoiceScreen } from './ui/screens/DoorChoiceScreen';
import { RunEndScreen } from './ui/screens/RunEndScreen';
import { RunTreeScreen } from './ui/screens/RunTreeScreen';
import './ui/styles.css';

function Router() {
  const { state } = useRun();
  switch (state.phase) {
    case 'start':
      return <StartScreen />;
    case 'combat':
      return <CombatScreen />;
    case 'rest':
      return <RestScreen />;
    case 'reward':
      return <RewardScreen />;
    case 'door-choice':
      return <DoorChoiceScreen />;
    case 'run-complete':
    case 'run-over':
      return <RunEndScreen />;
  }
}

type Tab = 'game' | 'tree';

function App() {
  const [tab, setTab] = useState<Tab>('game');
  return (
    <RunProvider>
      <div className={tab === 'tree' ? 'app-shell app-shell--full' : 'app-shell'}>
        <div className="tab-bar">
          <button
            type="button"
            className={tab === 'game' ? 'tab-button tab-button--active' : 'tab-button'}
            onClick={() => setTab('game')}
          >
            Game
          </button>
          <button
            type="button"
            className={tab === 'tree' ? 'tab-button tab-button--active' : 'tab-button'}
            onClick={() => setTab('tree')}
          >
            Tree (dev)
          </button>
        </div>
        {tab === 'game' ? <Router /> : <RunTreeScreen />}
      </div>
    </RunProvider>
  );
}

export default App;
