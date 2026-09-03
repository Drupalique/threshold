import { useState } from 'react';
import { RunProvider } from './state/RunContext';
import { useRun } from './state/runContextObject';
import { StartScreen } from './ui/screens/StartScreen';
import { CombatScreen } from './ui/screens/CombatScreen';
import { RestScreen } from './ui/screens/RestScreen';
import { ShrineScreen } from './ui/screens/ShrineScreen';
import { ShopScreen } from './ui/screens/ShopScreen';
import { RewardScreen } from './ui/screens/RewardScreen';
import { DoorChoiceScreen } from './ui/screens/DoorChoiceScreen';
import { RunEndScreen } from './ui/screens/RunEndScreen';
import { RunTreeScreen } from './ui/screens/RunTreeScreen';
import { CompendiumScreen } from './ui/screens/CompendiumScreen';
import { useLogPlayback } from './ui/hooks/useLogPlayback';
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
    case 'shrine':
      return <ShrineScreen />;
    case 'shop':
      return <ShopScreen />;
    case 'reward':
      return <RewardScreen />;
    case 'door-choice':
      return <DoorChoiceScreen />;
    case 'run-complete':
    case 'run-over':
      return <RunEndScreen />;
  }
}

// Turn number / whose-turn / plays-remaining, lifted out of CombatScreen and
// into the top bar so it no longer eats a full-width row of vertical space
// above the enemies -- that's the whole point of moving it here. Reads the
// same combat log via its own useLogPlayback instance rather than plumbing
// CombatScreen's isPlaying through props/context; both instances drip the
// same log on the same schedule, so they never disagree.
function CombatTopBarStatus() {
  const { state } = useRun();
  const combat = state.combat;
  const { isPlaying } = useLogPlayback(combat?.log ?? []);
  if (state.phase !== 'combat' || !combat) return null;

  const isPlayerTurn = combat.activeTurn === 'player' && combat.status === 'active';

  return (
    <div
      className={[
        'topbar-turn-status',
        combat.status === 'player-dead' ? 'topbar-turn-status--dead' : '',
        combat.status === 'room-cleared' ? 'topbar-turn-status--cleared' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {combat.status === 'player-dead' && 'You have fallen...'}
      {combat.status === 'room-cleared' && 'Room cleared!'}
      {combat.status === 'active' &&
        `Turn ${combat.turnNumber} -- ${isPlaying ? 'Resolving...' : isPlayerTurn ? 'Your turn' : "Enemies' turn"}`}
      {combat.status === 'active' && isPlayerTurn && !isPlaying && (
        <span className="combat-plays-remaining">
          {` -- ${combat.playsRemaining} play${combat.playsRemaining === 1 ? '' : 's'} left`}
        </span>
      )}
      {/* Live during combat since claim-overflow currency (see
          combatEngine.ts's applyCurrencyOverflow) is earned mid-fight, not
          just at a shop -- surfacing it here lets a player see it tick up
          as it happens. */}
      <span className="topbar-currency">{` -- ${combat.currency} currency`}</span>
    </div>
  );
}

type Tab = 'game' | 'tree' | 'items';

function App() {
  const [tab, setTab] = useState<Tab>('game');
  return (
    <RunProvider>
      <div className={tab === 'game' ? 'app-shell' : 'app-shell app-shell--full'}>
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
          <button
            type="button"
            className={tab === 'items' ? 'tab-button tab-button--active' : 'tab-button'}
            onClick={() => setTab('items')}
          >
            Items (dev)
          </button>
          <CombatTopBarStatus />
        </div>
        {tab === 'game' && <Router />}
        {tab === 'tree' && <RunTreeScreen />}
        {tab === 'items' && <CompendiumScreen />}
      </div>
    </RunProvider>
  );
}

export default App;
