import type { LogEntry } from '../../types/combat';

interface TurnLogFeedProps {
  log: LogEntry[];
  maxEntries?: number;
}

export function TurnLogFeed({ log, maxEntries = 30 }: TurnLogFeedProps) {
  const entries = log.slice(-maxEntries).reverse();
  return (
    <div className="turn-log">
      <h3>Log</h3>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id} className={`log-entry log-entry--${entry.actor}`}>
            <div>{entry.message}</div>
            <div className="log-entry-status">
              HP {Math.max(0, Math.round(entry.playerHP))}/{entry.playerHPMax} -- Threat{' '}
              {Math.max(0, Math.round(entry.roomThreat))}/{entry.roomThreatMax}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
