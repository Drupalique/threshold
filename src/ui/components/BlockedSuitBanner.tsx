import type { SuitId } from '../../types/suits';
import { SUIT_DEFINITIONS } from '../../config/constants';

interface BlockedSuitBannerProps {
  blockedSuits: Partial<Record<SuitId, number>>;
}

export function BlockedSuitBanner({ blockedSuits }: BlockedSuitBannerProps) {
  const entries = Object.entries(blockedSuits).filter(([, turns]) => (turns ?? 0) > 0);
  if (entries.length === 0) return null;
  return (
    <div className="blocked-suit-banner">
      Blocked:{' '}
      {entries
        .map(([suit, turns]) => `${SUIT_DEFINITIONS.find((s) => s.id === suit)!.name} (${turns})`)
        .join(', ')}
    </div>
  );
}
