import type { RiderEffect } from '../types/specialCards';
import { STATUS_ICON } from './statusIcons';

// At-a-glance icon for a rider's kind -- shared by CardChip (hand/reward
// cards) and EnemyPanel's StaticCardChip (enemy hands) so both read the same
// way. Dagger for damage, shield for guard. bonus-status has no single icon
// of its own -- it borrows whichever status it names from EnemyPanel's own
// STATUS_ICON badges, so a rider and the stack it applies read identically.
const RIDER_ICON: Record<Exclude<RiderEffect['kind'], 'bonus-status'>, string> = {
  'bonus-damage': '🗡️',
  'bonus-guard': '🛡️',
  'bonus-damage-aoe': '💥',
};

export function riderBadgeText(rider: RiderEffect): string {
  const icon = rider.kind === 'bonus-status' ? STATUS_ICON[rider.statusId] : RIDER_ICON[rider.kind];
  return `${icon}${rider.amount}`;
}
