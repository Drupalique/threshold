import type { SuitId } from '../types/suits';

/**
 * One glyph per suit, shown on every card of that suit regardless of
 * whether it's a plain card or one of its named specials (config/
 * specialCards.ts) -- the same wolf icon marks a card as Wolf-suited whether
 * it's named "Wolf" or "Alpha Wolf", so anything scoped to a suit (a relic,
 * a highlighted table pile) is visibly "all the cards with this icon," not
 * something a player has to infer from names alone. Shared by CardChip's
 * CardFace (hand/table/reward/shrine/shop chips), EnemyPanel's
 * StaticCardChip, TableDisplay's per-suit group labels, and PotionControls'
 * suit picker -- every place a suit is named to the player.
 *
 * Picked to avoid the glyphs already used for rider bonus badges
 * (ui/riderIcons.ts's dagger/shield) and status badges (EnemyPanel's
 * STATUS_ICON skull/biohazard/flexed-bicep), so a card's suit icon, its
 * rider badge, and any status badge on screen at once never repeat the same
 * symbol.
 */
const SUIT_ICON: Record<SuitId, string> = {
  wolf: '🐺',
  ember: '🔥',
  rot: '🦴',
  spider: '🕷️',
  grace: '🕊️',
  ward: '🏰',
  hex: '🔮',
  venom: '🐍',
  vigor: '⚡',
};

export function suitIcon(suit: SuitId): string {
  return SUIT_ICON[suit];
}
