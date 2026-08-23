import { useRun } from '../../state/runContextObject';
import { CardChip } from '../components/CardChip';

export function RewardScreen() {
  const { state, chooseReward } = useRun();
  const options = state.rewardOptions ?? [];

  return (
    <div className="reward-screen">
      <h2>Room {state.depth} cleared -- choose a card for your deck</h2>
      <div className="reward-choices">
        {options.map((card) => (
          <div key={card.id} className="reward-choice">
            <CardChip card={card} onClick={() => chooseReward(card.id)} />
          </div>
        ))}
      </div>
      <p className="reward-deck-size">Deck size: {state.deck.length}</p>
    </div>
  );
}
