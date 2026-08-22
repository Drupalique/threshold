import type { Card } from '../../types/cards';
import { CardChip } from './CardChip';

interface RoomHandIndicatorProps {
  count: number;
  // Set briefly when the room claims a set -- the specific hand cards it
  // just committed, shown face-up so the claim reads the same way a
  // player's own claim does, instead of vanishing invisibly from behind
  // the face-down count.
  revealedCards?: Card[];
}

// Normally shows only a count of face-down cards, never contents --
// preserving the "did I get out-raced" tension the room's hand is meant to
// create. `revealedCards` is the deliberate, brief exception: it surfaces
// exactly the cards just spent on a claim, not the rest of the hand.
export function RoomHandIndicator({ count, revealedCards }: RoomHandIndicatorProps) {
  const hasRevealed = !!revealedCards && revealedCards.length > 0;
  return (
    <div className="room-hand-indicator">
      <h3>Room's Hand</h3>
      <div className="room-hand-cards">
        {revealedCards?.map((card) => (
          <CardChip key={card.id} card={card} claimed />
        ))}
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="card-chip card-chip--facedown" />
        ))}
        {count === 0 && !hasRevealed && <div className="hand-empty">Empty.</div>}
      </div>
    </div>
  );
}
