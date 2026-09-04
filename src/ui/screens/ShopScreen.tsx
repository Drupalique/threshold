import { useRun } from '../../state/runContextObject';
import { CardChip } from '../components/CardChip';
import { RelicChip, PotionChip } from '../components/RewardItemChip';
import { DECK_ACTION_INFO } from '../../config/deckActions';

/**
 * A currency shop stop -- unlike RewardScreen's exclusive card row, any
 * number of the offered slots can be bought in one visit (each click both
 * spends currency and removes that slot from the list), then Leave proceeds
 * to the next door choice. See runEngine.ts's
 * buyShopOption/leaveShop. Buying a deck-action slot (Transform/Duplicate/
 * Upgrade) doesn't apply anything immediately -- it sets
 * state.pendingDeckAction, which swaps this screen over to a card-picker
 * (the same rest-deck-grid/CardChip pattern RestScreen.tsx's "Remove a
 * card" option already uses) until resolveDeckAction is called.
 */
export function ShopScreen() {
  const { state, buyShopOption, resolveDeckAction, leaveShop } = useRun();

  if (state.pendingDeckAction) {
    const { action } = state.pendingDeckAction;
    const eligible = state.deck.filter((c) => c.kind === 'creature' && (action !== 'upgrade' || !c.specialId));
    return (
      <div className="shop-screen">
        <h2>Room {state.depth + 1} -- a shop</h2>
        <p>{DECK_ACTION_INFO[action].pickPrompt}</p>
        <div className="rest-deck-grid">
          {eligible.map((card) => (
            <CardChip key={card.id} card={card} onClick={() => resolveDeckAction(card.id)} />
          ))}
        </div>
      </div>
    );
  }

  const options = state.shopOptions ?? [];

  return (
    <div className="shop-screen">
      <h2>Room {state.depth + 1} -- a shop</h2>
      <p className="shop-currency">Currency: {state.currency}</p>
      <div className="shop-choices">
        {options.map((option) => {
          const affordable = state.currency >= option.price;
          const className = `shop-choice${affordable ? '' : ' shop-choice--disabled'}`;
          const buy = () => affordable && buyShopOption(option.id);

          if (option.optionType === 'card') {
            return (
              <div key={option.id} className={className}>
                <CardChip card={option.card} disabled={!affordable} onClick={buy} />
                <p className="shop-price">{option.price} currency</p>
              </div>
            );
          }
          if (option.optionType === 'relic') {
            return (
              <div key={option.id} className={className}>
                <RelicChip relic={option.relic} onClick={buy} />
                <p className="shop-price">{option.price} currency</p>
              </div>
            );
          }
          if (option.optionType === 'potion') {
            return (
              <div key={option.id} className={className}>
                <PotionChip potion={option.potion} onClick={buy} />
                <p className="shop-price">{option.price} currency</p>
              </div>
            );
          }
          const deckAction = DECK_ACTION_INFO[option.action];
          return (
            <div key={option.id} className={className} onClick={buy}>
              <h3>{deckAction.name}</h3>
              <p>{deckAction.description}</p>
              <p className="shop-price">{option.price} currency</p>
            </div>
          );
        })}
        {options.length === 0 && <p className="shop-empty">Nothing left to buy.</p>}
      </div>
      <button type="button" className="shop-leave-button" onClick={leaveShop}>
        Leave
      </button>
    </div>
  );
}
