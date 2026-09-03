import type { StatusId } from '../types/status';

// Shared emoji badge per status -- used by EnemyPanel's StatusBadges (a
// holder's active stacks) and riderIcons' bonus-status badge (a card that
// applies stacks), so a status reads with the same icon whether it's already
// on a holder or about to be applied by a rider. Split out of EnemyPanel.tsx
// (a component file) so riderIcons.ts can import it without a
// CardChip <-> EnemyPanel <-> riderIcons import cycle.
export const STATUS_ICON: Record<StatusId, string> = {
  weaken: '☠',
  poison: '\u{2623}',
  strength: '\u{1F4AA}',
  vulnerable: '\u{1F494}',
  regen: '\u{1F49A}',
  haste: '\u{1F4A8}',
  slow: '\u{1F40C}',
};
