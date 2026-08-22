import type { Card } from '../../types/cards';
import { SUIT_DEFINITIONS } from '../../config/constants';

interface CardChipProps {
  card: Card;
  selected?: boolean;
  claimed?: boolean;
  disabled?: boolean;
  faceDown?: boolean;
  onClick?: () => void;
}

export function CardChip({ card, selected, claimed, disabled, faceDown, onClick }: CardChipProps) {
  if (faceDown) {
    return <div className="card-chip card-chip--facedown" />;
  }

  if (card.kind === 'surprise') {
    return <div className="card-chip card-chip--surprise">?</div>;
  }

  const suitDef = SUIT_DEFINITIONS.find((s) => s.id === card.suit)!;
  const classes = [
    'card-chip',
    selected ? 'card-chip--selected' : '',
    claimed ? 'card-chip--claimed' : '',
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
