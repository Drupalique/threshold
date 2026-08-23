import type { EnemyInstance } from '../../types/enemy';
import type { IntentType, CorruptEffectType } from '../../types/enemy';
import type { StatusId } from '../../types/status';
import { STATUS_DEFS } from '../../types/status';
import { currentIntent } from '../../engine/roomIntent';
import { MeterBar } from './MeterBar';

const INTENT_LABEL: Record<IntentType, string> = {
  attack: 'Attack',
  guard: 'Guard',
  heal: 'Heal',
  debuff: 'Weaken',
  poison: 'Poison',
  strength: 'Strength',
  corrupt: 'Corrupt',
};

const INTENT_ICON: Record<IntentType, string> = {
  attack: '⚔',
  guard: '\u{1F6E1}',
  heal: '✚',
  debuff: '☠',
  poison: '\u{2623}',
  strength: '\u{1F4AA}',
  corrupt: '\u{1F300}',
};

const STATUS_ICON: Record<StatusId, string> = {
  weaken: '☠',
  poison: '\u{2623}',
  strength: '\u{1F4AA}',
};

const CORRUPT_LABEL: Record<CorruptEffectType, string> = {
  'add-cards': 'Reinforce',
  'block-suit': 'Block Suit',
  'force-discard': 'Discard',
};

function intentText(instance: EnemyInstance): string {
  const step = currentIntent(instance);
  const label = INTENT_LABEL[step.type];
  switch (step.type) {
    case 'attack':
    case 'guard':
    case 'heal':
    case 'debuff':
    case 'poison':
    case 'strength':
      return `${label} ${step.magnitude ?? 0}`;
    case 'corrupt':
      return `${label}: ${step.corruptEffect ? CORRUPT_LABEL[step.corruptEffect] : ''}`;
  }
}

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

interface EnemyPanelProps {
  enemies: EnemyInstance[];
  // Threat piles aren't owned by any enemy (design doc 4.8) -- when a live
  // threat claim is pending, every alive enemy here is a legal target, and
  // the player picks by clicking the card directly rather than a separate
  // "which enemy?" menu.
  targetableInstanceIds?: Set<string>;
  selectedTargetInstanceId?: string | null;
  onSelectTarget?: (instanceId: string) => void;
}

// Live snapshot, not log-drip-animated like the player HP bar -- enemy HP
// updates instantly (see PROTOTYPE_STATUS.md's noted simplification).
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
          const intent = currentIntent(enemy);
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
                <span className={`enemy-intent-badge enemy-intent-badge--${intent.type}`}>
                  {INTENT_ICON[intent.type]} {intentText(enemy)}
                </span>
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
