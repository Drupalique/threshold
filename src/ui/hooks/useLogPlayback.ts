import { useEffect, useState } from 'react';
import type { LogEntry } from '../../types/combat';
import { LOG_STEP_DELAY_MS } from '../../config/constants';

interface LogPlayback {
  visibleLog: LogEntry[];
  displayedPlayerHP: number;
  displayedPlayerHPMax: number;
  displayedPlayerGuard: number;
  isPlaying: boolean;
}

/**
 * Reveals newly appended log entries one at a time instead of snapping
 * straight to the resolved state -- so e.g. a decay penalty landing right
 * after an enemy's attack in the same turn-end tick reads as a sequence
 * instead of a single blended net number. History present when `log` first
 * arrives (mount, or a fresh room's log replacing the previous one) is
 * revealed immediately; only entries appended after that are queued up and
 * drip out over time.
 */
export function useLogPlayback(log: LogEntry[]): LogPlayback {
  const [revealedCount, setRevealedCount] = useState(log.length);

  // A different (shorter) log means a new combat mounted with a fresh
  // history -- catch the counter down to it instantly rather than treating
  // it as an in-progress queue.
  if (log.length < revealedCount) {
    setRevealedCount(log.length);
  }

  useEffect(() => {
    if (revealedCount >= log.length) return;
    const timer = setTimeout(() => setRevealedCount((n) => n + 1), LOG_STEP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [revealedCount, log.length]);

  const visibleLog = log.slice(0, revealedCount);
  const last = visibleLog[visibleLog.length - 1];

  return {
    visibleLog,
    displayedPlayerHP: last?.playerHP ?? 0,
    displayedPlayerHPMax: last?.playerHPMax ?? 0,
    displayedPlayerGuard: last?.playerGuard ?? 0,
    isPlaying: revealedCount < log.length,
  };
}
