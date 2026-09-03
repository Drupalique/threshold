import type { Card, CreatureCard } from '../../types/cards';
import { SUIT_DEFINITIONS, QUAKE_BONUS_PLAYS, SHOP_TRANSFORM_PRICE, SHOP_DUPLICATE_PRICE, SHOP_UPGRADE_PRICE } from '../../config/constants';
import { specialCardsBySuit, riderDescription } from '../../config/specialCards';
import { specialCard } from '../../config/cardHelpers';
import { POTION_DEFS } from '../../config/potions';
import { RELIC_DEFS } from '../../config/relics';
import { DECK_ACTION_INFO } from '../../config/deckActions';
import type { DeckActionKind } from '../../types/run';
import { CardFace } from '../components/CardChip';
import { cardChipStyle, cardChipTitle } from '../cardDisplay';
import { suitIcon } from '../suitIcons';

const DECK_ACTION_PRICE: Record<DeckActionKind, number> = {
  transform: SHOP_TRANSFORM_PRICE,
  duplicate: SHOP_DUPLICATE_PRICE,
  upgrade: SHOP_UPGRADE_PRICE,
};

// Read-only card display, same span-not-button shape as EnemyPanel's
// StaticCardChip (nothing here is clickable), but widened to cover the
// Quake/Cleave kinds too since this is the only place both suited cards and
// the two suitless utility cards are shown side by side.
function StaticCard({ card }: { card: Card }) {
  if (card.kind === 'quake') {
    return <span className="card-chip card-chip--quake card-chip--static">Quake</span>;
  }
  if (card.kind === 'cleave') {
    return <span className="card-chip card-chip--cleave card-chip--static">Cleave</span>;
  }
  const classes = ['card-chip', 'card-chip--static', card.specialId ? 'card-chip--special' : ''].filter(Boolean).join(' ');
  return (
    <span className={classes} style={cardChipStyle(card)} title={cardChipTitle(card)}>
      <CardFace card={card} />
    </span>
  );
}

/**
 * Dev-only reference listing of every item the game can hand a player --
 * every suit's plain card and named specials (config/specialCards.ts), the
 * two suitless utility cards (Quake/Cleave), every potion (config/
 * potions.ts), every relic (config/relics.ts), and the three shop-only deck
 * actions (config/deckActions.ts) -- so the full catalog can be reviewed at
 * a glance instead of hunting through reward/shop RNG for it. Reads static
 * config defs only, not RunState, so it's available from any phase.
 */
export function CompendiumScreen() {
  return (
    <div className="compendium-screen">
      <h2>Item compendium (dev)</h2>

      <section className="compendium-section">
        <h3>Suits &amp; cards</h3>
        <div className="compendium-grid">
          {SUIT_DEFINITIONS.map((suitDef) => {
            const plainCard: CreatureCard = { id: `compendium-plain-${suitDef.id}`, kind: 'creature', suit: suitDef.id };
            const specials = specialCardsBySuit(suitDef.id);
            return (
              <div key={suitDef.id} className="compendium-group">
                <div className="compendium-group-header">
                  <span aria-hidden="true">{suitIcon(suitDef.id)}</span>
                  <span>{suitDef.name}</span>
                  <span className="compendium-group-category">{suitDef.category}</span>
                </div>
                <div className="compendium-item-row">
                  <StaticCard card={plainCard} />
                  <p className="compendium-item-desc">Plain -- no rider, just the suit's base points.</p>
                </div>
                {specials.map((def) => (
                  <div className="compendium-item-row" key={def.id}>
                    <StaticCard card={specialCard(def, 'compendium')} />
                    <p className="compendium-item-desc">
                      <strong>{def.name}</strong> -- {def.description}
                    </p>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      <section className="compendium-section">
        <h3>Utility cards</h3>
        <div className="compendium-group">
          <div className="compendium-item-row">
            <StaticCard card={{ id: 'compendium-quake', kind: 'quake' }} />
            <p className="compendium-item-desc">Quake -- Grants {QUAKE_BONUS_PLAYS} bonus plays this turn.</p>
          </div>
          <div className="compendium-item-row">
            <StaticCard card={{ id: 'compendium-cleave', kind: 'cleave' }} />
            <p className="compendium-item-desc">Cleave -- The next threat play this turn hits every alive enemy.</p>
          </div>
        </div>
      </section>

      <section className="compendium-section">
        <h3>Potions</h3>
        <ul className="compendium-list">
          {POTION_DEFS.map((potion) => (
            <li key={potion.id}>
              <strong>{potion.name}</strong> -- {potion.description}
            </li>
          ))}
        </ul>
      </section>

      <section className="compendium-section">
        <h3>Relics</h3>
        <ul className="compendium-list">
          {RELIC_DEFS.map((relic) => (
            <li key={relic.id}>
              <strong>{relic.name}</strong> -- {relic.description}
            </li>
          ))}
        </ul>
      </section>

      <section className="compendium-section">
        <h3>Shop actions</h3>
        <ul className="compendium-list">
          {(Object.keys(DECK_ACTION_INFO) as DeckActionKind[]).map((kind) => (
            <li key={kind}>
              <strong>{DECK_ACTION_INFO[kind].name}</strong> ({DECK_ACTION_PRICE[kind]} currency) -- {DECK_ACTION_INFO[kind].description}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
