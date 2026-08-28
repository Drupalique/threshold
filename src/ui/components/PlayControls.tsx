import type { PlayPreview } from '../../engine/combatEngine';
import { WEAKEN_PCT_PER_STACK } from '../../config/constants';

interface PlayControlsProps {
  isPlayerTurn: boolean;
  selectedSuitName: string | null;
  selectedCount: number;
  // Built by previewPlayerPlay from the exact same magnitude/rider math a
  // real play resolves with -- null whenever nothing playable is selected
  // yet (no suit, or a suit with 0 cards picked).
  preview: PlayPreview | null;
  canPlay: boolean;
  hasAnyLegalPlay: boolean;
  // True whenever the selected threat/weaken/poison suit has 2+ alive
  // enemies to choose from and none has been picked yet -- picked by
  // clicking the enemy's card directly (see EnemyPanel), not a menu here.
  needsTarget: boolean;
  // False once the turn's plays are used up and no unlimited-plays grant is
  // active -- playing is disabled regardless of what's selected, and the
  // player must Pass to end the turn.
  hasPlaysLeft: boolean;
  onPlay: () => void;
  onPass: () => void;
}

// Core-effect resource name per suit category -- what `magnitude` itself
// measures before any rider bonus is added.
const RESOURCE_LABEL: Record<PlayPreview['category'], string> = {
  threat: 'damage',
  boon: 'healing',
  guard: 'Guard',
  weaken: 'Weaken stacks',
  poison: 'Poison stacks',
  strength: 'Strength stacks',
};

// Whether a category's rider bonus lands on the SAME resource as its core
// magnitude (threat's bonus-damage tops up damage; guard's bonus-guard tops
// up Guard) -- everything else's rider is a side-effect on a different
// resource (e.g. Grace's core heals HP but its rider raises Guard instead),
// so it reads as a separate addition rather than a combinable total.
function riderSharesResource(category: PlayPreview['category']): boolean {
  return category === 'threat' || category === 'guard';
}

/** One line describing this play's full effect: the base magnitude (with a note for any Strength/Weaken folded into it), plus its rider bonus -- combined into one total when the rider lands on the same resource, called out separately when it doesn't (see riderSharesResource). */
function describePreview(preview: PlayPreview, selectedCount: number): string {
  const { category, tableCountAfterPlay, magnitude, strengthStacks, weakenStacks, bonusDamage, bonusGuard } = preview;
  const resourceLabel = RESOURCE_LABEL[category];
  const buffNotes = [
    strengthStacks > 0 ? `+${strengthStacks} from Strength` : null,
    weakenStacks > 0
      ? `weakened -${Math.round(Math.min(1, weakenStacks * WEAKEN_PCT_PER_STACK) * 100)}%`
      : null,
  ].filter((n): n is string => n !== null);
  const buffSuffix = buffNotes.length > 0 ? ` (${buffNotes.join(', ')})` : '';

  const core = `${selectedCount} x ${tableCountAfterPlay} = ${magnitude} ${resourceLabel}${buffSuffix}`;

  const bonus = bonusDamage > 0 ? bonusDamage : bonusGuard > 0 ? bonusGuard : 0;
  if (bonus === 0) return core;

  if (riderSharesResource(category)) {
    return `${core} +${bonus} rider = ${magnitude + bonus} ${resourceLabel} total`;
  }
  const bonusLabel = bonusDamage > 0 ? 'damage' : 'Guard';
  return `${core} -- rider also adds +${bonus} ${bonusLabel}`;
}

export function PlayControls({
  isPlayerTurn,
  selectedSuitName,
  selectedCount,
  preview,
  canPlay,
  hasAnyLegalPlay,
  needsTarget,
  hasPlaysLeft,
  onPlay,
  onPass,
}: PlayControlsProps) {
  const previewText = preview ? describePreview(preview, selectedCount) : '';

  return (
    <div className="play-controls">
      {!isPlayerTurn && <div className="play-controls-note">Waiting on the room...</div>}
      {isPlayerTurn && (
        <>
          {!hasPlaysLeft ? (
            <div className="play-controls-note">No plays left this turn -- pass to end it.</div>
          ) : needsTarget ? (
            <div className="play-controls-note">
              Click an enemy above to target with {selectedSuitName} ({previewText}).
            </div>
          ) : canPlay && preview ? (
            <div className="play-preview">
              Play {selectedSuitName}: {previewText}
            </div>
          ) : (
            <div className="play-controls-note">
              {hasAnyLegalPlay ? 'Select matching cards to play a set.' : 'No legal plays available.'}
            </div>
          )}
          <div className="play-controls-buttons">
            <button type="button" disabled={!canPlay} onClick={onPlay}>
              Play
            </button>
            <button type="button" onClick={onPass}>
              Pass
            </button>
          </div>
        </>
      )}
    </div>
  );
}
