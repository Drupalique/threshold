import type { Card } from '../../types/cards';
import { SUIT_DEFINITIONS } from '../../config/constants';

interface CardChipProps {
  card: Card;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function CardChip({ card, selected, disabled, onClick }: CardChipProps) {
  const classes = [
    'card-chip',
    card.kind === 'quake' ? 'card-chip--quake' : '',
    selected ? 'card-chip--selected' : '',
    onClick && !disabled ? 'card-chip--clickable' : '',
    disabled ? 'card-chip--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (card.kind === 'quake') {
    return (
      <button type="button" className={classes} onClick={onClick} disabled={disabled || !onClick}>
        Quake
      </button>
    );
  }

  const suitDef = SUIT_DEFINITIONS.find((s) => s.id === card.suit)!;
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
