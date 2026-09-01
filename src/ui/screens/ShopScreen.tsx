import { useRun } from '../../state/runContextObject';
import { CardChip } from '../components/CardChip';

/**
 * A currency shop stop -- unlike RewardScreen/ShrineScreen's exclusive
 * pick-1, any number of the offered slots can be bought in one visit (each
 * click both spends currency and removes that slot from the list), then
 * Leave proceeds to the next door choice. See runEngine.ts's
 * buyShopOption/leaveShop.
 */
export function ShopScreen() {
  const { state, buyShopOption, leaveShop } = useRun();
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
          const item = option.optionType === 'relic' ? option.relic : option.potion;
          return (
            <div key={option.id} className={className} onClick={buy}>
              <h3>{item.name}</h3>
              <p>{item.description}</p>
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
