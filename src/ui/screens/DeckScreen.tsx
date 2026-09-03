import type { Card } from '../../types/cards';
import { isCreatureCard } from '../../types/cards';
import { useRun } from '../../state/runContextObject';
import { SUIT_DEFINITIONS } from '../../config/constants';
import { CardChip } from '../components/CardChip';
import { suitIcon } from '../suitIcons';

// Groups the run deck by suit (in SUIT_DEFINITIONS order, same as the rest of
// the UI) with the two suitless utility cards bucketed last -- unlike
// RestScreen's rest-deck-grid (a flat, unsorted click-to-remove list), this
// view exists purely to show the player their whole deck at a glance, so it's
// worth the extra grouping/sorting pass.
function groupDeck(deck: Card[]): { key: string; label: string; icon: string | null; cards: Card[] }[] {
  const groups: { key: string; label: string; icon: string | null; cards: Card[] }[] = SUIT_DEFINITIONS.map((s) => ({
    key: s.id,
    label: s.name,
    icon: suitIcon(s.id),
    cards: [],
  }));
  const bySuit = new Map(groups.map((g) => [g.key, g]));
  const utility: Card[] = [];

  for (const card of deck) {
    if (isCreatureCard(card)) {
      bySuit.get(card.suit)!.cards.push(card);
    } else {
      utility.push(card);
    }
  }

  if (utility.length > 0) {
    groups.push({ key: 'utility', label: 'Utility', icon: null, cards: utility });
  }

  return groups.filter((g) => g.cards.length > 0);
}

/**
 * Player-facing tab: the run-persistent deck (RunState.deck, grouped by
 * suit), held relics, held potions (grouped by kind, mirroring
 * PotionControls' counting), and current currency -- everything a player
 * accumulates across a run in one read-only reference view. Unlike
 * CompendiumScreen (dev-only, reads static config for every item the game
 * *could* hand out), this reads RunState for what's actually been picked up
 * so far.
 */
export function DeckScreen() {
  const { state } = useRun();
  const deckGroups = groupDeck(state.deck);

  const potionCounts = new Map<string, { name: string; description: string; count: number }>();
  for (const p of state.potions) {
    const entry = potionCounts.get(p.kind);
    if (entry) entry.count++;
    else potionCounts.set(p.kind, { name: p.name, description: p.description, count: 1 });
  }

  return (
    <div className="deck-screen">
      <div className="deck-screen-header">
        <h2>Deck &amp; Inventory</h2>
      </div>

      <section className="deck-screen-section">
        <h3>Deck ({state.deck.length} cards)</h3>
        <div className="deck-screen-groups">
          {deckGroups.map((group) => (
            <div key={group.key} className="deck-screen-group">
              <div className="deck-screen-group-header">
                {group.icon && <span aria-hidden="true">{group.icon}</span>}
                <span>{group.label}</span>
                <span className="deck-screen-group-count">x{group.cards.length}</span>
              </div>
              <div className="deck-screen-group-cards">
                {group.cards.map((card) => (
                  <CardChip key={card.id} card={card} />
                ))}
              </div>
            </div>
          ))}
          {state.deck.length === 0 && <p className="deck-screen-empty">No cards yet.</p>}
        </div>
      </section>

      <section className="deck-screen-section">
        <h3>Relics ({state.relics.length})</h3>
        {state.relics.length === 0 ? (
          <p className="deck-screen-empty">No relics yet.</p>
        ) : (
          <ul className="compendium-list">
            {state.relics.map((relic) => (
              <li key={relic.id}>
                <strong>{relic.name}</strong> -- {relic.description}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="deck-screen-section">
        <h3>Potions ({state.potions.length})</h3>
        {potionCounts.size === 0 ? (
          <p className="deck-screen-empty">No potions yet.</p>
        ) : (
          <ul className="compendium-list">
            {Array.from(potionCounts.values()).map((p) => (
              <li key={p.name}>
                <strong>{p.name}</strong> x{p.count} -- {p.description}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
