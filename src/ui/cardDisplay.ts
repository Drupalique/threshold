import type { CSSProperties } from 'react';
import type { CreatureCard } from '../types/cards';
import { SUIT_DEFINITIONS } from '../config/constants';
import { specialCardById, riderForCard, riderDescription } from '../config/specialCards';

// Shared by CardChip's clickable <button> and EnemyPanel's non-interactive
// <span> so a card reads identically everywhere it's shown -- suit color,
// special-card gold border, name, and its rider badge. Split out of
// CardChip.tsx (a component file) since react-refresh only allows a file to
// export components.
export function cardChipStyle(card: CreatureCard): CSSProperties {
  const suitDef = SUIT_DEFINITIONS.find((s) => s.id === card.suit)!;
  return { background: suitDef.displayColor };
}

export function cardChipTitle(card: CreatureCard): string {
  const suitDef = SUIT_DEFINITIONS.find((s) => s.id === card.suit)!;
  const specialDef = card.specialId ? specialCardById(card.specialId) : undefined;
  if (specialDef) return `${specialDef.name} (${suitDef.name}) -- ${specialDef.description}`;
  const rider = riderForCard(card, suitDef.category);
  return `${suitDef.name} -- ${riderDescription(rider)}`;
}
