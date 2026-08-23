import type { Card, CreatureCard } from '../../types/cards';
import { isCreatureCard } from '../../types/cards';
import type { SuitId } from '../../types/suits';
import { SUIT_DEFINITIONS, MIN_POOL_SET_SIZE, DECAY_TURNS_N } from '../../config/constants';
import { CardChip } from './CardChip';

interface PoolDisplayProps {
  pool: Card[];
  blockedSuits: Partial<Record<SuitId, number>>;
  decayCounters: Partial<Record<SuitId, number>>;
  highlightSuit: SuitId | null;
}

// Piles are grouped by suit alone -- a pile isn't owned by any one enemy
// (design doc 4.8), so there's exactly one group per suit present, and a
// claim against it can be aimed at any alive enemy regardless of which
// suits are on the table. The pool never actually contains a Quake card
// (it's a hand-only draw -- see types/cards.ts) but its type is still the
// shared Card union, hence the isCreatureCard narrowing below.
export function PoolDisplay({ pool, blockedSuits, decayCounters, highlightSuit }: PoolDisplayProps) {
  const groups = new Map<SuitId, CreatureCard[]>();
  for (const card of pool) {
    if (!isCreatureCard(card)) continue;
    if (!groups.has(card.suit)) groups.set(card.suit, []);
    groups.get(card.suit)!.push(card);
  }

  const orderedSuits = SUIT_DEFINITIONS.map((s) => s.id).filter((suitId) => groups.has(suitId));

  return (
    <div className="pool-display">
      <h3>Pool</h3>
      <div className="pool-groups">
        {orderedSuits.map((suitId) => {
          const cards = groups.get(suitId)!;
          const isLive = cards.length >= MIN_POOL_SET_SIZE;
          const isBlocked = (blockedSuits[suitId] ?? 0) > 0;
          const isHighlighted = highlightSuit === suitId;
          const isClaimableHighlight = isHighlighted && isLive && !isBlocked;
          const isUnclaimableHighlight = isHighlighted && (!isLive || isBlocked);
          const turnsUntilDecay = isLive ? DECAY_TURNS_N - (decayCounters[suitId] ?? 0) : null;
          const label = SUIT_DEFINITIONS.find((s) => s.id === suitId)!.name;

          return (
            <div
              key={suitId}
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
                {label} x{cards.length}
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
        {pool.length === 0 && <div className="pool-empty">Pool is empty.</div>}
      </div>
    </div>
  );
}
