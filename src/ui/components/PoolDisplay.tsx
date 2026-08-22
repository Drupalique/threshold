import type { Card } from '../../types/cards';
import type { SuitId } from '../../types/suits';
import { SUIT_DEFINITIONS, MIN_POOL_SET_SIZE, DECAY_TURNS_N } from '../../config/constants';
import { CardChip } from './CardChip';

interface PoolDisplayProps {
  pool: Card[];
  blockedSuits: Partial<Record<SuitId, number>>;
  decayCounters: Partial<Record<SuitId, number>>;
  highlightSuit: SuitId | null;
  // Set briefly right after the room claims a set. Those pool cards are
  // already gone from `pool` by the time this renders (the claim removes
  // them in the same update), so this is a snapshot to redraw the set as a
  // fading "just claimed" group instead of it silently disappearing.
  claimReveal?: { suit: SuitId; cards: Card[] } | null;
}

export function PoolDisplay({ pool, blockedSuits, decayCounters, highlightSuit, claimReveal }: PoolDisplayProps) {
  const groups = new Map<SuitId, Card[]>();
  for (const card of pool) {
    if (card.kind !== 'creature') continue;
    if (!groups.has(card.suit)) groups.set(card.suit, []);
    groups.get(card.suit)!.push(card);
  }

  const suitOrder = SUIT_DEFINITIONS.map((s) => s.id).filter((id) => groups.has(id));

  return (
    <div className="pool-display">
      <h3>Pool</h3>
      <div className="pool-groups">
        {suitOrder.map((suit) => {
          const cards = groups.get(suit)!;
          const isLive = cards.length >= MIN_POOL_SET_SIZE;
          const isBlocked = (blockedSuits[suit] ?? 0) > 0;
          const isHighlighted = highlightSuit === suit;
          // A single-card "set" or a blocked suit can be selected in hand but
          // is never actually claimable -- give it a distinct, clearly-not-a-
          // match style instead of the same highlight a live set gets, so the
          // disabled Claim button doesn't look inconsistent with the pool.
          const isClaimableHighlight = isHighlighted && isLive && !isBlocked;
          const isUnclaimableHighlight = isHighlighted && (!isLive || isBlocked);
          // Any live suit ticks toward decay whether or not it's currently
          // claimable (blocking restricts claiming, not decay eligibility).
          const turnsUntilDecay = isLive ? DECAY_TURNS_N - (decayCounters[suit] ?? 0) : null;
          return (
            <div
              key={suit}
              className={[
                'pool-group',
                isLive ? 'pool-group--live' : '',
                isBlocked ? 'pool-group--blocked' : '',
                isClaimableHighlight ? 'pool-group--highlighted' : '',
                isUnclaimableHighlight ? 'pool-group--highlighted-invalid' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="pool-group-label">
                {SUIT_DEFINITIONS.find((s) => s.id === suit)!.name} x{cards.length}
                {isBlocked && <span className="pool-group-blocked-tag"> blocked</span>}
                {!isLive && <span className="pool-group-toosmall-tag"> (need {MIN_POOL_SET_SIZE}+)</span>}
                {turnsUntilDecay !== null && (
                  <span
                    className={
                      'pool-group-decay-tag' +
                      (turnsUntilDecay <= 1 ? ' pool-group-decay-tag--urgent' : '')
                    }
                  >
                    {' '}
                    decays in {turnsUntilDecay}
                  </span>
                )}
              </div>
              <div className="pool-group-cards">
                {cards.map((c) => (
                  <CardChip key={c.id} card={c} />
                ))}
              </div>
            </div>
          );
        })}
        {claimReveal && !groups.has(claimReveal.suit) && (
          <div className="pool-group pool-group--claimed-reveal">
            <div className="pool-group-label">
              {SUIT_DEFINITIONS.find((s) => s.id === claimReveal.suit)!.name} x{claimReveal.cards.length}
              <span className="pool-group-claimed-tag"> claimed by room</span>
            </div>
            <div className="pool-group-cards">
              {claimReveal.cards.map((c) => (
                <CardChip key={c.id} card={c} claimed />
              ))}
            </div>
          </div>
        )}
        {pool.filter((c) => c.kind === 'surprise').length > 0 && (
          <div className="pool-group">
            <div className="pool-group-cards">
              {pool
                .filter((c) => c.kind === 'surprise')
                .map((c) => (
                  <CardChip key={c.id} card={c} />
                ))}
            </div>
          </div>
        )}
        {pool.length === 0 && <div className="pool-empty">Pool is empty.</div>}
      </div>
    </div>
  );
}
