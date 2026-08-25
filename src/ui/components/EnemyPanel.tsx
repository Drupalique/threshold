import type { EnemyInstance } from '../../types/enemy';
import type { CreatureCard } from '../../types/cards';
import type { StatusId } from '../../types/status';
import { STATUS_DEFS } from '../../types/status';
import { SUIT_DEFINITIONS } from '../../config/constants';
import { MeterBar } from './MeterBar';

const STATUS_ICON: Record<StatusId, string> = {
  weaken: '☠',
  poison: '\u{2623}',
  strength: '\u{1F4AA}',
};

/** Small "Weaken 2" / "Poison 3" style badges for whatever stacks a holder (an enemy, or the player) currently carries. */
export function StatusBadges({ statuses }: { statuses: Partial<Record<StatusId, number>> }) {
  const active = (Object.keys(statuses) as StatusId[]).filter((id) => (statuses[id] ?? 0) > 0);
  if (active.length === 0) return null;
  return (
    <>
      {active.map((id) => (
        <span key={id} className={`status-badge status-badge--${id}`}>
          {STATUS_ICON[id]} {STATUS_DEFS[id].name} {statuses[id]}
        </span>
      ))}
    </>
  );
}

// Non-interactive card display for an enemy's hand -- deliberately a <span>,
// not the clickable CardChip <button>, since an enemy card here can itself
// already be a <button> (when targetable) and nesting interactive elements
// inside a <button> is invalid HTML.
function StaticCardChip({ card }: { card: CreatureCard }) {
  const suitDef = SUIT_DEFINITIONS.find((s) => s.id === card.suit)!;
  return (
    <span className="card-chip card-chip--static" style={{ background: suitDef.displayColor }}>
      {suitDef.name}
    </span>
  );
}

interface EnemyPanelProps {
  enemies: EnemyInstance[];
  // Table piles aren't owned by any enemy -- when a live threat/weaken/
  // poison play is pending, every alive enemy here is a legal target, and
  // the player picks by clicking the card directly rather than a separate
  // "which enemy?" menu.
  targetableInstanceIds?: Set<string>;
  selectedTargetInstanceId?: string | null;
  onSelectTarget?: (instanceId: string) => void;
}

// Live snapshot, not log-drip-animated like the player HP bar -- enemy HP
// updates instantly. Each enemy's hand is shown face-up (not just a count)
// so the player can plan around a specific enemy's live options, the
// closest replacement for the old scripted-pattern telegraph now that
// enemies choose their own plays from a hidden hand each turn.
export function EnemyPanel({
  enemies,
  targetableInstanceIds,
  selectedTargetInstanceId,
  onSelectTarget,
}: EnemyPanelProps) {
  return (
    <div className="enemy-panel">
      <h3>Enemies</h3>
      <div className="enemy-panel-cards">
        {enemies.map((enemy) => {
          const isTargetable = targetableInstanceIds?.has(enemy.instanceId) ?? false;
          const isSelected = isTargetable && selectedTargetInstanceId === enemy.instanceId;
          const className = [
            'enemy-card',
            isTargetable ? 'enemy-card--targetable' : '',
            isSelected ? 'enemy-card--selected' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const body = (
            <>
              {isSelected && <div className="enemy-card-target-badge">Target</div>}
              <div className="enemy-card-name">{enemy.name}</div>
              <MeterBar label="HP" value={enemy.hp} max={enemy.hpMax} color="#8e44ad" />
              <div className="enemy-card-badges">
                {enemy.guard > 0 && <span className="enemy-guard-badge">Guard {enemy.guard}</span>}
                <StatusBadges statuses={enemy.statuses} />
              </div>
              <div className="enemy-card-hand">
                {enemy.hand.map((c) => (
                  <StaticCardChip key={c.id} card={c} />
                ))}
                {enemy.hand.length === 0 && <span className="enemy-card-hand-empty">no cards</span>}
              </div>
            </>
          );

          return isTargetable ? (
            <button
              key={enemy.instanceId}
              type="button"
              className={className}
              onClick={() => onSelectTarget?.(enemy.instanceId)}
            >
              {body}
            </button>
          ) : (
            <div key={enemy.instanceId} className={className}>
              {body}
            </div>
          );
        })}
        {enemies.length === 0 && <div className="hand-empty">No enemies remain.</div>}
      </div>
    </div>
  );
}
