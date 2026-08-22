import type { Card } from '../../types/cards';
import { SUIT_DEFINITIONS } from '../../config/constants';

interface CardChipProps {
  card: Card;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function CardChip({ card, selected, disabled, onClick }: CardChipProps) {
  const suitDef = SUIT_DEFINITIONS.find((s) => s.id === card.suit)!;
  const classes = [
    'card-chip',
    selected ? 'card-chip--selected' : '',
    onClick && !disabled ? 'card-chip--clickable' : '',
    disabled ? 'card-chip--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      style={{ background: suitDef.displayColor }}
      onClick={onClick}
      disabled={disabled || !onClick}
    >
      {suitDef.name}
    </button>
  );
}
