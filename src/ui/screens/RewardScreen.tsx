import { useRun } from '../../state/runContextObject';
import { CardChip } from '../components/CardChip';

export function RewardScreen() {
  const { state, chooseReward, skipReward } = useRun();
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
      {/* Screen-level pass, not a per-card decline -- every reward on offer
          here is optional, and this is the one exit once you've taken
          whatever (if anything) you want. See runEngine.ts's skipReward. */}
      <button type="button" className="reward-pass-button" onClick={skipReward}>
        Pass
      </button>
      <p className="reward-deck-size">Deck size: {state.deck.length}</p>
    </div>
  );
}
