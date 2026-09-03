import type { RiderEffect } from '../types/specialCards';
import type { SuitCategory } from '../types/suits';
import { STATUS_ICON } from './statusIcons';

// At-a-glance icon for a rider's kind -- shared by CardChip (hand/reward
// cards) and EnemyPanel's StaticCardChip (enemy hands) so both read the same
// way. Dagger for damage, shield for guard. bonus-status has no single icon
// of its own -- it borrows whichever status it names from EnemyPanel's own
// STATUS_ICON badges, so a rider and the stack it applies read identically.
// bonus-per-card is likewise category-routed rather than getting its own
// icon, since it lands on the exact same damage/guard resource those two
// already do (see combatEngine's computeRiderTotals) -- just scaled.
const RIDER_ICON: Record<Exclude<RiderEffect['kind'], 'bonus-status' | 'bonus-per-card'>, string> = {
  'bonus-damage': '🗡️',
  'bonus-guard': '🛡️',
  'bonus-damage-aoe': '💥',
  draw: '🃏',
  discard: '🚫',
  'bonus-plays': '⚡',
};

const TARGETS_DAMAGE: SuitCategory[] = ['threat', 'weaken', 'poison'];

export function riderBadgeText(rider: RiderEffect, category: SuitCategory): string {
  const icon =
    rider.kind === 'bonus-status'
      ? STATUS_ICON[rider.statusId]
      : rider.kind === 'bonus-per-card'
        ? TARGETS_DAMAGE.includes(category)
          ? RIDER_ICON['bonus-damage']
          : RIDER_ICON['bonus-guard']
        : RIDER_ICON[rider.kind];
  return `${icon}${rider.amount}`;
}
