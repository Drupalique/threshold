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
  onClaim: () => void;
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
  onClaim,
  onPass,
}: ClaimControlsProps) {
  return (
    <div className="claim-controls">
      {!isPlayerTurn && <div className="claim-controls-note">Waiting on the room...</div>}
      {isPlayerTurn && (
        <>
          {needsTarget ? (
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
          <div className="claim-controls-buttons">
            <button type="button" disabled={!canClaim} onClick={onClaim}>
              Claim
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
