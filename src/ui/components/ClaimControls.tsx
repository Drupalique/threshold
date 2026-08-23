import { MIN_POOL_SET_SIZE } from '../../config/constants';

interface ClaimControlsProps {
  isPlayerTurn: boolean;
  selectedSuitName: string | null;
  isSelectedSuitBlocked: boolean;
  poolSetSize: number;
  selectedCount: number;
  canClaim: boolean;
  hasAnyLegalClaim: boolean;
  // True whenever the selected threat suit has 2+ alive enemies to choose
  // from and none has been picked yet -- a threat pile isn't owned by any
  // one enemy, so the player picks who takes the hit by clicking the
  // enemy's card directly (see EnemyPanel), not a menu here.
  needsTarget: boolean;
  // False once the turn's plays are used up and no unlimited-plays grant is
  // active -- claiming is disabled regardless of what's selected, and the
  // player must Pass to end the turn.
  hasPlaysLeft: boolean;
  // Legal whenever a suit is selected with 1+ hand cards and the suit isn't
  // blocked -- feeding has no pool-size floor and no target, so it's often
  // legal even when Claim isn't (e.g. needsTarget, or too small a pile).
  canFeed: boolean;
  onClaim: () => void;
  onFeed: () => void;
  onPass: () => void;
}

export function ClaimControls({
  isPlayerTurn,
  selectedSuitName,
  isSelectedSuitBlocked,
  poolSetSize,
  selectedCount,
  canClaim,
  hasAnyLegalClaim,
  needsTarget,
  hasPlaysLeft,
  canFeed,
  onClaim,
  onFeed,
  onPass,
}: ClaimControlsProps) {
  return (
    <div className="claim-controls">
      {!isPlayerTurn && <div className="claim-controls-note">Waiting on the room...</div>}
      {isPlayerTurn && (
        <>
          {!hasPlaysLeft ? (
            <div className="claim-controls-note">No plays left this turn -- pass to end it.</div>
          ) : needsTarget ? (
            <div className="claim-controls-note">
              Click an enemy above to target with {selectedSuitName} ({poolSetSize} x {selectedCount} ={' '}
              {poolSetSize * selectedCount}).
            </div>
          ) : canClaim ? (
            <div className="claim-preview">
              Claim {selectedSuitName}: {poolSetSize} x {selectedCount} ={' '}
              <strong>{poolSetSize * selectedCount}</strong>
            </div>
          ) : selectedSuitName ? (
            <div className="claim-controls-note">
              {isSelectedSuitBlocked
                ? `${selectedSuitName} is blocked this turn -- pick another suit.`
                : `Not enough ${selectedSuitName} in the pool to claim (need ${MIN_POOL_SET_SIZE}+, found ${poolSetSize}).`}
            </div>
          ) : (
            <div className="claim-controls-note">
              {hasAnyLegalClaim ? 'Select matching cards to claim a set.' : 'No legal claims available.'}
            </div>
          )}
          {canFeed && (
            <div className="feed-preview">
              Or feed {selectedCount} {selectedSuitName} card(s) into the pool instead (now {poolSetSize} &rarr;{' '}
              {poolSetSize + selectedCount}) -- banks a bigger future claim, but doesn't resolve anything now.
            </div>
          )}
          <div className="claim-controls-buttons">
            <button type="button" disabled={!canClaim} onClick={onClaim}>
              Claim
            </button>
            <button type="button" disabled={!canFeed} onClick={onFeed}>
              Feed
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
