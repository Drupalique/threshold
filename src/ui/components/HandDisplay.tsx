import type { Card } from '../../types/cards';
import { CardChip } from './CardChip';

interface HandDisplayProps {
  hand: Card[];
  selectedIds: Set<string>;
  disabled: boolean;
  onCardClick: (card: Card) => void;
}

export function HandDisplay({ hand, selectedIds, disabled, onCardClick }: HandDisplayProps) {
  return (
    <div className="hand-display">
      <h3>Your Hand</h3>
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
