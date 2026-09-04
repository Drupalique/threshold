import { useRun } from '../../state/runContextObject';
import { CardChip } from '../components/CardChip';
import { RelicChip, PotionChip } from '../components/RewardItemChip';

/**
 * A reward offer, laid out as one row per populated field of RewardOffer
 * (types/run.ts) -- a card row (always REWARD_CARD_COUNT choices when a card
 * is on offer at all, an exclusive pick-one), and an independent relic row/
 * potion row, each click-to-claim on its own (runEngine.ts's chooseReward/
 * claimRewardRelic/claimRewardPotion) without ending the visit. Continue
 * proceeds to door generation with whatever's been claimed so far -- see
 * runEngine.ts's skipReward. A shrine's relic-only stop (types/room.ts's
 * ShrineRoomInstance) renders through this exact same screen: it's just an
 * offer with an empty cardOptions and only its relic row populated, not a
 * separate phase/screen.
 */
export function RewardScreen() {
  const { state, chooseReward, claimRewardRelic, claimRewardPotion, skipReward } = useRun();
  const offer = state.rewardOffer ?? { cardOptions: [], relic: null, potion: null };
  const hasCards = offer.cardOptions.length > 0;
  const isEmpty = !hasCards && !offer.relic && !offer.potion;

  return (
    <div className="reward-screen">
      <h2>{hasCards ? `Room ${state.depth} cleared -- choose your reward` : `Room ${state.depth} -- a shrine offers a relic`}</h2>

      {hasCards && (
        <section className="reward-row">
          <h3 className="reward-row-label">Card</h3>
          <div className="reward-row-items">
            {offer.cardOptions.map((card) => (
              <div key={card.id} className="reward-choice">
                <CardChip card={card} onClick={() => chooseReward(card.id)} />
              </div>
            ))}
          </div>
        </section>
      )}

      {offer.relic && (
        <section className="reward-row">
          <h3 className="reward-row-label">Relic</h3>
          <div className="reward-row-items">
            <RelicChip relic={offer.relic} onClick={claimRewardRelic} />
          </div>
        </section>
      )}

      {offer.potion && (
        <section className="reward-row">
          <h3 className="reward-row-label">Potion</h3>
          <div className="reward-row-items">
            <PotionChip potion={offer.potion} onClick={claimRewardPotion} />
          </div>
        </section>
      )}

      {isEmpty && <p className="reward-empty">Nothing here.</p>}

      {/* Screen-level "I'm done" exit, not a per-row decline -- each row
          above is already independently click-to-claim. See
          runEngine.ts's skipReward. */}
      <button type="button" className="reward-continue-button" onClick={skipReward}>
        Continue
      </button>
      <p className="reward-deck-size">Deck size: {state.deck.length}</p>
    </div>
  );
}
