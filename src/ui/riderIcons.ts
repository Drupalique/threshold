import type { RiderEffect } from '../types/specialCards';

// At-a-glance icon for a rider's kind -- shared by CardChip (hand/reward
// cards) and EnemyPanel's StaticCardChip (enemy hands) so both read the same
// way. Dagger for damage, shield for guard, mirroring EnemyPanel's existing
// STATUS_ICON emoji-badge pattern.
const RIDER_ICON: Record<RiderEffect['kind'], string> = {
  'bonus-damage': '🗡️',
  'bonus-guard': '🛡️',
  'bonus-damage-aoe': '💥',
};

export function riderBadgeText(rider: RiderEffect): string {
  return `${RIDER_ICON[rider.kind]}${rider.amount}`;
}
