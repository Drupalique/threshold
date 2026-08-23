import type { Card } from '../../types/cards';
import { CardChip } from './CardChip';

interface HandDisplayProps {
  hand: Card[];
  selectedIds: Set<string>;
  disabled: boolean;
  onCardClick: (card: Card) => void;
  drawPileCount: number;
  discardPileCount: number;
}

export function HandDisplay({ hand, selectedIds, disabled, onCardClick, drawPileCount, discardPileCount }: HandDisplayProps) {
  return (
    <div className="hand-display">
      <div className="hand-display-header">
        <h3>Your Hand</h3>
        <span className="hand-pile-counts">
          Draw {drawPileCount} / Discard {discardPileCount}
        </span>
      </div>
      <div className="hand-cards">
        {hand.map((card) => (
          <CardChip
            key={card.id}
            card={card}
            selected={selectedIds.has(card.id)}
            disabled={disabled}
            onClick={() => onCardClick(card)}
          />
        ))}
        {hand.length === 0 && <div className="hand-empty">No cards left.</div>}
      </div>
    </div>
  );
}
