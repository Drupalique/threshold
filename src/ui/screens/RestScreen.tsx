import { useRun } from '../../state/runContextObject';
import { CardChip } from '../components/CardChip';
import { MeterBar } from '../components/MeterBar';
import { REST_HEAL_PCT } from '../../config/constants';

/**
 * A campfire/fairy's-cave rest stop -- exactly two mutually exclusive
 * options, StS-style: rest (heal) or remove a card from the deck. Neither
 * grants a card reward on top (see runEngine.ts's finishRestRoom) --
 * clicking either one resolves the room immediately and proceeds to the
 * next door choice, same one-click-commits pattern RewardScreen already
 * uses for picking a card.
 */
export function RestScreen() {
  const { state, restHeal, restRemoveCard } = useRun();
  const healAmount = Math.round(state.playerHPMax * REST_HEAL_PCT);
  const atFullHP = state.playerHP >= state.playerHPMax;

  return (
    <div className="rest-screen">
      <h2>Room {state.depth + 1} -- a place to rest</h2>
      <MeterBar label="HP" value={state.playerHP} max={state.playerHPMax} color="#e74c3c" />

      <div className="rest-options">
        <div className="rest-option">
          <h3>Rest</h3>
          <p>Restore {healAmount} HP.</p>
          {/* Still clickable at full HP -- it just leaves the room with no
              effect, the same "legal but wasteful" choice StS allows,
              rather than forcing a card removal on a player who doesn't
              want one. */}
          <button type="button" onClick={restHeal}>
            {atFullHP ? 'Rest (already at full HP)' : `Rest (+${healAmount} HP)`}
          </button>
        </div>

        <div className="rest-option">
          <h3>Remove a card</h3>
          <p>Permanently remove one card from your deck.</p>
          <div className="rest-deck-grid">
            {state.deck.map((card) => (
              <CardChip key={card.id} card={card} onClick={() => restRemoveCard(card.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
