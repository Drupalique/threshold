import type { Card, CreatureCard } from '../../types/cards';
import { SUIT_DEFINITIONS } from '../../config/constants';
import { specialCardById, riderForCard } from '../../config/specialCards';
import { riderBadgeText } from '../riderIcons';
import { suitIcon } from '../suitIcons';
import { cardChipStyle, cardChipTitle } from '../cardDisplay';

/**
 * A card's face: its suit icon (see ui/suitIcons.ts -- always the suit's
 * icon, never a per-special one, so a named special reads as "still this
 * suit" at a glance) above its name (special or suit) plus, unless
 * suppressed for a table-card display, its rider badge -- see CardChip's
 * showRider.
 */
export function CardFace({ card, showRider = true }: { card: CreatureCard; showRider?: boolean }) {
  const suitDef = SUIT_DEFINITIONS.find((s) => s.id === card.suit)!;
  const specialDef = card.specialId ? specialCardById(card.specialId) : undefined;
  const rider = riderForCard(card, suitDef.category);
  return (
    <>
      <span className="card-chip-icon" aria-hidden="true">{suitIcon(card.suit)}</span>
      <span className="card-chip-label">{specialDef ? specialDef.name : suitDef.name}</span>
      {showRider && <span className="card-chip-rider">{riderBadgeText(rider)}</span>}
    </>
  );
}

interface CardChipProps {
  card: Card;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  // Table cards structurally never carry a specialId (see CreatureCard's
  // doc comment) and their rider never fires from the table either -- only
  // a card actually played from a hand fires one (combatEngine's
  // applyRiders) -- so TableDisplay passes false here to keep table chips
  // reading as "simply suits," per design.
  showRider?: boolean;
}

export function CardChip({ card, selected, disabled, onClick, showRider = true }: CardChipProps) {
  const classes = [
    'card-chip',
    card.kind === 'quake' ? 'card-chip--quake' : '',
    card.kind === 'cleave' ? 'card-chip--cleave' : '',
    card.kind === 'creature' && card.specialId ? 'card-chip--special' : '',
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

  if (card.kind === 'cleave') {
    return (
      <button type="button" className={classes} onClick={onClick} disabled={disabled || !onClick}>
        Cleave
      </button>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      style={cardChipStyle(card)}
      onClick={onClick}
      disabled={disabled || !onClick}
      title={cardChipTitle(card)}
    >
      <CardFace card={card} showRider={showRider} />
    </button>
  );
}
